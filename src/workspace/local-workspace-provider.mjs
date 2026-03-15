/**
 * @file Local filesystem workspace provider
 * @module src/workspace/local-workspace-provider
 *
 * Implements {@link IWorkspaceProvider} for local filesystem workspaces.
 *
 * - `id` = absolute path to the workspace directory
 * - Workspace metadata lives in `.oboto/workspace.json`
 * - Workspace state lives in `.oboto/workspace-state.json`
 * - File I/O delegates to {@link NodeStorageBackend}
 * - Path operations delegate to {@link NodeEnvironment}
 */

import fs from 'fs';
import { IWorkspaceProvider } from './workspace-provider.mjs';

/** Directory name used for Oboto metadata inside each workspace */
const META_DIR = '.oboto';
const MANIFEST_FILE = 'workspace.json';
const STATE_FILE = 'workspace-state.json';

/**
 * Generate a URL-friendly slug from a human-readable name.
 *
 * @param {string} name
 * @returns {string}
 */
function slugify(name) {
    return name
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * @implements {IWorkspaceProvider}
 */
export class LocalWorkspaceProvider extends IWorkspaceProvider {
    /**
     * @param {object} deps
     * @param {import('../lib/backends/node-storage-backend.mjs').NodeStorageBackend} deps.storage
     * @param {import('../lib/backends/node-environment.mjs').NodeEnvironment} deps.env
     * @param {string} [deps.workspacesRoot] - Optional root directory that contains workspace dirs
     *   (used by {@link list}). When omitted, `list()` returns only the current workspace.
     */
    constructor({ storage, env, workspacesRoot }) {
        super();
        /** @type {import('../lib/backends/node-storage-backend.mjs').NodeStorageBackend} */
        this._storage = storage;
        /** @type {import('../lib/backends/node-environment.mjs').NodeEnvironment} */
        this._env = env;
        /** @type {string|undefined} */
        this._workspacesRoot = workspacesRoot;
    }

    // ── helpers ───────────────────────────────────────────────────────────

    /**
     * Resolve a file path within a workspace and validate it doesn't escape the root.
     *
     * Uses fs.promises.realpath() to resolve symlinks before checking, preventing
     * symlink-based traversal escapes (e.g., a symlink inside the workspace
     * pointing to /etc would be detected because its realpath falls outside the
     * workspace root).
     *
     * Falls back to lexical path.resolve() + path.relative() for new files
     * that don't yet exist on disk (realpath fails for non-existent paths).
     *
     * @param {string} wsPath - Absolute workspace root path
     * @param {string} filePath - Relative file path within workspace
     * @returns {Promise<string>} Resolved absolute path
     * @throws {Error} If path escapes workspace root
     */
    async _safeResolvePath(wsPath, filePath) {
        const joined = this._env.joinPath(wsPath, filePath);
        const lexicalFull = this._env.resolvePath(joined);

        // First, do a lexical check to catch obvious ../.. traversal
        // before hitting the filesystem at all.
        const lexicalRelative = this._env.relativePath
            ? this._env.relativePath(wsPath, lexicalFull)
            : lexicalFull.slice(wsPath.length + 1);
        if (
            lexicalRelative.startsWith('..') ||
            lexicalRelative.startsWith('/') ||
            lexicalRelative.startsWith('\\')
        ) {
            throw new Error(`Path "${filePath}" escapes workspace root`);
        }

        // Now resolve symlinks to catch symlink-based escapes.
        // realpath fails for non-existent paths, so we fall back to the
        // lexical resolution (safe because we already checked above).
        try {
            const realFull = await fs.promises.realpath(lexicalFull);
            let realWs;
            try {
                realWs = await fs.promises.realpath(wsPath);
            } catch {
                realWs = wsPath; // workspace root doesn't exist yet
            }
            const realRelative = this._env.relativePath
                ? this._env.relativePath(realWs, realFull)
                : realFull.slice(realWs.length + 1);
            if (
                realRelative.startsWith('..') ||
                realRelative.startsWith('/') ||
                realRelative.startsWith('\\')
            ) {
                throw new Error(`Path "${filePath}" escapes workspace root (symlink target is outside workspace)`);
            }
            return realFull;
        } catch (err) {
            if (err.code === 'ENOENT') {
                // File doesn't exist yet — lexical check passed, so this is safe
                return lexicalFull;
            }
            throw err; // Re-throw our own escape error or unexpected errors
        }
    }

    /**
     * Resolve the path to the `.oboto` metadata directory inside a workspace.
     * @param {string} wsPath - Absolute workspace path (= the workspace id)
     * @returns {string}
     */
    _metaDir(wsPath) {
        return this._env.joinPath(wsPath, META_DIR);
    }

    /**
     * Resolve the path to the workspace manifest file.
     * @param {string} wsPath
     * @returns {string}
     */
    _manifestPath(wsPath) {
        return this._env.joinPath(wsPath, META_DIR, MANIFEST_FILE);
    }

    /**
     * Resolve the path to the workspace state file.
     * @param {string} wsPath
     * @returns {string}
     */
    _statePath(wsPath) {
        return this._env.joinPath(wsPath, META_DIR, STATE_FILE);
    }

    /**
     * Read and parse a JSON file, returning `null` if missing.
     * @param {string} filePath
     * @returns {Promise<object|null>}
     */
    async _readJson(filePath) {
        try {
            const raw = await this._storage.read(filePath);
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    /**
     * Atomically write a JSON object to a file (creates parent dirs).
     * @param {string} filePath
     * @param {object} data
     * @returns {Promise<void>}
     */
    async _writeJson(filePath, data) {
        await this._storage.write(filePath, JSON.stringify(data, null, 2));
    }

    /**
     * Build a {@link WorkspaceInfo} from a manifest and optional state, or
     * synthesise one from the directory path alone.
     *
     * @param {string} wsPath
     * @param {object|null} manifest
     * @param {object|null} state
     * @returns {import('./workspace-provider.mjs').WorkspaceInfo}
     */
    _toWorkspaceInfo(wsPath, manifest, state) {
        const now = new Date().toISOString();
        return {
            id: wsPath,
            name: manifest?.name ?? this._env.basename(wsPath),
            slug: manifest?.slug ?? slugify(manifest?.name ?? this._env.basename(wsPath)),
            description: manifest?.description ?? '',
            status: state?.status ?? 'idle',
            taskGoal: state?.taskGoal ?? null,
            currentStep: state?.currentStep ?? null,
            nextSteps: state?.nextSteps ?? [],
            sharedMemory: state?.sharedMemory ?? {},
            createdAt: manifest?.createdAt ?? now,
            updatedAt: manifest?.updatedAt ?? now,
            lastActiveAt: state?.lastActiveAt ?? null,
            provider: 'local',
        };
    }

    // ── IWorkspaceProvider implementation ─────────────────────────────────

    /** @override */
    async create(name, options = {}) {
        const slug = options.slug || slugify(name);
        const parentDir = this._workspacesRoot || this._env.workingDir;
        const wsPath = this._env.resolvePath(this._env.joinPath(parentDir, slug));

        // Create workspace directory + .oboto metadata directory
        await this._storage.mkdir(this._metaDir(wsPath));

        const now = new Date().toISOString();

        const manifest = {
            name,
            slug,
            description: options.description || '',
            createdAt: now,
            updatedAt: now,
        };
        await this._writeJson(this._manifestPath(wsPath), manifest);

        const initialState = {
            status: options.initialState?.status || 'idle',
            taskGoal: options.initialState?.taskGoal || null,
            currentStep: options.initialState?.currentStep || null,
            nextSteps: options.initialState?.nextSteps || [],
            sharedMemory: options.initialState?.sharedMemory || {},
            lastActiveAt: now,
        };
        await this._writeJson(this._statePath(wsPath), initialState);

        return this._toWorkspaceInfo(wsPath, manifest, initialState);
    }

    /** @override */
    async get(id) {
        const wsPath = this._env.resolvePath(id);
        const exists = await this._storage.exists(wsPath);
        if (!exists) return null;

        const manifest = await this._readJson(this._manifestPath(wsPath));
        const state = await this._readJson(this._statePath(wsPath));
        return this._toWorkspaceInfo(wsPath, manifest, state);
    }

    /** @override */
    async list(filter = {}) {
        if (!this._workspacesRoot) {
            // No root configured — return the current working directory as the only workspace
            const ws = await this.get(this._env.workingDir);
            return ws ? [ws] : [];
        }

        const rootExists = await this._storage.exists(this._workspacesRoot);
        if (!rootExists) return [];

        const entries = await this._storage.list(this._workspacesRoot);
        /** @type {import('./workspace-provider.mjs').WorkspaceInfo[]} */
        const results = [];

        for (const entry of entries) {
            const fullPath = this._env.joinPath(this._workspacesRoot, entry);
            try {
                const stat = await this._storage.stat(fullPath);
                if (!stat.isDirectory) continue;
                const ws = await this.get(fullPath);
                if (ws) {
                    if (filter.status && ws.status !== filter.status) continue;
                    results.push(ws);
                }
            } catch {
                // skip entries that can't be stat'd
            }
        }
        return results;
    }

    /** @override */
    async update(id, updates) {
        const wsPath = this._env.resolvePath(id);
        const manifest = (await this._readJson(this._manifestPath(wsPath))) || {};
        const state = (await this._readJson(this._statePath(wsPath))) || {};

        // Separate manifest-level vs state-level fields
        const manifestFields = ['name', 'slug', 'description'];
        const stateFields = ['status', 'taskGoal', 'currentStep', 'nextSteps', 'sharedMemory'];

        let manifestDirty = false;
        let stateDirty = false;

        for (const key of manifestFields) {
            if (updates[key] !== undefined) {
                manifest[key] = updates[key];
                manifestDirty = true;
            }
        }
        for (const key of stateFields) {
            if (updates[key] !== undefined) {
                state[key] = updates[key];
                stateDirty = true;
            }
        }

        const now = new Date().toISOString();
        if (manifestDirty) {
            manifest.updatedAt = now;
            await this._storage.mkdir(this._metaDir(wsPath));
            await this._writeJson(this._manifestPath(wsPath), manifest);
        }
        if (stateDirty) {
            state.lastActiveAt = now;
            await this._storage.mkdir(this._metaDir(wsPath));
            await this._writeJson(this._statePath(wsPath), state);
        }

        return this._toWorkspaceInfo(wsPath, manifest, state);
    }

    /** @override */
    async delete(id) {
        const wsPath = this._env.resolvePath(id);
        const metaDir = this._metaDir(wsPath);
        const metaExists = await this._storage.exists(metaDir);
        if (metaExists) {
            // Remove metadata files (we don't recursively delete the whole workspace dir
            // to avoid catastrophic data loss — only the .oboto dir is cleaned)
            for (const file of [MANIFEST_FILE, STATE_FILE]) {
                const fp = this._env.joinPath(metaDir, file);
                if (await this._storage.exists(fp)) {
                    await this._storage.delete(fp);
                }
            }
        }
    }

    /** @override */
    async getState(id) {
        const wsPath = this._env.resolvePath(id);
        const state = await this._readJson(this._statePath(wsPath));
        return {
            status: state?.status ?? 'idle',
            taskGoal: state?.taskGoal ?? null,
            currentStep: state?.currentStep ?? null,
            nextSteps: state?.nextSteps ?? [],
            sharedMemory: state?.sharedMemory ?? {},
            progressData: state?.progressData ?? {},
        };
    }

    /** @override */
    async updateState(id, stateUpdate) {
        const wsPath = this._env.resolvePath(id);
        const existing = (await this._readJson(this._statePath(wsPath))) || {};

        // Merge shared_memory instead of replacing.
        // Clone into a new object to avoid mutating the caller's stateUpdate parameter.
        let effectiveUpdate = stateUpdate;
        if (stateUpdate.sharedMemory && typeof stateUpdate.sharedMemory === 'object') {
            effectiveUpdate = {
                ...stateUpdate,
                sharedMemory: {
                    ...(existing.sharedMemory || {}),
                    ...stateUpdate.sharedMemory,
                },
            };
        }

        const merged = { ...existing, ...effectiveUpdate, lastActiveAt: new Date().toISOString() };
        await this._storage.mkdir(this._metaDir(wsPath));
        await this._writeJson(this._statePath(wsPath), merged);
    }

    /** @override */
    async listFiles(id, directory = '') {
        const wsPath = this._env.resolvePath(id);
        const targetDir = directory
            ? await this._safeResolvePath(wsPath, directory)
            : wsPath;

        const exists = await this._storage.exists(targetDir);
        if (!exists) return [];

        return this._listFilesRecursive(targetDir, wsPath);
    }

    /**
     * Recursively list files under `dir`, producing paths relative to `rootPath`.
     *
     * @param {string} dir
     * @param {string} rootPath
     * @returns {Promise<import('./workspace-provider.mjs').WorkspaceFileInfo[]>}
     * @private
     */
    async _listFilesRecursive(dir, rootPath, depth = 0, maxDepth = 15) {
        if (depth >= maxDepth) return [];
        /** @type {import('./workspace-provider.mjs').WorkspaceFileInfo[]} */
        const results = [];
        let entries;
        try {
            entries = await this._storage.list(dir);
        } catch {
            return results;
        }

        for (const entry of entries) {
            // Skip .oboto metadata directory
            if (entry === META_DIR) continue;

            const fullPath = this._env.joinPath(dir, entry);
            let stat;
            try {
                stat = await this._storage.stat(fullPath);
            } catch {
                continue;
            }

            const relativePath = fullPath.slice(rootPath.length + 1); // +1 for separator

            if (stat.isDirectory) {
                results.push({
                    path: relativePath,
                    isDirectory: true,
                    updatedAt: stat.mtime?.toISOString(),
                });
                const children = await this._listFilesRecursive(fullPath, rootPath, depth + 1, maxDepth);
                results.push(...children);
            } else {
                results.push({
                    path: relativePath,
                    type: this._env.extname(entry).replace('.', ''),
                    size: stat.size,
                    isDirectory: false,
                    updatedAt: stat.mtime?.toISOString(),
                });
            }
        }
        return results;
    }

    /** @override */
    async readFile(id, filePath) {
        const wsPath = this._env.resolvePath(id);
        const fullPath = await this._safeResolvePath(wsPath, filePath);
        return this._storage.read(fullPath);
    }

    /** @override */
    async writeFile(id, filePath, content) {
        const wsPath = this._env.resolvePath(id);
        const fullPath = await this._safeResolvePath(wsPath, filePath);
        await this._storage.write(fullPath, content);
    }

    /** @override */
    async deleteFile(id, filePath) {
        const wsPath = this._env.resolvePath(id);
        const fullPath = await this._safeResolvePath(wsPath, filePath);
        await this._storage.delete(fullPath);
    }
}
