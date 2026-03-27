import { describe, expect, it, jest } from '@jest/globals';

const { AgentRunner } = await import('../AgentRunner.mjs');

function createRunner(externalToolExecutor = null) {
  return new AgentRunner({
    vfs: {},
    voluntaryMem: { add: async () => 'mem-1', associate: async () => [] },
    involuntaryMem: { add: () => {}, associate: async () => [] },
    persona: 'test persona',
    options: { externalToolExecutor },
  });
}

describe('AgentRunner external tool execution', () => {
  it('supports executors exposing executeTool()', async () => {
    const executeTool = jest.fn(async (toolCall) => ({
      content: `ok:${toolCall.function.name}:${toolCall.function.arguments}`,
    }));
    const runner = createRunner({ executeTool });

    const result = await runner._executeExternalTool('read_file', { path: 'src/app.mjs' });

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool.mock.calls[0][0]).toMatchObject({
      function: {
        name: 'read_file',
        arguments: JSON.stringify({ path: 'src/app.mjs' }),
      },
    });
    expect(result).toEqual({ result: `ok:read_file:${JSON.stringify({ path: 'src/app.mjs' })}` });
  });

  it('returns a clear error when the external executor exposes neither execute nor executeTool', async () => {
    const runner = createRunner({});

    const result = await runner._executeExternalTool('read_file', { path: 'src/app.mjs' });

    expect(result).toEqual({
      error: 'External tool executor does not implement execute() or executeTool()',
    });
  });
});