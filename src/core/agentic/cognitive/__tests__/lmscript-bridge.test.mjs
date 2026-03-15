/**
 * Unit tests for the four lmscript bridge components:
 *   1. AiManLLMProvider  (lmscript-provider.mjs)
 *   2. ToolBridge         (tool-bridge.mjs)
 *   3. EventBusTransport  (eventbus-transport.mjs)
 *   4. CognitiveMiddleware (cognitive-middleware.mjs)
 *
 * @module src/core/agentic/cognitive/__tests__/lmscript-bridge.test
 */

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { EventEmitter } from 'events';
import { z } from 'zod';

// ════════════════════════════════════════════════════════════════════════
// Mocks — must be declared before dynamic imports
// ════════════════════════════════════════════════════════════════════════

jest.unstable_mockModule('../../../ai-provider/index.mjs', () => ({
  callProvider: jest.fn(),
}));

const mockCircuitBreakerInstance = {
  isAllowed: jest.fn().mockReturnValue(true),
  recordSuccess: jest.fn(),
  recordFailure: jest.fn(),
  getState: jest.fn().mockReturnValue('closed'),
};

jest.unstable_mockModule('@sschepis/lmscript', () => ({
  CircuitBreaker: jest.fn().mockImplementation(() => mockCircuitBreakerInstance),
}));

// ── Dynamic imports (after mocks) ────────────────────────────────────
const { callProvider } = await import('../../../ai-provider/index.mjs');
const { CircuitBreaker } = await import('@sschepis/lmscript');
const { AiManLLMProvider } = await import('../lmscript-provider.mjs');
const { ToolBridge } = await import('../tool-bridge.mjs');
const { EventBusTransport, createEventBusTransport } = await import('../eventbus-transport.mjs');
const { CognitiveMiddleware, createCognitiveMiddleware } = await import('../cognitive-middleware.mjs');

// ════════════════════════════════════════════════════════════════════════
// 1. AiManLLMProvider
// ════════════════════════════════════════════════════════════════════════

describe('AiManLLMProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCircuitBreakerInstance.isAllowed.mockReturnValue(true);
    mockCircuitBreakerInstance.getState.mockReturnValue('closed');
  });

  test('constructor sets name and default model', () => {
    const provider = new AiManLLMProvider({ model: 'gpt-4o' });
    expect(provider.name).toBe('ai-man');
    expect(provider._model).toBe('gpt-4o');
  });

  test('chat() maps LLMRequest to callProvider format', async () => {
    callProvider.mockResolvedValue({
      choices: [{ message: { content: 'hello' } }],
    });

    const provider = new AiManLLMProvider({ model: 'gpt-4o' });
    await provider.chat({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'gpt-4o-mini',
      temperature: 0.7,
      maxTokens: 500,
    });

    expect(callProvider).toHaveBeenCalledTimes(1);
    const [requestBody] = callProvider.mock.calls[0];
    expect(requestBody.model).toBe('gpt-4o-mini');
    expect(requestBody.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(requestBody.temperature).toBe(0.7);
    expect(requestBody.max_tokens).toBe(500);
  });

  test('chat() maps tool format correctly', async () => {
    callProvider.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
    });

    const provider = new AiManLLMProvider();
    await provider.chat({
      messages: [{ role: 'user', content: 'use tool' }],
      tools: [
        {
          name: 'read_file',
          description: 'Reads a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ],
    });

    const [requestBody] = callProvider.mock.calls[0];
    expect(requestBody.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Reads a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      },
    ]);
  });

  test('chat() maps response to LLMResponse format', async () => {
    callProvider.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'result text',
            tool_calls: [
              {
                id: 'tc1',
                function: {
                  name: 'read_file',
                  arguments: { path: '/tmp/x' },
                },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    });

    const provider = new AiManLLMProvider();
    const response = await provider.chat({
      messages: [{ role: 'user', content: 'go' }],
    });

    expect(response.content).toBe('result text');
    expect(response.toolCalls).toEqual([
      { id: 'tc1', name: 'read_file', arguments: '{"path":"/tmp/x"}' },
    ]);
    expect(response.usage).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
  });

  test('chat() preserves JSON string tool arguments', async () => {
    callProvider.mockResolvedValue({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [
              {
                id: 'tc2',
                function: {
                  name: 'write_file',
                  arguments: '{"path":"/tmp/y","content":"hello"}',
                },
              },
            ],
          },
        },
      ],
    });

    const provider = new AiManLLMProvider();
    const response = await provider.chat({
      messages: [{ role: 'user', content: 'write' }],
    });

    // arguments should remain as a JSON string per lmscript LLMResponse interface
    expect(response.toolCalls[0].arguments).toBe('{"path":"/tmp/y","content":"hello"}');
  });

  test('chat() uses circuit breaker when configured', async () => {
    callProvider.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
    });

    const provider = new AiManLLMProvider({
      circuitBreakerConfig: { maxFailures: 3, resetTimeoutMs: 5000 },
    });

    await provider.chat({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(CircuitBreaker).toHaveBeenCalledWith({
      failureThreshold: 3,
      resetTimeout: 5000,
      successThreshold: undefined,
    });
    expect(mockCircuitBreakerInstance.isAllowed).toHaveBeenCalled();
    expect(mockCircuitBreakerInstance.recordSuccess).toHaveBeenCalled();
  });

  test('chat() wraps errors with descriptive message', async () => {
    callProvider.mockRejectedValue(new Error('network failure'));

    const provider = new AiManLLMProvider({ model: 'gpt-4o' });
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow('AiManLLMProvider: callProvider failed for model "gpt-4o"');
  });

  test('getCircuitState() returns breaker state or closed', () => {
    const withoutBreaker = new AiManLLMProvider();
    expect(withoutBreaker.getCircuitState()).toBe('closed');

    const withBreaker = new AiManLLMProvider({
      circuitBreakerConfig: { maxFailures: 3 },
    });
    mockCircuitBreakerInstance.getState.mockReturnValue('open');
    expect(withBreaker.getCircuitState()).toBe('open');
  });
});

