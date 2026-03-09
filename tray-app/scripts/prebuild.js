#!/usr/bin/env node
/**
 * prebuild.js — Copy backend node_modules into .backend-modules for
 * Electron packaging.
 *
 * pnpm stores real package contents in node_modules/.pnpm and uses symlinks
 * for the top-level packages.  Electron packaging + macOS code signing
 * can't handle external symlinks, so we must "flatten" the dependency tree
 * by dereferencing all symlinks and copying real files.
 *
 * Key optimizations over the naive approach:
 *  1. Skip .pnpm entirely (avoid the massive pnpm store)
 *  2. Dereference symlinks at each level into real copies
 *  3. Recursively process nested node_modules in the same way
 *  4. Exclude dev-only, test, and UI-only packages
 *  5. Strip unnecessary files (docs, tests, sourcemaps, etc.)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'node_modules');
const DST = path.join(ROOT, '.backend-modules');

// ── Packages to exclude ──────────────────────────────────────────────
// Dev-only, test, lint, build-tool, and UI-only packages that the
// backend server does NOT need at runtime.
const EXCLUDE_TOP_LEVEL = new Set([
  // Build / Dev tools
  'electron', 'electron-builder',
  'typescript', 'typescript-eslint',
  'eslint', '@eslint',
  'prettier',
  'esbuild',
  'vite', '@vitejs',
  'rollup', '@rollup',
  'postcss', 'autoprefixer', 'tailwindcss',
  // Test
  'jest', 'jest-environment-jsdom', 'ts-jest',
  '@jest', '@testing-library',
  // Type definitions (not needed at runtime)
  '@types',
  // UI-only packages (already in ui/dist)
  'monaco-editor', '@monaco-editor',
  'lucide-react',
  'recharts', 'd3-color', 'd3-format', 'd3-interpolate',
  'd3-path', 'd3-scale', 'd3-shape', 'd3-time', 'd3-time-format',
  'd3-array',
  '@radix-ui',
  'class-variance-authority', 'clsx', 'tailwind-merge',
  'cmdk', 'sonner', 'vaul',
  'input-otp',
  '@tanstack',
  // Large optional/rarely-used
  '@typescript-eslint',
  'canvas',
  // pnpm internals
  '.pnpm', '.modules.yaml', '.package-lock.json',
]);

// File/dir patterns to skip inside packages to save space
const SKIP_PATTERNS = [
  /^\.git$/,
  /^\.github$/,
  /^\.eslint/,
  /^\.prettier/,
  /^\.vscode$/,
  /^test$/i,
  /^tests$/i,
  /^__tests__$/,
  /^__mocks__$/,
  /^coverage$/,
  /^docs$/,
  /^examples?$/,
  /^benchmarks?$/,
  /\.md$/i,
  /\.map$/,
  /\.ts$/,        // TypeScript source (not .d.ts — those are needed sometimes)
  /\.tsx$/,
  /CHANGELOG/i,
  /HISTORY/i,
  /CONTRIBUTING/i,
  /AUTHORS/i,
  /\.tsbuildinfo$/,
];

// Some .ts patterns we should NOT strip (declaration files)
function shouldSkipFile(name) {
  // Keep .d.ts files
  if (name.endsWith('.d.ts')) return false;
  for (const pat of SKIP_PATTERNS) {
    if (pat.test(name)) return true;
  }
  return false;
}

function shouldExcludePackage(name) {
  if (EXCLUDE_TOP_LEVEL.has(name)) return true;
  // Check scoped package prefixes
  for (const excl of EXCLUDE_TOP_LEVEL) {
    if (name.startsWith(excl + '/')) return true;
  }
  return false;
}

// ── Track visited real paths to avoid circular copies ────────────────
const visited = new Set();

/**
 * Copy a single file or directory, dereferencing symlinks.
 * For directories, recurse and handle nested node_modules specially.
 */
function copyEntry(srcPath, dstPath, depth = 0) {
  let stat;
  try {
    // Use stat (not lstat) to follow symlinks
    stat = fs.statSync(srcPath);
  } catch (e) {
    // Broken symlink or inaccessible — skip
    return;
  }

  // Avoid circular copies
  const realPath = fs.realpathSync(srcPath);
  if (stat.isDirectory()) {
    if (visited.has(realPath)) return;
    visited.add(realPath);
  }

  if (stat.isFile()) {
    const name = path.basename(srcPath);
    if (shouldSkipFile(name)) return;
    fs.mkdirSync(path.dirname(dstPath), { recursive: true });
    fs.copyFileSync(srcPath, dstPath);
    return;
  }

  if (stat.isDirectory()) {
    const name = path.basename(srcPath);

    // Skip .cache, .bin at any level
    if (name === '.cache' || name === '.bin') return;

    // If this is a node_modules directory, process it like top-level
    if (name === 'node_modules') {
      copyNodeModules(srcPath, dstPath, depth + 1);
      return;
    }

    // Regular directory — recurse
    fs.mkdirSync(dstPath, { recursive: true });
    let entries;
    try {
      entries = fs.readdirSync(srcPath);
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      copyEntry(path.join(srcPath, entry), path.join(dstPath, entry), depth);
    }
  }
}

/**
 * Process a node_modules directory: enumerate top-level packages,
 * skip excluded ones, dereference symlinks, and recurse.
 */
function copyNodeModules(nmDir, dstNmDir, depth = 0) {
  if (depth > 5) return; // Safety: don't recurse too deep

  let entries;
  try {
    entries = fs.readdirSync(nmDir);
  } catch (e) {
    return;
  }

  for (const entry of entries) {
    // Skip pnpm internals and excluded packages
    if (entry === '.pnpm' || entry === '.bin' || entry === '.cache' ||
        entry === '.modules.yaml' || entry === '.package-lock.json' ||
        entry === '.ignored_*' || entry.startsWith('.ignored_')) {
      continue;
    }

    // Handle scoped packages (@scope/name)
    if (entry.startsWith('@')) {
      if (shouldExcludePackage(entry)) continue;

      const scopeDir = path.join(nmDir, entry);
      let scopeEntries;
      try {
        scopeEntries = fs.readdirSync(scopeDir);
      } catch (e) {
        continue;
      }

      for (const scopedPkg of scopeEntries) {
        const fullName = `${entry}/${scopedPkg}`;
        if (shouldExcludePackage(fullName)) continue;

        const srcPkg = path.join(scopeDir, scopedPkg);
        const dstPkg = path.join(dstNmDir, entry, scopedPkg);
        copyEntry(srcPkg, dstPkg, depth);
      }
      continue;
    }

    if (shouldExcludePackage(entry)) continue;

    const srcPkg = path.join(nmDir, entry);
    const dstPkg = path.join(dstNmDir, entry);
    copyEntry(srcPkg, dstPkg, depth);
  }
}

// ── Main ─────────────────────────────────────────────────────────────

if (!fs.existsSync(SRC)) {
  console.error('ERROR: ../node_modules not found — run pnpm install first');
  process.exit(1);
}

console.log(`Copying ${SRC} → ${DST}`);
console.log('  Dereferencing symlinks, skipping .pnpm store and dev deps…');

const t0 = Date.now();
fs.rmSync(DST, { recursive: true, force: true });
fs.mkdirSync(DST, { recursive: true });

copyNodeModules(SRC, DST, 0);

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

// Report size
const { execSync } = require('child_process');
let size = 'unknown';
try {
  size = execSync(`du -sh "${DST}"`, { encoding: 'utf8' }).trim().split('\t')[0];
} catch (e) { /* ignore */ }

console.log(`✅ Copied node_modules to .backend-modules in ${elapsed}s (${size})`);
