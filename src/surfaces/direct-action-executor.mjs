/**
 * DirectActionExecutor — Server-side registry and executor for surface direct action handlers.
 *
 * Enables surface components to register named actions that execute server-side code
 * (tool calls, HTTP requests, file operations, pipelines) WITHOUT routing through the LLM.
 *
 * Action types:
 *   - 'tool'     — Call a whitelisted tool directly
 *   - 'fetch'    — Make a server-side HTTP request
 *   - 'pipeline' — Execute a sequence of tool/fetch/transform steps
 *   - 'function' — Run a registered async function
 *
 * Usage from surface components:
 *   surfaceApi.registerAction('getUsers', { type: 'fetch', url: 'https://api.example.com/users' });
 *   const users = await surfaceApi.directInvoke('getUsers');
 *
 * NOTE: Dynamically registered actions (via registerAction / registerForSurface) are stored
 * in-memory only. They will be lost if the DirectActionExecutor is re-created (e.g., on
 * workspace switch). Surface components should re-register their actions on mount if needed.
 */

import { consoleStyler } from '../ui/console-styler.mjs';
import dns from 'node:dns/promises';
import net from 'node:net';

/** Allowed protocols for fetch */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Hostnames explicitly blocked (covers localhost variants) */
const BLOCKED_HOSTNAMES = new Set([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '[::1]',
    '::1',
    '0177.0.0.1',      // Octal 127.0.0.1
    '0x7f.0.0.1',      // Hex 127.0.0.1
    '2130706433',       // Decimal 127.0.0.1
    'localtest.me',     // Common DNS rebind target
]);

/**
 * Check if an IPv4 address (as 4 octets) is in a private/reserved range.
 * @param {number} a - First octet
 * @param {number} b - Second octet
 * @returns {boolean}
 */
