/**
 * plugin-fork — copies a plugin's source from builtin or global directories
 * into the workspace `.plugins/` directory, enabling local overrides.
 *
 * @module src/plugins/plugin-fork
 */

import fs from 'fs/promises';
import path from 'path';
import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * Recursively copy a directory tree.
 * @param {string} src  — source directory (absolute)
 * @param {string} dest — destination directory (absolute)
 */
async function copyDir(src, dest) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            // Skip node_modules to avoid bloating workspace copies
            if (entry.name === 'node_modules') continue;
            await copyDir(srcPath, destPath);
        } else {
            await fs.copyFile(srcPath, destPath);
        }
    }
}

/**
 * Copy a plugin from builtin or global into the workspace `.plugins/` directory.
 *
 * @param {import('./plugin-loader.mjs').PluginLoader} loader — the PluginLoader instance
 * @param {string} pluginName — name of the plugin to fork
 * @param {object} [options]
 * @param {boolean} [options.force] — overwrite existing workspace copy
 * @returns {Promise<{success: boolean, message: string, workspacePath?: string}>}
 */
export async function copyPluginToWorkspace(loader, pluginName, options = {}) {
    // Validate plugin name (path-traversal guard)
    if (!pluginName || typeof pluginName !== 'string') {
        return { success: false, message: 'Plugin name must be a non-empty string.' };
    }
    if (/[/\\]/.test(pluginName) || pluginName.includes('..')) {
        return { success: false, message: `Invalid plugin name (path-traversal blocked): "${pluginName}"` };
    }

    // Scan builtin and global directories to find the source plugin
    const builtins = await loader._scanDirectory(loader.builtinDir, 'builtin');
    const globals = await loader._scanDirectory(loader.globalDir, 'global');

    // Prefer global over builtin (same override order)
    const allSources = [...builtins, ...globals];
    const sourcePlugin = allSources.reverse().find(p => p.name === pluginName);

    if (!sourcePlugin) {
        return {
            success: false,
            message: `Plugin "${pluginName}" not found in builtin or global directories.\n` +
                `Available: ${[...builtins, ...globals].map(p => p.name).join(', ') || '(none)'}`
        };
    }

    const destDir = path.join(loader.workspaceDir, pluginName);

    // Check if workspace copy already exists
    try {
        await fs.access(destDir);
        if (!options.force) {
            return {
                success: false,
                message: `Plugin "${pluginName}" already exists in workspace at ${destDir}. Use force: true to overwrite.`,
                workspacePath: destDir
            };
        }
        // Remove existing copy before overwriting
        await fs.rm(destDir, { recursive: true, force: true });
    } catch {
        // Destination doesn't exist — good, proceed
    }

    // Ensure .plugins directory exists
    await fs.mkdir(loader.workspaceDir, { recursive: true });

    // Copy the plugin directory
    try {
        await copyDir(sourcePlugin.dir, destDir);
        consoleStyler.log('plugin', `Copied plugin "${pluginName}" from ${sourcePlugin.source} to ${destDir}`);
        return {
            success: true,
            message: `Plugin "${pluginName}" copied from ${sourcePlugin.source} to workspace .plugins/ directory.\n` +
                `Path: ${destDir}\n` +
                `Source: ${sourcePlugin.dir}\n\n` +
                `The workspace copy will take priority over the ${sourcePlugin.source} version on next reload.\n` +
                `Use 'reload plugin ${pluginName}' or restart to apply.`,
            workspacePath: destDir
        };
    } catch (err) {
        return {
            success: false,
            message: `Failed to copy plugin "${pluginName}": ${err.message}`
        };
    }
}
