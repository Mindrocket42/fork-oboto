/**
 * Task Planner — structured task decomposition for the cognitive agent.
 *
 * When a user request is complex (multi-step project work), this module:
 *  1. Classifies the input as "simple" (direct response) or "complex" (needs plan)
 *  2. Generates a structured task plan via an LLM call
 *  3. Executes plan steps sequentially, streaming progress to the UI
 *
 * Simple chat, Q&A, and single-tool requests bypass planning entirely.
 *
 * @module src/core/agentic/cognitive/task-planner
 */

import { emitStatus } from '../../status-reporter.mjs';

// ════════════════════════════════════════════════════════════════════
// Data Model
// ════════════════════════════════════════════════════════════════════

/**
 * @typedef {'pending' | 'running' | 'done' | 'failed' | 'skipped'} StepStatus
 */

/**
 * @typedef {Object} TaskStep
 * @property {string} id        - Step identifier (e.g. "step-1")
 * @property {string} label     - Human-readable description
 * @property {StepStatus} status - Current status
 * @property {string[]} [tools] - Expected tools (informational)
 * @property {string} [result]  - Brief result summary
 * @property {string} [error]   - Error message if failed
 * @property {number} [startedAt]
 * @property {number} [completedAt]
 */

/**
 * @typedef {'planning' | 'executing' | 'completed' | 'failed' | 'cancelled'} PlanStatus
 */

/**
 * Immutable-ish task plan.  Steps are mutated in place during execution
 * for efficiency (no need for immutable copies of intermediate state).
 */
class TaskPlan {
  /**
   * @param {Object} opts
   * @param {string} opts.title
   * @param {TaskStep[]} opts.steps
   */
  constructor({ title, steps }) {
    this.id = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.title = title;
    /** @type {TaskStep[]} */
    this.steps = steps.map((s, i) => ({
      id: s.id || `step-${i + 1}`,
      label: s.label,
      status: 'pending',
      tools: s.tools || [],
      result: undefined,
      error: undefined,
      startedAt: undefined,
      completedAt: undefined,
    }));
    /** @type {PlanStatus} */
    this.status = 'planning';
    this.createdAt = Date.now();
    /** @type {number|undefined} */
    this.completedAt = undefined;
  }

  /** Convert to the UI Step[] format for ws messages. */
  toUISteps() {
    return this.steps.map(s => ({
      label: s.label,
      status: s.status === 'done' ? 'done'
        : s.status === 'failed' ? 'failed'
        : s.status === 'running' ? 'running'
        : s.status === 'skipped' ? 'skipped'
        : 'pending',
    }));
  }

  /** Summary string for LLM context. */
  toSummary() {
    return this.steps.map(s => {
      const tag = s.status === 'done' ? '✅'
        : s.status === 'failed' ? '❌'
        : s.status === 'running' ? '⏳'
        : s.status === 'skipped' ? '⏭️'
        : '⬜';
      const extra = s.result ? ` → ${s.result}` : s.error ? ` → ERROR: ${s.error}` : '';
      return `${tag} ${s.label}${extra}`;
    }).join('\n');
  }
}

// ════════════════════════════════════════════════════════════════════
// Classifier
// ════════════════════════════════════════════════════════════════════

/**
 * Heuristic patterns that strongly indicate a simple (non-plannable) request.
 * If any matches, we skip planning entirely.
 */
const SIMPLE_PATTERNS = [
  // Greetings & small talk
  /^(hi|hello|hey|thanks|thank you|ok|okay|bye|good\s*(morning|evening|night|afternoon))[\s!.?]*$/i,
  // Short questions (< 15 words, starts with a question word)
  /^(what|who|where|when|why|how|is|are|was|were|do|does|did|can|could|would|should|will|shall)\b/i,
  // Single file operations
  /^(read|show|cat|open|display|print)\s+(the\s+)?(file|contents?\s+of)\s+\S+$/i,
  // Simple status queries
  /^(status|state|check|ping|version|help)[\s!.?]*$/i,
];

