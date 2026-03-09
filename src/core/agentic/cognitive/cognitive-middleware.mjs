/**
 * CognitiveMiddleware — bridges tinyaleph cognitive processing (CognitiveCore)
 * into lmscript's middleware hook system.
 *
 * Maps the 11-step cognitive loop onto lmscript's MiddlewareHooks:
 *
 *   onBeforeExecute  → PERCEIVE, ENCODE, ORIENT, ATTEND, GUARD, RECALL, THINK
 *   onAfterValidation → VALIDATE
 *   onComplete        → REMEMBER, EVOLVE
 *   onError           → diagnostics + EVOLVE
 *   onRetry           → cognitive state logging
 *
 * Conforms to lmscript's MiddlewareHooks interface:
 *   onBeforeExecute(ctx: ExecutionContext): void
 *   onAfterValidation(ctx: ExecutionContext, result: unknown): void
 *   onRetry(ctx: ExecutionContext, error: Error): void
 *   onError(ctx: ExecutionContext, error: Error): void
 *   onComplete(ctx: ExecutionContext, result: ExecutionResult): void
 *
 * Where ExecutionContext = { fn, input, messages, attempt, startTime }
 *
 * @module src/core/agentic/cognitive/cognitive-middleware
 */

const LOG_PREFIX = '[CognitiveMiddleware]';

/**
 * Extract a text string from an lmscript input value.
 * The input can be anything (string, object, etc.) — we need a string
 * for the cognitive layer.
 * @param {unknown} input
 * @returns {string}
 */
function inputToText(input) {
  if (typeof input === 'string') return input;
  if (input == null) return '';
  if (typeof input === 'object') {
    // Try common properties first
    if (typeof input.text === 'string') return input.text;
    if (typeof input.query === 'string') return input.query;
    if (typeof input.prompt === 'string') return input.prompt;
    if (typeof input.message === 'string') return input.message;
    if (typeof input.content === 'string') return input.content;
    return JSON.stringify(input);
  }
  return String(input);
}

/**
 * Extract the text content from a ChatMessage's content field.
 * Content can be a plain string or an array of ContentBlocks.
 * @param {string|Array<{type: string, text?: string}>} content
 * @returns {string}
 */
function messageContentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('\n');
  }
  return '';
}

/**
 * Find the last user message text from ctx.messages.
 * @param {Array<{role: string, content: string|Array}>} messages
 * @returns {string}
 */
function extractLastUserMessage(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return messageContentToText(messages[i].content);
    }
  }
  return '';
}

/**
 * Find the index of the first system message in ctx.messages.
 * @param {Array<{role: string, content: string|Array}>} messages
 * @returns {number} index, or -1 if not found
 */
function findSystemMessageIndex(messages) {
  if (!Array.isArray(messages)) return -1;
  return messages.findIndex(m => m.role === 'system');
}

/**
 * Prepend text to a system message's content.
 * Handles both string content and ContentBlock[] content.
 * @param {{role: string, content: string|Array}} message
 * @param {string} prefix
 */
function prependToSystemMessage(message, prefix) {
  if (typeof message.content === 'string') {
    message.content = prefix + '\n\n' + message.content;
  } else if (Array.isArray(message.content)) {
    // Prepend as a new text block
    message.content = [
      { type: 'text', text: prefix },
      ...message.content
    ];
  }
}

/**
 * Safely stringify a result for cognitive processing.
 * @param {unknown} result
 * @returns {string}
 */
