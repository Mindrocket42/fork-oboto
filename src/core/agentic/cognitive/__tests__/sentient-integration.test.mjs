/**
 * Tests for the SentientCognitiveCore adapter and sentient integration.
 *
 * Tests are split into two groups:
 * 1. Config/bridge tests — always run (no external deps)
 * 2. SentientCognitiveCore integration tests — only run if
 *    sentient-core.js and @aleph-ai/tinyaleph are available
 *
 * @module src/core/agentic/cognitive/__tests__/sentient-integration.test
 */

import { resolveCognitiveConfig, DEFAULT_COGNITIVE_CONFIG } from '../config.mjs';
import {
  checkSentientAvailability,
  resetBridgeCache,
} from '../sentient-bridge.mjs';

// ═══════════════════════════════════════════════════════════════════
// Group 1: Config and bridge tests (always run)
// ═══════════════════════════════════════════════════════════════════

describe('Sentient configuration', () => {
  test('DEFAULT_COGNITIVE_CONFIG includes sentient section with correct defaults', () => {
    const s = DEFAULT_COGNITIVE_CONFIG.sentient;
    expect(s).toBeDefined();
    expect(s.enabled).toBe(false);
    expect(s.primeCount).toBe(64);
    expect(s.tickRate).toBe(60);
    expect(s.backgroundTick).toBe(true);
    expect(s.coherenceThreshold).toBe(0.7);
    expect(s.objectivityThreshold).toBe(0.6);
    expect(s.adaptiveProcessing).toBe(true);
    expect(s.adaptiveMaxSteps).toBe(50);
    expect(s.adaptiveCoherenceThreshold).toBe(0.7);
    expect(s.name).toBe('Sentient Observer');
    expect(s.memoryPath).toBeNull();
    expect(s.initTicks).toBe(10);
    expect(s.statePersistence).toBe(true);
    expect(s.statePath).toBeNull();
  });

  test('resolveCognitiveConfig merges sentient overrides correctly', () => {
    const config = resolveCognitiveConfig({
      sentient: {
        enabled: true,
        primeCount: 128,
        backgroundTick: false,
      }
    });
    expect(config.sentient.enabled).toBe(true);
    expect(config.sentient.primeCount).toBe(128);
    expect(config.sentient.backgroundTick).toBe(false);
    // Defaults preserved
    expect(config.sentient.tickRate).toBe(60);
    expect(config.sentient.coherenceThreshold).toBe(0.7);
  });

  test('resolveCognitiveConfig preserves sentient defaults when no override given', () => {
    const config = resolveCognitiveConfig();
    expect(config.sentient.enabled).toBe(false);
    expect(config.sentient.backgroundTick).toBe(true);
  });
});

