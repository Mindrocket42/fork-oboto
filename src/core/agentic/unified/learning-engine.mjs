/**
 * LearningEngine — experience accumulation and prompt evolution engine.
 *
 * Sits atop {@link MemorySystem} and uses its experience + pattern stores
 * to learn from past interactions.  Key capabilities:
 *
 *  - **Outcome recording** — accumulates per-turn metrics and periodically
 *    triggers pattern extraction.
 *  - **Strategy suggestion** — recommends tool approaches and estimated
 *    iteration counts based on similar past experiences.
 *  - **Prompt evolution** — generates prompt hints from learned patterns
 *    to inject into the system prompt.
 *  - **Precheck optimization** — learns when to skip the precheck
 *    fast-path (ported from `shouldSkipPrecheck` in
 *    `src/core/agentic/cognitive/agent-response-utils.mjs`).
 *
 * @module src/core/agentic/unified/learning-engine
 */

/**
 * Experience accumulation and prompt evolution engine.
 */
export class LearningEngine {
  /**
   * @param {Object} params
   * @param {Object} params.config — resolved unified config
   * @param {import('./memory-system.mjs').MemorySystem} params.memorySystem
   */
  constructor({ config, memorySystem }) {
    /** @type {Object} */
    this._config = config;

    /** @type {import('./memory-system.mjs').MemorySystem} */
    this._memory = memorySystem;

    // ── Running session statistics ─────────────────────────────────
    /** @type {number} */
    this._totalTurns = 0;

    /** @type {number} */
    this._successCount = 0;

    /** @type {number} */
    this._totalIterations = 0;

    /** @type {number} */
    this._totalCost = 0;

    /** @type {number} */
    this._totalDuration = 0;

    /** @type {number} */
    this._doomCount = 0;

    /** @type {number} */
    this._precheckSkipCount = 0;

    /**
     * Track tool usage frequency for top-pattern analysis.
     * @type {Map<string, number>}
     */
    this._toolUsageCounts = new Map();

    /**
     * Track failure signatures.
     * @type {Map<string, number>}
     */
    this._failureSignatures = new Map();

    /**
     * Pattern extraction interval — extract patterns every N turns.
     * @type {number}
     */
    this._extractionInterval = 10;

    /**
     * Keyword heuristics for precheck skipping (ported from
     * agent-response-utils.mjs).
     * @type {Array<RegExp>}
     */
    this._toolRequiredPatterns = [
      /\b(?:src|lib|docs|config|package)\/\S+/,
      /\b(?:write|create|edit|modify|delete|remove|rename|move|copy)\s+(?:a\s+)?(?:file|function|class|component|module|test|script)/i,
      /\b(?:run|execute|install|deploy|build|compile|test)\s+/i,
      /\b(?:read|open|show|display|cat|view)\s+(?:the\s+)?(?:file|contents)/i,
    ];

    // ── Surface pipeline learning ────────────────────────────────────
    /**
     * Surface outcome lessons — maps error signatures to successful fixes.
     * Key: error signature string, Value: { fixCount, lastFix, suggestions }
     * @type {Map<string, { fixCount: number, lastFix: string, suggestions: string[] }>}
     */
    this._surfaceLessons = new Map();

    /** @type {{ total: number, success: number, fail: number }} */
    this._surfaceStats = { total: 0, success: 0, fail: 0 };
  }

  // ════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ════════════════════════════════════════════════════════════════════

  /**
   * Load any persisted learning state.
   *
   * Currently a no-op placeholder — future implementations may load
   * session stats from disk or a database.
   *
   * @returns {Promise<void>}
   */
  async initialize() {
    // Reserved for future persistence loading
  }

  // ════════════════════════════════════════════════════════════════════
  // Outcome Recording
  // ════════════════════════════════════════════════════════════════════

  /**
   * @typedef {Object} TurnOutcome
   * @property {string}         input          — user input text
   * @property {string}         response       — agent response text
   * @property {Array<string>}  toolsUsed      — tool names invoked
   * @property {boolean}        success        — whether the turn succeeded
   * @property {number}         duration       — turn duration ms
   * @property {Object}         [tokenUsage]   — token usage stats
   * @property {number}         [iterations]   — tool-call iterations
   * @property {number}         [continuations]— continuation rounds
   * @property {boolean}        [doomDetected] — whether doom was triggered
   * @property {boolean}        [precheckUsed] — whether precheck was invoked
   */

