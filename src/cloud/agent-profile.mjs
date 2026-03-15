// Unified AgentProfile — Maps between the client's persona system
// (PersonaManager) and the cloud's `cloud_agents` table (CloudAgent type).
//
// The AgentProfile is the canonical representation used across both client
// and cloud, enabling seamless sync of agent identity and configuration.

/**
 * @typedef {Object} AgentProfile
 * @property {string} id — Unique agent ID
 * @property {string} name — Display name
 * @property {string} type — 'desktop' | 'cloud' | 'hybrid'
 * @property {string} [description] — Agent description
 * @property {string} [model] — AI model identifier
 * @property {string} [provider] — AI provider name
 * @property {string} [systemPrompt] — System prompt / persona instructions
 * @property {object} [capabilities] — { tools: string[], skills: string[] }
 * @property {object} [appearance] — { avatar: string, color: string }
 * @property {object} [memory] — Shared memory / knowledge base
 * @property {string} status — 'active' | 'idle' | 'offline' | 'error'
 * @property {string} [lastActiveAt] — ISO timestamp
 * @property {object} [metadata] — Additional provider-specific metadata
 */

/**
 * Convert a client persona config to an AgentProfile.
 *
 * Persona configs are structured JSON objects stored in `.oboto/personas/`
 * with fields like `id`, `name`, `description`, `identity`, `mission`,
 * `operationalBehavior`, `communicationStyle`, `toolGuidance`, etc.
 *
 * @param {object} personaConfig — From persona-manager.mjs
 * @param {object} [overrides] — Additional fields to merge
 * @returns {AgentProfile}
 */
export function personaToProfile(personaConfig, overrides = {}) {
    if (!personaConfig) {
        throw new Error('personaToProfile: personaConfig is required');
    }

    /** @type {AgentProfile} */
    const profile = {
        id: personaConfig.id,
        name: personaConfig.name || personaConfig.id,
        type: 'desktop',
        description: personaConfig.description || null,
        model: personaConfig.model || personaConfig.metadata?.model || null,
        provider: personaConfig.provider || personaConfig.metadata?.provider || null,
        systemPrompt: _extractSystemPrompt(personaConfig),
        capabilities: {
            tools: personaConfig.toolGuidance ? Object.keys(personaConfig.toolGuidance) : [],
            skills: personaConfig.skills || [],
        },
        appearance: {
            avatar: personaConfig.avatar || personaConfig.appearance?.avatar || null,
            color: personaConfig.color || personaConfig.appearance?.color || null,
        },
        memory: personaConfig.sharedMemory || null,
        status: 'active',
        lastActiveAt: new Date().toISOString(),
        metadata: {
            isDefault: !!personaConfig.isDefault,
            hasBootstrap: !!personaConfig.bootstrap,
            missionCount: Array.isArray(personaConfig.mission) ? personaConfig.mission.length : 0,
            ...(personaConfig.metadata || {}),
        },
    };

    return { ...profile, ...overrides };
}

/**
 * Convert a cloud agent record (from `cloud_agents` table) to an AgentProfile.
 *
 * Cloud agent schema (CloudAgent):
 *   id, name, slug, agent_type, description, status,
 *   avatar_url, system_prompt, model_config, allowed_tools
 *
 * @param {object} cloudAgent — From cloud_agents table
 * @returns {AgentProfile}
 */
export function cloudAgentToProfile(cloudAgent) {
    if (!cloudAgent) {
        throw new Error('cloudAgentToProfile: cloudAgent is required');
    }

    /** @type {AgentProfile} */
    const profile = {
        id: cloudAgent.id,
        name: cloudAgent.name || cloudAgent.slug,
        type: cloudAgent.agent_type || 'cloud',
        description: cloudAgent.description || null,
        model: cloudAgent.model_config?.model || null,
        provider: cloudAgent.model_config?.provider || null,
        systemPrompt: cloudAgent.system_prompt || null,
        capabilities: {
            tools: cloudAgent.allowed_tools || [],
            skills: [],
        },
        appearance: {
            avatar: cloudAgent.avatar_url || null,
            color: cloudAgent.model_config?.color || null,
        },
        memory: cloudAgent.model_config?.memory || null,
        status: cloudAgent.status || 'idle',
        lastActiveAt: cloudAgent.last_active_at || null,
        metadata: {
            slug: cloudAgent.slug,
            model_config: cloudAgent.model_config || {},
        },
    };

    return profile;
}

