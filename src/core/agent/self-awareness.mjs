// ==========================================
// SELF-AWARENESS MODULE
// ==========================================
// Gives the agent awareness of its own source code,
// the ability to read/edit it, and the ability to restart itself.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { resolve, join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---- Resolve the agent's own source directory ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Absolute path to the agent source directory (src/core/agent/) */
export const AGENT_SOURCE_DIR = __dirname;

/** Absolute path to the entire project root */
export const AGENT_PROJECT_ROOT = resolve(__dirname, '..', '..', '..');

/**
 * The set of source files that constitute the agent itself.
 * Collected at import time so the agent always knows its own shape.
 */
export const getSourceManifest = () => {
  const manifest = [];

  const walk = (dir, prefix = '') => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      // Skip node_modules, .git, dist, build artifacts
      if (['node_modules', '.git', 'dist', 'build', '.cache'].includes(entry)) continue;

      const fullPath = join(dir, entry);
      const relPath = prefix ? `${prefix}/${entry}` : entry;

      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(fullPath, relPath);
      } else {
        manifest.push({
          relativePath: relPath,
          absolutePath: fullPath,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        });
      }
    }
  };

  // Walk just the agent source directory for the core manifest
  walk(resolve(__dirname), 'src/core/agent');
  return manifest;
};

// ==========================================
// SOURCE FILE OPERATIONS
// ==========================================

/**
 * Read one of the agent's own source files.
 * @param {string} relativeOrAbsPath — path relative to AGENT_PROJECT_ROOT, or absolute
 * @returns {{ result?: string, error?: string }}
 */
export const selfRead = (relativeOrAbsPath) => {
  try {
    const absPath = resolveSourcePath(relativeOrAbsPath);
    if (!absPath) return { error: `Path is outside agent source tree: ${relativeOrAbsPath}` };
    if (!existsSync(absPath)) return { error: `Source file not found: ${relativeOrAbsPath}` };
    const content = readFileSync(absPath, 'utf-8');
    return { result: content };
  } catch (err) {
    return { error: `Failed to read source file: ${err.message}` };
  }
};

/**
 * Write (overwrite or create) one of the agent's own source files.
 * @param {string} relativeOrAbsPath — path relative to AGENT_PROJECT_ROOT, or absolute
 * @param {string} content — new file content
 * @returns {{ result?: string, error?: string }}
 */
export const selfWrite = (relativeOrAbsPath, content) => {
  try {
    const absPath = resolveSourcePath(relativeOrAbsPath);
    if (!absPath) return { error: `Path is outside agent source tree: ${relativeOrAbsPath}` };

    // Safety: create backup before overwriting
    if (existsSync(absPath)) {
      const backup = absPath + '.bak';
      const original = readFileSync(absPath, 'utf-8');
      writeFileSync(backup, original, 'utf-8');
    }

    writeFileSync(absPath, content, 'utf-8');
    return { result: `Successfully wrote ${content.length} bytes to ${relativeOrAbsPath} (backup created)` };
  } catch (err) {
    return { error: `Failed to write source file: ${err.message}` };
  }
};

/**
 * List the agent's own source files.
 * @returns {{ result: string }}
 */
export const selfList = () => {
  const manifest = getSourceManifest();
  const lines = manifest.map(f => `${f.relativePath}  (${f.size} bytes, modified ${f.modified})`);
  return { result: lines.join('\n') };
};

// ==========================================
// SELF-RESTART
// ==========================================

/**
 * Trigger a self-restart of the agent process.
 * Returns a command result that the executor interprets
 * to trigger the restart flow.
 */
export const selfRestart = (reason = 'Self-modification applied') => {
  return {
    result: `Restart requested: ${reason}`,
    isRestart: true,
    reason,
  };
};

/**
 * Invalidate the Node.js require/import cache for all agent source files.
 */
export const invalidateModuleCache = () => {
  if (typeof require !== 'undefined' && require.cache) {
    const manifest = getSourceManifest();
    for (const file of manifest) {
      if (require.cache[file.absolutePath]) {
        delete require.cache[file.absolutePath];
      }
    }
  }
};

// ==========================================
// HELPERS
// ==========================================

/**
 * Resolve a user-provided path to an absolute path within the agent source tree.
 * Returns null if the resolved path escapes the project root (security guard).
 */
const resolveSourcePath = (inputPath) => {
  let absPath;
  if (inputPath.startsWith('/')) {
    absPath = resolve(inputPath);
  } else {
    absPath = resolve(AGENT_PROJECT_ROOT, inputPath);
  }

  const rel = relative(AGENT_PROJECT_ROOT, absPath);
  if (rel.startsWith('..') || rel.startsWith('/')) return null;

  return absPath;
};

/**
 * Mount the agent source manifest into the VFS so the agent can discover
 * its own code via normal `ls` and `read` commands too.
 */
export const mountSourceInVFS = (vfs) => {
  // Create /sys/self directory structure
  vfs.fs['/sys'] = { type: 'dir', contents: ['self'] };
  if (vfs.fs['/'] && !vfs.fs['/'].contents.includes('sys')) {
    vfs.fs['/'].contents.push('sys');
  }

  vfs.fs['/sys/self'] = { type: 'dir', contents: ['manifest.json', 'info.txt'] };

  const manifest = getSourceManifest();
  vfs.fs['/sys/self/manifest.json'] = {
    type: 'file',
    content: JSON.stringify(manifest, null, 2),
  };

  vfs.fs['/sys/self/info.txt'] = {
    type: 'file',
    content: [
      `Agent Source Code Location`,
      `==========================`,
      `Project Root : ${AGENT_PROJECT_ROOT}`,
      `Source Dir   : ${AGENT_SOURCE_DIR}`,
      `Total Files  : ${manifest.length}`,
      ``,
      `Available self-modification commands:`,
      `  self_list               — List all agent source files`,
      `  self_read <path>        — Read an agent source file`,
      `  self_write <path> <content> — Write/overwrite an agent source file`,
      `  self_restart [reason]   — Restart the agent to pick up code changes`,
      ``,
      `Paths are relative to: ${AGENT_PROJECT_ROOT}`,
    ].join('\n'),
  };

  // Mount source files into /sys/self/...
  const dirs = new Set();
  for (const file of manifest) {
    const vfsPath = `/sys/self/${file.relativePath}`;
    const parts = vfsPath.split('/');

    for (let i = 3; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join('/');
      if (!dirs.has(dirPath)) {
        dirs.add(dirPath);
        const parentPath = parts.slice(0, i).join('/');
        const dirName = parts[i];
        if (vfs.fs[parentPath] && !vfs.fs[parentPath].contents.includes(dirName)) {
          vfs.fs[parentPath].contents.push(dirName);
        }
        if (!vfs.fs[dirPath]) {
          vfs.fs[dirPath] = { type: 'dir', contents: [] };
        }
      }
    }

    try {
      const content = readFileSync(file.absolutePath, 'utf-8');
      const fileName = parts[parts.length - 1];
      const parentDir = parts.slice(0, -1).join('/');
      if (vfs.fs[parentDir] && !vfs.fs[parentDir].contents.includes(fileName)) {
        vfs.fs[parentDir].contents.push(fileName);
      }
      vfs.fs[vfsPath] = { type: 'file', content };
    } catch {
      // Skip files that can't be read
    }
  }
};