  /**
   * Record the result of a completed turn for learning.
   *
   * Updates running statistics, stores the experience in
   * {@link MemorySystem.recordExperience}, and periodically triggers
   * pattern extraction.
   *
   * @param {TurnOutcome} outcome
   */
  recordTurnOutcome(outcome) {
    this._totalTurns++;

    if (outcome.success) {
      this._successCount++;
    }

    this._totalIterations += outcome.iterations ?? 1;
    this._totalDuration += outcome.duration ?? 0;

    // Accumulate cost from token usage
    if (outcome.tokenUsage) {
      const usage = outcome.tokenUsage;
      const cost =
        (usage.totalCost ?? 0) ||
        ((usage.promptTokens ?? 0) * 0.000003 +
          (usage.completionTokens ?? 0) * 0.000015);
      this._totalCost += cost;
    }

    if (outcome.doomDetected) {
      this._doomCount++;
    }

    if (outcome.precheckUsed === false) {
      this._precheckSkipCount++;
    }

    // Track tool usage
    for (const tool of outcome.toolsUsed ?? []) {
      this._toolUsageCounts.set(
        tool,
        (this._toolUsageCounts.get(tool) || 0) + 1
      );
    }

    // Track failure signatures
    if (!outcome.success && outcome.toolsUsed?.length > 0) {
      const sig = outcome.toolsUsed.join(' → ');
      this._failureSignatures.set(
        sig,
        (this._failureSignatures.get(sig) || 0) + 1
      );
    }

    // Store in memory system
    this._memory.storeInteraction({
      input: outcome.input,
      response: outcome.response,
      toolsUsed: outcome.toolsUsed,
      success: outcome.success,
      timestamp: Date.now(),
      duration: outcome.duration,
      tokenUsage: outcome.tokenUsage,
    });

    // Periodically extract patterns
    if (this._totalTurns % this._extractionInterval === 0) {
      try {
        this._memory.extractPatterns();
      } catch (err) {
        console.warn('[LearningEngine] Pattern extraction failed:', err.message);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Strategy Suggestion
  // ════════════════════════════════════════════════════════════════════

  /**
   * Use past patterns to suggest an approach for the current input.
   *
   * @param {string} input — current user input
   * @param {string} [intent] — classified intent (e.g. 'code_edit', 'question')
   * @returns {{ suggestion: string|null, confidence: number, estimatedIterations: number, warningFromFailure: string|null }}
   */
  suggestStrategy(input, intent) {
    const result = {
      suggestion: null,
      confidence: 0,
      estimatedIterations: 1,
      warningFromFailure: null,
    };

    // Query experience memory for similar past inputs
    const similar = this._memory.queryExperiences(input, 5);
    if (similar.length === 0) return result;

    // Find similar successes
    const successes = similar.filter((e) => e.success);
    const failures = similar.filter((e) => !e.success);

    if (successes.length > 0) {
      // Use the most relevant successful experience as a template
      const best = successes[0];
      const toolSeq = best.toolsUsed.join(', ');
      result.suggestion = toolSeq
        ? `Similar past task succeeded using: ${toolSeq}`
        : 'Similar past task succeeded without tool calls';
      result.confidence = Math.min(
        0.9,
        0.3 + successes.length * 0.15
      );

      // Estimate iterations from successful experiences
      const avgDuration =
        successes.reduce((sum, e) => sum + (e.duration ?? 0), 0) /
        successes.length;
      // Rough heuristic: 1 iteration per ~2s of duration, minimum 1
      result.estimatedIterations = Math.max(
        1,
        Math.round(avgDuration / 2000)
      );
    }

    if (failures.length > 0) {
      const failedTools = failures[0].toolsUsed.join(', ');
      result.warningFromFailure = failedTools
        ? `Similar past task failed when using: ${failedTools}`
        : 'Similar past task failed — consider a different approach';
    }

    // Check pattern memory for applicable patterns
    const patterns = this._memory.applyPatterns(input);
    if (patterns.length > 0) {
      const topPattern = patterns[0];
      if (topPattern.type === 'success_sequence' && topPattern.successRate > 0.7) {
        const seq = topPattern.toolSequence.join(', ');
        result.suggestion = `Learned pattern suggests: ${seq} (${(topPattern.successRate * 100).toFixed(0)}% success rate)`;
        result.confidence = Math.min(0.95, topPattern.successRate);
      }
    }

    return result;
  }

  // ════════════════════════════════════════════════════════════════════
  // Prompt Evolution
  // ════════════════════════════════════════════════════════════════════

  /**
   * Generate prompt hints from learning to append to the system prompt.
   *
   * If patterns show certain tool sequences work well for this type of
   * input, returns a hint string.  Returns null if no applicable hints.
   *
   * @param {string} input — current user input
   * @param {string} [intent] — classified intent
   * @returns {string|null} hint text to append, or null
   */
  evolvePromptHints(input, intent) {
    const patterns = this._memory.applyPatterns(input);
    if (patterns.length === 0) return null;

    const hints = [];

    for (const p of patterns.slice(0, 3)) {
      if (p.type === 'success_sequence' && p.successRate >= 0.7) {
        hints.push(
          `[Learning hint] For similar tasks, the tool sequence "${p.toolSequence.join(' → ')}" has a ${(p.successRate * 100).toFixed(0)}% success rate.`
        );
      } else if (p.type === 'failure_pattern' && p.successRate < 0.3) {
        hints.push(
          `[Learning warning] The tool sequence "${p.toolSequence.join(' → ')}" has a low success rate (${(p.successRate * 100).toFixed(0)}%) for similar tasks — consider alternatives.`
        );
      }
    }

    // Add general session insight if we have enough data
    if (this._totalTurns >= 5) {
      const avgIter = (this._totalIterations / this._totalTurns).toFixed(1);
      const successRate = ((this._successCount / this._totalTurns) * 100).toFixed(0);
      hints.push(
        `[Session stats] ${successRate}% success rate across ${this._totalTurns} turns (avg ${avgIter} iterations/turn).`
      );
    }

    return hints.length > 0 ? hints.join('\n') : null;
  }

  // ════════════════════════════════════════════════════════════════════
  // Session Statistics
  // ════════════════════════════════════════════════════════════════════

  /**
   * Return running session statistics.
   *
   * @returns {{
   *   totalTurns: number,
   *   successRate: number,
   *   avgIterations: number,
   *   avgCost: number,
   *   avgDuration: number,
   *   topToolPatterns: Array<{ tool: string, count: number }>,
   *   failurePatterns: Array<{ sequence: string, count: number }>
   * }}
   */
  getSessionStats() {
    const totalTurns = this._totalTurns || 1; // avoid division by zero

    // Top tool patterns
    const topToolPatterns = [...this._toolUsageCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tool, count]) => ({ tool, count }));

    // Failure patterns
    const failurePatterns = [...this._failureSignatures.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([sequence, count]) => ({ sequence, count }));

    return {
      totalTurns: this._totalTurns,
      successRate: this._totalTurns > 0
        ? this._successCount / this._totalTurns
        : 0,
      avgIterations: this._totalIterations / totalTurns,
      avgCost: this._totalCost / totalTurns,
      avgDuration: this._totalDuration / totalTurns,
      topToolPatterns,
      failurePatterns,
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // Precheck Optimization
  // ════════════════════════════════════════════════════════════════════

  /**
   * Determine whether to skip the precheck LLM call based on learned
   * heuristics and past experience.
   *
   * Combines:
   *  1. Keyword heuristics (ported from
   *     `src/core/agentic/cognitive/agent-response-utils.mjs` `shouldSkipPrecheck()`)
   *  2. Learned experience — if past similar inputs always needed tools
   *
   * @param {string} input — current user input
   * @param {Array<Object>} [history=[]] — conversation history (reserved)
   * @returns {boolean} true if precheck should be skipped
   */
  shouldSkipPrecheck(input, history = []) {
    // ── 1. Keyword heuristics ──────────────────────────────────────
    for (const pattern of this._toolRequiredPatterns) {
      if (pattern.test(input)) return true;
    }

    // Very long inputs (>500 chars) are likely complex tasks
    if (input.length > 500) return true;

    // ── 2. Learned experience ──────────────────────────────────────
    const similar = this._memory.queryExperiences(input, 5);
    if (similar.length >= 3) {
      // If all similar past inputs used tools, skip precheck
      const allUsedTools = similar.every(
        (e) => e.toolsUsed && e.toolsUsed.length > 0
      );
      if (allUsedTools) return true;
    }

    return false;
  }

  // ════════════════════════════════════════════════════════════════════
  // Accessors
  // ════════════════════════════════════════════════════════════════════

  /**
   * Whether learning is enabled (based on `config.memory.experienceEnabled`).
   *
   * @returns {boolean}
   */
  get enabled() {
    return !!(this._config.memory?.experienceEnabled);
  }

  /**
   * Cumulative cost across all turns in this session.
   *
   * @returns {number}
   */
  get totalCost() {
    return this._totalCost;
  }

  // ════════════════════════════════════════════════════════════════════
  // Surface Pipeline Learning
  // ════════════════════════════════════════════════════════════════════

  /**
   * Record the outcome of a surface pipeline mutation.
   *
   * Called by {@link SurfacePipeline} after each mutation attempt
   * (success or failure).  On failure, the error signature is stored
   * so that future mutations can receive proactive fix suggestions.
   *
   * @param {Object} outcome
   * @param {boolean} outcome.success
   * @param {string}  outcome.surface_id
   * @param {string}  outcome.component_name
   * @param {string} [outcome.failedGate]   — which gate failed
   * @param {string[]} [outcome.errors]     — error messages
   * @param {string[]} [outcome.gatesPassed] — gates that passed
   */
  recordSurfaceOutcome(outcome) {
    this._surfaceStats.total++;

    if (outcome.success) {
      this._surfaceStats.success++;
    } else {
      this._surfaceStats.fail++;

      // Build error signature for pattern matching
      if (outcome.errors && outcome.errors.length > 0) {
        const signature = this._buildErrorSignature(outcome.errors);
        const existing = this._surfaceLessons.get(signature);
        if (existing) {
          existing.fixCount++;
        } else {
          this._surfaceLessons.set(signature, {
            fixCount: 1,
            lastFix: '',
            suggestions: [],
          });
        }
      }
    }
  }

  /**
   * Suggest a fix based on previously learned surface failure patterns.
   *
   * @param {string[]} errors — current error messages
   * @returns {string|null} — suggestion text, or null if no pattern matches
   */
  suggestSurfaceFix(errors) {
    if (!errors || errors.length === 0) return null;

    const signature = this._buildErrorSignature(errors);
    const lesson = this._surfaceLessons.get(signature);

    if (lesson && lesson.suggestions.length > 0) {
      return `[Learned from ${lesson.fixCount} past occurrence(s)]: ${lesson.suggestions[0]}`;
    }

    return null;
  }

  /**
   * Build a stable error signature from error messages for pattern matching.
   *
   * @private
   * @param {string[]} errors
   * @returns {string}
   */
  _buildErrorSignature(errors) {
    return errors
      .map((e) => {
        // Normalize: strip line numbers, file paths, and variable details
        return String(e)
          .replace(/line \d+/gi, 'line N')
          .replace(/at \S+/g, 'at <path>')
          .replace(/'[^']+'/g, "'<var>'")
          .substring(0, 100);
      })
      .sort()
      .join('|');
  }

  /**
   * Clean up resources.
   */
  dispose() {
    this._toolUsageCounts.clear();
    this._failureSignatures.clear();
    this._surfaceLessons.clear();
    this._totalTurns = 0;
    this._successCount = 0;
    this._totalIterations = 0;
    this._totalCost = 0;
    this._totalDuration = 0;
    this._doomCount = 0;
    this._precheckSkipCount = 0;
    this._surfaceStats = { total: 0, success: 0, fail: 0 };
  }
}

export default LearningEngine;
