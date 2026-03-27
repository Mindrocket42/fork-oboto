/**
 * StreamController — enhanced StreamManager with commentary, status
 * deduplication, cost reporting, and AI text forwarding.
 *
 * Replaces the basic {@link StreamManager} from
 * {@link src/core/agentic/stream-manager.mjs} with a phase-aware streaming
 * controller designed for the UnifiedProvider.  Every agent phase emits
 * structured commentary and status events so the UI always knows what the
 * agent is doing.
 *
 * Key enhancements over StreamManager:
 *  - Built-in commentary channel via {@link emitCommentary}
 *  - Status deduplication (80-char key, configurable window)
 *  - Phase convenience methods matching the Section 9.2 commentary catalog
 *  - Integrated {@link ActivityTracker} heartbeat
 *  - Per-turn metrics tracking (LLM calls, tool calls, tokens, cost)
 *  - AI text forwarding for text alongside tool calls
 *
 * @module src/core/agentic/unified/stream-controller
 */

import {
  emitCommentary,
  emitStatus,
  describeToolCall,
  buildToolRoundNarrative,
  summarizeInput,
} from '../../status-reporter.mjs';
import { ActivityTracker } from '../../activity-tracker.mjs';

// ════════════════════════════════════════════════════════════════════════
// Phase Constants
// ════════════════════════════════════════════════════════════════════════

/**
 * Emoji map for each named agent phase.
 * Used by {@link StreamController#phaseStart} to prefix commentary.
 * @type {Record<string, string>}
 */
export const PHASE_EMOJI = {
  request:      '🚀',
  precheck:     '🔍',
  planning:     '📋',
  thinking:     '🧠',
  tools:        '🔧',
  validation:   '✅',
  memory:       '💾',
  continuation: '🤖',
  error:        '⚠️',
  doom:         '🚨',
  cancel:       '🛑',
};

/**
 * Phase-to-ActivityTracker phase type mapping.
 * Determines the heartbeat style (LLM wait vs tool exec vs generic).
 * @type {Record<string, string|null>}
 */
export const PHASE_TYPE = {
  request:      null,
  precheck:     'llm-call',
  planning:     'llm-call',
  thinking:     'llm-call',
  tools:        'tool-exec',
  validation:   null,
  memory:       null,
  continuation: 'llm-call',
  error:        null,
  doom:         null,
  cancel:       null,
};

// ════════════════════════════════════════════════════════════════════════
// StreamController Class
// ════════════════════════════════════════════════════════════════════════

/**
 * Phase-aware streaming controller for the unified agent loop.
 *
 * Manages token/chunk output, commentary/status emissions, heartbeat
 * activity tracking, deduplication, and per-turn metrics.
 */
export class StreamController {
  /**
   * @param {Object} options
   * @param {Function}    [options.onToken]  — called with each text token (string)
   * @param {Function}    [options.onChunk]  — called with each chunk object
   * @param {AbortSignal} [options.signal]   — abort signal for cancellation
   * @param {Object}      [options.config]   — streaming section from unified config
   * @param {number}      [options.config.heartbeatIntervalMs=3000]
   * @param {number}      [options.config.statusDedupWindowMs=2000]
   * @param {boolean}     [options.config.forwardAiText=true]
   * @param {boolean}     [options.config.costReporting=true]
   * @param {boolean}     [options.config.emitToolNarratives=true]
   * @param {boolean}     [options.config.emitIterationUpdates=true]
   * @param {number}      [options.config.maxCommentaryLength=300]
   */
  constructor(options = {}) {
    // ── Core streaming (ported from StreamManager) ──────────────
    /** @private */
    this._onToken = typeof options.onToken === 'function' ? options.onToken : null;
    /** @private */
    this._onChunk = typeof options.onChunk === 'function' ? options.onChunk : null;
    /** @private */
    this._signal = options.signal || null;
    /** @private */
    this._suppressed = false;
    /** @private */
    this._disposed = false;

    // ── Configuration ──────────────────────────────────────────
    const cfg = options.config || {};
    /** @private */
    this._dedupWindowMs = cfg.statusDedupWindowMs ?? 2000;
    /** @private */
    this._forwardAiText = cfg.forwardAiText ?? true;
    /** @private */
    this._costReporting = cfg.costReporting ?? true;
    /** @private */
    this._emitToolNarratives = cfg.emitToolNarratives ?? true;
    /** @private */
    this._emitIterationUpdates = cfg.emitIterationUpdates ?? true;
    /** @private */
    this._maxCommentaryLength = cfg.maxCommentaryLength ?? 300;

    // ── Activity tracker (heartbeat) ───────────────────────────
    /** @private */
    this._tracker = new ActivityTracker({
      intervalMs: cfg.heartbeatIntervalMs ?? 3000,
    });

    // ── Per-turn metrics ───────────────────────────────────────
    /** @private */
    this._turnMetrics = { llmCalls: 0, toolCalls: 0, tokens: 0, cost: 0 };

    // ── Deduplication guard ────────────────────────────────────
    /** @private @type {Set<string>} */
    this._emittedStatuses = new Set();
  }

