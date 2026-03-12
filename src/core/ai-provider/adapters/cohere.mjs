import { AI_PROVIDERS } from '../constants.mjs';
import { withRetry, isCancellationError } from '../utils.mjs';

// ─── Cohere Format Translation ──────────────────────────────────────────

/**
 * Convert OpenAI tool definitions to Cohere v2 tool format.
 * Cohere uses `parameter_definitions` with a slightly different schema
 * structure instead of OpenAI's `parameters` JSON Schema.
 *
 * @param {Array} openaiTools - OpenAI-format tool definitions
 * @returns {Array} Cohere-format tool definitions
 */
function translateTools(openaiTools) {
    if (!openaiTools || openaiTools.length === 0) return undefined;

    return openaiTools.map(tool => {
        const fn = tool.function || tool;
        const params = fn.parameters || { type: 'object', properties: {} };

        // Convert JSON Schema properties → Cohere parameter_definitions
        const parameterDefinitions = {};
        if (params.properties) {
            const requiredSet = new Set(params.required || []);
            for (const [name, schema] of Object.entries(params.properties)) {
                parameterDefinitions[name] = {
                    type: schema.type || 'string',
                    description: schema.description || '',
                    required: requiredSet.has(name),
                };

                // Preserve enum values if present
                if (schema.enum) {
                    parameterDefinitions[name].enum = schema.enum;
                }
            }
        }

        return {
            type: 'function',
            function: {
                name: fn.name,
                description: fn.description || '',
                parameter_definitions: parameterDefinitions,
            },
        };
    });
}

/**
 * Translate OpenAI-format messages to Cohere v2 message format.
 *
 * Cohere v2 uses the same role names ("system", "user", "assistant") as OpenAI
 * for regular messages.  However, tool results use `{"role": "tool", ...}` with
 * `tool_call_id` (same key as OpenAI), and assistant tool calls must use
 * `tool_calls` with `parameters` (object) instead of `arguments` (string).
 *
 * This function normalises these differences so that multi-turn tool-use
 * conversations work correctly.
 *
 * @param {Array<Object>} messages - OpenAI-format messages
 * @returns {Array<Object>} Cohere v2-compatible messages
 */
function translateMessages(messages) {
    if (!messages || messages.length === 0) return [];

    return messages.map(msg => {
        // ── Tool result messages ──────────────────────────────────────
        // OpenAI: { role: "tool", tool_call_id: "...", content: "..." }
        // Cohere v2: { role: "tool", tool_call_id: "...", content: "..." }
        // The format is compatible but we normalise content to string.
        if (msg.role === 'tool') {
            return {
                role: 'tool',
                tool_call_id: msg.tool_call_id || msg.name || 'unknown',
                content: typeof msg.content === 'string'
                    ? msg.content
                    : JSON.stringify(msg.content ?? ''),
            };
        }

        // ── Assistant messages with tool_calls ────────────────────────
        // OpenAI: tool_calls[].function.arguments is a JSON string
        // Cohere v2: tool_calls[].function.arguments can be a string,
        // but some versions expect `parameters` as an object.  We keep
        // the OpenAI string format which Cohere v2 accepts, but ensure
        // each tool_call has the expected shape.
        if (msg.role === 'assistant' && msg.tool_calls?.length > 0) {
            return {
                role: 'assistant',
                content: msg.content || '',
                tool_calls: msg.tool_calls.map(tc => ({
                    id: tc.id || `call_${Math.random().toString(36).slice(2, 11)}`,
                    type: 'function',
                    function: {
                        name: tc.function?.name || tc.name || '',
                        arguments: typeof tc.function?.arguments === 'string'
                            ? tc.function.arguments
                            : JSON.stringify(tc.function?.arguments || {}),
                    },
                })),
            };
        }

        // ── All other messages (system, user, plain assistant) ────────
        return msg;
    });
}

/**
 * Build a Cohere v2 chat request body from an OpenAI-compatible request body.
 * Translates OpenAI message format (especially tool results and tool calls)
 * to the format Cohere v2 expects.
 *
 * @param {Object} requestBody - OpenAI-format request body
 * @param {string} model - The Cohere model to use
 * @returns {Object} Cohere v2 chat request body
 */
