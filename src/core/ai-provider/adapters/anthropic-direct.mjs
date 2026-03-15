// TODO: Consider consolidating with anthropic.mjs — both files share nearly
// identical sanitizeInputSchema, translateMessages, buildAnthropicBody,
// mapFinishReason, and anthropicResponseToOpenai implementations. This file
// uses raw REST fetch while anthropic.mjs uses the Vertex SDK. A shared
// utility module could eliminate the duplication.
import { AI_PROVIDERS } from '../constants.mjs';
import { withRetry, isCancellationError } from '../utils.mjs';

const DEFAULT_MAX_TOKENS = 4096;

// ─── Schema Sanitisation ─────────────────────────────────────────────────
// Anthropic requires tool input_schema to conform to JSON Schema draft
// 2020-12.  OpenAI is more permissive, so tool definitions authored for
// the OpenAI function-calling format may contain keywords that Anthropic
// rejects (e.g. `default`, `examples`).

/** Keywords that Anthropic rejects inside tool input_schema. */
const BLOCKED_KEYWORDS = new Set([
    'default',
    'examples',
    '$comment',
    '$id',
    '$anchor',
    '$schema',
    'title',
    'strict',
]);

/**
 * Recursively sanitise a JSON Schema object so it conforms to Anthropic's
 * JSON Schema draft 2020-12 requirements for tool `input_schema`.
 *
 * @param {any} schema - A JSON Schema (or sub-schema) value
 * @returns {any} The sanitised schema (a new object)
 */
function sanitizeInputSchema(schema) {
    if (schema == null || typeof schema !== 'object') return schema;

    const clone = Array.isArray(schema) ? [...schema] : { ...schema };

    if (Array.isArray(clone)) {
        return clone.map(item => sanitizeInputSchema(item));
    }

    for (const key of BLOCKED_KEYWORDS) {
        delete clone[key];
    }

    if (clone.type === 'any') {
        delete clone.type;
    }

    if (clone.properties && !clone.type) {
        clone.type = 'object';
    }

    if (clone.additionalProperties != null && typeof clone.additionalProperties === 'object') {
        clone.additionalProperties = false;
    }

    if (clone.properties && typeof clone.properties === 'object') {
        const cleaned = {};
        for (const [propName, propSchema] of Object.entries(clone.properties)) {
            cleaned[propName] = sanitizeInputSchema(propSchema);
        }
        clone.properties = cleaned;

        if (Array.isArray(clone.required)) {
            const propNames = new Set(Object.keys(cleaned));
            clone.required = clone.required.filter(r => propNames.has(r));
            if (clone.required.length === 0) delete clone.required;
        }
    }

    if (clone.items) {
        clone.items = sanitizeInputSchema(clone.items);
    }

    for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
        if (Array.isArray(clone[keyword])) {
            clone[keyword] = clone[keyword].map(s => sanitizeInputSchema(s));
        }
    }

    if (clone.not) {
        clone.not = sanitizeInputSchema(clone.not);
    }

    return clone;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Normalize message content to an array of content blocks.
 * Used when merging consecutive same-role messages.
 *
 * @param {string|Array|undefined} content
 * @returns {Array<{type: string, [key: string]: any}>}
 */
function _toContentArray(content) {
    if (Array.isArray(content)) return content;
    if (typeof content === 'string' && content) return [{ type: 'text', text: content }];
    return [];
}

// ─── OpenAI → Anthropic Format Translation ──────────────────────────────

/**
 * Convert OpenAI-format messages to Anthropic Messages API format.
 * Extracts system messages into a separate `system` parameter and
 * maps remaining messages to Anthropic's `messages` array.
 *
 * @param {Array} openaiMessages - OpenAI-format messages array
 * @returns {{ system: string|undefined, messages: Array }}
 */
