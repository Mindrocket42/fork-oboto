import { config } from '../../config.mjs';
import { consoleStyler } from '../../ui/console-styler.mjs';
import { AI_PROVIDERS, PROVIDER_ENDPOINTS } from './constants.mjs';
import { getModelInfo } from '../model-registry.mjs';

/**
 * Detect the AI provider from the model name.
 * Uses name-based heuristics to determine the correct provider.
 * When no model is specified, falls back to the configured default provider.
 *
 * IMPORTANT: This function must NOT blindly return config.ai.provider when a
 * model is specified — that would route all models (including LMStudio models)
 * to whatever the default provider is (e.g., Gemini), causing 404 errors.
 *
 * @param {string} model - The model identifier
 * @returns {string} The detected provider key
 */
export function detectProvider(model) {
    if (!model) {
        // No model specified — use the configured default provider
        const explicitProvider = config.ai.provider;
        if (explicitProvider && Object.values(AI_PROVIDERS).includes(explicitProvider)) {
            return explicitProvider;
        }
        return AI_PROVIDERS.LMSTUDIO;
    }

    const m = model.toLowerCase();
    const configuredProvider = config.ai.provider;

    // --- Explicit provider prefix conventions ---
    // Some inference platforms use prefix conventions to disambiguate models
    // whose names overlap with base providers (e.g. "groq/llama-3-70b").

    if (m.startsWith('groq/')) return AI_PROVIDERS.GROQ;
    if (m.startsWith('together/')) return AI_PROVIDERS.TOGETHER;
    if (m.startsWith('accounts/fireworks/')) return AI_PROVIDERS.FIREWORKS;

    // --- Provider-specific model name patterns ---

    // Google Gemini models
    if (m.startsWith('gemini-') || m.startsWith('models/gemini-')) {
        return AI_PROVIDERS.GEMINI;
    }

    // Anthropic Claude models — route based on available credentials:
    //   1. Vertex credentials → ANTHROPIC (Vertex adapter)
    //   2. ANTHROPIC_API_KEY (no Vertex) → ANTHROPIC_DIRECT
    //   3. Neither → fall through to OpenAI-compatible endpoint
    if (m.startsWith('claude-')) {
        const hasVertex = !!(process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT);
        if (hasVertex) {
            return AI_PROVIDERS.ANTHROPIC;
        }
        if (process.env.ANTHROPIC_API_KEY) {
            return AI_PROVIDERS.ANTHROPIC_DIRECT;
        }
        // Fall back to OpenAI-compatible endpoint (Anthropic direct API or proxy)
        return AI_PROVIDERS.OPENAI;
    }

    // OpenAI models — check for Azure OpenAI first
    // Use exact match OR dash-prefix to avoid matching non-OpenAI model names
    // that happen to start with "o1", "o3", or "o4".
    if (m.startsWith('gpt-') || m === 'o1' || m.startsWith('o1-') || m === 'o3' || m.startsWith('o3-') || m === 'o4' || m.startsWith('o4-') || m.startsWith('chatgpt-')) {
        if (process.env.AZURE_OPENAI_ENDPOINT) {
            return AI_PROVIDERS.AZURE_OPENAI;
        }
        return AI_PROVIDERS.OPENAI;
    }

    // Mistral models
    if (m.startsWith('mistral-') || m.startsWith('mixtral-') || m.startsWith('codestral-') || m.startsWith('pixtral-')) {
        // When explicitly configured for a platform that hosts Mistral models, respect it
        if (configuredProvider === AI_PROVIDERS.TOGETHER || configuredProvider === AI_PROVIDERS.GROQ || configuredProvider === AI_PROVIDERS.FIREWORKS) {
            return configuredProvider;
        }
        return AI_PROVIDERS.MISTRAL;
    }

    // Cohere models (chat/generation only — embed-* models are not supported
    // via the chat completions endpoint, so they are excluded here)
    if (m.startsWith('command-') || m.startsWith('c4ai-')) {
        return AI_PROVIDERS.COHERE;
    }

    // xAI Grok models
    if (m.startsWith('grok-')) {
        return AI_PROVIDERS.XAI;
    }

    // DeepSeek models
    if (m.startsWith('deepseek-')) {
        return AI_PROVIDERS.DEEPSEEK;
    }

    // Perplexity models
    if (m.startsWith('sonar-') || m.startsWith('pplx-')) {
        return AI_PROVIDERS.PERPLEXITY;
    }

    // AI21 models
    if (m.startsWith('jamba-') || m.startsWith('j2-')) {
        return AI_PROVIDERS.AI21;
    }

    // Replicate model IDs follow the "owner/name:version" format.
    // Checked after named-provider patterns to avoid false-positives on model
    // names like "meta-llama/llama-3-70b:abc123" intended for Together/etc.
    // Only match when the user has explicitly configured Replicate, or when
    // no other provider is configured.
    if (/^[a-z0-9_-]+\/[a-z0-9._-]+:[a-z0-9]+$/i.test(model)) {
        if (configuredProvider === AI_PROVIDERS.REPLICATE || !configuredProvider) {
            return AI_PROVIDERS.REPLICATE;
        }
    }

    // Meta / community models on third-party platforms — use explicit provider config
    // These model names (e.g. "meta-llama/llama-3-70b", "mistralai/mixtral-8x7b")
    // are served by multiple inference providers, so we defer to config.ai.provider.
    if (m.includes('/') && !m.startsWith('models/')) {
        const slashProviders = [
            AI_PROVIDERS.TOGETHER, AI_PROVIDERS.OPENROUTER, AI_PROVIDERS.FIREWORKS,
            AI_PROVIDERS.GROQ, AI_PROVIDERS.HUGGINGFACE, AI_PROVIDERS.REPLICATE,
            AI_PROVIDERS.CEREBRAS, AI_PROVIDERS.SAMBANOVA,
        ];
        if (slashProviders.includes(configuredProvider)) {
            return configuredProvider;
        }
    }

    // --- Providers that rely solely on config.ai.provider (no unique model name pattern) ---

    const configOnlyProviders = [
        AI_PROVIDERS.OPENROUTER, AI_PROVIDERS.CEREBRAS, AI_PROVIDERS.SAMBANOVA,
        AI_PROVIDERS.HUGGINGFACE, AI_PROVIDERS.GROQ, AI_PROVIDERS.TOGETHER,
        AI_PROVIDERS.FIREWORKS, AI_PROVIDERS.BEDROCK, AI_PROVIDERS.AZURE_OPENAI,
    ];
    if (configOnlyProviders.includes(configuredProvider)) {
        return configuredProvider;
    }

    // Cloud models: check if the model is registered as a cloud model in the
    // model registry (fetched from Oboto Cloud's AI gateway).
    try {
        const modelInfo = getModelInfo(model);
        if (modelInfo && modelInfo.provider === AI_PROVIDERS.CLOUD) {
            return AI_PROVIDERS.CLOUD;
        }
    } catch {
        // Model registry not yet initialized — fall through to config check
    }

    // If the user has explicitly configured the provider as 'cloud', honor it.
    // Cloud models have arbitrary names (e.g., "meta-llama/llama-3-70b") that
    // don't match any prefix above, so we must respect the explicit setting.
    if (config.ai.provider === AI_PROVIDERS.CLOUD) {
        consoleStyler.log('routing', `detectProvider: falling back to cloud for unrecognized model "${model}" (config.ai.provider is cloud)`);
        return AI_PROVIDERS.CLOUD;
    }

    // Default: local server (LMStudio, Ollama, etc.)
    // Any model name that doesn't match a known cloud provider prefix
    // is assumed to be a local model served by LMStudio or similar
    return AI_PROVIDERS.LMSTUDIO;
}