function _isPrivateIPv4(a, b) {
    return (
        a === 0 ||                          // 0.0.0.0/8
        a === 10 ||                         // 10.0.0.0/8
        a === 127 ||                        // 127.0.0.0/8 (loopback)
        (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 (CGNAT, RFC 6598)
        (a === 169 && b === 254) ||         // 169.254.0.0/16 (link-local)
        (a === 172 && b >= 16 && b <= 31) ||// 172.16.0.0/12
        (a === 192 && b === 168) ||         // 192.168.0.0/16
        (a === 198 && (b === 18 || b === 19)) // 198.18.0.0/15 (benchmarking, RFC 2544)
    );
}

/** Tools allowed for direct invocation from surfaces (superset of callTool allowlist) */
const ALLOWED_TOOLS = new Set([
    // File operations
    'read_file', 'write_file', 'list_files', 'edit_file',
    'read_many_files', 'write_many_files',
    // Search & data
    'search_web', 'evaluate_math', 'unit_conversion', 'get_image_info',
    // Surfaces
    'list_surfaces',
    // Skills (full CRUD + execution)
    'list_skills', 'read_skill', 'use_skill', 'create_skill', 'edit_skill', 'delete_skill', 'promote_skill', 'add_npm_skill',
    // Scheduling & recurring tasks
    'create_recurring_task', 'list_recurring_tasks', 'manage_recurring_task',
    // Background tasks
    'spawn_background_task', 'check_task_status'
]);

/** Default fetch timeout (ms) */
const DEFAULT_FETCH_TIMEOUT = 30000;

/** Max response body size for fetch (bytes) */
const MAX_FETCH_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB

/** Max total response size across all pipeline steps (bytes) */
const MAX_PIPELINE_TOTAL_SIZE = 10 * 1024 * 1024; // 10MB

export class DirectActionExecutor {
    /**
     * @param {object} options
     * @param {object} options.toolExecutor — ToolExecutor instance for tool calls
     * @param {object} [options.surfaceManager] — SurfaceManager instance
     * @param {Set<string>} [options.allowedFetchDomains] — Optional allowlist of domains for fetch
     * @param {boolean} [options.allowLocalFetch=false] — Allow localhost/private IP fetch (dangerous)
     */
    constructor(options = {}) {
        this.toolExecutor = options.toolExecutor || null;
        this.surfaceManager = options.surfaceManager || null;
        this.allowedFetchDomains = options.allowedFetchDomains || null;
        this.allowLocalFetch = options.allowLocalFetch || false;

        /** @type {Map<string, ActionDefinition>} Global actions */
        this._globalActions = new Map();

        /** @type {Map<string, Map<string, ActionDefinition>>} Surface-scoped actions: surfaceId → Map<name, def> */
        this._surfaceActions = new Map();

        this._registerBuiltinActions();
    }

    // ─── Registration ────────────────────────────────────────────────

    /**
     * Register a global direct action handler.
     * @param {string} name Action name
     * @param {ActionDefinition} definition Action definition
     */
    register(name, definition) {
        this._validateDefinition(name, definition);
        this._globalActions.set(name, definition);
    }

    /**
     * Register a surface-scoped direct action handler.
     * @param {string} surfaceId Surface ID
     * @param {string} name Action name
     * @param {ActionDefinition} definition Action definition
     */
    registerForSurface(surfaceId, name, definition) {
        this._validateDefinition(name, definition);
        if (!this._surfaceActions.has(surfaceId)) {
            this._surfaceActions.set(surfaceId, new Map());
        }
        this._surfaceActions.get(surfaceId).set(name, definition);
    }

    /**
     * Unregister a surface-scoped action.
     * @param {string} surfaceId
     * @param {string} name
     */
    unregisterForSurface(surfaceId, name) {
        const map = this._surfaceActions.get(surfaceId);
        if (map) {
            map.delete(name);
            if (map.size === 0) this._surfaceActions.delete(surfaceId);
        }
    }

    /**
     * Clean up all actions for a surface (e.g., when surface is deleted).
     * @param {string} surfaceId
     */
    cleanupSurface(surfaceId) {
        this._surfaceActions.delete(surfaceId);
    }

    /**
     * List all available actions for a surface (surface-scoped + global).
     * @param {string} [surfaceId]
     * @returns {Array<{name: string, description: string, type: string, scope: string}>}
     */
    listActions(surfaceId) {
        const result = [];
        for (const [name, def] of this._globalActions) {
            result.push({ name, description: def.description || '', type: def.type, scope: 'global' });
        }
        if (surfaceId && this._surfaceActions.has(surfaceId)) {
            for (const [name, def] of this._surfaceActions.get(surfaceId)) {
                result.push({ name, description: def.description || '', type: def.type, scope: 'surface' });
            }
        }
        return result;
    }

    // ─── Execution ───────────────────────────────────────────────────

    /**
     * Execute a registered action by name.
     * @param {string} name Action name
     * @param {object} args Arguments to pass
     * @param {string} [surfaceId] Optional surface scope
     * @returns {Promise<{success: boolean, data: *, error: string|null}>}
     */
    async execute(name, args = {}, surfaceId = null) {
        // Look up: surface-scoped first, then global
        let definition = null;
        if (surfaceId && this._surfaceActions.has(surfaceId)) {
            definition = this._surfaceActions.get(surfaceId).get(name);
        }
        if (!definition) {
            definition = this._globalActions.get(name);
        }
        if (!definition) {
            return { success: false, data: null, error: `Action "${name}" not registered` };
        }

        try {
            const ctx = this._buildContext(surfaceId);
            let result;

            switch (definition.type) {
                case 'tool':
                    result = await this._executeTool(definition, args, ctx);
                    break;
                case 'fetch':
                    result = await this._executeFetch(definition, args, ctx);
                    break;
                case 'pipeline':
                    result = await this._executePipeline(definition, args, ctx);
                    break;
                case 'function':
                    result = await this._executeFunction(definition, args, ctx);
                    break;
                default:
                    return { success: false, data: null, error: `Unknown action type: ${definition.type}` };
            }

            return { success: true, data: result, error: null };
        } catch (err) {
            consoleStyler.log('error', `DirectActionExecutor: ${name} failed: ${err.message}`);
            return { success: false, data: null, error: err.message };
        }
    }

    /**
     * Execute a server-side HTTP fetch (proxy for surfaces).
     * This is a standalone method, not requiring a registered action.
     * @param {string} url
     * @param {object} options — { method, headers, body, timeout }
     * @returns {Promise<{status: number, statusText: string, headers: object, body: *, ok: boolean}>}
     */
    async fetchDirect(url, options = {}) {
        const pinnedUrl = await this._validateUrl(url);

        const parsed = new URL(url);
        const isHttps = parsed.protocol === 'https:';

        // For HTTP: use the pinned URL (hostname replaced with resolved IP)
        // to defeat DNS rebinding.
        // For HTTPS: also use the pinned URL BUT set the Host header and
        // TLS servername so certificate validation and SNI use the original
        // hostname.  This closes the TOCTOU window between _validateUrl()
        // and fetch()'s own DNS resolution.
        const effectiveUrl = pinnedUrl || url;

        const method = (options.method || 'GET').toUpperCase();
        const headers = { ...options.headers };
        const timeout = options.timeout || DEFAULT_FETCH_TIMEOUT;

        // When using a pinned URL (hostname replaced with IP), set the Host
        // header so the target server can route the request correctly via
        // virtual hosting. Without this, the server sees the IP as the Host.
        if (pinnedUrl) {
            const originalHost = parsed.host;
            if (!headers['Host'] && !headers['host']) {
                headers['Host'] = originalHost;
            }
        }

        const fetchOptions = {
            method,
            headers,
            signal: AbortSignal.timeout(timeout),
        };

        // For HTTPS with a pinned IP: use undici's Agent with a custom
        // `connect` option that sets `servername` to the original hostname.
        // This ensures TLS/SNI certificate verification uses the hostname
        // (not the numeric IP), while the TCP connection is made to the
        // validated IP — closing the DNS rebinding TOCTOU window.
        let agent;
        if (isHttps && pinnedUrl) {
            try {
                const { Agent } = await import('undici');
                agent = new Agent({
                    connect: {
                        // servername tells TLS to send the original hostname
                        // in the SNI extension and verify the cert against it,
                        // even though we're connecting to the numeric IP.
                        servername: parsed.hostname,
                    },
                });
                fetchOptions.dispatcher = agent;
            } catch {
                // If undici is not available (shouldn't happen on Node 18+),
                // fall back to using the original URL (no DNS pinning for HTTPS).
                // _validateUrl() still ran, so the risk is only the TOCTOU window.
            }
        }

        if (options.body && method !== 'GET' && method !== 'HEAD') {
            if (typeof options.body === 'string') {
                fetchOptions.body = options.body;
            } else {
                fetchOptions.body = JSON.stringify(options.body);
                if (!headers['Content-Type'] && !headers['content-type']) {
                    headers['Content-Type'] = 'application/json';
                }
            }
        }

        try {
            const response = await fetch(effectiveUrl, fetchOptions);

            // Read response with streaming size enforcement
            const contentType = response.headers.get('content-type') || '';
            let body;

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('Response body is not readable');
            }

            const decodedParts = [];
            let totalBytes = 0;
            const decoder = new TextDecoder();

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    totalBytes += value.byteLength;
                    if (totalBytes > MAX_FETCH_RESPONSE_SIZE) {
                        reader.cancel();
                        throw new Error(`Response body exceeds ${MAX_FETCH_RESPONSE_SIZE} byte limit (read ${totalBytes} so far)`);
                    }
                    decodedParts.push(decoder.decode(value, { stream: true }));
                }
            } finally {
                reader.releaseLock();
            }

            // Flush remaining bytes (handles multi-byte characters split across chunks)
            decodedParts.push(decoder.decode());
            const text = decodedParts.join('');

            if (contentType.includes('application/json')) {
                try {
                    body = JSON.parse(text);
                } catch {
                    body = text;
                }
            } else {
                body = text;
            }

            // Extract response headers as plain object
            const responseHeaders = {};
            response.headers.forEach((v, k) => { responseHeaders[k] = v; });

            return {
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders,
                body,
                ok: response.ok,
            };
        } finally {
            if (agent) {
                try { await agent.close(); } catch (_) { /* ignore close errors */ }
            }
        }
    }

    // ─── Private: Execution Strategies ───────────────────────────────

    async _executeTool(definition, args, ctx) {
        const toolName = definition.toolName;
        if (!toolName) throw new Error('Tool action missing toolName');

        if (!ALLOWED_TOOLS.has(toolName)) {
            // Check plugin surface-safe
            const isPluginSafe = this.toolExecutor?.isPluginSurfaceSafe?.(toolName);
            if (!isPluginSafe) {
                throw new Error(`Tool "${toolName}" is not allowed from surface direct execution`);
            }
        }

        if (!this.toolExecutor) throw new Error('ToolExecutor not available');

        // Merge definition args with runtime args
        const mergedArgs = { ...(definition.args || {}), ...args };

        const toolCall = {
            id: `direct-${Date.now()}`,
            function: {
                name: toolName,
                arguments: JSON.stringify(mergedArgs),
            },
        };

        const result = await this.toolExecutor.executeTool(toolCall);
        return result.content;
    }

    async _executeFetch(definition, args, ctx) {
        // Build URL with template substitution
        let url = definition.url;
        if (url && args) {
            for (const [key, value] of Object.entries(args)) {
                if (key.startsWith('_')) continue; // skip internal control args (_method, _headers, etc.)
                url = url.replace(`{${key}}`, encodeURIComponent(String(value)));
            }
        }

        if (!url) throw new Error('Fetch action missing url');

        // Reject URLs with unresolved template placeholders
        const unresolvedMatch = url.match(/\{([^}]+)\}/g);
        if (unresolvedMatch) {
            const names = unresolvedMatch.map(m => m.slice(1, -1));
            throw new Error(`Fetch action has unresolved URL placeholders: ${names.join(', ')}`);
        }

        const options = {
            method: definition.method || args._method || 'GET',
            headers: { ...(definition.headers || {}), ...(args._headers || {}) },
            body: args._body || definition.body || undefined,
            timeout: definition.timeout || DEFAULT_FETCH_TIMEOUT,
        };

        return this.fetchDirect(url, options);
    }

    async _executePipeline(definition, args, ctx) {
        if (!definition.steps || !Array.isArray(definition.steps)) {
            throw new Error('Pipeline action missing steps array');
        }

        let pipelineData = { ...args };
        let totalAccumulatedSize = 0;

        for (let i = 0; i < definition.steps.length; i++) {
            const step = definition.steps[i];
            const stepName = step.name || `step-${i}`;

            try {
                let stepResult;

                switch (step.type) {
                    case 'tool': {
                        stepResult = await this._executeTool(
                            { toolName: step.toolName, args: step.args },
                            pipelineData,
                            ctx
                        );
                        break;
                    }
                    case 'fetch': {
                        stepResult = await this._executeFetch(step, pipelineData, ctx);
                        break;
                    }
                    case 'transform': {
                        // Apply a transform expression to pipeline data
                        if (typeof step.transform === 'function') {
                            stepResult = await step.transform(pipelineData, stepResult);
                        } else {
                            stepResult = pipelineData;
                        }
                        break;
                    }
                    default:
                        throw new Error(`Unknown pipeline step type: ${step.type}`);
                }

                // Enforce total pipeline response size cap to prevent memory amplification.
                // A malicious surface could register N fetch steps, each returning up to
                // MAX_FETCH_RESPONSE_SIZE, consuming N × MAX_FETCH_RESPONSE_SIZE of server RAM.
                const stepSize = typeof stepResult === 'string'
                    ? stepResult.length
                    : JSON.stringify(stepResult ?? null).length;
                totalAccumulatedSize += stepSize;
                if (totalAccumulatedSize > MAX_PIPELINE_TOTAL_SIZE) {
                    throw new Error(
                        `Pipeline total response size exceeds ${MAX_PIPELINE_TOTAL_SIZE} byte limit ` +
                        `(accumulated ${totalAccumulatedSize} bytes at step "${stepName}")`
                    );
                }

                // Store step result in pipeline data
                pipelineData[stepName] = stepResult;
                pipelineData._lastResult = stepResult;
            } catch (err) {
                if (step.continueOnError) {
                    pipelineData[stepName] = { error: err.message };
                    pipelineData._lastResult = null;
                } else {
                    throw new Error(`Pipeline failed at step "${stepName}": ${err.message}`);
                }
            }
        }

        // Return the final step result or the full pipeline data
        return definition.returnLastResult !== false
            ? pipelineData._lastResult
            : pipelineData;
    }

    async _executeFunction(definition, args, ctx) {
        if (typeof definition.execute !== 'function') {
            throw new Error('Function action missing execute function');
        }
        return definition.execute(args, ctx);
    }

    // ─── Private: Helpers ────────────────────────────────────────────

    _buildContext(surfaceId) {
        return {
            toolExecutor: this.toolExecutor,
            surfaceManager: this.surfaceManager,
            surfaceId,
            callTool: async (toolName, toolArgs) => {
                return this._executeTool({ toolName }, toolArgs, null);
            },
            fetch: async (url, options) => {
                return this.fetchDirect(url, options);
            },
        };
    }

    /**
     * Validate a URL for safety (SSRF prevention) and return a pinned URL
     * with the resolved IP to defeat DNS rebinding attacks.
     *
     * @param {string} url
     * @returns {Promise<string|null>} Pinned URL with resolved IP (or null if
     *   the hostname is already a numeric IP and no pinning is needed)
     */
    async _validateUrl(url) {
        if (!url || typeof url !== 'string') {
            throw new Error('Invalid URL');
        }

        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            throw new Error(`Invalid URL: ${url}`);
        }

        // Only allow http/https protocols
        if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
            throw new Error(`Protocol "${parsed.protocol}" not allowed — only http: and https: are permitted`);
        }

        // SSRF prevention: block local/private network access
        if (!this.allowLocalFetch) {
            const hostname = parsed.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

            // Check explicit hostname blocklist
            if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) {
                throw new Error(`URL blocked: local/private network access not allowed`);
            }

            // Check numeric IPv4 addresses for private ranges.
            // Use net.isIPv4() to catch all representations (dotted-quad,
            // collapsed forms like 127.1, and URL-parser-normalized addresses).
            // The URL constructor normalizes exotic forms (octal, hex, decimal
            // integer) into standard dotted-quad, so parsed.hostname is
            // always a canonical IPv4 if the input was any numeric IPv4 variant.
            const isIPv4 = net.isIPv4(hostname);
            const ipv4Match = isIPv4
                ? hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
                : null;
            if (isIPv4) {
                if (ipv4Match) {
                    const [, a, b] = ipv4Match.map(Number);
                    if (_isPrivateIPv4(a, b)) {
                        throw new Error(`URL blocked: private network IP address not allowed`);
                    }
                } else {
                    // net.isIPv4 returned true but the hostname doesn't match
                    // standard dotted-quad — this shouldn't happen after URL
                    // normalization, but block it defensively to be safe.
                    throw new Error(`URL blocked: non-standard IPv4 address format not allowed`);
                }
            }

            // Check IPv6 loopback
            if (hostname === '::1') {
                throw new Error(`URL blocked: IPv6 loopback address not allowed`);
            }

            // Check link-local IPv6 (fe80::/10)
            if (hostname.toLowerCase().startsWith('fe80:')) {
                throw new Error(`URL blocked: link-local IPv6 address not allowed`);
            }

            // Check IPv6-mapped IPv4 addresses.
            // new URL() normalizes ::ffff:127.0.0.1 → ::ffff:7f00:1 (hex form),
            // so we must handle both dotted-decimal and hex notations.
            if (hostname.toLowerCase().includes('::ffff:')) {
                // Dotted form: ::ffff:10.0.0.1
                const mappedV4 = hostname.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
                if (mappedV4) {
                    const parts = mappedV4[1].split('.').map(Number);
                    if (parts.length === 4 && _isPrivateIPv4(parts[0], parts[1])) {
                        throw new Error(`URL blocked: IPv6-mapped private IPv4 address not allowed`);
                    }
                }
                // Hex form: ::ffff:7f00:1 (as normalized by URL parser)
                // Format: ::ffff:XXYY:ZZWW where XX.YY.ZZ.WW is the IPv4 address
                const hexMapped = hostname.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
                if (hexMapped) {
                    const hi = parseInt(hexMapped[1], 16);
                    const lo = parseInt(hexMapped[2], 16);
                    const a = (hi >> 8) & 0xff;
                    const b = hi & 0xff;
                    if (_isPrivateIPv4(a, b)) {
                        throw new Error(`URL blocked: IPv6-mapped private IPv4 address not allowed`);
                    }
                }
            }

            // Reject URLs with credentials (user:pass@host) — common bypass technique
            if (parsed.username || parsed.password) {
                throw new Error(`URL blocked: credentials in URL not allowed`);
            }

            // DNS rebinding defense: resolve hostname, verify IPs, and PIN
            // the resolved address so that the subsequent fetch() uses the
            // same IP we validated (defeating TOCTOU / DNS rebinding).
            if (!isIPv4) {
                let pinnedIp = null;

                try {
                    const addresses = await dns.resolve4(hostname).catch(() => []);
                    const v6addresses = await dns.resolve6(hostname).catch(() => []);

                    for (const addr of addresses) {
                        const parts = addr.split('.').map(Number);
                        if (parts.length === 4 && _isPrivateIPv4(parts[0], parts[1])) {
                            throw new Error(`URL blocked: hostname "${hostname}" resolves to private IP ${addr}`);
                        }
                    }

                    for (const addr of v6addresses) {
                        if (addr === '::1' || addr.startsWith('::ffff:') || addr.startsWith('fe80:')) {
                            throw new Error(`URL blocked: hostname "${hostname}" resolves to loopback/link-local IPv6 ${addr}`);
                        }
                    }

                    // Pin the first safe IPv4 address (preferred for compatibility)
                    if (addresses.length > 0) {
                        pinnedIp = addresses[0];
                    } else if (v6addresses.length > 0) {
                        pinnedIp = v6addresses[0];
                    }
                } catch (err) {
                    if (err.message.startsWith('URL blocked:')) throw err;
                    // DNS resolution failed — fail closed to prevent SSRF.
                    // If the hostname can't be resolved here, fetch() will
                    // also fail, so blocking proactively loses no valid requests.
                    throw new Error(`URL blocked: DNS resolution failed for "${hostname}"`);
                }

                // Build a pinned URL: replace hostname with resolved IP,
                // set the Host header so the target server can route correctly.
                if (pinnedIp) {
                    const pinned = new URL(url);
                    // For IPv6, wrap in brackets for the URL hostname
                    pinned.hostname = pinnedIp.includes(':') ? `[${pinnedIp}]` : pinnedIp;

                    // Check domain allowlist before returning
                    if (this.allowedFetchDomains && this.allowedFetchDomains.size > 0) {
                        if (!this.allowedFetchDomains.has(parsed.hostname)) {
                            throw new Error(`Domain "${parsed.hostname}" not in fetch allowlist`);
                        }
                    }

                    return pinned.toString();
                }
            }
        }

        // Check domain allowlist if configured
        if (this.allowedFetchDomains && this.allowedFetchDomains.size > 0) {
            if (!this.allowedFetchDomains.has(parsed.hostname)) {
                throw new Error(`Domain "${parsed.hostname}" not in fetch allowlist`);
            }
        }

        return null; // No pinning needed (direct IP or allowLocalFetch is true)
    }

    _validateDefinition(name, definition) {
        if (!name || typeof name !== 'string') {
            throw new Error('Action name must be a non-empty string');
        }
        if (!definition || typeof definition !== 'object') {
            throw new Error(`Action "${name}" definition must be an object`);
        }
        const validTypes = ['tool', 'fetch', 'pipeline', 'function'];
        if (!validTypes.includes(definition.type)) {
            throw new Error(`Action "${name}" has invalid type "${definition.type}". Valid: ${validTypes.join(', ')}`);
        }
    }

    // ─── Built-in Actions ────────────────────────────────────────────

    _registerBuiltinActions() {
        // readAndParseJson — Read a workspace file and parse as JSON
        this.register('readAndParseJson', {
            type: 'function',
            description: 'Read a workspace file and parse its content as JSON',
            execute: async (args, ctx) => {
                const result = await ctx.callTool('read_file', { path: args.path });
                try {
                    return JSON.parse(result);
                } catch {
                    return result; // Return raw if not JSON
                }
            },
        });

        // readAndParseMarkdownTable — Read a markdown file and extract a table section
        this.register('readAndParseMarkdownTable', {
            type: 'function',
            description: 'Read a markdown file and parse a table section into an array of objects',
            execute: async (args, ctx) => {
                const content = await ctx.callTool('read_file', { path: args.path });
                if (!content || typeof content !== 'string') return [];

                let text = content;
                if (args.section) {
                    const sectionPattern = new RegExp(
                        `##\\s+${args.section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s\\S]*?)(?=##\\s|$)`
                    );
                    const match = text.match(sectionPattern);
                    text = match ? match[1] : '';
                }

                // Parse markdown table
                const lines = text.split('\n').filter(l => l.trim().startsWith('|'));
                if (lines.length < 2) return [];

                const headerLine = lines[0];
                const headers = headerLine.split('|').map(h => h.trim()).filter(h => h && !h.match(/^-+$/));

                const rows = [];
                for (let i = 2; i < lines.length; i++) { // Skip header + separator
                    const cols = lines[i].split('|').map(c => c.trim()).filter(c => c);
                    if (cols.length === 0) continue;
                    const row = {};
                    headers.forEach((h, idx) => {
                        row[h.toLowerCase().replace(/\s+/g, '_')] = cols[idx] || '';
                    });
                    rows.push(row);
                }
                return rows;
            },
        });

        // listWorkspaceFiles — List files in workspace with optional pattern filtering
        this.register('listWorkspaceFiles', {
            type: 'tool',
            description: 'List files in the workspace directory',
            toolName: 'list_files',
            args: { recursive: true },
        });

        // searchFiles — Search for text pattern in workspace files
        this.register('searchFiles', {
            type: 'function',
            description: 'Search for a text pattern in a workspace file',
            execute: async (args, ctx) => {
                if (!args.path || typeof args.path !== 'string') {
                    return [{ error: 'path argument is required for searchFiles (must be a file path, not a directory)' }];
                }

                const result = await ctx.callTool('read_file', { path: args.path });
                if (!result) return [];

                // ReDoS protection: limit pattern length and reject dangerous constructions
                const rawPattern = args.pattern || '';
                if (rawPattern.length > 200) {
                    return [{ error: 'Pattern too long (max 200 characters)' }];
                }
                // Detect nested quantifiers — the most common catastrophic backtracking vector
                // e.g. (a+)+, (a*)+, (a+)*, (\w+)+, ([^x]+)+, etc.
                // Only reject patterns where a quantifier follows a group that itself
                // contains a quantifier — this avoids false positives on patterns
                // like "a+b*" where quantifiers apply to independent atoms.
                if (/\([^)]*[+*][^)]*\)[+*?{]/.test(rawPattern)) {
                    return [{ error: 'Pattern rejected: nested quantifiers may cause catastrophic backtracking' }];
                }
                let pattern;
                try {
                    // Default to 'i' (case-insensitive) WITHOUT 'g' flag.
                    // Using 'g' with .test() is stateful (advances lastIndex),
                    // which causes alternating matches to be skipped.
                    pattern = new RegExp(rawPattern, args.flags || 'i');
                } catch (e) {
                    return [{ error: `Invalid regex pattern: ${e.message}` }];
                }

                const lines = result.split('\n');
                const matches = [];
                for (let i = 0; i < lines.length; i++) {
                    if (pattern.test(lines[i])) {
                        matches.push({ line: i + 1, content: lines[i].trim() });
                    }
                }
                return matches;
            },
        });

        // httpGet — Simple HTTP GET
        // Uses 'function' type so the URL goes straight to fetchDirect() which
        // applies full SSRF validation.  The old 'fetch' + allowUrlOverride
        // approach bypassed the encodeURIComponent template path and exposed an
        // unrestricted URL-override entry-point.
        this.register('httpGet', {
            type: 'function',
            description: 'Make an HTTP GET request',
            execute: async (args, ctx) => {
                if (!args.url) throw new Error('httpGet requires a "url" argument');
                return ctx.fetch(args.url, {
                    method: 'GET',
                    headers: args.headers,
                    timeout: args.timeout,
                });
            },
        });

        // httpPost — Simple HTTP POST
        this.register('httpPost', {
            type: 'function',
            description: 'Make an HTTP POST request',
            execute: async (args, ctx) => {
                if (!args.url) throw new Error('httpPost requires a "url" argument');
                return ctx.fetch(args.url, {
                    method: 'POST',
                    headers: args.headers,
                    body: args.body,
                    timeout: args.timeout,
                });
            },
        });
    }
}

/**
 * @typedef {Object} ActionDefinition
 * @property {'tool'|'fetch'|'pipeline'|'function'} type — Execution strategy
 * @property {string} [description] — Human-readable description
 * @property {object} [inputSchema] — JSON Schema for input validation
 * @property {object} [outputSchema] — JSON Schema for output validation
 *
 * For type 'tool':
 * @property {string} toolName — Tool name to call
 * @property {object} [args] — Default arguments (merged with runtime args)
 *
 * For type 'fetch':
 * @property {string} url — URL template (supports {param} substitution)
 * @property {string} [method='GET'] — HTTP method
 * @property {object} [headers] — Default headers
 * @property {*} [body] — Default body
 * @property {number} [timeout] — Request timeout in ms
 *
 * For type 'pipeline':
 * @property {Array<PipelineStep>} steps — Ordered list of steps
 * @property {boolean} [returnLastResult=true] — Return only last step result vs full pipeline data
 *
 * For type 'function':
 * @property {function(args: object, ctx: object): Promise<*>} execute — The function to execute
 */
