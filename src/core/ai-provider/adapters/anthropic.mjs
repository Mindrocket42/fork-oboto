// TODO: Consider consolidating with anthropic-direct.mjs — both files share
// nearly identical sanitizeInputSchema, translateMessages, buildAnthropicBody,
// mapFinishReason, and anthropicResponseToOpenai implementations. The key
// difference is that this file uses the Vertex SDK while anthropic-direct.mjs
// uses raw REST fetch. A shared utility module could eliminate the duplication.
import AnthropicVertex from '@anthropic-ai/vertex-sdk';
import { config } from '../../../config.mjs';

const DEFAULT_MAX_TOKENS = 4096;

// ─── Vertex SDK Client Singleton ─────────────────────────────────────────

let _client = null;

/**
 * Get (or lazily create) the AnthropicVertex SDK client singleton.
 * Uses Google ADC for authentication — no API key required.
 *
 * @returns {AnthropicVertex} The configured client instance
 */
function getClient() {
    if (!_client) {
        const projectId = config.vertex?.projectId
            || process.env.VERTEX_PROJECT_ID
            || process.env.GOOGLE_CLOUD_PROJECT;
        const region = config.vertex?.region
            || process.env.VERTEX_REGION
            || 'us-east5';

        if (!projectId) {
            throw new Error(
                'VERTEX_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) must be set for Anthropic/Vertex AI'
            );
        }

        _client = new AnthropicVertex({ projectId, region });
    }
    return _client;
}

/**
 * Reset the cached Anthropic client singleton.
 * Call this when credentials or project configuration change at runtime
 * so the next API call creates a fresh client with updated settings.
 */
export function resetAnthropicClient() {
    _client = null;
}

// ─── Schema Sanitisation ─────────────────────────────────────────────────
// Anthropic requires tool input_schema to conform to JSON Schema draft
// 2020-12.  OpenAI is more permissive, so tool definitions authored for
// the OpenAI function-calling format may contain keywords that Anthropic
// rejects (e.g. `default`, `examples`).  This helper recursively strips
// unsupported keywords and fixes structural issues.

/** Keywords that Anthropic rejects inside tool input_schema. */
const BLOCKED_KEYWORDS = new Set([
    'default',
    'examples',
    '$comment',
    '$id',
    '$anchor',
    '$schema',
    'title',
    // OpenAI-specific extensions
    'strict',
]);

/**
 * Recursively sanitise a JSON Schema object so it conforms to Anthropic's
 * JSON Schema draft 2020-12 requirements for tool `input_schema`.
 *
 * Mutations are performed in-place on a **deep clone** — the original
 * schema object is never modified.
 *
 * @param {any} schema - A JSON Schema (or sub-schema) value
 * @returns {any} The sanitised schema (a new object)
 */
function sanitizeInputSchema(schema) {
    if (schema == null || typeof schema !== 'object') return schema;

    // Deep-clone so we never mutate caller's data
    const clone = Array.isArray(schema) ? [...schema] : { ...schema };

    if (Array.isArray(clone)) {
        return clone.map(item => sanitizeInputSchema(item));
    }

    // Remove blocked keywords at this level
    for (const key of BLOCKED_KEYWORDS) {
        delete clone[key];
    }

    // "type": "any" is not valid JSON Schema — remove it to mean "accept any type"
    if (clone.type === 'any') {
        delete clone.type;
    }

    // Ensure root-level objects have type: 'object' when they contain properties
    if (clone.properties && !clone.type) {
        clone.type = 'object';
    }

    // additionalProperties must be boolean, not an object schema
    if (clone.additionalProperties != null && typeof clone.additionalProperties === 'object') {
        clone.additionalProperties = false;
    }

    // Recurse into sub-schemas
    if (clone.properties && typeof clone.properties === 'object') {
        const cleaned = {};
        for (const [propName, propSchema] of Object.entries(clone.properties)) {
            cleaned[propName] = sanitizeInputSchema(propSchema);
        }
        clone.properties = cleaned;

        // Ensure 'required' only references properties that actually exist
        if (Array.isArray(clone.required)) {
            const propNames = new Set(Object.keys(cleaned));
            clone.required = clone.required.filter(r => propNames.has(r));
            if (clone.required.length === 0) delete clone.required;
        }
    }

    if (clone.items) {
        clone.items = sanitizeInputSchema(clone.items);
    }

    // Composite keywords
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
            // Build content blocks array for assistant messages
            const contentBlocks = [];

            // Text content
            if (msg.content) {
                contentBlocks.push({ type: 'text', text: msg.content });
            }

            // Tool calls → Anthropic tool_use content blocks
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

        // Tool results → Anthropic 'user' role with tool_result content blocks
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
    // Merge consecutive same-role messages, handling both string and array content.
    const merged = [];
    for (const entry of messages) {
        if (merged.length > 0 && merged[merged.length - 1].role === entry.role) {
            const prev = merged[merged.length - 1];
            // Merge content: normalize both to arrays, then concatenate
            const prevBlocks = _toContentArray(prev.content);
            const entryBlocks = _toContentArray(entry.content);
            prev.content = [...prevBlocks, ...entryBlocks];
        } else {
            merged.push({ ...entry });
        }
    }

    // Anthropic requires conversation to start with 'user'.
    // If it starts with 'assistant', prepend a synthetic user turn.
    if (merged.length > 0 && merged[0].role === 'assistant') {
        merged.unshift({ role: 'user', content: '(continue)' });
    }

    const system = systemParts.length > 0
        ? systemParts.join('\n\n---\n\n')
        : undefined;

    return { system, messages: merged };
}