/**
 * Get the appropriate endpoint URL for a provider
 * @param {string} provider - The provider key
 * @returns {string|null} The endpoint URL (null for SDK-based providers)
 */
export function getEndpoint(provider) {
    // If user has explicitly set an endpoint, always use it
    const configuredEndpoint = config.ai.endpoint;
    if (configuredEndpoint &&
        configuredEndpoint !== 'http://localhost:1234/v1/chat/completions' &&
        configuredEndpoint !== 'http://localhost:1234/api/v1/chat') {
        return configuredEndpoint;
    }

    // Azure OpenAI uses a per-deployment endpoint from env
    if (provider === AI_PROVIDERS.AZURE_OPENAI) {
        const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
        const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';
        if (azureEndpoint) {
            // Standard Azure OpenAI completions URL
            return `${azureEndpoint.replace(/\/+$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=2024-08-01-preview`;
        }
        return null;
    }

    return PROVIDER_ENDPOINTS[provider] || PROVIDER_ENDPOINTS[AI_PROVIDERS.LMSTUDIO];
}

/**
 * Get the appropriate authorization headers for a provider (REST-based only)
 * @param {string} provider - The provider key
 * @returns {Object} Headers object
 */
export function getAuthHeaders(provider) {
    switch (provider) {
        case AI_PROVIDERS.OPENAI:
            if (config.keys.openai) {
                return { 'Authorization': `Bearer ${config.keys.openai}` };
            }
            return {};

        case AI_PROVIDERS.ANTHROPIC:
            // Vertex SDK handles auth via Google ADC — no explicit headers needed
            return {};

        case AI_PROVIDERS.ANTHROPIC_DIRECT:
            if (config.keys.anthropic) {
                return {
                    'x-api-key': config.keys.anthropic,
                    'anthropic-version': '2023-06-01',
                };
            }
            return {};

        case AI_PROVIDERS.AZURE_OPENAI:
            if (config.keys.azureOpenai) {
                return { 'api-key': config.keys.azureOpenai };
            }
            return {};

        case AI_PROVIDERS.BEDROCK:
            // AWS SDK handles auth via IAM credentials — no explicit headers needed
            return {};

        // Tier 1 — Bearer token providers
        case AI_PROVIDERS.MISTRAL:
            if (config.keys.mistral) {
                return { 'Authorization': `Bearer ${config.keys.mistral}` };
            }
            return {};

        case AI_PROVIDERS.COHERE:
            if (config.keys.cohere) {
                return { 'Authorization': `Bearer ${config.keys.cohere}` };
            }
            return {};

        case AI_PROVIDERS.XAI:
            if (config.keys.xai) {
                return { 'Authorization': `Bearer ${config.keys.xai}` };
            }
            return {};

        case AI_PROVIDERS.DEEPSEEK:
            if (config.keys.deepseek) {
                return { 'Authorization': `Bearer ${config.keys.deepseek}` };
            }
            return {};

        // Tier 2 — Fast inference platforms (all Bearer token)
        case AI_PROVIDERS.GROQ:
            if (config.keys.groq) {
                return { 'Authorization': `Bearer ${config.keys.groq}` };
            }
            return {};

        case AI_PROVIDERS.TOGETHER:
            if (config.keys.together) {
                return { 'Authorization': `Bearer ${config.keys.together}` };
            }
            return {};

        case AI_PROVIDERS.FIREWORKS:
            if (config.keys.fireworks) {
                return { 'Authorization': `Bearer ${config.keys.fireworks}` };
            }
            return {};

        case AI_PROVIDERS.CEREBRAS:
            if (config.keys.cerebras) {
                return { 'Authorization': `Bearer ${config.keys.cerebras}` };
            }
            return {};

        case AI_PROVIDERS.SAMBANOVA:
            if (config.keys.sambanova) {
                return { 'Authorization': `Bearer ${config.keys.sambanova}` };
            }
            return {};

        case AI_PROVIDERS.REPLICATE:
            if (config.keys.replicate) {
                return { 'Authorization': `Bearer ${config.keys.replicate}` };
            }
            return {};

        // Tier 3 — Specialized / aggregator (all Bearer token)
        case AI_PROVIDERS.OPENROUTER:
            if (config.keys.openrouter) {
                return { 'Authorization': `Bearer ${config.keys.openrouter}` };
            }
            return {};

        case AI_PROVIDERS.PERPLEXITY:
            if (config.keys.perplexity) {
                return { 'Authorization': `Bearer ${config.keys.perplexity}` };
            }
            return {};

        case AI_PROVIDERS.HUGGINGFACE:
            if (config.keys.huggingface) {
                return { 'Authorization': `Bearer ${config.keys.huggingface}` };
            }
            return {};

        case AI_PROVIDERS.AI21:
            if (config.keys.ai21) {
                return { 'Authorization': `Bearer ${config.keys.ai21}` };
            }
            return {};

        case AI_PROVIDERS.LMSTUDIO:
        default:
            // Local servers may still use an API key for compatibility
            if (config.keys.openai) {
                return { 'Authorization': `Bearer ${config.keys.openai}` };
            }
            return {};
    }
}

