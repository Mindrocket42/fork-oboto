/**
 * afterPack.js — electron-builder hook that runs after the app is
 * packed but before final signing/DMG creation.
 *
 * 1. Resolves any remaining pnpm symlinks (safety net — prebuild.js
 *    should already dereference everything)
 * 2. Signs all native binaries (.node, .dylib, .so, executables) with
 *    the Developer ID certificate so codesign/notarization succeeds
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── Symlink resolution ──────────────────────────────────────────────

function resolveSymlinks(appPath) {
  const resourcesDir = path.join(appPath, 'Contents', 'Resources', 'backend', 'node_modules');
  if (!fs.existsSync(resourcesDir)) {
    console.log('   No backend/node_modules in Resources, skipping');
    return;
  }

  console.log('   Resolving pnpm symlinks in bundle...');
  let totalResolved = 0, totalRemoved = 0, totalErrors = 0;

  for (let pass = 1; pass <= 5; pass++) {
    let symlinks;
    try {
      const output = execSync(`find "${resourcesDir}" -type l`, {
        encoding: 'utf8', maxBuffer: 50 * 1024 * 1024,
      });
      symlinks = output.trim().split('\n').filter(Boolean);
    } catch (e) {
      console.warn('   ⚠️  Could not find symlinks:', e.message);
      return;
    }
    if (symlinks.length === 0) break;

    console.log(`   Pass ${pass}: found ${symlinks.length} symlinks`);
    let resolved = 0, removed = 0;

    for (const link of symlinks) {
      try {
        const target = fs.readlinkSync(link);
        const absTarget = path.isAbsolute(target)
          ? target
          : path.resolve(path.dirname(link), target);

        // Check if target exists
        let exists = false;
        try { fs.statSync(absTarget); exists = true; } catch {}

        if (!exists) {
          fs.unlinkSync(link);
          removed++;
          continue;
        }

        // Skip workspace back-references (plugins/, ui/, project root)
        const isWorkspaceRef = !absTarget.includes('node_modules/.pnpm/') &&
          !absTarget.includes('node_modules\\') &&
          (absTarget.includes('/plugins/') || absTarget.includes('/ui/') ||
           absTarget.includes('/lmscript/') ||
           (absTarget.includes('/Development/ai-man') && !absTarget.includes('node_modules')));

        if (isWorkspaceRef) {
          fs.rmSync(link, { recursive: true, force: true });
          removed++;
          continue;
        }

        // Replace symlink with real copy
        fs.unlinkSync(link);
        const stats = fs.statSync(absTarget);
        if (stats.isDirectory()) {
          fs.cpSync(absTarget, link, { recursive: true });
        } else {
          fs.copyFileSync(absTarget, link);
        }
        resolved++;
      } catch {
        try { fs.rmSync(link, { recursive: true, force: true }); } catch {}
        totalErrors++;
      }
    }

    totalResolved += resolved;
    totalRemoved += removed;
    if (resolved === 0) break;
  }

  console.log(`   ✅ Symlinks resolved: ${totalResolved}, removed: ${totalRemoved}, errors: ${totalErrors}`);

  // Verify none remain
  try {
    const count = parseInt(
      execSync(`find "${resourcesDir}" -type l 2>/dev/null | wc -l`, { encoding: 'utf8' }).trim(), 10
    );
    console.log(count > 0
      ? `   ⚠️  ${count} symlinks still remain in Resources`
      : '   ✓ No symlinks remaining in Resources');
  } catch {}
}

// ── Native binary signing ───────────────────────────────────────────

function findSigningIdentity() {
  if (process.env.CSC_NAME) return process.env.CSC_NAME;
  try {
    const output = execSync('security find-identity -v -p codesigning', { encoding: 'utf8' });
    const match = output.match(/"(Developer ID Application:[^"]+)"/);
    return match ? match[1] : null;
  } catch { return null; }
}

function findNativeBinaries(appPath) {
  const files = new Set();

  // 1. Find by extension (.node, .dylib, .so, .bare)
  try {
    execSync(
      `find "${appPath}" -type f \\( -name "*.node" -o -name "*.dylib" -o -name "*.so" -o -name "*.bare" \\)`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    ).trim().split('\n').filter(Boolean).forEach(f => files.add(f));
  } catch {}

  // 2. Find Mach-O executables (no extension) in Resources + Frameworks
  for (const subdir of ['Contents/Resources', 'Contents/Frameworks']) {
    const dir = path.join(appPath, subdir);
    if (!fs.existsSync(dir)) continue;
    try {
      const candidates = execSync(
        `find "${dir}" -type f -perm +111 ! -name "*.js" ! -name "*.mjs" ! -name "*.cjs" ! -name "*.json" ! -name "*.md" ! -name "*.txt" ! -name "*.html" ! -name "*.css" ! -name "*.map" ! -name "*.ts" ! -name "*.yml" ! -name "*.yaml" ! -name "*.png" ! -name "*.jpg" ! -name "*.svg" ! -name "*.gif" ! -name "*.ico" ! -name "*.icns" ! -name "*.woff" ! -name "*.woff2" ! -name "*.ttf" ! -name "*.eot" ! -name "*.sh" ! -name "*.py" ! -name "*.rb"`,
        { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
      ).trim().split('\n').filter(Boolean);

      for (const f of candidates) {
        if (files.has(f)) continue;
        try {
          const type = execSync(`file "${f}"`, { encoding: 'utf8' });
          if (type.includes('Mach-O') || type.includes('universal binary')) {
            files.add(f);
          }
        } catch {}
      }
    } catch {}
  }

  return [...files];
}

function signBinaries(nativeFiles, identity, entitlements, appPath) {
  let signed = 0, failed = 0;
  const errors = [];

  for (const file of nativeFiles) {
    try {
      try { execSync(`codesign --remove-signature "${file}" 2>/dev/null`); } catch {}
      execSync(
        `codesign --force --sign "${identity}" --timestamp --options runtime --entitlements "${entitlements}" "${file}"`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
      signed++;
    } catch (e) {
      failed++;
      errors.push(`${path.relative(appPath, file)}: ${e.message.split('\n')[0]}`);
    }
  }

  console.log(`   ✅ Signed: ${signed}`);
  if (failed > 0) {
    console.log(`   ⚠️  Failed: ${failed}`);
    errors.slice(0, 10).forEach(err => console.log(`      ${err}`));
    if (errors.length > 10) console.log(`      ... and ${errors.length - 10} more`);
  }
}

// ── Hook entry point ────────────────────────────────────────────────

exports.default = async function afterPack(context) {
  if (process.platform !== 'darwin') return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const entitlements = path.resolve(__dirname, '..', 'entitlements.mac.plist');

  // Step 1: Resolve any remaining symlinks
  console.log('\n🔗 afterPack: Resolving pnpm symlinks in bundle...');
  resolveSymlinks(appPath);

  // Step 2: Sign native binaries
  const identity = findSigningIdentity();
  if (!identity) {
    console.warn('⚠️  afterPack: No signing identity found, skipping native binary signing');
    return;
  }

  console.log(`\n🔏 afterPack: Signing native binaries with "${identity}"`);
  console.log(`   App path: ${appPath}`);
  console.log(`   Entitlements: ${entitlements}`);

  const nativeFiles = findNativeBinaries(appPath);
  console.log(`   Found ${nativeFiles.length} native binaries to sign`);

  signBinaries(nativeFiles, identity, entitlements, appPath);
  console.log('');
};
