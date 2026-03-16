/**
 * AlephNet Plugin — Main entry point
 *
 * Integrates the alephnet-node skill into Oboto as a first-class plugin,
 * exposing semantic computing, social networking, messaging, coherence
 * verification, and token economics through agent tools, WS handlers,
 * and a visual UI tab.
 *
 * Activation is defensive: tools and WS handlers are ALWAYS registered
 * even if the underlying skill is unavailable. Each handler checks skill
 * availability at invocation time and returns a helpful error if the
 * skill cannot be loaded.
 *
 * @module plugins/alephnet
 */

import { callAction, isAvailable, isConnected, setConnected, listActions } from './alephnet-bridge.mjs';
import { registerSettingsHandlers } from '../../src/plugins/plugin-settings-handlers.mjs';
import { consoleStyler } from '../../src/ui/console-styler.mjs';

const SKILL_UNAVAILABLE_MSG =
    'AlephNet skill is not available. Please ensure the alephnet-node skill is installed and configured.';

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

/** Wrap a bridge call so every tool handler returns a serialisable result.
 *  Checks skill availability before attempting the call. */
function wrapAction(actionName, state) {
    return async (args) => {
        if (!state.skillAvailable) {
            return { error: SKILL_UNAVAILABLE_MSG };
        }
        try {
            return await callAction(actionName, args);
        } catch (err) {
            return { error: err.message };
        }
    };
}

/** Wrap a WS handler so thrown errors become { error } responses.
 *  Checks skill availability before attempting the call. */
function safeWsHandler(fn, state) {
    return async (data) => {
        if (!state.skillAvailable) {
            return { error: SKILL_UNAVAILABLE_MSG };
        }
        try {
            return await fn(data);
        } catch (err) {
            return { error: err.message };
        }
    };
}

