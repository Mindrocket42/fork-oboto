import { consoleStyler } from '../../ui/console-styler.mjs';

/**
 * Re-initialize the plugin system after a workspace switch.
 *
 * Shared helper used by settings-handler, workspace-handler, and any
 * future handler that needs to reinit plugins on workspace change.
 *
 * @param {object} assistant — the EventicFacade instance
 * @param {object} ctx — WS handler context (must contain `.dispatcher`)
 * @param {Function} broadcast — (type, payload) => void
 * @param {string} [newWorkingDir] — the new workspace directory
 */
export async function reinitPlugins(assistant, ctx, broadcast, newWorkingDir) {
    if (!assistant.pluginManager) return;
    try {
        assistant.pluginManager.setWsDispatcher(ctx.dispatcher || null);
        assistant.pluginManager.setBroadcast(broadcast);
        await assistant.pluginManager.reinitialize({
            workingDir: newWorkingDir || assistant.workingDir
        });
        broadcast('plugin:list', { plugins: assistant.pluginManager.listPlugins() });
        broadcast('plugin:ui-manifest', assistant.pluginManager.getAllUIComponents());
    } catch (e) {
        consoleStyler.log('warning', `Plugin re-initialization after workspace switch failed: ${e.message}`);
    }
}

/**
 * Ensure there is a healthy agentic provider after a workspace switch.
 *
 * Called from settings-handler, workspace-handler, and set-cwd handler
 * immediately after reinitPlugins(). If the currently active provider is
 * healthy, it is preserved. If there is no active provider or the active
 * provider is unhealthy, the helper falls back to "unified".
 *
 * @param {object} assistant — the EventicFacade instance
 */
export async function ensureUnifiedProvider(assistant) {
    try {
        const currentProvider = assistant.agenticRegistry?.getActive?.() || null;
        const currentHealth = currentProvider?.healthCheck
            ? await currentProvider.healthCheck()
            : { healthy: false, reason: 'No active provider instance' };

        if (currentProvider && currentHealth.healthy) {
            return;
        }

        if (currentProvider?.id !== 'unified') {
            await assistant.switchAgenticProvider('unified');
            consoleStyler.log('system', 'Agentic provider set to "unified" for new workspace');
        }
    } catch (e) {
        consoleStyler.log('warning', `Failed to switch agentic provider to unified: ${e.message}`);
    }
}
