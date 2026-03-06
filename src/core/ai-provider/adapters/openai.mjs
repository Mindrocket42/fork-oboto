import { AI_PROVIDERS } from '../constants.mjs';
import { withRetry } from '../utils.mjs';
import { consoleStyler } from '../../../ui/console-styler.mjs';

/**
 * Transform request body for provider-specific quirks (REST providers only)
 * @param {string} provider - The provider key
 * @param {Object} body - The OpenAI-compatible request body
 * @returns {Object} The transformed request body
 */
export function transformRequestBody(provider, body) {
    const transformed = { ...body };

    switch (provider) {
        case AI_PROVIDERS.OPENAI:
            // OpenAI doesn't support reasoning_effort for most models
            // Keep it for models that might support it (o1, etc.)
            break;

        case AI_PROVIDERS.LMSTUDIO:
        default:
            // Local servers typically don't support reasoning_effort
            delete transformed.reasoning_effort;
            // LM Studio supports json_schema structured output natively via its
            // OpenAI-compatible API — keep it as-is so the loaded model can use
            // the schema constraints.  If the model doesn't support it, the 400
            // fallback in callOpenAIREST/callOpenAIRESTStream will retry without
            // structured output.
            break;
    }

    return transformed;
}

/** Regex to identify capability/parameter errors (vs content/context errors) */
const CAPABILITY_ERROR_RE = /not support|unsupported|unknown.*(parameter|field|property)|invalid.*tool|invalid.*response_format|json_schema/i;

/**
 * Graduated fallback for LMStudio 400 errors.
 *
 * When a local model doesn't support tools or structured output, the server
 * returns 400.  This helper tries progressively simpler request bodies:
 *   1. Downgrade json_schema → json_object (keep tools)
 *   2. Strip tools + tool_choice + response_format entirely
 *   3. Strip just response_format (when there are no tools)
 *
 * @param {Object} ctx       - Provider context (endpoint, headers, provider)
 * @param {Object} body      - The original (transformed) request body
 * @param {AbortSignal|null} signal - Caller's abort signal
 * @param {Response} errorResponse - The 400 response from the initial request
 * @param {Object} options
 * @param {boolean} options.streaming - Whether this is a streaming request
 * @param {number}  [options.perCallTimeout] - Per-call timeout in ms (non-streaming only)
 * @returns {Promise<Response|null>} A successful Response, or null if all fallbacks failed
 */
async function tryLMStudioFallback(ctx, body, signal, errorResponse, { streaming, perCallTimeout }) {
    const logPrefix = streaming ? 'LMStudio stream' : 'LMStudio';

    let errorBody = '';
    try {
        errorBody = await errorResponse.clone().text();
        consoleStyler.log('debug', `${logPrefix} 400 response: ${errorBody.substring(0, 500)}`);
    } catch { /* ignore logging errors */ }

    // Only retry if the error indicates an unsupported feature/parameter,
    // not a content issue (e.g. context length exceeded, invalid content).
    const isCapabilityError = !errorBody || CAPABILITY_ERROR_RE.test(errorBody);

    if (!isCapabilityError) {
        consoleStyler.log('debug', `${logPrefix}: 400 is not a capability error, skipping fallback`);
        return null;
    }

    const hasJsonSchema = body.response_format?.type === 'json_schema';
    const hasTools = !!body.tools;

    /**
     * Build a signal for a fallback fetch.
     * Streaming: use only the caller's signal (no timeout).
     * Non-streaming: create a fresh timeout signal.
     */
    function makeFallbackSignal() {
        if (streaming) return signal;
        const ts = AbortSignal.timeout(perCallTimeout);
        return signal ? AbortSignal.any([signal, ts]) : ts;
    }

    // Step 1: If using json_schema, try downgrading to json_object first
    // (keeps tools intact so tool calling still works if supported).
    if (hasJsonSchema) {
        const downgraded = { ...body, response_format: { type: 'json_object' } };
        const dg1Response = await fetch(ctx.endpoint, {
            method: 'POST',
            headers: ctx.headers,
            body: JSON.stringify(downgraded),
            signal: makeFallbackSignal(),
        });
        if (dg1Response.ok) {
            consoleStyler.log('debug', `${logPrefix}: json_schema unsupported, downgraded to json_object`);
            return dg1Response;
        }
        // Log intermediate failure so debugging doesn't require guesswork
        consoleStyler.log('debug', `${logPrefix}: json_object fallback also failed (${dg1Response.status})`);
    }

    // Step 2: Strip tools, tool_choice, and response_format entirely
    if (hasTools) {
        const { tools: _stripped, tool_choice: _tc, response_format: _rf,
                ...bodyWithoutTools } = body;
        const retryResponse = await fetch(ctx.endpoint, {
            method: 'POST',
            headers: ctx.headers,
            body: JSON.stringify(bodyWithoutTools),
            signal: makeFallbackSignal(),
        });
        if (retryResponse.ok) {
            consoleStyler.log('debug', `${logPrefix}: tools unsupported, retried without tools/response_format`);
            return retryResponse;
        }
        consoleStyler.log('debug', `${logPrefix}: tools-stripped fallback also failed (${retryResponse.status})`);
    } else if (body.response_format) {
        // No tools but response_format failed — strip just response_format
        const { response_format: _rf, ...bodyWithoutFormat } = body;
        const rf2Response = await fetch(ctx.endpoint, {
            method: 'POST',
            headers: ctx.headers,
            body: JSON.stringify(bodyWithoutFormat),
            signal: makeFallbackSignal(),
        });
        if (rf2Response.ok) {
            consoleStyler.log('debug', `${logPrefix}: response_format unsupported, retried without it`);
            return rf2Response;
        }
        consoleStyler.log('debug', `${logPrefix}: response_format-stripped fallback also failed (${rf2Response.status})`);
    }

    // All fallback attempts failed
    return null;
}