/**
 * Create a fully configured provider context for making API calls
 * @param {string} [model] - Optional model override; defaults to config.ai.model
 * @returns {{ provider: string, endpoint: string|null, headers: Object, model: string }}
 */
export function createProviderContext(model) {
    const activeModel = model || config.ai.model;
    const provider = detectProvider(activeModel);
    const endpoint = getEndpoint(provider);

    // SDK-based providers don't need REST headers
    const sdkProviders = [AI_PROVIDERS.GEMINI, AI_PROVIDERS.ANTHROPIC, AI_PROVIDERS.BEDROCK];
    const authHeaders = sdkProviders.includes(provider) ? {} : getAuthHeaders(provider);

    return {
        provider,
        endpoint,
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
        },
        model: activeModel,
    };
}

/**
 * Get a human-readable label for the current provider setup
 * @param {string} [model] - Optional model override
 * @returns {string} Description like "Gemini (gemini-2.0-flash)"
 */
export function getProviderLabel(model) {
    const ctx = createProviderContext(model);
    const labels = {
        [AI_PROVIDERS.CLOUD]: 'Cloud',
        [AI_PROVIDERS.WEBLLM]: 'WebLLM',
        [AI_PROVIDERS.LMSTUDIO]: 'LMStudio',
        [AI_PROVIDERS.OPENAI]: 'OpenAI',
        [AI_PROVIDERS.GEMINI]: 'Gemini',
        [AI_PROVIDERS.ANTHROPIC]: 'Anthropic (Vertex)',

        // Tier 1
        [AI_PROVIDERS.MISTRAL]: 'Mistral',
        [AI_PROVIDERS.COHERE]: 'Cohere',
        [AI_PROVIDERS.AZURE_OPENAI]: 'Azure OpenAI',
        [AI_PROVIDERS.BEDROCK]: 'AWS Bedrock',
        [AI_PROVIDERS.XAI]: 'xAI',
        [AI_PROVIDERS.DEEPSEEK]: 'DeepSeek',

        // Tier 2
        [AI_PROVIDERS.GROQ]: 'Groq',
        [AI_PROVIDERS.TOGETHER]: 'Together AI',
        [AI_PROVIDERS.FIREWORKS]: 'Fireworks AI',
        [AI_PROVIDERS.CEREBRAS]: 'Cerebras',
        [AI_PROVIDERS.SAMBANOVA]: 'SambaNova',
        [AI_PROVIDERS.REPLICATE]: 'Replicate',

        // Tier 3
        [AI_PROVIDERS.OPENROUTER]: 'OpenRouter',
        [AI_PROVIDERS.PERPLEXITY]: 'Perplexity',
        [AI_PROVIDERS.HUGGINGFACE]: 'Hugging Face',
        [AI_PROVIDERS.AI21]: 'AI21',
        [AI_PROVIDERS.ANTHROPIC_DIRECT]: 'Anthropic',
    };
    return `${labels[ctx.provider] || ctx.provider} (${ctx.model})`;
}
