// ==========================================
// AGENT LOOP ORCHESTRATION (via @sschepis/lmscript)
// ==========================================

import { MAX_CONTEXT_TURNS, DEFAULT_MODEL, buildSystemPrompt, buildAgentFunction } from './config.js';
import { executeFunction } from './api.js';
import { executeCommand } from './executor.js';
import { mountSourceInVFS, AGENT_PROJECT_ROOT, AGENT_SOURCE_DIR, getSourceManifest, invalidateModuleCache } from './self-awareness.js';

/**
 * AgentRunner decouples the agent's autonomous loop from any UI framework.
 * It uses @sschepis/lmscript for structured LLM calls with Zod-validated output.
 *
 * Usage:
 *   const runner = new AgentRunner({ vfs, voluntaryMem, involuntaryMem, persona });
 *   runner.onHistoryUpdate = (history) => { ... };
 *   runner.onFinished = () => { ... };
 *   runner.onError = (err) => { ... };
 *   runner.onRestart = (reason, history) => { ... };
 *   runner.start(history);
 *   runner.stop();
 */
export class AgentRunner {
  constructor({ vfs, voluntaryMem, involuntaryMem, persona, options = {} }) {
    this.vfs = vfs;
    this.voluntaryMem = voluntaryMem;
    this.involuntaryMem = involuntaryMem;
    this.persona = persona;
    this.model = options.model ?? DEFAULT_MODEL;

    this.running = false;
    this._restartPending = false;

    // Callbacks — set by the consumer (e.g. React component)
    this.onHistoryUpdate = null;
    this.onFinished = null;
    this.onError = null;
    /** Called when the agent requests a self-restart. Receives (reason, currentHistory). */
    this.onRestart = null;

    // Mount the agent's own source code into the VFS on construction
    this._mountSelfAwareness();
  }

  // ---- Mount agent source code into VFS ----
  _mountSelfAwareness() {
    try {
      mountSourceInVFS(this.vfs);
    } catch (err) {
      console.warn('[AgentRunner] Failed to mount self-awareness into VFS:', err.message);
    }
  }

  // ---- Build self-awareness info string for the system prompt ----
  _buildSelfInfo() {
    try {
      const manifest = getSourceManifest();
      const fileList = manifest
        .filter(f => f.relativePath.startsWith('src/agent/'))
        .map(f => `  ${f.relativePath} (${f.size} bytes)`)
        .join('\n');

      return [
        `Your source code is located at: ${AGENT_PROJECT_ROOT}`,
        `Your agent modules directory: ${AGENT_SOURCE_DIR}`,
        `Your source code is also mirrored in the VFS at /sys/self/`,
        ``,
        `Your core source files:`,
        fileList,
        ``,
        `Total project files: ${manifest.length}`,
      ].join('\n');
    } catch {
      return '(Self-awareness info could not be loaded.)';
    }
  }

  // ---- Build conversation context string for the LScriptFunction prompt ----
  buildConversationContext(fullHistory) {
    let entries = fullHistory.map(h => {
      if (h.type === 'user') return `[USER INSTRUCTION]\n${h.content}`;
      if (h.type === 'agent') return `[AGENT RESPONSE]\n${JSON.stringify({ reflection: h.reflection, reasoning: h.reasoning, commands: h.commands })}`;
      if (h.type === 'system') return `[SYSTEM FEEDBACK]\n${h.error ? 'ERROR: ' + h.error : 'OUTPUT: ' + h.output}`;
      return null;
    }).filter(Boolean);

    if (entries.length > MAX_CONTEXT_TURNS) {
      const start = entries.slice(0, 2);
      const end = entries.slice(-(MAX_CONTEXT_TURNS - 3));
      entries = [...start, '[SYSTEM NOTE: Older context truncated for efficiency. Rely on voluntary memory.]', ...end];
    }

    return entries.join('\n\n');
  }

