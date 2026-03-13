/**
 * Tests for chain-parser.mjs — Chain/pipe parsing and execution
 */

import { jest } from '@jest/globals';
import { parseChain, parseCommand, tokenize, executeChain } from '../chain-parser.mjs';

// ─── parseChain ─────────────────────────────────────────────────────────

describe('parseChain()', () => {
    test('parses single command', () => {
        const result = parseChain('cat file.txt');
        expect(result).toEqual([
            { command: 'cat file.txt', operator: null },
        ]);
    });

    test('parses pipe operator', () => {
        const result = parseChain('cat log.txt | grep ERROR | wc -l');
        expect(result).toEqual([
            { command: 'cat log.txt', operator: null },
            { command: 'grep ERROR', operator: '|' },
            { command: 'wc -l', operator: '|' },
        ]);
    });

    test('parses && operator', () => {
        const result = parseChain('exec npm test && echo "passed"');
        expect(result).toEqual([
            { command: 'exec npm test', operator: null },
            { command: 'echo "passed"', operator: '&&' },
        ]);
    });

    test('parses || operator', () => {
        const result = parseChain('cat config.yml || echo "not found"');
        expect(result).toEqual([
            { command: 'cat config.yml', operator: null },
            { command: 'echo "not found"', operator: '||' },
        ]);
    });

    test('parses ; operator', () => {
        const result = parseChain('skill list ; memory query "recent"');
        expect(result).toEqual([
            { command: 'skill list', operator: null },
            { command: 'memory query "recent"', operator: ';' },
        ]);
    });

    test('parses mixed operators', () => {
        const result = parseChain('cat file.txt | grep ERROR && echo "found" || echo "clean"');
        expect(result).toEqual([
            { command: 'cat file.txt', operator: null },
            { command: 'grep ERROR', operator: '|' },
            { command: 'echo "found"', operator: '&&' },
            { command: 'echo "clean"', operator: '||' },
        ]);
    });

    test('preserves quoted strings with operators inside', () => {
        const result = parseChain('echo "hello | world && test"');
        expect(result).toEqual([
            { command: 'echo "hello | world && test"', operator: null },
        ]);
    });

    test('preserves single-quoted strings', () => {
        const result = parseChain("grep 'hello || world' file.txt");
        expect(result).toEqual([
            { command: "grep 'hello || world' file.txt", operator: null },
        ]);
    });

    test('handles escaped operators', () => {
        const result = parseChain('echo hello \\| world');
        expect(result).toEqual([
            { command: 'echo hello | world', operator: null },
        ]);
    });

    test('handles empty input', () => {
        expect(parseChain('')).toEqual([]);
        expect(parseChain(null)).toEqual([]);
        expect(parseChain(undefined)).toEqual([]);
    });

    test('trims whitespace from commands', () => {
        const result = parseChain('  cat file.txt  |  grep hello  ');
        expect(result).toEqual([
            { command: 'cat file.txt', operator: null },
            { command: 'grep hello', operator: '|' },
        ]);
    });

    test('ignores empty segments', () => {
        const result = parseChain('cat file.txt | | grep hello');
        // The empty segment between | | should be skipped
        expect(result).toEqual([
            { command: 'cat file.txt', operator: null },
            { command: 'grep hello', operator: '|' },
        ]);
    });
});

// ─── parseCommand ───────────────────────────────────────────────────────

describe('parseCommand()', () => {
    test('parses command name and arguments', () => {
        const result = parseCommand('grep ERROR file.txt');
        expect(result).toEqual({ name: 'grep', args: ['ERROR', 'file.txt'] });
    });

    test('parses command with no arguments', () => {
        const result = parseCommand('help');
        expect(result).toEqual({ name: 'help', args: [] });
    });

    test('parses command with quoted arguments', () => {
        const result = parseCommand('grep "hello world" file.txt');
        expect(result).toEqual({ name: 'grep', args: ['hello world', 'file.txt'] });
    });

    test('parses command with single-quoted arguments', () => {
        const result = parseCommand("grep 'foo bar' file.txt");
        expect(result).toEqual({ name: 'grep', args: ['foo bar', 'file.txt'] });
    });

    test('handles empty/null input', () => {
        expect(parseCommand('')).toEqual({ name: '', args: [] });
        expect(parseCommand(null)).toEqual({ name: '', args: [] });
        expect(parseCommand(undefined)).toEqual({ name: '', args: [] });
    });
});

// ─── tokenize ───────────────────────────────────────────────────────────

describe('tokenize()', () => {
    test('splits on whitespace', () => {
        expect(tokenize('a b c')).toEqual(['a', 'b', 'c']);
    });

    test('preserves quoted content', () => {
        expect(tokenize('"hello world" test')).toEqual(['hello world', 'test']);
    });

    test('handles escaped characters in quotes', () => {
        expect(tokenize('"hello \\"world\\""')).toEqual(['hello "world"']);
    });

    test('handles mixed quotes', () => {
        expect(tokenize('cmd "arg 1" \'arg 2\' arg3')).toEqual(['cmd', 'arg 1', 'arg 2', 'arg3']);
    });

    test('handles tabs', () => {
        expect(tokenize('a\tb\tc')).toEqual(['a', 'b', 'c']);
    });

    test('handles empty input', () => {
        expect(tokenize('')).toEqual([]);
    });
});

// ─── executeChain ───────────────────────────────────────────────────────

