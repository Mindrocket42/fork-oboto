/**
 * SafetyLayer — safety check layer wrapping cognitive safety + doom detection.
 *
 * Combines two protection mechanisms:
 *  1. **Cognitive safety** — delegated to {@link CognitiveLayer.checkSafety}
 *     for coherence / entropy boundary violations.
 *  2. **Doom detection** — ported from {@link DoomDetector} in
 *     `src/core/agentic/megacode/doom-detector.mjs`.  Detects infinite
 *     tool-call loops by tracking recent calls in a sliding window.
 *
 * The doom detector supports both the original DoomDetector `check(tool, args)`
 * pattern and an additional `checkDoom(history, toolResults, iteration)`
 * higher-level API that scans recent history for doom patterns.
 *
 * @module src/core/agentic/unified/safety-layer
 */

/**
 * Safety guard that the UnifiedProvider agent loop calls before and during
 * tool execution to prevent runaway loops and cognitive instability.
 */
export class SafetyLayer {
  /**
   * @param {Object} params
   * @param {Object} params.config — resolved unified config
   * @param {import('./cognitive-layer.mjs').CognitiveLayer} params.cognitiveLayer
   */
  constructor({ config, cognitiveLayer }) {
    /** @type {Object} */
    this._config = config;

    /** @type {import('./cognitive-layer.mjs').CognitiveLayer} */
    this._cognitiveLayer = cognitiveLayer;

    /**
     * Sliding window of recent tool call dedup keys.
     * @type {Array<{ key: string, toolName: string }>}
     */
    this._recentCalls = [];

    /** @type {number} */
    this._windowSize = 10;

    /** @type {number} */
    this._threshold = 3;

    /** @type {Array<RegExp>} compiled doom patterns */
    this._doomPatterns = this._buildDoomPatterns(config);
  }

  // ════════════════════════════════════════════════════════════════════
  // Cognitive Safety
  // ════════════════════════════════════════════════════════════════════

