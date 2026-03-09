// afterPack.js — resolves pnpm symlinks and signs all native binaries
// in the app bundle before final signing.
// This ensures notarization succeeds by:
// 1. Replacing pnpm symlinks with real copies (codesign rejects external symlinks)
// 2. Signing .node, .dylib, and executable files that electron-builder misses

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Resolve all symlinks in the app bundle's Resources directory.
 * pnpm creates symlinks that point outside the bundle, which macOS
 * code signing rejects. We replace them with copies of the real files,
 * skipping workspace back-references that would cause infinite loops.
 */
function resolveSymlinks(appPath) {
  const resourcesDir = path.join(appPath, 'Contents', 'Resources', 'backend', 'node_modules');
  if (!fs.existsSync(resourcesDir)) {
    console.log('   No backend/node_modules in Resources, skipping symlink resolution');
    return;
  }

  console.log('   Resolving pnpm symlinks in bundle...');

  let totalResolved = 0;
  let totalRemoved = 0;
  let totalErrors = 0;

  // Run multiple passes — resolved symlinks may contain new symlinks
  for (let pass = 1; pass <= 5; pass++) {
    // Find all symlinks
    let symlinks;
    try {
      const output = execSync(`find "${resourcesDir}" -type l`, {
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
      });
      symlinks = output.trim().split('\n').filter(Boolean);
    } catch (e) {
      console.warn('   ⚠️  Could not find symlinks:', e.message);
      return;
    }

    if (symlinks.length === 0) break;
    console.log(`   Pass ${pass}: found ${symlinks.length} symlinks`);

    let resolved = 0;
    let removed = 0;
    let errors = 0;

    for (const link of symlinks) {
      try {
        const target = fs.readlinkSync(link);
        // Resolve the absolute target path
        const absTarget = path.isAbsolute(target)
          ? target
          : path.resolve(path.dirname(link), target);

        // Check if target exists
        let targetExists = false;
        try {
          fs.statSync(absTarget);
          targetExists = true;
        } catch (e) {
          // target doesn't exist
        }

        if (!targetExists) {
          // Remove broken symlinks
          fs.unlinkSync(link);
          removed++;
          continue;
        }

        // Check if target is a workspace back-reference (points outside node_modules/.pnpm)
        // These would cause circular copying and are not needed at runtime.
        // A workspace ref is any symlink pointing to a directory under the project root
        // that is NOT inside node_modules/.pnpm (i.e., it's the project root, plugins/, ui/, etc.)
        const isWorkspaceRef = !absTarget.includes('node_modules/.pnpm/') &&
          !absTarget.includes('node_modules\\') &&
          (absTarget.includes('/plugins/') ||
           absTarget.includes('/ui/') ||
           absTarget.includes('/ui\\') ||
           absTarget.includes('/lmscript/') ||
           absTarget.includes('/Development/ai-man') && !absTarget.includes('node_modules'));

        if (isWorkspaceRef) {
          // Remove workspace back-references to avoid circular copies
          fs.rmSync(link, { recursive: true, force: true });
          removed++;
          continue;
        }

        // Replace symlink with a copy of the target
        fs.unlinkSync(link);
        const stats = fs.statSync(absTarget);
        if (stats.isDirectory()) {
          fs.cpSync(absTarget, link, { recursive: true });
        } else {
          fs.copyFileSync(absTarget, link);
        }
        resolved++;
      } catch (e) {
        // If copy fails, just remove the symlink
        try { fs.rmSync(link, { recursive: true, force: true }); } catch (e2) { /* ignore */ }
        errors++;
      }
    }

    totalResolved += resolved;
    totalRemoved += removed;
    totalErrors += errors;

    if (resolved === 0 && removed === symlinks.length) break; // All remaining were just removed
    if (resolved === 0) break; // No new resolutions, exit loop
  }

  console.log(`   ✅ Symlinks resolved: ${totalResolved}, removed: ${totalRemoved}, errors: ${totalErrors}`);

  // Verify no external symlinks remain (internal .framework symlinks are OK)
  try {
    const remaining = execSync(`find "${resourcesDir}" -type l 2>/dev/null | wc -l`, {
      encoding: 'utf8',
    }).trim();
    const count = parseInt(remaining, 10);
    if (count > 0) {
      console.log(`   ⚠️  ${count} symlinks still remain in Resources`);
    } else {
      console.log('   ✓ No symlinks remaining in Resources');
    }
  } catch (e) {
    // ignore check failure
  }
}

