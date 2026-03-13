/**
 * CLI Shell Commands — Unix-style wrapper for shell execution
 *
 * Commands: exec (delegates to ShellTools.runCommand)
 */

/**
 * Create shell commands bound to a ShellTools instance.
 * @param {import('../../tools/shell-tools.mjs').ShellTools} shellTools
 * @returns {Object} command registry
 */
export function createShellCommands(shellTools) {
    return {
        exec: {
            help: 'Run a shell command directly. Usage: exec <command>',
            usage: 'exec <command>',
            async execute(args, stdin) {
                if (args.length === 0) {
                    return {
                        output: 'exec: usage: exec <command>\n  Run a shell command directly.\n  Examples:\n    exec npm install\n    exec python3 script.py\n    exec curl -s https://api.example.com',
                        exitCode: 1,
                    };
                }

                // Rejoin args into a single command string
                const command = args.join(' ');

                // Use runCommandRaw to get structured results without
                // presentation layer (CommandRouter handles that)
                return await shellTools.runCommandRaw({ command });
            },
        },

        bash: {
            help: 'Run a bash script. Alias for exec.',
            usage: 'bash <script>',
            async execute(args, stdin) {
                if (args.length === 0) {
                    return {
                        output: 'bash: usage: bash <script>\n  Run a bash script or command.\n  Examples:\n    bash "for f in *.txt; do echo $f; done"\n    bash "python3 -c \'print(42)\'"',
                        exitCode: 1,
                    };
                }

                const command = args.join(' ');
                return await shellTools.runCommandRaw({ command });
            },
        },
    };
}
