#!/usr/bin/env node
/**
 * prebuild.js — Copy backend node_modules into .backend-modules for
 * Electron packaging.
 *
 * electron-builder bundles the tray-app's own node_modules, but the
 * backend (ai-man) dependencies live in the parent workspace's
 * node_modules.  This script copies them (excluding electron and
 * cache dirs) so electron-builder can include them in the app bundle.
 */

const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '..', '..', 'node_modules');
const dst = path.resolve(__dirname, '..', '..', '.backend-modules');

if (!fs.existsSync(src)) {
  console.error('ERROR: ../node_modules not found — run pnpm install first');
  process.exit(1);
}

console.log(`Copying ${src} → ${dst} (excluding electron and .cache)…`);
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, {
  recursive: true,
  filter: (source) => {
    // Only exclude top-level electron packages and cache dirs, not transitive
    // deps that happen to contain "electron" in their name (e.g. electron-to-chromium).
    const rel = path.relative(src, source);
    const topLevel = rel.split(path.sep)[0];
    if (topLevel === 'electron' || topLevel === 'electron-builder') return false;
    if (rel.includes('.cache')) return false;
    return true;
  },
});
console.log('✅ Copied node_modules to .backend-modules');
