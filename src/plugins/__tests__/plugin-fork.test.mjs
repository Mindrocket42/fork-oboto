/**
 * Tests for plugin-fork — copyPluginToWorkspace functionality.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import path from 'path';

// ── Mock fs/promises ────────────────────────────────────────────────────
jest.unstable_mockModule('fs/promises', () => ({
    default: {
        access: jest.fn(),
        readdir: jest.fn(),
        readFile: jest.fn(),
        stat: jest.fn(),
        mkdir: jest.fn().mockResolvedValue(),
        copyFile: jest.fn().mockResolvedValue(),
        rm: jest.fn().mockResolvedValue(),
    }
}));

// ── Mock console-styler ─────────────────────────────────────────────────
jest.unstable_mockModule('../../ui/console-styler.mjs', () => ({
    consoleStyler: { log: jest.fn() }
}));

const fs = (await import('fs/promises')).default;
const { copyPluginToWorkspace } = await import('../plugin-fork.mjs');
const { PluginLoader } = await import('../plugin-loader.mjs');

// ── Helpers ─────────────────────────────────────────────────────────────

function dirent(name, isDir = true) {
    return { name, isDirectory: () => isDir };
}

function manifest(name, main = 'index.mjs') {
    return JSON.stringify({ name, version: '1.0.0', main });
}

/**
 * Configure mocks so that a plugin named `pluginName` exists in the
 * builtin directory of a loader rooted at `/test/workspace`.
 */
function setupBuiltinPlugin(pluginName) {
    // Compute expected paths
    const loader = new PluginLoader('/test/workspace');
    const builtinDir = loader.builtinDir;
    const pluginDir = path.join(builtinDir, pluginName);

    fs.access.mockImplementation(async (p) => {
        // Allow builtin dir
        if (p === builtinDir) return;
        // Allow entry point
        if (p.endsWith('index.mjs')) return;
        // Block everything else (global dir, workspace .plugins dir)
        throw new Error('ENOENT');
    });

    fs.readdir.mockImplementation(async (dir) => {
        // Builtin directory scan — returns plugin subdirectory
        if (dir === builtinDir) {
            return [dirent(pluginName)];
        }
        // Inside the plugin directory — files only (for copyDir)
        if (dir === pluginDir || dir.endsWith(path.sep + pluginName)) {
            return [
                dirent('index.mjs', false),
                dirent('plugin.json', false),
            ];
        }
        return [];
    });

    fs.readFile.mockImplementation(async (filePath) => {
        if (filePath.includes(pluginName) && filePath.endsWith('plugin.json')) {
            return manifest(pluginName);
        }
        throw new Error('ENOENT');
    });
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('copyPluginToWorkspace', () => {
    let loader;

    beforeEach(() => {
        jest.clearAllMocks();
        loader = new PluginLoader('/test/workspace');
    });

    it('should copy a builtin plugin to workspace .plugins/', async () => {
        setupBuiltinPlugin('my-plugin');

        const result = await copyPluginToWorkspace(loader, 'my-plugin');

        expect(result.success).toBe(true);
        expect(result.message).toContain('my-plugin');
        expect(result.message).toContain('builtin');
        expect(result.workspacePath).toContain('.plugins');
        expect(result.workspacePath).toContain('my-plugin');

        // Verify mkdir was called to create .plugins dir
        expect(fs.mkdir).toHaveBeenCalledWith(
            expect.stringContaining('.plugins'),
            { recursive: true }
        );

        // Verify files were copied
        expect(fs.copyFile).toHaveBeenCalled();
    });

    it('should reject empty plugin name', async () => {
        const result = await copyPluginToWorkspace(loader, '');
        expect(result.success).toBe(false);
        expect(result.message).toContain('non-empty string');
    });

    it('should reject null plugin name', async () => {
        const result = await copyPluginToWorkspace(loader, null);
        expect(result.success).toBe(false);
        expect(result.message).toContain('non-empty string');
    });

    it('should reject plugin names with path traversal', async () => {
        const result1 = await copyPluginToWorkspace(loader, '../escape');
        expect(result1.success).toBe(false);
        expect(result1.message).toContain('path-traversal');

        const result2 = await copyPluginToWorkspace(loader, 'foo/bar');
        expect(result2.success).toBe(false);
        expect(result2.message).toContain('path-traversal');

        const result3 = await copyPluginToWorkspace(loader, 'foo\\bar');
        expect(result3.success).toBe(false);
        expect(result3.message).toContain('path-traversal');
    });

    it('should return error when plugin is not found', async () => {
        // All directories empty/missing
        fs.access.mockRejectedValue(new Error('ENOENT'));

        const result = await copyPluginToWorkspace(loader, 'nonexistent');
        expect(result.success).toBe(false);
        expect(result.message).toContain('not found');
    });

    it('should refuse to overwrite existing workspace copy without force', async () => {
        setupBuiltinPlugin('my-plugin');
        const destDir = path.join(loader.workspaceDir, 'my-plugin');

        // Override access mock so workspace destination exists
        const origAccess = fs.access.getMockImplementation();
        fs.access.mockImplementation(async (p) => {
            if (p === destDir) {
                return; // destination exists
            }
            return origAccess(p);
        });

        const result = await copyPluginToWorkspace(loader, 'my-plugin');
        expect(result.success).toBe(false);
        expect(result.message).toContain('already exists');
        expect(result.message).toContain('force');
    });

    it('should overwrite existing workspace copy with force=true', async () => {
        setupBuiltinPlugin('my-plugin');
        const destDir = path.join(loader.workspaceDir, 'my-plugin');

        // Override access mock so workspace destination exists
        const origAccess = fs.access.getMockImplementation();
        fs.access.mockImplementation(async (p) => {
            if (p === destDir) {
                return; // destination exists
            }
            return origAccess(p);
        });

        const result = await copyPluginToWorkspace(loader, 'my-plugin', { force: true });
        expect(result.success).toBe(true);

        // Verify old copy was removed
        expect(fs.rm).toHaveBeenCalledWith(
            expect.stringContaining('my-plugin'),
            { recursive: true, force: true }
        );
    });

    it('should skip node_modules during copy', async () => {
        setupBuiltinPlugin('my-plugin');

        const builtinPluginDir = path.join(loader.builtinDir, 'my-plugin');

        // Override readdir to include node_modules in the plugin dir
        const origReaddir = fs.readdir.getMockImplementation();
        fs.readdir.mockImplementation(async (dir) => {
            if (dir === builtinPluginDir || dir.endsWith(path.sep + 'my-plugin')) {
                return [
                    dirent('index.mjs', false),
                    dirent('plugin.json', false),
                    dirent('node_modules', true),
                ];
            }
            return origReaddir(dir);
        });

        const result = await copyPluginToWorkspace(loader, 'my-plugin');
        expect(result.success).toBe(true);

        // node_modules should not trigger a recursive readdir call
        const readdirCalls = fs.readdir.mock.calls.map(c => c[0]);
        const nmCalls = readdirCalls.filter(p => p.includes('node_modules'));
        expect(nmCalls).toHaveLength(0);
    });
});
