import config from '../../../config.mjs';
import { AI_PROVIDERS } from '../constants.mjs';
import { withRetry, isCancellationError } from '../utils.mjs';

// ─── Constants ───────────────────────────────────────────────────────────

/**
 * AI21 Jamba chat completions endpoint (OpenAI-compatible).
 * @type {string}
 */
const AI21_CHAT_ENDPOINT = 'https://api.ai21.com/studio/v1/chat/completions';

/**
 * Base URL for AI21 J2 model completion endpoint.
 * @type {string}
 */
const AI21_COMPLETE_BASE = 'https://api.ai21.com/studio/v1';

/**
 * Patterns matching J2-series models that use the legacy complete endpoint.
 * @type {RegExp}
 */
const J2_MODEL_PATTERN = /^j2-(ultra|mid|light)/i;

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Determine if a model is a legacy J2 model that uses the /complete endpoint.
 *
 * @param {string} modelId - AI21 model ID
 * @returns {boolean} True if the model is a J2 model
 */
function isJ2Model(modelId) {
    return J2_MODEL_PATTERN.test(modelId);
}

/**
 * Get the authorization headers for AI21 API calls.
 *
 * @param {Object} ctx - Provider context
 * @returns {Object} Headers object with Authorization and Content-Type
 */
function getAI21Headers(ctx) {
    const key = ctx.headers?.['Authorization']?.replace('Bearer ', '')
        || config.keys.ai21;

    if (!key) {
        throw new Error('AI21 API key not configured. Set AI21_API_KEY environment variable.');
    }

    return {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
    };
}

/**
 * Convert OpenAI-format messages to a prompt string for J2 models.
 *
 * @param {Array<Object>} messages - OpenAI-format messages
 * @returns {string} Concatenated prompt string
 */
function messagesToJ2Prompt(messages) {
    const parts = [];

    for (const msg of messages) {
        if (msg.role === 'system') {
            parts.push(msg.content || '');
        } else if (msg.role === 'user') {
            parts.push(`User: ${msg.content || ''}`);
        } else if (msg.role === 'assistant') {
            parts.push(`Assistant: ${msg.content || ''}`);
        }
    }

    return parts.join('\n\n');
}

/**
 * Convert a J2 completion response to OpenAI-compatible format.
 *
 * J2 response shape:
 * ```json
 * {
 *   "id": "...",
 *   "completions": [{
 *     "data": { "text": "..." },
 *     "finishReason": { "reason": "endoftext" | "length" }
 *   }]
 * }
 * ```
 *
 * @param {Object} j2Response - AI21 J2 completion response
 * @returns {Object} OpenAI-compatible response
 */
function j2ResponseToOpenai(j2Response) {
    const completion = j2Response.completions?.[0] || {};
    const text = completion.data?.text || '';

    let finishReason = 'stop';
    if (completion.finishReason?.reason === 'length') {
        finishReason = 'length';
    }

    return {
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content: text.trim() || null,
            },
            finish_reason: finishReason,
        }],
        usage: {
            prompt_tokens: j2Response.usage?.prompt_tokens || 0,
            completion_tokens: j2Response.usage?.completion_tokens || 0,
            total_tokens: j2Response.usage?.total_tokens || 0,
        },
    };
}

// ─── J2 Legacy Endpoint ──────────────────────────────────────────────────

/**
 * Call AI21 J2 complete endpoint for legacy J2 models.
 *
 * @param {Object} ctx - Provider context
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {string} modelId - AI21 model ID (e.g., 'j2-ultra')
 * @param {AbortSignal|null} signal - Abort signal
 * @returns {Promise<Object>} OpenAI-compatible response
 */
async function callJ2REST(ctx, requestBody, modelId, signal) {
    const headers = getAI21Headers(ctx);
    const prompt = messagesToJ2Prompt(requestBody.messages || []);

    const body = {
        prompt,
    };

    if (requestBody.max_tokens != null) body.maxTokens = requestBody.max_tokens;
    if (requestBody.temperature != null) body.temperature = requestBody.temperature;
    if (requestBody.top_p != null) body.topP = requestBody.top_p;
    if (requestBody.stop) {
        body.stopSequences = Array.isArray(requestBody.stop)
            ? requestBody.stop
            : [requestBody.stop];
    }

    const url = `${AI21_COMPLETE_BASE}/${modelId}/complete`;

    const PER_CALL_TIMEOUT = 180_000;
    const timeoutSignal = AbortSignal.timeout(PER_CALL_TIMEOUT);
    const combinedSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;

    const response = await withRetry(() => fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: combinedSignal,
    }), 3, 2000);

    if (!response.ok) {
        let detail = response.statusText;
        try {
            const errBody = await response.text();
            const parsed = JSON.parse(errBody);
            detail = parsed.detail || parsed.error || errBody.substring(0, 500);
        } catch { /* use statusText fallback */ }
        throw new Error(`AI21 API Error: ${response.status} - ${detail}`);
    }

    const j2Response = await response.json();
    return j2ResponseToOpenai(j2Response);
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Call AI21 Labs API via REST (non-streaming).
 *
 * For Jamba models, uses the OpenAI-compatible chat completions endpoint.
 * For legacy J2 models (j2-ultra, j2-mid, j2-light), uses the
 * `/v1/{model}/complete` endpoint with format translation.
 *
 * @param {Object} ctx - Provider context { provider, endpoint, headers, model }
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal|null} signal - Abort signal for cancellation
 * @returns {Promise<Object>} OpenAI-compatible parsed JSON response
 */
