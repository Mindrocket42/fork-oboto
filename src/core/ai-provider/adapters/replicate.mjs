import config from '../../../config.mjs';
import { AI_PROVIDERS } from '../constants.mjs';
import { withRetry, isCancellationError } from '../utils.mjs';

// ─── Replicate Format Translation ────────────────────────────────────────

/**
 * Default polling interval in milliseconds for async predictions.
 * @type {number}
 */
const POLL_INTERVAL_MS = 1500;

/**
 * Maximum number of polling attempts before timing out.
 * @type {number}
 */
const MAX_POLL_ATTEMPTS = 120;

/**
 * Base URL for the Replicate API.
 * @type {string}
 */
const REPLICATE_API_BASE = 'https://api.replicate.com/v1';

/**
 * Convert OpenAI-format messages into a prompt string for Replicate models.
 * Concatenates messages with role prefixes, suitable for text-generation models.
 *
 * @param {Array<Object>} messages - OpenAI-format messages
 * @returns {{ prompt: string, systemPrompt: string|undefined }}
 */
function messagesToPrompt(messages) {
    let systemPrompt;
    const parts = [];

    for (const msg of messages) {
        if (msg.role === 'system') {
            systemPrompt = msg.content || '';
        } else if (msg.role === 'user') {
            parts.push(msg.content || '');
        } else if (msg.role === 'assistant') {
            parts.push(`Assistant: ${msg.content || ''}`);
        } else if (msg.role === 'tool') {
            parts.push(`Tool result: ${msg.content || ''}`);
        }
    }

    return {
        prompt: parts.join('\n\n'),
        systemPrompt,
    };
}

/**
 * Build the Replicate prediction input from an OpenAI-compatible request body.
 *
 * @param {Object} requestBody - OpenAI-format request body
 * @returns {Object} Replicate prediction input parameters
 */
function buildReplicateInput(requestBody) {
    const { prompt, systemPrompt } = messagesToPrompt(requestBody.messages || []);

    const input = { prompt };

    if (systemPrompt) {
        input.system_prompt = systemPrompt;
    }

    if (requestBody.max_tokens != null) {
        input.max_tokens = requestBody.max_tokens;
        input.max_new_tokens = requestBody.max_tokens;
    }

    if (requestBody.temperature != null) {
        input.temperature = requestBody.temperature;
    }

    if (requestBody.top_p != null) {
        input.top_p = requestBody.top_p;
    }

    if (requestBody.stop) {
        input.stop_sequences = Array.isArray(requestBody.stop)
            ? requestBody.stop.join(',')
            : requestBody.stop;
    }

    return input;
}

/**
 * Convert a Replicate prediction output to OpenAI-compatible format.
 *
 * Replicate outputs are typically an array of strings (token-by-token)
 * that should be joined, or sometimes a single string.
 *
 * @param {Object} prediction - Replicate prediction response
 * @returns {Object} OpenAI-compatible response
 */
function replicateResponseToOpenai(prediction) {
    let content = '';

    if (Array.isArray(prediction.output)) {
        content = prediction.output.join('');
    } else if (typeof prediction.output === 'string') {
        content = prediction.output;
    }

    // Trim leading/trailing whitespace from generation
    content = content.trim() || null;

    const finishReason = 'stop';

    return {
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content,
            },
            finish_reason: finishReason,
        }],
        usage: {
            prompt_tokens: prediction.metrics?.input_token_count || 0,
            completion_tokens: prediction.metrics?.output_token_count || 0,
            total_tokens: (prediction.metrics?.input_token_count || 0) +
                          (prediction.metrics?.output_token_count || 0),
        },
    };
}

/**
 * Get the authorization headers for Replicate API calls.
 *
 * @param {Object} ctx - Provider context
 * @returns {Object} Headers object with Authorization
 */
function getReplicateHeaders(ctx) {
    const token = ctx.headers?.['Authorization']?.replace('Bearer ', '')
        || config.keys.replicate;

    if (!token) {
        throw new Error('Replicate API token not configured. Set REPLICATE_API_TOKEN environment variable.');
    }

    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait',
    };
}