function translateMessages(openaiMessages) {
    const systemParts = [];
    const messages = [];

    for (const msg of openaiMessages) {
        if (msg.role === 'system') {
            if (msg.content) {
                systemParts.push(msg.content);
            }
            continue;
        }

        if (msg.role === 'user') {
            messages.push({
                role: 'user',
                content: msg.content,
            });
            continue;
        }

        if (msg.role === 'assistant') {
            const contentBlocks = [];

            if (msg.content) {
                contentBlocks.push({ type: 'text', text: msg.content });
            }

            if (msg.tool_calls && msg.tool_calls.length > 0) {
                for (const tc of msg.tool_calls) {
                    let parsedInput = {};
                    if (typeof tc.function?.arguments === 'string') {
                        try { parsedInput = JSON.parse(tc.function.arguments); }
                        catch { parsedInput = { _raw: tc.function.arguments }; }
                    } else if (tc.function?.arguments) {
                        parsedInput = tc.function.arguments;
                    }
                    contentBlocks.push({
                        type: 'tool_use',
                        id: tc.id,
                        name: tc.function?.name || 'unknown',
                        input: parsedInput,
                    });
                }
            }

            messages.push({
                role: 'assistant',
                content: contentBlocks.length > 0 ? contentBlocks : [{ type: 'text', text: '' }],
            });
            continue;
        }

        if (msg.role === 'tool') {
            const resultContent = typeof msg.content === 'string'
                ? msg.content
                : JSON.stringify(msg.content ?? '');
            messages.push({
                role: 'user',
                content: [{
                    type: 'tool_result',
                    tool_use_id: msg.tool_call_id || msg.name || 'unknown',
                    content: resultContent,
                }],
            });
            continue;
        }
    }

    // Anthropic requires alternating user/assistant turns.
    const merged = [];
    for (const entry of messages) {
        if (merged.length > 0 && merged[merged.length - 1].role === entry.role) {
            const prev = merged[merged.length - 1];
            const prevBlocks = _toContentArray(prev.content);
            const entryBlocks = _toContentArray(entry.content);
            prev.content = [...prevBlocks, ...entryBlocks];
        } else {
            merged.push({ ...entry });
        }
    }

    // Anthropic requires conversation to start with 'user'.
    if (merged.length > 0 && merged[0].role === 'assistant') {
        merged.unshift({ role: 'user', content: '(continue)' });
    }

    const system = systemParts.length > 0
        ? systemParts.join('\n\n---\n\n')
        : undefined;

    return { system, messages: merged };
}

/**
 * Build the Anthropic request body from an OpenAI-compatible request body.
 *
 * @param {Object} requestBody - OpenAI-format request body
 * @param {string} model - The model to use
 * @returns {Object} Anthropic Messages API request body
 */
function buildAnthropicBody(requestBody, model) {
    const { system, messages } = translateMessages(requestBody.messages || []);

    const params = {
        model,
        messages,
        max_tokens: requestBody.max_tokens || DEFAULT_MAX_TOKENS,
    };

    if (system) {
        params.system = system;
    }

    if (requestBody.temperature != null) {
        params.temperature = requestBody.temperature;
    }

    if (requestBody.top_p != null) {
        params.top_p = requestBody.top_p;
    }

    if (requestBody.stop) {
        params.stop_sequences = Array.isArray(requestBody.stop)
            ? requestBody.stop
            : [requestBody.stop];
    }

    // Translate OpenAI tools format → Anthropic tools format
    if (requestBody.tools && requestBody.tools.length > 0) {
        params.tools = requestBody.tools.map(tool => {
            const rawSchema = tool.function?.parameters || tool.parameters || { type: 'object', properties: {} };
            const name = tool.function?.name || tool.name;
            const sanitized = sanitizeInputSchema(rawSchema);
            if (!sanitized.type) {
                sanitized.type = 'object';
            }
            return {
                name,
                description: tool.function?.description || tool.description || '',
                input_schema: sanitized,
            };
        });
    }

    return params;
}

/**
 * Map Anthropic stop_reason to OpenAI finish_reason.
 * @param {string} stopReason - Anthropic stop reason
 * @returns {string} OpenAI-compatible finish reason
 */
function mapFinishReason(stopReason) {
    switch (stopReason) {
        case 'end_turn': return 'stop';
        case 'max_tokens': return 'length';
        case 'stop_sequence': return 'stop';
        case 'tool_use': return 'tool_calls';
        default: return stopReason || 'stop';
    }
}

/**
 * Translate an Anthropic Messages API response to OpenAI-compatible format.
 *
 * @param {Object} anthropicResponse - Anthropic API response
 * @returns {Object} OpenAI-compatible response
 */
function anthropicResponseToOpenai(anthropicResponse) {
    const contentBlocks = anthropicResponse.content || [];

    const textParts = contentBlocks
        .filter(block => block.type === 'text')
        .map(block => block.text);

    const content = textParts.join('') || null;
    const finishReason = mapFinishReason(anthropicResponse.stop_reason);

    const message = {
        role: 'assistant',
        content,
    };

    const toolUseBlocks = contentBlocks.filter(block => block.type === 'tool_use');
    if (toolUseBlocks.length > 0) {
        message.tool_calls = toolUseBlocks.map(block => ({
            id: block.id,
            type: 'function',
            function: {
                name: block.name,
                arguments: JSON.stringify(block.input || {}),
            },
        }));
    }

    return {
        choices: [{
            index: 0,
            message,
            finish_reason: finishReason,
        }],
        usage: anthropicResponse.usage ? {
            prompt_tokens: anthropicResponse.usage.input_tokens || 0,
            completion_tokens: anthropicResponse.usage.output_tokens || 0,
            total_tokens: (anthropicResponse.usage.input_tokens || 0) +
                          (anthropicResponse.usage.output_tokens || 0),
        } : undefined,
    };
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Call Anthropic Messages API directly via REST (non-streaming).
 * Uses fetch() against api.anthropic.com instead of the Vertex SDK.
 *
 * @param {Object} ctx - Provider context { provider, endpoint, headers, model }
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal|null} signal - Abort signal for cancellation
 * @returns {Promise<Object>} OpenAI-compatible parsed JSON response
 */
