// ManualResolutionStrategy — Emits a conflict event for user resolution.
// Returns 'conflict' outcome; requires explicit resolveConflict() call.

/**
 * @typedef {import('../sync-engine.mjs').ISyncStrategy} ISyncStrategy
 * @typedef {import('../sync-engine.mjs').SyncResolution} SyncResolution
 */

/**
 * Manual resolution strategy — emits a conflict event and waits for
 * explicit user resolution via {@link ManualResolutionStrategy.resolveConflict}.
 *
 * Pending conflicts are stored in-memory keyed by a generated `conflictId`.
 * The engine will report `status: 'conflict'` until the conflict is resolved.
 *
 * @implements {ISyncStrategy}
 */
export class ManualResolutionStrategy {
    /**
     * @param {import('../../../lib/event-bus.mjs').AiManEventBus} [eventBus]
     */
    constructor(eventBus) {
        /** @type {string} */
        this.name = 'manual';

        /** @type {import('../../../lib/event-bus.mjs').AiManEventBus|undefined} */
        this.eventBus = eventBus;

        /**
         * Pending conflicts awaiting manual resolution.
         * @type {Map<string, { local: object, remote: object, context: object }>}
         */
        this._pendingConflicts = new Map();
    }

    /**
     * "Resolve" by recording the conflict and notifying listeners.
     *
     * @param {object} local — Local state snapshot
     * @param {object} remote — Remote state snapshot
     * @param {object} context — { dataType, base, ... }
     * @returns {Promise<SyncResolution & { conflictId: string }>}
     */
    async resolve(local, remote, context) {
        const conflictId = `${context.dataType || 'unknown'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        this._pendingConflicts.set(conflictId, { local, remote, context });

        if (this.eventBus) {
            this.eventBus.emitTyped('cloud:sync:conflict', {
                conflictId,
                dataType: context.dataType,
                local: this._summarize(local),
                remote: this._summarize(remote),
            });
        }

        return {
            outcome: 'conflict',
            reason: 'Awaiting manual resolution',
            conflictId,
        };
    }

    /**
     * Resolve a pending conflict.
     *
     * @param {string} conflictId
     * @param {'local-wins'|'remote-wins'} choice
     * @returns {SyncResolution | null} The resolution, or null if conflictId not found
     */
    resolveConflict(conflictId, choice) {
        const entry = this._pendingConflicts.get(conflictId);
        if (!entry) return null;

        this._pendingConflicts.delete(conflictId);

        /** @type {SyncResolution} */
        const resolution = {
            outcome: choice,
            reason: `Manual resolution: ${choice}`,
        };

        if (choice === 'merged') {
            // For merged, caller must provide mergedData separately — we don't support
            // interactive merge in this strategy.  Default to local-wins.
            resolution.outcome = 'local-wins';
            resolution.reason = 'Manual resolution: merged not supported, defaulting to local-wins';
        }

        if (this.eventBus) {
            this.eventBus.emitTyped('cloud:sync:resolved', {
                conflictId,
                dataType: entry.context.dataType,
                resolution,
            });
        }

        return resolution;
    }

    /**
     * Get all pending (unresolved) conflicts.
     * @returns {Array<{ conflictId: string, dataType: string, local: object, remote: object }>}
     */
    getPendingConflicts() {
        const result = [];
        for (const [conflictId, entry] of this._pendingConflicts) {
            result.push({
                conflictId,
                dataType: entry.context.dataType,
                local: this._summarize(entry.local),
                remote: this._summarize(entry.remote),
            });
        }
        return result;
    }

    /**
     * Create a summary of a data snapshot for display purposes.
     * Truncates large values to keep event payloads manageable.
     *
     * @param {object} data
     * @returns {object}
     */
    _summarize(data) {
        if (!data || typeof data !== 'object') return data;

        const summary = {};
        for (const [key, value] of Object.entries(data)) {
            if (typeof value === 'string' && value.length > 200) {
                summary[key] = value.slice(0, 200) + '…';
            } else if (Array.isArray(value)) {
                summary[key] = `[Array(${value.length})]`;
            } else if (value && typeof value === 'object') {
                summary[key] = `{${Object.keys(value).length} keys}`;
            } else {
                summary[key] = value;
            }
        }
        return summary;
    }
}
