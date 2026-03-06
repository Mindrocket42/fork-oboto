/**
 * Workspace folder history manager.
 *
 * Persists a list of recently-opened workspace folders in
 * `~/.oboto/workspace-history.json` so the user can quickly re-open
 * a previously visited workspace from the UI.
 *
 * Each entry stores:
 *   - `path`       – absolute, resolved directory path
 *   - `name`       – the folder basename (convenience for display)
 *   - `lastOpened` – ISO 8601 timestamp of last visit
 *   - `openCount`  – how many times this workspace was opened
 *
 * The list is capped at MAX_ENTRIES (default 50) and ordered by
 * most-recently-opened first.
 *
 * @module src/workspace/workspace-history
 */

import fs from 'node:fs';
import path from 'node:path';
import { GLOBAL_DIR } from '../lib/paths.mjs';
import { readJsonFile, writeJsonFile } from '../lib/json-file-utils.mjs';

const HISTORY_FILE = path.join(GLOBAL_DIR, 'workspace-history.json');
const MAX_ENTRIES = 50;

/** @typedef {{ path: string; name: string; lastOpened: string; openCount: number }} WorkspaceHistoryEntry */

/**
 * In-memory cache of the history list.
 * @type {WorkspaceHistoryEntry[]}
 */
let _cache = null;

/**
 * Serialization queue for write operations.
 * Prevents interleaving of concurrent read-mutate-write cycles
 * (e.g. two rapid workspace switches firing recordWorkspaceOpen
 * concurrently — the await points between load/mutate/persist
 * would otherwise create a window for data loss).
 * @type {Promise<void>}
 */
let _writeQueue = Promise.resolve();

/**
 * Ensure the global config directory exists.
 */
async function ensureGlobalDir() {
    if (!fs.existsSync(GLOBAL_DIR)) {
        await fs.promises.mkdir(GLOBAL_DIR, { recursive: true });
    }
}

/**
 * Load the history from disk (or return the in-memory cache).
 * @returns {Promise<WorkspaceHistoryEntry[]>}
 */
export async function loadHistory() {
    if (_cache) return _cache;
    const data = await readJsonFile(HISTORY_FILE, null);
    _cache = Array.isArray(data) ? data : [];
    return _cache;
}

/**
 * Persist the current in-memory history to disk.
 */
async function persist() {
    await ensureGlobalDir();
    await writeJsonFile(HISTORY_FILE, _cache ?? []);
}

/**
 * Record a workspace folder being opened.
 * If the path already exists in history, its timestamp and count are updated
 * and it is moved to the front.  Otherwise a new entry is created.
 *
 * Writes are serialized through _writeQueue to prevent interleaving.
 *
 * @param {string} workspacePath – absolute or relative path (will be resolved)
 * @returns {Promise<WorkspaceHistoryEntry[]>} updated history list
 */
export function recordWorkspaceOpen(workspacePath) {
    let result;
    _writeQueue = _writeQueue.then(async () => {
        const resolved = path.resolve(workspacePath);
        const history = await loadHistory();

        const existingIdx = history.findIndex(e => e.path === resolved);

        if (existingIdx >= 0) {
            // Move to front, update metadata
            const [entry] = history.splice(existingIdx, 1);
            entry.lastOpened = new Date().toISOString();
            entry.openCount = (entry.openCount || 0) + 1;
            history.unshift(entry);
        } else {
            // New entry at the front
            history.unshift({
                path: resolved,
                name: path.basename(resolved),
                lastOpened: new Date().toISOString(),
                openCount: 1,
            });
        }

        // Trim to max length
        if (history.length > MAX_ENTRIES) {
            history.length = MAX_ENTRIES;
        }

        _cache = history;
        await persist();
        result = [...history];
    }).catch(() => { /* _writeQueue must never reject to avoid breaking the chain */ });
    return _writeQueue.then(() => result ?? _cache ?? []);
}

/**
 * Remove a specific workspace path from the history.
 *
 * Writes are serialized through _writeQueue to prevent interleaving.
 *
 * @param {string} workspacePath
 * @returns {Promise<WorkspaceHistoryEntry[]>} updated history list
 */
export function removeFromHistory(workspacePath) {
    let result;
    _writeQueue = _writeQueue.then(async () => {
        const resolved = path.resolve(workspacePath);
        const history = await loadHistory();
        _cache = history.filter(e => e.path !== resolved);
        await persist();
        result = [..._cache];
    }).catch(() => {});
    return _writeQueue.then(() => result ?? _cache ?? []);
}

/**
 * Clear the entire workspace history.
 *
 * Writes are serialized through _writeQueue to prevent interleaving.
 *
 * @returns {Promise<WorkspaceHistoryEntry[]>} empty array
 */
export function clearHistory() {
    _writeQueue = _writeQueue.then(async () => {
        _cache = [];
        await persist();
    }).catch(() => {});
    return _writeQueue.then(() => []);
}

/**
 * Return the current history list (most-recently-opened first).
 *
 * @returns {Promise<WorkspaceHistoryEntry[]>}
 */
export async function getHistory() {
    return loadHistory();
}
