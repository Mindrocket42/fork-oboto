import config from '../../../config.mjs';
import { AI_PROVIDERS } from '../constants.mjs';
import { withRetry, isCancellationError } from '../utils.mjs';

// ─── Constants ───────────────────────────────────────────────────────────

/**
 * OpenAI-compatible chat completions endpoint on HuggingFace Inference API.
 * Preferred for chat/instruct models.
 * @type {string}
 */
const HF_CHAT_ENDPOINT = 'https://api-inference.huggingface.co/v1/chat/completions';

/**
 * Base URL for the HuggingFace serverless text generation endpoint.
 * Used as fallback for non-chat models.
 * @type {string}
 */
const HF_MODELS_BASE = 'https://api-inference.huggingface.co/models';

/**
 * Known model prefixes/patterns that use the text-generation endpoint
 * instead of the OpenAI-compatible chat endpoint.
 * @type {RegExp[]}
 */
const TEXT_GEN_PATTERNS = [
    /^bigscience\//i,
    /^gpt2/i,
    /^EleutherAI\//i,
    /text-generation/i,
];

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Determine if a model should use the text-generation endpoint
 * instead of the OpenAI-compatible chat endpoint.
 *
 * @param {string} modelId - HuggingFace model ID
 * @returns {boolean} True if the model should use text-generation endpoint
 */
function isTextGenModel(modelId) {
    return TEXT_GEN_PATTERNS.some(p => p.test(modelId));
}

/**
 * Get the authorization headers for HuggingFace API calls.
 *
 * @param {Object} ctx - Provider context
 * @returns {Object} Headers object with Authorization and Content-Type
 */
function getHuggingFaceHeaders(ctx) {
    const token = ctx.headers?.['Authorization']?.replace('Bearer ', '')
        || config.keys.huggingface;

    if (!token) {
        throw new Error('HuggingFace API token not configured. Set HUGGINGFACE_API_TOKEN environment variable.');
    }

    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
    };
}

/**
 * Convert OpenAI-format messages to a single prompt string for
 * the text-generation endpoint.
 *
 * @param {Array<Object>} messages - OpenAI-format messages
 * @returns {string} Concatenated prompt string
 */
function messagesToPrompt(messages) {
    const parts = [];

    for (const msg of messages) {
        if (msg.role === 'system') {
            parts.push(`System: ${msg.content || ''}`);
        } else if (msg.role === 'user') {
            parts.push(`User: ${msg.content || ''}`);
        } else if (msg.role === 'assistant') {
            parts.push(`Assistant: ${msg.content || ''}`);
        }
    }

    // Add final assistant prefix to prompt generation
    parts.push('Assistant:');
    return parts.join('\n');
}

/**
 * Convert a HuggingFace text-generation response to OpenAI-compatible format.
 *
 * HF text-generation response: `[{ generated_text: "..." }]`
 *
 * @param {Array<Object>|Object} hfResponse - HuggingFace text-generation response
 * @returns {Object} OpenAI-compatible response
 */
function textGenResponseToOpenai(hfResponse) {
    const results = Array.isArray(hfResponse) ? hfResponse : [hfResponse];
    const generatedText = results[0]?.generated_text || '';

    return {
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content: generatedText.trim() || null,
            },
            finish_reason: 'stop',
        }],
        usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        },
    };
}

// ─── Text Generation Endpoint (Fallback) ─────────────────────────────────

/**
 * Call HuggingFace text-generation endpoint for non-chat models.
 *
 * @param {Object} ctx - Provider context
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {string} modelId - HuggingFace model ID
 * @param {AbortSignal|null} signal - Abort signal
 * @returns {Promise<Object>} OpenAI-compatible response
 */
