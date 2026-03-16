/**
 * SentientCognitiveCore — adapter that wraps the full SentientObserver
 * and exposes the same API surface as CognitiveCore.
 *
 * This allows the CognitiveAgent to seamlessly upgrade from the lightweight
 * CognitiveCore to the full sentient-core.js observer by changing a single
 * config flag (`sentient.enabled: true`), without modifying any of the
 * 11-step cognitive loop logic.
 *
 * The adapter:
 *  - Proxies processInput() → SentientObserver.processText() + tick()
 *  - Proxies validateOutput() → BoundaryLayer.objectivityGate.check()
 *  - Proxies remember() → SentientObserver.memory.store()
 *  - Proxies recall() → SentientObserver.memory.recallBySimilarity()
 *  - Proxies tick() → SentientObserver.tick()
 *  - Exposes getStateContext() with richer SMF/temporal/entanglement data
 *  - Exposes getDiagnostics() with full observer status
 *  - Bridges SentientObserver events to an optional eventBus
 *
 * Additionally provides sentient-specific APIs not on CognitiveCore:
 *  - processTextAdaptive() — ACT-style adaptive processing
 *  - introspect() — deep observer introspection
 *  - getAdaptiveStats() — adaptive processing history
 *  - startBackground() / stopBackground() — background tick lifecycle
 *  - toJSON() / loadFromJSON() — state serialization
 *
 * @module src/core/agentic/cognitive/sentient-cognitive-core
 */

import { loadSentientCore, loadTinyAlephBackend } from './sentient-bridge.mjs';

// SMF_AXES from tinyaleph for labeling semantic axes — loaded lazily
// to avoid top-level await blocking module evaluation
let _smfAxesPromise = null;
let _smfAxesResolved = null;
let _smfAxesLoaded = false;

function _loadSMFAxesLabels() {
  if (_smfAxesLoaded) return;
  if (!_smfAxesPromise) {
    _smfAxesPromise = import('@aleph-ai/tinyaleph/observer')
      .then(m => { _smfAxesResolved = m.SMF_AXES || null; })
      .catch((err) => {
        console.warn('[SentientCognitiveCore] Could not load SMF axis labels:', err.message);
        _smfAxesResolved = null;
      })
      .finally(() => { _smfAxesLoaded = true; });
  }
}

function getSMFAxesLabels() {
  _loadSMFAxesLabels();
  return _smfAxesResolved;
}

class SentientCognitiveCore {
  /**
   * @param {Object} config - Sentient configuration
   * @param {number}  [config.primeCount=64]
   * @param {number}  [config.tickRate=60]
   * @param {boolean} [config.backgroundTick=true]
   * @param {boolean} [config.adaptiveProcessing=true]
   * @param {number}  [config.adaptiveMaxSteps=50]
   * @param {number}  [config.adaptiveCoherenceThreshold=0.7]
   * @param {number}  [config.coherenceThreshold=0.7]
   * @param {number}  [config.objectivityThreshold=0.6]
   * @param {string}  [config.memoryPath]
   * @param {string}  [config.name='Sentient Observer']
   * @param {import('events').EventEmitter} [config.eventBus]
   */
  constructor(config = {}) {
    this.config = config;

    // Load the CJS SentientObserver via the bridge
    const { SentientObserver } = loadSentientCore();
    const backend = loadTinyAlephBackend({ primeCount: config.primeCount || 64 });

    // Instantiate the full SentientObserver
    this.observer = new SentientObserver(backend, {
      primeCount: config.primeCount || 64,
      tickRate: config.tickRate || 60,
      coherenceThreshold: config.coherenceThreshold || 0.7,
      name: config.name || 'Sentient Observer',
      memoryPath: config.memoryPath,
      adaptiveProcessing: config.adaptiveProcessing !== false,
      adaptiveMaxSteps: config.adaptiveMaxSteps || 50,
      adaptiveCoherenceThreshold: config.adaptiveCoherenceThreshold || 0.7,
    });

    // Store the backend for direct text encoding
    this.backend = backend;

    // ── CognitiveCore-compatible state ──────────────────────────────
    // These mirror the public properties that CognitiveCore exposes
    this.tickCount = 0;
    this.coherence = 0;
    this.entropy = 0;
    this.lastInputPrimes = [];
    this.interactionCount = 0;

    // CognitiveCore exposes memories[] and maxMemories
    // We proxy to SentientObserver.memory but keep a shallow list
    // for compatibility with recall() prime-overlap scoring
    this.memories = [];
    this.maxMemories = 200;

    // Safety constraints — proxy to SentientObserver.safety
    this.safetyConstraints = [];

    // Event bus bridge (optional)
    this._eventBus = config.eventBus || null;
    /** @type {Array<{event: string, handler: Function}>} */
    this._eventBridgeListeners = [];
    if (this._eventBus) {
      this._wireEvents();
    }

    // Background tick state
    this._backgroundRunning = false;

    // Eagerly start SMF axes loading so it resolves before first
    // getStateContext() call.  Callers should await ensureReady()
    // after construction for guaranteed availability.
    _loadSMFAxesLabels();
  }