/**
 * Parse a Replicate model identifier into version and model components.
 * Replicate model IDs can be:
 * - `owner/name:version` (specific version)
 * - `owner/name` (latest version — uses the models API)
 *
 * @param {string} modelId - Replicate model identifier
 * @returns {{ model: string, version: string|null }}
 */
function parseModelId(modelId) {
    if (modelId.includes(':')) {
        const [model, version] = modelId.split(':');
        return { model, version };
    }
    return { model: modelId, version: null };
}

// ─── Polling Helper ──────────────────────────────────────────────────────

/**
 * Poll a Replicate prediction until it completes or fails.
 *
 * @param {string} predictionId - The prediction ID to poll
 * @param {Object} headers - Authorization headers
 * @param {AbortSignal|null} signal - Abort signal
 * @returns {Promise<Object>} Completed prediction object
 */
async function pollPrediction(predictionId, headers, signal) {
    const pollUrl = `${REPLICATE_API_BASE}/predictions/${predictionId}`;

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        if (signal?.aborted) {
            const err = new Error('Prediction polling aborted');
            err.name = 'AbortError';
            throw err;
        }

        const response = await fetch(pollUrl, {
            method: 'GET',
            headers: { 'Authorization': headers['Authorization'] },
            signal,
        });

        if (!response.ok) {
            let detail = response.statusText;
            try {
                const errBody = await response.text();
                const parsed = JSON.parse(errBody);
                detail = parsed.detail || errBody.substring(0, 500);
            } catch { /* use statusText fallback */ }
            throw new Error(`Replicate API Error (poll): ${response.status} - ${detail}`);
        }

        const prediction = await response.json();

        if (prediction.status === 'succeeded') {
            return prediction;
        }

        if (prediction.status === 'failed' || prediction.status === 'canceled') {
            throw new Error(`Replicate prediction ${prediction.status}: ${prediction.error || 'unknown error'}`);
        }

        // Still processing — wait before polling again
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    throw new Error(`Replicate prediction timed out after ${MAX_POLL_ATTEMPTS} polling attempts`);
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Call Replicate API via REST (non-streaming).
 *
 * Creates a prediction and polls until completion. Uses the `Prefer: wait`
 * header to attempt synchronous completion, falling back to polling if the
 * prediction starts asynchronously.
 *
 * Model IDs follow the Replicate format: `owner/name:version` or `owner/name`.
 *
 * @param {Object} ctx - Provider context { provider, endpoint, headers, model }
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal|null} signal - Abort signal for cancellation
 * @returns {Promise<Object>} OpenAI-compatible parsed JSON response
 */
export async function callReplicateREST(ctx, requestBody, signal) {
    const headers = getReplicateHeaders(ctx);
    const modelId = requestBody.model || ctx.model;
    const { model, version } = parseModelId(modelId);
    const input = buildReplicateInput(requestBody);

    const PER_CALL_TIMEOUT = 180_000;
    const timeoutSignal = AbortSignal.timeout(PER_CALL_TIMEOUT);
    const combinedSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;

    // Determine the endpoint: use versioned predictions or model-based
    let predictUrl;
    let body;

    if (version) {
        predictUrl = `${REPLICATE_API_BASE}/predictions`;
        body = { version, input };
    } else {
        // Use the models endpoint for latest version
        predictUrl = `${REPLICATE_API_BASE}/models/${model}/predictions`;
        body = { input };
    }

    const response = await withRetry(() => fetch(predictUrl, {
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
            detail = parsed.detail || errBody.substring(0, 500);
        } catch { /* use statusText fallback */ }
        throw new Error(`Replicate API Error: ${response.status} - ${detail}`);
    }

    let prediction = await response.json();

    // If the prediction completed synchronously (Prefer: wait), return directly
    if (prediction.status === 'succeeded') {
        return replicateResponseToOpenai(prediction);
    }

    // If the prediction failed immediately
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
        throw new Error(`Replicate prediction ${prediction.status}: ${prediction.error || 'unknown error'}`);
    }

    // Otherwise, poll until completion
    prediction = await pollPrediction(prediction.id, headers, combinedSignal);
    return replicateResponseToOpenai(prediction);
}

