/**
 * Tests for DirectActionExecutor
 * Covers: registration, execution, SSRF validation, tool allowlisting, pipelines
 */

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { DirectActionExecutor } from '../direct-action-executor.mjs';

// ─── Mock ToolExecutor ───────────────────────────────────────────────────

function createMockToolExecutor(resultContent = 'mock-result') {
    return {
        surfaceManager: { getSurface: jest.fn() },
        executeTool: jest.fn().mockResolvedValue({ content: resultContent }),
        isPluginSurfaceSafe: jest.fn().mockReturnValue(false),
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function createExecutor(overrides = {}) {
    return new DirectActionExecutor({
        toolExecutor: createMockToolExecutor(),
        ...overrides,
    });
}

// ─── Registration Tests ─────────────────────────────────────────────────

describe('DirectActionExecutor — Registration', () => {
    test('registers and lists global actions', () => {
        const exec = createExecutor();
        exec.register('myAction', { type: 'tool', toolName: 'read_file', description: 'Test' });
        const actions = exec.listActions();
        const found = actions.find(a => a.name === 'myAction');
        expect(found).toBeDefined();
        expect(found.type).toBe('tool');
        expect(found.scope).toBe('global');
    });

    test('registers and lists surface-scoped actions', () => {
        const exec = createExecutor();
        exec.registerForSurface('surf-1', 'scopedAction', { type: 'fetch', url: 'https://example.com', description: 'Scoped' });
        
        // Not visible without surfaceId
        const globalActions = exec.listActions();
        expect(globalActions.find(a => a.name === 'scopedAction')).toBeUndefined();
        
        // Visible with surfaceId
        const surfaceActions = exec.listActions('surf-1');
        const found = surfaceActions.find(a => a.name === 'scopedAction');
        expect(found).toBeDefined();
        expect(found.scope).toBe('surface');
    });

    test('unregisterForSurface removes the action', () => {
        const exec = createExecutor();
        exec.registerForSurface('surf-1', 'tempAction', { type: 'tool', toolName: 'list_files' });
        exec.unregisterForSurface('surf-1', 'tempAction');
        const actions = exec.listActions('surf-1');
        expect(actions.find(a => a.name === 'tempAction')).toBeUndefined();
    });

    test('cleanupSurface removes all actions for a surface', () => {
        const exec = createExecutor();
        exec.registerForSurface('surf-1', 'a1', { type: 'tool', toolName: 'read_file' });
        exec.registerForSurface('surf-1', 'a2', { type: 'tool', toolName: 'list_files' });
        exec.cleanupSurface('surf-1');
        const actions = exec.listActions('surf-1');
        expect(actions.filter(a => a.scope === 'surface')).toHaveLength(0);
    });

    test('rejects invalid definition types', () => {
        const exec = createExecutor();
        expect(() => exec.register('bad', { type: 'invalid' })).toThrow('invalid type');
    });

    test('rejects empty action name', () => {
        const exec = createExecutor();
        expect(() => exec.register('', { type: 'tool', toolName: 'read_file' })).toThrow('non-empty string');
    });
});

// ─── Built-in Actions ───────────────────────────────────────────────────

describe('DirectActionExecutor — Built-in Actions', () => {
    test('has built-in actions registered', () => {
        const exec = createExecutor();
        const actions = exec.listActions();
        const names = actions.map(a => a.name);
        expect(names).toContain('readAndParseJson');
        expect(names).toContain('readAndParseMarkdownTable');
        expect(names).toContain('listWorkspaceFiles');
        expect(names).toContain('httpGet');
        expect(names).toContain('httpPost');
        expect(names).toContain('searchFiles');
    });
});

// ─── Tool Execution ─────────────────────────────────────────────────────

describe('DirectActionExecutor — Tool Execution', () => {
    test('executes allowed tool via registered action', async () => {
        const toolExec = createMockToolExecutor('file-content-here');
        const exec = new DirectActionExecutor({ toolExecutor: toolExec });
        exec.register('readMyFile', { type: 'tool', toolName: 'read_file', args: { path: 'test.txt' } });

        const result = await exec.execute('readMyFile', {});
        expect(result.success).toBe(true);
        expect(result.data).toBe('file-content-here');
        expect(toolExec.executeTool).toHaveBeenCalledWith(
            expect.objectContaining({
                function: expect.objectContaining({
                    name: 'read_file',
                }),
            })
        );
    });

    test('rejects disallowed tool', async () => {
        const exec = createExecutor();
        exec.register('dangerous', { type: 'tool', toolName: 'execute_shell_command' });

        const result = await exec.execute('dangerous', {});
        expect(result.success).toBe(false);
        expect(result.error).toContain('not allowed');
    });

    test('merges definition args with runtime args', async () => {
        const toolExec = createMockToolExecutor('result');
        const exec = new DirectActionExecutor({ toolExecutor: toolExec });
        exec.register('myTool', { type: 'tool', toolName: 'read_file', args: { path: 'default.txt' } });

        await exec.execute('myTool', { path: 'override.txt' });
        const callArg = toolExec.executeTool.mock.calls[0][0];
        const parsedArgs = JSON.parse(callArg.function.arguments);
        expect(parsedArgs.path).toBe('override.txt'); // runtime overrides definition
    });

    test('returns error for unregistered action', async () => {
        const exec = createExecutor();
        const result = await exec.execute('nonexistent', {});
        expect(result.success).toBe(false);
        expect(result.error).toContain('not registered');
    });

    test('surface-scoped action takes priority over global', async () => {
        const toolExec = createMockToolExecutor('surface-result');
        const exec = new DirectActionExecutor({ toolExecutor: toolExec });
        
        exec.register('myAction', { type: 'tool', toolName: 'list_files' });
        exec.registerForSurface('surf-1', 'myAction', { type: 'tool', toolName: 'read_file', args: { path: 'surface.txt' } });

        await exec.execute('myAction', {}, 'surf-1');
        const callArg = toolExec.executeTool.mock.calls[0][0];
        expect(callArg.function.name).toBe('read_file'); // surface-scoped wins
    });
});

// ─── SSRF URL Validation ────────────────────────────────────────────────

describe('DirectActionExecutor — URL Validation (SSRF prevention)', () => {
    let exec;

    beforeEach(() => {
        exec = createExecutor();
    });

    // _validateUrl is async (performs DNS resolution), so all tests use async/await

    test('allows valid external HTTPS URL', async () => {
        await expect(exec._validateUrl('https://api.example.com/data')).resolves.not.toThrow();
    });

    test('allows valid external HTTP URL', async () => {
        await expect(exec._validateUrl('http://api.example.com/data')).resolves.not.toThrow();
    });

    test('blocks localhost', async () => {
        await expect(exec._validateUrl('http://localhost/secret')).rejects.toThrow('blocked');
    });

    test('blocks 127.0.0.1', async () => {
        await expect(exec._validateUrl('http://127.0.0.1/secret')).rejects.toThrow('blocked');
    });

    test('blocks 0.0.0.0', async () => {
        await expect(exec._validateUrl('http://0.0.0.0/api')).rejects.toThrow('blocked');
    });

    test('blocks private IP 10.x.x.x', async () => {
        await expect(exec._validateUrl('http://10.0.0.1/internal')).rejects.toThrow('blocked');
    });

    test('blocks private IP 192.168.x.x', async () => {
        await expect(exec._validateUrl('http://192.168.1.1/router')).rejects.toThrow('blocked');
    });

    test('blocks private IP 172.16-31.x.x', async () => {
        await expect(exec._validateUrl('http://172.16.0.1/internal')).rejects.toThrow('blocked');
        await expect(exec._validateUrl('http://172.31.255.255/internal')).rejects.toThrow('blocked');
    });

    test('blocks link-local 169.254.x.x', async () => {
        await expect(exec._validateUrl('http://169.254.169.254/metadata')).rejects.toThrow('blocked');
    });

    test('blocks IPv6 loopback [::1]', async () => {
        await expect(exec._validateUrl('http://[::1]/secret')).rejects.toThrow('blocked');
    });

    test('blocks IPv6 mapped IPv4 [::ffff:127.0.0.1]', async () => {
        await expect(exec._validateUrl('http://[::ffff:127.0.0.1]/secret')).rejects.toThrow('blocked');
    });

    test('blocks URLs with credentials (user@host bypass)', async () => {
        await expect(exec._validateUrl('http://evil@localhost/')).rejects.toThrow('blocked');
    });

    test('blocks non-http protocols (file:, ftp:, etc.)', async () => {
        await expect(exec._validateUrl('file:///etc/passwd')).rejects.toThrow('not allowed');
        await expect(exec._validateUrl('ftp://evil.com/file')).rejects.toThrow('not allowed');
    });

    test('blocks decimal IP notation for loopback (2130706433)', async () => {
        // Note: new URL('http://2130706433') may or may not resolve this depending on runtime.
        // Our blocklist includes '2130706433' in BLOCKED_HOSTNAMES for safety.
        await expect(exec._validateUrl('http://2130706433/')).rejects.toThrow('blocked');
    });

    test('rejects empty/invalid URLs', async () => {
        await expect(exec._validateUrl('')).rejects.toThrow('Invalid URL');
        await expect(exec._validateUrl(null)).rejects.toThrow('Invalid URL');
        await expect(exec._validateUrl('not-a-url')).rejects.toThrow('Invalid URL');
    });

    test('allows localhost when allowLocalFetch=true', async () => {
        const localExec = new DirectActionExecutor({
            toolExecutor: createMockToolExecutor(),
            allowLocalFetch: true,
        });
        await expect(localExec._validateUrl('http://localhost:3000/api')).resolves.not.toThrow();
    });

    test('enforces domain allowlist when configured', async () => {
        const restrictedExec = new DirectActionExecutor({
            toolExecutor: createMockToolExecutor(),
            allowedFetchDomains: new Set(['api.allowed.com']),
        });
        await expect(restrictedExec._validateUrl('https://api.allowed.com/data')).resolves.not.toThrow();
        await expect(restrictedExec._validateUrl('https://evil.com/data')).rejects.toThrow('not in fetch allowlist');
    });
});

// ─── Pipeline Execution ─────────────────────────────────────────────────

describe('DirectActionExecutor — Pipeline Execution', () => {
    test('executes a multi-step pipeline', async () => {
        const toolExec = createMockToolExecutor('step-result');
        const exec = new DirectActionExecutor({ toolExecutor: toolExec });
        
        exec.register('myPipeline', {
            type: 'pipeline',
            steps: [
                { type: 'tool', toolName: 'list_files', args: { recursive: true } },
                { type: 'tool', toolName: 'read_file', args: { path: 'package.json' } },
            ],
        });

        const result = await exec.execute('myPipeline', {});
        expect(result.success).toBe(true);
        expect(toolExec.executeTool).toHaveBeenCalledTimes(2);
    });

    test('pipeline continues on error when continueOnError is set', async () => {
        const toolExec = createMockToolExecutor('ok');
        toolExec.executeTool
            .mockRejectedValueOnce(new Error('step 1 failed'))
            .mockResolvedValueOnce({ content: 'step 2 ok' });

        const exec = new DirectActionExecutor({ toolExecutor: toolExec });
        exec.register('resilient', {
            type: 'pipeline',
            steps: [
                { type: 'tool', toolName: 'read_file', args: { path: 'missing.txt' }, continueOnError: true },
                { type: 'tool', toolName: 'list_files', args: {} },
            ],
        });

        const result = await exec.execute('resilient', {});
        expect(result.success).toBe(true);
        expect(result.data).toBe('step 2 ok');
    });

    test('pipeline fails if step fails without continueOnError', async () => {
        const toolExec = createMockToolExecutor('ok');
        toolExec.executeTool.mockRejectedValueOnce(new Error('fatal'));

        const exec = new DirectActionExecutor({ toolExecutor: toolExec });
        exec.register('fragile', {
            type: 'pipeline',
            steps: [
                { type: 'tool', toolName: 'read_file', args: { path: 'missing.txt' } },
                { type: 'tool', toolName: 'list_files', args: {} },
            ],
        });

        const result = await exec.execute('fragile', {});
        expect(result.success).toBe(false);
        expect(result.error).toContain('Pipeline failed');
    });
});

// ─── Function Execution ─────────────────────────────────────────────────

describe('DirectActionExecutor — Function Execution', () => {
    test('executes a function-type action', async () => {
        const exec = createExecutor();
        exec.register('myFunc', {
            type: 'function',
            execute: async (args) => ({ computed: args.x * 2 }),
        });

        const result = await exec.execute('myFunc', { x: 21 });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ computed: 42 });
    });

    test('fails if execute is not a function', async () => {
        const exec = createExecutor();
        exec.register('badFunc', {
            type: 'function',
            execute: 'not-a-function',
        });

        const result = await exec.execute('badFunc', {});
        expect(result.success).toBe(false);
        expect(result.error).toContain('missing execute function');
    });
});