async function callTextGenREST(ctx, requestBody, modelId, signal) {
    const headers = getHuggingFaceHeaders(ctx);
    const prompt = messagesToPrompt(requestBody.messages || []);

    const body = {
        inputs: prompt,
        parameters: {},
    };

    if (requestBody.max_tokens != null) {
        body.parameters.max_new_tokens = requestBody.max_tokens;
    }
    if (requestBody.temperature != null) {
        body.parameters.temperature = requestBody.temperature;
    }
    if (requestBody.top_p != null) {
        body.parameters.top_p = requestBody.top_p;
    }
    if (requestBody.stop) {
        body.parameters.stop = Array.isArray(requestBody.stop)
            ? requestBody.stop
            : [requestBody.stop];
    }

    // HF might need wait_for_model for cold starts
    body.options = { wait_for_model: true };

    const url = `${HF_MODELS_BASE}/${modelId}`;

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
            detail = parsed.error || errBody.substring(0, 500);
        } catch { /* use statusText fallback */ }
        throw new Error(`HuggingFace API Error: ${response.status} - ${detail}`);
    }

    const hfResponse = await response.json();
    return textGenResponseToOpenai(hfResponse);
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Call HuggingFace Inference API via REST (non-streaming).
 *
 * Prefers the OpenAI-compatible chat completions endpoint for chat/instruct
 * models. Falls back to the text-generation endpoint for non-chat models.
 *
 * The OpenAI-compatible endpoint accepts the same request/response format
 * as OpenAI, so no translation is needed for chat models.
 *
 * @param {Object} ctx - Provider context { provider, endpoint, headers, model }
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal|null} signal - Abort signal for cancellation
 * @returns {Promise<Object>} OpenAI-compatible parsed JSON response
 */
export async function callHuggingFaceREST(ctx, requestBody, signal) {
    const modelId = requestBody.model || ctx.model;

    // For text-generation models, use the dedicated endpoint
    if (isTextGenModel(modelId)) {
        return callTextGenREST(ctx, requestBody, modelId, signal);
    }

    // Use OpenAI-compatible chat completions endpoint
    const headers = getHuggingFaceHeaders(ctx);

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

    const PER_CALL_TIMEOUT = 180_000;
    const timeoutSignal = AbortSignal.timeout(PER_CALL_TIMEOUT);
    const combinedSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;

    const response = await withRetry(() => fetch(HF_CHAT_ENDPOINT, {
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
            detail = parsed.error?.message || parsed.error || errBody.substring(0, 500);
        } catch { /* use statusText fallback */ }
        throw new Error(`HuggingFace API Error: ${response.status} - ${detail}`);
    }

    // Response is already in OpenAI-compatible format
    return response.json();
}

/**
 * Call HuggingFace Inference API via REST with SSE streaming.
 *
 * Uses the OpenAI-compatible chat completions endpoint with `stream: true`.
 * The response is already in OpenAI SSE format, so no stream transformation
 * is needed for chat models.
 *
 * For text-generation models, falls back to a non-streaming call and
 * emits the result as a single SSE event.
 *
 * @param {Object} ctx - Provider context { provider, endpoint, headers, model }
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal|null} signal - Abort signal for cancellation
 * @returns {Promise<Response>} Response with SSE body in OpenAI format
 */
export async function callHuggingFaceRESTStream(ctx, requestBody, signal) {
    const modelId = requestBody.model || ctx.model;

    // Text-generation models don't support OpenAI-compatible streaming;
    // fall back to non-streaming and emit as a single SSE event
    if (isTextGenModel(modelId)) {
        const result = await callTextGenREST(ctx, requestBody, modelId, signal);
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

    // Use OpenAI-compatible chat endpoint with streaming
    const headers = getHuggingFaceHeaders(ctx);

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

    const response = await withRetry(() => fetch(HF_CHAT_ENDPOINT, {
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
            detail = parsed.error?.message || parsed.error || errBody.substring(0, 500);
        } catch { /* use statusText fallback */ }
        throw new Error(`HuggingFace API Error: ${response.status} - ${detail}`);
    }

    // SSE body is already in OpenAI format — return directly
    return response;
}
