/**
 * @file Node.js implementation of IStorageBackend
 * @description Uses Node.js `fs.promises` and `path` to back the storage interface.
 */

import fs from 'fs';
import path from 'path';

/**
 * @implements {import('../interfaces/storage-backend.mjs').IStorageBackend}
 */
export class NodeStorageBackend {
  /**
   * Read file contents as UTF-8.
   * @param {string} filePath
   * @returns {Promise<string>}
   */
  async read(filePath) {
    return fs.promises.readFile(filePath, 'utf8');
  }

  /**
   * Write file contents (creates parent directories automatically).
   * @param {string} filePath
   * @param {string} content
   * @returns {Promise<void>}
   */
  async write(filePath, content) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, content, 'utf8');
  }

  /**
   * List files in a directory.
   * @param {string} dir
   * @returns {Promise<string[]>}
   */
  async list(dir) {
    return fs.promises.readdir(dir);
  }

  /**
   * Check if a file or directory exists.
   * @param {string} filePath
   * @returns {Promise<boolean>}
   */
  async exists(filePath) {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a file.
   * @param {string} filePath
   * @returns {Promise<void>}
   */
  async delete(filePath) {
    await fs.promises.unlink(filePath);
  }

  /**
   * Create a directory recursively.
   * @param {string} dir
   * @returns {Promise<void>}
   */
  async mkdir(dir) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  /**
   * Get file stats.
   * @param {string} filePath
   * @returns {Promise<{size: number, mtime: Date, isDirectory: boolean}>}
   */
  async stat(filePath) {
    const s = await fs.promises.stat(filePath);
    return { size: s.size, mtime: s.mtime, isDirectory: s.isDirectory() };
  }
}
