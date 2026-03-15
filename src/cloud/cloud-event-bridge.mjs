// CloudEventBridge — Bidirectional bridge between local EventBus and Supabase Realtime.
//
// Local events matching configured patterns are forwarded to a Supabase Realtime channel.
// Remote events from Supabase Realtime are forwarded to the local EventBus.
//
// Canonical event names (shared across client and cloud):
// - agent:message      — Agent sent a message
// - agent:tool-call    — Agent invoked a tool
// - agent:status       — Agent status change (thinking, idle, error)
// - workspace:updated  — Workspace state changed
// - workspace:file-changed — A workspace file was modified
// - conversation:message — New conversation message
// - sync:started       — Sync operation started
// - sync:completed     — Sync operation completed
// - sync:conflict      — Sync conflict detected
// - presence:update    — User/agent presence update

import { randomUUID } from 'node:crypto';

/**
 * CloudEventBridge — Bidirectional bridge between the local {@link AiManEventBus}
 * and a Supabase Realtime channel scoped to a workspace.
 *
 * Forwards matching local events as Supabase Realtime `broadcast` messages and
 * re-emits inbound cloud events on the local bus with a `cloud:` prefix to
 * prevent infinite loops.
 *
 * Presence tracking is supported via the Supabase Realtime presence API.
 */
