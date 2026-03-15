/**
 * Shared type definitions for @sschepis/oboto
 *
 * These types are used by both the desktop client and the cloud application.
 * The cloud app can import them via: import { ... } from '@sschepis/oboto/types'
 *
 * @module @sschepis/oboto/types
 */

// Re-export workspace types
export { IWorkspaceProvider } from '../workspace/workspace-provider.mjs';

// Re-export sync types (documented via JSDoc in sync-engine.mjs)
export { SyncEngine } from '../cloud/sync/sync-engine.mjs';

// Re-export agent profile types
export {
    personaToProfile,
    cloudAgentToProfile,
    profileToCloudAgent,
    profileToPersona,
    mergeProfiles
} from '../cloud/agent-profile.mjs';

// Re-export interface abstractions
export { IStorageBackend } from '../lib/interfaces/storage-backend.mjs';
export { IEnvironment } from '../lib/interfaces/environment.mjs';

// Re-export cloud event bridge
export { CloudEventBridge } from '../cloud/cloud-event-bridge.mjs';

/**
 * @typedef {Object} WorkspaceInfo — See workspace-provider.mjs
 * @typedef {Object} WorkspaceState — See workspace-provider.mjs
 * @typedef {Object} WorkspaceFileInfo — See workspace-provider.mjs
 * @typedef {Object} AgentProfile — See agent-profile.mjs
 * @typedef {Object} ISyncProvider — See sync-engine.mjs
 * @typedef {Object} ISyncStrategy — See sync-engine.mjs
 * @typedef {Object} SyncResult — See sync-engine.mjs
 * @typedef {Object} SyncResolution — See sync-engine.mjs
 */
