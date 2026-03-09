/**
 * CognitiveAgent — orchestrator for the tinyaleph cognitive agentic system.
 *
 * Implements the 11-step cognitive agent loop via lmscript's LScriptRuntime
 * when available, with a legacy fallback for the hand-rolled agent loop:
 *
 *  1. PERCEIVE  — BoundaryLayer processes input
 *  2. ENCODE    — Map text to primes
 *  3. ORIENT    — SMF updates
 *  4. ATTEND    — AgencyLayer allocates attention
 *  5. GUARD     — Safety check
 *  6. RECALL    — Holographic memory retrieval
 *  7. THINK     — LLM generates response (via lmscript executeAgent)
 *  8. EXECUTE   — Tool calls (via lmscript agent loop)
 *  9. VALIDATE  — ObjectivityGate
 * 10. REMEMBER  — Store in holographic memory
 * 11. EVOLVE    — Tick physics
 *
 * When lmscript's LScriptRuntime is available (via initRuntime()), the agent
 * delegates LLM + tool orchestration to runtime.executeAgent().  The cognitive
 * middleware, tool bridge, and event-bus transport are injected separately.
 *
 * If the runtime is not initialised or throws, the agent falls back to the
 * legacy hand-rolled loop (_turnLegacy) so nothing breaks.
 *
 * @module src/core/agentic/cognitive/agent
 */

import { z } from 'zod';
import { CognitiveCore } from './cognitive.mjs';
import { resolveCognitiveConfig } from './config.mjs';
import { ActivityTracker } from '../../activity-tracker.mjs';
import { emitStatus } from '../../status-reporter.mjs';
import { isRetryableError, isCancellationError } from '../../ai-provider/utils.mjs';

/**
 * Zod schema for the lmscript agent's structured response.
 * executeAgent() forces JSON mode, so the LLM must emit an object
 * matching this schema.  We keep it minimal — a single `response` field.
 */
const AGENT_RESPONSE_SCHEMA = z.object({
  response: z.string().describe('Your complete response to the user'),
});

/**
 * @typedef {Object} CognitiveAgentDeps
 * @property {import('../../eventic-ai-plugin.mjs').EventicAIProvider} aiProvider
 * @property {import('../../../execution/tool-executor.mjs').ToolExecutor} toolExecutor
 * @property {import('../../history-manager.mjs').HistoryManager} historyManager
 * @property {import('events').EventEmitter} [eventBus]
 * @property {Object} [consciousness]
 * @property {string} workingDir
 * @property {Object} [engine]
 * @property {Object} [facade]
 */

class CognitiveAgent {
  /**
   * @param {CognitiveAgentDeps} deps - Injected dependencies from ai-man
   * @param {Object} userConfig - Partial configuration overrides
   */
  constructor(deps, userConfig = {}) {
    this.config = resolveCognitiveConfig(userConfig);

    // Store ai-man dependencies
    this.aiProvider = deps.aiProvider;
    this.toolExecutor = deps.toolExecutor;
    this.historyManager = deps.historyManager;
    this.eventBus = deps.eventBus;
    this.consciousness = deps.consciousness;
    this.workingDir = deps.workingDir;
    this.engine = deps.engine;
    this.facade = deps.facade;

    // Initialize cognitive core
    this.cognitive = new CognitiveCore(this.config.cognitive);

    // Activity tracker for periodic status heartbeat
    this._tracker = new ActivityTracker({ intervalMs: 3000 });

    // Conversation history (internal to this agent)
    this.history = [];
    this.maxHistory = this.config.agent.maxHistory;

    // System prompt — prefer the facade's dynamic prompt (which includes
    // skills, plugins, persona, surfaces, etc.) over the static default.
    // The aiProvider.systemPrompt is set by eventic-facade's updateSystemPrompt()
    // and loadConversation(), so it reflects the full dynamic context.
    this.systemPrompt = this.config.agent.systemPrompt;

    // Stats
    this.turnCount = 0;
    this.totalTokens = 0;

    // lmscript runtime components — populated via initRuntime()
    /** @type {import('@sschepis/lmscript').LScriptRuntime|null} */
    this._runtime = null;
    /** @type {import('./tool-bridge.mjs').ToolBridge|null} */
    this._toolBridge = null;
    /** @type {import('./cognitive-middleware.mjs').CognitiveMiddleware|null} */
    this._cognitiveMiddleware = null;
    /** @type {import('./eventbus-transport.mjs').EventBusTransport|null} */
    this._eventBusTransport = null;
  }

  // ════════════════════════════════════════════════════════════════════
  // lmscript Runtime Initialisation
  // ════════════════════════════════════════════════════════════════════

  /**
   * Inject pre-built lmscript runtime components.
   * Called by CognitiveProvider after construction.
   *
   * @param {Object} runtimeConfig
   * @param {import('@sschepis/lmscript').LScriptRuntime} runtimeConfig.runtime
   * @param {import('./tool-bridge.mjs').ToolBridge} runtimeConfig.toolBridge
   * @param {import('./cognitive-middleware.mjs').CognitiveMiddleware} runtimeConfig.cognitiveMiddleware
   * @param {import('./eventbus-transport.mjs').EventBusTransport} runtimeConfig.eventBusTransport
   */
  initRuntime(runtimeConfig = {}) {
    this._runtime = runtimeConfig.runtime || null;
    this._toolBridge = runtimeConfig.toolBridge || null;
    this._cognitiveMiddleware = runtimeConfig.cognitiveMiddleware || null;
    this._eventBusTransport = runtimeConfig.eventBusTransport || null;
  }