// ════════════════════════════════════════════════════════════════════════
// 2. ToolBridge
// ════════════════════════════════════════════════════════════════════════

describe('ToolBridge', () => {
  /** @type {{ getAllToolDefinitions: jest.Mock, executeTool: jest.Mock }} */
  let mockToolExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    mockToolExecutor = {
      getAllToolDefinitions: jest.fn().mockReturnValue([
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Reads a file from disk',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path' },
              },
              required: ['path'],
            },
          },
        },
      ]),
      executeTool: jest.fn().mockResolvedValue({
        role: 'tool',
        tool_call_id: 'tc1',
        name: 'read_file',
        content: 'file contents here',
      }),
    };
  });

  test('toLmscriptTools() converts OpenAI format to lmscript ToolDefinition', () => {
    const bridge = new ToolBridge(mockToolExecutor);
    const tools = bridge.toLmscriptTools();

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('read_file');
    expect(tools[0].description).toBe('Reads a file from disk');
    expect(tools[0].parameters).toBeDefined();
    expect(typeof tools[0].execute).toBe('function');
  });

  test('toLmscriptTools() creates working execute functions', async () => {
    const bridge = new ToolBridge(mockToolExecutor, { workingDir: '/tmp' });
    const tools = bridge.toLmscriptTools();

    const result = await tools[0].execute({ path: '/tmp/test.txt' });

    expect(result).toBe('file contents here');
    expect(mockToolExecutor.executeTool).toHaveBeenCalledTimes(1);
    const [toolCall, context] = mockToolExecutor.executeTool.mock.calls[0];
    expect(toolCall.function.name).toBe('read_file');
    expect(JSON.parse(toolCall.function.arguments)).toEqual({ path: '/tmp/test.txt' });
    expect(context).toEqual({ workingDir: '/tmp' });
  });

  test('execute wrapper handles tool errors', async () => {
    mockToolExecutor.executeTool.mockResolvedValue({
      content: 'Error: file not found',
    });

    const bridge = new ToolBridge(mockToolExecutor);
    const tools = bridge.toLmscriptTools();

    await expect(tools[0].execute({ path: '/missing' })).rejects.toThrow(
      'ToolBridge: execution of "read_file" failed'
    );
  });

  test('jsonSchemaToZod() handles object with required/optional', () => {
    const schema = ToolBridge.jsonSchemaToZod({
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name' },
        age: { type: 'number' },
      },
      required: ['name'],
    });

    // name is required → should fail without it
    const parseWithName = schema.safeParse({ name: 'Alice' });
    expect(parseWithName.success).toBe(true);

    const parseWithoutName = schema.safeParse({ age: 30 });
    expect(parseWithoutName.success).toBe(false);

    // age is optional → should pass without it
    const parseWithBoth = schema.safeParse({ name: 'Alice', age: 30 });
    expect(parseWithBoth.success).toBe(true);
  });

  test('jsonSchemaToZod() handles string with enum', () => {
    const schema = ToolBridge.jsonSchemaToZod({
      type: 'string',
      enum: ['red', 'green', 'blue'],
    });

    expect(schema.safeParse('red').success).toBe(true);
    expect(schema.safeParse('yellow').success).toBe(false);
  });

  test('jsonSchemaToZod() handles array type', () => {
    const schema = ToolBridge.jsonSchemaToZod({
      type: 'array',
      items: { type: 'string' },
    });

    expect(schema.safeParse(['a', 'b']).success).toBe(true);
    expect(schema.safeParse('not-array').success).toBe(false);
  });

  test('jsonSchemaToZod() handles empty/missing schema', () => {
    const emptySchema = ToolBridge.jsonSchemaToZod({});
    expect(emptySchema.safeParse({ anything: true }).success).toBe(true);

    const nullSchema = ToolBridge.jsonSchemaToZod(null);
    expect(nullSchema.safeParse({}).success).toBe(true);
  });

  test('jsonSchemaToZod() handles union types', () => {
    const schema = ToolBridge.jsonSchemaToZod({
      type: ['string', 'null'],
    });

    expect(schema.safeParse('hello').success).toBe(true);
    expect(schema.safeParse(null).success).toBe(true);
    expect(schema.safeParse(42).success).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 3. EventBusTransport
// ════════════════════════════════════════════════════════════════════════

describe('EventBusTransport', () => {
  /** @type {EventEmitter} */
  let eventBus;

  beforeEach(() => {
    eventBus = new EventEmitter();
  });

  test('write() emits namespaced event', () => {
    const transport = new EventBusTransport(eventBus);
    const handler = jest.fn();
    eventBus.on('lmscript:info', handler);

    transport.write({
      level: 'info',
      message: 'test message',
      timestamp: new Date(),
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'info', message: 'test message' })
    );
  });

  test('write() filters below minLevel', () => {
    const transport = new EventBusTransport(eventBus, { minLevel: 'warn' });
    const infoHandler = jest.fn();
    const warnHandler = jest.fn();
    eventBus.on('lmscript:info', infoHandler);
    eventBus.on('lmscript:warn', warnHandler);

    transport.write({ level: 'info', message: 'should be filtered', timestamp: new Date() });
    transport.write({ level: 'warn', message: 'should pass', timestamp: new Date() });

    expect(infoHandler).not.toHaveBeenCalled();
    expect(warnHandler).toHaveBeenCalledTimes(1);
  });

  test('write() emits status event when emitStatus=true', () => {
    const transport = new EventBusTransport(eventBus, { emitStatus: true });
    const handler = jest.fn();
    eventBus.on('status', handler);

    transport.write({ level: 'info', message: 'status msg', timestamp: new Date() });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'info',
        message: 'status msg',
        data: expect.objectContaining({ source: 'lmscript' }),
      })
    );
  });

  test('write() maps warn level to warning status type', () => {
    const transport = new EventBusTransport(eventBus);
    const handler = jest.fn();
    eventBus.on('status', handler);

    transport.write({ level: 'warn', message: 'warning!', timestamp: new Date() });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'warning' })
    );
  });

  test('write() emits span event when spanId present', () => {
    const transport = new EventBusTransport(eventBus);
    const spanHandler = jest.fn();
    eventBus.on('lmscript:span', spanHandler);

    transport.write({
      level: 'info',
      message: 'span msg',
      timestamp: new Date(),
      spanId: 'span-123',
      parentSpanId: 'span-parent',
    });

    expect(spanHandler).toHaveBeenCalledTimes(1);
    expect(spanHandler).toHaveBeenCalledWith({
      spanId: 'span-123',
      parentSpanId: 'span-parent',
      level: 'info',
      message: 'span msg',
    });
  });

  test('write() respects custom prefix', () => {
    const transport = new EventBusTransport(eventBus, { prefix: 'cognitive' });
    const handler = jest.fn();
    eventBus.on('cognitive:error', handler);

    transport.write({ level: 'error', message: 'boom', timestamp: new Date() });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('createEventBusTransport() returns working instance', () => {
    const transport = createEventBusTransport(eventBus, { minLevel: 'warn' });
    expect(transport).toBeInstanceOf(EventBusTransport);

    const handler = jest.fn();
    eventBus.on('lmscript:error', handler);
    transport.write({ level: 'error', message: 'err', timestamp: new Date() });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 4. CognitiveMiddleware
// ════════════════════════════════════════════════════════════════════════

describe('CognitiveMiddleware', () => {
  /** @type {ReturnType<typeof createMockCognitive>} */
  let mockCognitive;

  function createMockCognitive() {
    return {
      processInput: jest.fn().mockResolvedValue({ enriched: true }),
      checkSafety: jest.fn().mockReturnValue([]),
      recall: jest.fn().mockResolvedValue([]),
      validateOutput: jest.fn().mockReturnValue({ valid: true, passed: true }),
      remember: jest.fn().mockResolvedValue(undefined),
      tick: jest.fn(),
      getStateContext: jest.fn().mockReturnValue('cognitive state string'),
      getDiagnostics: jest.fn().mockReturnValue({ healthy: true }),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockCognitive = createMockCognitive();
  });

  test('toHooks() returns object with all hook names', () => {
    const mw = new CognitiveMiddleware(mockCognitive);
    const hooks = mw.toHooks();

    expect(typeof hooks.onBeforeExecute).toBe('function');
    expect(typeof hooks.onAfterValidation).toBe('function');
    expect(typeof hooks.onRetry).toBe('function');
    expect(typeof hooks.onError).toBe('function');
    expect(typeof hooks.onComplete).toBe('function');
  });

  test('onBeforeExecute enriches context with cognitive state', async () => {
    const mw = new CognitiveMiddleware(mockCognitive);
    const hooks = mw.toHooks();

    const ctx = {
      input: 'hello world',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'hello world' },
      ],
      attempt: 1,
    };

    await hooks.onBeforeExecute(ctx);

    expect(mockCognitive.processInput).toHaveBeenCalledWith('hello world');
    expect(mockCognitive.checkSafety).toHaveBeenCalled();
    expect(mockCognitive.recall).toHaveBeenCalled();
    expect(mockCognitive.getStateContext).toHaveBeenCalled();

    // System message should have been enriched with cognitive state
    expect(ctx.messages[0].content).toContain('cognitive state string');
  });

  test('onBeforeExecute blocks unsafe input (default handler)', async () => {
    mockCognitive.checkSafety.mockReturnValue([
      { name: 'harmful_content', reason: 'Detected harmful content' },
    ]);

    const mw = new CognitiveMiddleware(mockCognitive);
    const hooks = mw.toHooks();

    const ctx = {
      input: 'do something unsafe',
      messages: [{ role: 'user', content: 'do something unsafe' }],
      attempt: 1,
    };

    await expect(hooks.onBeforeExecute(ctx)).rejects.toThrow('Safety violation');
  });

  test('onBeforeExecute uses custom safety violation handler', async () => {
    mockCognitive.checkSafety.mockReturnValue([
      { name: 'mild_concern' },
    ]);

    const customHandler = jest.fn().mockReturnValue('sanitized input');

    const mw = new CognitiveMiddleware(mockCognitive, {
      onSafetyViolation: customHandler,
    });
    const hooks = mw.toHooks();

    const ctx = {
      input: 'borderline input',
      messages: [
        { role: 'system', content: 'System prompt.' },
        { role: 'user', content: 'borderline input' },
      ],
      attempt: 1,
    };

    await hooks.onBeforeExecute(ctx);

    expect(customHandler).toHaveBeenCalledWith(
      'borderline input',
      [{ name: 'mild_concern' }]
    );
    // The last user message should be updated to the sanitized input
    expect(ctx.messages[1].content).toBe('sanitized input');
  });

  test('onAfterValidation calls validateOutput', async () => {
    const mw = new CognitiveMiddleware(mockCognitive);
    const hooks = mw.toHooks();

    // First run onBeforeExecute to populate _contextData
    const ctx = {
      input: 'test input',
      messages: [{ role: 'user', content: 'test input' }],
      attempt: 1,
    };
    await hooks.onBeforeExecute(ctx);

    // Now call onAfterValidation
    await hooks.onAfterValidation(ctx, 'LLM output text');

    expect(mockCognitive.validateOutput).toHaveBeenCalledWith(
      'LLM output text',
      expect.objectContaining({ input: 'test input' })
    );
  });

  test('onComplete calls remember and tick', async () => {
    const mw = new CognitiveMiddleware(mockCognitive);
    const hooks = mw.toHooks();

    const ctx = {
      input: 'remember this',
      messages: [{ role: 'user', content: 'remember this' }],
      attempt: 1,
    };
    await hooks.onBeforeExecute(ctx);

    const result = { data: 'output text', attempts: 1 };
    await hooks.onComplete(ctx, result);

    expect(mockCognitive.remember).toHaveBeenCalledWith('remember this', 'output text');
    expect(mockCognitive.tick).toHaveBeenCalled();
  });

  test('onError attaches diagnostics', async () => {
    mockCognitive.getDiagnostics.mockReturnValue({ healthy: false, coherence: 0.3 });

    const mw = new CognitiveMiddleware(mockCognitive);
    const hooks = mw.toHooks();

    const ctx = {
      input: 'failing request',
      messages: [{ role: 'user', content: 'failing request' }],
      attempt: 1,
    };

    const error = new Error('LLM failed');
    await hooks.onError(ctx, error);

    expect(error.cognitiveDiagnostics).toEqual({ healthy: false, coherence: 0.3 });
    expect(mockCognitive.tick).toHaveBeenCalled();
  });

  test('hooks degrade gracefully when cognitive ops fail', async () => {
    // Make all cognitive operations throw
    mockCognitive.processInput.mockImplementation(() => { throw new Error('processInput boom'); });
    mockCognitive.checkSafety.mockImplementation(() => { throw new Error('checkSafety boom'); });
    mockCognitive.recall.mockImplementation(() => { throw new Error('recall boom'); });
    mockCognitive.getStateContext.mockImplementation(() => { throw new Error('getStateContext boom'); });
    mockCognitive.validateOutput.mockImplementation(() => { throw new Error('validateOutput boom'); });
    mockCognitive.remember.mockImplementation(() => { throw new Error('remember boom'); });
    mockCognitive.tick.mockImplementation(() => { throw new Error('tick boom'); });
    mockCognitive.getDiagnostics.mockImplementation(() => { throw new Error('getDiagnostics boom'); });

    const mw = new CognitiveMiddleware(mockCognitive);
    const hooks = mw.toHooks();

    const ctx = {
      input: 'test',
      messages: [{ role: 'user', content: 'test' }],
      attempt: 1,
    };

    // onBeforeExecute should not throw (checkSafety error is non-safety so caught)
    await expect(hooks.onBeforeExecute(ctx)).resolves.toBeUndefined();

    // Populate _contextData manually for the validation test since
    // onBeforeExecute above didn't store due to processInput failing,
    // but it still stores inputText
    await expect(hooks.onAfterValidation(ctx, 'output')).resolves.toBeUndefined();

    await expect(hooks.onComplete(ctx, { data: 'out' })).resolves.toBeUndefined();

    const error = new Error('test error');
    await expect(hooks.onError(ctx, error)).resolves.toBeUndefined();
  });

  test('createCognitiveMiddleware factory works', () => {
    const mw = createCognitiveMiddleware(mockCognitive, { enableGuard: false });
    expect(mw).toBeInstanceOf(CognitiveMiddleware);
    expect(mw.enableGuard).toBe(false);
  });
});
