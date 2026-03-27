// ==========================================
// AGENT LOOP ORCHESTRATION (via @sschepis/lmscript)
// ==========================================

import { MAX_CONTEXT_TURNS, DEFAULT_MODEL, buildSystemPrompt, buildAgentFunction } from './config.mjs';
import { executeFunction } from './api.mjs';
import { executeCommand } from './executor.mjs';
import { mountSourceInVFS, AGENT_PROJECT_ROOT, AGENT_SOURCE_DIR, getSourceManifest, invalidateModuleCache } from './self-awareness.mjs';

// ════════════════════════════════════════════════════════════════════════
// Constants — safety & doom detection defaults
// ════════════════════════════════════════════════════════════════════════

/** Hard ceiling on loop iterations to prevent infinite runs. */
const DEFAULT_MAX_ITERATIONS = 50;

/** Consecutive identical command batches before declaring doom. */
const DEFAULT_DOOM_THRESHOLD = 3;

/** Sliding window size for doom detection. */
const DEFAULT_DOOM_WINDOW = 8;

/**
 * AgentRunner decouples the agent's autonomous loop from any UI framework.
 * It uses @sschepis/lmscript for structured LLM calls with Zod-validated output.
 *
 * Features:
 *  - Streaming: emits tokens/commentary to the UI via onStream callback
 *  - Tool bridge: optional external tool executor for ai-man tools
 *  - Safety/Doom: iteration cap + repeated-command detection
 *  - Context compaction: LLM-based summarization when context overflows
 *
 * Usage:
 *   const runner = new AgentRunner({ vfs, voluntaryMem, involuntaryMem, persona });
 *   runner.onHistoryUpdate = (history) => { ... };
 *   runner.onFinished = () => { ... };
 *   runner.onError = (err) => { ... };
 *   runner.onStream = (text) => { ... };
 *   runner.start(history);
 *   runner.stop();
 */
export class AgentRunner {
  constructor({ vfs, voluntaryMem, involuntaryMem, persona, memoryBridge, options = {} }) {
    this.vfs = vfs;
    this.voluntaryMem = voluntaryMem;
    this.involuntaryMem = involuntaryMem;
    this.persona = persona;

    // ── Unified Memory Bridge (Fix 6) ──────────────────────────────
    /** @type {import('./memory-bridge.mjs').MemoryBridge|null} */
    this.memoryBridge = memoryBridge ?? null;

    this.running = false;
    this._restartPending = false;

    // ── Safety limits ──────────────────────────────────────────────
    this.maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.doomThreshold = options.doomThreshold ?? DEFAULT_DOOM_THRESHOLD;
    this.doomWindowSize = options.doomWindowSize ?? DEFAULT_DOOM_WINDOW;

    // ── External tool executor (ai-man ToolExecutor) ───────────────
    /** @type {Object|null} — if set, 'tool' command delegates to this */
    this.externalToolExecutor = options.externalToolExecutor ?? null;

    // ── Compaction ─────────────────────────────────────────────────
    /** @type {Function|null} — async (historyText) => summaryText */
    this.compactionFn = options.compactionFn ?? null;

    // ── Pre-routed context (injected by provider before first LLM call) ──
    /** @type {string|null} — additional context text from pre-routing */
    this.preRoutedContext = options.preRoutedContext ?? null;

    // ── Additional system context (learning hints, strategy, etc.) ──
    /** @type {string|null} — appended to system prompt */
    this.additionalSystemContext = options.additionalSystemContext ?? null;

    // ── System prompt override (composable prompt from provider) ──
    /** @type {string|null} — when set, replaces buildSystemPrompt() entirely */
    this.systemPromptOverride = options.systemPromptOverride ?? null;

    // ── Model selection ───────────────────────────────────────────
    /** @type {string} — effective LLM model for lmscript calls */
    this.model = options.model ?? DEFAULT_MODEL;

    // Callbacks — set by the consumer
    this.onHistoryUpdate = null;
    this.onFinished = null;
    this.onError = null;
    /** @type {Function|null} — (text: string) => void — streaming output */
    this.onStream = null;
    /** @type {Function|null} — (reason: string, history: Array) => void — self-restart */
    this.onRestart = null;

    // ── Internal state for doom detection ──────────────────────────
    /** @private */
    this._recentCommandHashes = [];

    // ── Self-awareness: mount source code into VFS ─────────────────
    this._mountSelfAwareness();
  }

  // ── Self-awareness helpers ─────────────────────────────────────────

  /** Mount the agent's own source code into the VFS. */
  _mountSelfAwareness() {
    try {
      mountSourceInVFS(this.vfs);
    } catch (err) {
      console.warn('[AgentRunner] Failed to mount self-awareness into VFS:', err.message);
    }
  }

