import { wsSend } from '../../lib/ws-utils.mjs';

/**
 * Handles: set-ui-theme, set-ui-tokens, reset-ui-style, get-ui-style-state
 *
 * These WS message types are now handled by the ui-themes plugin which
 * registers its own WS handlers (plugin:ui-themes:set-ui-theme, etc.).
 *
 * The handlers below are thin forwarding stubs for backward compatibility
 * with older UI clients that may still send the unprefixed message types.
 * They delegate to the plugin's registered WS handlers by re-dispatching
 * with the prefixed type through the WsDispatcher.
 *
 * IMPORTANT: These stubs must NOT go through toolExecutor.executeTool()
 * because that emits tool-call-start/end events which the UI renders as
 * tool call notifications in the chat. Theme/style changes from the
 * status bar should be completely silent.
 */

/**
 * Forward a message to the plugin's prefixed WS handler via the dispatcher.
 * Falls back to a no-op if the plugin handler is not registered.
 */
async function forwardToPlugin(data, ctx, pluginType) {
    const { dispatcher } = ctx;
    if (!dispatcher) return false;

    // Re-dispatch with the plugin-prefixed type
    const prefixedData = { ...data, type: pluginType };
    return await dispatcher.dispatch(prefixedData, ctx);
}

async function handleSetUITheme(data, ctx) {
    const handled = await forwardToPlugin(data, ctx, 'plugin:ui-themes:set-ui-theme');
    if (!handled) {
        wsSend(ctx.ws, 'error', { message: 'Theme plugin not available' });
    }
}

async function handleSetUITokens(data, ctx) {
    const handled = await forwardToPlugin(data, ctx, 'plugin:ui-themes:set-ui-tokens');
    if (!handled) {
        wsSend(ctx.ws, 'error', { message: 'Theme plugin not available' });
    }
}

async function handleResetUIStyle(data, ctx) {
    const handled = await forwardToPlugin(data, ctx, 'plugin:ui-themes:reset-ui-style');
    if (!handled) {
        wsSend(ctx.ws, 'error', { message: 'Theme plugin not available' });
    }
}

async function handleGetUIStyleState(data, ctx) {
    const handled = await forwardToPlugin(data, ctx, 'plugin:ui-themes:get-ui-style-state');
    if (!handled) {
        wsSend(ctx.ws, 'error', { message: 'Theme plugin not available' });
    }
}

export const handlers = {
    'set-ui-theme': handleSetUITheme,
    'set-ui-tokens': handleSetUITokens,
    'reset-ui-style': handleResetUIStyle,
    'get-ui-style-state': handleGetUIStyleState
};