  /**
   * Wait for async initialisation to complete (SMF axis label import).
   * Must be called (and awaited) after construction before the first
   * call to getStateContext() to guarantee axis labels are available.
   *
   * @returns {Promise<void>}
   */
  async ensureReady() {
    if (_smfAxesPromise) {
      await _smfAxesPromise;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // CognitiveCore API — drop-in compatible methods
  // ════════════════════════════════════════════════════════════════════

  /**
   * Process input text through the full sentient observer pipeline.
   * Compatible with CognitiveCore.processInput() return shape.
   *
   * @param {string} text
   * @returns {Object} { primes, coherence, entropy, smfOrientation, activePrimes, topFocus, activeGoals, processingLoad, interactionCount }
   */
  processInput(text) {
    // Pause background tick to avoid interleaving during settle ticks
    const wasBg = this._backgroundRunning;
    if (wasBg) this.stopBackground();

    try {
      // Feed text into the observer
      this.observer.processText(text);

      // Run a few ticks to let oscillators settle (matches CognitiveCore behavior)
      const settleTicks = this.config.settleTicksPerInput ?? 5;
      for (let i = 0; i < settleTicks; i++) {
        this._forceTick();
      }

      // Sync state from observer
      this._syncState();
      this.interactionCount++;

      const state = this.observer.currentState;
      const agencyStats = this.observer.agency.getStats();

      return {
        primes: state.activePrimes || [],
        coherence: this.coherence,
        entropy: this.entropy,
        smfOrientation: state.smfOrientation
          ? Array.from(state.smfOrientation)
          : null,
        activePrimes: (state.activePrimes || []).slice(0, 10),
        topFocus: state.topFocus || null,
        activeGoals: agencyStats.activeGoals || 0,
        processingLoad: state.processingLoad || 0,
        interactionCount: this.interactionCount,
      };
    } finally {
      // Resume background tick if it was running — must happen even if
      // processText/tick threw, otherwise the loop is permanently stopped.
      if (wasBg) this.startBackground();
    }
  }

  /**
   * Validate LLM output through the ObjectivityGate.
   * Compatible with CognitiveCore.validateOutput() return shape.
   *
   * @param {string} output
   * @param {Object} context
   * @returns {Object} { passed, R, reason, decoderResults }
   */
  validateOutput(output, context = {}) {
    try {
      const gateResult = this.observer.boundary.objectivityGate.check(
        output,
        context
      );
      return {
        passed: gateResult.shouldBroadcast,
        R: gateResult.R,
        reason: gateResult.reason,
        decoderResults: gateResult.decoderResults,
      };
    } catch (_e) {
      // Fallback if objectivityGate is not available on the boundary
      return { passed: true, R: 1.0, reason: 'gate_unavailable', decoderResults: [] };
    }
  }

  /**
   * Build a human-readable cognitive-state summary for the LLM system prompt.
   * Enhanced version with richer sentient observer data.
   *
   * @returns {string}
   */
  getStateContext() {
    this._syncState();

    const smfAxes = getSMFAxesLabels() || [];
    const orientation = this.observer.smf.s
      ? Array.from(this.observer.smf.s)
      : new Array(16).fill(0.5);

    const topAxes = orientation
      .map((v, i) => ({
        axis: smfAxes[i]?.name || `axis_${i}`,
        value: v,
      }))
      .sort((a, b) => Math.abs(b.value - 0.5) - Math.abs(a.value - 0.5))
      .slice(0, 5);

    const topGoal = this.observer.agency.getTopGoal();
    const topFocus = this.observer.agency.getTopFocus();
    const metacog = this.observer.agency.selfModel;

    let context = `[Cognitive State — Sentient Observer]\n`;
    context += `Coherence: ${this.coherence.toFixed(3)} | Entropy: ${this.entropy.toFixed(3)}\n`;
    context += `Processing Load: ${(metacog.processingLoad * 100).toFixed(0)}% | Confidence: ${(metacog.confidenceLevel * 100).toFixed(0)}%\n`;
    context += `Dominant Semantic Axes: ${topAxes.map((a) => `${a.axis}=${a.value.toFixed(2)}`).join(', ')}\n`;

    // Sentient-specific enrichment
    const smfEntropy = this.observer.smf.smfEntropy?.() ?? 0;
    context += `SMF Entropy: ${smfEntropy.toFixed(3)}\n`;

    if (topGoal) {
      context += `Active Goal: ${topGoal.description} (${(topGoal.progress * 100).toFixed(0)}% complete)\n`;
    }
    if (topFocus) {
      context += `Attention Focus: ${topFocus.target} (intensity=${topFocus.intensity.toFixed(2)})\n`;
    }

    // Temporal state
    const currentMoment = this.observer.temporal.currentMoment;
    if (currentMoment) {
      context += `Current Moment: ${currentMoment.id} (trigger: ${currentMoment.trigger})\n`;
    }

    // Entanglement state
    const currentPhrase = this.observer.entanglement.currentPhrase;
    if (currentPhrase) {
      context += `Active Phrase: ${currentPhrase.id}\n`;
    }

    // Safety level
    const safetyLevel = this.observer.currentState.safetyLevel || 'normal';
    if (safetyLevel !== 'normal') {
      context += `Safety Level: ${safetyLevel}\n`;
    }

    // Emotional valence
    if (metacog.emotionalValence !== undefined && metacog.emotionalValence !== 0) {
      const valenceLabel = metacog.emotionalValence > 0.3
        ? 'positive'
        : metacog.emotionalValence < -0.3
          ? 'negative'
          : 'neutral';
      context += `Emotional Valence: ${metacog.emotionalValence.toFixed(2)} (${valenceLabel})\n`;
    }

    context += `Interaction #${this.interactionCount} | Tick #${this.tickCount}\n`;
    context += `Background Processing: ${this._backgroundRunning ? 'active' : 'paused'}\n`;

    return context;
  }

  /**
   * Store an interaction in sentient memory.
   * Compatible with CognitiveCore.remember() API.
   *
   * @param {string} input
   * @param {string} output
   */
  remember(input, output) {
    // Store via sentient memory with full context
    try {
      this.observer.memory.store(input + ' ' + output, {
        type: 'interaction',
        input: input.substring(0, 200),
        output: output.substring(0, 200),
        activePrimes: this.observer.currentState.activePrimes || [],
        momentId: this.observer.temporal.currentMoment?.id,
        phraseId: this.observer.entanglement.currentPhrase?.id,
        smf: this.observer.smf.s ? Array.from(this.observer.smf.s) : null,
        importance: 0.7,
        coherence: this.coherence,
        interactionId: this.interactionCount,
      });
    } catch (_e) {
      // Fallback: store in simple memories array
      this.memories.push({
        timestamp: Date.now(),
        input: input.substring(0, 200),
        output: output.substring(0, 200),
        coherence: this.coherence,
        interactionId: this.interactionCount,
      });
      if (this.memories.length > this.maxMemories) {
        this.memories.shift();
      }
    }

    // Force a moment for this interaction
    try {
      this.observer.temporal.forceMoment(
        {
          coherence: this.coherence,
          entropy: this.entropy,
          activePrimes: (this.observer.currentState.activePrimes || []).slice(0, 5),
        },
        'interaction'
      );
    } catch (_e) {
      // TemporalLayer may not support forceMoment
    }
  }

  /**
   * Recall relevant memories by text query.
   * Compatible with CognitiveCore.recall() return shape.
   *
   * @param {string} query
   * @param {number} limit
   * @returns {Array<{ input: string, output: string, coherence: number, timestamp: number, score: number }>}
   */
  recall(query, limit = 5) {
    try {
      // Use sentient memory's similarity-based recall
      const primeState = this.backend.textToOrderedState(query);
      const results = this.observer.memory.recallBySimilarity(primeState, {
        threshold: 0.2,
        maxResults: limit,
      });

      return results.map((r) => ({
        input: r.trace?.content?.input || r.trace?.content || '',
        output: r.trace?.content?.output || '',
        coherence: r.trace?.metadata?.coherence || 0,
        timestamp: r.trace?.timestamp || Date.now(),
        score: r.similarity || 0,
      }));
    } catch (_e) {
      // Fallback to simple memory search (mirrors CognitiveCore.recall)
      const queryWords = new Set(
        query.toLowerCase().split(/\s+/).filter((w) => w.length > 0)
      );

      const scored = this.memories.map((mem) => {
        const memWords = new Set(
          `${mem.input} ${mem.output}`.toLowerCase().split(/\s+/)
        );
        let overlap = 0;
        for (const w of queryWords) {
          if (memWords.has(w)) overlap++;
        }
        const recency =
          1 / (1 + (Date.now() - mem.timestamp) / (1000 * 60 * 60));
        return { ...mem, score: overlap * 0.7 + recency * 0.3 };
      });

      return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .filter((m) => m.score > 0);
    }
  }

  /**
   * Create a goal from user intent.
   * Compatible with CognitiveCore.createGoal() API.
   *
   * @param {string} description
   * @param {number} priority
   * @returns {Object|null}
   */
  createGoal(description, priority = 0.8) {
    return this.observer.agency.createExternalGoal(description, { priority });
  }

  /**
   * Advance physics simulation by one timestep.
   * Compatible with CognitiveCore.tick() API.
   */
  tick() {
    this._forceTick();
    this._syncState();
  }

  /**
   * Return full diagnostic state.
   * Compatible with CognitiveCore.getDiagnostics() return shape,
   * plus additional sentient-specific fields.
   *
   * @returns {Object}
   */
  getDiagnostics() {
    this._syncState();

    const status = this.observer.getStatus();

    return {
      // CognitiveCore-compatible fields
      tickCount: this.tickCount,
      coherence: this.coherence,
      entropy: this.entropy,
      interactionCount: this.interactionCount,
      memoryCount: status.memory?.totalTraces || this.memories.length,
      agencyStats: status.agency,
      boundaryStats: status.boundary,
      smfOrientation: this.observer.smf.s
        ? Array.from(this.observer.smf.s)
        : null,

      // Sentient-specific fields
      sentient: true,
      running: status.running,
      uptime: status.uptime,
      backgroundTick: this._backgroundRunning,
      temporal: status.temporal,
      entanglement: status.entanglement,
      safety: status.safety,
      events: status.events,
      smfEntropy: this.observer.smf.smfEntropy?.() ?? null,
      totalAmplitude: this.observer.currentState.totalAmplitude,
      safetyLevel: this.observer.currentState.safetyLevel,
    };
  }

  /**
   * Check safety constraints.
   * Compatible with CognitiveCore.checkSafety() return shape.
   *
   * @returns {Array} Array of violations (empty if safe)
   */
  checkSafety() {
    try {
      const result = this.observer.safety.checkConstraints({
        coherence: this.coherence,
        entropy: this.entropy,
        totalAmplitude: this.observer.currentState.totalAmplitude,
        smf: this.observer.smf,
        processingLoad: this.observer.currentState.processingLoad,
        goals: this.observer.agency.goals,
      });

      if (!result.safe) {
        return result.violations.map((v) => ({
          violated: true,
          constraint: v.constraint,
        }));
      }
      return [];
    } catch (_e) {
      return [];
    }
  }

  /**
   * Reset all state to initial conditions.
   * Compatible with CognitiveCore.reset() API.
   */
  reset() {
    this.stopBackground();

    // Remove bridged event listeners before observer.reset() to prevent
    // duplicates if _wireEvents() is called again after re-initialisation.
    for (const { event, handler } of this._eventBridgeListeners) {
      try { this.observer.removeListener(event, handler); } catch (_e) { /* ignore */ }
    }
    this._eventBridgeListeners = [];

    this.observer.reset();
    this.tickCount = 0;
    this.coherence = 0;
    this.entropy = 0;
    this.lastInputPrimes = [];
    this.interactionCount = 0;
    this.memories = [];
  }

  // ════════════════════════════════════════════════════════════════════
  // Sentient-specific extended API
  // ════════════════════════════════════════════════════════════════════

  /**
   * Process text with adaptive (ACT-style) depth.
   * Uses coherenceGatedCompute to determine processing depth.
   *
   * @param {string} text
   * @param {Object} [options]
   * @returns {Object} Processing result with steps, halted, coherence, etc.
   */
  processTextAdaptive(text, options = {}) {
    return this.observer.processTextAdaptive(text, options);
  }

  /**
   * Get deep introspection report from the observer.
   *
   * @returns {Object}
   */
  introspect() {
    return this.observer.introspect();
  }

  /**
   * Get adaptive processing statistics.
   *
   * @returns {Object}
   */
  getAdaptiveStats() {
    return this.observer.getAdaptiveStats();
  }

  /**
   * Get the full observer status.
   *
   * @returns {Object}
   */
  getStatus() {
    return this.observer.getStatus();
  }

  /**
   * Start the background tick loop.
   * SentientObserver runs a continuous setInterval at tickRate Hz.
   */
  startBackground() {
    if (this._backgroundRunning) return;
    this.observer.start();
    this._backgroundRunning = true;
  }

  /**
   * Stop the background tick loop.
   */
  stopBackground() {
    if (!this._backgroundRunning) return;
    this.observer.stop();
    this._backgroundRunning = false;
  }

  /**
   * Check if background tick is running.
   * @returns {boolean}
   */
  isBackgroundRunning() {
    return this._backgroundRunning;
  }

  /**
   * Save observer state to JSON.
   *
   * @returns {Object}
   */
  toJSON() {
    return {
      observerState: this.observer.toJSON(),
      interactionCount: this.interactionCount,
      memories: this.memories.slice(-50), // Keep last 50 simple memories as backup
    };
  }

  /**
   * Load observer state from JSON.
   *
   * @param {Object} data
   */
  loadFromJSON(data) {
    if (data.observerState) {
      this.observer.loadFromJSON(data.observerState);
    }
    if (data.interactionCount !== undefined) {
      this.interactionCount = data.interactionCount;
    }
    if (data.memories) {
      this.memories = data.memories;
    }
    this._syncState();
  }

  /**
   * Get the SentientObserver's event emitter for direct subscription.
   *
   * @returns {Object} AlephEventEmitter
   */
  getEmitter() {
    return this.observer.getEmitter();
  }

  /**
   * Create an evolution stream for async iteration over observer state.
   *
   * @param {Object} [options]
   * @returns {Object} EvolutionStream
   */
  createEvolutionStream(options = {}) {
    return this.observer.createEvolutionStream(options);
  }

  // ════════════════════════════════════════════════════════════════════
  // Internal Methods
  // ════════════════════════════════════════════════════════════════════

  /**
   * Execute a single tick on the SentientObserver, temporarily enabling
   * `running` if the background loop is not active.
   *
   * JavaScript is single-threaded, so the background setInterval callback
   * cannot fire during this synchronous call — no need to stop/restart the
   * interval (which would destroy and recreate it, causing unnecessary
   * overhead and a brief window where background events could be missed).
   *
   * @private
   */
  _forceTick() {
    const wasRunning = this.observer.running;
    if (!wasRunning) {
      this.observer.running = true;
    }
    try {
      this.observer.tick();
    } finally {
      if (!wasRunning) {
        this.observer.running = false;
      }
    }
  }

  /**
   * Sync local state from the SentientObserver's current state.
   * @private
   */
  _syncState() {
    const state = this.observer.currentState;
    this.tickCount = this.observer.tickCount;
    this.coherence = state.coherence || 0;
    this.entropy = state.entropy || 0;
    this.lastInputPrimes = state.activePrimes || [];
  }

  /**
   * Wire SentientObserver events to the ai-man eventBus.
   * Stores listener references in `_eventBridgeListeners` so they can
   * be removed cleanly in `reset()` to prevent listener accumulation.
   * @private
   */
  _wireEvents() {
    if (!this._eventBus) return;

    const bridge = (sentientEvent, busEvent) => {
      const handler = (data) => {
        try {
          if (typeof this._eventBus.emitTyped === 'function') {
            this._eventBus.emitTyped(busEvent, data);
          } else {
            this._eventBus.emit(busEvent, data);
          }
        } catch (_e) {
          // Swallow event emission errors
        }
      };
      this.observer.on(sentientEvent, handler);
      this._eventBridgeListeners.push({ event: sentientEvent, handler });
    };

    // Map sentient events → ai-man eventBus events
    bridge('moment', 'sentient:moment');
    bridge('phrase', 'sentient:phrase');
    bridge('coherence:high', 'sentient:coherence-high');
    bridge('coherence:low', 'sentient:coherence-low');
    bridge('entropy:high', 'sentient:entropy-high');
    bridge('entropy:low', 'sentient:entropy-low');
    bridge('sync', 'sentient:sync');
    bridge('adaptive:complete', 'sentient:adaptive-complete');
    bridge('goal:created', 'sentient:goal-created');
    bridge('action:executed', 'sentient:action-executed');
    bridge('action:blocked', 'sentient:action-blocked');
    bridge('safety:violation', 'sentient:safety-violation');
    bridge('emergency', 'sentient:emergency');
    bridge('error', 'sentient:error');
  }
}

export { SentientCognitiveCore };
export default SentientCognitiveCore;