/** Broadcast a status event to all connected UI clients. */
function broadcastStatus(api, state) {
    return async () => {
        if (!state.skillAvailable) {
            api.events.emit('alephnet:status', { connected: false, error: 'skill unavailable' });
            return;
        }
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

    // Instance state (survives plugin reload via api.setInstance/getInstance)
    const state = { settings: { ...DEFAULT_SETTINGS }, statusInterval: null, skillAvailable: false };
    api.setInstance(state);

    let toolCount = 0;
    let wsHandlerCount = 0;

    // ── Phase 1: Tool & WS Handler Registration (ALWAYS runs) ─────────
    // Tools are registered first so the UI always shows them, even if the
    // underlying skill is unavailable. Each handler checks state.skillAvailable
    // at invocation time via wrapAction / safeWsHandler.

    try {
        // ── Tools: Semantic Computing (Tier 1) ────────────────────────

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
            handler: async (args) => wrapAction('think', state)({ text: args.text, depth: args.depth || state.settings.defaultDepth }),
        });
        toolCount++;

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
            handler: wrapAction('compare', state),
        });
        toolCount++;

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
            handler: wrapAction('remember', state),
        });
        toolCount++;

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
            handler: wrapAction('recall', state),
        });
        toolCount++;

        api.tools.register({
            name: 'alephnet_introspect',
            description: 'Get current cognitive state: focus, mood, confidence, active goals.',
            useOriginalName: true,
            parameters: { type: 'object', properties: {} },
            handler: wrapAction('introspect', state),
        });
        toolCount++;

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
            handler: wrapAction('focus', state),
        });
        toolCount++;

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
            handler: wrapAction('explore', state),
        });
        toolCount++;

        // ── Tools: Social (Tier 2) ────────────────────────────────────

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
            handler: wrapAction('friends.list', state),
        });
        toolCount++;

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
            handler: wrapAction('friends.add', state),
        });
        toolCount++;

        api.tools.register({
            name: 'alephnet_friends_requests',
            description: 'Get pending friend requests (sent and received).',
            useOriginalName: true,
            parameters: { type: 'object', properties: {} },
            handler: wrapAction('friends.requests', state),
        });
        toolCount++;

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
            handler: wrapAction('friends.accept', state),
        });
        toolCount++;

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
            handler: wrapAction('friends.reject', state),
        });
        toolCount++;

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
            handler: wrapAction('profile.get', state),
        });
        toolCount++;

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
            handler: wrapAction('profile.update', state),
        });
        toolCount++;

        // ── Tools: Messaging (Tier 3) ─────────────────────────────────

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
            handler: wrapAction('chat.send', state),
        });
        toolCount++;

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
            handler: wrapAction('chat.inbox', state),
        });
        toolCount++;

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
            handler: wrapAction('chat.history', state),
        });
        toolCount++;

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
            handler: wrapAction('chat.rooms.create', state),
        });
        toolCount++;

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
            handler: wrapAction('chat.rooms.send', state),
        });
        toolCount++;

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
            handler: wrapAction('chat.rooms.list', state),
        });
        toolCount++;

        // ── Tools: Coherence (Tier 4) ─────────────────────────────────

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
            handler: wrapAction('coherence.submitClaim', state),
        });
        toolCount++;

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
            handler: wrapAction('coherence.verifyClaim', state),
        });
        toolCount++;

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
            handler: wrapAction('coherence.listTasks', state),
        });
        toolCount++;

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
            handler: wrapAction('coherence.claimTask', state),
        });
        toolCount++;

        // ── Tools: Economics (Tier 5-6) ───────────────────────────────

        api.tools.register({
            name: 'alephnet_wallet_balance',
            description: 'Get AlephNet wallet balance, staked amount, and tier.',
            useOriginalName: true,
            parameters: { type: 'object', properties: {} },
            handler: wrapAction('wallet.balance', state),
        });
        toolCount++;

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
            handler: wrapAction('wallet.send', state),
        });
        toolCount++;

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
            handler: wrapAction('wallet.stake', state),
        });
        toolCount++;

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
            handler: wrapAction('wallet.history', state),
        });
        toolCount++;

        // ── Tools: Network ────────────────────────────────────────────

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
                if (!state.skillAvailable) return { error: SKILL_UNAVAILABLE_MSG };
                const result = await wrapAction('connect', state)(args);
                if (result && !result.error) setConnected(true);
                return result;
            },
        });
        toolCount++;

        api.tools.register({
            name: 'alephnet_status',
            description: 'Get current AlephNet node status including all subsystem metrics.',
            useOriginalName: true,
            parameters: { type: 'object', properties: {} },
            handler: wrapAction('status', state),
        });
        toolCount++;

        // ── WebSocket Handlers ────────────────────────────────────────

        api.ws.register('alephnet:connect', safeWsHandler(async (data) => {
            const result = await callAction('connect', data || {});
            if (result && !result.error) setConnected(true);
            return result;
        }, state));
        wsHandlerCount++;

        api.ws.register('alephnet:disconnect', async () => {
            if (!state.skillAvailable) {
                setConnected(false);
                return { error: SKILL_UNAVAILABLE_MSG };
            }
            try {
                const result = await callAction('disconnect', {});
                return result;
            } catch (err) {
                return { error: err.message };
            } finally {
                setConnected(false);
            }
        });
        wsHandlerCount++;

        api.ws.register('alephnet:status', safeWsHandler(async () => {
            const status = await callAction('status', {});
            return { ...status, connected: isConnected() };
        }, state));
        wsHandlerCount++;

        api.ws.register('alephnet:profile', safeWsHandler(async (data) => {
            if (data && (data.displayName || data.bio || data.visibility)) {
                return await callAction('profile.update', data);
            }
            return await callAction('profile.get', data || {});
        }, state));
        wsHandlerCount++;

        api.ws.register('alephnet:friends', safeWsHandler(async (data) => {
            return await callAction('friends.list', data || {});
        }, state));
        wsHandlerCount++;

        api.ws.register('alephnet:chat:send', safeWsHandler(async (data) => {
            if (!data?.userId || !data?.message) {
                return { error: 'userId and message are required' };
            }
            return await callAction('chat.send', data);
        }, state));
        wsHandlerCount++;

        api.ws.register('alephnet:chat:inbox', safeWsHandler(async (data) => {
            return await callAction('chat.inbox', data || {});
        }, state));
        wsHandlerCount++;

        api.ws.register('alephnet:chat:history', safeWsHandler(async (data) => {
            return await callAction('chat.history', data || {});
        }, state));
        wsHandlerCount++;

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
        }, state));
        wsHandlerCount++;

        api.ws.register('alephnet:coherence:list', safeWsHandler(async (data) => {
            return await callAction('coherence.listTasks', data || {});
        }, state));
        wsHandlerCount++;

        api.ws.register('alephnet:memory:query', safeWsHandler(async (data) => {
            return await callAction('recall', data || {});
        }, state));
        wsHandlerCount++;

        api.ws.register('alephnet:memory:store', safeWsHandler(async (data) => {
            return await callAction('remember', data || {});
        }, state));
        wsHandlerCount++;

        // ── Identity handler — combines profile + identity info for the UI ──
        api.ws.register('alephnet:identity', safeWsHandler(async () => {
            const [profile, status] = await Promise.all([
                callAction('profile.get', {}).catch(() => null),
                callAction('status', {}).catch(() => null),
            ]);
            let publicKey = null;
            try {
                const keyResult = await callAction('identity.publicKey', {});
                publicKey = keyResult?.publicKey || keyResult?.key || null;
            } catch { /* identity actions may not exist in all skill versions */ }
            return {
                nodeId: status?.nodeId || null,
                displayName: profile?.displayName || state.settings.displayName || null,
                bio: profile?.bio || state.settings.bio || null,
                tier: status?.wallet?.tier || 'Unknown',
                publicKey,
                connected: isConnected(),
                peers: status?.peers ?? 0,
                balance: status?.wallet?.balance ?? 0,
                friends: status?.social?.friends ?? 0,
                uptime: status?.uptime ?? 0,
            };
        }, state));
        wsHandlerCount++;

    } catch (err) {
        consoleStyler.log('error', `[AlephNet] Tool/handler registration failed after ${toolCount} tools, ${wsHandlerCount} WS handlers: ${err.message}`);
    }

    // ── Phase 2: Settings Handler Registration ────────────────────────
    try {
        const { pluginSettings: settings } = await registerSettingsHandlers(
            api, 'alephnet', DEFAULT_SETTINGS, SETTINGS_SCHEMA,
            (_newSettings, mergedSettings) => {
                state.settings = mergedSettings;
            }
        );
        state.settings = settings;
    } catch (err) {
        consoleStyler.log('warn', `[AlephNet] Settings handler registration failed: ${err.message} — using defaults`);
        state.settings = { ...DEFAULT_SETTINGS };
    }

    // ── Phase 3: Bridge / Skill Loading ───────────────────────────────
    try {
        if (isAvailable()) {
            state.skillAvailable = true;
            consoleStyler.log('plugin', '[AlephNet] Skill loaded and available');
        } else {
            state.skillAvailable = false;
            consoleStyler.log('warn', '[AlephNet] Skill not available (offline mode)');
        }
    } catch (err) {
        state.skillAvailable = false;
        consoleStyler.log('warn', `[AlephNet] Skill not available (offline mode): ${err.message}`);
    }

    // ── System Events ─────────────────────────────────────────────────

    // Auto-remember conversation messages if setting enabled
    api.events.onSystem('chat:message', async (msg) => {
        if (state.settings?.autoRemember && msg?.content && state.skillAvailable && isConnected()) {
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

    // ── Auto-connect ──────────────────────────────────────────────────

    if (state.settings.autoConnect && state.skillAvailable) {
        try {
            const result = await callAction('connect', {});
            if (result && !result.error) {
                setConnected(true);
                consoleStyler.log('plugin', `[AlephNet] Auto-connected as ${result.nodeId}`);

                // Update profile if settings have display name/bio
                if (state.settings.displayName || state.settings.bio) {
                    const profileUpdate = {};
                    if (state.settings.displayName) profileUpdate.displayName = state.settings.displayName;
                    if (state.settings.bio) profileUpdate.bio = state.settings.bio;
                    await callAction('profile.update', profileUpdate);
                }
            }
        } catch (err) {
            consoleStyler.log('warn', `[AlephNet] Auto-connect failed: ${err.message}`);
        }
    }

    // ── Periodic status broadcast ─────────────────────────────────────

    state.statusInterval = setInterval(broadcastStatus(api, state), 30_000);

    consoleStyler.log('plugin', `[AlephNet] Activated successfully with ${toolCount} tools (skill: ${state.skillAvailable ? 'available' : 'unavailable'})`);
}

// ── Deactivate ───────────────────────────────────────────────────────────────

export async function deactivate(api) {
    const state = api.getInstance();
    if (state) {
        if (state.statusInterval) clearInterval(state.statusInterval);

        // Disconnect from network gracefully
        if (state.skillAvailable && isConnected()) {
            try {
                await callAction('disconnect', {});
                setConnected(false);
            } catch {
                // Ignore disconnect errors during deactivation
            }
        } else {
            setConnected(false);
        }

        state.skillAvailable = false;
    }

    api.setInstance(null);
    consoleStyler.log('plugin', '[AlephNet] Deactivated');
}