  // ════════════════════════════════════════════════════════════════════
  // Token Streaming — passes through to UI
  // ════════════════════════════════════════════════════════════════════

  /**
   * Emit a text token.  Respects suppression state and abort signal.
   * @param {string} text — token text to stream
   */
  token(text) {
    if (this._disposed || this._suppressed || this._isAborted()) return;
    if (this._onToken) this._onToken(text);
  }

  /**
   * Emit a chunk object.  Respects suppression state and abort signal.
   * @param {*} data — chunk data to stream
   */
  chunk(data) {
    if (this._disposed || this._suppressed || this._isAborted()) return;
    if (this._onChunk) this._onChunk(data);
  }

  /**
   * Suppress all token/chunk output.
   * Use before tool execution or internal LLM calls.
   */
  suppress() {
    this._suppressed = true;
  }

  /**
   * Resume token/chunk output after suppression.
   */
  resume() {
    this._suppressed = false;
  }

  /**
   * Flush any pending output (no-op in unbuffered mode; kept for
   * interface compatibility with StreamManager).
   */
  flush() {
    // StreamController uses immediate emission — nothing to flush.
  }

  /**
   * Get streaming callbacks for passing to LLM call options.
   * The returned callbacks route through this controller.
   *
   * @returns {{ onToken: Function|undefined, onChunk: Function|undefined }}
   */
  getCallbacks() {
    const result = {};
    if (this._onToken) result.onToken = (t) => this.token(t);
    if (this._onChunk) result.onChunk = (c) => this.chunk(c);
    return result;
  }

  // ════════════════════════════════════════════════════════════════════
  // Commentary — narrative visible in the persistent message stream
  // ════════════════════════════════════════════════════════════════════

  /**
   * Emit a commentary message with optional emoji prefix.
   * Commentary appears in both the ThinkingIndicator AND the persistent
   * message stream via {@link emitCommentary}.
   *
   * Includes deduplication: messages with the same 80-char prefix
   * emitted within the configured window are suppressed.
   *
   * @param {string} emoji — emoji prefix (e.g. '🔧'), or empty string
   * @param {string} text  — narrative text
   */
  commentary(emoji, text) {
    if (this._disposed || this._isAborted()) return;

    const msg = emoji ? `${emoji} ${text}` : text;

    // Dedup: skip if same message was emitted within the window
    const key = msg.substring(0, 80);
    if (this._emittedStatuses.has(key)) return;
    this._emittedStatuses.add(key);
    setTimeout(() => this._emittedStatuses.delete(key), this._dedupWindowMs);

    emitCommentary(msg);
  }

  // ════════════════════════════════════════════════════════════════════
  // Status — ephemeral indicator only (ThinkingIndicator)
  // ════════════════════════════════════════════════════════════════════

  /**
   * Emit an ephemeral status message.
   * Shown in the ThinkingIndicator only — overwritten by the next status.
   * Status messages are NOT deduped because they represent real phase
   * transitions (e.g. tool 1/3, tool 2/3, tool 3/3).
   *
   * @param {string} text — status description
   */
  status(text) {
    if (this._disposed || this._isAborted()) return;
    emitStatus(text);
  }

  // ════════════════════════════════════════════════════════════════════
  // Activity Tracking (heartbeat)
  // ════════════════════════════════════════════════════════════════════

  /**
   * Set the current activity for heartbeat tracking.
   * The {@link ActivityTracker} re-emits the description with elapsed
   * time on each heartbeat tick.
   *
   * @param {string} description — e.g. "Sending request to AI model"
   * @param {string|null} phase  — 'llm-call' | 'tool-exec' | null
   */
  setActivity(description, phase) {
    if (this._disposed) return;
    this._tracker.setActivity(description, { phase: phase || undefined });
  }

  // ════════════════════════════════════════════════════════════════════
  // Phase Convenience Methods
  // ════════════════════════════════════════════════════════════════════

  /**
   * Emit a phase-start commentary with the appropriate emoji and
   * set the activity tracker to the corresponding phase type.
   *
   * @param {string} phaseName — key into {@link PHASE_EMOJI}
   * @param {string} [detail]  — human-readable detail (defaults to phaseName)
   */
  phaseStart(phaseName, detail) {
    const text = detail || phaseName;
    this.commentary(PHASE_EMOJI[phaseName] || '', text);
    this.setActivity(text, PHASE_TYPE[phaseName] || null);
  }