  /** Build a self-awareness info string for the system prompt. */
  _buildSelfInfo() {
    try {
      const manifest = getSourceManifest();
      const fileList = manifest
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

  /** Handle a self-restart request from the agent. */
  async _handleRestart(reason, currentHistory) {
    this.running = false;
    this._restartPending = true;

    invalidateModuleCache();

    const restartMsg = { type: 'system', output: `[SELF-RESTART] Agent restarting: ${reason}` };
    currentHistory = [...currentHistory, restartMsg];
    this.onHistoryUpdate?.(currentHistory);
    this._emit(`🔄 Self-restart: ${reason}`);

    if (this.onRestart) {
      this.onRestart(reason, currentHistory);
    } else {
      // Default: wait briefly then re-start
      await new Promise(r => setTimeout(r, 1000));
      this._restartPending = false;
      this._mountSelfAwareness();
      this.start(currentHistory);
    }
  }

  // ── Streaming helper ──────────────────────────────────────────────
  /** Emit streaming text to the consumer if a callback is set. */
  _emit(text) {
    if (this.onStream && text) this.onStream(text);
  }

  // ── Doom detection helpers ────────────────────────────────────────
  /**
   * Hash a command batch for doom detection.
   * @param {string[]} commands
   * @returns {string}
   */
  _hashBatch(commands) {
    return commands.sort().join('||');
  }

  /**
   * Record a command batch and check for doom (repeated identical batches).
   * @param {string[]} commands
   * @returns {{ doomed: boolean, reason: string|null }}
   */
  _checkDoom(commands) {
    const hash = this._hashBatch(commands);
    this._recentCommandHashes.push(hash);
    if (this._recentCommandHashes.length > this.doomWindowSize) {
      this._recentCommandHashes.shift();
    }

    // Count consecutive identical hashes from the tail
    let consecutive = 0;
    for (let i = this._recentCommandHashes.length - 1; i >= 0; i--) {
      if (this._recentCommandHashes[i] === hash) {
        consecutive++;
      } else {
        break;
      }
    }

    if (consecutive >= this.doomThreshold) {
      return {
        doomed: true,
        reason: `Detected doom loop: identical command batch repeated ${consecutive} times`,
      };
    }

    return { doomed: false, reason: null };
  }

  // ── Build conversation context string ─────────────────────────────
  async buildConversationContext(fullHistory) {
    // Tag each entry with its original index and type for priority-aware truncation
    let tagged = fullHistory.map((h, idx) => {
      let text;
      if (h.type === 'user') text = `[USER INSTRUCTION]\n${h.content}`;
      else if (h.type === 'agent') text = `[AGENT RESPONSE]\n${JSON.stringify({ reflection: h.reflection, reasoning: h.reasoning, commands: h.commands })}`;
      else if (h.type === 'system') text = `[SYSTEM FEEDBACK]\n${h.error ? 'ERROR: ' + h.error : 'OUTPUT: ' + h.output}`;
      else return null;
      return { text, idx, type: h.type, hasError: !!(h.error), hasOutput: !!(h.output) };
    }).filter(Boolean);

    if (tagged.length > MAX_CONTEXT_TURNS) {
      // Context compaction: use LLM summarization if available, else priority-aware truncation
      if (this.compactionFn) {
        try {
          const oldEntries = tagged.slice(0, tagged.length - (MAX_CONTEXT_TURNS - 3));
          const oldText = oldEntries.map(e => e.text).join('\n\n');
          const summary = await this.compactionFn(oldText);
          const recentEntries = tagged.slice(-(MAX_CONTEXT_TURNS - 3));
          tagged = [
            { text: `[SYSTEM NOTE: Compacted context summary]\n${summary}`, idx: -1, type: 'system', hasError: false, hasOutput: false },
            ...recentEntries,
          ];
          this._emit('📋 Context compacted via LLM summarization');
        } catch (e) {
          tagged = this._priorityTruncate(tagged);
        }
      } else {
        tagged = this._priorityTruncate(tagged);
      }
    }

    return tagged.map(e => e.text).join('\n\n');
  }

  /**
   * Priority-aware truncation: always preserves first user message,
   * error entries (learning from mistakes), entries with tool output,
   * and the most recent entries. Generic reflections are dropped first.
   * @param {Array} tagged - tagged history entries
   * @returns {Array} truncated entries
   */
  _priorityTruncate(tagged) {
    const KEEP_RECENT = 5;
    const firstUserIdx = tagged.findIndex(e => e.type === 'user');
    const recentStart = Math.max(0, tagged.length - KEEP_RECENT);

    // Always keep: first user message, last KEEP_RECENT entries
    const alwaysKeep = new Set();
    if (firstUserIdx >= 0) alwaysKeep.add(firstUserIdx);
    for (let i = recentStart; i < tagged.length; i++) alwaysKeep.add(i);

    // Middle entries: prioritize errors and tool output over generic reflections
    const middle = [];
    for (let i = 0; i < tagged.length; i++) {
      if (alwaysKeep.has(i)) continue;
      middle.push({ ...tagged[i], originalIdx: i });
    }

    // Score middle entries: errors=3, system output=2, user=2, agent reflection=1
    middle.forEach(e => {
      e.priority = 1;
      if (e.hasError) e.priority = 3;
      else if (e.type === 'system' && e.hasOutput) e.priority = 2;
      else if (e.type === 'user') e.priority = 2;
    });
    middle.sort((a, b) => b.priority - a.priority);

    // Keep as many high-priority middle entries as fit within MAX_CONTEXT_TURNS
    const budget = MAX_CONTEXT_TURNS - alwaysKeep.size - 1; // -1 for truncation note
    const keptMiddle = middle.slice(0, Math.max(0, budget));
    const keptMiddleIndices = new Set(keptMiddle.map(e => e.originalIdx));

    // Rebuild in original order
    const result = [];
    let truncationNoteInserted = false;
    for (let i = 0; i < tagged.length; i++) {
      if (alwaysKeep.has(i)) {
        result.push(tagged[i]);
      } else if (keptMiddleIndices.has(i)) {
        result.push(tagged[i]);
      } else if (!truncationNoteInserted) {
        result.push({ text: '[SYSTEM NOTE: Lower-priority context entries truncated. Rely on memory recall.]', idx: -1, type: 'system', hasError: false, hasOutput: false });
        truncationNoteInserted = true;
      }
    }
    return result;
  }

  // ── External tool execution ───────────────────────────────────────
  /**
   * Execute a command through the external ai-man ToolExecutor.
   * @param {string} toolName
   * @param {Object} args
   * @returns {Promise<{result?: string, error?: string}>}
   */
  async _executeExternalTool(toolName, args) {
    if (!this.externalToolExecutor) {
      return { error: 'No external tool executor configured' };
    }
    try {
      if (typeof this.externalToolExecutor.execute === 'function') {
        const result = await this.externalToolExecutor.execute(toolName, args);
        return { result: typeof result === 'string' ? result : JSON.stringify(result) };
      }

      if (typeof this.externalToolExecutor.executeTool === 'function') {
        const toolCall = {
          id: `newagent_${Date.now()}_${toolName}`,
          function: {
            name: toolName,
            arguments: JSON.stringify(args || {}),
          },
        };
        const result = await this.externalToolExecutor.executeTool(toolCall);
        return {
          result: typeof result?.content === 'string'
            ? result.content
            : (typeof result === 'string' ? result : JSON.stringify(result)),
        };
      }

      return { error: 'External tool executor does not implement execute() or executeTool()' };
    } catch (err) {
      return { error: `External tool error: ${err.message}` };
    }
  }

  // ── Main Agent Loop ──────────────────────────────────────────────
  async start(initialHistory) {
    this.running = true;
    this._restartPending = false;
    this._recentCommandHashes = [];
    let currentHistory = initialHistory;
    let iteration = 0;

    // Build self-awareness info once per run
    const selfInfo = this._buildSelfInfo();

    this._emit('🚀 Agent loop started');

    while (this.running) {
      iteration++;

      // ── Safety: iteration ceiling ───────────────────────────────
      if (iteration > this.maxIterations) {
        const msg = `Reached maximum iteration limit (${this.maxIterations})`;
        this._emit(`🛑 ${msg}`);
        currentHistory = [...currentHistory, { type: 'system', error: msg }];
        this.onHistoryUpdate?.(currentHistory);
        this.running = false;
        this.onFinished?.();
        break;
      }

      try {
        this._emit(`🧠 Thinking... (iteration ${iteration})`);

        // Build dynamic recall query from latest context (Fix 2)
        const lastUser = [...currentHistory].reverse().find(m => m.type === 'user')?.content || '';
        const lastReflection = [...currentHistory].reverse().find(m => m.type === 'agent')?.reflection || '';
        const lastOutput = [...currentHistory].reverse().find(m => m.type === 'system' && m.output)?.output || '';
        const recallQuery = `${lastUser} ${lastReflection} ${lastOutput}`.trim().substring(0, 500);

        // Build dynamic system prompt with recalled memories
        let dynamicSystemPrompt;
        if (this.systemPromptOverride) {
          dynamicSystemPrompt = this.systemPromptOverride;
        } else {
          let autoRecallText;

          // Fix 6: Use unified MemoryBridge for recall if available
          if (this.memoryBridge) {
            try {
              const bridgeResult = await this.memoryBridge.recall(recallQuery, 10);
              autoRecallText = bridgeResult.formatted || '';
            } catch (err) {
              console.warn('[AgentRunner] MemoryBridge recall failed, falling back:', err.message);
              autoRecallText = null; // trigger fallback below
            }
          }

          // Fallback: query involuntary + voluntary directly (Fix 5 behavior)
          if (autoRecallText == null) {
            const recalledInvoluntary = await this.involuntaryMem.associate(recallQuery);
            const recalledVoluntary = await this.voluntaryMem.associate(recallQuery, 3);
            autoRecallText = [
              ...recalledInvoluntary.map(m => `* [auto] ${m.text}`),
              ...recalledVoluntary.map(m => `* [stored] ${m.text}`),
            ].join('\n');
          }

          dynamicSystemPrompt = buildSystemPrompt(this.persona, autoRecallText, selfInfo);
        }

        // Append additional system context (learning hints, strategy, etc.)
        if (this.additionalSystemContext) {
          dynamicSystemPrompt += '\n\n' + this.additionalSystemContext;
        }

        // Build the LScriptFunction for this turn
        const agentFn = buildAgentFunction(dynamicSystemPrompt, this.model);

        // Build conversation context (with compaction support)
        let conversationContext = await this.buildConversationContext(currentHistory);

        // Inject pre-routed context on first iteration only
        if (iteration === 1 && this.preRoutedContext) {
          conversationContext = `[PRE-ROUTED CONTEXT]\n${this.preRoutedContext}\n\n${conversationContext}`;
        }

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

        // Stream the agent's reasoning
        if (responseJson.reflection) {
          this._emit(`💭 ${responseJson.reflection}`);
        }
        if (responseJson.reasoning) {
          this._emit(`📝 ${responseJson.reasoning}`);
        }

        // Only store reflections that contain substantive content (>50 chars, not repetitive) (Fix 3)
        if (responseJson.reflection && responseJson.reflection.length > 50) {
          const commandSummary = responseJson.commands.slice(0, 3).map(c => c.split(' ')[0]).join(', ');
          this.involuntaryMem.add(
            `[Turn ${iteration}] Reflection: ${responseJson.reflection.substring(0, 300)} | Commands: ${commandSummary}`
          );
        }

        if (!this.running) break;

        // ── Safety: doom detection ──────────────────────────────────
        if (responseJson.commands.length > 0) {
          const doom = this._checkDoom(responseJson.commands);
          if (doom.doomed) {
            this._emit(`🚨 ${doom.reason}`);
            currentHistory = [...currentHistory, { type: 'system', error: doom.reason }];
            this.onHistoryUpdate?.(currentHistory);
            this.running = false;
            this.onFinished?.();
            break;
          }
        }

        // Batch Command Execution
        let batchOutput = "";
        let hasFinished = false;
        let restartRequested = false;
        let restartReason = '';

        this._emit(`🔧 Executing ${responseJson.commands.length} command(s)...`);

        for (let i = 0; i < responseJson.commands.length; i++) {
          const cmd = responseJson.commands[i];
          this._emit(`  ▸ ${cmd.split(' ')[0]} (${i + 1}/${responseJson.commands.length})`);

          let cmdResult;

          // Check if this is an external tool command (prefixed with 'tool ')
          if (cmd.startsWith('tool ') && this.externalToolExecutor) {
            const toolParts = cmd.substring(5).trim().split(/\s+/);
            const toolName = toolParts[0];
            let toolArgs = {};
            try {
              toolArgs = JSON.parse(toolParts.slice(1).join(' ') || '{}');
            } catch {
              toolArgs = { input: toolParts.slice(1).join(' ') };
            }
            cmdResult = await this._executeExternalTool(toolName, toolArgs);
          } else {
            cmdResult = await executeCommand(cmd, this.vfs, this.voluntaryMem, this.involuntaryMem);
          }

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

        // Store meaningful outcome data, not generic "complete" message (Fix 3)
        const outcomeSnippet = batchOutput.substring(0, 400).replace(/\n+/g, ' ');
        if (outcomeSnippet.length > 20) {
          this.involuntaryMem.add(`[Turn ${iteration} Result] ${outcomeSnippet}`);
        }

        if (restartRequested) {
          await this._handleRestart(restartReason, currentHistory);
          return; // Exit current loop; _handleRestart will re-enter start() if needed
        }

        if (hasFinished) {
          this._emit('✅ Agent finished');
          this.running = false;
          this.onFinished?.();
          break;
        }

        await new Promise(r => setTimeout(r, 800));

      } catch (err) {
        this._emit(`⚠️ Error: ${err.message}`);
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