function buildCohereBody(requestBody, model) {
    const body = {
        model,
        messages: translateMessages(requestBody.messages || []),
    };

    if (requestBody.temperature != null) {
        body.temperature = requestBody.temperature;
    }

    if (requestBody.max_tokens != null) {
        body.max_tokens = requestBody.max_tokens;
    }

    if (requestBody.top_p != null) {
        body.p = requestBody.top_p;
    }

    if (requestBody.stop) {
        body.stop_sequences = Array.isArray(requestBody.stop)
            ? requestBody.stop
            : [requestBody.stop];
    }

    const tools = translateTools(requestBody.tools);
    if (tools) {
        body.tools = tools;
    }

    return body;
}

/**
 * Translate a Cohere v2 chat response to OpenAI-compatible format.
 *
 * Cohere v2 response shape:
 * ```
 * {
 *   "id": "...",
 *   "message": {
 *     "role": "assistant",
 *     "content": [{ "type": "text", "text": "..." }],
 *     "tool_calls": [{ "id": "...", "type": "function", "function": { "name": "...", "arguments": "..." } }]
 *   },
 *   "finish_reason": "COMPLETE" | "MAX_TOKENS" | "TOOL_CALL",
 *   "usage": { "billed_units": { "input_tokens": N, "output_tokens": N }, "tokens": { "input_tokens": N, "output_tokens": N } }
 * }
 * ```
 *
 * @param {Object} cohereResponse - Cohere v2 API response
 * @returns {Object} OpenAI-compatible response
 */
function cohereResponseToOpenai(cohereResponse) {
    const msg = cohereResponse.message || {};

    // Extract text content — Cohere v2 uses content array
    let content = null;
    if (typeof msg.content === 'string') {
        content = msg.content;
    } else if (Array.isArray(msg.content)) {
        const textParts = msg.content
            .filter(block => block.type === 'text')
            .map(block => block.text);
        content = textParts.join('') || null;
    }

    // Map Cohere finish_reason to OpenAI format
    let finishReason = 'stop';
    switch (cohereResponse.finish_reason) {
        case 'COMPLETE': finishReason = 'stop'; break;
        case 'MAX_TOKENS': finishReason = 'length'; break;
        case 'TOOL_CALL': finishReason = 'tool_calls'; break;
        default: finishReason = cohereResponse.finish_reason?.toLowerCase() || 'stop';
    }

    const message = {
        role: 'assistant',
        content,
    };

    // Map tool calls — Cohere v2 uses `parameters` (object) instead of `arguments` (string)
    if (msg.tool_calls && msg.tool_calls.length > 0) {
        message.tool_calls = msg.tool_calls.map(tc => ({
            id: tc.id || `call_${Math.random().toString(36).slice(2, 11)}`,
            type: 'function',
            function: {
                name: tc.function?.name || tc.name,
                arguments: typeof tc.function?.arguments === 'string'
                    ? tc.function.arguments
                    : JSON.stringify(tc.function?.arguments || tc.parameters || {}),
            },
        }));
    }

    // Map usage
    const tokens = cohereResponse.usage?.tokens || cohereResponse.usage?.billed_units || {};
    const usage = {
        prompt_tokens: tokens.input_tokens || 0,
        completion_tokens: tokens.output_tokens || 0,
        total_tokens: (tokens.input_tokens || 0) + (tokens.output_tokens || 0),
    };

    return {
        choices: [{
            index: 0,
            message,
            finish_reason: finishReason,
        }],
        usage,
    };
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Call Cohere v2 Chat API via REST (non-streaming).
 *
 * @param {Object} ctx - Provider context { provider, endpoint, headers, model }
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal|null} signal - Abort signal for cancellation
 * @returns {Promise<Object>} OpenAI-compatible parsed JSON response
 */
export async function callCohereREST(ctx, requestBody, signal) {
    const body = buildCohereBody(requestBody, requestBody.model || ctx.model);
    body.stream = false;

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
            detail = parsed.message || parsed.error || errBody.substring(0, 500);
        } catch { /* use statusText fallback */ }
        throw new Error(`Cohere API Error: ${response.status} - ${detail}`);
    }

    const cohereResponse = await response.json();
    return cohereResponseToOpenai(cohereResponse);
}