/**
 * Patterns that strongly indicate a complex (plannable) request.
 */
const COMPLEX_PATTERNS = [
  // Creation / implementation verbs with nouns
  /\b(create|build|implement|develop|scaffold|bootstrap|set\s*up|make|design|architect)\s+(?:a|an|the|my)\s+/i,
  // Refactoring / migration
  /\b(refactor|migrate|convert|restructure|reorganize|overhaul)\s/i,
  // Multi-step explicit language
  /\b(and\s+then|first.*then|step\s*1|multiple\s+(files?|components?|modules?))\b/i,
  // Project-scope work
  /\b(project|application|app|website|service|api|system|platform|library|package|codebase)\b.*\b(with|using|including|that\s+has)\b/i,
];

/**
 * Classify a user input as 'simple' or 'complex'.
 *
 * Uses fast heuristics first.  If inconclusive, defaults to 'simple'
 * (conservative — avoids unnecessary planning overhead).
 *
 * @param {string} input - User's message
 * @param {Object} [config] - Planner config
 * @param {number} [config.minComplexityWords=20] - Min words for heuristic check
 * @returns {'simple' | 'complex'}
 */
function classifyInput(input, config = {}) {
  const trimmed = input.trim();
  const wordCount = trimmed.split(/\s+/).length;
  const minWords = config.minComplexityWords ?? 20;

  // Very short messages are always simple
  if (wordCount <= 5) return 'simple';

  // Check simple patterns — but only for short-ish inputs (≤15 words)
  // to avoid misclassifying long complex requests that happen to start
  // with a question word (e.g. "What I need is a full REST API with…")
  if (wordCount <= 15) {
    for (const pattern of SIMPLE_PATTERNS) {
      if (pattern.test(trimmed)) return 'simple';
    }
  }

  // Check complex patterns
  for (const pattern of COMPLEX_PATTERNS) {
    if (pattern.test(trimmed)) return 'complex';
  }

  // Long messages with action verbs lean complex
  if (wordCount >= minWords) {
    const actionVerbs = /\b(create|build|implement|write|add|update|fix|refactor|deploy|test|install|configure|set\s*up|generate|modify|change)\b/gi;
    const matches = trimmed.match(actionVerbs);
    if (matches && matches.length >= 2) return 'complex';
  }

  // Default: simple (conservative)
  return 'simple';
}

// ════════════════════════════════════════════════════════════════════
// Plan Generation
// ════════════════════════════════════════════════════════════════════

/**
 * System prompt for the plan generation LLM call.
 */
const PLANNING_SYSTEM_PROMPT = `You are a task planning assistant. Given a user's request, decompose it into a structured plan of 3-10 actionable steps.

Rules:
1. Each step should be achievable in a single tool-call round (1-2 tool calls max)
2. Steps should be in logical execution order
3. Use clear, specific labels (not vague like "set up things")
4. Include which tools each step will likely need
5. Keep the plan concise — don't over-decompose simple sub-tasks

Available tools: read_file, write_file, write_to_file, edit_file, apply_diff, execute_command, list_files, search_files, delete_file, browse_open, create_surface, update_surface_component

You MUST respond with valid JSON matching this exact format:
{
  "title": "Short title for the overall task",
  "steps": [
    { "label": "Description of step", "tools": ["tool_name"] }
  ]
}

Do NOT include any text outside the JSON object.`;

/**
 * Generate a task plan from a complex user request.
 *
 * Makes a single LLM call with a planning prompt to decompose the
 * request into structured steps.
 *
 * @param {string} input - User's original request
 * @param {Function} callLLM - async (messages, tools, options) => response
 * @param {Object} [options]
 * @param {number} [options.maxSteps=10]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<TaskPlan|null>} - Plan, or null if generation failed
 */