  /**
   * Run cognitive safety checks (coherence floor, entropy ceiling).
   *
   * @param {string} _input — current user input (reserved for future use)
   * @returns {{ safe: boolean, violations: Array<Object>, shouldBlock: boolean }}
   */
  checkSafety(_input) {
    const safetyConfig = this._config.safety ?? {};
    if (!safetyConfig.enabled) {
      return { safe: true, violations: [], shouldBlock: false };
    }

    const violations = this._cognitiveLayer
      ? this._cognitiveLayer.checkSafety()
      : [];

    const shouldBlock =
      safetyConfig.blockOnViolation &&
      violations.some((v) => v.response === 'block');

    return {
      safe: violations.length === 0,
      violations,
      shouldBlock,
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // Doom Detection
  // ════════════════════════════════════════════════════════════════════

  /**
   * Check for doom-loop patterns in recent tool call history.
   *
   * Doom detection combines two strategies (ported from
   * `src/core/agentic/megacode/doom-detector.mjs`):
   *
   *  1. **Consecutive identical calls** — the same tool+args dedup key
   *     appearing `threshold` times in a row.
   *  2. **Pattern matching** — regex patterns from `config.doom.patterns`
   *     tested against recent dedup keys.
   *  3. **Empty response detection** — flagged when tool results are
   *     repeatedly empty.
   *  4. **Iteration ceiling** — hard limit from `config.loop.maxIterations`.
   *
   * @param {Array<Object>} history — conversation history messages
   * @param {Array<Object>} toolResults — recent tool call results
   *   (`[{ toolName, args, result }]`)
   * @param {number} iteration — current loop iteration index
   * @returns {{ doomed: boolean, reason: string|null, pattern: string|null }}
   */
  checkDoom(history, toolResults, iteration) {
    const doomConfig = this._config.doom ?? {};
    if (!doomConfig.enabled) {
      return { doomed: false, reason: null, pattern: null };
    }

    const maxIterations = this._config.loop?.maxIterations ?? 25;

    // ── 1. Iteration ceiling ─────────────────────────────────────────
    if (iteration >= maxIterations) {
      return {
        doomed: true,
        reason: `Reached maximum iteration limit (${maxIterations})`,
        pattern: 'max_iterations',
      };
    }

    // ── 2. Record latest tool calls & check consecutive duplicates ───
    for (const tr of toolResults) {
      const key = this._makeKey(tr.toolName, tr.args);
      this._recentCalls.push({ key, toolName: tr.toolName });
      if (this._recentCalls.length > this._windowSize) {
        this._recentCalls.shift();
      }
    }

    // Check for consecutive identical calls
    if (this._recentCalls.length >= this._threshold) {
      const lastKey = this._recentCalls[this._recentCalls.length - 1]?.key;
      let consecutive = 0;
      for (let i = this._recentCalls.length - 1; i >= 0; i--) {
        if (this._recentCalls[i].key === lastKey) {
          consecutive++;
        } else {
          break;
        }
      }
      if (consecutive >= this._threshold) {
        return {
          doomed: true,
          reason: `Tool "${this._recentCalls[this._recentCalls.length - 1].toolName}" called ${consecutive} times with identical arguments`,
          pattern: 'consecutive_identical',
        };
      }
    }

    // ── 3. Regex pattern matching against recent keys ────────────────
    for (const re of this._doomPatterns) {
      const matchCount = this._recentCalls.filter((c) => re.test(c.key)).length;
      if (matchCount >= this._threshold) {
        return {
          doomed: true,
          reason: `Doom pattern matched: ${re.source} (${matchCount} hits in window)`,
          pattern: re.source,
        };
      }
    }

    // ── 4. Empty response detection ──────────────────────────────────
    const recentEmpty = toolResults.filter((tr) => {
      const r = tr.result;
      return r === '' || r === null || r === undefined || r === '{}' || r === '[]';
    });
    if (recentEmpty.length >= this._threshold) {
      return {
        doomed: true,
        reason: `${recentEmpty.length} consecutive empty tool results`,
        pattern: 'empty_results',
      };
    }

    return { doomed: false, reason: null, pattern: null };
  }

  /**
   * Record a single tool call for doom tracking (lower-level API matching
   * the original DoomDetector interface).
   *
   * @param {string} toolName
   * @param {Object} args
   * @returns {{ isDoom: boolean, tool?: string, count?: number }}
   */
  recordToolCall(toolName, args) {
    const key = this._makeKey(toolName, args);
    this._recentCalls.push({ key, toolName });
    if (this._recentCalls.length > this._windowSize) {
      this._recentCalls.shift();
    }

    let consecutive = 0;
    for (let i = this._recentCalls.length - 1; i >= 0; i--) {
      if (this._recentCalls[i].key === key) {
        consecutive++;
      } else {
        break;
      }
    }

    if (consecutive >= this._threshold) {
      return { isDoom: true, tool: toolName, count: consecutive };
    }
    return { isDoom: false, count: consecutive };
  }

  /**
   * Reset the doom detector — call at the start of each turn.
   */
  reset() {
    this._recentCalls = [];
  }

  // ════════════════════════════════════════════════════════════════════
  // Accessors
  // ════════════════════════════════════════════════════════════════════

  /**
   * Whether safety checks are active.
   *
   * @returns {boolean}
   */
  get enabled() {
    return !!(this._config.safety?.enabled || this._config.doom?.enabled);
  }

  // ════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ════════════════════════════════════════════════════════════════════

  /**
   * Compile regex patterns from `config.doom.patterns`.
   *
   * Accepts both `RegExp` instances and plain strings.
   *
   * @param {Object} config — resolved unified config
   * @returns {Array<RegExp>}
   * @private
   */
  _buildDoomPatterns(config) {
    const raw = config.doom?.patterns ?? [];
    const compiled = [];
    for (const p of raw) {
      try {
        if (p instanceof RegExp) {
          compiled.push(p);
        } else if (typeof p === 'string') {
          compiled.push(new RegExp(p));
        }
      } catch (err) {
        console.warn('[SafetyLayer] Invalid doom pattern, skipping:', p, err.message);
      }
    }
    return compiled;
  }

  /**
   * Generate a dedup key from tool name + args (mirrors DoomDetector._makeKey).
   *
   * @param {string} toolName
   * @param {Object} args
   * @returns {string}
   * @private
   */
  _makeKey(toolName, args) {
    try {
      return `${toolName}::${JSON.stringify(args)}`;
    } catch {
      return `${toolName}::__unserializable__`;
    }
  }
}

export default SafetyLayer;
