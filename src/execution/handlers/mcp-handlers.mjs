export class McpHandlers {
    constructor(clientManager) {
        this.clientManager = clientManager;
    }

    async addServer(args) {
        const { name, type, command, args: commandArgs, url, env, scope } = args;

        if (type === 'stdio') {
            if (!command) return "[error] mcp_add_server: 'command' is required for stdio transport. Usage: mcp_add_server({ name, type: 'stdio', command, args })";
        } else if (type === 'sse') {
            if (!url) return "[error] mcp_add_server: 'url' is required for sse transport. Usage: mcp_add_server({ name, type: 'sse', url })";
        } else {
            return `[error] mcp_add_server: invalid transport type '${type}'. Valid types: stdio, sse`;
        }

        const config = {
            command,
            args: commandArgs,
            url,
            env
        };

        // Clean up undefined values
        Object.keys(config).forEach(key => config[key] === undefined && delete config[key]);

        try {
            await this.clientManager.saveServerConfig(name, config, scope === 'global');
            
            // Try connecting immediately
            const success = await this.clientManager.connect(name, config);
            
            if (success) {
                return `Successfully added and connected to MCP server '${name}' (${scope} scope).`;
            } else {
                return `Added configuration for MCP server '${name}' (${scope} scope), but failed to connect immediately. Check logs for details.`;
            }
        } catch (e) {
            return `[error] mcp_add_server: ${e.message}`;
        }
    }

    async removeServer(args) {
        const { name, scope } = args;
        try {
            await this.clientManager.disconnect(name);
            await this.clientManager.removeServerConfig(name, scope === 'global');
            return `Successfully removed MCP server '${name}' (${scope} scope).`;
        } catch (e) {
            return `[error] mcp_remove_server: ${e.message}. Use: mcp_list_servers to verify server name.`;
        }
    }

    async listServers() {
        try {
            const servers = this.clientManager.listServers();
            if (servers.length === 0) {
                return "No MCP servers configured.";
            }
            
            let output = "Configured MCP Servers:\n\n";
            output += "| Name | Status | Type | Tools |\n";
            output += "|------|--------|------|-------|\n";
            
            for (const s of servers) {
                output += `| ${s.name} | ${s.status} | ${s.type} | ${s.tools} |\n`;
            }
            
            return output;
        } catch (e) {
            return `[error] mcp_list_servers: ${e.message}`;
        }
    }

    async refreshServers() {
        try {
            await this.clientManager.loadConfig();
            await this.clientManager.connectAll();
            return "Successfully refreshed MCP server configurations and connections.";
        } catch (e) {
            return `[error] mcp_refresh_servers: ${e.message}`;
        }
    }
}
