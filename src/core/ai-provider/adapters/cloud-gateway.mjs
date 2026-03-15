/**
 * Cloud Gateway AI Provider Adapter
 *
 * Adapter for the Lovable AI Gateway (OpenAI-compatible API at ai.gateway.lovable.dev).
 * Follows the same pattern as the OpenAI adapter: exports callCloudGatewayREST and
 * callCloudGatewayRESTStream functions that accept (ctx, requestBody, signal).
 *
 * Unlike the other adapters which rely on detection.mjs / config.mjs for routing,
 * this adapter is designed to be used standalone (e.g. from the cloud agent) as well
 * as through the standard provider dispatch in index.mjs.
 *
 * @module cloud-gateway
 */

import { withRetry } from '../utils.mjs';

/**
 * Combine multiple AbortSignals into one. Polyfill for AbortSignal.any()
 * which requires Node.js 20.3+.
 *
 * The polyfill path cleans up event listeners once any signal fires,
 * preventing listener accumulation when a long-lived signal (e.g., an
 * outer cancellation token) is reused across many requests.
 *
 * @param {AbortSignal[]} signals
 * @returns {AbortSignal}
 */
function combineSignals(...signals) {
    // Use native AbortSignal.any if available (Node 20.3+)
    if (typeof AbortSignal.any === 'function') {
        return AbortSignal.any(signals);
    }

    const controller = new AbortController();
    /** @type {Array<[AbortSignal, Function]>} */
    const registered = [];

    const cleanup = () => {
        for (const [sig, fn] of registered) {
            sig.removeEventListener('abort', fn);
        }
        registered.length = 0;
    };

    for (const signal of signals) {
        if (signal.aborted) {
            controller.abort(signal.reason);
            return controller.signal;
        }
        const handler = () => {
            controller.abort(signal.reason);
            cleanup();
        };
        signal.addEventListener('abort', handler, { once: true });
        registered.push([signal, handler]);
    }
    return controller.signal;
}

/** Default gateway URL */
const DEFAULT_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

/** Default model when none specified */
const DEFAULT_MODEL = 'google/gemini-3-flash-preview';

/** Default temperature */
const DEFAULT_TEMPERATURE = 0.7;

/** Per-call timeout for non-streaming requests (120s) */
const PER_CALL_TIMEOUT = 120_000;

/**
 * Build a provider context for the cloud gateway.
 *
 * This is a self-contained context builder that does NOT depend on config.mjs,
 * making it usable in both Node.js and Deno environments.
 *
 * @param {Object} options
 * @param {string} [options.apiKey] - API key for the gateway. Falls back to env.
 * @param {string} [options.baseUrl] - Override the gateway URL.
 * @param {string} [options.model] - Model identifier.
 * @returns {{ endpoint: string, headers: Object, model: string }}
 */
export function createCloudGatewayContext(options = {}) {
    const apiKey = options.apiKey || tryGetEnv('LOVABLE_API_KEY');
    if (!apiKey) {
        throw new Error(
            'Cloud Gateway: No API key provided. Pass apiKey in options or set LOVABLE_API_KEY environment variable.'
        );
    }

    const endpoint = options.baseUrl || DEFAULT_GATEWAY_URL;
    const model = options.model || DEFAULT_MODEL;

    return {
        provider: 'cloud_gateway',
        endpoint,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        model,
    };
}

/**
 * Call the Cloud Gateway using REST (non-streaming).
 *
 * Compatible with the standard adapter interface: callXxxREST(ctx, requestBody, signal).
 * The ctx can come from createCloudGatewayContext() or from createProviderContext()
 * if the adapter is wired into the main dispatch.
 *
 * @param {Object} ctx - Provider context with endpoint, headers, model
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal} [signal] - Abort signal for cancellation
 * @returns {Promise<Object>} Parsed JSON response
 */
export async function callCloudGatewayREST(ctx, requestBody, signal) {
    const body = {
        ...requestBody,
        model: requestBody.model || ctx.model || DEFAULT_MODEL,
        temperature: requestBody.temperature ?? DEFAULT_TEMPERATURE,
        stream: false,
    };

    const timeoutSignal = AbortSignal.timeout(PER_CALL_TIMEOUT);
    const combinedSignal = signal
        ? combineSignals(signal, timeoutSignal)
        : timeoutSignal;

    const response = await withRetry(() => fetch(ctx.endpoint, {
        method: 'POST',
        headers: ctx.headers,
        body: JSON.stringify(body),
        signal: combinedSignal,
    }), 3, 2000);

    if (!response.ok) {
        const status = response.status;
        if (status === 429) {
            throw new Error('Cloud Gateway: Rate limit exceeded (429)');
        }
        if (status === 402) {
            throw new Error('Cloud Gateway: AI credits depleted (402)');
        }
        throw new Error(`Cloud Gateway Error: ${status} - ${response.statusText}`);
    }

    return response.json();
}

/**
 * Call the Cloud Gateway with SSE streaming.
 *
 * Returns the raw Response object so the caller can read the SSE stream.
 * Does NOT apply a per-call timeout since streaming connections must stay
 * open for the entire generation duration.
 *
 * @param {Object} ctx - Provider context with endpoint, headers, model
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal} [signal] - Abort signal for cancellation
 * @returns {Promise<Response>} Raw fetch Response for streaming
 */
export async function callCloudGatewayRESTStream(ctx, requestBody, signal) {
    const body = {
        ...requestBody,
        model: requestBody.model || ctx.model || DEFAULT_MODEL,
        temperature: requestBody.temperature ?? DEFAULT_TEMPERATURE,
        stream: true,
    };

    const response = await withRetry(() => fetch(ctx.endpoint, {
        method: 'POST',
        headers: ctx.headers,
        body: JSON.stringify(body),
        signal,
    }), 3, 2000);

    if (!response.ok) {
        const status = response.status;
        if (status === 429) {
            throw new Error('Cloud Gateway: Rate limit exceeded (429)');
        }
        if (status === 402) {
            throw new Error('Cloud Gateway: AI credits depleted (402)');
        }
        throw new Error(`Cloud Gateway Error: ${status} - ${response.statusText}`);
    }

    return response;
}

/**
 * Attempt to read an environment variable in a runtime-agnostic way.
 * Works in Node.js (process.env) and Deno (Deno.env.get).
 *
 * @param {string} name - Environment variable name
 * @returns {string|undefined}
 */
function tryGetEnv(name) {
    // Node.js
    if (typeof process !== 'undefined' && process.env) {
        return process.env[name];
    }
    // Deno
    if (typeof Deno !== 'undefined' && Deno.env) {
        try {
            return Deno.env.get(name);
        } catch {
            return undefined;
        }
    }
    return undefined;
}
