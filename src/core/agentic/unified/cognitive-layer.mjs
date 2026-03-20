/**
 * CognitiveLayer — thin wrapper around CognitiveCore for the unified agent loop.
 *
 * Calls into CognitiveCore at the right phases of the ReAct loop:
 *  1. processInput  — PERCEIVE → ENCODE → ORIENT → ATTEND
 *  2. checkSafety   — coherence / entropy guard rails
 *  3. recall        — holographic memory retrieval
 *  4. validateOutput— ObjectivityGate pass
 *  5. remember      — store interaction in holographic memory
 *  6. tick          — advance the physics simulation
 *
 * CognitiveCore wraps tinyaleph layers: SedenionMemoryField, PRSCLayer,
 * HolographicEncoder, AgencyLayer, BoundaryLayer, SafetyConstraint,
 * TemporalLayer, EntanglementLayer.
 *
 * @module src/core/agentic/unified/cognitive-layer
 */

import { CognitiveCore } from '../cognitive/cognitive.mjs';

/**
 * Thin cognitive middleware that the UnifiedProvider agent loop calls
 * at well-defined phases.  When cognitive processing is disabled the
 * methods are safe no-ops that return neutral defaults.
 */
export class CognitiveLayer {
  /**
   * @param {Object} params
   * @param {Object} params.config — resolved unified config (see {@link config.mjs})
   */
  constructor({ config }) {
    /** @type {Object} */
    this._config = config;

    /** @type {CognitiveCore|null} */
    this._core = null;

    /** @type {boolean} */
    this._enabled = false;
  }

  // ════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ════════════════════════════════════════════════════════════════════

  /**
   * Create the underlying CognitiveCore instance when cognitive processing
   * is enabled in the unified config.
   *
   * @param {Object} [deps={}] — optional dependency overrides forwarded
   *   to CognitiveCore (e.g. primeCount, objectivityThreshold).
   * @returns {void}
   */
  initialize(deps = {}) {
    const cogConfig = this._config.cognitive ?? {};
    if (!cogConfig.enabled) {
      this._enabled = false;
      return;
    }

    try {
      this._core = new CognitiveCore({
        primeCount: deps.primeCount ?? 64,
        objectivityThreshold: deps.objectivityThreshold ?? 0.6,
        ...deps,
      });

      // Warm up the physics simulation with a few initial ticks
      const warmupTicks = cogConfig.physicsTickCount ?? 3;
      for (let i = 0; i < warmupTicks; i++) {
        this._core.tick();
      }

      this._enabled = true;
    } catch (err) {
      console.warn(
        '[CognitiveLayer] CognitiveCore initialization failed — running without cognition:',
        err.message
      );
      this._core = null;
      this._enabled = false;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Processing Phases
  // ════════════════════════════════════════════════════════════════════

  /**
   * Process user input through the cognitive pipeline.
   *
   * Handles Steps 1-4 of the cognitive loop:
   *   PERCEIVE → ENCODE → ORIENT → ATTEND
   *
   * @param {string} input — raw user input text
   * @returns {Object|null} cognitive context object, or null if disabled
   */
  processInput(input) {
    if (!this._enabled || !this._core) return null;
    try {
      return this._core.processInput(input);
    } catch (err) {
      console.warn('[CognitiveLayer] processInput failed:', err.message);
      return null;
    }
  }

  /**
   * Run cognitive safety checks (coherence floor, entropy ceiling, etc.).
   *
   * @returns {Array<Object>} array of violations (empty if safe or disabled)
   */
  checkSafety() {
    if (!this._enabled || !this._core) return [];
    try {
      return this._core.checkSafety();
    } catch (err) {
      console.warn('[CognitiveLayer] checkSafety failed:', err.message);
      return [];
    }
  }

  /**
   * Recall relevant memories by text query from the cognitive holographic store.
   *
   * @param {string} query — search query
   * @param {number} [limit=5] — max results to return
   * @returns {Array<Object>} matched memories sorted by relevance
   */
  recall(query, limit = 5) {
    if (!this._enabled || !this._core) return [];
    try {
      return this._core.recall(query, limit);
    } catch (err) {
      console.warn('[CognitiveLayer] recall failed:', err.message);
      return [];
    }
  }

  /**
   * Validate an LLM response through the ObjectivityGate.
   *
   * @param {string} response — the LLM output text
   * @param {Object} [context={}] — additional context for the gate
   * @returns {{ R: number, passed: boolean, reason?: string }|null}
   *   validation result, or null if disabled
   */
  validateOutput(response, context = {}) {
    if (!this._enabled || !this._core) return null;
    try {
      return this._core.validateOutput(response, context);
    } catch (err) {
      console.warn('[CognitiveLayer] validateOutput failed:', err.message);
      return null;
    }
  }

  /**
   * Store an interaction in cognitive holographic memory.
   *
   * @param {string} input — the user input
   * @param {string} response — the agent response
   */
  remember(input, response) {
    if (!this._enabled || !this._core) return;
    try {
      this._core.remember(input, response);
    } catch (err) {
      console.warn('[CognitiveLayer] remember failed:', err.message);
    }
  }

  /**
   * Advance the physics simulation by `count` timesteps.
   *
   * @param {number} [count=1] — number of ticks to execute
   */
  tick(count = 1) {
    if (!this._enabled || !this._core) return;
    try {
      for (let i = 0; i < count; i++) {
        this._core.tick();
      }
    } catch (err) {
      console.warn('[CognitiveLayer] tick failed:', err.message);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Diagnostics & Accessors
  // ════════════════════════════════════════════════════════════════════

  /**
   * Return full diagnostic state from the underlying CognitiveCore.
   *
   * @returns {Object} diagnostic snapshot (empty object if disabled)
   */
  getDiagnostics() {
    if (!this._enabled || !this._core) return {};
    try {
      return this._core.getDiagnostics();
    } catch (err) {
      console.warn('[CognitiveLayer] getDiagnostics failed:', err.message);
      return {};
    }
  }

  /**
   * Get the cognitive state context string for system prompt injection.
   *
   * @returns {string} human-readable state summary, or empty string
   */
  getStateContext() {
    if (!this._enabled || !this._core) return '';
    try {
      return this._core.getStateContext();
    } catch (err) {
      console.warn('[CognitiveLayer] getStateContext failed:', err.message);
      return '';
    }
  }

  /**
   * Whether cognitive processing is currently active.
   *
   * @returns {boolean}
   */
  get enabled() {
    return this._enabled;
  }

  /**
   * Clean up resources held by the cognitive core.
   */
  dispose() {
    if (this._core) {
      try {
        if (typeof this._core.reset === 'function') {
          this._core.reset();
        }
      } catch (_e) {
        // best-effort cleanup
      }
      this._core = null;
    }
    this._enabled = false;
  }
}

export default CognitiveLayer;
