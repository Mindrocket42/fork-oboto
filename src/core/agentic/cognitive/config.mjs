/**
 * Configuration module for the cognitive agentic system.
 *
 * Adapted from tinyaleph apps/agentic/lib/config.js for use inside ai-man.
 * Environment variable handling is simplified — ai-man uses its own config system.
 *
 * @module src/core/agentic/cognitive/config
 */

export const DEFAULT_COGNITIVE_CONFIG = {
  cognitive: {
    primeCount: 64,
    tickRate: 60,
    dimension: 16,
    coherenceThreshold: 0.7,
    entropyThreshold: 1.8,
    safetyThreshold: 0.7,
    // ObjectivityGate threshold (τR).  With 5 binary decoders the only
    // achievable R values are {0, 0.2, 0.4, 0.6, 0.8, 1.0}.  A threshold
    // of 0.6 requires ≥3/5 decoders to agree, which is appropriate for the
    // simple heuristic decoders (completeness, relevance, etc.) that can
    // reject valid LLM outputs ending in code blocks or markdown.
    objectivityThreshold: 0.6,
    initTicks: 10
  },
  agent: {
    // Maximum sequential tool-call rounds before forcing a text response.
    // Set to 6 to accommodate multi-step workflows (e.g. read→search→write→verify).
    // NOTE: The agent makes one additional "force text" LLM call after tool rounds
    // exhaust without producing content, so worst-case LLM calls = maxToolRounds + 1.
    maxToolRounds: 6,
    maxHistory: 50,
    systemPrompt: `You are an AI agent with cognitive awareness and tool-calling capabilities. You have access to tools for reading/writing files, listing directories, running commands, checking your cognitive state, and recalling memories.

CRITICAL RULES:
1. For general knowledge questions (facts, reasoning, math), answer DIRECTLY from your training — do NOT use tools.
2. When asked about file contents or code, ALWAYS use read_file — never guess. When file contents are provided to you, analyze them in detail referencing specific function names, class names, variable values.
3. When asked about your cognitive state, ALWAYS use cognitive_state. Analyze the diagnostics data thoroughly — discuss specific values for coherence, entropy, oscillator synchronization, and any anomalies.
4. When a file operation fails, explain the error clearly — never refuse or say "I can't assist with that". Report what happened and why.
5. NEVER make up code examples or file contents. Only cite what you have actually read.
6. When comparing files, highlight specific differences and similarities with line references or function names.`,
    objectivityThreshold: 0.6
  },
  lmscript: {
    // Budget configuration for CostTracker
    budget: {
      maxTotalCost: null,        // null = unlimited, or number (e.g. 1.0 for $1 max)
      maxCostPerExecution: null,  // null = unlimited, or per-turn cost limit
      costPerToken: {
        input: 0.000003,         // default ~$3/1M tokens (GPT-4o-mini level)
        output: 0.000015         // default ~$15/1M tokens
      },
      warnAtPercentage: 80       // emit warning when this % of budget used
    },

    // Rate limiter configuration
    rateLimit: {
      maxRequests: 60,           // max requests per window
      windowMs: 60000,           // window size in ms (1 minute)
      retryAfterMs: 1000         // delay before retrying after rate limit hit
    },

    // Circuit breaker configuration for LLM provider resilience
    circuitBreaker: {
      maxFailures: 5,            // failures before circuit opens
      resetTimeoutMs: 30000,     // time before trying again (30s)
      halfOpenMax: 2             // successful requests needed to close circuit
    },

    // Context window management
    context: {
      maxTokens: 128000,         // max context window size
      pruneStrategy: 'summarize', // 'fifo' or 'summarize'
      reserveTokens: 4096,       // tokens reserved for response
      summaryModel: null         // model for summarization (null = use same model)
    },

    // Logger configuration
    logger: {
      minLevel: 'info',          // 'debug', 'info', 'warn', 'error'
      enableSpans: true,         // enable span-based tracing
      emitStatus: true           // bridge to eventBus status events
    },

    // CognitiveAgent.turn() handles the cognitive phases (guard, recall,
    // memory, evolution) directly, so middleware hooks are disabled by
    // default to avoid double-processing.  Set to true only if using
    // lmscript middleware without the CognitiveAgent wrapper.
    middleware: {
      enableGuard: false,
      enableRecall: false,
      enableMemory: false,
      enableEvolution: false
    }
  },
  planner: {
    enabled: true,               // feature flag — set false to disable task decomposition
    maxSteps: 10,                // max steps in a generated plan
    minComplexityWords: 20,      // min words for heuristic complexity check
    autoRetryFailedSteps: false, // auto-retry failed steps (not yet implemented)
    skipDependentOnFailure: true // skip steps that depend on failed ones
  }
};

/**
 * Deep-merge `source` into `target`, returning a new object.
 * Arrays are replaced (not concatenated).
 *
 * @param {Object} target
 * @param {Object} source
 * @returns {Object}
 */
function deepMerge(target, source) {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];

    if (
      srcVal !== null &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(tgtVal, srcVal);
    } else {
      result[key] = srcVal;
    }
  }

  return result;
}

/**
 * Resolve a user-supplied configuration against defaults.
 * @param {Object} userConfig
 * @returns {Object}
 */
export function resolveCognitiveConfig(userConfig = {}) {
  return deepMerge(DEFAULT_COGNITIVE_CONFIG, userConfig);
}

export default DEFAULT_COGNITIVE_CONFIG;