export async function callAnthropicDirectREST(ctx, requestBody, signal) {
    const body = buildAnthropicBody(requestBody, requestBody.model || ctx.model);
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
            detail = parsed.error?.message || errBody.substring(0, 500);
        } catch { /* use statusText fallback */ }
        throw new Error(`Anthropic Direct API Error: ${response.status} - ${detail}`);
    }

    const anthropicResponse = await response.json();
    return anthropicResponseToOpenai(anthropicResponse);
}

/**
 * Call Anthropic Messages API directly via REST with SSE streaming.
 * Returns a synthetic Response whose body emits OpenAI-format SSE chunks.
 *
 * @param {Object} ctx - Provider context { provider, endpoint, headers, model }
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal|null} signal - Abort signal for cancellation
 * @returns {Promise<Response>} Synthetic Response with SSE body in OpenAI format
 */
export async function callAnthropicDirectRESTStream(ctx, requestBody, signal) {
    const body = buildAnthropicBody(requestBody, requestBody.model || ctx.model);
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
            detail = parsed.error?.message || errBody.substring(0, 500);
        } catch { /* use statusText fallback */ }
        throw new Error(`Anthropic Direct API Error: ${response.status} - ${detail}`);
    }

    // Transform the Anthropic SSE stream into OpenAI-compatible SSE.
    const anthropicBody = response.body;
    const readable = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            const decoder = new TextDecoder();
            const reader = anthropicBody.getReader();

            // Track active tool_use blocks by content_block index
            const activeToolBlocks = new Map();
            let toolCallIndex = 0;
            let buffer = '';

            try {
                while (true) {
                    if (signal?.aborted) break;

                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });

                    // Parse SSE lines from buffer
                    const lines = buffer.split('\n');
                    // Keep incomplete last line in buffer
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.startsWith('data: ')) continue;
                        const data = line.slice(6).trim();
                        if (!data || data === '[DONE]') continue;

                        let event;
                        try {
                            event = JSON.parse(data);
                        } catch {
                            continue;
                        }

                        // ── Text deltas ─────────────────────────────
                        if (event.type === 'content_block_delta' &&
                            event.delta?.type === 'text_delta' &&
                            event.delta?.text) {
                            const chunk = JSON.stringify({
                                choices: [{
                                    index: 0,
                                    delta: { content: event.delta.text },
                                    finish_reason: null,
                                }],
                            });
                            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));

                        // ── Tool use: block start ───────────────────
                        } else if (event.type === 'content_block_start' &&
                                   event.content_block?.type === 'tool_use') {
                            const block = event.content_block;
                            const tcIdx = toolCallIndex++;
                            activeToolBlocks.set(event.index, {
                                id: block.id,
                                name: block.name,
                                tcIdx,
                            });

                            const chunk = JSON.stringify({
                                choices: [{
                                    index: 0,
                                    delta: {
                                        tool_calls: [{
                                            index: tcIdx,
                                            id: block.id,
                                            type: 'function',
                                            function: { name: block.name, arguments: '' },
                                        }],
                                    },
                                    finish_reason: null,
                                }],
                            });
                            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));

                        // ── Tool use: input JSON deltas ─────────────
                        } else if (event.type === 'content_block_delta' &&
                                   event.delta?.type === 'input_json_delta' &&
                                   event.delta?.partial_json != null) {
                            const tracked = activeToolBlocks.get(event.index);
                            if (tracked) {
                                const chunk = JSON.stringify({
                                    choices: [{
                                        index: 0,
                                        delta: {
                                            tool_calls: [{
                                                index: tracked.tcIdx,
                                                function: { arguments: event.delta.partial_json },
                                            }],
                                        },
                                        finish_reason: null,
                                    }],
                                });
                                controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
                            }

                        // ── Block stop ───────────────────────────────
                        } else if (event.type === 'content_block_stop') {
                            activeToolBlocks.delete(event.index);

                        // ── Message delta (stop reason) ─────────────
                        } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
                            const finishReason = mapFinishReason(event.delta.stop_reason);
                            const chunk = JSON.stringify({
                                choices: [{
                                    index: 0,
                                    delta: {},
                                    finish_reason: finishReason,
                                }],
                            });
                            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));

                        // ── Message stop ─────────────────────────────
                        } else if (event.type === 'message_stop') {
                            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                        }
                    }
                }
            } catch (err) {
                if (isCancellationError(err)) {
                    // Clean shutdown on abort — not an error
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
