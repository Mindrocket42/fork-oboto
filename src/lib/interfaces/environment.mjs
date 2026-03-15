/**
 * @file IEnvironment interface definition
 * @description Abstracts platform-specific path and environment operations
 *   so the core is not coupled to Node.js `process` or `path` globals.
 */

/**
 * @typedef {Object} IEnvironment
 * @property {string} workingDir - Current working directory
 * @property {string} platform - 'node', 'deno', 'browser', 'edge'
 * @property {(key: string) => string|undefined} getEnv - Read environment variable
 * @property {(segments: string[]) => string} joinPath - Join path segments
 * @property {(p: string) => string} resolvePath - Resolve to absolute path
 * @property {(p: string) => string} dirname - Get directory name
 * @property {(p: string) => string} basename - Get base name
 * @property {(p: string) => string} extname - Get extension
 * @property {(from: string, to: string) => string} relativePath - Get relative path from one path to another
 */

/** Sentinel – lets consumers do `instanceof` checks if needed. */
export class IEnvironment {
  constructor() {
    /** @type {string} */
    this.workingDir = '';
    /** @type {string} */
    this.platform = '';
  }

  /** @param {string} _key */
  getEnv(_key) { throw new Error('Not implemented'); }

  /** @param {...string} _segments */
  joinPath(..._segments) { throw new Error('Not implemented'); }

  /** @param {string} _p */
  resolvePath(_p) { throw new Error('Not implemented'); }

  /** @param {string} _p */
  dirname(_p) { throw new Error('Not implemented'); }

  /** @param {string} _p */
  basename(_p) { throw new Error('Not implemented'); }

  /** @param {string} _p */
  extname(_p) { throw new Error('Not implemented'); }

  /** @param {string} _from @param {string} _to */
  relativePath(_from, _to) { throw new Error('Not implemented'); }
}
