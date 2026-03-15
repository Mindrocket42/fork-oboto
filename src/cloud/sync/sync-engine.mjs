// SyncEngine — Event-driven sync coordinator with pluggable conflict resolution.
//
// Replaces the timer-based auto-sync in CloudSync with a smarter approach:
// - Change detection via version vectors or timestamps
// - Pluggable conflict resolution strategies per data type
// - Sync event log for audit trail
// - Debounced batch sync for efficiency

import { LastWriteWinsStrategy } from './strategies/last-write-wins.mjs';

// ── JSDoc Type Definitions ──────────────────────────────────────────────────

/**
 * @typedef {Object} ISyncProvider
 * @property {() => Promise<object>} getLocal — Get local state snapshot
 * @property {() => Promise<object>} getRemote — Get remote state snapshot
 * @property {(data: object) => Promise<void>} pushLocal — Push local state to remote
 * @property {(data: object) => Promise<void>} applyRemote — Apply remote state locally
 * @property {(local: object, remote: object) => string} getVersion — Get version identifier
 */

/**
 * @typedef {Object} ISyncStrategy
 * @property {string} name — Strategy name
 * @property {(local: object, remote: object, context: object) => Promise<SyncResolution>} resolve
 */

/**
 * @typedef {Object} SyncResolution
 * @property {'local-wins'|'remote-wins'|'merged'|'conflict'} outcome
 * @property {object} [mergedData] — The merged result (for 'merged' outcome)
 * @property {string} [reason] — Human-readable explanation
 * @property {string} [conflictId] — For manual resolution tracking
 */

/**
 * @typedef {Object} SyncResult
 * @property {string} dataType
 * @property {'synced'|'conflict'|'error'|'skipped'} status
 * @property {string} [error]
 * @property {SyncResolution} [resolution]
 * @property {number} timestamp
 */

/**
 * @typedef {Object} SyncLogEntry
 * @property {string} dataType
 * @property {'push'|'pull'|'conflict'|'resolved'|'error'} action
 * @property {string} [detail]
 * @property {number} timestamp
 */

/**
 * @typedef {Object} SyncStatus
 * @property {'idle'|'syncing'|'error'|'conflict'} state
 * @property {number} lastSyncAt
 * @property {number} [nextSyncAt]
 * @property {string} [error]
 */

// ── SyncEngine ──────────────────────────────────────────────────────────────

/**
 * SyncEngine — Event-driven sync coordinator with pluggable conflict resolution.
 *
 * Can be used independently of CloudSync for testing and modularity.
 *
 * Events emitted via eventBus:
 *   - `cloud:sync:started`   { dataType }
 *   - `cloud:sync:completed` { dataType, status, resolution }
 *   - `cloud:sync:conflict`  { conflictId, dataType, local, remote }
 *   - `cloud:sync:error`     { dataType, error }
 *   - `cloud:sync:resolved`  { conflictId, dataType, resolution }
 */
export class SyncEngine {
    /**
     * @param {object} options
     * @param {import('../../lib/event-bus.mjs').AiManEventBus} options.eventBus
     * @param {import('../cloud-client.mjs').CloudClient} options.client
     * @param {Object<string, ISyncStrategy>} [options.strategies] — Map of data type → conflict strategy
     * @param {number} [options.debounceMs=2000] — Debounce window for batching changes
     * @param {number} [options.maxRetries=3] — Max retry attempts for failed syncs
     */
    constructor(options) {
        this.eventBus = options.eventBus;
        this.client = options.client;
        this.debounceMs = options.debounceMs ?? 2000;
        this.maxRetries = options.maxRetries ?? 3;

        /**
         * Registered sync providers keyed by data type.
         * @type {Map<string, ISyncProvider>}
         */
        this._providers = new Map();

        /**
         * Conflict resolution strategies keyed by data type.
         * @type {Map<string, ISyncStrategy>}
         */
        this._strategies = new Map();

        // Seed initial strategies if provided
        if (options.strategies) {
            for (const [dt, strategy] of Object.entries(options.strategies)) {
                this._strategies.set(dt, strategy);
            }
        }

        /**
         * Per-data-type sync status.
         * @type {Map<string, SyncStatus>}
         */
        this._status = new Map();

        /**
         * Circular sync log.
         * @type {SyncLogEntry[]}
         */
        this._log = [];

        /** @type {number} Max log entries retained */
        this._maxLogEntries = 200;

        /**
         * Debounce timers keyed by data type.
         * @type {Map<string, ReturnType<typeof setTimeout>>}
         */
        this._debounceTimers = new Map();

        /**
         * Retry counters keyed by data type.
         * @type {Map<string, number>}
         */
        this._retryCounts = new Map();

        /**
         * Active retry timers keyed by data type — tracked for cleanup.
         * @type {Map<string, ReturnType<typeof setTimeout>>}
         */
        this._retryTimers = new Map();

        /**
         * Per-data-type sync-in-progress guard.
         * Prevents concurrent sync() calls for the same dataType
         * from the debounce timer, fallback interval, and remote-change
         * notifications racing each other.
         * @type {Set<string>}
         */
        this._syncInProgress = new Set();

        /**
         * Cached "base" snapshots for three-way merge, keyed by data type.
         * Updated after every successful sync.
         * @type {Map<string, object>}
         */
        this._baseSnapshots = new Map();

        /** @type {boolean} Whether the engine is running */
        this._running = false;

        /**
         * Bound event listeners for cleanup.
         * @type {Array<{ event: string, handler: Function }>}
         */
        this._listeners = [];
    }