exports.default = async function afterPack(context) {
  if (process.platform !== 'darwin') return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );
  const entitlements = path.resolve(__dirname, '..', 'entitlements.mac.plist');

  // Step 1: Resolve pnpm symlinks
  console.log('\n🔗 afterPack: Resolving pnpm symlinks in bundle...');
  resolveSymlinks(appPath);

  // Step 2: Find the signing identity
  let identity;
  if (process.env.CSC_NAME) {
    identity = process.env.CSC_NAME;
  } else {
    // Auto-discover from keychain
    try {
      const output = execSync('security find-identity -v -p codesigning', { encoding: 'utf8' });
      const match = output.match(/"(Developer ID Application:[^"]+)"/);
      if (match) {
        identity = match[1];
      }
    } catch (e) {
      // ignore
    }
  }

  if (!identity) {
    console.warn('⚠️  afterPack: No signing identity found, skipping native binary signing');
    return;
  }

  // Step 3: Sign all native binaries
  console.log(`\n🔏 afterPack: Signing native binaries with "${identity}"`);
  console.log(`   App path: ${appPath}`);
  console.log(`   Entitlements: ${entitlements}`);

  // Find all Mach-O binaries using `find` + `file` command
  // This catches .node, .dylib, .so, and plain executables
  const findCmd = `find "${appPath}" -type f \\( -name "*.node" -o -name "*.dylib" -o -name "*.so" -o -name "*.bare" \\)`;
  
  let nativeFiles = [];
  try {
    const output = execSync(findCmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    nativeFiles = output.trim().split('\n').filter(Boolean);
  } catch (e) {
    console.warn('⚠️  afterPack: find command failed:', e.message);
    return;
  }

  // Also find executables without extensions (like esbuild, spawn-helper, ShipIt)
  const findExeCmd = `find "${appPath}/Contents/Resources" -type f -perm +111 ! -name "*.js" ! -name "*.mjs" ! -name "*.cjs" ! -name "*.json" ! -name "*.md" ! -name "*.txt" ! -name "*.html" ! -name "*.css" ! -name "*.map" ! -name "*.ts" ! -name "*.yml" ! -name "*.yaml" ! -name "*.png" ! -name "*.jpg" ! -name "*.svg" ! -name "*.gif" ! -name "*.ico" ! -name "*.icns" ! -name "*.woff" ! -name "*.woff2" ! -name "*.ttf" ! -name "*.eot" ! -name "*.sh" ! -name "*.py" ! -name "*.rb"`;
  
  try {
    const output = execSync(findExeCmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const exeFiles = output.trim().split('\n').filter(Boolean);
    // Filter to only actual Mach-O files
    for (const f of exeFiles) {
      try {
        const fileType = execSync(`file "${f}"`, { encoding: 'utf8' });
        if (fileType.includes('Mach-O') || fileType.includes('universal binary')) {
          if (!nativeFiles.includes(f)) {
            nativeFiles.push(f);
          }
        }
      } catch (e) {
        // skip non-Mach-O files
      }
    }
  } catch (e) {
    // It's OK if this fails, we still have the extension-based matches
  }

  // Also find Mach-O files in Frameworks directory that might be missed
  const findFrameworkCmd = `find "${appPath}/Contents/Frameworks" -type f \\( -name "*.dylib" -o -perm +111 \\) 2>/dev/null`;
  try {
    const output = execSync(findFrameworkCmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const frameworkFiles = output.trim().split('\n').filter(Boolean);
    for (const f of frameworkFiles) {
      try {
        const fileType = execSync(`file "${f}"`, { encoding: 'utf8' });
        if (fileType.includes('Mach-O') || fileType.includes('universal binary')) {
          if (!nativeFiles.includes(f)) {
            nativeFiles.push(f);
          }
        }
      } catch (e) {
        // skip
      }
    }
  } catch (e) {
    // ignore
  }

  console.log(`   Found ${nativeFiles.length} native binaries to sign`);

  let signed = 0;
  let failed = 0;
  const signErrors = [];

  for (const file of nativeFiles) {
    try {
      // Remove existing signature first (some may have ad-hoc or invalid signatures)
      try {
        execSync(`codesign --remove-signature "${file}" 2>/dev/null`, { encoding: 'utf8' });
      } catch (e) {
        // OK if no signature to remove
      }
      
      // Sign with Developer ID, hardened runtime, secure timestamp, and entitlements
      execSync(
        `codesign --force --sign "${identity}" --timestamp --options runtime --entitlements "${entitlements}" "${file}"`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
      signed++;
    } catch (e) {
      failed++;
      const relPath = path.relative(appPath, file);
      signErrors.push(`${relPath}: ${e.message.split('\n')[0]}`);
    }
  }

  console.log(`   ✅ Signed: ${signed}`);
  if (failed > 0) {
    console.log(`   ⚠️  Failed: ${failed}`);
    for (const err of signErrors.slice(0, 10)) {
      console.log(`      ${err}`);
    }
    if (signErrors.length > 10) {
      console.log(`      ... and ${signErrors.length - 10} more`);
    }
  }
  console.log('');
};