/**
 * Call Replicate API via REST with SSE streaming.
 *
 * Creates a prediction with `stream: true`, obtains the stream URL from
 * the response, and reads SSE events from that URL. Translates Replicate
 * stream events to OpenAI-format SSE chunks.
 *
 * Replicate streaming events:
 * - `output`: Token text in `event.data`
 * - `done`: Stream complete
 * - `error`: Error message in `event.data`
 *
 * @param {Object} ctx - Provider context { provider, endpoint, headers, model }
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal|null} signal - Abort signal for cancellation
 * @returns {Promise<Response>} Synthetic Response with SSE body in OpenAI format
 */
export async function callReplicateRESTStream(ctx, requestBody, signal) {
    const headers = getReplicateHeaders(ctx);
    const modelId = requestBody.model || ctx.model;
    const { model, version } = parseModelId(modelId);
    const input = buildReplicateInput(requestBody);

    // Determine endpoint
    let predictUrl;
    let body;

    if (version) {
        predictUrl = `${REPLICATE_API_BASE}/predictions`;
        body = { version, input, stream: true };
    } else {
        predictUrl = `${REPLICATE_API_BASE}/models/${model}/predictions`;
        body = { input, stream: true };
    }

    const response = await withRetry(() => fetch(predictUrl, {
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
            detail = parsed.detail || errBody.substring(0, 500);
        } catch { /* use statusText fallback */ }
        throw new Error(`Replicate API Error: ${response.status} - ${detail}`);
    }

    const prediction = await response.json();

    // Get the stream URL from the prediction response
    const streamUrl = prediction.urls?.stream;

    if (!streamUrl) {
        // Model doesn't support streaming — fall back to polling and emit result as single SSE
        let completed = prediction;
        if (prediction.status !== 'succeeded') {
            completed = await pollPrediction(prediction.id, headers, signal);
        }
        const result = replicateResponseToOpenai(completed);
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

    // Fetch the SSE stream from the stream URL
    const streamResponse = await fetch(streamUrl, {
        method: 'GET',
        headers: {
            'Authorization': headers['Authorization'],
            'Accept': 'text/event-stream',
        },
        signal,
    });

    if (!streamResponse.ok) {
        throw new Error(`Replicate stream error: ${streamResponse.status} - ${streamResponse.statusText}`);
    }

    const replicateBody = streamResponse.body;
    const readable = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            const decoder = new TextDecoder();
            const reader = replicateBody.getReader();

            let buffer = '';

            try {
                while (true) {
                    if (signal?.aborted) break;

                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });

                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    let currentEventType = null;
                    for (const line of lines) {
                        if (line.startsWith('event: ')) {
                            currentEventType = line.slice(7).trim();
                            continue;
                        }

                        if (!line.startsWith('data: ')) continue;
                        const data = line.slice(6);

                        const eventType = currentEventType;
                        currentEventType = null;

                        if (eventType === 'done' || data === '') {
                            // Stream complete
                            const chunk = JSON.stringify({
                                choices: [{
                                    index: 0,
                                    delta: {},
                                    finish_reason: 'stop',
                                }],
                            });
                            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
                            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                            break;
                        }

                        if (eventType === 'error') {
                            controller.enqueue(
                                encoder.encode(`data: ${JSON.stringify({ error: data })}\n\n`)
                            );
                            break;
                        }

                        // Output event — data is the token text
                        if (eventType === 'output' || !eventType) {
                            const chunk = JSON.stringify({
                                choices: [{
                                    index: 0,
                                    delta: { content: data },
                                    finish_reason: null,
                                }],
                            });
                            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
                        }
                    }
                }
            } catch (err) {
                if (!isCancellationError(err)) {
                    controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`)
                    );
                }
            } finally {
                controller.close();
            }
        },
    });

    return new Response(readable, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
    });
}
