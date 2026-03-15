/**
 * @file Node.js implementation of IEnvironment
 * @description Uses Node.js `path` and `process` to back the environment interface.
 */

import path from 'path';

/**
 * @implements {import('../interfaces/environment.mjs').IEnvironment}
 */
export class NodeEnvironment {
  /**
   * @param {string} [workingDir] - Override for the working directory (defaults to process.cwd())
   */
  constructor(workingDir) {
    /** @type {string} */
    this.workingDir = workingDir || process.cwd();
    /** @type {string} */
    this.platform = 'node';
  }

  /**
   * Read an environment variable.
   * @param {string} key
   * @returns {string|undefined}
   */
  getEnv(key) {
    return process.env[key];
  }

  /**
   * Join path segments.
   * @param {...string} segments
   * @returns {string}
   */
  joinPath(...segments) {
    return path.join(...segments);
  }

  /**
   * Resolve a path to an absolute path.
   * @param {string} p
   * @returns {string}
   */
  resolvePath(p) {
    return path.resolve(p);
  }

  /**
   * Get the directory name of a path.
   * @param {string} p
   * @returns {string}
   */
  dirname(p) {
    return path.dirname(p);
  }

  /**
   * Get the base name of a path.
   * @param {string} p
   * @returns {string}
   */
  basename(p) {
    return path.basename(p);
  }

  /**
   * Get the extension of a path.
   * @param {string} p
   * @returns {string}
   */
  extname(p) {
    return path.extname(p);
  }

  /**
   * Get the relative path from one path to another.
   * @param {string} from
   * @param {string} to
   * @returns {string}
   */
  relativePath(from, to) {
    return path.relative(from, to);
  }
}