// ─── searchFiles Built-in Hardening ─────────────────────────────────────

describe('DirectActionExecutor — searchFiles built-in', () => {
    test('rejects missing path argument', async () => {
        const exec = createExecutor();
        const result = await exec.execute('searchFiles', { pattern: 'foo' });
        expect(result.success).toBe(true); // action itself succeeds, returns error in data
        expect(result.data).toEqual([{ error: expect.stringContaining('path argument is required') }]);
    });

    test('rejects empty string path', async () => {
        const exec = createExecutor();
        const result = await exec.execute('searchFiles', { path: '', pattern: 'foo' });
        expect(result.data).toEqual([{ error: expect.stringContaining('path argument is required') }]);
    });

    test('rejects nested quantifier pattern (a+)+', async () => {
        const exec = createExecutor();
        const result = await exec.execute('searchFiles', { path: 'file.txt', pattern: '(a+)+' });
        expect(result.data).toEqual([{ error: expect.stringContaining('catastrophic backtracking') }]);
    });

    test('rejects nested quantifier pattern (\\w+)*', async () => {
        const exec = createExecutor();
        const result = await exec.execute('searchFiles', { path: 'file.txt', pattern: '(\\w+)*' });
        expect(result.data).toEqual([{ error: expect.stringContaining('catastrophic backtracking') }]);
    });

    test('accepts safe regex patterns', async () => {
        const toolExec = createMockToolExecutor('line1 foo\nline2 bar\nline3 foo');
        const exec = new DirectActionExecutor({ toolExecutor: toolExec });
        const result = await exec.execute('searchFiles', { path: 'test.txt', pattern: 'foo' });
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(2);
        expect(result.data[0].content).toBe('line1 foo');
    });

    test('rejects patterns exceeding 200 chars', async () => {
        const exec = createExecutor();
        const longPattern = 'a'.repeat(201);
        const result = await exec.execute('searchFiles', { path: 'file.txt', pattern: longPattern });
        expect(result.data).toEqual([{ error: expect.stringContaining('too long') }]);
    });
});
