// CloudConversationSync — Conversation and message sync with cloud
// Append-only message sync with high-water mark tracking.
// Maps local conversation names to cloud conversation UUIDs.

import crypto from 'crypto';
import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * Syncs conversations and messages between local ConversationManager
 * and cloud conversations/messages tables.
 *
 * Local conversations: JSON files keyed by name (e.g., "chat", "research")
 * Cloud conversations: keyed by UUID
 * Mapping: stored in .cloud-link.json's conversations field
 *
 * Sync model: append-only. System messages are excluded from sync.
 */
export class CloudConversationSync {
    /**
     * @param {import('./cloud-client.mjs').CloudClient} client
     * @param {import('../lib/event-bus.mjs').AiManEventBus} eventBus
     */
    constructor(client, eventBus) {
        this.client = client;
        this.eventBus = eventBus;
    }

    /**
     * List conversations for a cloud workspace.
     * @param {string} cloudWorkspaceId
     * @returns {Promise<Array>}
     */
    async listCloudConversations(cloudWorkspaceId) {
        const safeWsId = encodeURIComponent(cloudWorkspaceId);
        const rows = await this.client.get(
            `/rest/v1/conversations?workspace_id=eq.${safeWsId}&select=id,name,conversation_type,is_archived,created_at&order=created_at.asc`
        );
        return rows || [];
    }

    /**
     * Create a new conversation in the cloud workspace.
     * @param {string} cloudWorkspaceId
     * @param {string} name — e.g. "chat"
     * @param {string} [type='chat'] — conversation_type
     * @param {string} [userId] — started_by user ID
     * @returns {Promise<object>} Created conversation row
     */
    async createCloudConversation(cloudWorkspaceId, name, type = 'chat', userId = null) {
        const body = {
            workspace_id: cloudWorkspaceId,
            name,
            conversation_type: type,
        };
        if (userId) body.started_by = userId;

        const rows = await this.client.post(
            '/rest/v1/conversations',
            body,
            { 'Prefer': 'return=representation' }
        );
        return Array.isArray(rows) ? rows[0] : rows;
    }

    /**
     * Push new messages from a local conversation to cloud.
     * Only pushes messages not yet synced (after lastSyncAt).
     * Filters out system messages and tool messages.
     * Deduplicates messages locally before pushing to prevent duplicates
     * during reconnection scenarios.
     *
     * @param {string} cloudConvId — Cloud conversation UUID
     * @param {Array} messages — Full local message history
     * @param {string|null} lastSyncAt — ISO timestamp of last sync
     * @param {string|null} userId — Current user's cloud ID
     * @returns {Promise<{ pushed: number, lastSyncAt: string }>}
     */
    async pushMessages(cloudConvId, messages, lastSyncAt = null, userId = null) {
        // Filter to syncable messages (user + assistant only)
        const syncable = messages.filter(m =>
            m.role === 'user' || m.role === 'assistant'
        );

        // Deduplicate within the local batch first (prevents sending the
        // same message twice if the local history contains duplicates)
        const deduped = this._deduplicateMessages(syncable);

        // Filter to messages after lastSyncAt
        // Since local messages don't have timestamps, we use index-based tracking
        // The lastSyncAt acts as a count marker
        // NOTE: Local messages usually lack timestamps, so _hashMessage() produces
        // a timestamp-free hash for outgoing messages. _getRecentCloudHashes() computes
        // BOTH the timestamped hash and the legacy (no-timestamp) hash, ensuring
        // deduplication works correctly regardless of whether the message has a timestamp.
        let newMessages = deduped;
        if (lastSyncAt) {
            // Use content hash deduplication instead of timestamp
            // Pull recent cloud messages and build a set of content hashes
            const recentCloud = await this._getRecentCloudHashes(cloudConvId, 100);
            newMessages = deduped.filter(m => {
                const hash = this._hashMessage(m);
                return !recentCloud.has(hash);
            });
        }

        if (newMessages.length === 0) {
            return { pushed: 0, lastSyncAt: new Date().toISOString() };
        }

        // Push each message
        let pushed = 0;
        for (const msg of newMessages) {
            try {
                const body = {
                    conversation_id: cloudConvId,
                    content: msg.content,
                    role: msg.role,
                };
                if (msg.role === 'user' && userId) {
                    body.sender_user_id = userId;
                }
                await this.client.post('/rest/v1/messages', body);
                pushed++;
            } catch (err) {
                consoleStyler.log('cloud', `Failed to push message: ${err.message}`);
                // Continue with remaining messages
            }
        }

        const newLastSyncAt = new Date().toISOString();
        return { pushed, lastSyncAt: newLastSyncAt };
    }