export class CloudEventBridge {
    /**
     * @param {object} options
     * @param {import('../lib/event-bus.mjs').AiManEventBus} options.eventBus — Local event bus
     * @param {object} options.supabaseClient — Supabase client instance (from @supabase/supabase-js)
     * @param {string} options.workspaceId — Current workspace ID for channel scoping
     * @param {string[]} [options.forwardPatterns] — Local event name patterns to forward to cloud
     * @param {string[]} [options.receivePatterns] — Remote event patterns to receive from cloud
     * @param {boolean} [options.enablePresence=true] — Enable presence tracking
     */
    constructor(options) {
        const {
            eventBus,
            supabaseClient,
            workspaceId,
            forwardPatterns = ['agent:*', 'workspace:*', 'sync:*'],
            receivePatterns = ['agent:*', 'workspace:*', 'sync:*', 'presence:*'],
            enablePresence = true,
        } = options;

        if (!eventBus) throw new Error('CloudEventBridge: eventBus is required');
        if (!supabaseClient) throw new Error('CloudEventBridge: supabaseClient is required');
        if (!workspaceId) throw new Error('CloudEventBridge: workspaceId is required');

        /** @type {import('../lib/event-bus.mjs').AiManEventBus} */
        this._eventBus = eventBus;

        /** @type {object} */
        this._supabase = supabaseClient;

        /** @type {string} */
        this._workspaceId = workspaceId;

        /** @type {string[]} */
        this._forwardPatterns = forwardPatterns;

        /** @type {string[]} */
        this._receivePatterns = receivePatterns;

        /** @type {boolean} */
        this._enablePresence = enablePresence;

        /**
         * Unique origin ID — events we broadcast carry this so we can
         * ignore our own messages when they echo back.
         * @type {string}
         */
        this._originId = randomUUID();

        /** @type {object|null} Supabase Realtime channel */
        this._channel = null;

        /** @type {boolean} */
        this._running = false;

        /**
         * Bound handler reference so we can remove the `newListener` hook.
         * We intercept every local emit via a wildcard-style approach.
         * @type {Function|null}
         */
        this._localHandler = null;

        /** @type {object[]} Current presence list cache */
        this._presenceList = [];
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    /**
     * Start the bridge — subscribe to the Supabase Realtime channel and
     * begin intercepting matching local events.
     */
    async start() {
        if (this._running) return;

        const channelName = `workspace:${this._workspaceId}`;

        // Create the Supabase Realtime channel
        this._channel = this._supabase.channel(channelName, {
            config: {
                broadcast: { self: false }, // don't echo our own broadcasts back
                presence: { key: this._originId },
            },
        });

        // Listen for broadcast messages from remote clients
        this._channel.on('broadcast', { event: 'bridge-event' }, (message) => {
            this._handleCloudEvent(message);
        });

        // Presence tracking
        if (this._enablePresence) {
            this._channel.on('presence', { event: 'sync' }, () => {
                const state = this._channel.presenceState();
                this._presenceList = this._flattenPresence(state);
                this._eventBus.emitTyped('cloud:presence:sync', {
                    members: this._presenceList,
                });
            });

            this._channel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
                this._eventBus.emitTyped('cloud:presence:join', { key, presences: newPresences });
            });

            this._channel.on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
                this._eventBus.emitTyped('cloud:presence:leave', { key, presences: leftPresences });
            });
        }

        // Subscribe to the channel (connects to Supabase Realtime)
        await new Promise((resolve, reject) => {
            this._channel.subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    resolve();
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    reject(new Error(`CloudEventBridge: channel subscription failed with status "${status}"`));
                }
            });
        });

        // Now intercept local events.
        // EventEmitter doesn't have native wildcards, so we monkey-patch `emit`
        // on the event bus to capture all events.
        //
        // ⚠️ FRAGILITY WARNING:
        //   - Any code that captured a reference to `eventBus.emit` before this
        //     point will bypass the bridge entirely.
        //   - If another module monkey-patches `emit` after us, our wrapper is
        //     silently replaced (and `stop()` will then break the other patcher
        //     by restoring the pre-bridge original).
        //   - Prefer migrating to a formal middleware hook on the event bus
        //     (e.g. eventBus.use()) if/when the bus API supports it.
        const originalEmit = this._eventBus.emit.bind(this._eventBus);
        const self = this;

        this._originalEmit = originalEmit;
        this._eventBus.emit = function patchedEmit(eventName, ...args) {
            // Forward matching events to cloud (but not cloud-prefixed events to avoid loops)
            if (
                self._running &&
                typeof eventName === 'string' &&
                !eventName.startsWith('cloud:') &&
                self._matchesPattern(eventName, self._forwardPatterns)
            ) {
                const payload = args[0] || {};
                self._forwardToCloud(eventName, payload);
            }
            return originalEmit(eventName, ...args);
        };
        this._patchedEmitRef = this._eventBus.emit; // Store reference for identity check in stop()

        this._running = true;

        this._eventBus.emitTyped('cloud:bridge:started', {
            workspaceId: this._workspaceId,
            originId: this._originId,
        });
    }

    /**
     * Stop the bridge — unsubscribe from the Supabase channel and restore
     * the original event bus `emit`.
     */
    async stop() {
        if (!this._running) return;
        this._running = false;

        // Restore original emit — but only if our patched version is still
        // the current `emit`. Compare by identity (not function name) to
        // be safe against minification stripping the 'patchedEmit' name.
        if (this._originalEmit) {
            if (this._eventBus.emit === this._patchedEmitRef) {
                this._eventBus.emit = this._originalEmit;
            } else {
                // Another module monkey-patched emit after us. Restoring our
                // original would silently break that module's wrapper.
                // Forwarding is already disabled (this._running = false), so
                // our wrapper becomes a transparent pass-through — safe to leave.
                console.warn(
                    'CloudEventBridge.stop(): eventBus.emit was re-patched by another module after bridge start. ' +
                    'Skipping restore to avoid breaking the other patcher. ' +
                    'Cloud event forwarding is disabled but the wrapper function remains in the emit chain.'
                );
            }
            this._originalEmit = null;
            this._patchedEmitRef = null;
        }

        // Unsubscribe from Supabase channel
        if (this._channel) {
            try {
                await this._supabase.removeChannel(this._channel);
            } catch (err) {
                // Log but don't throw — cleanup should be best-effort
                console.error('CloudEventBridge: error removing channel:', err.message);
            }
            this._channel = null;
        }

        this._presenceList = [];

        this._eventBus.emitTyped('cloud:bridge:stopped', {
            workspaceId: this._workspaceId,
        });
    }

    // ── Forwarding ─────────────────────────────────────────────────────────

    /**
     * Forward a local event to the cloud channel as a broadcast message.
     * @param {string} eventName
     * @param {object} payload
     */
    _forwardToCloud(eventName, payload) {
        if (!this._channel || !this._running) return;

        try {
            this._channel.send({
                type: 'broadcast',
                event: 'bridge-event',
                payload: {
                    eventName,
                    data: payload,
                    _originId: this._originId,
                    _timestamp: Date.now(),
                },
            });
        } catch (err) {
            console.error(`CloudEventBridge: failed to forward "${eventName}" to cloud:`, err.message);
        }
    }

    /**
     * Handle an event received from the cloud channel.
     * Re-emits on the local event bus with a `cloud:` prefix.
     * @param {object} message — Supabase Realtime broadcast message
     */
    _handleCloudEvent(message) {
        const { payload } = message;
        if (!payload) return;

        const { eventName, data, _originId } = payload;

        // Ignore our own events (echo prevention)
        if (_originId === this._originId) return;

        // Only process events matching our receive patterns
        if (!eventName || !this._matchesPattern(eventName, this._receivePatterns)) return;

        // Re-emit on local bus with cloud: prefix to distinguish from local events
        try {
            this._eventBus.emitTyped(`cloud:${eventName}`, {
                ...data,
                _remoteOrigin: _originId,
            });
        } catch (err) {
            console.error(`CloudEventBridge: error emitting cloud event "cloud:${eventName}":`, err.message);
        }
    }

    // ── Presence ───────────────────────────────────────────────────────────

    /**
     * Update presence state (online/offline, current activity).
     * @param {object} presenceState — e.g. { status: 'online'|'away'|'busy', activity: string }
     */
    async updatePresence(presenceState) {
        if (!this._channel || !this._enablePresence) return;

        try {
            await this._channel.track({
                ...presenceState,
                originId: this._originId,
                updatedAt: new Date().toISOString(),
            });
        } catch (err) {
            console.error('CloudEventBridge: failed to update presence:', err.message);
        }
    }

    /**
     * Get current presence list.
     * @returns {object[]} — Array of presence states from all connected clients
     */
    getPresenceList() {
        return [...this._presenceList];
    }

    // ── Pattern Matching ───────────────────────────────────────────────────

    /**
     * Check if an event name matches any of the configured patterns.
     * Supports simple glob: `'agent:*'` matches `'agent:message'`, `'agent:tool-call'`, etc.
     * @param {string} eventName
     * @param {string[]} patterns
     * @returns {boolean}
     */
    _matchesPattern(eventName, patterns) {
        if (!patterns || patterns.length === 0) return false;

        for (const pattern of patterns) {
            if (pattern === '*') return true;
            if (pattern === eventName) return true;

            // Simple glob: 'agent:*' matches anything starting with 'agent:'
            if (pattern.endsWith(':*')) {
                const prefix = pattern.slice(0, -1); // 'agent:'
                if (eventName.startsWith(prefix)) return true;
            }

            // Glob at start: '*:message' matches anything ending with ':message'
            if (pattern.startsWith('*:')) {
                const suffix = pattern.slice(1); // ':message'
                if (eventName.endsWith(suffix)) return true;
            }
        }

        return false;
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    /**
     * Flatten Supabase presence state object into an array.
     * @param {object} presenceState — { key: [{ ...presenceData }] }
     * @returns {object[]}
     */
    _flattenPresence(presenceState) {
        const result = [];
        for (const [key, presences] of Object.entries(presenceState)) {
            for (const p of presences) {
                result.push({ key, ...p });
            }
        }
        return result;
    }
}
