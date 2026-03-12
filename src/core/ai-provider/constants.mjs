/**
 * Supported AI providers
 */
export const AI_PROVIDERS = {
    CLOUD: 'cloud',
    WEBLLM: 'webllm',
    LMSTUDIO: 'lmstudio',
    OPENAI: 'openai',
    GEMINI: 'gemini',
    ANTHROPIC: 'anthropic',

    // Tier 1 — Major commercial APIs
    MISTRAL: 'mistral',
    COHERE: 'cohere',
    AZURE_OPENAI: 'azure_openai',
    BEDROCK: 'bedrock',
    XAI: 'xai',
    DEEPSEEK: 'deepseek',

    // Tier 2 — Fast inference platforms
    GROQ: 'groq',
    TOGETHER: 'together',
    FIREWORKS: 'fireworks',
    CEREBRAS: 'cerebras',
    SAMBANOVA: 'sambanova',
    REPLICATE: 'replicate',

    // Tier 3 — Specialized / aggregator
    OPENROUTER: 'openrouter',
    PERPLEXITY: 'perplexity',
    HUGGINGFACE: 'huggingface',
    AI21: 'ai21',
    ANTHROPIC_DIRECT: 'anthropic_direct',
};

/**
 * Default endpoints for each provider
 */
export const PROVIDER_ENDPOINTS = {
    [AI_PROVIDERS.LMSTUDIO]: 'http://localhost:1234/v1/chat/completions',
    [AI_PROVIDERS.OPENAI]: 'https://api.openai.com/v1/chat/completions',
    // Gemini uses SDK, not REST endpoint — this is only a fallback
    [AI_PROVIDERS.GEMINI]: null,
    // Anthropic: managed by @anthropic-ai/vertex-sdk — no direct endpoint needed
    [AI_PROVIDERS.ANTHROPIC]: null,

    // Tier 1 — Major commercial APIs
    [AI_PROVIDERS.MISTRAL]: 'https://api.mistral.ai/v1/chat/completions',
    [AI_PROVIDERS.COHERE]: 'https://api.cohere.com/v2/chat',
    // Azure OpenAI: endpoint is per-deployment, set via AZURE_OPENAI_ENDPOINT env var
    [AI_PROVIDERS.AZURE_OPENAI]: null,
    // AWS Bedrock: SDK-based, no direct REST endpoint
    [AI_PROVIDERS.BEDROCK]: null,
    [AI_PROVIDERS.XAI]: 'https://api.x.ai/v1/chat/completions',
    [AI_PROVIDERS.DEEPSEEK]: 'https://api.deepseek.com/v1/chat/completions',

    // Tier 2 — Fast inference platforms
    [AI_PROVIDERS.GROQ]: 'https://api.groq.com/openai/v1/chat/completions',
    [AI_PROVIDERS.TOGETHER]: 'https://api.together.xyz/v1/chat/completions',
    [AI_PROVIDERS.FIREWORKS]: 'https://api.fireworks.ai/inference/v1/chat/completions',
    [AI_PROVIDERS.CEREBRAS]: 'https://api.cerebras.ai/v1/chat/completions',
    [AI_PROVIDERS.SAMBANOVA]: 'https://api.sambanova.ai/v1/chat/completions',
    [AI_PROVIDERS.REPLICATE]: 'https://api.replicate.com/v1/predictions',

    // Tier 3 — Specialized / aggregator
    [AI_PROVIDERS.OPENROUTER]: 'https://openrouter.ai/api/v1/chat/completions',
    [AI_PROVIDERS.PERPLEXITY]: 'https://api.perplexity.ai/chat/completions',
    [AI_PROVIDERS.HUGGINGFACE]: 'https://api-inference.huggingface.co/models/',
    [AI_PROVIDERS.AI21]: 'https://api.ai21.com/studio/v1/chat/completions',
    // Anthropic Direct: uses Anthropic's own Messages API
    [AI_PROVIDERS.ANTHROPIC_DIRECT]: 'https://api.anthropic.com/v1/messages',
};

/**
 * Recommended WebLLM models for Oboto.
 * These are optimized for agentic coding tasks and fit common GPU memory.
 */
export const WEBLLM_RECOMMENDED_MODELS = [
    {
        id: 'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC',
        name: 'Qwen 2.5 Coder 7B (recommended)',
        description: 'Best for coding tasks. Strong tool-calling support. Requires ~5GB VRAM.',
        vram: '5GB',
        quality: 'high',
    },
    {
        id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
        name: 'Llama 3.2 3B',
        description: 'Good balance of quality and speed. Fits in 3GB VRAM.',
        vram: '3GB',
        quality: 'medium',
    },
    {
        id: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
        name: 'Phi 3.5 Mini',
        description: 'Compact and fast. Great for simple tasks. ~2GB VRAM.',
        vram: '2GB',
        quality: 'medium',
    },
    {
        id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
        name: 'Qwen 2.5 3B',
        description: 'Strong multilingual support. Good reasoning. ~3GB VRAM.',
        vram: '3GB',
        quality: 'medium',
    },
];
