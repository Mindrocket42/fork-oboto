/**
 * Tool definition for the unified `run` CLI tool.
 *
 * The description is intentionally compact — the LLM discovers details
 * via progressive --help (run a command with no args to get usage).
 *
 * Note: The description may be dynamically replaced at runtime by
 * CommandRouter.generateToolDescription() which includes the actual
 * registered command list.
 */

export const RUN_TOOL = [
    {
        type: 'function',
        function: {
            name: 'run',
            description: [
                'Execute CLI-style commands with Unix pipe and chain support.',
                'Supports: | (pipe stdout), && (if success), || (if failure), ; (sequential).',
                '',
                'Available commands:',
                '  cat       — Read a text file',
                '  ls        — List files in workspace',
                '  write     — Write content to a file',
                '  edit      — Apply search/replace edits',
                '  grep      — Filter lines matching a pattern',
                '  head      — Show first N lines',
                '  tail      — Show last N lines',
                '  wc        — Count lines, words, or characters',
                '  sort      — Sort lines',
                '  uniq      — Remove duplicate adjacent lines',
                '  find      — Find files by name pattern',
                '  echo      — Output text',
                '  exec      — Run a shell command',
                '  bash      — Run a bash script',
                '  memory    — Search or manage memory',
                '  skill     — List, read, or use skills',
                '  task      — Manage background tasks',
                '  surface   — Create and manage UI surfaces',
                '  tools     — List custom tools',
                '  help      — Show help for a command',
                '',
                'Examples:',
                '  cat file.txt | grep ERROR | wc -l',
                '  ls src -r | grep test',
                '  exec npm test && echo "passed" || echo "failed"',
                '',
                'Run a command with no args for detailed usage.',
            ].join('\n'),
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'CLI command string. Supports pipes (|), chains (&&, ||), and sequences (;).',
                    },
                },
                required: ['command'],
            },
        },
    },
];