/**
 * Convert an AgentProfile to a cloud agent record suitable for upsert
 * into the `cloud_agents` table.
 *
 * @param {AgentProfile} profile
 * @returns {object} — Cloud agent table row
 */
export function profileToCloudAgent(profile) {
    if (!profile) {
        throw new Error('profileToCloudAgent: profile is required');
    }

    return {
        id: profile.id,
        name: profile.name,
        slug: profile.metadata?.slug || _slugify(profile.name),
        agent_type: profile.type || 'desktop',
        description: profile.description || null,
        status: profile.status || 'idle',
        avatar_url: profile.appearance?.avatar || null,
        system_prompt: profile.systemPrompt || null,
        model_config: {
            model: profile.model || null,
            provider: profile.provider || null,
            color: profile.appearance?.color || null,
            memory: profile.memory || null,
            ...(profile.metadata?.model_config || {}),
        },
        allowed_tools: profile.capabilities?.tools || [],
    };
}

/**
 * Convert an AgentProfile to a client persona config compatible
 * with {@link PersonaManager}.
 *
 * @param {AgentProfile} profile
 * @returns {object} — Persona config compatible with persona-manager
 */
export function profileToPersona(profile) {
    if (!profile) {
        throw new Error('profileToPersona: profile is required');
    }

    const persona = {
        id: profile.id,
        name: profile.name,
        description: profile.description || '',
        isDefault: !!profile.metadata?.isDefault,
        model: profile.model || undefined,
        provider: profile.provider || undefined,
        identity: {
            coreDirective: profile.systemPrompt || '',
            voice: profile.metadata?.voice || '',
            relationship: profile.metadata?.relationship || '',
        },
        toolGuidance: {},
        skills: profile.capabilities?.skills || [],
        appearance: {
            avatar: profile.appearance?.avatar || null,
            color: profile.appearance?.color || null,
        },
        sharedMemory: profile.memory || null,
        metadata: {
            ...(profile.metadata || {}),
            sourceType: profile.type,
        },
    };

    // Reconstruct toolGuidance from capabilities.tools as keys
    if (profile.capabilities?.tools) {
        for (const tool of profile.capabilities.tools) {
            persona.toolGuidance[tool] = '';
        }
    }

    return persona;
}

/**
 * Merge two profiles (e.g., when syncing desktop ↔ cloud).
 * Uses field-level merge: non-null/non-undefined fields from `updates`
 * overwrite `base`. Nested objects are shallow-merged one level deep.
 *
 * @param {AgentProfile} base
 * @param {Partial<AgentProfile>} updates
 * @returns {AgentProfile}
 */
export function mergeProfiles(base, updates) {
    if (!base) {
        throw new Error('mergeProfiles: base profile is required');
    }
    if (!updates) return { ...base };

    /** @type {AgentProfile} */
    const merged = { ...base };

    for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === null) continue;

        // Shallow-merge nested objects (capabilities, appearance, memory, metadata)
        if (
            typeof value === 'object' &&
            !Array.isArray(value) &&
            typeof merged[key] === 'object' &&
            merged[key] !== null &&
            !Array.isArray(merged[key])
        ) {
            merged[key] = { ...merged[key], ...value };
        } else {
            merged[key] = value;
        }
    }

    return merged;
}

// ── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Extract a flat system prompt string from a structured persona config.
 * Builds a simplified version — the full rendering is done by PersonaManager.renderPersonaPrompt().
 * @param {object} personaConfig
 * @returns {string|null}
 */
function _extractSystemPrompt(personaConfig) {
    const parts = [];

    if (personaConfig.identity?.coreDirective) {
        parts.push(personaConfig.identity.coreDirective);
    }

    if (personaConfig.identity?.voice) {
        parts.push(`Voice: ${personaConfig.identity.voice}`);
    }

    if (Array.isArray(personaConfig.mission)) {
        const missionLines = personaConfig.mission
            .map((m) => `${m.priority}. ${m.label}: ${m.description}`)
            .join('\n');
        if (missionLines) parts.push(`Mission:\n${missionLines}`);
    }

    if (Array.isArray(personaConfig.specialInstructions)) {
        for (const instr of personaConfig.specialInstructions) {
            if (typeof instr === 'string') {
                parts.push(instr);
            } else if (instr.content) {
                parts.push(instr.content);
            }
        }
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
}

/**
 * Create a URL-safe slug from a name.
 * @param {string} name
 * @returns {string}
 */
function _slugify(name) {
    return (name || 'agent')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