describe('executeChain()', () => {
    test('executes single command', async () => {
        const executor = jest.fn().mockResolvedValue({ output: 'hello', exitCode: 0 });
        const chain = [{ command: 'echo hello', operator: null }];

        const result = await executeChain(chain, executor);

        expect(result).toEqual({ output: 'hello', exitCode: 0 });
        expect(executor).toHaveBeenCalledWith('echo hello', undefined);
    });

    test('pipes stdout to next command stdin', async () => {
        const executor = jest.fn()
            .mockResolvedValueOnce({ output: 'line1\nline2\nline3', exitCode: 0 })
            .mockResolvedValueOnce({ output: '3', exitCode: 0 });

        const chain = [
            { command: 'cat file.txt', operator: null },
            { command: 'wc -l', operator: '|' },
        ];

        const result = await executeChain(chain, executor);

        expect(result).toEqual({ output: '3', exitCode: 0 });
        expect(executor).toHaveBeenCalledTimes(2);
        expect(executor).toHaveBeenNthCalledWith(1, 'cat file.txt', undefined);
        expect(executor).toHaveBeenNthCalledWith(2, 'wc -l', 'line1\nline2\nline3');
    });

    test('&& skips next on failure', async () => {
        const executor = jest.fn()
            .mockResolvedValueOnce({ output: 'error', exitCode: 1 })
            .mockResolvedValueOnce({ output: 'should not run', exitCode: 0 });

        const chain = [
            { command: 'exec test', operator: null },
            { command: 'echo passed', operator: '&&' },
        ];

        const result = await executeChain(chain, executor);

        expect(result.exitCode).toBe(1);
        expect(executor).toHaveBeenCalledTimes(1); // Second command skipped
    });

    test('&& runs next on success', async () => {
        const executor = jest.fn()
            .mockResolvedValueOnce({ output: 'ok', exitCode: 0 })
            .mockResolvedValueOnce({ output: 'passed', exitCode: 0 });

        const chain = [
            { command: 'exec test', operator: null },
            { command: 'echo passed', operator: '&&' },
        ];

        const result = await executeChain(chain, executor);

        expect(result).toEqual({ output: 'passed', exitCode: 0 });
        expect(executor).toHaveBeenCalledTimes(2);
    });

    test('|| runs next on failure', async () => {
        const executor = jest.fn()
            .mockResolvedValueOnce({ output: '', exitCode: 1 })
            .mockResolvedValueOnce({ output: 'fallback', exitCode: 0 });

        const chain = [
            { command: 'cat missing.txt', operator: null },
            { command: 'echo fallback', operator: '||' },
        ];

        const result = await executeChain(chain, executor);

        expect(result).toEqual({ output: 'fallback', exitCode: 0 });
        expect(executor).toHaveBeenCalledTimes(2);
    });

    test('|| skips next on success', async () => {
        const executor = jest.fn()
            .mockResolvedValueOnce({ output: 'ok', exitCode: 0 })
            .mockResolvedValueOnce({ output: 'should not run', exitCode: 0 });

        const chain = [
            { command: 'cat file.txt', operator: null },
            { command: 'echo fallback', operator: '||' },
        ];

        const result = await executeChain(chain, executor);

        expect(result).toEqual({ output: 'ok', exitCode: 0 });
        expect(executor).toHaveBeenCalledTimes(1);
    });

    test('; runs next regardless', async () => {
        const executor = jest.fn()
            .mockResolvedValueOnce({ output: 'first', exitCode: 1 })
            .mockResolvedValueOnce({ output: 'second', exitCode: 0 });

        const chain = [
            { command: 'cmd1', operator: null },
            { command: 'cmd2', operator: ';' },
        ];

        const result = await executeChain(chain, executor);

        expect(result).toEqual({ output: 'second', exitCode: 0 });
        expect(executor).toHaveBeenCalledTimes(2);
    });

    test('handles executor errors gracefully', async () => {
        const executor = jest.fn().mockRejectedValue(new Error('network failure'));

        const chain = [{ command: 'broken', operator: null }];

        const result = await executeChain(chain, executor);

        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('network failure');
    });

    test('handles empty chain', async () => {
        const executor = jest.fn();

        const result = await executeChain([], executor);

        expect(result).toEqual({ output: '', exitCode: 1 });
        expect(executor).not.toHaveBeenCalled();
    });

    test('three-stage pipe', async () => {
        const executor = jest.fn()
            .mockResolvedValueOnce({ output: 'ERROR: foo\nINFO: bar\nERROR: baz', exitCode: 0 })
            .mockResolvedValueOnce({ output: 'ERROR: foo\nERROR: baz', exitCode: 0 })
            .mockResolvedValueOnce({ output: '2', exitCode: 0 });

        const chain = [
            { command: 'cat log.txt', operator: null },
            { command: 'grep ERROR', operator: '|' },
            { command: 'wc -l', operator: '|' },
        ];

        const result = await executeChain(chain, executor);

        expect(result).toEqual({ output: '2', exitCode: 0 });
        expect(executor).toHaveBeenCalledTimes(3);
        // Second call should receive first's output as stdin
        expect(executor).toHaveBeenNthCalledWith(2, 'grep ERROR', 'ERROR: foo\nINFO: bar\nERROR: baz');
        // Third call should receive second's output as stdin
        expect(executor).toHaveBeenNthCalledWith(3, 'wc -l', 'ERROR: foo\nERROR: baz');
    });
});