    // ── Provider / Strategy Registration ─────────────────────────────────

    /**
     * Register a sync provider for a data type.
     * @param {string} dataType — e.g. 'workspace-state', 'conversations', 'files'
     * @param {ISyncProvider} provider
     */
    registerProvider(dataType, provider) {
        this._providers.set(dataType, provider);
        this._status.set(dataType, {
            state: 'idle',
            lastSyncAt: 0,
            nextSyncAt: undefined,
            error: undefined,
        });
    }

    /**
     * Set the conflict resolution strategy for a data type.
     * @param {string} dataType
     * @param {ISyncStrategy} strategy
     */
    setStrategy(dataType, strategy) {
        this._strategies.set(dataType, strategy);
    }

    // ── Change Notifications ─────────────────────────────────────────────

    /**
     * Notify the engine that local data has changed.
     * Triggers a debounced sync for the affected data type.
     *
     * @param {string} dataType
     * @param {object} changeInfo — { field, oldValue, newValue, timestamp }
     */
    notifyLocalChange(dataType, changeInfo) {
        if (!this._running) return;
        if (!this._providers.has(dataType)) return;

        this._addLog(dataType, 'push', `Local change: ${changeInfo?.field || 'unknown field'}`);

        // Debounce: reset timer for this data type
        const existing = this._debounceTimers.get(dataType);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
            this._debounceTimers.delete(dataType);
            this.sync(dataType).catch(err => {
                this._addLog(dataType, 'error', `Debounced sync failed: ${err.message}`);
            });
        }, this.debounceMs);

        // Don't keep process alive for sync debounce
        if (timer.unref) timer.unref();

        this._debounceTimers.set(dataType, timer);

        // Update next sync time estimate
        const status = this._status.get(dataType);
        if (status) {
            status.nextSyncAt = Date.now() + this.debounceMs;
        }
    }

    /**
     * Notify the engine that remote data has changed.
     * Triggers a short-debounced sync to coalesce burst events from
     * Supabase Realtime without causing sync storms.
     *
     * Uses the `remote:${dataType}` key in `_debounceTimers` to avoid
     * collision with local-change debounce timers.
     *
     * @param {string} dataType
     * @param {object} changeInfo
     */
    notifyRemoteChange(dataType, changeInfo) {
        if (!this._running) return;
        if (!this._providers.has(dataType)) return;

        this._addLog(dataType, 'pull', `Remote change detected: ${changeInfo?.field || 'update'}`);

        // Short debounce to coalesce burst remote events
        const timerKey = `remote:${dataType}`;
        const existing = this._debounceTimers.get(timerKey);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
            this._debounceTimers.delete(timerKey);
            this.sync(dataType).catch(err => {
                this._addLog(dataType, 'error', `Remote-triggered sync failed: ${err.message}`);
            });
        }, 500);

        if (timer.unref) timer.unref();
        this._debounceTimers.set(timerKey, timer);
    }

    // ── Sync Operations ──────────────────────────────────────────────────

    /**
     * Force immediate sync of all registered data types.
     * @returns {Promise<SyncResult[]>}
     */
    async syncAll() {
        const results = [];
        for (const dataType of this._providers.keys()) {
            const result = await this.sync(dataType);
            results.push(result);
        }
        return results;
    }

    /**
     * Force immediate sync of a specific data type.
     *
     * Algorithm:
     *   1. Get local + remote snapshots
     *   2. Compare versions
     *   3. If versions differ → run conflict strategy
     *   4. Apply resolution (push local / apply remote / apply merged)
     *   5. Update base snapshot
     *
     * @param {string} dataType
     * @returns {Promise<SyncResult>}
     */
    async sync(dataType) {
        const provider = this._providers.get(dataType);
        if (!provider) {
            return { dataType, status: 'skipped', timestamp: Date.now() };
        }

        // Guard: prevent concurrent sync for the same data type.
        // If a sync is already in progress (from debounce timer, fallback
        // interval, or remote-change notification), skip this invocation.
        if (this._syncInProgress.has(dataType)) {
            this._addLog(dataType, 'push', 'Skipped — sync already in progress');
            return { dataType, status: 'skipped', timestamp: Date.now() };
        }
        this._syncInProgress.add(dataType);

        // Update status
        this._setStatus(dataType, 'syncing');
        this._emitEvent('cloud:sync:started', { dataType });

        try {
            // 1. Get snapshots
            const [local, remote] = await Promise.all([
                provider.getLocal(),
                provider.getRemote(),
            ]);

            // 2. Compare versions
            const localVersion = provider.getVersion(local, null);
            const remoteVersion = provider.getVersion(null, remote);

            if (localVersion === remoteVersion) {
                // Already in sync
                const result = { dataType, status: 'skipped', timestamp: Date.now() };
                this._setStatus(dataType, 'idle');
                this._addLog(dataType, 'push', 'Already in sync (versions match)');
                this._emitEvent('cloud:sync:completed', { dataType, status: 'skipped' });
                return result;
            }

            // 3. Run conflict strategy
            const strategy = this._strategies.get(dataType) || new LastWriteWinsStrategy();
            const base = this._baseSnapshots.get(dataType) || {};

            const resolution = await strategy.resolve(local, remote, {
                dataType,
                base,
                localVersion,
                remoteVersion,
            });

            // 4. Apply resolution
            await this._applyResolution(dataType, provider, local, remote, resolution);

            // 5. Update base snapshot on success
            if (resolution.outcome !== 'conflict') {
                const newBase = resolution.mergedData || (resolution.outcome === 'local-wins' ? local : remote);
                this._baseSnapshots.set(dataType, newBase);
                this._retryCounts.set(dataType, 0);
            }

            const status = resolution.outcome === 'conflict' ? 'conflict' : 'synced';
            this._setStatus(dataType, status === 'conflict' ? 'conflict' : 'idle');

            const result = { dataType, status, resolution, timestamp: Date.now() };
            this._addLog(dataType, resolution.outcome === 'conflict' ? 'conflict' : 'resolved',
                resolution.reason || resolution.outcome);
            this._emitEvent('cloud:sync:completed', { dataType, status, resolution });

            return result;
        } catch (err) {
            const retries = (this._retryCounts.get(dataType) || 0) + 1;
            this._retryCounts.set(dataType, retries);

            this._setStatus(dataType, 'error', err.message);
            this._addLog(dataType, 'error', `${err.message} (attempt ${retries}/${this.maxRetries})`);
            this._emitEvent('cloud:sync:error', { dataType, error: err.message });

            // Retry with exponential backoff (tracked for cleanup)
            if (retries < this.maxRetries && this._running) {
                // Cancel any existing retry timer for this data type
                const existingRetry = this._retryTimers.get(dataType);
                if (existingRetry) clearTimeout(existingRetry);

                const delay = Math.min(1000 * Math.pow(2, retries), 30000);
                const retryTimer = setTimeout(() => {
                    this._retryTimers.delete(dataType);
                    this.sync(dataType).catch(() => { /* logged above */ });
                }, delay);
                if (retryTimer.unref) retryTimer.unref();
                this._retryTimers.set(dataType, retryTimer);
            }

            return { dataType, status: 'error', error: err.message, timestamp: Date.now() };
        } finally {
            this._syncInProgress.delete(dataType);
        }
    }

    // ── Resolution Application ───────────────────────────────────────────

    /**
     * Apply a sync resolution by delegating to the provider.
     *
     * @param {string} dataType
     * @param {ISyncProvider} provider
     * @param {object} local
     * @param {object} remote
     * @param {SyncResolution} resolution
     * @returns {Promise<void>}
     */
    async _applyResolution(dataType, provider, local, remote, resolution) {
        switch (resolution.outcome) {
            case 'local-wins':
                // Push local state to remote
                await provider.pushLocal(local);
                this._addLog(dataType, 'push', 'Pushed local state (local-wins)');
                break;

            case 'remote-wins':
                // Apply remote state locally
                await provider.applyRemote(remote);
                this._addLog(dataType, 'pull', 'Applied remote state (remote-wins)');
                break;

            case 'merged': {
                // Push merged data to remote, then apply locally
                const merged = resolution.mergedData;
                if (merged) {
                    await provider.pushLocal(merged);
                    await provider.applyRemote(merged);
                    this._addLog(dataType, 'resolved', 'Applied merged state to both sides');
                }
                break;
            }

            case 'conflict':
                // No action — awaiting manual resolution
                this._addLog(dataType, 'conflict', resolution.reason || 'Conflict awaiting resolution');
                break;

            default:
                this._addLog(dataType, 'error', `Unknown resolution outcome: ${resolution.outcome}`);
        }
    }

    // ── Status & Logging ─────────────────────────────────────────────────

    /**
     * Get the sync log (recent operations).
     * @param {number} [limit=50]
     * @returns {SyncLogEntry[]}
     */
    getLog(limit = 50) {
        return this._log.slice(-limit);
    }

    /**
     * Get current sync status for all data types.
     * @returns {Object<string, SyncStatus>}
     */
    getStatus() {
        /** @type {Object<string, SyncStatus>} */
        const result = {};
        for (const [dt, status] of this._status) {
            result[dt] = { ...status };
        }
        return result;
    }

    /**
     * @param {string} dataType
     * @param {SyncStatus['state']} state
     * @param {string} [error]
     */
    _setStatus(dataType, state, error) {
        const existing = this._status.get(dataType) || { state: 'idle', lastSyncAt: 0 };
        existing.state = state;
        if (state === 'idle') {
            // Only update lastSyncAt on successful completion (idle),
            // not when sync starts (syncing), so monitoring code gets
            // an accurate "last successful sync" timestamp.
            existing.lastSyncAt = Date.now();
            existing.error = undefined;
        } else if (state === 'syncing') {
            existing.error = undefined;
        }
        if (error) {
            existing.error = error;
        }
        this._status.set(dataType, existing);
    }

    /**
     * @param {string} dataType
     * @param {SyncLogEntry['action']} action
     * @param {string} [detail]
     */
    _addLog(dataType, action, detail) {
        this._log.push({ dataType, action, detail, timestamp: Date.now() });
        // Trim log
        if (this._log.length > this._maxLogEntries) {
            this._log = this._log.slice(-this._maxLogEntries);
        }
    }

    /**
     * Emit a typed event on the event bus if available.
     *
     * @param {string} event
     * @param {object} payload
     */
    _emitEvent(event, payload) {
        if (this.eventBus) {
            this.eventBus.emitTyped(event, payload);
        }
    }

    // ── Lifecycle ────────────────────────────────────────────────────────

    /**
     * Start the engine (begin listening for events).
     */
    start() {
        if (this._running) return;
        this._running = true;

        // Listen for remote update events from CloudRealtime
        if (this.eventBus) {
            const onRemoteUpdate = (payload) => {
                // Route workspace remote updates to the workspace-state provider
                this.notifyRemoteChange('workspace-state', {
                    field: 'remote-update',
                    ...payload,
                });
            };
            this.eventBus.on('cloud:workspace:remote-update', onRemoteUpdate);
            this._listeners.push({ event: 'cloud:workspace:remote-update', handler: onRemoteUpdate });
        }

        this._addLog('engine', 'resolved', 'SyncEngine started');
    }

    /**
     * Stop the engine (cleanup timers and listeners).
     */
    stop() {
        this._running = false;

        // Clear all debounce timers
        for (const timer of this._debounceTimers.values()) {
            clearTimeout(timer);
        }
        this._debounceTimers.clear();

        // Clear all retry timers
        for (const timer of this._retryTimers.values()) {
            clearTimeout(timer);
        }
        this._retryTimers.clear();

        // Remove event listeners
        if (this.eventBus) {
            for (const { event, handler } of this._listeners) {
                this.eventBus.removeListener(event, handler);
            }
        }
        this._listeners = [];

        this._addLog('engine', 'resolved', 'SyncEngine stopped');
    }
}
