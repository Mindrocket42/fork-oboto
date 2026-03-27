// ==========================================
// LLM API INTEGRATION (via @sschepis/lmscript)
// ==========================================

import { LScriptRuntime, GeminiProvider } from '@sschepis/lmscript';
import { apiKey } from './config.mjs';

/**
 * Recursively strip properties that Gemini's API doesn't support
 * (additionalProperties, default, $schema, etc.) from a JSON Schema object.
 * This mirrors sanitizeSchemaForGemini in the main Gemini adapter.
 */
function sanitizeSchema(schema) {
    if (!schema || typeof schema !== 'object') return schema;
    const clean = { ...schema };
    delete clean.additionalProperties;
    delete clean.default;
    delete clean.$schema;
    delete clean.minimum;
    delete clean.maximum;
    // Recursively clean nested properties
    if (clean.properties && typeof clean.properties === 'object') {
        const cleanProps = {};
        for (const [key, value] of Object.entries(clean.properties)) {
            cleanProps[key] = sanitizeSchema(value);
        }
        clean.properties = cleanProps;
    }
    if (clean.items) {
        clean.items = sanitizeSchema(clean.items);
    }
    return clean;
}

/**
 * Patched GeminiProvider that sanitizes response schemas before sending
 * to the Gemini API.  Zod's zodToJsonSchema includes `additionalProperties`
 * which Gemini rejects with HTTP 400.
 */
class PatchedGeminiProvider extends GeminiProvider {
    buildRequestBody(request) {
        const body = super.buildRequestBody(request);
        // Sanitize the responseSchema if present
        if (body?.generationConfig?.responseSchema) {
            body.generationConfig.responseSchema = sanitizeSchema(
                body.generationConfig.responseSchema
            );
        }
        return body;
    }
}

let _runtime = null;

/**
 * Create (or return cached) LScriptRuntime backed by GeminiProvider.
 * The runtime handles retries, schema validation, and structured output natively.
 */
export const getRuntime = () => {
    if (!_runtime) {
        const provider = new PatchedGeminiProvider({ apiKey });
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
