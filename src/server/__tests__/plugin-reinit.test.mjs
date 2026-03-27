import { describe, expect, it, jest } from '@jest/globals';

const { ensureUnifiedProvider } = await import('../ws-handlers/plugin-reinit.mjs');

describe('ensureUnifiedProvider', () => {
  it('preserves a healthy active non-unified provider', async () => {
    const healthCheck = jest.fn(async () => ({ healthy: true }));
    const switchAgenticProvider = jest.fn();
    const assistant = {
      agenticRegistry: {
        getActive: () => ({ id: 'newagent', healthCheck }),
      },
      switchAgenticProvider,
    };

    await ensureUnifiedProvider(assistant);

    expect(healthCheck).toHaveBeenCalledTimes(1);
    expect(switchAgenticProvider).not.toHaveBeenCalled();
  });

  it('falls back to unified when the active provider is unhealthy', async () => {
    const switchAgenticProvider = jest.fn(async () => ({ id: 'unified' }));
    const assistant = {
      agenticRegistry: {
        getActive: () => ({
          id: 'newagent',
          healthCheck: async () => ({ healthy: false, reason: 'broken' }),
        }),
      },
      switchAgenticProvider,
    };

    await ensureUnifiedProvider(assistant);

    expect(switchAgenticProvider).toHaveBeenCalledWith('unified');
  });

  it('falls back to unified when there is no active provider', async () => {
    const switchAgenticProvider = jest.fn(async () => ({ id: 'unified' }));
    const assistant = {
      agenticRegistry: {
        getActive: () => null,
      },
      switchAgenticProvider,
    };

    await ensureUnifiedProvider(assistant);

    expect(switchAgenticProvider).toHaveBeenCalledWith('unified');
  });
});