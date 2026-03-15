// MergeFieldsStrategy — Field-level merge for workspace state.
// Merges non-conflicting field changes; falls back to local-wins for conflicts.

/**
 * @typedef {import('../sync-engine.mjs').ISyncStrategy} ISyncStrategy
 * @typedef {import('../sync-engine.mjs').SyncResolution} SyncResolution
 */

/**
 * Field-level merge strategy — merges non-conflicting field changes.
 *
 * For workspace state fields:
 *   - sharedMemory / shared_memory: deep merge (both sides' keys are kept)
 *   - nextSteps / next_steps: union of both lists
 *   - status: last-write-wins
 *   - taskGoal / task_goal, currentStep / current_step: last-write-wins
 *   - progressData / progress_data: deep merge
 *
 * When the same field was changed differently on both sides, a conflict is
 * detected.  Conflicting fields fall back to local-wins.
 *
 * @implements {ISyncStrategy}
 */
export class MergeFieldsStrategy {
    constructor() {
        /** @type {string} */
        this.name = 'merge-fields';
    }

    /**
     * Resolve a conflict between local and remote state via field-level merge.
     *
     * @param {object} local — Local state snapshot
     * @param {object} remote — Remote state snapshot
     * @param {object} context — { base, dataType, ... }
     * @returns {Promise<SyncResolution>}
     */
    async resolve(local, remote, context) {
        const base = context.base || {};

        const conflicts = this._findConflicts(local, remote, base);

        if (conflicts.length === 0) {
            const merged = this._merge(local, remote, base);
            return {
                outcome: 'merged',
                mergedData: merged,
                reason: 'Clean merge — no conflicting fields',
            };
        }

        const merged = this._mergeWithFallback(local, remote, base);
        return {
            outcome: 'merged',
            mergedData: merged,
            reason: `Merged with ${conflicts.length} conflict(s) resolved via local-wins fallback`,
        };
    }

    /**
     * Detect fields changed differently on both sides relative to base.
     *
     * @param {object} local
     * @param {object} remote
     * @param {object} base
     * @returns {string[]} List of conflicting field names
     */
    _findConflicts(local, remote, base) {
        const allKeys = new Set([
            ...Object.keys(local || {}),
            ...Object.keys(remote || {}),
        ]);

        const conflicts = [];

        for (const key of allKeys) {
            // Skip metadata fields
            if (key === 'updatedAt' || key === 'updated_at' || key === 'lastSyncAt') continue;

            const baseVal = base[key];
            const localVal = local[key];
            const remoteVal = remote[key];

            const localChanged = !this._deepEqual(localVal, baseVal);
            const remoteChanged = !this._deepEqual(remoteVal, baseVal);

            // Conflict: both sides changed the same field to different values
            if (localChanged && remoteChanged && !this._deepEqual(localVal, remoteVal)) {
                conflicts.push(key);
            }
        }

        return conflicts;
    }

    /**
     * Merge local and remote with no conflicts (clean merge).
     *
     * @param {object} local
     * @param {object} remote
     * @param {object} base
     * @returns {object}
     */
    _merge(local, remote, base) {
        const result = { ...base };
        const allKeys = new Set([
            ...Object.keys(local || {}),
            ...Object.keys(remote || {}),
            ...Object.keys(base || {}),
        ]);

        for (const key of allKeys) {
            if (key === 'updatedAt' || key === 'updated_at') continue;

            const baseVal = base[key];
            const localVal = local[key];
            const remoteVal = remote[key];

            const localChanged = !this._deepEqual(localVal, baseVal);
            const remoteChanged = !this._deepEqual(remoteVal, baseVal);

            if (localChanged && !remoteChanged) {
                result[key] = localVal;
            } else if (!localChanged && remoteChanged) {
                result[key] = remoteVal;
            } else if (localChanged && remoteChanged) {
                // Both changed to same value — fine
                result[key] = this._mergeField(key, localVal, remoteVal);
            } else {
                result[key] = baseVal !== undefined ? baseVal : localVal;
            }
        }

        result.updated_at = new Date().toISOString();
        return result;
    }

