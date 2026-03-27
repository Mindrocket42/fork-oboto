import { describe, expect, it } from '@jest/globals';

const { NewAgentProvider } = await import('../newagent-provider.mjs');
const { DEFAULT_MODEL } = await import('../../../agent/index.mjs');

describe('NewAgentProvider', () => {
  it('merges runtime config from deps.config during initialize()', async () => {
    const provider = new NewAgentProvider();

    await provider.initialize({
      aiProvider: null,
      toolExecutor: null,
      config: {
        ai: {
          newagent: {
            memory: { maxExperiences: 42 },
            cognitive: { enabled: false },
          },
        },
      },
    });

    expect(provider._config.memory.maxExperiences).toBe(42);

    await provider.dispose();
  });

  it('prefers an explicit Gemini override for the runner model', () => {
    const provider = new NewAgentProvider();
    provider._deps = { aiProvider: { model: 'gemini-2.0-flash' } };

    expect(provider._resolveRunnerModel('gemini-2.5-pro')).toBe('gemini-2.5-pro');
  });

  it('falls back to the active aiProvider Gemini model when override is incompatible', () => {
    const provider = new NewAgentProvider();
    provider._deps = { aiProvider: { model: 'gemini-2.0-flash' } };

    expect(provider._resolveRunnerModel('claude-3-7-sonnet')).toBe('gemini-2.0-flash');
  });

  it('falls back to the baked-in default model when no compatible Gemini model is available', () => {
    const provider = new NewAgentProvider();
    provider._deps = { aiProvider: { model: 'gpt-5' } };

    expect(provider._resolveRunnerModel('claude-3-7-sonnet')).toBe(DEFAULT_MODEL);
  });

  it('reports unhealthy when a critical subsystem failed initialization', async () => {
    const provider = new NewAgentProvider();
    provider._deps = {};
    provider._config = { cognitive: { enabled: false } };
    provider._vfs = { fs: {} };
    provider._contextManager = {};
    provider._memorySystem = {};
    provider._learningEngine = {};
    provider._subsystemStatus = {
      contextManager: { ok: true, error: null },
      memorySystem: { ok: true, error: null },
      learningEngine: { ok: false, error: 'learning unavailable' },
      cognitiveLayer: { ok: true, error: null },
    };

    await expect(provider.healthCheck()).resolves.toEqual({
      healthy: false,
      reason: 'learning unavailable',
    });
  });

  it('reports healthy when required subsystems are available and cognition is disabled', async () => {
    const provider = new NewAgentProvider();
    provider._deps = {};
    provider._config = { cognitive: { enabled: false } };
    provider._vfs = { fs: {} };
    provider._contextManager = {};
    provider._memorySystem = {};
    provider._learningEngine = {};
    provider._subsystemStatus = {
      contextManager: { ok: true, error: null },
      memorySystem: { ok: true, error: null },
      learningEngine: { ok: true, error: null },
      cognitiveLayer: { ok: false, error: null },
    };

    await expect(provider.healthCheck()).resolves.toEqual({ healthy: true });
  });
});