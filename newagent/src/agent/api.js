// ==========================================
// LLM API INTEGRATION (via @sschepis/lmscript)
// ==========================================

import { LScriptRuntime, GeminiProvider } from '@sschepis/lmscript';
import { apiKey } from './config.js';

let _runtime = null;

/**
 * Create (or return cached) LScriptRuntime backed by GeminiProvider.
 * The runtime handles retries, schema validation, and structured output natively.
 */
export const getRuntime = () => {
    if (!_runtime) {
        const provider = new GeminiProvider({ apiKey });
        _runtime = new LScriptRuntime({
            provider,
            defaultTemperature: 0.1,
            defaultMaxRetries: 3,
        });
    }
    return _runtime;
};

/**
 * Execute an LScriptFunction against the shared runtime.
 * Returns the validated, typed result (e.g. { reflection, reasoning, commands }).
 */
export const executeFunction = async (lmFunction, input) => {
    const runtime = getRuntime();
    const result = await runtime.execute(lmFunction, input);
    return result.data;
};
