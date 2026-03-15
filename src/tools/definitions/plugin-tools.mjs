export const PLUGIN_TOOLS = [
    {
        type: "function",
        function: {
            name: "copy_plugin_to_workspace",
            description: "Copies a plugin's source code from the builtin or global plugins directory into the workspace's .plugins/ folder. This creates a local override: the workspace copy takes priority over the original on next reload. Use this to customize or extend system plugins for a specific project without modifying the originals.",
            parameters: {
                type: "object",
                properties: {
                    plugin_name: {
                        type: "string",
                        description: "The name of the plugin to copy (e.g. 'chrome-ext', 'firecrawl'). Must match a plugin discovered from builtin or global directories."
                    },
                    force: {
                        type: "boolean",
                        description: "If true, overwrites an existing workspace copy. Default false.",
                        default: false
                    }
                },
                required: ["plugin_name"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "list_available_plugins",
            description: "Lists all discovered plugins with their name, source (builtin/global/workspace/npm), status, and description. Useful for seeing which plugins are available before copying one to the workspace.",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    }
];
