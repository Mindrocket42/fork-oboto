import { AI_PROVIDERS } from '../constants.mjs';
import { withRetry, isCancellationError } from '../utils.mjs';
import { transformRequestBody } from './openai.mjs';

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Call Azure OpenAI Service via REST (non-streaming).
 *
 * Azure OpenAI uses the same request/response format as OpenAI, but with
 * different authentication (`api-key` header) and endpoint structure
 * (per-deployment URL). The endpoint and auth headers are already
 * constructed by `detection.mjs` (`getEndpoint` and `getAuthHeaders`),
 * so this adapter reuses `transformRequestBody` from the OpenAI adapter
 * and performs a standard fetch.
 *
 * Note: Azure ignores the `model` field — the deployment in the URL
 * determines which model is used.
 *
 * @param {Object} ctx - Provider context { provider, endpoint, headers, model }
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal|null} signal - Abort signal for cancellation
 * @returns {Promise<Object>} OpenAI-compatible parsed JSON response
 */
export async function callAzureOpenAIREST(ctx, requestBody, signal) {
    const body = transformRequestBody(AI_PROVIDERS.OPENAI, requestBody);

    const PER_CALL_TIMEOUT = 180_000;
    const timeoutSignal = AbortSignal.timeout(PER_CALL_TIMEOUT);
    const combinedSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;

    const response = await withRetry(() => fetch(ctx.endpoint, {
        method: 'POST',
        headers: ctx.headers,
        body: JSON.stringify(body),
        signal: combinedSignal,
    }), 3, 2000);

    if (!response.ok) {
        let detail = response.statusText;
        try {
            const errBody = await response.text();
            const parsed = JSON.parse(errBody);
            detail = parsed.error?.message || errBody.substring(0, 500);
        } catch { /* use statusText fallback */ }
        throw new Error(`Azure OpenAI API Error: ${response.status} - ${detail}`);
    }

    return response.json();
}

/**
 * Call Azure OpenAI Service via REST with SSE streaming.
 * Returns the raw Response object so the caller can read the SSE stream.
 *
 * Azure OpenAI uses the same SSE format as OpenAI, so no stream
 * transformation is needed — the raw response is returned directly.
 *
 * @param {Object} ctx - Provider context { provider, endpoint, headers, model }
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal|null} signal - Abort signal for cancellation
 * @returns {Promise<Response>} Raw Response with SSE body in OpenAI format
 */
export async function callAzureOpenAIRESTStream(ctx, requestBody, signal) {
    const body = transformRequestBody(AI_PROVIDERS.OPENAI, { ...requestBody, stream: true });

    const PER_CALL_TIMEOUT = 180_000;
    const timeoutSignal = AbortSignal.timeout(PER_CALL_TIMEOUT);
    const combinedSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;

    const response = await withRetry(() => fetch(ctx.endpoint, {
        method: 'POST',
        headers: ctx.headers,
        body: JSON.stringify(body),
        signal: combinedSignal,
    }), 3, 2000);

    if (!response.ok) {
        let detail = response.statusText;
        try {
            const errBody = await response.text();
            const parsed = JSON.parse(errBody);
            detail = parsed.error?.message || errBody.substring(0, 500);
        } catch { /* use statusText fallback */ }
        throw new Error(`Azure OpenAI API Error: ${response.status} - ${detail}`);
    }

    return response;
}
