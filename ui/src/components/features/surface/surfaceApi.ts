/* eslint-disable no-unused-expressions, @typescript-eslint/no-unused-expressions */
/**
 * Surface API — Runtime API available to surface sandbox components.
 * Exposes workspace file ops, agent interaction, state, and tool invocation.
 */
import { wsService } from '../../../services/wsService';

// ─── Handler definition type ───
export interface HandlerDefinition {
  name: string;
  description: string;
  type: 'query' | 'action';
  inputSchema?: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

// ─── Direct action definition types ───
export interface DirectActionToolDef {
  type: 'tool';
  description?: string;
  toolName: string;
  args?: Record<string, unknown>;
}

export interface DirectActionFetchDef {
  type: 'fetch';
  description?: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  allowUrlOverride?: boolean;
  timeout?: number;
}

export interface DirectActionPipelineDef {
  type: 'pipeline';
  description?: string;
  steps: Array<{ type: string; [key: string]: unknown }>;
  returnLastResult?: boolean;
}

export type DirectActionDefinition = DirectActionToolDef | DirectActionFetchDef | DirectActionPipelineDef;

// ─── Fetch response type ───
export interface SurfaceFetchResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: T;
  ok: boolean;
}

// ─── Handler registry (shared across all components on this page) ───
const _handlerRegistry = new Map<string, HandlerDefinition>();

