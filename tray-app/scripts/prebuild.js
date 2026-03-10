#!/usr/bin/env node
/**
 * prebuild.js — Copy backend node_modules into .backend-modules for
 * Electron packaging, correctly handling pnpm's virtual store layout.
 *
 * pnpm stores packages in a content-addressable virtual store at
 * node_modules/.pnpm/<name>@<version>/node_modules/. Each package's
 * sibling entries represent its resolved dependencies and may differ
 * from the hoisted (top-level) versions. We must preserve this by
 * creating nested node_modules/ where version mismatches exist.
 *
 * All symlinks are dereferenced to real file copies since macOS code
 * signing rejects bundles containing external symlinks.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'node_modules');
const DST = path.join(ROOT, '.backend-modules');

// ── Exclusion rules ──────────────────────────────────────────────────

const EXCLUDE_PACKAGES = new Set([
  // Build tools & dev deps
  'electron', 'electron-builder',
  'typescript', 'typescript-eslint',
  'eslint', '@eslint',
  'prettier', 'esbuild',
  'vite', '@vitejs', 'rollup', '@rollup',
  'postcss', 'autoprefixer', 'tailwindcss',
  'jest', 'jest-environment-jsdom', 'ts-jest',
  '@jest', '@testing-library',
  '@types',
  // UI-only packages
  'monaco-editor', '@monaco-editor',
  'lucide-react',
  'recharts', 'd3-color', 'd3-format', 'd3-interpolate',
  'd3-path', 'd3-scale', 'd3-shape', 'd3-time', 'd3-time-format', 'd3-array',
  '@radix-ui',
  'class-variance-authority', 'clsx', 'tailwind-merge',
  'cmdk', 'sonner', 'vaul', 'input-otp',
  '@tanstack', '@typescript-eslint', 'canvas',
  // pnpm internals
  '.pnpm', '.modules.yaml', '.package-lock.json',
]);

const SKIP_EXTENSIONS = new Set(['.map', '.ts', '.tsx', '.tsbuildinfo']);

const SKIP_DIRS = new Set([
  '.git', '.github', '.eslintrc', '.vscode',
  'test', 'tests', '__tests__', '__mocks__',
  'coverage', 'docs', 'example', 'examples',
  'benchmark', 'benchmarks',
]);

function shouldSkipEntry(name) {
  if (name.endsWith('.d.ts')) return false;
  if (SKIP_DIRS.has(name)) return true;
  const ext = path.extname(name);
  if (SKIP_EXTENSIONS.has(ext)) return true;
  if (ext === '.md' && name !== 'README.md') return true;
  return false;
}

function shouldExcludePackage(name) {
  if (EXCLUDE_PACKAGES.has(name)) return true;
  for (const excl of EXCLUDE_PACKAGES) {
    if (name.startsWith(excl + '/')) return true;
  }
  return false;
}

// ── Caching & copy helpers ───────────────────────────────────────────

/** Cache for fs.realpathSync results */
const realpathCache = new Map();
function cachedRealpath(p) {
  let cached = realpathCache.get(p);
  if (cached !== undefined) return cached;
  try { cached = fs.realpathSync(p); } catch { cached = null; }
  realpathCache.set(p, cached);
  return cached;
}

/** Cache for fs.lstatSync().isSymbolicLink() */
const symlinkCache = new Map();
function isSymlink(p) {
  let cached = symlinkCache.get(p);
  if (cached !== undefined) return cached;
  try { cached = fs.lstatSync(p).isSymbolicLink(); } catch { cached = false; }
  symlinkCache.set(p, cached);
  return cached;
}

/** Track (realPath → dstPath) to avoid redundant copies */
const copiedPaths = new Set();

/**
 * Copy directory contents (files + subdirs) excluding node_modules.
 * Symlinks are followed automatically via fs.statSync / fs.realpathSync.
 */
function copyDirContents(srcDir, dstDir) {
  const realSrc = cachedRealpath(srcDir);
  if (!realSrc) return;

  const key = realSrc + '->' + dstDir;
  if (copiedPaths.has(key)) return;
  copiedPaths.add(key);

  fs.mkdirSync(dstDir, { recursive: true });

  let entries;
  try { entries = fs.readdirSync(srcDir); } catch { return; }

  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.bin' || entry === '.cache') continue;
    if (shouldSkipEntry(entry)) continue;

    const srcPath = path.join(srcDir, entry);
    const dstPath = path.join(dstDir, entry);

    let stat;
    try { stat = fs.statSync(srcPath); } catch { continue; }

    if (stat.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
    } else if (stat.isDirectory()) {
      copyDirContents(srcPath, dstPath);
    }
  }
}