/**
 * Call Cohere v2 Chat API via REST with SSE streaming.
 * Returns a synthetic Response whose body emits OpenAI-format SSE chunks.
 *
 * Cohere v2 streaming emits SSE events with types like:
 * - `message-start` — includes initial message metadata
 * - `content-start` — start of a content block
 * - `content-delta` — partial text content
 * - `content-end` — end of a content block
 * - `tool-call-start` — start of a tool call
 * - `tool-call-delta` — partial tool call arguments
 * - `tool-call-end` — end of a tool call
 * - `message-end` — final usage / finish_reason
 *
 * @param {Object} ctx - Provider context { provider, endpoint, headers, model }
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal|null} signal - Abort signal for cancellation
 * @returns {Promise<Response>} Synthetic Response with SSE body in OpenAI format
 */
export async function callCohereRESTStream(ctx, requestBody, signal) {
    const body = buildCohereBody(requestBody, requestBody.model || ctx.model);
    body.stream = true;

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
            detail = parsed.message || parsed.error || errBody.substring(0, 500);
        } catch { /* use statusText fallback */ }
        throw new Error(`Cohere API Error: ${response.status} - ${detail}`);
    }

    const cohereBody = response.body;
    const readable = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            const decoder = new TextDecoder();
            const reader = cohereBody.getReader();

            let toolCallIndex = 0;
            const activeToolCalls = new Map();
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
                        // Track SSE event type
                        if (line.startsWith('event: ')) {
                            currentEventType = line.slice(7).trim();
                            continue;
                        }

                        if (!line.startsWith('data: ')) continue;
                        const data = line.slice(6).trim();
                        if (!data) continue;

                        let event;
                        try {
                            event = JSON.parse(data);
                        } catch {
                            continue;
                        }

                        const eventType = currentEventType || event.type;
                        currentEventType = null; // Reset after use

                        // ── Text content deltas ─────────────────────
                        if (eventType === 'content-delta') {
                            const text = event.delta?.message?.content?.text;
                            if (text) {
                                const chunk = JSON.stringify({
                                    choices: [{
                                        index: 0,
                                        delta: { content: text },
                                        finish_reason: null,
                                    }],
                                });
                                controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
                            }

                        // ── Tool call start ──────────────────────────
                        } else if (eventType === 'tool-call-start') {
                            const tc = event.delta?.message?.tool_calls;
                            if (tc) {
                                const tcIdx = toolCallIndex++;
                                const toolCall = tc;
                                const id = toolCall.id || `call_${Math.random().toString(36).slice(2, 11)}`;
                                const name = toolCall.function?.name || toolCall.name || '';
                                activeToolCalls.set(tcIdx, { id, name });

                                const chunk = JSON.stringify({
                                    choices: [{
                                        index: 0,
                                        delta: {
                                            tool_calls: [{
                                                index: tcIdx,
                                                id,
                                                type: 'function',
                                                function: { name, arguments: '' },
                                            }],
                                        },
                                        finish_reason: null,
                                    }],
                                });
                                controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
                            }

                        // ── Tool call argument deltas ────────────────
                        } else if (eventType === 'tool-call-delta') {
                            const argsFragment = event.delta?.message?.tool_calls?.function?.arguments;
                            if (argsFragment != null) {
                                const tcIdx = toolCallIndex - 1;
                                const chunk = JSON.stringify({
                                    choices: [{
                                        index: 0,
                                        delta: {
                                            tool_calls: [{
                                                index: tcIdx,
                                                function: { arguments: argsFragment },
                                            }],
                                        },
                                        finish_reason: null,
                                    }],
                                });
                                controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
                            }

                        // ── Message end (finish reason + usage) ─────
                        } else if (eventType === 'message-end') {
                            let finishReason = 'stop';
                            const rawReason = event.delta?.finish_reason;
                            if (rawReason === 'COMPLETE') finishReason = 'stop';
                            else if (rawReason === 'MAX_TOKENS') finishReason = 'length';
                            else if (rawReason === 'TOOL_CALL') finishReason = 'tool_calls';

                            const chunk = JSON.stringify({
                                choices: [{
                                    index: 0,
                                    delta: {},
                                    finish_reason: finishReason,
                                }],
                            });
                            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
                            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                        }
                    }
                }
            } catch (err) {
                if (isCancellationError(err)) {
                    // Clean shutdown on abort
                } else {
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