export const surfaceApi = {
  // ─── Workspace Port ───

  /** The workspace content server port, set reactively from App.tsx */
  workspacePort: null as number | null,

  /**
   * Surface sandbox network mode.
   * - `'strict'` (default): fetch restricted to localhost, XMLHttpRequest/WebSocket/EventSource blocked
   * - `'permissive'`: native fetch and all network APIs available (no restrictions)
   *
   * Controlled via workspace settings (`surface.sandboxMode`).
   */
  sandboxMode: 'strict' as 'strict' | 'permissive',

  /**
   * Set the sandbox mode. Called from App.tsx when workspace settings change.
   */
  setSandboxMode(mode: 'strict' | 'permissive') {
    surfaceApi.sandboxMode = mode;
  },

  /**
   * Set the workspace content server port.
   * Called from useUIState sync in App.tsx when the port changes.
   */
  setWorkspacePort(port: number | null) {
    surfaceApi.workspacePort = port;
  },

  /**
   * Construct an absolute URL to the workspace content server.
   * Returns null if no workspace port is set.
   * @param path - path on the content server (e.g. '/routes/items' or '/images/foo.png')
   */
  contentServerUrl(path?: string): string | null {
    if (surfaceApi.workspacePort == null) return null;
    const base = `http://localhost:${surfaceApi.workspacePort}`;
    if (!path) return base;
    return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  },

  /**
   * Fetch a workspace route via the browser's native fetch (not WebSocket proxy).
   * Uses the content server URL with the dynamic port. CORS is already configured.
   * Returns null if no workspace port is set.
   */
  async fetchRoute(routePath: string, options?: RequestInit): Promise<Response | null> {
    const url = surfaceApi.contentServerUrl(routePath);
    if (!url) return null;
    return fetch(url, options);
  },

  // ─── Messaging ───
  sendMessage: (type: string, payload: unknown) => {
    wsService.sendMessage(type, payload);
  },

  // ─── Agent Interaction ───
  callAgent: (prompt: string): Promise<string> => {
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const unsub = wsService.on('surface-agent-response', (payload: unknown) => {
        const p = payload as { requestId: string; response: string };
        if (p.requestId === id) { unsub(); resolve(p.response); }
      });
      wsService.sendMessage('surface-agent-request', { requestId: id, prompt });
    });
  },

  defineHandler: (definition: HandlerDefinition): void => {
    _handlerRegistry.set(definition.name, definition);
  },

  invoke: <T = unknown>(handlerName: string, args?: Record<string, unknown>, surfaceId?: string): Promise<T> => {
    const handler = _handlerRegistry.get(handlerName);
    if (!handler) return Promise.reject(new Error(`Handler "${handlerName}" not defined.`));

    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { unsub(); reject(new Error(`Handler "${handlerName}" timed out`)); }, 60000);
      const unsub = wsService.on('surface-handler-result', (payload: unknown) => {
        const p = payload as { requestId: string; success: boolean; data: T; error: string | null };
        if (p.requestId === requestId) {
          clearTimeout(timeout); unsub();
          p.success ? resolve(p.data) : reject(new Error(p.error || 'Handler failed'));
        }
      });
      wsService.sendMessage('surface-handler-invoke', {
        requestId, surfaceId: surfaceId || '', handlerName, handlerDefinition: handler, args: args || {}
      });
    });
  },

  // ─── Persisted State ───
  getState: <T = unknown>(key: string, surfaceId?: string): Promise<T | undefined> => {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { unsub(); resolve(undefined); }, 5000);
      const unsub = wsService.on('surface-state-data', (payload: unknown) => {
        const p = payload as { requestId: string; value: T | undefined };
        if (p.requestId === requestId) { clearTimeout(timeout); unsub(); resolve(p.value); }
      });
      wsService.sendMessage('surface-get-state', { requestId, surfaceId: surfaceId || '', key });
    });
  },

  setState: (key: string, value: unknown, surfaceId?: string): void => {
    wsService.sendMessage('surface-set-state', { surfaceId: surfaceId || '', key, value });
  },

  // ─── Workspace File Operations ───
  readFile: (path: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { unsub(); reject(new Error('readFile timed out')); }, 15000);
      const unsub = wsService.on('surface-file-result', (payload: unknown) => {
        const p = payload as { requestId: string; success: boolean; content: string | null; error: string | null };
        if (p.requestId === requestId) {
          clearTimeout(timeout); unsub();
          p.success ? resolve(p.content!) : reject(new Error(p.error || 'Failed'));
        }
      });
      wsService.sendMessage('surface-read-file', { requestId, path });
    });
  },

  writeFile: (path: string, content: string): Promise<{ success: boolean; message: string }> => {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { unsub(); reject(new Error('writeFile timed out')); }, 15000);
      const unsub = wsService.on('surface-file-write-result', (payload: unknown) => {
        const p = payload as { requestId: string; success: boolean; message: string; error: string | null };
        if (p.requestId === requestId) {
          clearTimeout(timeout); unsub();
          resolve({ success: p.success, message: p.message || p.error || '' });
        }
      });
      wsService.sendMessage('surface-write-file', { requestId, path, content });
    });
  },

  listFiles: (path?: string, recursive?: boolean): Promise<string[]> => {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { unsub(); reject(new Error('listFiles timed out')); }, 10000);
      const unsub = wsService.on('surface-file-list-result', (payload: unknown) => {
        const p = payload as { requestId: string; success: boolean; files: string[]; error: string | null };
        if (p.requestId === requestId) {
          clearTimeout(timeout); unsub();
          p.success ? resolve(p.files) : reject(new Error(p.error || 'Failed'));
        }
      });
      wsService.sendMessage('surface-list-files', { requestId, path: path || '.', recursive: !!recursive });
    });
  },

  readManyFiles: (paths: string[]): Promise<{ summary: string; results: Array<{ path: string; content: string | null; error?: string; truncated: boolean }> }> => {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { unsub(); reject(new Error('readManyFiles timed out')); }, 30000);
      const unsub = wsService.on('surface-read-many-result', (payload: unknown) => {
        const p = payload as { requestId: string; success: boolean; summary: string; results: Array<{ path: string; content: string | null; error?: string; truncated: boolean }>; error: string | null };
        if (p.requestId === requestId) {
          clearTimeout(timeout); unsub();
          p.success ? resolve({ summary: p.summary, results: p.results }) : reject(new Error(p.error || 'Failed'));
        }
      });
      wsService.sendMessage('surface-read-many-files', { requestId, paths });
    });
  },

  // ─── Workspace Config ───
  getConfig: <T = unknown>(key?: string): Promise<T> => {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { unsub(); reject(new Error('getConfig timed out')); }, 5000);
      const unsub = wsService.on('surface-config-result', (payload: unknown) => {
        const p = payload as { requestId: string; success: boolean; config: T; error: string | null };
        if (p.requestId === requestId) {
          clearTimeout(timeout); unsub();
          p.success ? resolve(p.config) : reject(new Error(p.error || 'Failed'));
        }
      });
      wsService.sendMessage('surface-get-config', { requestId, key: key || null });
    });
  },

  // ─── Direct Tool Invocation ───
  callTool: <T = unknown>(toolName: string, args?: Record<string, unknown>): Promise<T> => {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { unsub(); reject(new Error(`callTool(${toolName}) timed out`)); }, 30000);
      const unsub = wsService.on('surface-tool-result', (payload: unknown) => {
        const p = payload as { requestId: string; success: boolean; result: T; error: string | null };
        if (p.requestId === requestId) {
          clearTimeout(timeout); unsub();
          p.success ? resolve(p.result) : reject(new Error(p.error || 'Tool call failed'));
        }
      });
      wsService.sendMessage('surface-call-tool', { requestId, toolName, args: args || {} });
    });
  },

  // ─── Direct Action Invocation (LLM-free) ───
  /**
   * Execute a registered direct action by name — bypasses the LLM entirely.
   * Use for deterministic operations: tool calls, HTTP requests, pipelines.
   * Register actions first via `registerAction()` or use built-in actions:
   *   - 'readAndParseJson' — Read a file and parse as JSON
   *   - 'readAndParseMarkdownTable' — Parse a markdown table section
   *   - 'listWorkspaceFiles' — List workspace files
   *   - 'httpGet' — HTTP GET request
   *   - 'httpPost' — HTTP POST request
   */
  directInvoke: <T = unknown>(actionName: string, args?: Record<string, unknown>, surfaceId?: string): Promise<T> => {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { unsub(); reject(new Error(`directInvoke(${actionName}) timed out`)); }, 30000);
      const unsub = wsService.on('surface-direct-result', (payload: unknown) => {
        const p = payload as { requestId: string; success: boolean; data: T; error: string | null };
        if (p.requestId === requestId) {
          clearTimeout(timeout); unsub();
          p.success ? resolve(p.data) : reject(new Error(p.error || 'Direct action failed'));
        }
      });
      wsService.sendMessage('surface-direct-invoke', {
        requestId, surfaceId: surfaceId || '', actionName, args: args || {}
      });
    });
  },

  /**
   * Server-side HTTP fetch — avoids CORS and routes through the server.
   * Use instead of browser fetch() for external API calls from surfaces.
   * URL validation is enforced server-side (localhost/private IPs blocked by default).
   */
  fetch: <T = unknown>(url: string, options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeout?: number;
  }): Promise<SurfaceFetchResponse<T>> => {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeoutMs = options?.timeout || 30000;
      const timeout = setTimeout(() => { unsub(); reject(new Error(`fetch(${url}) timed out`)); }, timeoutMs + 5000);
      const unsub = wsService.on('surface-fetch-result', (payload: unknown) => {
        const p = payload as {
          requestId: string; success: boolean;
          status: number; statusText: string; headers: Record<string, string>;
          body: T; ok: boolean; error: string | null;
        };
        if (p.requestId === requestId) {
          clearTimeout(timeout); unsub();
          if (p.success) {
            resolve({ status: p.status, statusText: p.statusText, headers: p.headers, body: p.body, ok: p.ok });
          } else {
            reject(new Error(p.error || 'Fetch failed'));
          }
        }
      });
      wsService.sendMessage('surface-fetch', {
        requestId, url,
        method: options?.method || 'GET',
        headers: options?.headers || {},
        body: options?.body || null,
        timeout: options?.timeout || 30000,
      });
    });
  },

  /**
   * Register a direct action on the server — enables `directInvoke(name)` calls.
   * Actions execute server-side code without LLM involvement.
   *
   * @example
   * // Register a tool-based action
   * surfaceApi.registerAction('getSkills', { type: 'tool', toolName: 'list_skills' });
   *
   * // Register a fetch-based action
   * surfaceApi.registerAction('getWeather', {
   *   type: 'fetch', url: 'https://api.weather.com/v1/{city}', method: 'GET'
   * });
   *
   * // Register a pipeline
   * surfaceApi.registerAction('analyzeProject', {
   *   type: 'pipeline',
   *   steps: [
   *     { type: 'tool', toolName: 'list_files', args: { recursive: true } },
   *     { type: 'tool', toolName: 'read_file', args: { path: 'package.json' } }
   *   ]
   * });
   */
  registerAction: (actionName: string, definition: DirectActionDefinition, surfaceId?: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { unsub(); reject(new Error(`registerAction(${actionName}) timed out`)); }, 10000);
      const unsub = wsService.on('surface-action-registered', (payload: unknown) => {
        const p = payload as { requestId: string; success: boolean; error: string | null };
        if (p.requestId === requestId) {
          clearTimeout(timeout); unsub();
          p.success ? resolve() : reject(new Error(p.error || 'Registration failed'));
        }
      });
      wsService.sendMessage('surface-register-action', {
        requestId, surfaceId: surfaceId || '', actionName, definition
      });
    });
  },

  /**
   * List all available direct actions (global + surface-scoped).
   */
  listActions: (surfaceId?: string): Promise<Array<{ name: string; description: string; type: string; scope: string }>> => {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { unsub(); reject(new Error('listActions timed out')); }, 5000);
      const unsub = wsService.on('surface-actions-list', (payload: unknown) => {
        const p = payload as { requestId: string; success: boolean; actions: Array<{ name: string; description: string; type: string; scope: string }>; error: string | null };
        if (p.requestId === requestId) {
          clearTimeout(timeout); unsub();
          p.success ? resolve(p.actions) : reject(new Error(p.error || 'Failed'));
        }
      });
      wsService.sendMessage('surface-list-actions', { requestId, surfaceId: surfaceId || '' });
    });
  },

  // ─── Surface Navigation ───

  /**
   * Open another surface by ID, optionally passing activation parameters.
   * The target surface's components can read params via
   * `surfaceApi.getState('_activationParams')`.
   *
   * @example
   * // Open a detail surface with context data
   * surfaceApi.openSurface('detail-view-abc', {
   *   selectedItem: 'item-42',
   *   mode: 'edit'
   * });
   */
  openSurface: (surfaceId: string, params?: Record<string, unknown>): Promise<void> => {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { unsub(); reject(new Error(`openSurface(${surfaceId}) timed out`)); }, 10000);
      const unsub = wsService.on('surface-open-result', (payload: unknown) => {
        const p = payload as { requestId: string; success: boolean; error: string | null };
        if (p.requestId === requestId) {
          clearTimeout(timeout); unsub();
          p.success ? resolve() : reject(new Error(p.error || 'Failed to open surface'));
        }
      });
      wsService.sendMessage('surface-open-surface', {
        requestId, surfaceId, params: params || null
      });
    });
  },

  /**
   * Get the list of all surfaces in the current workspace.
   * Useful for surface components that want to present a list of
   * surfaces the user can navigate to.
   *
   * @returns Array of surface metadata objects (id, name, description, etc.)
   */
  getSurfaces: (): Promise<Array<{ id: string; name: string; description: string; pinned: boolean }>> => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { unsub(); reject(new Error('getSurfaces timed out')); }, 10000);
      const unsub = wsService.on('surface-list', (payload: unknown) => {
        clearTimeout(timeout); unsub();
        const surfaces = payload as Array<{ id: string; name: string; description: string; pinned: boolean }>;
        resolve(surfaces);
      });
      wsService.sendMessage('get-surfaces', {});
    });
  }
};
