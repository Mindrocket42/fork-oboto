import { CircuitBreaker } from '@sschepis/lmscript';
import { callProvider } from '../../ai-provider/index.mjs';

/**
 * Adapter implementing lmscript's LLMProvider interface, bridging to
 * ai-man's unified callProvider() dispatch.
 *
 * @implements {import('@sschepis/lmscript').LLMProvider}
 */
export class AiManLLMProvider {
    /**
     * @param {object} [opts]
     * @param {string} [opts.model]                 – default model identifier
     * @param {object} [opts.providerSettings]      – forwarded to callProvider options
     * @param {object} [opts.circuitBreakerConfig]   – optional circuit-breaker settings
     * @param {number} [opts.circuitBreakerConfig.maxFailures]    – maps to failureThreshold
     * @param {number} [opts.circuitBreakerConfig.resetTimeoutMs] – maps to resetTimeout
     * @param {number} [opts.circuitBreakerConfig.halfOpenMax]    – maps to successThreshold
     */
    constructor({ model, providerSettings, circuitBreakerConfig } = {}) {
        /** @readonly */
        this.name = 'ai-man';

        /** @private */
        this._model = model ?? undefined;

        /** @private */
        this._providerSettings = providerSettings ?? undefined;

        /** @private */
        this._breaker = null;

        if (circuitBreakerConfig) {
            this._breaker = new CircuitBreaker({
                failureThreshold: circuitBreakerConfig.maxFailures,
                resetTimeout: circuitBreakerConfig.resetTimeoutMs,
                successThreshold: circuitBreakerConfig.halfOpenMax,
            });
        }
    }

    // ── LLMProvider interface ──────────────────────────────────────────

    /**
     * Send a chat request to the LLM via ai-man's callProvider.
     *
     * @param {import('@sschepis/lmscript').LLMRequest} request
     * @returns {Promise<import('@sschepis/lmscript').LLMResponse>}
     */
    async chat(request) {
        const requestBody = this._buildRequestBody(request);
        const options = this._providerSettings
            ? { providerSettings: this._providerSettings }
            : {};

        const raw = await this._invoke(requestBody, options);
        return this._mapResponse(raw);
    }

    // ── Circuit-breaker helpers ────────────────────────────────────────

    /**
     * Return the circuit breaker's current state.
     * @returns {'closed' | 'open' | 'half-open'}
     */
    getCircuitState() {
        return this._breaker ? this._breaker.getState() : 'closed';
    }

    // ── Private helpers ────────────────────────────────────────────────

    /**
     * Invoke callProvider, optionally gated by the circuit breaker.
     * @private
     */
    async _invoke(requestBody, options) {
        if (!this._breaker) {
            return this._call(requestBody, options);
        }

        if (!this._breaker.isAllowed()) {
            throw new Error(
                `AiManLLMProvider: circuit breaker is ${this._breaker.getState()} – request blocked`
            );
        }

        try {
            const result = await this._call(requestBody, options);
            this._breaker.recordSuccess();
            return result;
        } catch (err) {
            this._breaker.recordFailure();
            throw err;
        }
    }

    /**
     * Raw callProvider wrapper with descriptive error re-throw.
     * @private
     */
    async _call(requestBody, options) {
        try {
            return await callProvider(requestBody, options);
        } catch (err) {
            const model = requestBody.model ?? 'unknown';
            throw new Error(
                `AiManLLMProvider: callProvider failed for model "${model}": ${err.message}`,
                { cause: err }
            );
        }
    }

    /**
     * Map an lmscript LLMRequest to ai-man's callProvider request body.
     * @private
     */
    _buildRequestBody(request) {
        const body = {
            model: request.model || this._model,
            messages: request.messages,
        };

        if (request.temperature != null) {
            body.temperature = request.temperature;
        }

        // lmscript LLMRequest uses maxTokens; callProvider expects max_tokens
        if (request.maxTokens != null) {
            body.max_tokens = request.maxTokens;
        }

        // ── Tools: lmscript { name, description, parameters } → OpenAI format ──
        if (request.tools?.length) {
            body.tools = request.tools.map((tool) => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                },
            }));
        }

        // ── JSON mode / structured output ──
        if (request.jsonSchema) {
            // Native structured output via JSON Schema
            body.response_format = {
                type: 'json_schema',
                json_schema: {
                    name: request.jsonSchema.name,
                    schema: request.jsonSchema.schema,
                    strict: request.jsonSchema.strict ?? true,
                },
            };
        } else if (request.jsonMode) {
            body.response_format = { type: 'json_object' };
        }

        // Support the task-spec responseFormat field if present
        if (request.responseFormat && !body.response_format) {
            body.response_format = request.responseFormat;
        }

        return body;
    }

    /**
     * Map ai-man's OpenAI-compatible response to lmscript LLMResponse.
     * @private
     */
    _mapResponse(raw) {
        const choice = raw?.choices?.[0];
        const message = choice?.message ?? {};

        /** @type {import('@sschepis/lmscript').LLMResponse} */
        const response = {
            content: message.content ?? '',
            raw,
        };

        // ── Tool calls ──
        if (message.tool_calls?.length) {
            response.toolCalls = message.tool_calls.map((tc) => ({
                id: tc.id,
                name: tc.function.name,
                arguments: typeof tc.function.arguments === 'string'
                    ? (() => {
                        try { return JSON.parse(tc.function.arguments); }
                        catch { return { _raw: tc.function.arguments }; }
                    })()
                    : tc.function.arguments,
            }));
        }

        // ── Usage (snake_case → camelCase) ──
        if (raw?.usage) {
            response.usage = {
                promptTokens: raw.usage.prompt_tokens ?? 0,
                completionTokens: raw.usage.completion_tokens ?? 0,
                totalTokens: raw.usage.total_tokens ?? 0,
            };
        }

        return response;
    }
}
