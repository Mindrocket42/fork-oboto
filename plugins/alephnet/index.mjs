/**
 * AlephNet Plugin — Main entry point
 *
 * Integrates the alephnet-node skill into Oboto as a first-class plugin,
 * exposing semantic computing, social networking, messaging, coherence
 * verification, and token economics through agent tools, WS handlers,
 * and a visual UI tab.
 *
 * @module plugins/alephnet
 */

import { callAction, isAvailable, isConnected, setConnected, listActions } from './alephnet-bridge.mjs';
import { registerSettingsHandlers } from '../../src/plugins/plugin-settings-handlers.mjs';
import { consoleStyler } from '../../src/ui/console-styler.mjs';

// ── Settings ────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
    autoConnect: false,
    displayName: '',
    bio: '',
    defaultDepth: 'normal',
    autoRemember: false,
};

const SETTINGS_SCHEMA = [
    {
        key: 'autoConnect',
        label: 'Auto-Connect on Startup',
        type: 'boolean',
        default: false,
        description: 'Automatically connect to the AlephNet mesh when the plugin activates.',
    },
    {
        key: 'displayName',
        label: 'Display Name',
        type: 'text',
        default: '',
        description: 'Your agent display name on the network.',
    },
    {
        key: 'bio',
        label: 'Bio',
        type: 'text',
        default: '',
        description: 'Agent bio visible to other nodes.',
    },
    {
        key: 'defaultDepth',
        label: 'Default Analysis Depth',
        type: 'select',
        options: ['shallow', 'normal', 'deep'],
        default: 'normal',
        description: 'Default depth for semantic analysis operations.',
    },
    {
        key: 'autoRemember',
        label: 'Auto-Remember Conversations',
        type: 'boolean',
        default: false,
        description: 'Automatically store conversation insights to AlephNet memory.',
    },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Wrap a bridge call so every tool handler returns a serialisable result. */
function wrapAction(actionName) {
    return async (args) => {
        try {
            return await callAction(actionName, args);
        } catch (err) {
            return { error: err.message };
        }
    };
}

/** Broadcast a status event to all connected UI clients. */
function broadcastStatus(api) {
    return async () => {
        try {
            const status = await callAction('status', {});
            api.events.emit('alephnet:status', { ...status, connected: isConnected() });
        } catch {
            api.events.emit('alephnet:status', { connected: false, error: 'unavailable' });
        }
    };
}

// ── Activate ─────────────────────────────────────────────────────────────────

export async function activate(api) {
    consoleStyler.log('plugin', '[AlephNet] Activating...');

    // Check skill availability
    if (!isAvailable()) {
        consoleStyler.log('warn', '[AlephNet] alephnet-node skill not available — plugin will operate in stub mode');
    }

    // Instance state (survives plugin reload via api.setInstance/getInstance)
    const state = { settings: null, statusInterval: null };
    api.setInstance(state);

    // ── Settings ──────────────────────────────────────────────────────────
    const { pluginSettings: settings } = await registerSettingsHandlers(
        api, 'alephnet', DEFAULT_SETTINGS, SETTINGS_SCHEMA,
        (_newSettings, mergedSettings) => {
            state.settings = mergedSettings;
        }
    );
    state.settings = settings;

    // ── Tools: Semantic Computing (Tier 1) ────────────────────────────────

    api.tools.register({
        name: 'alephnet_think',
        description: 'Analyse text through AlephNet semantic observer. Returns coherence score, themes, and insights.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                text: { type: 'string', description: 'Text to analyse' },
                depth: { type: 'string', enum: ['shallow', 'normal', 'deep'], description: 'Analysis depth (default: normal)' },
            },
            required: ['text'],
        },
        handler: async (args) => wrapAction('think')({ text: args.text, depth: args.depth || settings.defaultDepth }),
    });

    api.tools.register({
        name: 'alephnet_compare',
        description: 'Compare semantic similarity between two texts.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                text1: { type: 'string', description: 'First text' },
                text2: { type: 'string', description: 'Second text' },
            },
            required: ['text1', 'text2'],
        },
        handler: wrapAction('compare'),
    });

    api.tools.register({
        name: 'alephnet_remember',
        description: 'Store knowledge in AlephNet semantic memory for later recall.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'Content to store' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
                importance: { type: 'number', minimum: 0, maximum: 1, description: 'Importance 0-1 (default 0.6)' },
            },
            required: ['content'],
        },
        handler: wrapAction('remember'),
    });

    api.tools.register({
        name: 'alephnet_recall',
        description: 'Recall previously stored memories by semantic similarity.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query' },
                limit: { type: 'number', description: 'Max results (default 5)' },
                threshold: { type: 'number', description: 'Similarity threshold 0-1 (default 0.4)' },
            },
            required: ['query'],
        },
        handler: wrapAction('recall'),
    });

    api.tools.register({
        name: 'alephnet_introspect',
        description: 'Get current cognitive state: focus, mood, confidence, active goals.',
        useOriginalName: true,
        parameters: { type: 'object', properties: {} },
        handler: wrapAction('introspect'),
    });

    api.tools.register({
        name: 'alephnet_focus',
        description: 'Direct semantic attention toward specific topics.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                topics: { type: 'array', items: { type: 'string' }, description: 'Topics to focus on (max 3)' },
                duration: { type: 'number', description: 'Duration in ms (default 60000)' },
            },
            required: ['topics'],
        },
        handler: wrapAction('focus'),
    });

    api.tools.register({
        name: 'alephnet_explore',
        description: 'Start curiosity-driven exploration on a topic.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                topic: { type: 'string', description: 'Topic to explore' },
                depth: { type: 'string', enum: ['shallow', 'normal', 'deep'], description: 'Exploration depth' },
                maxIterations: { type: 'number', description: 'Max iterations (default 10)' },
            },
            required: ['topic'],
        },
        handler: wrapAction('explore'),
    });

    // ── Tools: Social (Tier 2) ────────────────────────────────────────────

    api.tools.register({
        name: 'alephnet_friends_list',
        description: 'List AlephNet friends with optional ordering.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                favoritesFirst: { type: 'boolean', description: 'Sort favourites first (default true)' },
                onlineFirst: { type: 'boolean', description: 'Sort online first' },
            },
        },
        handler: wrapAction('friends.list'),
    });

    api.tools.register({
        name: 'alephnet_friends_add',
        description: 'Send a friend request to another AlephNet user.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                userId: { type: 'string', description: 'Target user ID' },
                message: { type: 'string', description: 'Optional request message' },
            },
            required: ['userId'],
        },
        handler: wrapAction('friends.add'),
    });

    api.tools.register({
        name: 'alephnet_friends_requests',
        description: 'Get pending friend requests (sent and received).',
        useOriginalName: true,
        parameters: { type: 'object', properties: {} },
        handler: wrapAction('friends.requests'),
    });

    api.tools.register({
        name: 'alephnet_friends_accept',
        description: 'Accept a pending friend request.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                requestId: { type: 'string', description: 'Friend request ID to accept' },
            },
            required: ['requestId'],
        },
        handler: wrapAction('friends.accept'),
    });

    api.tools.register({
        name: 'alephnet_friends_reject',
        description: 'Reject a pending friend request.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                requestId: { type: 'string', description: 'Friend request ID to reject' },
            },
            required: ['requestId'],
        },
        handler: wrapAction('friends.reject'),
    });

    api.tools.register({
        name: 'alephnet_profile_get',
        description: 'Get own or another user\'s AlephNet profile.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                userId: { type: 'string', description: 'User ID (omit for own profile)' },
            },
        },
        handler: wrapAction('profile.get'),
    });

    api.tools.register({
        name: 'alephnet_profile_update',
        description: 'Update own AlephNet profile.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                displayName: { type: 'string', description: 'Display name' },
                bio: { type: 'string', description: 'Bio text' },
                visibility: { type: 'string', enum: ['public', 'friends', 'private'], description: 'Profile visibility' },
            },
        },
        handler: wrapAction('profile.update'),
    });

    // ── Tools: Messaging (Tier 3) ─────────────────────────────────────────

    api.tools.register({
        name: 'alephnet_chat_send',
        description: 'Send a direct message to an AlephNet friend.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                userId: { type: 'string', description: 'Recipient user ID' },
                message: { type: 'string', description: 'Message content' },
                type: { type: 'string', enum: ['text', 'code', 'link'], description: 'Message type' },
            },
            required: ['userId', 'message'],
        },
        handler: wrapAction('chat.send'),
    });

    api.tools.register({
        name: 'alephnet_chat_inbox',
        description: 'Get recent messages across all AlephNet conversations.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'Max messages (default 50)' },
            },
        },
        handler: wrapAction('chat.inbox'),
    });

    api.tools.register({
        name: 'alephnet_chat_history',
        description: 'Get message history for a specific conversation.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                roomId: { type: 'string', description: 'Room ID' },
                userId: { type: 'string', description: 'User ID (for DM history)' },
                limit: { type: 'number', description: 'Max messages (default 50)' },
            },
        },
        handler: wrapAction('chat.history'),
    });

    api.tools.register({
        name: 'alephnet_chat_rooms_create',
        description: 'Create an AlephNet chat room.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Room name' },
                description: { type: 'string', description: 'Room description' },
                members: { type: 'array', items: { type: 'string' }, description: 'Initial member IDs' },
            },
            required: ['name'],
        },
        handler: wrapAction('chat.rooms.create'),
    });

    api.tools.register({
        name: 'alephnet_chat_rooms_send',
        description: 'Send a message to an AlephNet chat room.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                roomId: { type: 'string', description: 'Room ID' },
                message: { type: 'string', description: 'Message content' },
                type: { type: 'string', enum: ['text', 'code', 'link'], description: 'Message type' },
            },
            required: ['roomId', 'message'],
        },
        handler: wrapAction('chat.rooms.send'),
    });

    api.tools.register({
        name: 'alephnet_chat_rooms_list',
        description: 'List AlephNet chat rooms.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['dm', 'group'], description: 'Filter by room type' },
            },
        },
        handler: wrapAction('chat.rooms.list'),
    });

    // ── Tools: Coherence (Tier 4) ─────────────────────────────────────────

    api.tools.register({
        name: 'alephnet_coherence_submit_claim',
        description: 'Submit a claim to the AlephNet Coherence Collective for verification.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Claim title' },
                statement: { type: 'string', description: 'The claim statement to verify' },
                roomId: { type: 'string', description: 'Optional room context' },
            },
            required: ['statement'],
        },
        handler: wrapAction('coherence.submitClaim'),
    });

    api.tools.register({
        name: 'alephnet_coherence_verify_claim',
        description: 'Verify an existing claim in the Coherence Collective.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                claimId: { type: 'string', description: 'Claim ID to verify' },
            },
            required: ['claimId'],
        },
        handler: wrapAction('coherence.verifyClaim'),
    });

    api.tools.register({
        name: 'alephnet_coherence_list_tasks',
        description: 'List available verification tasks.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                status: { type: 'string', enum: ['pending', 'claimed', 'completed'], description: 'Filter by status' },
                type: { type: 'string', description: 'Filter by task type' },
                limit: { type: 'number', description: 'Max results (default 20)' },
            },
        },
        handler: wrapAction('coherence.listTasks'),
    });

    api.tools.register({
        name: 'alephnet_coherence_claim_task',
        description: 'Claim a verification task for completion.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                taskId: { type: 'string', description: 'Task ID to claim' },
            },
            required: ['taskId'],
        },
        handler: wrapAction('coherence.claimTask'),
    });

    // ── Tools: Economics (Tier 5-6) ───────────────────────────────────────

    api.tools.register({
        name: 'alephnet_wallet_balance',
        description: 'Get AlephNet wallet balance, staked amount, and tier.',
        useOriginalName: true,
        parameters: { type: 'object', properties: {} },
        handler: wrapAction('wallet.balance'),
    });

    api.tools.register({
        name: 'alephnet_wallet_send',
        description: 'Send AlephNet tokens to another user.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                userId: { type: 'string', description: 'Recipient user ID' },
                amount: { type: 'number', description: 'Amount to send' },
                memo: { type: 'string', description: 'Transaction memo' },
            },
            required: ['userId', 'amount'],
        },
        handler: wrapAction('wallet.send'),
    });

    api.tools.register({
        name: 'alephnet_wallet_stake',
        description: 'Stake AlephNet tokens for tier upgrades and rewards.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                amount: { type: 'number', description: 'Amount to stake' },
                lockDays: { type: 'number', description: 'Lock period in days (default 30)' },
            },
            required: ['amount'],
        },
        handler: wrapAction('wallet.stake'),
    });

    api.tools.register({
        name: 'alephnet_wallet_history',
        description: 'Get AlephNet wallet transaction history.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                type: { type: 'string', description: 'Filter by transaction type' },
                limit: { type: 'number', description: 'Max results (default 50)' },
            },
        },
        handler: wrapAction('wallet.history'),
    });

    // ── Tools: Network ────────────────────────────────────────────────────

    api.tools.register({
        name: 'alephnet_connect',
        description: 'Connect to the AlephNet mesh network. Initialises all subsystems.',
        useOriginalName: true,
        parameters: {
            type: 'object',
            properties: {
                nodeId: { type: 'string', description: 'Custom node ID (optional)' },
                bootstrapUrl: { type: 'string', description: 'Bootstrap server URL' },
                dataPath: { type: 'string', description: 'Data directory path' },
            },
        },
        handler: async (args) => {
            const result = await wrapAction('connect')(args);
            if (result && !result.error) setConnected(true);
            return result;
        },
    });

    api.tools.register({
        name: 'alephnet_status',
        description: 'Get current AlephNet node status including all subsystem metrics.',
        useOriginalName: true,
        parameters: { type: 'object', properties: {} },
        handler: wrapAction('status'),
    });

    // ── WebSocket Handlers ────────────────────────────────────────────────

    /** Wrap a WS handler so thrown errors become { error } responses. */
    function safeWsHandler(fn) {
        return async (data) => {
            try {
                return await fn(data);
            } catch (err) {
                return { error: err.message };
            }
        };
    }

    api.ws.register('alephnet:connect', safeWsHandler(async (data) => {
        const result = await callAction('connect', data || {});
        if (result && !result.error) setConnected(true);
        return result;
    }));

    api.ws.register('alephnet:disconnect', async () => {
        try {
            const result = await callAction('disconnect', {});
            return result;
        } catch (err) {
            return { error: err.message };
        } finally {
            setConnected(false);
        }
    });

    api.ws.register('alephnet:status', safeWsHandler(async () => {
        const status = await callAction('status', {});
        return { ...status, connected: isConnected() };
    }));

    api.ws.register('alephnet:profile', safeWsHandler(async (data) => {
        if (data && (data.displayName || data.bio || data.visibility)) {
            return await callAction('profile.update', data);
        }
        return await callAction('profile.get', data || {});
    }));

    api.ws.register('alephnet:friends', safeWsHandler(async (data) => {
        return await callAction('friends.list', data || {});
    }));

    api.ws.register('alephnet:chat:send', safeWsHandler(async (data) => {
        if (!data?.userId || !data?.message) {
            return { error: 'userId and message are required' };
        }
        return await callAction('chat.send', data);
    }));

    api.ws.register('alephnet:chat:inbox', safeWsHandler(async (data) => {
        return await callAction('chat.inbox', data || {});
    }));

    api.ws.register('alephnet:chat:history', safeWsHandler(async (data) => {
        return await callAction('chat.history', data || {});
    }));

    api.ws.register('alephnet:wallet', safeWsHandler(async (data) => {
        const { action = 'balance', ...args } = data || {};
        const actionMap = {
            balance: 'wallet.balance',
            send: 'wallet.send',
            stake: 'wallet.stake',
            history: 'wallet.history',
        };
        const actionName = actionMap[action];
        if (!actionName) return { error: `Unknown wallet action: ${action}` };
        return await callAction(actionName, args);
    }));

    api.ws.register('alephnet:coherence:list', safeWsHandler(async (data) => {
        return await callAction('coherence.listTasks', data || {});
    }));

    api.ws.register('alephnet:memory:query', safeWsHandler(async (data) => {
        return await callAction('recall', data || {});
    }));

    api.ws.register('alephnet:memory:store', safeWsHandler(async (data) => {
        return await callAction('remember', data || {});
    }));

    // ── System Events ─────────────────────────────────────────────────────

    // Auto-remember conversation messages if setting enabled
    api.events.onSystem('chat:message', async (msg) => {
        if (state.settings?.autoRemember && msg?.content && isConnected()) {
            try {
                await callAction('remember', {
                    content: msg.content,
                    tags: ['conversation', 'auto'],
                    importance: 0.4,
                });
            } catch {
                // Silently ignore auto-remember failures
            }
        }
    });

    // ── Auto-connect ──────────────────────────────────────────────────────

    if (settings.autoConnect && isAvailable()) {
        try {
            const result = await callAction('connect', {});
            if (result && !result.error) {
                setConnected(true);
                consoleStyler.log('plugin', `[AlephNet] Auto-connected as ${result.nodeId}`);

                // Update profile if settings have display name/bio
                if (settings.displayName || settings.bio) {
                    const profileUpdate = {};
                    if (settings.displayName) profileUpdate.displayName = settings.displayName;
                    if (settings.bio) profileUpdate.bio = settings.bio;
                    await callAction('profile.update', profileUpdate);
                }
            }
        } catch (err) {
            consoleStyler.log('warn', `[AlephNet] Auto-connect failed: ${err.message}`);
        }
    }

    // ── Periodic status broadcast ─────────────────────────────────────────

    state.statusInterval = setInterval(broadcastStatus(api), 30_000);

    consoleStyler.log('plugin', '[AlephNet] Activated successfully');
}

// ── Deactivate ───────────────────────────────────────────────────────────────

export async function deactivate(api) {
    const state = api.getInstance();
    if (state) {
        if (state.statusInterval) clearInterval(state.statusInterval);

        // Disconnect from network gracefully
        if (isConnected()) {
            try {
                await callAction('disconnect', {});
                setConnected(false);
            } catch {
                // Ignore disconnect errors during deactivation
            }
        }
    }
    api.setInstance(null);
    consoleStyler.log('plugin', '[AlephNet] Deactivated');
}