/**
 * Build the Anthropic SDK params from an OpenAI-compatible request body.
 *
 * @param {Object} requestBody - OpenAI-format request body
 * @param {string} model - The model to use
 * @returns {Object} Anthropic Messages API params for SDK
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

    // Translate OpenAI tools format to Anthropic tools format.
    // Each input_schema is sanitised to conform to JSON Schema draft 2020-12.
    if (requestBody.tools && requestBody.tools.length > 0) {
        params.tools = requestBody.tools.map((tool, idx) => {
            const rawSchema = tool.function?.parameters || tool.parameters || { type: 'object', properties: {} };
            const name = tool.function?.name || tool.name;
            const sanitized = sanitizeInputSchema(rawSchema);
            // Anthropic requires top-level input_schema to have type: 'object'
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

    // Extract text from content blocks
    const textParts = contentBlocks
        .filter(block => block.type === 'text')
        .map(block => block.text);

    const content = textParts.join('') || null;
    const finishReason = mapFinishReason(anthropicResponse.stop_reason);

    // Build the assistant message
    const message = {
        role: 'assistant',
        content,
    };

    // Extract tool_use blocks → OpenAI tool_calls format
    const toolUseBlocks = contentBlocks.filter(block => block.type === 'tool_use');
    if (toolUseBlocks.length > 0) {
        message.tool_calls = toolUseBlocks.map((block, idx) => ({
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
 * Call Anthropic Messages API via Vertex SDK (non-streaming).
 * Matches the interface of callOpenAIREST(ctx, requestBody, signal).
 *
 * @param {Object} ctx - Provider context { provider, endpoint, headers, model, apiKey? }
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal|null} signal - Abort signal for cancellation
 * @returns {Promise<Object>} OpenAI-compatible parsed JSON response
 */
export async function callAnthropicREST(ctx, requestBody, signal) {
    let params;
    try {
        const client = getClient();
        params = buildAnthropicBody(requestBody, requestBody.model || ctx.model);

        const response = await client.messages.create(params, {
            ...(signal && { signal }),
        });

        return anthropicResponseToOpenai(response);
    } catch (err) {
        // Enrich SDK errors with a clear prefix
        if (err.status || err.error) {
            const detail = err.error?.message || err.message || String(err);
            const errMsg = `Anthropic/Vertex API Error (${err.status || 'unknown'}): ${detail}`;
            // For schema validation errors, log the offending tool schemas to aid debugging
            if (detail.includes('input_schema') && params?.tools) {
                const toolNames = params.tools.map((t, i) => `  [${i}] ${t.name}`).join('\n');
                console.error(`[Anthropic] Schema validation failed. Tools sent:\n${toolNames}`);
            }
            throw new Error(errMsg);
        }
        throw err;
    }
}

/**
 * Call Anthropic Messages API via Vertex SDK with streaming.
 * Returns a synthetic Response object whose body emits OpenAI-format SSE
 * data, matching the contract of callOpenAIRESTStream.
 *
 * @param {Object} ctx - Provider context
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal|null} signal - Abort signal for cancellation
 * @returns {Promise<Response>} Synthetic Response with SSE body in OpenAI format
 */
export async function callAnthropicRESTStream(ctx, requestBody, signal) {
    const client = getClient();
    const params = buildAnthropicBody(requestBody, requestBody.model || ctx.model);

    const sdkStream = client.messages.stream(params, {
        ...(signal && { signal }),
    });

    // Wrap the SDK stream as a ReadableStream emitting OpenAI-format SSE chunks.
    // Tracks in-progress tool_use blocks to assemble their input JSON.
    const readable = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            // Track active tool_use blocks by content_block index
            const activeToolBlocks = new Map();
            let toolCallIndex = 0;

            try {
                for await (const event of sdkStream) {
                    if (signal?.aborted) break;

                    // ── Text deltas ─────────────────────────────────
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

                    // ── Tool use: block start ───────────────────────
                    } else if (event.type === 'content_block_start' &&
                               event.content_block?.type === 'tool_use') {
                        const block = event.content_block;
                        const tcIdx = toolCallIndex++;
                        activeToolBlocks.set(event.index, { id: block.id, name: block.name, inputParts: [], tcIdx });

                        // Emit the initial tool_call chunk (name + id, no arguments yet)
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

                    // ── Tool use: input JSON deltas ─────────────────
                    } else if (event.type === 'content_block_delta' &&
                               event.delta?.type === 'input_json_delta' &&
                               event.delta?.partial_json != null) {
                        const tracked = activeToolBlocks.get(event.index);
                        if (tracked) {
                            tracked.inputParts.push(event.delta.partial_json);
                            // Stream argument fragments to match OpenAI streaming format
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

                    // ── Block stop (clean up tracking) ──────────────
                    } else if (event.type === 'content_block_stop') {
                        activeToolBlocks.delete(event.index);

                    // ── Message delta (stop reason) ─────────────────
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

                    // ── Message stop ────────────────────────────────
                    } else if (event.type === 'message_stop') {
                        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    }
                }
            } catch (err) {
                if (err.name === 'AbortError') {
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

    // Return a synthetic Response matching the OpenAI SSE contract
    return new Response(readable, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
    });
}