function resultToText(result) {
  if (typeof result === 'string') return result;
  if (result == null) return '';
  // ExecutionResult has { data, attempts, usage, toolCalls }
  if (typeof result === 'object' && 'data' in result) {
    return typeof result.data === 'string'
      ? result.data
      : JSON.stringify(result.data);
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

/**
 * CognitiveMiddleware bridges CognitiveCore into lmscript MiddlewareHooks.
 *
 * Usage:
 *   const middleware = new CognitiveMiddleware(cognitiveCore, { enableGuard: true });
 *   middlewareManager.use(middleware.toHooks());
 */
class CognitiveMiddleware {
  /**
   * @param {import('./cognitive.mjs').CognitiveCore} cognitiveCore
   * @param {Object} options
   * @param {boolean} [options.enableGuard=true] — run safety constraint checks
   * @param {boolean} [options.enableRecall=true] — retrieve relevant memories
   * @param {boolean} [options.enableMemory=true] — store interactions in memory
   * @param {boolean} [options.enableEvolution=true] — run tick/evolve after interactions
   * @param {(input: string, safetyResult: Array) => string|null} [options.onSafetyViolation]
   *   Callback when safety constraints are violated. Receives the input text and
   *   array of violated constraints. Return a modified input string to continue,
   *   or null to block execution. Default: throws an error.
   */
  constructor(cognitiveCore, options = {}) {
    if (!cognitiveCore) {
      throw new Error(`${LOG_PREFIX} cognitiveCore is required`);
    }

    this.core = cognitiveCore;

    this.enableGuard = options.enableGuard !== false;
    this.enableRecall = options.enableRecall !== false;
    this.enableMemory = options.enableMemory !== false;
    this.enableEvolution = options.enableEvolution !== false;

    this.onSafetyViolation = options.onSafetyViolation || ((input, violations) => {
      const reasons = violations.map(v => v.name || v.reason || 'unknown').join(', ');
      throw new Error(
        `${LOG_PREFIX} Safety violation detected: ${reasons}`
      );
    });

    // WeakMap to store per-context cognitive metadata (input text, perception, etc.)
    // so onAfterValidation and onComplete can reference it.
    this._contextData = new WeakMap();
  }

  /**
   * Returns a MiddlewareHooks object conforming to lmscript's interface.
   * Register with: middlewareManager.use(cognitiveMiddleware.toHooks())
   *
   * @returns {{
   *   onBeforeExecute: (ctx: ExecutionContext) => Promise<void>,
   *   onAfterValidation: (ctx: ExecutionContext, result: unknown) => Promise<void>,
   *   onRetry: (ctx: ExecutionContext, error: Error) => Promise<void>,
   *   onError: (ctx: ExecutionContext, error: Error) => Promise<void>,
   *   onComplete: (ctx: ExecutionContext, result: ExecutionResult) => Promise<void>
   * }}
   */
  toHooks() {
    return {
      onBeforeExecute: this._onBeforeExecute.bind(this),
      onAfterValidation: this._onAfterValidation.bind(this),
      onRetry: this._onRetry.bind(this),
      onError: this._onError.bind(this),
      onComplete: this._onComplete.bind(this),
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // Hook implementations
  // ════════════════════════════════════════════════════════════════════

  /**
   * onBeforeExecute — runs PERCEIVE, ENCODE, ORIENT, ATTEND, GUARD, RECALL phases.
   *
   * Mutates ctx.messages in place to enrich the system prompt with cognitive
   * state and recalled memories.
   *
   * @param {ExecutionContext} ctx — { fn, input, messages, attempt, startTime }
   */
  async _onBeforeExecute(ctx) {
    // Derive the user's input text from ctx.input or the last user message
    const inputText = inputToText(ctx.input)
      || extractLastUserMessage(ctx.messages);

    if (!inputText) return;

    // Store input text for later phases (onAfterValidation, onComplete)
    const cogData = { inputText };
    this._contextData.set(ctx, cogData);

    // ── PERCEIVE + ENCODE + ORIENT + ATTEND ──────────────────────────
    try {
      const perception = this.core.processInput(inputText);
      cogData.perception = perception;
    } catch (err) {
      console.warn(`${LOG_PREFIX} processInput failed, continuing without perception:`, err.message);
    }

    // ── GUARD ────────────────────────────────────────────────────────
    if (this.enableGuard) {
      try {
        const violations = this.core.checkSafety();
        if (violations && violations.length > 0) {
          cogData.safetyViolations = violations;
          const modifiedInput = this.onSafetyViolation(inputText, violations);
          if (modifiedInput === null) {
            throw new Error(`${LOG_PREFIX} Execution blocked by safety violation callback`);
          }
          // If the callback returned a modified input, update the last user message
          if (typeof modifiedInput === 'string' && modifiedInput !== inputText) {
            cogData.inputText = modifiedInput;
            this._updateLastUserMessage(ctx.messages, modifiedInput);
          }
        }
      } catch (err) {
        // Re-throw safety errors (they're intentional), catch only unexpected failures
        if (err.message?.includes('Safety violation') || err.message?.includes('blocked by safety')) {
          throw err;
        }
        console.warn(`${LOG_PREFIX} checkSafety failed, continuing:`, err.message);
      }
    }

    // ── RECALL ───────────────────────────────────────────────────────
    let memories = [];
    if (this.enableRecall) {
      try {
        memories = this.core.recall(cogData.inputText) || [];
        cogData.memories = memories;
      } catch (err) {
        console.warn(`${LOG_PREFIX} recall failed, continuing without memories:`, err.message);
      }
    }

    // ── Enrich system prompt with cognitive state + memories ─────────
    try {
      const stateContext = this.core.getStateContext();
      cogData.stateContext = stateContext;

      const enrichment = this._buildSystemEnrichment(stateContext, memories);
      if (enrichment && Array.isArray(ctx.messages)) {
        const sysIdx = findSystemMessageIndex(ctx.messages);
        if (sysIdx >= 0) {
          prependToSystemMessage(ctx.messages[sysIdx], enrichment);
        } else {
          // No system message exists — insert one at the beginning
          ctx.messages.unshift({ role: 'system', content: enrichment });
        }
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} system prompt enrichment failed:`, err.message);
    }
  }

  /**
   * onAfterValidation — runs the VALIDATE phase (objectivity gate).
   *
   * @param {ExecutionContext} ctx
   * @param {unknown} result — the validated LLM output
   */
  async _onAfterValidation(ctx, result) {
    const cogData = this._contextData.get(ctx);
    if (!cogData) return;

    try {
      const outputText = resultToText(result);
      const validation = this.core.validateOutput(outputText, {
        input: cogData.inputText,
        perception: cogData.perception,
      });

      cogData.validation = validation;

      if (!validation.passed) {
        console.warn(
          `${LOG_PREFIX} Objectivity gate check failed (R=${validation.R?.toFixed?.(3) ?? 'N/A'}): ${validation.reason || 'no reason'}`
        );
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} validateOutput failed:`, err.message);
    }
  }

  /**
   * onComplete — runs REMEMBER and EVOLVE phases.
   *
   * @param {ExecutionContext} ctx
   * @param {import('@sschepis/lmscript').ExecutionResult} result
   */
  async _onComplete(ctx, result) {
    const cogData = this._contextData.get(ctx);
    const inputText = cogData?.inputText || inputToText(ctx.input);
    const outputText = resultToText(result);

    // ── REMEMBER ─────────────────────────────────────────────────────
    if (this.enableMemory && inputText) {
      try {
        this.core.remember(inputText, outputText);
      } catch (err) {
        console.warn(`${LOG_PREFIX} remember failed:`, err.message);
      }
    }

    // ── EVOLVE ───────────────────────────────────────────────────────
    if (this.enableEvolution) {
      try {
        this.core.tick();
      } catch (err) {
        console.warn(`${LOG_PREFIX} tick (evolve) failed:`, err.message);
      }
    }

    // Clean up context data
    this._contextData.delete(ctx);
  }

  /**
   * onError — attaches cognitive diagnostics and still evolves.
   *
   * @param {ExecutionContext} ctx
   * @param {Error} error
   */
  async _onError(ctx, error) {
    // Attach cognitive diagnostics to the error for debugging
    try {
      const diagnostics = this.core.getDiagnostics();
      error.cognitiveDiagnostics = diagnostics;
    } catch (err) {
      console.warn(`${LOG_PREFIX} getDiagnostics failed:`, err.message);
    }

    // The system should evolve even from failures
    if (this.enableEvolution) {
      try {
        this.core.tick();
      } catch (err) {
        console.warn(`${LOG_PREFIX} tick (evolve on error) failed:`, err.message);
      }
    }

    // Clean up context data
    this._contextData.delete(ctx);
  }

  /**
   * onRetry — logs retry with cognitive state info.
   *
   * @param {ExecutionContext} ctx
   * @param {Error} error
   */
  async _onRetry(ctx, error) {
    const cogData = this._contextData.get(ctx);

    try {
      const diagnostics = this.core.getDiagnostics();
      console.warn(
        `${LOG_PREFIX} Retry attempt ${ctx.attempt} for "${ctx.fn?.name || 'unknown'}":`,
        `coherence=${diagnostics.coherence?.toFixed?.(3) ?? 'N/A'},`,
        `entropy=${diagnostics.entropy?.toFixed?.(3) ?? 'N/A'},`,
        `error="${error.message}"`
      );

      // Store retry info in cogData for downstream hooks
      if (cogData) {
        if (!cogData.retries) cogData.retries = [];
        cogData.retries.push({
          attempt: ctx.attempt,
          error: error.message,
          coherence: diagnostics.coherence,
          entropy: diagnostics.entropy,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} onRetry diagnostics failed:`, err.message);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Internal helpers
  // ════════════════════════════════════════════════════════════════════

  /**
   * Build the enrichment string to prepend to the system message.
   * @param {string} stateContext — from CognitiveCore.getStateContext()
   * @param {Array} memories — recalled memories
   * @returns {string|null}
   */
  _buildSystemEnrichment(stateContext, memories) {
    const parts = [];

    if (stateContext) {
      parts.push(stateContext);
    }

    if (memories && memories.length > 0) {
      const memoryLines = memories.map((mem, i) => {
        const input = mem.input || '';
        const output = mem.output || '';
        return `  ${i + 1}. [Score: ${mem.score?.toFixed?.(2) ?? '?'}] "${input}" → "${output}"`;
      });
      parts.push(`[Recalled Memories]\n${memoryLines.join('\n')}`);
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
  }

  /**
   * Update the last user message in the messages array in place.
   * @param {Array<{role: string, content: string|Array}>} messages
   * @param {string} newText
   */
  _updateLastUserMessage(messages, newText) {
    if (!Array.isArray(messages)) return;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        if (typeof messages[i].content === 'string') {
          messages[i].content = newText;
        } else if (Array.isArray(messages[i].content)) {
          // Replace the first text block content
          const textBlock = messages[i].content.find(b => b.type === 'text');
          if (textBlock) {
            textBlock.text = newText;
          }
        }
        return;
      }
    }
  }
}

/**
 * Factory function for creating CognitiveMiddleware instances.
 *
 * @param {import('./cognitive.mjs').CognitiveCore} cognitiveCore
 * @param {Object} [options]
 * @returns {CognitiveMiddleware}
 */
export function createCognitiveMiddleware(cognitiveCore, options = {}) {
  return new CognitiveMiddleware(cognitiveCore, options);
}

export { CognitiveMiddleware };
export default CognitiveMiddleware;
