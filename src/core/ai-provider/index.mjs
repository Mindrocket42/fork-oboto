import { AI_PROVIDERS, WEBLLM_RECOMMENDED_MODELS } from './constants.mjs';
import { detectProvider, getEndpoint, getAuthHeaders, createProviderContext, getProviderLabel } from './detection.mjs';
import { isCancellationError, isRetryableError, withRetry } from './utils.mjs';
import { callGeminiSDK, callGeminiSDKStream } from './adapters/gemini.mjs';
import { callOpenAIREST, callOpenAIRESTStream, transformRequestBody } from './adapters/openai.mjs';
import { callAnthropicREST, callAnthropicRESTStream } from './adapters/anthropic.mjs';
import { callWebLLM, setEventBusRef as setWebLLMEventBusRef } from './adapters/webllm.mjs';
import { callCloudProxy, callCloudProxyStream, setCloudSyncRef, setEventBusRefForCloud } from './adapters/cloud.mjs';
import { callAnthropicDirectREST, callAnthropicDirectRESTStream } from './adapters/anthropic-direct.mjs';
import { callCohereREST, callCohereRESTStream } from './adapters/cohere.mjs';
import { callAzureOpenAIREST, callAzureOpenAIRESTStream } from './adapters/azure-openai.mjs';
import { callBedrockREST, callBedrockRESTStream } from './adapters/bedrock.mjs';
import { callReplicateREST, callReplicateRESTStream } from './adapters/replicate.mjs';
import { callHuggingFaceREST, callHuggingFaceRESTStream } from './adapters/huggingface.mjs';
import { callAI21REST, callAI21RESTStream } from './adapters/ai21.mjs';

// Re-export constants and utilities
export {
    AI_PROVIDERS,
    WEBLLM_RECOMMENDED_MODELS,
    detectProvider,
    getEndpoint,
    getAuthHeaders,
    transformRequestBody,
    createProviderContext,
    isCancellationError,
    isRetryableError,
    getProviderLabel,
    setCloudSyncRef,
};

// Unified setEventBusRef that updates both WebLLM and Cloud adapters
export function setEventBusRef(eventBus) {
    setWebLLMEventBusRef(eventBus);
    setEventBusRefForCloud(eventBus);
}

/**
 * Make an API call using the provider abstraction.
 * For Gemini: uses @google/genai SDK with format translation
 * For OpenAI/Local: uses REST fetch with OpenAI-compatible format
 *
 * @param {Object} requestBody - OpenAI-compatible request body (model, messages, tools, etc.)
 * @param {Object} [options] - Optional overrides
 * @param {string} [options.model] - Model override
 * @param {AbortSignal} [options.signal] - Abort signal for cancellation
 * @returns {Promise<Object>} OpenAI-compatible parsed JSON response
 */
export async function callProvider(requestBody, options = {}) {
    const ctx = createProviderContext(options.model || requestBody.model);

    // ── WebLLM: route through browser-side WebLLM engine via WS ──
    if (ctx.provider === AI_PROVIDERS.WEBLLM) {
        return await callWebLLM(requestBody);
    }

    // ── Cloud: route through cloud AI proxy (with fallback) ──
    if (ctx.provider === AI_PROVIDERS.CLOUD) {
        return await callCloudProxy(ctx, requestBody, options);
    }

    // ── Gemini: use native SDK ──
    if (ctx.provider === AI_PROVIDERS.GEMINI) {
        return await callGeminiSDK(ctx, requestBody, options.signal);
    }

    // ── Anthropic: use native REST adapter ──
    if (ctx.provider === AI_PROVIDERS.ANTHROPIC) {
        return await callAnthropicREST(ctx, requestBody, options.signal);
    }

    // ── Anthropic Direct: use direct Anthropic API adapter ──
    if (ctx.provider === AI_PROVIDERS.ANTHROPIC_DIRECT) {
        return await callAnthropicDirectREST(ctx, requestBody, options.signal);
    }

    // ── Cohere: use native Cohere REST adapter ──
    if (ctx.provider === AI_PROVIDERS.COHERE) {
        return await callCohereREST(ctx, requestBody, options.signal);
    }

    // ── Azure OpenAI: use Azure-specific REST adapter ──
    if (ctx.provider === AI_PROVIDERS.AZURE_OPENAI) {
        return await callAzureOpenAIREST(ctx, requestBody, options.signal);
    }

    // ── AWS Bedrock: use Bedrock REST adapter ──
    if (ctx.provider === AI_PROVIDERS.BEDROCK) {
        return await callBedrockREST(ctx, requestBody, options.signal);
    }

    // ── Replicate: use Replicate REST adapter ──
    if (ctx.provider === AI_PROVIDERS.REPLICATE) {
        return await callReplicateREST(ctx, requestBody, options.signal);
    }

    // ── Hugging Face: use HF Inference REST adapter ──
    if (ctx.provider === AI_PROVIDERS.HUGGINGFACE) {
        return await callHuggingFaceREST(ctx, requestBody, options.signal);
    }

    // ── AI21: use AI21 REST adapter ──
    if (ctx.provider === AI_PROVIDERS.AI21) {
        return await callAI21REST(ctx, requestBody, options.signal);
    }

    // ── OpenAI / Local / OpenAI-compatible fallthrough ──
    // Handles: OpenAI, Mistral, xAI, DeepSeek, Groq, Together, Fireworks,
    // Cerebras, SambaNova, OpenRouter, Perplexity, LMStudio, and any other
    // provider using the OpenAI-compatible chat completions format.
    // detection.mjs sets the correct endpoint and auth headers for each.
    return await callOpenAIREST(ctx, requestBody, options.signal);
}