// ── pnpm resolution helpers ─────────────────────────────────────────

/**
 * If `pkgPath` is a symlink into .pnpm, return its pnpm context
 * directory (the parent node_modules/ containing the package and its
 * resolved sibling deps). Returns null for non-pnpm packages.
 */
function getPnpmContext(pkgPath) {
  if (!isSymlink(pkgPath)) return null;
  const realPath = cachedRealpath(pkgPath);
  if (!realPath) return null;
  if (realPath.includes(path.sep + '.pnpm' + path.sep) || realPath.includes('/.pnpm/')) {
    return path.dirname(realPath);
  }
  return null;
}

/**
 * Build a map of { depName → realPath } for all entries in a pnpm
 * context directory, excluding the package itself and .bin/.pnpm.
 */
function buildContextMap(contextDir, selfName) {
  const map = new Map();
  const baseName = selfName.includes('/') ? selfName.split('/').pop() : selfName;
  let entries;
  try { entries = fs.readdirSync(contextDir); } catch { return map; }

  for (const entry of entries) {
    if (entry === baseName || entry === '.bin' || entry === '.pnpm') continue;

    if (entry.startsWith('@')) {
      const scopeDir = path.join(contextDir, entry);
      let subs;
      try { subs = fs.readdirSync(scopeDir); } catch { continue; }
      for (const sub of subs) {
        const rp = cachedRealpath(path.join(scopeDir, sub));
        if (rp) map.set(`${entry}/${sub}`, rp);
      }
    } else {
      const rp = cachedRealpath(path.join(contextDir, entry));
      if (rp) map.set(entry, rp);
    }
  }
  return map;
}

/**
 * Copy a package and recursively resolve pnpm dependencies.
 *
 * For each pnpm-managed package, we compare its context's dependency
 * versions against what the parent level provides. Any mismatches get
 * copied into a nested node_modules/ so Node's resolution finds them.
 *
 * @param {string} srcPkg         Source path (may be pnpm symlink)
 * @param {string} dstPkg         Destination path
 * @param {string} pkgName        Package name (e.g. 'boxen', '@img/sharp-darwin-arm64')
 * @param {Map}    parentVersions Map of depName → realPath at parent level
 * @param {number} depth          Recursion depth (capped at 10)
 */
function copyPackage(srcPkg, dstPkg, pkgName, parentVersions, depth = 0) {
  if (depth > 10) return;

  const realPkgPath = cachedRealpath(srcPkg);
  if (!realPkgPath) return;

  // Copy package contents (everything except node_modules)
  copyDirContents(realPkgPath, dstPkg);

  // Find pnpm context for this package
  const context = getPnpmContext(srcPkg);

  if (!context) {
    // Not pnpm — check for existing nested node_modules (rare)
    const nestedNm = path.join(realPkgPath, 'node_modules');
    if (fs.existsSync(nestedNm)) {
      processNodeModulesDir(nestedNm, path.join(dstPkg, 'node_modules'), parentVersions, depth + 1);
    }
    return;
  }

  // Build map of what this package's pnpm context provides
  const contextMap = buildContextMap(context, pkgName);

  // Find deps whose versions differ from what the parent provides
  const mismatched = [];
  for (const [depName, depRealPath] of contextMap) {
    if (parentVersions.get(depName) === depRealPath) continue;
    mismatched.push({ name: depName, realPath: depRealPath, srcPath: path.join(context, depName) });
  }

  if (mismatched.length === 0) return;

  // Build the resolution map for nested deps:
  // start with parent's, overlay with this context's versions
  const nestedVersions = new Map(parentVersions);
  for (const [name, rp] of contextMap) nestedVersions.set(name, rp);

  // Copy each mismatched dep into a nested node_modules/
  const nestedNmDir = path.join(dstPkg, 'node_modules');
  for (const { name, realPath, srcPath } of mismatched) {
    if (shouldExcludePackage(name)) continue;

    const dstDep = path.join(nestedNmDir, name);
    copyDirContents(realPath, dstDep);

    // Recurse: this dep may itself have pnpm context mismatches
    const depContext = getPnpmContext(srcPath);
    if (depContext) {
      const depContextMap = buildContextMap(depContext, name);
      const depMismatched = [];
      for (const [dn, drp] of depContextMap) {
        if (nestedVersions.get(dn) === drp) continue;
        depMismatched.push({ name: dn, realPath: drp, srcPath: path.join(depContext, dn) });
      }
      if (depMismatched.length > 0) {
        const deepVersions = new Map(nestedVersions);
        for (const [n, r] of depContextMap) deepVersions.set(n, r);

        const deepNmDir = path.join(dstDep, 'node_modules');
        for (const { name: dn, realPath: drp, srcPath: ds } of depMismatched) {
          if (shouldExcludePackage(dn)) continue;
          const dstDeep = path.join(deepNmDir, dn);
          copyDirContents(drp, dstDeep);
          // Continue recursion
          const deepCtx = getPnpmContext(ds);
          if (deepCtx) {
            resolveNestedPnpmDeps(deepCtx, dn, dstDeep, deepVersions, depth + 2);
          }
        }
      }
    }
  }
}