  // ---- Handle self-restart request ----
  async _handleRestart(reason, currentHistory) {
    this.running = false;
    this._restartPending = true;

    // Invalidate module caches so re-import picks up changes
    invalidateModuleCache();

    // Add a system message about the restart
    const restartMsg = { type: 'system', output: `[SELF-RESTART] Agent restarting: ${reason}` };
    currentHistory = [...currentHistory, restartMsg];
    this.onHistoryUpdate?.(currentHistory);

    // Notify consumer (e.g. UI) about the restart
    if (this.onRestart) {
      this.onRestart(reason, currentHistory);
    } else {
      // Default behavior: wait briefly and re-start the loop
      await new Promise(r => setTimeout(r, 1000));
      this._restartPending = false;

      // Re-mount self-awareness (picks up any file changes)
      this._mountSelfAwareness();

      // Re-start the agent loop
      this.start(currentHistory);
    }
  }

  // ---- Main Agent Loop ----
  async start(initialHistory) {
    this.running = true;
    this._restartPending = false;
    let currentHistory = initialHistory;
    const lastUserTask = [...currentHistory].reverse().find(m => m.type === 'user')?.content || "";

    // Build self-awareness info once per run
    const selfInfo = this._buildSelfInfo();

    while (this.running) {
      try {
        // Build dynamic system prompt with recalled memories and self-awareness
        const recalledMemories = await this.involuntaryMem.associate(lastUserTask);
        const autoRecallText = recalledMemories.map(m => `* ${m.text}`).join('\n');
        const dynamicSystemPrompt = buildSystemPrompt(this.persona, autoRecallText, selfInfo);

        // Build the LScriptFunction for this turn
        const agentFn = buildAgentFunction(dynamicSystemPrompt, this.model);

        // Build conversation context as the prompt input
        const conversationContext = this.buildConversationContext(currentHistory);

        // Call LLM via lmscript (structured, Zod-validated, with retries)
        const responseJson = await executeFunction(agentFn, conversationContext);

        const agentMsg = {
          type: 'agent',
          reflection: responseJson.reflection,
          reasoning: responseJson.reasoning,
          commands: responseJson.commands
        };
        currentHistory = [...currentHistory, agentMsg];
        this.onHistoryUpdate?.(currentHistory);

        this.involuntaryMem.add(`Agent Reflection: ${responseJson.reflection} | Planned ${responseJson.commands.length} commands.`);

        if (!this.running) break;

        // Batch Command Execution
        let batchOutput = "";
        let hasFinished = false;
        let restartRequested = false;
        let restartReason = '';

        for (let i = 0; i < responseJson.commands.length; i++) {
          const cmd = responseJson.commands[i];
          const cmdResult = await executeCommand(cmd, this.vfs, this.voluntaryMem, this.involuntaryMem);

          batchOutput += `\n--- [Command ${i + 1}: ${cmd.split(' ')[0]}] ---\n`;
          batchOutput += cmdResult.error ? `ERROR: ${cmdResult.error}\n` : `OUTPUT: ${cmdResult.result}\n`;

          if (cmdResult.isFinished) { hasFinished = true; break; }
          if (cmdResult.isRestart) {
            restartRequested = true;
            restartReason = cmdResult.reason || 'Self-modification applied';
            break;
          }
        }

        const systemMsg = { type: 'system', output: batchOutput.trim() };
        currentHistory = [...currentHistory, systemMsg];
        this.onHistoryUpdate?.(currentHistory);

        this.involuntaryMem.add(`Batch Execution Complete. Outcomes logged.`);

        if (restartRequested) {
          await this._handleRestart(restartReason, currentHistory);
          return; // Exit current loop; _handleRestart will re-enter start() if needed
        }

        if (hasFinished) {
          this.running = false;
          this.onFinished?.();
          break;
        }

        await new Promise(r => setTimeout(r, 800));

      } catch (err) {
        currentHistory = [...currentHistory, { type: 'system', error: err.message }];
        this.onHistoryUpdate?.(currentHistory);
        this.running = false;
        this.onError?.(err);
        break;
      }
    }
  }

  stop() {
    this.running = false;
  }
}
