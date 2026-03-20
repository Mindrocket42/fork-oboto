/**
 * IntentRouter — unified intent classification replacing MahaProvider's
 * routing logic with a single deterministic classifier.
 *
 * Merges three sources of intent detection:
 *  1. Complexity scoring from {@link src/core/agentic/maha-provider.mjs} _scoreComplexity
 *  2. Follow-up detection from {@link src/core/eventic-agent-loop-plugin.mjs} isLikelyFollowUp
 *  3. Surface-update detection from {@link src/core/agent-loop-preroute.mjs} detectSurfaceUpdateIntent
 *
 * The {@link classifyInput} function from the cognitive task planner is used
 * as a legacy tiebreaker when the heuristic score falls in the ambiguous range.
 *
 * @module src/core/agentic/unified/intent-router
 */

import { classifyInput } from '../cognitive/task-planner.mjs';
import { detectSurfaceUpdateIntent } from '../../agent-loop-preroute.mjs';

// ════════════════════════════════════════════════════════════════════════
// Follow-Up Detection
// ════════════════════════════════════════════════════════════════════════

/**
 * Detect whether a user message is a likely follow-up to the previous
 * conversation turn.  Follow-ups skip the precheck fast-path and use
 * full conversation context.
 *
 * Ported from eventic-agent-loop-plugin.mjs lines 126-137:
 *  - Very short affirmations ("yes", "do it", "go ahead")
 *  - Pronoun references to prior context ("that", "this", "it")
 *  - Short imperative verbs ("start", "run", "try", "apply")
 *
 * @param {string} input   — the user's message
 * @param {Array}  history — conversation history messages
 * @returns {boolean}
 */
function isLikelyFollowUp(input, history) {
  // Need at least one prior exchange to have something to follow up on
  if (!history || history.length < 2) return false;

  const lower = (input || '').trim().toLowerCase();
  if (!lower) return false;

  const wordCount = lower.split(/\s+/).length;

  // Very short affirmations
  if (
    wordCount <= 3 &&
    /^(yes|yeah|yep|sure|ok|okay|do it|go ahead|please|run it|try it)/.test(lower)
  ) {
    return true;
  }

  // Pronoun / reference back to prior context
  if (
    wordCount <= 12 &&
    /\b(that|this|it|those|these|the same|above|previous|last|you (said|mentioned|suggested|proposed|offered))\b/i.test(lower)
  ) {
    return true;
  }

  // Short yes-prefixed responses
  if (
    wordCount <= 8 &&
    /^(yes|yeah|sure|ok|please|go)\b/i.test(lower)
  ) {
    return true;
  }

  // Short imperative verbs
  if (
    wordCount <= 12 &&
    /^(start|begin|run|try|use|show|give|pick|choose|select|execute|launch|apply|do|set\s+up|switch|open|skip|stop|cancel|pause|resume|let'?s)\b/i.test(lower)
  ) {
    return true;
  }

  return false;
}

// ════════════════════════════════════════════════════════════════════════
// Complexity Scoring
// ════════════════════════════════════════════════════════════════════════

/**
 * Score the complexity of a user input on a 0-10 scale.
 *
 * Ported from maha-provider.mjs lines 123-149.
 * Higher scores indicate requests that need planning / multi-step reasoning.
 *
 * @param {string} input — the user's message
 * @returns {number} 0-10
 */
function scoreComplexity(input) {
  let score = 0;
  const text = (input || '').trim();
  if (!text) return 0;

  // Length-based scoring
  if (text.length > 500) score += 2;
  else if (text.length > 200) score += 1;

  // Multi-step indicators
  if (/\b(?:first|then|next|after that|finally|step\s+\d)\b/i.test(text)) score += 2;

  // Code / file references
  if (/```/.test(text) || /\b(?:src|lib|config)\/\S+/.test(text)) score += 1;

  // Tool-requiring verbs
  if (/\b(?:write|create|edit|modify|delete|build|deploy|install|refactor)\b/i.test(text)) score += 2;

  // Analysis / research requests
  if (/\b(?:analyze|research|compare|evaluate|audit|review)\b/i.test(text)) score += 1;

  // Simple conversational indicators (reduce score)
  if (/^(?:what|who|when|where|why|how|explain|define|describe)\s/i.test(text) && text.length < 100) score -= 1;
  if (/\?$/.test(text) && text.length < 80) score -= 1;

  return Math.max(0, Math.min(10, score));
}

// ════════════════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} IntentClassification
 * @property {'direct' | 'standard' | 'complex' | 'followup' | 'surface-update'} intent
 *   The classified intent determining the execution path.
 * @property {number} complexity
 *   Complexity score (0-10) from {@link scoreComplexity}.
 * @property {boolean} followUp
 *   Whether the input is a likely follow-up to a previous exchange.
 * @property {boolean} surfaceUpdate
 *   Whether the input requests modifying an existing surface/dashboard.
 */

/**
 * Classify a user input into an intent category that drives the
 * UnifiedProvider's execution path.
 *
 * Intent categories:
 *  - **direct**: Simple query that can be answered without tools (precheck path)
 *  - **standard**: Normal request requiring the ReAct loop
 *  - **complex**: Multi-step request requiring task planning
 *  - **followup**: Short reply referencing a previous exchange
 *  - **surface-update**: Request to modify an existing UI surface
 *
 * @param {string} input   — the user's raw message
 * @param {Array}  history — conversation history messages
 * @param {Object} [routingConfig] — routing section from unified config
 * @param {number} [routingConfig.complexityThreshold=3]
 * @returns {IntentClassification}
 */
export function classifyIntent(input, history, routingConfig = {}) {
  const complexityThreshold = routingConfig.complexityThreshold ?? 3;

  // ── 1. Surface-update check ──────────────────────────────────
  const surfaceResult = detectSurfaceUpdateIntent(input);
  const surfaceUpdate = surfaceResult.isSurfaceUpdate;

  if (surfaceUpdate) {
    return {
      intent: 'surface-update',
      complexity: scoreComplexity(input),
      followUp: false,
      surfaceUpdate: true,
    };
  }

  // ── 2. Follow-up check ───────────────────────────────────────
  const followUp = isLikelyFollowUp(input, history);

  if (followUp) {
    return {
      intent: 'followup',
      complexity: scoreComplexity(input),
      followUp: true,
      surfaceUpdate: false,
    };
  }

  // ── 3. Complexity scoring ────────────────────────────────────
  const complexity = scoreComplexity(input);

  // High complexity → complex (planning path)
  if (complexity > complexityThreshold + 2) {
    return { intent: 'complex', complexity, followUp: false, surfaceUpdate: false };
  }

  // Low complexity → direct (precheck path)
  if (complexity <= 1) {
    return { intent: 'direct', complexity, followUp: false, surfaceUpdate: false };
  }

  // ── 4. Ambiguous range — use legacy tiebreaker ───────────────
  if (complexity >= complexityThreshold) {
    // Use classifyInput from task-planner as tiebreaker
    const legacy = classifyInput(input);
    if (legacy === 'complex') {
      return { intent: 'complex', complexity, followUp: false, surfaceUpdate: false };
    }
  }

  // Default: standard ReAct loop
  return { intent: 'standard', complexity, followUp: false, surfaceUpdate: false };
}
