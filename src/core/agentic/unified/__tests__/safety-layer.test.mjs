/**
 * Unit tests for SafetyLayer doom-loop detection.
 *
 * Verifies that the doom detector counts distinct *iterations* (turns)
 * rather than individual tool-call entries, preventing false positives
 * when multiple same-type tools are batched in a single turn.
 *
 * @see src/core/agentic/unified/safety-layer.mjs
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const { SafetyLayer } = await import('../safety-layer.mjs');

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a minimal config with doom detection enabled. */
function makeConfig(overrides = {}) {
  return {
    safety: { enabled: false },
    doom: {
      enabled: true,
      patterns: [/^run_command::/, /^read_file::/],
      ...overrides.doom,
    },
    loop: { maxIterations: 25, ...overrides.loop },
    ...overrides,
  };
}

/** Create a SafetyLayer with no cognitive layer. */
function makeSafety(configOverrides = {}) {
  return new SafetyLayer({
    config: makeConfig(configOverrides),
    cognitiveLayer: null,
  });
}

/** Shorthand for a tool result entry. */
function tr(toolName, args, result = 'ok') {
  return { toolName, args, result };
}

// ═════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════

describe('SafetyLayer — doom detection', () => {
  let safety;

  beforeEach(() => {
    safety = makeSafety();
  });

  // ── False-positive scenario from the issue ──────────────────────

  describe('batched same-turn tool calls (false positive fix)', () => {
    it('does NOT trigger doom when 6 run_command calls happen in 1 iteration', () => {
      // Simulate: agent batches 6 different curl commands in iteration 1
      const batch = [
        tr('run_command', { cmd: 'curl https://api.binance.com/ticker/24hr?symbol=BTCUSDT' }),
        tr('run_command', { cmd: 'curl https://api.binance.us/ticker/24hr?symbol=BTCUSDT' }),
        tr('run_command', { cmd: 'curl https://api.binance.com/klines?symbol=BTCUSDT' }),
        tr('run_command', { cmd: 'curl https://api.binance.us/klines?symbol=BTCUSDT' }),
        tr('run_command', { cmd: 'curl https://data.binance.vision/klines/BTCUSDT' }),
        tr('run_command', { cmd: 'curl https://api.coingecko.com/ohlc?id=bitcoin' }),
      ];

      const result = safety.checkDoom([], batch, /* iteration= */ 1);
      expect(result.doomed).toBe(false);
    });

    it('does NOT trigger doom when 4 read_file calls happen in 1 iteration', () => {
      const batch = [
        tr('read_file', { path: 'a.txt' }),
        tr('read_file', { path: 'b.txt' }),
        tr('read_file', { path: 'c.txt' }),
        tr('read_file', { path: 'd.txt' }),
      ];

      const result = safety.checkDoom([], batch, /* iteration= */ 1);
      expect(result.doomed).toBe(false);
    });
  });

  // ── True positive: actual doom loops ────────────────────────────

  describe('actual doom loops (cross-iteration)', () => {
    it('triggers doom when run_command appears across 3 different iterations', () => {
      // Iteration 1: one run_command
      safety.checkDoom([], [tr('run_command', { cmd: 'curl A' })], 1);
      // Iteration 2: one run_command
      safety.checkDoom([], [tr('run_command', { cmd: 'curl B' })], 2);
      // Iteration 3: one run_command — should trigger (3 iterations with ^run_command::)
      const result = safety.checkDoom([], [tr('run_command', { cmd: 'curl C' })], 3);
      expect(result.doomed).toBe(true);
      expect(result.pattern).toBe('^run_command::');
    });

    it('triggers doom when same tool+args repeat across 3 iterations (consecutive_identical)', () => {
      const sameArgs = { path: 'x.txt' };
      safety.checkDoom([], [tr('read_file', sameArgs)], 1);
      safety.checkDoom([], [tr('read_file', sameArgs)], 2);
      const result = safety.checkDoom([], [tr('read_file', sameArgs)], 3);
      expect(result.doomed).toBe(true);
      expect(result.pattern).toBe('consecutive_identical');
    });
  });

  // ── Mixed scenarios ─────────────────────────────────────────────

  describe('mixed batched + cross-iteration', () => {
    it('does NOT trigger doom with 2 iterations of batched run_commands', () => {
      // Iteration 1: batch of 3
      safety.checkDoom([], [
        tr('run_command', { cmd: 'a' }),
        tr('run_command', { cmd: 'b' }),
        tr('run_command', { cmd: 'c' }),
      ], 1);
      // Iteration 2: batch of 3
      const result = safety.checkDoom([], [
        tr('run_command', { cmd: 'd' }),
        tr('run_command', { cmd: 'e' }),
        tr('run_command', { cmd: 'f' }),
      ], 2);
      // Only 2 distinct iterations → below threshold of 3
      expect(result.doomed).toBe(false);
    });

    it('DOES trigger doom with 3 iterations of batched run_commands', () => {
      safety.checkDoom([], [tr('run_command', { cmd: 'a' })], 1);
      safety.checkDoom([], [tr('run_command', { cmd: 'b' })], 2);
      const result = safety.checkDoom([], [
        tr('run_command', { cmd: 'c' }),
        tr('run_command', { cmd: 'd' }),
      ], 3);
      expect(result.doomed).toBe(true);
      expect(result.reason).toMatch(/3 iterations/);
    });
  });

  // ── Iteration ceiling ──────────────────────────────────────────

  describe('iteration ceiling', () => {
    it('triggers doom at maxIterations', () => {
      const result = safety.checkDoom([], [], 25);
      expect(result.doomed).toBe(true);
      expect(result.pattern).toBe('max_iterations');
    });

    it('does not trigger below maxIterations', () => {
      const result = safety.checkDoom([], [], 24);
      expect(result.doomed).toBe(false);
    });
  });

  // ── Empty response detection ───────────────────────────────────

  describe('empty response detection', () => {
    it('triggers doom when >= threshold empty results in a single batch', () => {
      const batch = [
        tr('run_command', { cmd: 'a' }, ''),
        tr('run_command', { cmd: 'b' }, null),
        tr('run_command', { cmd: 'c' }, '{}'),
      ];
      const result = safety.checkDoom([], batch, 1);
      expect(result.doomed).toBe(true);
      expect(result.pattern).toBe('empty_results');
    });

    it('does not trigger with fewer than threshold empty results', () => {
      const batch = [
        tr('run_command', { cmd: 'a' }, ''),
        tr('run_command', { cmd: 'b' }, 'some data'),
        tr('run_command', { cmd: 'c' }, 'more data'),
      ];
      const result = safety.checkDoom([], batch, 1);
      expect(result.doomed).toBe(false);
    });
  });

  // ── Disabled doom detection ────────────────────────────────────

  describe('disabled doom detection', () => {
    it('returns not doomed when doom is disabled', () => {
      const disabledSafety = makeSafety({ doom: { enabled: false } });
      const batch = Array.from({ length: 10 }, (_, i) =>
        tr('run_command', { cmd: `curl ${i}` }),
      );
      const result = disabledSafety.checkDoom([], batch, 1);
      expect(result.doomed).toBe(false);
    });
  });

  // ── recordToolCall (lower-level API) ───────────────────────────

  describe('recordToolCall', () => {
    it('does NOT trigger doom for same tool with same args in same iteration', () => {
      // All calls use iteration 1 (via the internal counter)
      safety._iterationCounter = 1;
      safety.recordToolCall('read_file', { path: 'x.txt' });
      safety.recordToolCall('read_file', { path: 'x.txt' });
      const result = safety.recordToolCall('read_file', { path: 'x.txt' });
      // All 3 share iteration 1, so only 1 distinct iteration → no doom
      expect(result.isDoom).toBe(false);
      expect(result.count).toBe(1);
    });

    it('triggers doom when same tool+args across 3 distinct iterations', () => {
      safety.recordToolCall('read_file', { path: 'x.txt' }, 1);
      safety.recordToolCall('read_file', { path: 'x.txt' }, 2);
      const result = safety.recordToolCall('read_file', { path: 'x.txt' }, 3);
      expect(result.isDoom).toBe(true);
      expect(result.count).toBe(3);
    });

    it('does NOT trigger doom when different tool between identical calls', () => {
      safety.recordToolCall('read_file', { path: 'x.txt' }, 1);
      safety.recordToolCall('write_file', { path: 'y.txt' }, 2); // breaks consecutive run
      const result = safety.recordToolCall('read_file', { path: 'x.txt' }, 3);
      expect(result.isDoom).toBe(false);
      expect(result.count).toBe(1);
    });
  });

  // ── reset ──────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears recent calls and iteration counter', () => {
      safety.checkDoom([], [tr('run_command', { cmd: 'a' })], 1);
      safety.checkDoom([], [tr('run_command', { cmd: 'b' })], 2);
      safety.reset();
      // After reset, starting from scratch — no doom
      const result = safety.checkDoom([], [tr('run_command', { cmd: 'c' })], 3);
      expect(result.doomed).toBe(false);
    });
  });
});