    /**
     * Pull new messages from a cloud conversation.
     * Returns messages created after the given timestamp,
     * excluding messages sent by the current user (to avoid echoes).
     *
     * @param {string} cloudConvId — Cloud conversation UUID
     * @param {string|null} since — ISO timestamp
     * @param {string|null} userId — Current user ID (to filter out own messages)
     * @returns {Promise<{ messages: Array, lastCloudMessageAt: string|null }>}
     */
    async pullMessages(cloudConvId, since = null, userId = null) {
        const safeConvId = encodeURIComponent(cloudConvId);
        let query = `/rest/v1/messages?conversation_id=eq.${safeConvId}&select=id,content,role,sender_user_id,sender_agent_id,model_used,created_at&order=created_at.asc`;

        if (since) {
            query += `&created_at=gt.${encodeURIComponent(since)}`;
        }

        query += '&limit=200';

        const rows = await this.client.get(query);
        if (!rows || rows.length === 0) {
            return { messages: [], lastCloudMessageAt: since };
        }

        // Filter out messages sent by ourselves
        const newMessages = userId
            ? rows.filter(m => m.sender_user_id !== userId)
            : rows;

        // Map to local message format
        const localMessages = newMessages.map(m => ({
            role: m.role,
            content: m.content,
            _cloudId: m.id,
            _cloudSenderAgent: m.sender_agent_id,
            _cloudCreatedAt: m.created_at,
        }));

        const lastCloudMessageAt = rows[rows.length - 1]?.created_at || since;

        return { messages: localMessages, lastCloudMessageAt };
    }

    /**
     * Deduplicate a list of messages by content hash.
     * Keeps the first occurrence of each unique hash, removing later duplicates.
     * This prevents pushing the same message multiple times during reconnection.
     *
     * @param {Array<{ role: string, content: string, timestamp?: string }>} messages
     * @returns {Array<{ role: string, content: string, timestamp?: string }>}
     */
    _deduplicateMessages(messages) {
        const seen = new Set();
        const result = [];
        for (const msg of messages) {
            const hash = this._hashMessage(msg);
            if (!seen.has(hash)) {
                seen.add(hash);
                result.push(msg);
            }
        }
        return result;
    }

    /**
     * Get content hashes of recent cloud messages for deduplication.
     * Computes both the current hash (with timestamp) AND the legacy hash
     * (without timestamp) so that messages pushed before the hash format
     * change are still detected as duplicates during the transition period.
     *
     * @param {string} cloudConvId
     * @param {number} limit
     * @returns {Promise<Set<string>>}
     */
    async _getRecentCloudHashes(cloudConvId, limit = 100) {
        try {
            const safeConvId = encodeURIComponent(cloudConvId);
            const rows = await this.client.get(
                `/rest/v1/messages?conversation_id=eq.${safeConvId}&select=content,role,created_at&order=created_at.desc&limit=${limit}`
            );
            const hashes = new Set();
            for (const row of (rows || [])) {
                hashes.add(this._hashMessage(row));
                // Also add the legacy hash (no timestamp) for backward compatibility
                hashes.add(this._hashMessageLegacy(row));
            }
            return hashes;
        } catch {
            return new Set();
        }
    }

    /**
     * Create a deterministic SHA-256 hash for a message (for deduplication).
     * Uses `role + content + timestamp_minute` to produce a stable identifier.
     * The timestamp is rounded to the nearest minute so that minor timing
     * differences during reconnection don't defeat deduplication.
     *
     * @param {{ role: string, content: string, timestamp?: string, created_at?: string }} msg
     * @returns {string} 16-char hex hash prefix
     */
    _hashMessage(msg) {
        // Round timestamp to the minute for stable hashing across reconnects
        const ts = msg.timestamp || msg.created_at || '';
        let minuteKey = '';
        if (ts) {
            try {
                const d = new Date(ts);
                if (!isNaN(d.getTime())) {
                    // Format: YYYY-MM-DDTHH:MM (minute precision)
                    minuteKey = d.toISOString().slice(0, 16);
                }
            } catch {
                // Ignore invalid timestamps — hash without time component
            }
        }

        const input = `${msg.role}:${(msg.content || '').slice(0, 500)}:${minuteKey}`;
        return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
    }

    /**
     * Legacy hash format (role + content only, no timestamp).
     * Kept for backward compatibility during the transition period so that
     * messages pushed under the old scheme are still detected as duplicates.
     *
     * TODO: Remove this method and all call sites after the migration period
     * (target: 2026-07-01). After that date all cloud messages will carry
     * timestamps and the new _hashMessage() format will be sufficient.
     *
     * @param {{ role: string, content: string }} msg
     * @returns {string} 16-char hex hash prefix
     */
    _hashMessageLegacy(msg) {
        const input = `${msg.role}:${(msg.content || '').slice(0, 500)}`;
        return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
    }
}