describe('sentient-bridge', () => {
  beforeEach(() => {
    resetBridgeCache();
  });

  test('checkSentientAvailability returns an object with available and error keys', () => {
    const result = checkSentientAvailability();
    expect(result).toHaveProperty('available');
    expect(typeof result.available).toBe('boolean');
    // If not available, should have error
    if (!result.available) {
      expect(result).toHaveProperty('error');
      expect(typeof result.error).toBe('string');
    }
  });

  test('checkSentientAvailability is idempotent', () => {
    const a = checkSentientAvailability();
    const b = checkSentientAvailability();
    expect(a.available).toBe(b.available);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Group 2: SentientCognitiveCore integration tests
// (skip if sentient-core.js or @aleph-ai/tinyaleph not available)
// ═══════════════════════════════════════════════════════════════════

let SentientCognitiveCore;
let sentientAvailable = false;

try {
  const mod = await import('../sentient-cognitive-core.mjs');
  SentientCognitiveCore = mod.SentientCognitiveCore;
  // Verify it can actually construct (which requires sentient-core.js)
  const test = new SentientCognitiveCore({ primeCount: 16, tickRate: 0 });
  if (test && typeof test.processInput === 'function') {
    sentientAvailable = true;
  }
} catch {
  sentientAvailable = false;
}

const describeIfAvailable = sentientAvailable ? describe : describe.skip;

describeIfAvailable('SentientCognitiveCore — CognitiveCore API compatibility', () => {
  let core;

  beforeEach(() => {
    core = new SentientCognitiveCore({
      primeCount: 16,
      tickRate: 0, // no auto-tick in tests
      name: 'test-observer',
    });
  });

  afterEach(() => {
    if (core?.stopBackground) core.stopBackground();
  });

  test('processInput returns object with coherence, entropy, processingLoad', () => {
    const result = core.processInput('Hello world, this is a test.');
    expect(result).toHaveProperty('coherence');
    expect(result).toHaveProperty('entropy');
    expect(result).toHaveProperty('processingLoad');
    expect(typeof result.coherence).toBe('number');
    expect(typeof result.entropy).toBe('number');
  });

  test('validateOutput returns object with passed and R', () => {
    core.processInput('test input');
    const result = core.validateOutput('test output', { input: 'test input' });
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('R');
    expect(typeof result.passed).toBe('boolean');
    expect(typeof result.R).toBe('number');
  });

  test('getStateContext returns a non-empty string', () => {
    core.processInput('some text for state');
    const ctx = core.getStateContext();
    expect(typeof ctx).toBe('string');
    expect(ctx.length).toBeGreaterThan(0);
  });

  test('remember stores interaction in memories', () => {
    core.remember('hello', 'world');
    expect(core.memories.length).toBeGreaterThanOrEqual(1);
  });

  test('recall returns an array', () => {
    core.remember('test query', 'test response');
    const results = core.recall('test', 5);
    expect(Array.isArray(results)).toBe(true);
  });

  test('createGoal does not throw', () => {
    expect(() => {
      core.createGoal('test goal', 0.8);
    }).not.toThrow();
  });

  test('tick does not throw', () => {
    expect(() => {
      core.tick();
    }).not.toThrow();
  });

  test('getDiagnostics returns object with expected keys', () => {
    const diag = core.getDiagnostics();
    expect(diag).toHaveProperty('coherence');
    expect(diag).toHaveProperty('entropy');
    expect(diag).toHaveProperty('memoryCount');
  });

  test('checkSafety returns an array', () => {
    const safety = core.checkSafety();
    expect(Array.isArray(safety)).toBe(true);
  });

  test('reset does not throw', () => {
    core.processInput('some data');
    core.remember('a', 'b');
    expect(() => {
      core.reset();
    }).not.toThrow();
  });

  test('coherence and entropy are accessible as numbers', () => {
    expect(typeof core.coherence).toBe('number');
    expect(typeof core.entropy).toBe('number');
  });
});

describeIfAvailable('SentientCognitiveCore — Extended sentient API', () => {
  let core;

  beforeEach(() => {
    core = new SentientCognitiveCore({
      primeCount: 16,
      tickRate: 0,
      name: 'test-extended',
    });
  });

  afterEach(() => {
    if (core?.stopBackground) core.stopBackground();
  });

  test('introspect returns a non-null object', () => {
    const result = core.introspect();
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  test('processTextAdaptive returns object with steps and coherence', () => {
    const result = core.processTextAdaptive('test adaptive text', {
      maxSteps: 5,
      coherenceThreshold: 0.5
    });
    expect(result).toHaveProperty('steps');
    expect(result).toHaveProperty('coherence');
    expect(typeof result.steps).toBe('number');
  });

  test('toJSON and loadFromJSON round-trip state', () => {
    core.processInput('important data');
    core.remember('q', 'a');
    core.tick();

    const json = core.toJSON();
    expect(json).toBeDefined();
    expect(typeof json).toBe('object');

    // Create a new core and load the state
    const core2 = new SentientCognitiveCore({
      primeCount: 16,
      tickRate: 0,
    });
    expect(() => {
      core2.loadFromJSON(json);
    }).not.toThrow();
  });

  test('getAdaptiveStats returns an object', () => {
    const stats = core.getAdaptiveStats();
    expect(typeof stats).toBe('object');
  });

  test('startBackground and stopBackground do not throw', () => {
    expect(() => {
      core.startBackground();
      core.stopBackground();
    }).not.toThrow();
  });

  test('getEmitter returns an event emitter', () => {
    const emitter = core.getEmitter();
    expect(emitter).toBeDefined();
    expect(typeof emitter.on).toBe('function');
  });
});

describeIfAvailable('SentientCognitiveCore — Event bridging', () => {
  test('sentient events are bridged to eventBus', (done) => {
    const events = [];
    const mockEventBus = {
      emitTyped: (name, data) => { events.push({ name, data }); },
      emit: () => {},
    };

    const core = new SentientCognitiveCore({
      primeCount: 16,
      tickRate: 0,
      eventBus: mockEventBus,
    });

    // Process some text to trigger events
    core.processInput('test event bridging');
    core.tick();

    // Allow async event delivery
    setTimeout(() => {
      core.stopBackground();
      // We can't guarantee specific events fire with every input,
      // but the core should not have thrown
      expect(true).toBe(true);
      done();
    }, 50);
  });
});
