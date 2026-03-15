/**
 * @file Abstract workspace provider interface (IWorkspaceProvider)
 * @module src/workspace/workspace-provider
 *
 * Defines the unified contract that both local-filesystem and Supabase-backed
 * workspace providers must implement.  Consumers code against this interface
 * so that workspace CRUD, state management, and file I/O work identically
 * regardless of the backing store.
 *
 * Implementations:
 *   - {@link LocalWorkspaceProvider}  (filesystem)
 *   - {@link SupabaseWorkspaceProvider} (cloud / Supabase)
 */

// ──────────────────────────────────────────────────────────────────────────────
// JSDoc type definitions
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} WorkspaceInfo
 * @property {string} id - Unique identifier (absolute path for local, UUID for cloud)
 * @property {string} name - Human-readable name
 * @property {string} [slug] - URL-friendly slug
 * @property {string} [description] - Description
 * @property {'idle'|'working'|'paused'|'completed'|'error'} status
 * @property {string|null} taskGoal - Current high-level goal
 * @property {string|null} currentStep - Current work item
 * @property {string[]} nextSteps - Ordered list of next steps
 * @property {Object} sharedMemory - Key-value shared state
 * @property {string} createdAt - ISO 8601 timestamp
 * @property {string} updatedAt - ISO 8601 timestamp
 * @property {string} [lastActiveAt] - ISO 8601 timestamp
 * @property {'local'|'cloud'} provider - Which provider manages this workspace
 */

/**
 * @typedef {Object} WorkspaceState
 * @property {'idle'|'working'|'paused'|'completed'|'error'} status
 * @property {string|null} taskGoal
 * @property {string|null} currentStep
 * @property {string[]} nextSteps
 * @property {Object} sharedMemory
 * @property {Object} [progressData]
 */

/**
 * @typedef {Object} WorkspaceFileInfo
 * @property {string} path - Relative path within workspace
 * @property {string} [type] - File extension / type
 * @property {number} [size] - File size in bytes
 * @property {string} [mimeType]
 * @property {string} [updatedAt] - ISO 8601 timestamp
 * @property {boolean} isDirectory
 */

// ──────────────────────────────────────────────────────────────────────────────
// Abstract base class
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Abstract workspace provider interface.
 *
 * Every method throws `"Not implemented"` by default — concrete subclasses
 * **must** override every method they intend to support.
 */
export class IWorkspaceProvider {
    /**
     * Create a new workspace.
     *
     * @param {string} name - Human-readable workspace name
     * @param {object} [options] - Creation options
     * @param {string} [options.description] - Workspace description
     * @param {string} [options.slug] - URL-friendly slug (auto-generated if omitted)
     * @param {object} [options.initialState] - Initial workspace state
     * @returns {Promise<WorkspaceInfo>}
     */
    async create(name, options = {}) {
        throw new Error('Not implemented');
    }

    /**
     * Get workspace by ID.
     *
     * @param {string} id - Workspace identifier
     * @returns {Promise<WorkspaceInfo|null>}
     */
    async get(id) {
        throw new Error('Not implemented');
    }

    /**
     * List all accessible workspaces.
     *
     * @param {object} [filter] - Optional filters
     * @returns {Promise<WorkspaceInfo[]>}
     */
    async list(filter = {}) {
        throw new Error('Not implemented');
    }

    /**
     * Update workspace metadata or state.
     *
     * @param {string} id - Workspace identifier
     * @param {object} updates - Fields to update
     * @returns {Promise<WorkspaceInfo>}
     */
    async update(id, updates) {
        throw new Error('Not implemented');
    }

    /**
     * Delete a workspace.
     *
     * @param {string} id - Workspace identifier
     * @returns {Promise<void>}
     */
    async delete(id) {
        throw new Error('Not implemented');
    }

    /**
     * Get workspace state (task_goal, current_step, next_steps, status, etc.).
     *
     * @param {string} id
     * @returns {Promise<WorkspaceState>}
     */
    async getState(id) {
        throw new Error('Not implemented');
    }

    /**
     * Update workspace state.
     *
     * @param {string} id
     * @param {object} state - Partial state update
     * @returns {Promise<void>}
     */
    async updateState(id, state) {
        throw new Error('Not implemented');
    }

    /**
     * List files in a workspace.
     *
     * @param {string} id - Workspace identifier
     * @param {string} [directory] - Optional subdirectory path (relative to workspace root)
     * @returns {Promise<WorkspaceFileInfo[]>}
     */
    async listFiles(id, directory = '') {
        throw new Error('Not implemented');
    }

    /**
     * Read a file from a workspace.
     *
     * @param {string} id - Workspace identifier
     * @param {string} filePath - Relative file path within the workspace
     * @returns {Promise<string>}
     */
    async readFile(id, filePath) {
        throw new Error('Not implemented');
    }

    /**
     * Write a file to a workspace.
     *
     * @param {string} id - Workspace identifier
     * @param {string} filePath - Relative file path within the workspace
     * @param {string} content - File content
     * @returns {Promise<void>}
     */
    async writeFile(id, filePath, content) {
        throw new Error('Not implemented');
    }

    /**
     * Delete a file from a workspace.
     *
     * @param {string} id - Workspace identifier
     * @param {string} filePath - Relative file path within the workspace
     * @returns {Promise<void>}
     */
    async deleteFile(id, filePath) {
        throw new Error('Not implemented');
    }
}
