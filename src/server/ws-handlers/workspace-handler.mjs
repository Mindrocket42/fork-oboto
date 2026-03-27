/**
 * WebSocket handler for workspace management.
 *
 * Supports:
 *   - workspace:switch   – switch the server to a new workspace directory
 *   - workspace:status   – request current workspace status
 *   - service:status     – request full service health report
 */

import fs from 'fs';
import path from 'path';
import { consoleStyler } from '../../ui/console-styler.mjs';
import { wsSend } from '../../lib/ws-utils.mjs';
import { migrateWorkspaceConfig } from '../../lib/migrate-config-dirs.mjs';
import { reinitPlugins, ensureUnifiedProvider } from './plugin-reinit.mjs';
import {
    getHistory,
    recordWorkspaceOpen,
    removeFromHistory,
    clearHistory,
} from '../../workspace/workspace-history.mjs';

/**
 * Switch the active workspace.  Re-initialises assistant, scheduler, and
 * agent-loop controller against the new directory.
 */
async function handleWorkspaceSwitch(data, ctx) {
    const { ws, assistant, broadcast, schedulerService, agentLoopController, secretsManager, workspaceContentServer } = ctx;
    const newPath = data.path;

    if (!newPath || typeof newPath !== 'string') {
        wsSend(ws, 'workspace:switched', { success: false, error: 'Missing or invalid path' });
        return;
    }

    const resolved = path.resolve(newPath);

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        wsSend(ws, 'workspace:switched', { success: false, error: `Directory does not exist: ${resolved}` });
        return;
    }

    try {
        consoleStyler.log('system', `🔄 Switching workspace to: ${resolved}`);

        // Migrate legacy .ai-man → .oboto in the new workspace if needed
        migrateWorkspaceConfig(resolved);

        if (agentLoopController) agentLoopController.stop();
        if (schedulerService) await schedulerService.switchWorkspace(resolved);

        if (secretsManager) {
            // Secrets are global (~/.oboto/.secrets.enc), so just reload
            // the existing instance rather than creating a throwaway new one.
            await secretsManager.load();
            secretsManager.applyToEnv();
        }

        assistant.workingDir = resolved;
        if (assistant.conversationManager) {
            assistant.conversationManager.workingDir = resolved;
        }
        await assistant.loadConversation();

        // Re-initialize plugin system for new workspace
        // (ui-themes plugin handles workspace-switch via its own
        // activate/deactivate lifecycle — no separate call needed)
        await reinitPlugins(assistant, ctx, broadcast, resolved);

        await ensureUnifiedProvider(assistant);

        if (workspaceContentServer) {
            try {
                await workspaceContentServer.start(resolved);
                broadcast('workspace:server-info', {
                    port: workspaceContentServer.getPort(),
                    sandboxMode: workspaceContentServer.getSurfaceSandboxMode?.() || 'strict',
                });
            } catch (e) {
                consoleStyler.log('error', `Failed to restart workspace content server: ${e.message}`);
            }
        }

        if (process.env.OBOTO_AUTO_ACTIVATE === 'true' && agentLoopController) {
            agentLoopController.play();
        }

        // Record this workspace in the folder history (fire-and-forget)
        recordWorkspaceOpen(resolved).catch(e =>
            consoleStyler.log('warning', `Failed to record workspace history: ${e.message}`)
        );

        consoleStyler.log('system', `✅ Workspace switched to: ${resolved}`);
        wsSend(ws, 'workspace:switched', { success: true, path: resolved });
        broadcastWorkspaceStatus(ctx);

    } catch (err) {
        consoleStyler.log('error', `Failed to switch workspace: ${err.message}`);
        wsSend(ws, 'workspace:switched', { success: false, error: err.message });
    }
}

/**
 * Return current workspace status to the requesting client.
 */
function handleWorkspaceStatus(_data, ctx) {
    const { ws } = ctx;
    wsSend(ws, 'workspace:status', buildWorkspaceStatus(ctx));
}

/**
 * Return full service health report.
 */
function handleServiceStatus(_data, ctx) {
    const { ws, assistant, schedulerService, agentLoopController } = ctx;

    wsSend(ws, 'service:status-response', {
        uptime: process.uptime(),
        pid: process.pid,
        nodeVersion: process.version,
        memoryUsage: process.memoryUsage(),
        workspace: assistant?.workingDir || process.cwd(),
        agentLoop: agentLoopController ? agentLoopController.getState() : null,
        schedules: schedulerService ? schedulerService.listSchedules('all').length : 0,
        schedulesActive: schedulerService ? schedulerService.listSchedules('active').length : 0,
    });
}

// ── Helpers ──────────────────────────────────────────────────────────────

function buildWorkspaceStatus(ctx) {
    const { assistant, schedulerService, agentLoopController } = ctx;
    return {
        path: assistant?.workingDir || process.cwd(),
        active: true,
        agentLoopState: agentLoopController ? agentLoopController.getState().state : 'unknown',
        schedules: schedulerService ? schedulerService.listSchedules('all').length : 0,
        schedulesActive: schedulerService ? schedulerService.listSchedules('active').length : 0,
    };
}

function broadcastWorkspaceStatus(ctx) {
    const { broadcast } = ctx;
    const status = buildWorkspaceStatus(ctx);
    broadcast('workspace:status', status);
}

// ── Workspace History Handlers ───────────────────────────────────────────

/**
 * Return the workspace folder history list to the requesting client.
 */
async function handleWorkspaceHistoryList(_data, ctx) {
    const { ws } = ctx;
    try {
        const history = await getHistory();
        wsSend(ws, 'workspace:history', { history });
    } catch (err) {
        consoleStyler.log('error', `Failed to get workspace history: ${err.message}`);
        wsSend(ws, 'workspace:history', { history: [], error: err.message });
    }
}

/**
 * Remove a single entry from workspace history.
 */
async function handleWorkspaceHistoryRemove(data, ctx) {
    const { ws } = ctx;
    const targetPath = data.payload?.path || data.path;
    if (!targetPath) {
        wsSend(ws, 'workspace:history', { history: [], error: 'Missing path' });
        return;
    }
    try {
        const history = await removeFromHistory(targetPath);
        wsSend(ws, 'workspace:history', { history });
    } catch (err) {
        consoleStyler.log('error', `Failed to remove workspace from history: ${err.message}`);
        wsSend(ws, 'workspace:history', { history: [], error: err.message });
    }
}

/**
 * Clear all workspace history.
 */
async function handleWorkspaceHistoryClear(_data, ctx) {
    const { ws } = ctx;
    try {
        const history = await clearHistory();
        wsSend(ws, 'workspace:history', { history });
    } catch (err) {
        consoleStyler.log('error', `Failed to clear workspace history: ${err.message}`);
        wsSend(ws, 'workspace:history', { history: [], error: err.message });
    }
}

// ── Export handler map ───────────────────────────────────────────────────

export const handlers = {
    'workspace:switch': handleWorkspaceSwitch,
    'workspace:status': handleWorkspaceStatus,
    'service:status': handleServiceStatus,
    'workspace:history-list': handleWorkspaceHistoryList,
    'workspace:history-remove': handleWorkspaceHistoryRemove,
    'workspace:history-clear': handleWorkspaceHistoryClear,
};
