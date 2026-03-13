/**
 * Chain Parser — Parse Unix-style command chains
 *
 * Supports four operators:
 *   |   Pipe:  stdout of previous command becomes stdin of next
 *   &&  And:   execute next only if previous succeeded (exit:0)
 *   ||  Or:    execute next only if previous failed (exit:!0)
 *   ;   Seq:   execute next regardless of previous result
 *
 * Handles:
 *   - Quoted strings (single, double, backtick) — operators inside quotes are literal
 *   - Escaped characters (\| \& etc.)
 *   - Nested quotes
 *
 * Example:
 *   parseChain('cat log.txt | grep ERROR | wc -l')
 *   → [
 *       { command: 'cat log.txt', operator: null },
 *       { command: 'grep ERROR',  operator: '|' },
 *       { command: 'wc -l',      operator: '|' },
 *     ]
 */

/**
 * @typedef {Object} ChainSegment
 * @property {string} command — the command string (trimmed)
 * @property {'|'|'&&'|'||'|';'|null} operator — operator preceding this segment (null for first)
 */

/**
 * Parse a command chain string into segments with operators.
 *
 * @param {string} input — the full command string
 * @returns {ChainSegment[]} — ordered list of command segments
 */
export function parseChain(input) {
    if (!input || typeof input !== 'string') {
        return [];
    }

    const segments = [];
    let current = '';
    let pendingOperator = null;
    let i = 0;
    const len = input.length;

    while (i < len) {
        const ch = input[i];

        // ── Escaped character ──
        if (ch === '\\' && i + 1 < len) {
            current += input[i + 1];
            i += 2;
            continue;
        }

        // ── Quoted strings ──
        if (ch === '"' || ch === "'" || ch === '`') {
            const quote = ch;
            current += ch;
            i++;
            while (i < len && input[i] !== quote) {
                if (input[i] === '\\' && i + 1 < len) {
                    current += input[i] + input[i + 1];
                    i += 2;
                } else {
                    current += input[i];
                    i++;
                }
            }
            if (i < len) {
                current += input[i]; // closing quote
                i++;
            }
            continue;
        }

        // ── Operators ──

        // && (must check before single &)
        if (ch === '&' && i + 1 < len && input[i + 1] === '&') {
            pushSegment(segments, current, pendingOperator);
            current = '';
            pendingOperator = '&&';
            i += 2;
            continue;
        }

        // || (must check before single |)
        if (ch === '|' && i + 1 < len && input[i + 1] === '|') {
            pushSegment(segments, current, pendingOperator);
            current = '';
            pendingOperator = '||';
            i += 2;
            continue;
        }

        // | (pipe — single |)
        if (ch === '|') {
            pushSegment(segments, current, pendingOperator);
            current = '';
            pendingOperator = '|';
            i++;
            continue;
        }

        // ; (sequence)
        if (ch === ';') {
            pushSegment(segments, current, pendingOperator);
            current = '';
            pendingOperator = ';';
            i++;
            continue;
        }

        // Regular character
        current += ch;
        i++;
    }

    // Push final segment
    pushSegment(segments, current, pendingOperator);

    return segments;
}

/**
 * Push a segment if the command is non-empty.
 * @param {ChainSegment[]} segments
 * @param {string} command
 * @param {string|null} operator
 */
function pushSegment(segments, command, operator) {
    const trimmed = command.trim();
    if (trimmed) {
        segments.push({ command: trimmed, operator });
    }
}

/**
 * Parse a command string into the command name and arguments.
 * Respects quoted strings.
 *
 * @param {string} commandStr — e.g. 'cat file.txt' or 'grep "hello world" -i'
 * @returns {{ name: string, args: string[] }}
 */
export function parseCommand(commandStr) {
    if (!commandStr || typeof commandStr !== 'string') {
        return { name: '', args: [] };
    }

    const tokens = tokenize(commandStr.trim());
    if (tokens.length === 0) {
        return { name: '', args: [] };
    }

    return {
        name: tokens[0],
        args: tokens.slice(1),
    };
}

/**
 * Tokenize a command string respecting quotes.
 *
 * @param {string} input
 * @returns {string[]}
 */
export function tokenize(input) {
    const tokens = [];
    let current = '';
    let i = 0;
    const len = input.length;

    while (i < len) {
        const ch = input[i];

        // Skip whitespace between tokens
        if (ch === ' ' || ch === '\t') {
            if (current) {
                tokens.push(current);
                current = '';
            }
            i++;
            continue;
        }

        // Quoted string — capture content without outer quotes
        if (ch === '"' || ch === "'" || ch === '`') {
            const quote = ch;
            i++;
            while (i < len && input[i] !== quote) {
                if (input[i] === '\\' && i + 1 < len) {
                    current += input[i + 1];
                    i += 2;
                } else {
                    current += input[i];
                    i++;
                }
            }
            if (i < len) i++; // skip closing quote
            continue;
        }

        // Escaped character
        if (ch === '\\' && i + 1 < len) {
            current += input[i + 1];
            i += 2;
            continue;
        }

        current += ch;
        i++;
    }

    if (current) {
        tokens.push(current);
    }

    return tokens;
}

/**
 * Execute a parsed chain against a command executor function.
 *
 * @param {ChainSegment[]} chain — parsed chain from parseChain()
 * @param {(command: string, stdin?: string) => Promise<{ output: string, exitCode: number }>} executor
 *   — function that executes a single command and returns { output, exitCode }
 * @returns {Promise<{ output: string, exitCode: number }>} — final result
 */
export async function executeChain(chain, executor) {
    if (!chain || chain.length === 0) {
        return { output: '', exitCode: 1 };
    }

    let lastOutput = '';
    let lastExitCode = 0;

    for (let i = 0; i < chain.length; i++) {
        const segment = chain[i];
        const { command, operator } = segment;

        // Determine if we should execute based on operator
        if (operator === '&&' && lastExitCode !== 0) {
            // Skip — previous failed
            continue;
        }
        if (operator === '||' && lastExitCode === 0) {
            // Skip — previous succeeded
            continue;
        }

        // Pipe: pass previous output as stdin
        const stdin = operator === '|' ? lastOutput : undefined;

        try {
            const result = await executor(command, stdin);
            lastOutput = result.output || '';
            lastExitCode = result.exitCode ?? 0;
        } catch (err) {
            lastOutput = `[error] ${err.message}`;
            lastExitCode = 1;
        }
    }

    return { output: lastOutput, exitCode: lastExitCode };
}