async function generatePlan(input, callLLM, options = {}) {
  const maxSteps = options.maxSteps || 10;

  try {
    emitStatus('Analyzing task complexity — generating plan…');

    const messages = [
      { role: 'system', content: PLANNING_SYSTEM_PROMPT },
      { role: 'user', content: input }
    ];

    const response = await callLLM(messages, [], { signal: options.signal });
    const content = (response?.content || response || '').toString().trim();

    // Parse JSON from response — handle markdown code blocks
    let json;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
    try {
      json = JSON.parse(jsonMatch[1].trim());
    } catch {
      // Try extracting JSON object directly
      const objMatch = content.match(/\{[\s\S]*\}/);
      if (objMatch) {
        json = JSON.parse(objMatch[0]);
      } else {
        console.warn('[TaskPlanner] Failed to parse plan JSON:', content.substring(0, 200));
        return null;
      }
    }

    // Validate structure
    if (!json.title || !Array.isArray(json.steps) || json.steps.length === 0) {
      console.warn('[TaskPlanner] Invalid plan structure:', json);
      return null;
    }

    // Enforce max steps
    const steps = json.steps.slice(0, maxSteps);

    return new TaskPlan({
      title: json.title,
      steps: steps.map((s, i) => ({
        id: `step-${i + 1}`,
        label: s.label || s.description || `Step ${i + 1}`,
        tools: Array.isArray(s.tools) ? s.tools : [],
      }))
    });
  } catch (err) {
    console.warn('[TaskPlanner] Plan generation failed:', err.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════
// Plan Executor
// ════════════════════════════════════════════════════════════════════

/**
 * Execute a task plan step-by-step.
 *
 * For each step:
 *  1. Mark step as 'running' and notify UI
 *  2. Call the agent's turn() with a focused instruction
 *  3. Mark step as 'done' or 'failed' and notify UI
 *
 * @param {TaskPlan} plan
 * @param {Object} opts
 * @param {Function} opts.executeTurn  - async (instruction, options) => { response }
 * @param {Function} opts.onUpdate     - (plan) => void — called after each step status change
 * @param {AbortSignal} [opts.signal]
 * @param {boolean} [opts.skipDependentOnFailure] - Skip remaining steps after a failure
 * @returns {Promise<{plan: TaskPlan, stepResults: Array<{stepId: string, response: string}>}>}
 */
async function executePlan(plan, opts) {
  const { executeTurn, onUpdate, signal } = opts;
  const stepResults = [];

  plan.status = 'executing';
  onUpdate(plan);

  for (let i = 0; i < plan.steps.length; i++) {
    // Check for cancellation
    if (signal?.aborted) {
      // Mark remaining steps as skipped
      for (let j = i; j < plan.steps.length; j++) {
        plan.steps[j].status = 'skipped';
      }
      plan.status = 'cancelled';
      plan.completedAt = Date.now();
      onUpdate(plan);
      break;
    }

    const step = plan.steps[i];
    step.status = 'running';
    step.startedAt = Date.now();
    onUpdate(plan);

    // Build the step instruction with plan context
    const completedSummary = plan.steps
      .slice(0, i)
      .filter(s => s.status === 'done')
      .map(s => `✅ ${s.label}${s.result ? ': ' + s.result : ''}`)
      .join('\n');

    const instruction = [
      `You are executing step ${i + 1} of ${plan.steps.length} in a task plan.`,
      `\n**Overall task:** ${plan.title}`,
      completedSummary ? `\n**Completed steps:**\n${completedSummary}` : '',
      `\n**Current step:** ${step.label}`,
      step.tools?.length ? `\n**Suggested tools:** ${step.tools.join(', ')}` : '',
      `\nExecute this step now. Be concise in your response — summarize what you did in 1-2 sentences.`
    ].filter(Boolean).join('');

    try {
      emitStatus(`Executing step ${i + 1}/${plan.steps.length}: ${step.label}`);
      const result = await executeTurn(instruction, { signal });
      const responseText = result?.response || '';

      step.status = 'done';
      step.completedAt = Date.now();
      // Extract a brief summary (first sentence or first 200 chars)
      step.result = responseText.split(/[.!?\n]/)[0]?.substring(0, 200) || 'Completed';

      stepResults.push({ stepId: step.id, response: responseText });
    } catch (err) {
      step.status = 'failed';
      step.completedAt = Date.now();
      step.error = err.message || 'Unknown error';

      stepResults.push({ stepId: step.id, response: `Error: ${step.error}` });

      // If configured, skip remaining steps after a failure
      if (opts.skipDependentOnFailure) {
        for (let j = i + 1; j < plan.steps.length; j++) {
          plan.steps[j].status = 'skipped';
        }
        onUpdate(plan);
        break;
      }
    }

    onUpdate(plan);
  }

  // Final status
  const hasFailures = plan.steps.some(s => s.status === 'failed');
  const allDone = plan.steps.every(s => s.status === 'done' || s.status === 'skipped');

  if (plan.status !== 'cancelled') {
    plan.status = hasFailures ? 'failed' : (allDone ? 'completed' : 'failed');
  }
  plan.completedAt = Date.now();
  onUpdate(plan);

  return { plan, stepResults };
}

// ════════════════════════════════════════════════════════════════════
// Synthesis
// ════════════════════════════════════════════════════════════════════

/**
 * Generate a final synthesis response summarizing what was accomplished.
 *
 * @param {TaskPlan} plan
 * @param {Array<{stepId: string, response: string}>} stepResults
 * @param {Function} callLLM - async (messages, tools, options) => response
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<string>}
 */
async function synthesizeResponse(plan, stepResults, callLLM, options = {}) {
  const resultsSummary = stepResults.map((sr, i) => {
    const step = plan.steps[i];
    const status = step?.status || 'unknown';
    const tag = status === 'done' ? '✅' : status === 'failed' ? '❌' : '⏭️';
    return `${tag} Step ${i + 1}: ${step?.label || 'Unknown'}\nResult: ${sr.response.substring(0, 500)}`;
  }).join('\n\n');

  const messages = [
    {
      role: 'system',
      content: `You completed a multi-step task plan. Summarize what was accomplished in a clear, user-friendly response. Mention any failures or issues. Do NOT repeat the full step details — just give a high-level summary with key outcomes.`
    },
    {
      role: 'user',
      content: `Task: ${plan.title}\n\nResults:\n${resultsSummary}`
    }
  ];

  try {
    emitStatus('Synthesizing final response…');
    const response = await callLLM(messages, [], { signal: options.signal });
    return (response?.content || response || '').toString().trim() || _buildFallbackSynthesis(plan);
  } catch {
    return _buildFallbackSynthesis(plan);
  }
}

/**
 * Fallback synthesis when LLM call fails.
 * @param {TaskPlan} plan
 * @returns {string}
 * @private
 */
function _buildFallbackSynthesis(plan) {
  const done = plan.steps.filter(s => s.status === 'done').length;
  const failed = plan.steps.filter(s => s.status === 'failed').length;
  const total = plan.steps.length;

  let summary = `## ${plan.title}\n\n`;
  summary += `Completed ${done}/${total} steps`;
  if (failed > 0) summary += ` (${failed} failed)`;
  summary += '.\n\n';

  for (const step of plan.steps) {
    const tag = step.status === 'done' ? '✅'
      : step.status === 'failed' ? '❌'
      : step.status === 'skipped' ? '⏭️'
      : '⬜';
    summary += `${tag} **${step.label}**`;
    if (step.result) summary += ` — ${step.result}`;
    if (step.error) summary += ` — Error: ${step.error}`;
    summary += '\n';
  }

  return summary;
}

// ════════════════════════════════════════════════════════════════════
// Exports
// ════════════════════════════════════════════════════════════════════

export {
  TaskPlan,
  classifyInput,
  generatePlan,
  executePlan,
  synthesizeResponse,
  SIMPLE_PATTERNS,
  COMPLEX_PATTERNS,
};