/**
 * Generic recursive resolver for deeply nested pnpm deps (depth > 2).
 */
function resolveNestedPnpmDeps(context, pkgName, dstPkg, parentVersions, depth) {
  if (depth > 10) return;

  const contextMap = buildContextMap(context, pkgName);
  const mismatched = [];
  for (const [depName, depRealPath] of contextMap) {
    if (parentVersions.get(depName) === depRealPath) continue;
    mismatched.push({ name: depName, realPath: depRealPath, srcPath: path.join(context, depName) });
  }
  if (mismatched.length === 0) return;

  const nestedVersions = new Map(parentVersions);
  for (const [n, r] of contextMap) nestedVersions.set(n, r);

  const nestedNmDir = path.join(dstPkg, 'node_modules');
  for (const { name, realPath, srcPath } of mismatched) {
    if (shouldExcludePackage(name)) continue;
    copyDirContents(realPath, path.join(nestedNmDir, name));
    const depCtx = getPnpmContext(srcPath);
    if (depCtx) {
      resolveNestedPnpmDeps(depCtx, name, path.join(nestedNmDir, name), nestedVersions, depth + 1);
    }
  }
}

// ── Top-level node_modules processing ────────────────────────────────

/**
 * Process a node_modules directory: build a resolution map, then copy
 * each package with pnpm dependency resolution.
 */
function processNodeModulesDir(nmDir, dstNmDir, parentVersions, depth = 0) {
  if (depth > 5) return;

  let entries;
  try { entries = fs.readdirSync(nmDir); } catch { return; }

  // Build resolution map for this level (what's "available" here)
  const levelVersions = new Map(parentVersions);
  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    if (entry.startsWith('@')) {
      const scopeDir = path.join(nmDir, entry);
      let subs;
      try { subs = fs.readdirSync(scopeDir); } catch { continue; }
      for (const sub of subs) {
        const rp = cachedRealpath(path.join(scopeDir, sub));
        if (rp) levelVersions.set(`${entry}/${sub}`, rp);
      }
    } else {
      const rp = cachedRealpath(path.join(nmDir, entry));
      if (rp) levelVersions.set(entry, rp);
    }
  }

  // Copy each package
  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;

    if (entry.startsWith('@')) {
      if (shouldExcludePackage(entry)) continue;
      const scopeDir = path.join(nmDir, entry);
      let subs;
      try { subs = fs.readdirSync(scopeDir); } catch { continue; }
      for (const sub of subs) {
        const fullName = `${entry}/${sub}`;
        if (shouldExcludePackage(fullName)) continue;
        copyPackage(path.join(scopeDir, sub), path.join(dstNmDir, entry, sub), fullName, levelVersions, depth);
      }
      continue;
    }

    if (shouldExcludePackage(entry)) continue;
    copyPackage(path.join(nmDir, entry), path.join(dstNmDir, entry), entry, levelVersions, depth);
  }
}

// ── Main ─────────────────────────────────────────────────────────────

if (!fs.existsSync(SRC)) {
  console.error('ERROR: ../node_modules not found — run pnpm install first');
  process.exit(1);
}

console.log(`Copying ${SRC} → ${DST}`);
console.log('  Dereferencing symlinks, resolving pnpm virtual store deps…');

const t0 = Date.now();
fs.rmSync(DST, { recursive: true, force: true });
fs.mkdirSync(DST, { recursive: true });

processNodeModulesDir(SRC, DST, new Map(), 0);

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

let size = 'unknown';
try {
  size = execSync(`du -sh "${DST}"`, { encoding: 'utf8' }).trim().split('\t')[0];
} catch { /* ignore */ }

let symlinkCount = 0;
try {
  const out = execSync(`find "${DST}" -type l 2>/dev/null | wc -l`, { encoding: 'utf8' }).trim();
  symlinkCount = parseInt(out, 10);
} catch { /* ignore */ }

console.log(`✅ Copied node_modules to .backend-modules in ${elapsed}s (${size})`);
if (symlinkCount > 0) {
  console.warn(`⚠️  ${symlinkCount} symlinks remain`);
} else {
  console.log('   ✓ No symlinks (fully dereferenced)');
}