    /**
     * Merge with local-wins fallback for conflicting fields.
     *
     * @param {object} local
     * @param {object} remote
     * @param {object} base
     * @returns {object}
     */
    _mergeWithFallback(local, remote, base) {
        const conflicts = new Set(this._findConflicts(local, remote, base));
        const result = { ...base };
        const allKeys = new Set([
            ...Object.keys(local || {}),
            ...Object.keys(remote || {}),
            ...Object.keys(base || {}),
        ]);

        for (const key of allKeys) {
            if (key === 'updatedAt' || key === 'updated_at') continue;

            const baseVal = base[key];
            const localVal = local[key];
            const remoteVal = remote[key];

            if (conflicts.has(key)) {
                // Conflict: use field-specific merge semantics (deep-merge
                // objects, union arrays) and fall back to local-wins for scalars.
                result[key] = this._mergeField(key, localVal, remoteVal);
            } else {
                const localChanged = !this._deepEqual(localVal, baseVal);
                const remoteChanged = !this._deepEqual(remoteVal, baseVal);

                if (localChanged && !remoteChanged) {
                    result[key] = localVal;
                } else if (!localChanged && remoteChanged) {
                    result[key] = remoteVal;
                } else {
                    result[key] = this._mergeField(key, localVal, remoteVal);
                }
            }
        }

        result.updated_at = new Date().toISOString();
        return result;
    }

    /**
     * Merge a single field according to field-type semantics.
     *
     * @param {string} key
     * @param {*} localVal
     * @param {*} remoteVal
     * @returns {*}
     */
    _mergeField(key, localVal, remoteVal) {
        // Deep-merge object fields (shared_memory, progress_data)
        if (
            (key === 'shared_memory' || key === 'sharedMemory' ||
             key === 'progress_data' || key === 'progressData') &&
            this._isPlainObject(localVal) && this._isPlainObject(remoteVal)
        ) {
            return this._deepMerge(localVal, remoteVal);
        }

        // Union arrays (next_steps, nextSteps)
        if (
            (key === 'next_steps' || key === 'nextSteps') &&
            Array.isArray(localVal) && Array.isArray(remoteVal)
        ) {
            return this._unionArrays(localVal, remoteVal);
        }

        // Scalar fields: default to local value
        return localVal !== undefined ? localVal : remoteVal;
    }

    /** Maximum recursion depth for _deepMerge and _deepEqual to prevent stack overflow */
    static MAX_DEPTH = 50;

    /**
     * Deep merge two plain objects.  Remote keys are added if not present locally.
     *
     * @param {object} a
     * @param {object} b
     * @param {number} [depth=0] - Current recursion depth (capped at MAX_DEPTH)
     * @returns {object}
     */
    _deepMerge(a, b, depth = 0) {
        if (depth >= MergeFieldsStrategy.MAX_DEPTH) return { ...a };
        const result = { ...a };
        for (const key of Object.keys(b)) {
            // Guard against prototype pollution
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
            if (!(key in result)) {
                result[key] = b[key];
            } else if (this._isPlainObject(result[key]) && this._isPlainObject(b[key])) {
                result[key] = this._deepMerge(result[key], b[key], depth + 1);
            }
            // If both have the key and they're not objects, keep local (a)
        }
        return result;
    }

    /** Maximum number of elements in a union-merged array */
    static MAX_UNION_SIZE = 500;

    /**
     * Union two arrays, deduplicating by JSON serialization of elements.
     * Capped at MAX_UNION_SIZE to prevent unbounded growth from repeated merges.
     *
     * @param {Array} a
     * @param {Array} b
     * @returns {Array}
     */
    _unionArrays(a, b) {
        const seen = new Set(a.map(item => JSON.stringify(item)));
        const result = [...a];
        for (const item of b) {
            if (result.length >= MergeFieldsStrategy.MAX_UNION_SIZE) break;
            const key = JSON.stringify(item);
            if (!seen.has(key)) {
                result.push(item);
                seen.add(key);
            }
        }
        return result;
    }

    /**
     * @param {*} val
     * @returns {boolean}
     */
    _isPlainObject(val) {
        return val !== null && typeof val === 'object' && !Array.isArray(val);
    }

    /**
     * Simple deep equality check.
     *
     * @param {*} a
     * @param {*} b
     * @param {number} [depth=0] - Current recursion depth (capped at MAX_DEPTH)
     * @returns {boolean}
     */
    _deepEqual(a, b, depth = 0) {
        if (a === b) return true;
        if (a == null || b == null) return a == b;
        if (typeof a !== typeof b) return false;
        if (depth >= MergeFieldsStrategy.MAX_DEPTH) return false;

        if (Array.isArray(a)) {
            if (!Array.isArray(b) || a.length !== b.length) return false;
            return a.every((v, i) => this._deepEqual(v, b[i], depth + 1));
        }

        if (typeof a === 'object') {
            const keysA = Object.keys(a);
            const keysB = Object.keys(b);
            if (keysA.length !== keysB.length) return false;
            return keysA.every(k => this._deepEqual(a[k], b[k], depth + 1));
        }

        return false;
    }
}
