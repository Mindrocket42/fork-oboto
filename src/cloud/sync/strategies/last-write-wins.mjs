// LastWriteWinsStrategy — Simplest conflict resolution.
// Compares updatedAt timestamps and takes the newer version.
// This preserves the current CloudWorkspaceSync behavior.

/**
 * @typedef {import('../sync-engine.mjs').ISyncStrategy} ISyncStrategy
 * @typedef {import('../sync-engine.mjs').SyncResolution} SyncResolution
 */

/**
 * Last-Write-Wins strategy — current behavior, simplest approach.
 * Compares timestamps and takes the newer version.
 *
 * @implements {ISyncStrategy}
 */
export class LastWriteWinsStrategy {
    constructor() {
        /** @type {string} */
        this.name = 'last-write-wins';
    }

    /**
     * Resolve a conflict between local and remote state.
     * The version with the later `updatedAt` timestamp wins.
     *
     * @param {object} local — Local state snapshot
     * @param {object} remote — Remote state snapshot
     * @param {object} _context — Sync context (unused by this strategy)
     * @returns {Promise<SyncResolution>}
     */
    async resolve(local, remote, _context) {
        const localTime = new Date(local.updatedAt || local.updated_at || 0).getTime();
        const remoteTime = new Date(remote.updatedAt || remote.updated_at || 0).getTime();

        if (localTime >= remoteTime) {
            return { outcome: 'local-wins', reason: 'Local version is newer or equal' };
        }
        return { outcome: 'remote-wins', reason: 'Remote version is newer' };
    }
}
