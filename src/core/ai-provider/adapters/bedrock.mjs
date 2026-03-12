import config from '../../../config.mjs';
import { AI_PROVIDERS } from '../constants.mjs';
import { withRetry, isCancellationError } from '../utils.mjs';

// ─── AWS SDK Lazy Loading ────────────────────────────────────────────────

/** @type {import('@aws-sdk/client-bedrock-runtime')|null} */
let _bedrockSdk = null;
let _sdkLoadAttempted = false;

/**
 * Attempt to load the AWS Bedrock Runtime SDK via dynamic import.
 * Returns null if the SDK is not installed.
 * @returns {Promise<import('@aws-sdk/client-bedrock-runtime')|null>}
 */
async function loadBedrockSdk() {
    if (_sdkLoadAttempted) return _bedrockSdk;
    _sdkLoadAttempted = true;
    try {
        _bedrockSdk = await import('@aws-sdk/client-bedrock-runtime');
    } catch {
        _bedrockSdk = null;
    }
    return _bedrockSdk;
}

// ─── AWS Signature V4 (Lightweight Fallback) ─────────────────────────────

/**
 * Compute HMAC-SHA256 using Node.js crypto.
 * @param {Buffer|string} key
 * @param {string} data
 * @returns {Promise<Buffer>}
 */
async function hmacSha256(key, data) {
    const { createHmac } = await import('node:crypto');
    return createHmac('sha256', key).update(data, 'utf8').digest();
}

/**
 * Compute SHA-256 hex digest.
 * @param {string} data
 * @returns {Promise<string>}
 */