  /**
   * Emit per-tool start status using {@link describeToolCall}.
   *
   * @param {string} toolName — tool function name
   * @param {Object} args     — tool arguments
   * @param {number} index    — 0-based index within the batch
   * @param {number} total    — total tools in the batch
   */
  toolStart(toolName, args, index, total) {
    const desc = describeToolCall(toolName, args);
    if (total > 1) {
      this.status(`Running tool ${index + 1}/${total}: ${desc}`);
    } else {
      this.status(`Running tool: ${desc}`);
    }
    this.setActivity(`Executing: ${desc}`, 'tool-exec');
    this._turnMetrics.toolCalls++;
  }

  /**
   * Emit tool-completion status.
   *
   * @param {string}  toolName — tool function name
   * @param {boolean} success  — whether the tool call succeeded
   */
  toolComplete(toolName, success) {
    this.status(`Tool ${toolName} ${success ? 'completed' : 'failed'}`);
  }

  /**
   * Emit a narrative summary after a round of tool calls completes.
   * Uses {@link buildToolRoundNarrative} to generate human-readable text.
   *
   * @param {Array<{name: string, result?: unknown, content?: string}>} toolResults
   */
  toolRoundComplete(toolResults) {
    if (!this._emitToolNarratives) return;

    const narrative = buildToolRoundNarrative(toolResults);
    if (narrative) {
      this.commentary('🔧', `${narrative} Sending results back to AI for next steps…`);
    } else {
      this.status('All tools completed — sending results back to AI');
    }
  }

  /**
   * Forward LLM text content that accompanies tool calls.
   * LLMs often explain their reasoning while calling tools — this text
   * should be visible to the user, not swallowed silently.
   *
   * @param {string} text — AI text content from the response
   */
  aiTextReceived(text) {
    if (!this._forwardAiText) return;
    if (text && text.trim()) {
      this.commentary('🤖', text.trim().substring(0, this._maxCommentaryLength));
    }
  }

  /**
   * Emit per-iteration commentary.
   * When the iteration included tool calls, the narrative was already
   * emitted by {@link toolRoundComplete} — this handles the empty case.
   *
   * @param {number}  iteration  — current iteration number (1-based)
   * @param {boolean} hadTools   — whether this iteration made tool calls
   * @param {number}  emptyCount — consecutive empty iterations so far
   * @param {number}  maxEmpty   — configured max empty iterations
   */
  iterationUpdate(iteration, hadTools, emptyCount, maxEmpty) {
    if (!this._emitIterationUpdates) return;

    if (!hadTools) {
      this.commentary(
        '🔄',
        `AI analyzing results — iteration ${iteration}` +
        (emptyCount > 0 ? ` — empty: ${emptyCount}/${maxEmpty}` : ''),
      );
    }
    this.setActivity(
      `AI processing tool results — iteration ${iteration}`,
      'llm-call',
    );
    this._turnMetrics.llmCalls++;
  }

  /**
   * Emit a cost-update commentary.
   *
   * @param {number} turnCost  — cost for this turn ($)
   * @param {number} totalCost — cumulative session cost ($)
   * @param {number} tokens    — tokens used this turn
   */
  costUpdate(turnCost, totalCost, tokens) {
    if (!this._costReporting) return;

    this._turnMetrics.cost = turnCost;
    this._turnMetrics.tokens += tokens;
    this.commentary(
      '💰',
      `Turn cost: $${turnCost.toFixed(4)}, ` +
      `total session: $${totalCost.toFixed(4)}, ` +
      `tokens: ${this._turnMetrics.tokens}`,
    );
  }

  /**
   * Emit the final "response ready" commentary and stop the heartbeat.
   */
  complete() {
    this.commentary('✅', 'Response ready.');
    this._tracker.stop();
  }

  // ════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ════════════════════════════════════════════════════════════════════

  /**
   * Clean up all resources.  Stops the heartbeat, clears callbacks and
   * the dedup set.  Safe to call multiple times.
   */
  dispose() {
    if (this._disposed) return;
    this.flush();
    this._tracker.stop();
    this._onToken = null;
    this._onChunk = null;
    this._emittedStatuses.clear();
    this._disposed = true;
  }

  // ════════════════════════════════════════════════════════════════════
  // Metrics Access
  // ════════════════════════════════════════════════════════════════════

  /**
   * Add tokens to the turn metrics counter.
   * Provides a public API so callers don't need to access _turnMetrics directly.
   * @param {number} count — number of tokens to add
   */
  addTokens(count) {
    if (typeof count === 'number' && count > 0) {
      this._turnMetrics.tokens += count;
    }
  }

  /**
   * Snapshot of per-turn metrics.
   * @returns {{ llmCalls: number, toolCalls: number, tokens: number, cost: number }}
   */
  get metrics() {
    return { ...this._turnMetrics };
  }

  // ════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ════════════════════════════════════════════════════════════════════

  /**
   * Check if the abort signal has been triggered.
   * @private
   * @returns {boolean}
   */
  _isAborted() {
    return this._signal?.aborted === true;
  }
}

export { summarizeInput };