  // ════════════════════════════════════════════════════════════════════
  // New turn() — delegates to lmscript executeAgent when available
  // ════════════════════════════════════════════════════════════════════

  /**
   * Process a single user turn.
   *
   * When the lmscript runtime is available, delegates to executeAgent()
   * for LLM + tool orchestration.  Falls back to the hand-rolled legacy
   * loop (_turnLegacy) if the runtime is absent or throws.
   *
   * @param {string} input - User message
   * @param {Object} options
   * @param {AbortSignal} [options.signal]
   * @param {string}      [options.model]
   * @param {number}      [options.maxIterations]
   * @param {number}      [options.temperature]
   * @returns {Promise<{response: string, toolResults: Array, thoughts: string|null, signature: string|null, diagnostics: Object, tokenUsage: Object|null}>}
   */
  async turn(input, options = {}) {
    // ── Fallback: no runtime → legacy loop ─────────────────────────
    if (!this._runtime) {
      return this._adaptLegacyResult(
        await this._turnLegacy(input, options)
      );
    }

    // Hoist declarations so they are accessible in the catch block
    // for fallback to _turnLegacy. Default to empty arrays so the
    // fallback works even if the error occurs before assignment.
    let violations = [];
    let preRouted = [];

    try {
      this.turnCount++;

      // ── Steps 1-4: Process input through cognitive core ──────────
      this._tracker.setActivity('Processing input…');
      this.cognitive.processInput(input);

      // ── Step 5: Safety check ─────────────────────────────────────
      emitStatus('Checking safety constraints');
      violations = this.cognitive.checkSafety();
      if (violations.some(v => v.constraint?.response === 'block')) {
        this._tracker.stop();
        return {
          response: 'I need to pause — my cognitive state indicates unsafe conditions. Please try rephrasing.',
          toolResults: [],
          thoughts: null,
          signature: null,
          diagnostics: { blocked: true, violations, ...this.cognitive.getDiagnostics() },
          tokenUsage: null
        };
      }

      // ── Pre-route: auto-fetch data the user is asking about ──────
      preRouted = await this._preRoute(input, options);

      // ── Build system prompt with cognitive context ────────────────
      emitStatus('Building context');
      const systemPrompt = this._buildSystemPrompt(input, options, preRouted, violations);

      // ── Convert tools to lmscript format ─────────────────────────
      const lmscriptTools = this._getLmscriptTools();

      // ── Build the LScriptFunction for this turn ──────────────────
      const model = options.model || this.config.agent?.model;
      if (!model) {
        throw new Error('CognitiveAgent: no model specified — set agent.model in config or pass options.model');
      }
      const agentFn = {
        name: 'cognitive-turn',
        model,
        system: systemPrompt,
        prompt: (userInput) => userInput,
        schema: AGENT_RESPONSE_SCHEMA,
        tools: lmscriptTools.length > 0 ? lmscriptTools : undefined,
        temperature: options.temperature ?? 0.7,
        maxRetries: 1,
      };

      // ── Execute via lmscript agent loop ──────────────────────────
      emitStatus('Thinking…');
      this._tracker.setActivity('Thinking…');
      const result = await this._runtime.executeAgent(agentFn, input, {
        maxIterations: options.maxIterations || this.config.agent?.maxToolRounds || 10,
        onToolCall: (toolCall) => {
          emitStatus(`Executing tool: ${toolCall.name}`);
          this._tracker.setActivity(`Executing: ${toolCall.name}`);
        },
        onIteration: (iteration) => {
          this._tracker.setActivity(`Thinking… (iteration ${iteration})`);
        },
      });

      const responseText = result.data?.response || '';

      // ── Step 9: Validate through ObjectivityGate ─────────────────
      emitStatus('Validating response quality');
      const validation = this.cognitive.validateOutput(responseText, { input });

      let finalResponse = responseText;
      if (!validation.passed) {
        finalResponse +=
          '\n\n[Note: This response scored below the objectivity threshold. R=' +
          validation.R.toFixed(2) +
          ']';
      }

      // ── Update internal history ──────────────────────────────────
      this.history.push({ role: 'user', content: input });
      this.history.push({ role: 'assistant', content: finalResponse });
      while (this.history.length > this.maxHistory) {
        this.history.shift();
      }

      // ── Step 10: Remember interaction ────────────────────────────
      emitStatus('Storing interaction in memory');
      this.cognitive.remember(input, finalResponse);

      // ── Step 11: Evolve physics ──────────────────────────────────
      emitStatus('Evolving cognitive state');
      for (let i = 0; i < 3; i++) {
        this.cognitive.tick();
      }

      // ── Track token usage ────────────────────────────────────────
      if (result.usage) {
        this.totalTokens += result.usage.totalTokens || 0;
      }

      emitStatus('Response ready');
      this._tracker.stop();

      return {
        response: finalResponse,
        toolResults: this._extractToolResults(result),
        thoughts: null,
        signature: null,
        diagnostics: this.cognitive.getDiagnostics(),
        tokenUsage: result.usage || null
      };
    } catch (err) {
      console.error('[CognitiveAgent] lmscript runtime error, falling back to legacy:', err.message);
      this._tracker.stop();

      // Fall back to the legacy hand-rolled loop.
      // Pass flags to avoid double-processing: turn() already called
      // processInput(), checkSafety(), and _preRoute() before the error.
      return this._adaptLegacyResult(
        await this._turnLegacy(input, options, {
          skipProcessInput: true,
          skipTurnCount: true,
          skipSafetyCheck: true,
          cachedViolations: violations,
          cachedPreRoute: preRouted,
        })
      );
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Legacy turn — exact copy of the original hand-rolled agent loop
  // ════════════════════════════════════════════════════════════════════

  /**
   * Process a single user turn through the full 11-step cognitive agent loop.
   * This is the ORIGINAL turn() implementation preserved as a fallback.
   *
   * @param {string} input - User message
   * @param {Object} options
   * @param {AbortSignal} [options.signal]
   * @param {Object} [flags] - Internal flags for fallback control
   * @param {boolean}  [flags.skipProcessInput]  - Skip processInput (already called by turn())
   * @param {boolean}  [flags.skipTurnCount]     - Skip turnCount++ (already incremented by turn())
   * @param {boolean}  [flags.skipSafetyCheck]   - Skip checkSafety (already called by turn())
   * @param {Array}    [flags.cachedViolations]  - Pre-computed safety violations from turn()
   * @param {Array}    [flags.cachedPreRoute]    - Pre-computed pre-route results from turn()
   * @returns {Promise<{response: string, metadata: Object}>}
   */
  async _turnLegacy(input, options = {}, flags = {}) {
    // Only increment turnCount when called directly (not as a fallback
    // from turn(), which already incremented it).
    if (!flags.skipTurnCount) {
      this.turnCount++;
    }

    // ── Steps 1-4: Process input through cognitive core ────────────────
    // Skip if turn() already called processInput before falling back.
    this._tracker.setActivity('Processing input…');
    const inputAnalysis = flags.skipProcessInput
      ? this.cognitive.getDiagnostics()
      : this.cognitive.processInput(input);

    // ── Step 5: Safety check ──────────────────────────────────────────
    // Reuse cached violations when falling back from turn() to avoid
    // double-processing the cognitive state.
    const violations = flags.skipSafetyCheck && flags.cachedViolations
      ? flags.cachedViolations
      : (() => { emitStatus('Checking safety constraints'); return this.cognitive.checkSafety(); })();
    if (violations.some(v => v.constraint?.response === 'block')) {
      this._tracker.stop();
      return {
        response: 'I need to pause — my cognitive state indicates unsafe conditions. Please try rephrasing.',
        metadata: { blocked: true, violations }
      };
    }

    // ── Step 6: Recall relevant memories ──────────────────────────────
    emitStatus('Recalling relevant memories');
    const memories = this.cognitive.recall(input, 3);

    // Build system prompt with cognitive state.
    // Prefer the facade's dynamic system prompt (which includes skills,
    // plugin summaries, persona, surfaces, etc.) over our static default.
    emitStatus('Building context');
    const basePrompt = (this.aiProvider?.systemPrompt) || this.systemPrompt;
    const stateContext = this.cognitive.getStateContext();
    let systemMessage = basePrompt + '\n\n' + stateContext;

    // Append available tool names so the model knows what's at its disposal
    const toolDefs = this._getToolDefinitions();
    const toolNames = toolDefs.map(t => t.function.name).join(', ');
    systemMessage += `\n[Available Tools: ${toolNames}]\n`;

    if (memories.length > 0) {
      systemMessage += '\n[Relevant Past Interactions]\n';
      for (const mem of memories) {
        systemMessage += `- User: "${mem.input}" → Agent: "${mem.output}"\n`;
      }
    }

    if (violations.length > 0) {
      systemMessage += '\n[Safety Warnings]\n';
      for (const v of violations) {
        systemMessage += `- ${v.constraint?.name}: ${v.constraint?.description}\n`;
      }
    }

    // Add user message to internal history
    this.history.push({ role: 'user', content: input });

    // Trim history if needed
    while (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // ── Steps 7-8: LLM call with tool loop ────────────────────────────
    const messages = [
      { role: 'system', content: systemMessage },
      ...this.history
    ];

    // Pre-route: automatically fetch data the user is asking about.
    // Reuse cached results when falling back from turn() to avoid
    // re-executing file I/O for the same input.
    const toolsUsed = [];
    const preRouted = flags.cachedPreRoute || await this._preRoute(input);
    if (preRouted.length > 0) {
      const toolContext = preRouted.map(r => {
        if (r.tool === 'read_file' && r.content) {
          return `[FILE CONTENT: ${r.path}]\n\`\`\`\n${r.content}\n\`\`\``;
        } else if (r.tool === 'read_file' && r.error) {
          return `[FILE ERROR: ${r.path}]: ${r.error}`;
        } else if (r.tool === 'list_files') {
          return `[FILES IN ${r.path}]: ${Array.isArray(r.files) ? r.files.map(f => typeof f === 'string' ? f : f.name).join(', ') : JSON.stringify(r.files)}`;
        } else if (r.tool === 'cognitive_state') {
          return `[YOUR COGNITIVE STATE]:\n${JSON.stringify(r.state, null, 2)}`;
        }
        return '';
      }).filter(Boolean).join('\n\n');

      messages.push({
        role: 'system',
        content: `The following data has been retrieved for you. You MUST analyze this data carefully to answer the user's question. Reference specific details from the data in your response.\n\n${toolContext}\n\nIMPORTANT: Base your answer on the actual data above. Do NOT make up information or describe things in general terms — cite specific code, values, thresholds, function names, or state values from the retrieved data.`
      });

      toolsUsed.push(...preRouted.map(r => r.tool));
    }

    let response;
    let toolResults = [];
    let toolRounds = 0;

    try {
      // Initial LLM call via ai-man's EventicAIProvider
      this._tracker.setActivity('Thinking…');
      response = await this._callLLM(messages, toolDefs, options);

      // Tool call loop
      while (
        response.toolCalls &&
        response.toolCalls.length > 0 &&
        toolRounds < this.config.agent.maxToolRounds
      ) {
        toolRounds++;

        // Build the assistant message for ALL tool calls in this round.
        // For Gemini thinking models, we MUST preserve _geminiParts (which
        // contain thought/thoughtSignature fields) or the API will reject
        // subsequent turns with "missing thought_signature" errors.
        const rawMsg = response.rawMessage;
        const assistantMsg = {
          role: 'assistant',
          content: null,
          tool_calls: response.toolCalls.map(tc => ({
            id: tc.id || `call_${toolRounds}_${tc.function.name}`,
            type: 'function',
            function: {
              name: tc.function.name,
              arguments: typeof tc.function.arguments === 'string'
                ? tc.function.arguments
                : JSON.stringify(tc.function.arguments)
            },
            // Preserve thoughtSignature for Gemini round-tripping
            _thoughtSignature: tc._thoughtSignature || undefined
          }))
        };

        // Preserve full Gemini parts for faithful round-trip reconstruction
        if (rawMsg && rawMsg._geminiParts) {
          assistantMsg._geminiParts = rawMsg._geminiParts;
        }

        messages.push(assistantMsg);

        // Execute each tool and push results
        const roundToolNames = response.toolCalls.map(tc => tc.function.name);
        emitStatus(`Executing tools: ${roundToolNames.join(', ')}`);

        for (const toolCall of response.toolCalls) {
          const result = await this._executeTool(
            toolCall.function.name,
            toolCall.function.arguments
          );
          toolResults.push({ tool: toolCall.function.name, result });

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id || `call_${toolRounds}_${toolCall.function.name}`,
            name: toolCall.function.name,
            content: JSON.stringify(result)
          });
        }

        // Call LLM again with tool results
        this._tracker.setActivity(`Thinking… (round ${toolRounds + 1})`);
        response = await this._callLLM(messages, toolDefs, options);
      }

      // If the tool loop finished but the final response is still empty
      // (common with Gemini thinking models that return only thought parts),
      // make one more LLM call WITHOUT tools to force a text-only summary.
      // Also handle the case where the loop exhausted maxToolRounds and the
      // model's last response contained tool calls (which were dropped).
      const needsSynthesis = toolRounds > 0 && !response.content?.trim();
      if (needsSynthesis) {
        this._tracker.setActivity('Synthesizing final response…');

        // Build a human-readable summary of all tool results so the model
        // has them in context even if earlier tool messages were truncated.
        const toolSummary = toolResults.map(t => {
          const resultStr = typeof t.result === 'string' ? t.result : JSON.stringify(t.result);
          return `- ${t.tool}: ${resultStr.substring(0, 500)}`;
        }).join('\n');

        messages.push({
          role: 'system',
          content: `The tool loop has completed (${toolRounds} rounds, ${toolResults.length} tool calls executed). Here is a summary of all tool results:\n\n${toolSummary}\n\nNow write a clear, plain-English response for the user that:\n1. Summarizes what was done and what was found\n2. Highlights key findings, successes, and any errors\n3. Does NOT include raw JSON, result objects, or tool call metadata\n4. Reads like a natural response, not a log dump\n\nDo NOT call any more tools. You MUST provide a text response.`
        });
        response = await this._callLLM(messages, [], options);

        // If the synthesis call ALSO returned empty (e.g. Gemini thought-only),
        // retry once more with an even more explicit prompt.
        if (!response.content?.trim()) {
          this._tracker.setActivity('Retrying synthesis…');
          messages.push({
            role: 'system',
            content: 'Your previous response was empty. You MUST respond with visible text. Write a brief, human-readable summary of what actions were taken and their results. Do NOT output raw JSON or tool result objects. Do not use any tools.'
          });
          response = await this._callLLM(messages, [], options);
        }

        // Last resort: if still empty, construct a readable response from
        // tool results. Format as plain English, not raw JSON dumps.
        if (!response.content?.trim()) {
          response = { content: this._buildFallbackResponse(toolResults), toolCalls: null, rawMessage: null };
        }
      }
    } catch (e) {
      // Provide a user-friendly message that distinguishes temporary
      // service issues (503/UNAVAILABLE) from permanent errors (auth, etc.)
      let errorMsg;
      if (isRetryableError(e)) {
        errorMsg = `The AI model is temporarily unavailable (likely due to high demand). The request was retried multiple times but the service did not recover in time. Please try again in a minute or two. (Technical: ${e.message})`;
      } else if (isCancellationError(e)) {
        errorMsg = 'The request was cancelled.';
      } else {
        errorMsg = `I encountered an error communicating with the LLM: ${e.message}`;
      }
      response = {
        content: `${errorMsg} My cognitive state: coherence=${inputAnalysis.coherence.toFixed(3)}, entropy=${inputAnalysis.entropy.toFixed(3)}`,
        toolCalls: null
      };
    }

    // Ensure we have actual text content, not just whitespace
    const responseText = (response.content || '').trim() ? response.content : '';

    // ── Step 9: Validate through ObjectivityGate ──────────────────────
    emitStatus('Validating response quality');
    const validation = this.cognitive.validateOutput(responseText, { input });

    let finalResponse = responseText;
    if (!validation.passed) {
      finalResponse +=
        '\n\n[Note: This response scored below the objectivity threshold. R=' +
        validation.R.toFixed(2) +
        ']';
    }

    // Add assistant response to internal history
    this.history.push({ role: 'assistant', content: finalResponse });

    // ── Step 10: Remember interaction ─────────────────────────────────
    emitStatus('Storing interaction in memory');
    this.cognitive.remember(input, finalResponse);

    // ── Step 11: Evolve physics ───────────────────────────────────────
    emitStatus('Evolving cognitive state');
    for (let i = 0; i < 3; i++) {
      this.cognitive.tick();
    }

    emitStatus('Response ready');
    this._tracker.stop();

    return {
      response: finalResponse,
      metadata: {
        provider: 'cognitive',
        turnCount: this.turnCount,
        coherence: inputAnalysis.coherence,
        entropy: inputAnalysis.entropy,
        toolsUsed: [...toolsUsed, ...toolResults.map(t => t.tool)],
        toolRounds,
        objectivityR: validation.R,
        objectivityPassed: validation.passed,
        memoryCount: this.cognitive.memories.length,
        processingLoad: inputAnalysis.processingLoad
      }
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // New helper methods for lmscript integration
  // ════════════════════════════════════════════════════════════════════

  /**
   * Build the full system prompt for an lmscript executeAgent call.
   *
   * Since executeAgent() only injects `[system, user(prompt)]` messages,
   * we pack conversation history, cognitive state, memories, safety
   * warnings, and pre-routed data into the system prompt.
   *
   * @param {string} input            - Current user input (for recall)
   * @param {Object} options          - Turn options
   * @param {Array}  preRouted        - Pre-routed auto-fetch results
   * @param {Array}  violations       - Safety violations (may be empty)
   * @returns {string}
   * @private
   */
  _buildSystemPrompt(input, options = {}, preRouted = [], violations = []) {
    const basePrompt = (this.aiProvider?.systemPrompt) || this.systemPrompt;
    const stateContext = this.cognitive.getStateContext();
    let systemMessage = basePrompt + '\n\n' + stateContext;

    // Append available tool names so the model knows what's at its disposal
    const toolDefs = this._getToolDefinitions();
    const toolNames = toolDefs.map(t => t.function.name).join(', ');
    systemMessage += `\n[Available Tools: ${toolNames}]\n`;

    // ── Step 6: Recall relevant memories ────────────────────────────
    emitStatus('Recalling relevant memories');
    const memories = this.cognitive.recall(input, 3);
    if (memories.length > 0) {
      systemMessage += '\n[Relevant Past Interactions]\n';
      for (const mem of memories) {
        systemMessage += `- User: "${mem.input}" → Agent: "${mem.output}"\n`;
      }
    }

    // Safety warnings (non-blocking violations)
    if (violations.length > 0) {
      systemMessage += '\n[Safety Warnings]\n';
      for (const v of violations) {
        systemMessage += `- ${v.constraint?.name}: ${v.constraint?.description}\n`;
      }
    }

    // Pre-routed data
    if (preRouted.length > 0) {
      let toolContext = preRouted.map(r => {
        if (r.tool === 'read_file' && r.content) {
          return `[FILE CONTENT: ${r.path}]\n\`\`\`\n${r.content}\n\`\`\``;
        } else if (r.tool === 'read_file' && r.error) {
          return `[FILE ERROR: ${r.path}]: ${r.error}`;
        } else if (r.tool === 'list_files') {
          return `[FILES IN ${r.path}]: ${Array.isArray(r.files) ? r.files.map(f => typeof f === 'string' ? f : f.name).join(', ') : JSON.stringify(r.files)}`;
        } else if (r.tool === 'cognitive_state') {
          return `[YOUR COGNITIVE STATE]:\n${JSON.stringify(r.state, null, 2)}`;
        }
        return '';
      }).filter(Boolean).join('\n\n');

      if (toolContext) {
        // Cap pre-routed data to prevent blowing the context window.
        // Use a rough 4-chars-per-token estimate against the configured max.
        const maxPreRouteChars = ((this.config.lmscript?.context?.maxTokens || 128000)
            - (this.config.lmscript?.context?.reserveTokens || 4096)) * 2; // leave room for other sections
        if (toolContext.length > maxPreRouteChars) {
          toolContext = toolContext.substring(0, maxPreRouteChars) + '\n\n[...data truncated to fit context window]';
        }
        systemMessage += `\nThe following data has been retrieved for you. You MUST analyze this data carefully to answer the user's question. Reference specific details from the data in your response.\n\n${toolContext}\n\nIMPORTANT: Base your answer on the actual data above. Do NOT make up information or describe things in general terms — cite specific code, values, thresholds, function names, or state values from the retrieved data.\n`;
      }
    }

    // Conversation history (since executeAgent builds only [system, user],
    // we embed history in the system prompt for multi-turn continuity).
    // Limit the embedded history to stay within a token budget to avoid
    // blowing the context window.  We use a rough 4-chars-per-token estimate.
    if (this.history.length > 0) {
      const maxHistoryChars = (this.config.lmscript?.context?.reserveTokens || 4096) * 4;
      let historyBlock = '';
      // Walk backwards (most recent first) and include messages until budget is exhausted
      for (let i = this.history.length - 1; i >= 0; i--) {
        const msg = this.history[i];
        const role = msg.role === 'assistant' ? 'Agent' : 'User';
        const line = `${role}: ${msg.content}\n`;
        if (historyBlock.length + line.length > maxHistoryChars) break;
        historyBlock = line + historyBlock;
      }
      if (historyBlock) {
        systemMessage += '\n[Conversation History]\n' + historyBlock;
      }
    }

    return systemMessage;
  }

  /**
   * Build a human-readable fallback response from tool results.
   * Used as a last resort when LLM synthesis repeatedly returns empty.
   * Formats results as plain English instead of raw JSON.
   *
   * @param {Array<{tool: string, result: unknown}>} toolResults
   * @returns {string}
   * @private
   */
  _buildFallbackResponse(toolResults) {
    if (!toolResults || toolResults.length === 0) {
      return 'The requested operations completed but produced no output.';
    }

    const parts = [`I completed ${toolResults.length} operation(s):\n`];

    for (const t of toolResults) {
      const summary = this._summarizeToolResult(t.tool, t.result);
      parts.push(`• **${this._humanizeToolName(t.tool)}** — ${summary}`);
    }

    return parts.join('\n');
  }

  /**
   * Convert a tool name to a human-readable label.
   * @param {string} name
   * @returns {string}
   * @private
   */
  _humanizeToolName(name) {
    const map = {
      'read_file': 'Read file',
      'write_file': 'Write file',
      'write_to_file': 'Write file',
      'list_files': 'List files',
      'search_web': 'Web search',
      'search_files': 'Search files',
      'edit_file': 'Edit file',
      'apply_diff': 'Apply diff',
      'execute_command': 'Run command',
      'browse_open': 'Open browser',
      'read_many_files': 'Read files',
      'write_many_files': 'Write files',
      'firecrawl_scrape': 'Scrape webpage',
      'create_surface': 'Create surface',
      'update_surface_component': 'Update surface',
      'delete_file': 'Delete file',
      'cognitive_state': 'Check cognitive state',
      'recall_memory': 'Search memory',
    };
    return map[name] || name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  /**
   * Summarize a single tool result as plain English.
   * Extracts meaningful content instead of dumping raw JSON.
   *
   * @param {string} toolName
   * @param {unknown} result
   * @returns {string}
   * @private
   */
  _summarizeToolResult(toolName, result) {
    if (result == null) return 'completed';

    // String results — truncate and clean up
    if (typeof result === 'string') {
      const clean = result.trim();
      if (!clean) return 'completed (no output)';
      return clean.length > 300 ? clean.substring(0, 300) + '…' : clean;
    }

    // Object results — extract meaningful fields
    if (typeof result === 'object') {
      // Error results
      if (result.success === false || result.error) {
        return `failed: ${result.error || 'unknown error'}`;
      }

      // File read results
      if (result.content && typeof result.content === 'string') {
        const preview = result.content.substring(0, 200).trim();
        return `read ${result.content.length} characters${preview ? ': ' + preview + '…' : ''}`;
      }

      // File write results
      if (result.result && typeof result.result === 'string' && result.result.includes('wrote')) {
        return result.result;
      }

      // Search results
      if (Array.isArray(result.results)) {
        return `found ${result.results.length} result(s)`;
      }

      // List file results
      if (Array.isArray(result.files)) {
        return `found ${result.files.length} file(s)`;
      }

      // Summary field
      if (result.summary) {
        return typeof result.summary === 'string' ? result.summary : JSON.stringify(result.summary);
      }

      // Generic result field
      if (result.result && typeof result.result === 'string') {
        const r = result.result.trim();
        return r.length > 300 ? r.substring(0, 300) + '…' : r;
      }

      // Path/status fields
      if (result.path) {
        return `${result.success !== undefined ? (result.success ? 'success' : 'failed') : 'completed'}: ${result.path}`;
      }

      // Fallback: try to produce something readable
      const str = JSON.stringify(result);
      if (str.length <= 200) return str;
      // Extract key names as a summary
      const keys = Object.keys(result);
      return `completed (fields: ${keys.join(', ')})`;
    }

    return String(result);
  }

  /**
   * Extract tool call results from an lmscript AgentResult.
   *
   * @param {import('@sschepis/lmscript').AgentResult} result
   * @returns {Array<{tool: string, result: unknown}>}
   * @private
   */
  _extractToolResults(result) {
    if (!result.toolCalls || result.toolCalls.length === 0) {
      return [];
    }
    return result.toolCalls.map(tc => ({
      tool: tc.name,
      result: tc.result
    }));
  }

  /**
   * Build lmscript ToolDefinition[] including both ToolBridge tools
   * and cognitive-specific tools (cognitive_state, recall_memory).
   *
   * @returns {Array<{name: string, description: string, parameters: import('zod').ZodType, execute: function}>}
   * @private
   */
  _getLmscriptTools() {
    // Get tools from ToolBridge (ai-man ToolExecutor → lmscript format)
    const bridgedTools = this._toolBridge ? this._toolBridge.toLmscriptTools() : [];

    // Add cognitive-specific tools in lmscript ToolDefinition format
    const cognitiveTools = [
      {
        name: 'cognitive_state',
        description: 'Get your current cognitive state including coherence, entropy, and oscillator synchronization',
        parameters: z.object({}),
        execute: () => {
          emitStatus('Inspecting cognitive state');
          this._tracker.setActivity('Inspecting cognitive state');
          return { success: true, state: this.cognitive.getDiagnostics() };
        }
      },
      {
        name: 'recall_memory',
        description: 'Search your holographic memory for relevant past interactions',
        parameters: z.object({
          query: z.string().describe('Search query'),
          limit: z.number().optional().describe('Max results (default 5)')
        }),
        execute: (args) => {
          const query = args.query || '';
          emitStatus(`Searching memory: "${query.substring(0, 40)}"`);
          this._tracker.setActivity(`Searching memory: "${query.substring(0, 40)}"`);
          const memories = this.cognitive.recall(query, args.limit || 5);
          return {
            success: true,
            memories: memories.map(m => ({
              input: m.input,
              output: m.output,
              coherence: m.coherence,
              age: Date.now() - m.timestamp
            }))
          };
        }
      }
    ];

    return [...bridgedTools, ...cognitiveTools];
  }

  /**
   * Map a legacy turn result ({ response, metadata }) to the new return
   * format ({ response, toolResults, thoughts, … }).
   *
   * @param {{response: string, metadata: Object}} legacyResult
   * @returns {{response: string, toolResults: Array, thoughts: string|null, signature: string|null, diagnostics: Object, tokenUsage: Object|null}}
   * @private
   */
  _adaptLegacyResult(legacyResult) {
    const metadata = legacyResult.metadata || {};
    return {
      response: legacyResult.response,
      toolResults: (metadata.toolsUsed || []).map(name => ({ tool: name, result: null })),
      thoughts: null,
      signature: null,
      diagnostics: metadata,
      tokenUsage: null
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // Preserved methods from the original implementation
  // ════════════════════════════════════════════════════════════════════

  /**
   * Get tool definitions in OpenAI function-calling format from ai-man's ToolExecutor.
   * Also adds cognitive-specific tools.
   * @returns {Array}
   * @private
   */
  _getToolDefinitions() {
    // Get ai-man's full tool definitions
    const aiManTools = this.toolExecutor ? this.toolExecutor.getAllToolDefinitions() : [];

    // Add cognitive-specific tools
    const cognitiveTools = [
      {
        type: 'function',
        function: {
          name: 'cognitive_state',
          description: 'Get your current cognitive state including coherence, entropy, and oscillator synchronization',
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'recall_memory',
          description: 'Search your holographic memory for relevant past interactions',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              limit: { type: 'number', description: 'Max results (default 5)' }
            },
            required: ['query']
          }
        }
      }
    ];

    return [...aiManTools, ...cognitiveTools];
  }

  /**
   * Call the LLM via ai-man's EventicAIProvider.
   *
   * Uses `askWithMessages()` so the shared `aiProvider.conversationHistory`
   * is never mutated — the full messages array is passed directly and
   * no save/restore dance is needed.
   *
   * The ActivityTracker heartbeat is active during the LLM call so the
   * operator sees periodic "Thinking… (Ns)" updates.
   *
   * @param {Array} messages
   * @param {Array} tools
   * @param {Object} options
   * @returns {Promise<{content: string, toolCalls: Array|null, rawMessage: Object|null}>}
   * @private
   */
  async _callLLM(messages, tools, options = {}) {
    try {
      const response = await this.aiProvider.askWithMessages(messages, {
        tools: tools.length > 0 ? tools : undefined,
        signal: options.signal
      });

      // Handle the response format
      if (typeof response === 'string') {
        return { content: response, toolCalls: null, rawMessage: null };
      }

      if (response && response.toolCalls) {
        return {
          content: response.content || '',
          toolCalls: response.toolCalls,
          rawMessage: response.rawMessage || null
        };
      }

      return { content: response?.content || String(response), toolCalls: null, rawMessage: null };
    } catch (e) {
      // Re-throw — callers handle errors (turn() wraps in try/catch)
      throw e;
    }
  }

  /**
   * Public LLM call interface for external consumers (e.g. task planner).
   * Delegates to the internal _callLLM implementation.
   *
   * ⚠️ WARNING: This method bypasses cognitive safety checks, memory recall,
   * perception, and validation phases. It should only be used for internal
   * orchestration (e.g., task planner utility calls) — never for user-facing
   * agent turns. Use turn() for full cognitive processing.
   *
   * @param {Array} messages
   * @param {Array} tools
   * @param {Object} options
   * @returns {Promise<{content: string, toolCalls: Array|null, rawMessage: Object|null}>}
   */
  async callLLM(messages, tools, options = {}) {
      return this._callLLM(messages, tools, options);
  }

  /**
   * Execute a tool call. Handles cognitive-specific tools internally,
   * delegates everything else to ai-man's ToolExecutor via its full
   * `executeTool()` pipeline (which dispatches to core, plugin, MCP,
   * and custom tools with proper security, timeout, and logging).
   *
   * Emits status for cognitive-specific tools (ToolExecutor already
   * emits status for delegated tools via emitToolStatus).
   *
   * @param {string} name
   * @param {object|string} args
   * @returns {Promise<object>}
   * @private
   */
  async _executeTool(name, args) {
    // Parse args if string
    let parsedArgs = args;
    if (typeof args === 'string') {
      try { parsedArgs = JSON.parse(args); } catch (_e) { parsedArgs = {}; }
    }

    // Handle cognitive-specific tools (with status emission)
    if (name === 'cognitive_state') {
      emitStatus('Inspecting cognitive state');
      this._tracker.setActivity('Inspecting cognitive state');
      return { success: true, state: this.cognitive.getDiagnostics() };
    }

    if (name === 'recall_memory') {
      const query = parsedArgs.query || '';
      emitStatus(`Searching memory: "${query.substring(0, 40)}"`);
      this._tracker.setActivity(`Searching memory: "${query.substring(0, 40)}"`);
      const memories = this.cognitive.recall(query, parsedArgs.limit || 5);
      return {
        success: true,
        memories: memories.map(m => ({
          input: m.input,
          output: m.output,
          coherence: m.coherence,
          age: Date.now() - m.timestamp
        }))
      };
    }

    // Delegate to ai-man's ToolExecutor via the full executeTool() pipeline.
    // This ensures plugin tools (browse_open, etc.), MCP tools, custom tools,
    // security checks, timeouts, and status reporting all work correctly.
    // Note: ToolExecutor.executeTool() already calls emitToolStatus() internally.
    if (this.toolExecutor) {
      // Set tracker activity so heartbeat shows tool execution during long tools
      this._tracker.setActivity(`Executing: ${name}`);
      try {
        const toolCall = {
          id: `cognitive_${Date.now()}_${name}`,
          function: {
            name,
            arguments: JSON.stringify(parsedArgs)
          }
        };
        const result = await this.toolExecutor.executeTool(toolCall);
        // executeTool returns { role, tool_call_id, name, content }
        const content = result?.content || '';
        // Try to parse as JSON for structured results.
        // Preserve error indicators (success: false) so callers know it failed.
        try {
          const parsed = JSON.parse(content);
          if (parsed && parsed.success === false) {
            return { success: false, error: parsed.error || content };
          }
          return parsed;
        } catch {
          // Check for plain-text error strings from the executor
          if (content.startsWith('Error:')) {
            return { success: false, error: content };
          }
          return { result: content };
        }
      } catch (e) {
        return { success: false, error: `Tool execution error: ${e.message}` };
      }
    }

    return { success: false, error: `Unknown tool: ${name}` };
  }

  /**
   * Check whether a string looks like a real file path.
   * @param {string} str
   * @returns {boolean}
   * @private
   */
  static _isLikelyFilePath(str) {
    if (str.includes('/')) return true;
    const ext = str.split('.').pop()?.toLowerCase();
    const knownExts = [
      'js','ts','json','md','txt','py','html','css','yml','yaml',
      'toml','xml','sh','jsx','tsx','mjs','cjs','env','cfg','ini',
      'log','csv',
    ];
    return knownExts.includes(ext);
  }

  /**
   * Pre-route: detect file/directory/cognitive queries and auto-fetch data.
   * Emits status for each auto-fetched resource so the operator knows
   * what data is being gathered before the LLM call.
   *
   * @param {string} input
   * @param {Object} [options]
   * @returns {Promise<Array>}
   * @private
   */
  async _preRoute(input, options = {}) {
    const lower = input.toLowerCase();
    const results = [];
    const fetchedPaths = new Set();

    // Detect file read requests
    const filePatterns = [
      /read\s+(?:the\s+)?file\s+([^\s,]+)/i,
      /read\s+([a-zA-Z0-9_./-]+\.[a-zA-Z]+)/i,
      /(?:look at|examine|analyze|analyse|check|open|inspect|review)\s+(?:the\s+)?(?:file\s+)?([a-zA-Z0-9_./-]+\.[a-zA-Z]+)/i,
      /(?:contents?\s+of|what's\s+in)\s+([a-zA-Z0-9_./-]+\.[a-zA-Z]+)/i,
    ];

    for (const pattern of filePatterns) {
      const match = input.match(pattern);
      if (match && CognitiveAgent._isLikelyFilePath(match[1]) && !fetchedPaths.has(match[1])) {
        const filePath = match[1];
        fetchedPaths.add(filePath);
        emitStatus(`Reading ${filePath}`);
        const result = await this._executeTool('read_file', { path: filePath });
        if (result.success !== false) {
          results.push({ tool: 'read_file', path: filePath, content: (result.content || result.result || '').substring(0, 4000) });
        } else {
          results.push({ tool: 'read_file', path: filePath, error: result.error });
        }
      }
    }

    // Fallback: scan for path-like strings
    const pathRegex = /(?:^|\s)((?:[a-zA-Z0-9_.-]+\/)+[a-zA-Z0-9_.-]+\.[a-zA-Z]{1,5})(?:\s|$|[,;?!])/g;
    let pathMatch;
    while ((pathMatch = pathRegex.exec(input)) !== null) {
      const candidate = pathMatch[1];
      if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\//.test(candidate)) continue;
      if (CognitiveAgent._isLikelyFilePath(candidate) && !fetchedPaths.has(candidate)) {
        fetchedPaths.add(candidate);
        emitStatus(`Reading ${candidate}`);
        const result = await this._executeTool('read_file', { path: candidate });
        if (result.success !== false) {
          results.push({ tool: 'read_file', path: candidate, content: (result.content || result.result || '').substring(0, 4000) });
        } else {
          results.push({ tool: 'read_file', path: candidate, error: result.error });
        }
      }
    }

    // Detect cognitive state requests
    if (/cognitive\s+(?:state|diagnostics|health|metrics)/i.test(lower) ||
        /(?:your|my)\s+(?:coherence|entropy|oscillator)/i.test(lower) ||
        /introspect/i.test(lower) ||
        /(?:check|assess|diagnos)\w*\s+(?:your|my|own)\s+(?:cognitive|mental|health)/i.test(lower)) {
      emitStatus('Checking cognitive state');
      const result = await this._executeTool('cognitive_state', {});
      if (result.success) {
        results.push({ tool: 'cognitive_state', state: result.state });
      }
    }

    return results;
  }

  /**
   * Stop the activity heartbeat tracker.  Called by CognitiveProvider's
   * finally block to ensure cleanup even when turn() throws before
   * reaching its own stop() call.
   */
  stopTracking() {
    this._tracker.stop();
  }

  /**
   * Get agent statistics.
   * @returns {Object}
   */
  getStats() {
    return {
      turnCount: this.turnCount,
      totalTokens: this.totalTokens,
      historyLength: this.history.length,
      cognitive: this.cognitive.getDiagnostics(),
      runtimeActive: !!this._runtime
    };
  }

  /**
   * Reset all agent state.
   */
  reset() {
    this._tracker.stop();
    this.history = [];
    this.turnCount = 0;
    this.totalTokens = 0;
    this.cognitive.reset();
  }

  /**
   * Dispose of the agent and release all resources.
   * Nullifies lmscript runtime components and resets cognitive state.
   */
  dispose() {
    this.reset();
    this._runtime = null;
    this._toolBridge = null;
    this._cognitiveMiddleware = null;
    this._eventBusTransport = null;
  }
}

export { CognitiveAgent };
export default CognitiveAgent;