async function sha256Hex(data) {
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Derive the AWS Signature V4 signing key.
 * @param {string} secretKey - AWS secret access key
 * @param {string} dateStamp - YYYYMMDD
 * @param {string} region
 * @param {string} service
 * @returns {Promise<Buffer>}
 */
async function getSigningKey(secretKey, dateStamp, region, service) {
    const kDate = await hmacSha256('AWS4' + secretKey, dateStamp);
    const kRegion = await hmacSha256(kDate, region);
    const kService = await hmacSha256(kRegion, service);
    return hmacSha256(kService, 'aws4_request');
}

/**
 * Sign a request using AWS Signature V4.
 * Returns headers including Authorization, x-amz-date, and x-amz-content-sha256.
 *
 * @param {Object} params
 * @param {string} params.method - HTTP method
 * @param {string} params.url - Full URL
 * @param {Object} params.headers - Existing headers (host will be derived)
 * @param {string} params.body - Request body string
 * @param {string} params.accessKeyId - AWS access key
 * @param {string} params.secretAccessKey - AWS secret key
 * @param {string} params.region - AWS region
 * @param {string} params.service - AWS service name (e.g. 'bedrock')
 * @param {string} [params.sessionToken] - Optional session token
 * @returns {Promise<Object>} Signed headers to merge into the request
 */
async function signRequestV4({ method, url, headers, body, accessKeyId, secretAccessKey, region, service, sessionToken }) {
    const parsedUrl = new URL(url);
    const host = parsedUrl.host;
    const path = parsedUrl.pathname + parsedUrl.search;

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
    const dateStamp = amzDate.slice(0, 8);

    const payloadHash = await sha256Hex(body || '');

    // Build canonical headers — must include host, x-amz-date, content-type
    const signedHeaderNames = ['content-type', 'host', 'x-amz-content-sha256', 'x-amz-date'];
    if (sessionToken) signedHeaderNames.push('x-amz-security-token');
    signedHeaderNames.sort();

    const canonicalHeaders = {};
    canonicalHeaders['host'] = host;
    canonicalHeaders['x-amz-date'] = amzDate;
    canonicalHeaders['x-amz-content-sha256'] = payloadHash;
    canonicalHeaders['content-type'] = headers['Content-Type'] || 'application/json';
    if (sessionToken) canonicalHeaders['x-amz-security-token'] = sessionToken;

    const canonicalHeaderStr = signedHeaderNames
        .map(k => `${k}:${canonicalHeaders[k]}\n`)
        .join('');
    const signedHeaders = signedHeaderNames.join(';');

    const canonicalRequest = [
        method,
        parsedUrl.pathname,
        parsedUrl.search ? parsedUrl.search.slice(1) : '',
        canonicalHeaderStr,
        signedHeaders,
        payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const canonicalRequestHash = await sha256Hex(canonicalRequest);

    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        canonicalRequestHash,
    ].join('\n');

    const signingKey = await getSigningKey(secretAccessKey, dateStamp, region, service);
    const signatureBuffer = await hmacSha256(signingKey, stringToSign);
    const signature = signatureBuffer.toString('hex');

    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const result = {
        'Authorization': authorization,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        'Content-Type': canonicalHeaders['content-type'],
    };

    if (sessionToken) {
        result['x-amz-security-token'] = sessionToken;
    }

    return result;
}

// ─── Bedrock Format Translation ──────────────────────────────────────────

/**
 * Convert OpenAI-format messages to Bedrock Converse format.
 * System messages are extracted separately; user/assistant messages
 * use `{ role, content: [{ text: "..." }] }` structure.
 *
 * @param {Array<Object>} messages - OpenAI-format messages
 * @returns {{ system: Array<Object>|undefined, messages: Array<Object> }}
 */
function convertMessagesToBedrock(messages) {
    const system = [];
    const bedrockMessages = [];

    for (const msg of messages) {
        if (msg.role === 'system') {
            system.push({ text: msg.content || '' });
        } else if (msg.role === 'tool') {
            // Convert tool results to Bedrock format
            bedrockMessages.push({
                role: 'user',
                content: [{
                    toolResult: {
                        toolUseId: msg.tool_call_id || 'unknown',
                        content: [{ text: msg.content || '' }],
                    },
                }],
            });
        } else {
            const content = [];

            // Handle text content
            if (typeof msg.content === 'string' && msg.content) {
                content.push({ text: msg.content });
            } else if (Array.isArray(msg.content)) {
                for (const part of msg.content) {
                    if (part.type === 'text') {
                        content.push({ text: part.text });
                    }
                }
            }

            // Handle tool calls in assistant messages
            if (msg.role === 'assistant' && msg.tool_calls) {
                for (const tc of msg.tool_calls) {
                    let input;
                    try {
                        input = typeof tc.function.arguments === 'string'
                            ? JSON.parse(tc.function.arguments)
                            : tc.function.arguments;
                    } catch {
                        input = {};
                    }
                    content.push({
                        toolUse: {
                            toolUseId: tc.id || `call_${Math.random().toString(36).slice(2, 11)}`,
                            name: tc.function.name,
                            input,
                        },
                    });
                }
            }

            // Only add message if it has content
            if (content.length > 0) {
                bedrockMessages.push({
                    role: msg.role === 'assistant' ? 'assistant' : 'user',
                    content,
                });
            }
        }
    }

    return {
        system: system.length > 0 ? system : undefined,
        messages: bedrockMessages,
    };
}

/**
 * Convert OpenAI tool definitions to Bedrock toolConfig format.
 *
 * @param {Array<Object>|undefined} tools - OpenAI-format tool definitions
 * @returns {Object|undefined} Bedrock toolConfig
 */
function convertToolsToBedrock(tools) {
    if (!tools || tools.length === 0) return undefined;

    return {
        tools: tools.map(tool => {
            const fn = tool.function || tool;
            return {
                toolSpec: {
                    name: fn.name,
                    description: fn.description || '',
                    inputSchema: {
                        json: fn.parameters || { type: 'object', properties: {} },
                    },
                },
            };
        }),
    };
}

/**
 * Build the Bedrock Converse request body from an OpenAI-compatible request.
 *
 * @param {Object} requestBody - OpenAI-format request body
 * @param {string} modelId - The Bedrock model ID
 * @returns {Object} Bedrock Converse API request body
 */
function buildBedrockBody(requestBody, modelId) {
    const { system, messages } = convertMessagesToBedrock(requestBody.messages || []);

    const body = {
        modelId,
        messages,
    };

    if (system) {
        body.system = system;
    }

    // Inference configuration
    const inferenceConfig = {};
    if (requestBody.max_tokens != null) inferenceConfig.maxTokens = requestBody.max_tokens;
    if (requestBody.temperature != null) inferenceConfig.temperature = requestBody.temperature;
    if (requestBody.top_p != null) inferenceConfig.topP = requestBody.top_p;
    if (requestBody.stop) {
        inferenceConfig.stopSequences = Array.isArray(requestBody.stop)
            ? requestBody.stop
            : [requestBody.stop];
    }
    if (Object.keys(inferenceConfig).length > 0) {
        body.inferenceConfig = inferenceConfig;
    }

    // Tool configuration
    const toolConfig = convertToolsToBedrock(requestBody.tools);
    if (toolConfig) {
        body.toolConfig = toolConfig;
    }

    return body;
}

/**
 * Translate a Bedrock Converse API response to OpenAI-compatible format.
 *
 * Bedrock Converse response shape:
 * ```json
 * {
 *   "output": {
 *     "message": {
 *       "role": "assistant",
 *       "content": [{ "text": "..." }, { "toolUse": { "toolUseId", "name", "input" } }]
 *     }
 *   },
 *   "stopReason": "end_turn" | "max_tokens" | "tool_use",
 *   "usage": { "inputTokens": N, "outputTokens": N }
 * }
 * ```
 *
 * @param {Object} bedrockResponse - Bedrock Converse API response
 * @returns {Object} OpenAI-compatible response
 */
function bedrockResponseToOpenai(bedrockResponse) {
    const outputMsg = bedrockResponse.output?.message || {};
    const contentBlocks = outputMsg.content || [];

    // Extract text content
    const textParts = contentBlocks
        .filter(b => b.text != null)
        .map(b => b.text);
    const content = textParts.length > 0 ? textParts.join('') : null;

    // Map stop reason
    let finishReason = 'stop';
    switch (bedrockResponse.stopReason) {
        case 'end_turn': finishReason = 'stop'; break;
        case 'max_tokens': finishReason = 'length'; break;
        case 'tool_use': finishReason = 'tool_calls'; break;
        default: finishReason = bedrockResponse.stopReason || 'stop';
    }

    const message = { role: 'assistant', content };

    // Map tool use blocks to OpenAI tool_calls
    const toolUseBlocks = contentBlocks.filter(b => b.toolUse);
    if (toolUseBlocks.length > 0) {
        message.tool_calls = toolUseBlocks.map(b => ({
            id: b.toolUse.toolUseId || `call_${Math.random().toString(36).slice(2, 11)}`,
            type: 'function',
            function: {
                name: b.toolUse.name,
                arguments: JSON.stringify(b.toolUse.input || {}),
            },
        }));
    }

    // Map usage
    const usage = {
        prompt_tokens: bedrockResponse.usage?.inputTokens || 0,
        completion_tokens: bedrockResponse.usage?.outputTokens || 0,
        total_tokens: (bedrockResponse.usage?.inputTokens || 0) + (bedrockResponse.usage?.outputTokens || 0),
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

// ─── SDK Path ────────────────────────────────────────────────────────────

/**
 * Call Bedrock via the AWS SDK (preferred path).
 * Uses ConverseCommand for non-streaming requests.
 *
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {string} modelId - Bedrock model ID
 * @param {AbortSignal|null} signal - Abort signal
 * @returns {Promise<Object>} OpenAI-compatible response
 */
async function callBedrockSdk(requestBody, modelId, signal) {
    const sdk = await loadBedrockSdk();
    if (!sdk) throw new Error('AWS Bedrock SDK not available');

    const region = config.keys.awsRegion || 'us-east-1';
    const client = new sdk.BedrockRuntimeClient({ region });

    const converseInput = buildBedrockBody(requestBody, modelId);
    const command = new sdk.ConverseCommand(converseInput);

    const response = await client.send(command, { abortSignal: signal });
    return bedrockResponseToOpenai(response);
}

/**
 * Call Bedrock via the AWS SDK with streaming.
 * Uses ConverseStreamCommand and translates to OpenAI SSE format.
 *
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {string} modelId - Bedrock model ID
 * @param {AbortSignal|null} signal - Abort signal
 * @returns {Promise<Response>} Synthetic Response with SSE body in OpenAI format
 */
async function callBedrockSdkStream(requestBody, modelId, signal) {
    const sdk = await loadBedrockSdk();
    if (!sdk) throw new Error('AWS Bedrock SDK not available');

    const region = config.keys.awsRegion || 'us-east-1';
    const client = new sdk.BedrockRuntimeClient({ region });

    const converseInput = buildBedrockBody(requestBody, modelId);
    const command = new sdk.ConverseStreamCommand(converseInput);

    const sdkResponse = await client.send(command, { abortSignal: signal });
    const stream = sdkResponse.stream;

    const readable = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            let toolCallIndex = 0;

            try {
                for await (const event of stream) {
                    if (signal?.aborted) break;

                    // Content block delta — text
                    if (event.contentBlockDelta?.delta?.text) {
                        const chunk = JSON.stringify({
                            choices: [{
                                index: 0,
                                delta: { content: event.contentBlockDelta.delta.text },
                                finish_reason: null,
                            }],
                        });
                        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
                    }

                    // Content block start — tool use
                    if (event.contentBlockStart?.start?.toolUse) {
                        const tu = event.contentBlockStart.start.toolUse;
                        const tcIdx = toolCallIndex++;
                        const chunk = JSON.stringify({
                            choices: [{
                                index: 0,
                                delta: {
                                    tool_calls: [{
                                        index: tcIdx,
                                        id: tu.toolUseId || `call_${Math.random().toString(36).slice(2, 11)}`,
                                        type: 'function',
                                        function: { name: tu.name, arguments: '' },
                                    }],
                                },
                                finish_reason: null,
                            }],
                        });
                        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
                    }

                    // Content block delta — tool use input
                    if (event.contentBlockDelta?.delta?.toolUse) {
                        const input = event.contentBlockDelta.delta.toolUse.input || '';
                        const tcIdx = toolCallIndex - 1;
                        const chunk = JSON.stringify({
                            choices: [{
                                index: 0,
                                delta: {
                                    tool_calls: [{
                                        index: tcIdx,
                                        function: { arguments: input },
                                    }],
                                },
                                finish_reason: null,
                            }],
                        });
                        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
                    }

                    // Message stop
                    if (event.messageStop) {
                        let finishReason = 'stop';
                        if (event.messageStop.stopReason === 'tool_use') finishReason = 'tool_calls';
                        else if (event.messageStop.stopReason === 'max_tokens') finishReason = 'length';

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

// ─── Fetch Fallback Path ─────────────────────────────────────────────────

/**
 * Call Bedrock Converse API via raw fetch with AWS Signature V4 signing.
 * Used when the AWS SDK is not installed.
 *
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {string} modelId - Bedrock model ID
 * @param {AbortSignal|null} signal - Abort signal
 * @returns {Promise<Object>} OpenAI-compatible response
 */
async function callBedrockFetchRest(requestBody, modelId, signal) {
    const region = config.keys.awsRegion || 'us-east-1';
    const accessKeyId = config.keys.awsAccessKeyId;
    const secretAccessKey = config.keys.awsSecretAccessKey;

    if (!accessKeyId || !secretAccessKey) {
        throw new Error('AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or install @aws-sdk/client-bedrock-runtime.');
    }

    const converseBody = buildBedrockBody(requestBody, modelId);
    // For the HTTP API, modelId is in the URL path, not the body
    const { modelId: _removed, ...bodyWithoutModelId } = converseBody;
    const bodyStr = JSON.stringify(bodyWithoutModelId);

    const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`;

    const signedHeaders = await signRequestV4({
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
        accessKeyId,
        secretAccessKey,
        region,
        service: 'bedrock',
    });

    const PER_CALL_TIMEOUT = 180_000;
    const timeoutSignal = AbortSignal.timeout(PER_CALL_TIMEOUT);
    const combinedSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;

    const response = await withRetry(() => fetch(url, {
        method: 'POST',
        headers: signedHeaders,
        body: bodyStr,
        signal: combinedSignal,
    }), 3, 2000);

    if (!response.ok) {
        let detail = response.statusText;
        try {
            const errBody = await response.text();
            const parsed = JSON.parse(errBody);
            detail = parsed.message || parsed.Message || errBody.substring(0, 500);
        } catch { /* use statusText fallback */ }
        throw new Error(`AWS Bedrock API Error: ${response.status} - ${detail}`);
    }

    const bedrockResponse = await response.json();
    return bedrockResponseToOpenai(bedrockResponse);
}

/**
 * Call Bedrock Converse API via raw fetch with streaming (AWS Sig V4 fallback).
 * Uses the `/converse-stream` endpoint and translates Bedrock event-stream
 * to OpenAI SSE format.
 *
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {string} modelId - Bedrock model ID
 * @param {AbortSignal|null} signal - Abort signal
 * @returns {Promise<Response>} Synthetic Response with SSE body in OpenAI format
 */
async function callBedrockFetchStream(requestBody, modelId, signal) {
    const region = config.keys.awsRegion || 'us-east-1';
    const accessKeyId = config.keys.awsAccessKeyId;
    const secretAccessKey = config.keys.awsSecretAccessKey;

    if (!accessKeyId || !secretAccessKey) {
        throw new Error('AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or install @aws-sdk/client-bedrock-runtime.');
    }

    const converseBody = buildBedrockBody(requestBody, modelId);
    const { modelId: _removed, ...bodyWithoutModelId } = converseBody;
    const bodyStr = JSON.stringify(bodyWithoutModelId);

    const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse-stream`;

    const signedHeaders = await signRequestV4({
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
        accessKeyId,
        secretAccessKey,
        region,
        service: 'bedrock',
    });

    const PER_CALL_TIMEOUT = 180_000;
    const timeoutSignal = AbortSignal.timeout(PER_CALL_TIMEOUT);
    const combinedSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;

    const response = await withRetry(() => fetch(url, {
        method: 'POST',
        headers: signedHeaders,
        body: bodyStr,
        signal: combinedSignal,
    }), 3, 2000);

    if (!response.ok) {
        let detail = response.statusText;
        try {
            const errBody = await response.text();
            const parsed = JSON.parse(errBody);
            detail = parsed.message || parsed.Message || errBody.substring(0, 500);
        } catch { /* use statusText fallback */ }
        throw new Error(`AWS Bedrock API Error: ${response.status} - ${detail}`);
    }

    // Bedrock uses AWS event-stream binary framing.
    // For the fetch fallback, parse the event stream and re-emit as SSE.
    const bedrockBody = response.body;
    const readable = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            const decoder = new TextDecoder();
            const reader = bedrockBody.getReader();

            let toolCallIndex = 0;
            let buffer = '';

            try {
                while (true) {
                    if (signal?.aborted) break;

                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });

                    // Bedrock Converse stream returns newline-delimited JSON events
                    // when accessed via the HTTP API with Accept: application/json
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed) continue;

                        let event;
                        try {
                            event = JSON.parse(trimmed);
                        } catch {
                            continue;
                        }

                        // Text delta
                        if (event.contentBlockDelta?.delta?.text) {
                            const chunk = JSON.stringify({
                                choices: [{
                                    index: 0,
                                    delta: { content: event.contentBlockDelta.delta.text },
                                    finish_reason: null,
                                }],
                            });
                            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
                        }

                        // Tool use start
                        if (event.contentBlockStart?.start?.toolUse) {
                            const tu = event.contentBlockStart.start.toolUse;
                            const tcIdx = toolCallIndex++;
                            const chunk = JSON.stringify({
                                choices: [{
                                    index: 0,
                                    delta: {
                                        tool_calls: [{
                                            index: tcIdx,
                                            id: tu.toolUseId || `call_${Math.random().toString(36).slice(2, 11)}`,
                                            type: 'function',
                                            function: { name: tu.name, arguments: '' },
                                        }],
                                    },
                                    finish_reason: null,
                                }],
                            });
                            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
                        }

                        // Tool use input delta
                        if (event.contentBlockDelta?.delta?.toolUse) {
                            const input = event.contentBlockDelta.delta.toolUse.input || '';
                            const tcIdx = toolCallIndex - 1;
                            const chunk = JSON.stringify({
                                choices: [{
                                    index: 0,
                                    delta: {
                                        tool_calls: [{
                                            index: tcIdx,
                                            function: { arguments: input },
                                        }],
                                    },
                                    finish_reason: null,
                                }],
                            });
                            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
                        }

                        // Message stop
                        if (event.messageStop) {
                            let finishReason = 'stop';
                            if (event.messageStop.stopReason === 'tool_use') finishReason = 'tool_calls';
                            else if (event.messageStop.stopReason === 'max_tokens') finishReason = 'length';

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

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Call AWS Bedrock Converse API (non-streaming).
 *
 * Attempts the AWS SDK path first (`@aws-sdk/client-bedrock-runtime`).
 * If the SDK is not installed, falls back to raw fetch with manual
 * AWS Signature V4 signing using credentials from environment variables.
 *
 * @param {Object} ctx - Provider context { provider, endpoint, headers, model }
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal|null} signal - Abort signal for cancellation
 * @returns {Promise<Object>} OpenAI-compatible parsed JSON response
 */
export async function callBedrockREST(ctx, requestBody, signal) {
    const modelId = requestBody.model || ctx.model;

    const sdk = await loadBedrockSdk();
    if (sdk) {
        return withRetry(() => callBedrockSdk(requestBody, modelId, signal), 3, 2000);
    }

    // Fallback to raw fetch with Sig V4
    return callBedrockFetchRest(requestBody, modelId, signal);
}

/**
 * Call AWS Bedrock Converse API with streaming.
 *
 * Attempts the AWS SDK path first (`@aws-sdk/client-bedrock-runtime`).
 * If the SDK is not installed, falls back to raw fetch with manual
 * AWS Signature V4 signing.
 *
 * Returns a synthetic Response whose body emits OpenAI-format SSE chunks.
 *
 * @param {Object} ctx - Provider context { provider, endpoint, headers, model }
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal|null} signal - Abort signal for cancellation
 * @returns {Promise<Response>} Synthetic Response with SSE body in OpenAI format
 */
export async function callBedrockRESTStream(ctx, requestBody, signal) {
    const modelId = requestBody.model || ctx.model;

    const sdk = await loadBedrockSdk();
    if (sdk) {
        return callBedrockSdkStream(requestBody, modelId, signal);
    }

    // Fallback to raw fetch with Sig V4
    return callBedrockFetchStream(requestBody, modelId, signal);
}