export async function callAI21REST(ctx, requestBody, signal) {
    const modelId = requestBody.model || ctx.model;

    // Legacy J2 models use a different endpoint and format
    if (isJ2Model(modelId)) {
        return callJ2REST(ctx, requestBody, modelId, signal);
    }

    // Jamba models — OpenAI-compatible chat completions endpoint
    const headers = getAI21Headers(ctx);

    const body = {
        model: modelId,
        messages: requestBody.messages || [],
    };

    if (requestBody.temperature != null) body.temperature = requestBody.temperature;
    if (requestBody.max_tokens != null) body.max_tokens = requestBody.max_tokens;
    if (requestBody.top_p != null) body.top_p = requestBody.top_p;
    if (requestBody.stop) body.stop = requestBody.stop;
    if (requestBody.tools) body.tools = requestBody.tools;
    if (requestBody.tool_choice) body.tool_choice = requestBody.tool_choice;
    if (requestBody.n != null) body.n = requestBody.n;

    const PER_CALL_TIMEOUT = 180_000;
    const timeoutSignal = AbortSignal.timeout(PER_CALL_TIMEOUT);
    const combinedSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;

    const response = await withRetry(() => fetch(AI21_CHAT_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: combinedSignal,
    }), 3, 2000);

    if (!response.ok) {
        let detail = response.statusText;
        try {
            const errBody = await response.text();
            const parsed = JSON.parse(errBody);
            detail = parsed.detail || parsed.error || errBody.substring(0, 500);
        } catch { /* use statusText fallback */ }
        throw new Error(`AI21 API Error: ${response.status} - ${detail}`);
    }

    // Response is already in OpenAI-compatible format for Jamba models
    return response.json();
}

/**
 * Call AI21 Labs API via REST with SSE streaming.
 *
 * For Jamba models, uses the OpenAI-compatible chat completions endpoint
 * with `stream: true`. The SSE format is OpenAI-compatible, so no stream
 * transformation is needed.
 *
 * For legacy J2 models, falls back to a non-streaming call and emits
 * the result as a single SSE event (J2 models do not support streaming).
 *
 * @param {Object} ctx - Provider context { provider, endpoint, headers, model }
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal|null} signal - Abort signal for cancellation
 * @returns {Promise<Response>} Response with SSE body in OpenAI format
 */
export async function callAI21RESTStream(ctx, requestBody, signal) {
    const modelId = requestBody.model || ctx.model;

    // J2 models don't support streaming — fall back to non-streaming
    if (isJ2Model(modelId)) {
        const result = await callJ2REST(ctx, requestBody, modelId, signal);
        const content = result.choices[0]?.message?.content || '';

        const readable = new ReadableStream({
            start(controller) {
                const encoder = new TextEncoder();
                const chunk = JSON.stringify({
                    choices: [{
                        index: 0,
                        delta: { content },
                        finish_reason: null,
                    }],
                });
                controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));

                const doneChunk = JSON.stringify({
                    choices: [{
                        index: 0,
                        delta: {},
                        finish_reason: 'stop',
                    }],
                });
                controller.enqueue(encoder.encode(`data: ${doneChunk}\n\n`));
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
            },
        });

        return new Response(readable, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
        });
    }

    // Jamba models — OpenAI-compatible streaming
    const headers = getAI21Headers(ctx);

    const body = {
        model: modelId,
        messages: requestBody.messages || [],
        stream: true,
    };

    if (requestBody.temperature != null) body.temperature = requestBody.temperature;
    if (requestBody.max_tokens != null) body.max_tokens = requestBody.max_tokens;
    if (requestBody.top_p != null) body.top_p = requestBody.top_p;
    if (requestBody.stop) body.stop = requestBody.stop;
    if (requestBody.tools) body.tools = requestBody.tools;
    if (requestBody.tool_choice) body.tool_choice = requestBody.tool_choice;
    if (requestBody.n != null) body.n = requestBody.n;

    const response = await withRetry(() => fetch(AI21_CHAT_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
    }), 3, 2000);

    if (!response.ok) {
        let detail = response.statusText;
        try {
            const errBody = await response.text();
            const parsed = JSON.parse(errBody);
            detail = parsed.detail || parsed.error || errBody.substring(0, 500);
        } catch { /* use statusText fallback */ }
        throw new Error(`AI21 API Error: ${response.status} - ${detail}`);
    }

    // SSE body is already in OpenAI format — return directly
    return response;
}
