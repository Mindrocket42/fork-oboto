/**
 * Cloud Workspace Tool Definitions
 *
 * Schema-only definitions for the 10 Supabase workspace tools used by cloud agents.
 * These are in OpenAI function-calling format ({ type: "function", function: { name, description, parameters } }).
 *
 * Handlers are provided separately by src/tools/providers/supabase-tools.mjs.
 *
 * @module cloud-workspace-tools
 */

export const CLOUD_WORKSPACE_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'search_workspace_files',
            description: 'Search for files in the current workspace by path pattern or file type.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search term to match against file paths' },
                    file_type: { type: 'string', description: 'Optional file type filter' },
                    limit: { type: 'number', description: 'Max results (default 20, max 50)' },
                },
                required: ['query'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'update_workspace_state',
            description: 'Update workspace state: task_goal, current_step, next_steps, status, or shared_memory.',
            parameters: {
                type: 'object',
                properties: {
                    task_goal: { type: 'string', description: 'High-level goal' },
                    current_step: { type: 'string', description: 'Current work item' },
                    next_steps: { type: 'array', items: { type: 'string' }, description: 'Ordered steps' },
                    status: {
                        type: 'string',
                        enum: ['idle', 'working', 'paused', 'completed', 'error'],
                        description: 'Status',
                    },
                    shared_memory_update: { type: 'object', description: 'Key-value pairs to merge into shared_memory' },
                },
                required: [],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'manage_tasks',
            description: "Add, remove, reorder, or list tasks in the workspace's next_steps.",
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['add', 'remove', 'reorder', 'list'], description: 'Action' },
                    task: { type: 'string', description: 'Task text (for add/remove)' },
                    tasks: { type: 'array', items: { type: 'string' }, description: 'Full ordered list (for reorder)' },
                },
                required: ['action'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'web_search',
            description: 'Search the web for current information. Returns a summary of top results.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query' },
                },
                required: ['query'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_conversation_history',
            description: 'Retrieve recent messages from the current conversation.',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'number', description: 'Number of messages (default 20, max 50)' },
                },
                required: [],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'create_conversation',
            description: 'Create a new conversation in the current workspace.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Conversation name' },
                    conversation_type: {
                        type: 'string',
                        enum: ['chat', 'thread', 'task'],
                        description: 'Type (default: chat)',
                    },
                },
                required: ['name'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'send_message',
            description: 'Send a message to a conversation in the workspace.',
            parameters: {
                type: 'object',
                properties: {
                    conversation_id: { type: 'string', description: 'Target conversation ID (defaults to current)' },
                    content: { type: 'string', description: 'Message content' },
                },
                required: ['content'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_workspace_members',
            description: 'List all members (users and agents) in the current workspace.',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'batch_file_read',
            description:
                'Read the content of multiple workspace files in one call. Returns each file\'s content (or an error). ' +
                'To avoid overloading context, you can set max_bytes_per_file (default 8000) and line_range per file. ' +
                "Files whose content exceeds the limit are truncated with a '[truncated]' marker.",
            parameters: {
                type: 'object',
                properties: {
                    files: {
                        type: 'array',
                        description: 'Array of files to read',
                        items: {
                            type: 'object',
                            properties: {
                                file_path: { type: 'string', description: 'Path of the file in the workspace' },
                                line_start: { type: 'number', description: 'Optional 1-indexed start line' },
                                line_end: { type: 'number', description: 'Optional 1-indexed end line' },
                                max_bytes: { type: 'number', description: 'Override per-file byte cap (default 8000, max 50000)' },
                            },
                            required: ['file_path'],
                        },
                    },
                    max_bytes_per_file: {
                        type: 'number',
                        description: 'Default byte cap for all files (default 8000, max 50000). Individual file max_bytes overrides this.',
                    },
                    max_total_bytes: {
                        type: 'number',
                        description: 'Hard cap on total bytes returned across all files (default 100000, max 200000). Reading stops once reached.',
                    },
                },
                required: ['files'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'batch_file_write',
            description:
                'Write or update multiple workspace files in one call. Supports full writes, appends, insertions, and search-replace patches. ' +
                "Creates new workspace_files records if the file doesn't exist yet.",
            parameters: {
                type: 'object',
                properties: {
                    files: {
                        type: 'array',
                        description: 'Array of file write operations',
                        items: {
                            type: 'object',
                            properties: {
                                file_path: { type: 'string', description: 'Destination file path in the workspace' },
                                mode: {
                                    type: 'string',
                                    enum: ['overwrite', 'append', 'prepend', 'insert_lines', 'search_replace'],
                                    description: 'Write mode (default: overwrite)',
                                },
                                content: { type: 'string', description: 'File content (for overwrite/append/prepend)' },
                                at_line: { type: 'number', description: '1-indexed line number for insert_lines mode' },
                                search: { type: 'string', description: 'Text to find (for search_replace mode)' },
                                replace: { type: 'string', description: 'Replacement text (for search_replace mode)' },
                                replace_all: { type: 'boolean', description: 'Replace all occurrences (default: false, first only)' },
                                create_if_missing: { type: 'boolean', description: "Create file if it doesn't exist (default: true)" },
                            },
                            required: ['file_path'],
                        },
                    },
                },
                required: ['files'],
                additionalProperties: false,
            },
        },
    },
];
