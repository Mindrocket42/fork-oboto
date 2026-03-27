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

/** Absolute path to the agent source directory (newagent/src/agent/) */
export const AGENT_SOURCE_DIR = __dirname;

/** Absolute path to the entire newagent project root (newagent/) */
export const AGENT_PROJECT_ROOT = resolve(__dirname, '..', '..');

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

  walk(AGENT_PROJECT_ROOT);
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
 * Works by:
 *   1. Signalling the AgentRunner to stop the current loop
 *   2. Invalidating Node's module cache for agent source files
 *   3. Re-importing and re-launching the agent
 *
 * The actual restart is coordinated by AgentRunner.requestRestart().
 * This function returns a command result that the executor interprets
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
 * Invalidate the Node.js require/import cache for all agent source files
 * so that dynamic re-import picks up changes.
 * NOTE: ESM module cache cannot be reliably invalidated in all runtimes.
 * For robust restarts, the AgentRunner spawns a fresh child process.
 */
export const invalidateModuleCache = () => {
  // For CommonJS environments
  if (typeof require !== 'undefined' && require.cache) {
    const manifest = getSourceManifest();
    for (const file of manifest) {
      if (require.cache[file.absolutePath]) {
        delete require.cache[file.absolutePath];
      }
    }
  }
  // For ESM, module cache invalidation is not directly supported.
  // The restart mechanism in AgentRunner handles this by spawning a new process.
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

  // Security: must stay within the agent project root
  const rel = relative(AGENT_PROJECT_ROOT, absPath);
  if (rel.startsWith('..') || rel.startsWith('/')) return null;

  return absPath;
};

/**
 * Mount the agent source manifest into the VFS so the agent can discover
 * its own code via normal `ls` and `read` commands too.
 * Called once during AgentRunner initialization.
 */
export const mountSourceInVFS = (vfs) => {
  // Create /sys/self directory structure
  vfs.fs['/sys'] = { type: 'dir', contents: ['self'] };
  // Make sure root knows about /sys
  if (vfs.fs['/'] && !vfs.fs['/'].contents.includes('sys')) {
    vfs.fs['/'].contents.push('sys');
  }

  vfs.fs['/sys/self'] = { type: 'dir', contents: ['manifest.json', 'info.txt'] };

  // Write manifest
  const manifest = getSourceManifest();
  vfs.fs['/sys/self/manifest.json'] = {
    type: 'file',
    content: JSON.stringify(manifest, null, 2),
  };

  // Write human-readable info
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

  // Mount each source file into /sys/self/src/...
  const srcFiles = manifest.filter(f => f.relativePath.startsWith('src/'));
  if (srcFiles.length > 0) {
    vfs.fs['/sys/self'].contents.push('src');
    const dirs = new Set();

    for (const file of srcFiles) {
      const vfsPath = `/sys/self/${file.relativePath}`;
      const parts = vfsPath.split('/');
      
      // Ensure parent directories exist
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

      // Read and mount the actual file content
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
  }
};
