/**
 * @file IStorageBackend interface definition
 * @description Abstracts file-system operations so the core can work with
 *   different backing stores (local FS, Supabase Storage, etc.).
 */

/**
 * @typedef {Object} IStorageBackend
 * @property {(path: string) => Promise<string>} read - Read file contents as UTF-8
 * @property {(path: string, content: string) => Promise<void>} write - Write file contents
 * @property {(dir: string) => Promise<string[]>} list - List files in directory
 * @property {(path: string) => Promise<boolean>} exists - Check if file/dir exists
 * @property {(path: string) => Promise<void>} delete - Delete a file
 * @property {(dir: string) => Promise<void>} mkdir - Create directory (recursive)
 * @property {(path: string) => Promise<{size: number, mtime: Date, isDirectory: boolean}>} stat - File stats
 */

/** Sentinel – lets consumers do `instanceof` checks if needed. */
export class IStorageBackend {
  /** @param {string} _path */
  async read(_path) { throw new Error('Not implemented'); }

  /**
   * @param {string} _path
   * @param {string} _content
   */
  async write(_path, _content) { throw new Error('Not implemented'); }

  /** @param {string} _dir */
  async list(_dir) { throw new Error('Not implemented'); }

  /** @param {string} _path */
  async exists(_path) { throw new Error('Not implemented'); }

  /** @param {string} _path */
  async delete(_path) { throw new Error('Not implemented'); }

  /** @param {string} _dir */
  async mkdir(_dir) { throw new Error('Not implemented'); }

  /** @param {string} _path */
  async stat(_path) { throw new Error('Not implemented'); }
}