/**
 * Call OpenAI or local server using REST (non-streaming)
 */
export async function callOpenAIREST(ctx, requestBody, signal) {
    const body = transformRequestBody(ctx.provider, requestBody);

    // Combine caller-provided signal with a per-call timeout so requests
    // don't hang indefinitely even when no user-cancellation signal is present.
    // 180s accommodates local models (LMStudio) that can take 90-120s on
    // complex prompts with large context windows.
    const PER_CALL_TIMEOUT = 180_000;
    const timeoutSignal = AbortSignal.timeout(PER_CALL_TIMEOUT);
    const combinedSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;

    // Use a longer total timeout for LMStudio — local models can take 90-120s
    // on complex prompts.  Cloud providers keep the default 90s.
    const retryTimeout = ctx.provider === AI_PROVIDERS.LMSTUDIO ? 300_000 : undefined;
    const response = await withRetry(() => fetch(ctx.endpoint, {
        method: 'POST',
        headers: ctx.headers,
        body: JSON.stringify(body),
        signal: combinedSignal,
    }), 3, 2000, retryTimeout);

    // LMStudio (and other local servers) return 400 when the loaded model
    // doesn't support function/tool calling or structured output.
    if (!response.ok && response.status === 400 &&
        ctx.provider === AI_PROVIDERS.LMSTUDIO &&
        (body.tools || body.response_format)) {

        const fallbackResponse = await tryLMStudioFallback(ctx, body, signal, response, {
            streaming: false,
            perCallTimeout: PER_CALL_TIMEOUT,
        });
        if (fallbackResponse) {
            return fallbackResponse.json();
        }
        // All fallback attempts failed — fall through to the error below
        // using the original response status for a more meaningful message.
    }

    if (!response.ok) {
        const providerLabel = ctx.provider === AI_PROVIDERS.LMSTUDIO
            ? 'LMStudio AI server (is LMStudio running?)'
            : `${ctx.provider} API`;
        throw new Error(`${providerLabel} Error: ${response.status} - ${response.statusText}`);
    }

    return response.json();
}

/**
 * Call OpenAI or local server using REST with SSE streaming.
 * Returns the raw Response object so the caller can read the SSE stream.
 * Does NOT apply a per-call timeout since streaming connections must stay
 * open for the entire generation duration (which can exceed 60s).
 */
export async function callOpenAIRESTStream(ctx, requestBody, signal) {
    const body = transformRequestBody(ctx.provider, { ...requestBody, stream: true });

    // Only use the caller's abort signal — no timeout for streaming connections.
    // LMStudio gets a longer total retry timeout to accommodate slow local models.
    const streamRetryTimeout = ctx.provider === AI_PROVIDERS.LMSTUDIO ? 300_000 : undefined;
    const response = await withRetry(() => fetch(ctx.endpoint, {
        method: 'POST',
        headers: ctx.headers,
        body: JSON.stringify(body),
        signal,
    }), 3, 2000, streamRetryTimeout);

    // LMStudio: graduated fallback on 400 — same strategy as non-streaming.
    if (!response.ok && response.status === 400 &&
        ctx.provider === AI_PROVIDERS.LMSTUDIO &&
        (body.tools || body.response_format)) {

        const fallbackResponse = await tryLMStudioFallback(ctx, body, signal, response, {
            streaming: true,
        });
        if (fallbackResponse) {
            return fallbackResponse;
        }
    }

    if (!response.ok) {
        const providerLabel = ctx.provider === AI_PROVIDERS.LMSTUDIO
            ? 'LMStudio AI server (is LMStudio running?)'
            : `${ctx.provider} API`;
        throw new Error(`${providerLabel} Error: ${response.status} - ${response.statusText}`);
    }

    return response;
}