/**
 * Make a streaming API call using the provider abstraction.
 * For Gemini: falls back to non-streaming (SDK stream support can be added later)
 * For OpenAI/Local: uses REST SSE streaming
 *
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {Object} [options] - Optional overrides
 * @param {AbortSignal} [options.signal] - Abort signal for cancellation
 * @returns {Promise<Response>} Raw fetch Response for streaming (or synthetic for Gemini)
 */
export async function callProviderStream(requestBody, options = {}) {
    const ctx = createProviderContext(options.model || requestBody.model);

    // ── Cloud: route through cloud AI proxy streaming ──
    if (ctx.provider === AI_PROVIDERS.CLOUD) {
        return await callCloudProxyStream(ctx, requestBody);
    }

    // ── Gemini: use SDK (non-streaming, wrapped as synthetic stream) ──
    if (ctx.provider === AI_PROVIDERS.GEMINI) {
        return await callGeminiSDKStream(ctx, requestBody, options.signal);
    }

    // ── Anthropic: use native REST SSE adapter ──
    if (ctx.provider === AI_PROVIDERS.ANTHROPIC) {
        return await callAnthropicRESTStream(ctx, requestBody, options.signal);
    }

    // ── Anthropic Direct: use direct Anthropic API SSE adapter ──
    if (ctx.provider === AI_PROVIDERS.ANTHROPIC_DIRECT) {
        return await callAnthropicDirectRESTStream(ctx, requestBody, options.signal);
    }

    // ── Cohere: use native Cohere REST SSE adapter ──
    if (ctx.provider === AI_PROVIDERS.COHERE) {
        return await callCohereRESTStream(ctx, requestBody, options.signal);
    }

    // ── Azure OpenAI: use Azure-specific REST SSE adapter ──
    if (ctx.provider === AI_PROVIDERS.AZURE_OPENAI) {
        return await callAzureOpenAIRESTStream(ctx, requestBody, options.signal);
    }

    // ── AWS Bedrock: use Bedrock REST SSE adapter ──
    if (ctx.provider === AI_PROVIDERS.BEDROCK) {
        return await callBedrockRESTStream(ctx, requestBody, options.signal);
    }

    // ── Replicate: use Replicate REST SSE adapter ──
    if (ctx.provider === AI_PROVIDERS.REPLICATE) {
        return await callReplicateRESTStream(ctx, requestBody, options.signal);
    }

    // ── Hugging Face: use HF Inference REST SSE adapter ──
    if (ctx.provider === AI_PROVIDERS.HUGGINGFACE) {
        return await callHuggingFaceRESTStream(ctx, requestBody, options.signal);
    }

    // ── AI21: use AI21 REST SSE adapter ──
    if (ctx.provider === AI_PROVIDERS.AI21) {
        return await callAI21RESTStream(ctx, requestBody, options.signal);
    }

    // ── OpenAI / Local / OpenAI-compatible fallthrough ──
    // Handles: OpenAI, Mistral, xAI, DeepSeek, Groq, Together, Fireworks,
    // Cerebras, SambaNova, OpenRouter, Perplexity, LMStudio, and any other
    // provider using the OpenAI-compatible chat completions format.
    // detection.mjs sets the correct endpoint and auth headers for each.
    return await callOpenAIRESTStream(ctx, requestBody, options.signal);
}

// Test-only exports (stripped in production builds)
export const _testExports = { withRetry, isCancellationError, isRetryableError };
