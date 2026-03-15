/**
 * PluginLoader tests — verifies discovery from workspace .plugins/ folder,
 * builtin, global, and npm sources.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// ── Mock fs/promises ────────────────────────────────────────────────────
jest.unstable_mockModule('fs/promises', () => ({
    default: {
        access: jest.fn(),
        readdir: jest.fn(),
        readFile: jest.fn(),
        stat: jest.fn(),
    }
}));

// ── Mock console-styler to suppress log noise ───────────────────────────
jest.unstable_mockModule('../../ui/console-styler.mjs', () => ({
    consoleStyler: { log: jest.fn() }
}));

const fs = (await import('fs/promises')).default;
const { PluginLoader } = await import('../plugin-loader.mjs');

// ── Helpers ─────────────────────────────────────────────────────────────

/** Simulate a directory that exists (fs.access resolves). */
function allowAccess(pathPattern) {
    fs.access.mockImplementation(async (p) => {
        if (typeof pathPattern === 'function' ? pathPattern(p) : p.includes(pathPattern)) {
            return;
        }
        throw new Error('ENOENT');
    });
}

/** Build a fake dirent entry. */
function dirent(name, isDir = true) {
    return { name, isDirectory: () => isDir };
}

/** Build a valid plugin.json string. */
function manifest(name, main = 'index.mjs') {
    return JSON.stringify({ name, version: '1.0.0', main });
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('PluginLoader', () => {
    let loader;

    beforeEach(() => {
        jest.clearAllMocks();
        loader = new PluginLoader('/test/workspace');
    });

    // ── Constructor ─────────────────────────────────────────────────────

    it('should set workspaceDir to <workingDir>/.plugins', () => {
        expect(loader.workspaceDir).toMatch(/\/test\/workspace\/\.plugins$/);
    });

    // ── Workspace plugin discovery ──────────────────────────────────────

    describe('workspace .plugins/ discovery', () => {
        it('should discover plugins from .plugins/ directory', async () => {
            // Make all three dirs accessible but only workspace has content
            fs.access.mockImplementation(async (p) => {
                // Allow .plugins dir and the entry point file
                if (p.includes('.plugins') || p.includes('index.mjs')) return;
                // Block builtin/global dirs so they return empty
                throw new Error('ENOENT');
            });

            fs.readdir.mockImplementation(async (dir) => {
                if (dir.includes('.plugins')) {
                    return [dirent('my-workspace-plugin')];
                }
                return [];
            });

            fs.readFile.mockImplementation(async (filePath) => {
                if (filePath.includes('my-workspace-plugin') && filePath.endsWith('plugin.json')) {
                    return manifest('my-workspace-plugin');
                }
                throw new Error('ENOENT');
            });

            const plugins = await loader.discover();
            const wp = plugins.find(p => p.name === 'my-workspace-plugin');

            expect(wp).toBeDefined();
            expect(wp.source).toBe('workspace');
            expect(wp.dir).toContain('.plugins');
            expect(wp.manifest.name).toBe('my-workspace-plugin');
        });

        it('should gracefully handle missing .plugins/ directory', async () => {
            // All directories missing
            fs.access.mockRejectedValue(new Error('ENOENT'));

            const plugins = await loader.discover();
            expect(plugins).toEqual([]);
        });

        it('should skip non-directory entries in .plugins/', async () => {
            fs.access.mockImplementation(async (p) => {
                if (p.includes('.plugins')) return;
                throw new Error('ENOENT');
            });

            fs.readdir.mockImplementation(async (dir) => {
                if (dir.includes('.plugins')) {
                    return [
                        dirent('README.md', false), // file, not directory
                        dirent('.hidden-dir', true), // dot-prefixed
                    ];
                }
                return [];
            });

            const plugins = await loader.discover();
            expect(plugins).toEqual([]);
        });

        it('should skip plugins without valid plugin.json', async () => {
            fs.access.mockImplementation(async (p) => {
                if (p.includes('.plugins')) return;
                throw new Error('ENOENT');
            });

            fs.readdir.mockImplementation(async (dir) => {
                if (dir.includes('.plugins')) {
                    return [dirent('bad-plugin')];
                }
                return [];
            });

            // Invalid JSON
            fs.readFile.mockRejectedValue(new Error('ENOENT'));

            const plugins = await loader.discover();
            expect(plugins).toEqual([]);
        });

        it('should skip plugins with path-traversal names', async () => {
            fs.access.mockImplementation(async (p) => {
                if (p.includes('.plugins') || p.includes('index.mjs')) return;
                throw new Error('ENOENT');
            });

            fs.readdir.mockImplementation(async (dir) => {
                if (dir.includes('.plugins')) {
                    return [dirent('traversal-plugin')];
                }
                return [];
            });

            fs.readFile.mockImplementation(async (filePath) => {
                if (filePath.endsWith('plugin.json')) {
                    // Name with path traversal
                    return JSON.stringify({ name: '../escape', version: '1.0.0', main: 'index.mjs' });
                }
                throw new Error('ENOENT');
            });

            const plugins = await loader.discover();
            expect(plugins).toEqual([]);
        });
    });

    // ── Source priority ─────────────────────────────────────────────────

    describe('source priority', () => {
        it('workspace plugins should override builtin plugins with the same name', async () => {
            // All dirs exist
            fs.access.mockResolvedValue();

            fs.readdir.mockImplementation(async (dir) => {
                if (dir.includes('plugins') && !dir.includes('.plugins') && !dir.includes('.oboto')) {
                    // builtin dir
                    return [dirent('shared-plugin')];
                }
                if (dir.includes('.oboto')) {
                    // global dir — empty
                    return [];
                }
                if (dir.includes('.plugins')) {
                    // workspace dir
                    return [dirent('shared-plugin')];
                }
                return [];
            });

            fs.readFile.mockImplementation(async (filePath) => {
                if (filePath.endsWith('plugin.json')) {
                    if (filePath.includes('.plugins')) {
                        return manifest('shared-plugin', 'index.mjs');
                    }
                    return manifest('shared-plugin', 'index.mjs');
                }
                if (filePath.endsWith('package.json')) {
                    throw new Error('ENOENT');
                }
                throw new Error('ENOENT');
            });

            const plugins = await loader.discover();
            const shared = plugins.find(p => p.name === 'shared-plugin');

            expect(shared).toBeDefined();
            // Workspace should override builtin (later source wins)
            expect(shared.source).toBe('workspace');
        });
    });

    // ── Module loading security ─────────────────────────────────────────

    describe('loadModule()', () => {
        it('should reject entry points that escape the plugin directory', async () => {
            const plugin = {
                name: 'evil-plugin',
                dir: '/test/workspace/.plugins/evil-plugin',
                manifest: { name: 'evil-plugin', main: '../../etc/passwd' },
                source: 'workspace'
            };

            await expect(loader.loadModule(plugin)).rejects.toThrow(/escapes plugin directory/);
        });

        it('should track reload counts', () => {
            expect(loader.getReloadCount('test-plugin')).toBe(0);
        });
    });

    // ── _scanDirectory ──────────────────────────────────────────────────

    describe('_scanDirectory()', () => {
        it('should return empty array when directory does not exist', async () => {
            fs.access.mockRejectedValue(new Error('ENOENT'));

            const result = await loader._scanDirectory('/nonexistent', 'test');
            expect(result).toEqual([]);
        });

        it('should skip node_modules directories', async () => {
            fs.access.mockResolvedValue();
            fs.readdir.mockResolvedValue([
                dirent('node_modules'),
                dirent('real-plugin'),
            ]);

            fs.readFile.mockImplementation(async (filePath) => {
                if (filePath.includes('real-plugin') && filePath.endsWith('plugin.json')) {
                    return manifest('real-plugin');
                }
                throw new Error('ENOENT');
            });

            const result = await loader._scanDirectory('/some/dir', 'test');
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('real-plugin');
        });
    });

    // ── _loadManifest ───────────────────────────────────────────────────

    describe('_loadManifest()', () => {
        it('should return null for missing plugin.json', async () => {
            fs.readFile.mockRejectedValue(new Error('ENOENT'));
            const result = await loader._loadManifest('/some/plugin');
            expect(result).toBeNull();
        });

        it('should return null for plugin with missing name', async () => {
            fs.readFile.mockResolvedValue(JSON.stringify({ main: 'index.mjs' }));
            const result = await loader._loadManifest('/some/plugin');
            expect(result).toBeNull();
        });

        it('should default main to index.mjs when not specified', async () => {
            fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test-plugin' }));
            fs.access.mockResolvedValue(); // entry point exists

            const result = await loader._loadManifest('/some/plugin');
            expect(result).not.toBeNull();
            expect(result.main).toBe('index.mjs');
        });

        it('should return null when entry point file does not exist', async () => {
            fs.readFile.mockResolvedValue(JSON.stringify({ name: 'test-plugin', main: 'missing.mjs' }));
            fs.access.mockRejectedValue(new Error('ENOENT'));

            const result = await loader._loadManifest('/some/plugin');
            expect(result).toBeNull();
        });

        it('should reject names with slashes', async () => {
            fs.readFile.mockResolvedValue(JSON.stringify({ name: 'foo/bar', main: 'index.mjs' }));
            const result = await loader._loadManifest('/some/plugin');
            expect(result).toBeNull();
        });

        it('should reject names with backslashes', async () => {
            fs.readFile.mockResolvedValue(JSON.stringify({ name: 'foo\\bar', main: 'index.mjs' }));
            const result = await loader._loadManifest('/some/plugin');
            expect(result).toBeNull();
        });

        it('should reject names containing ".."', async () => {
            fs.readFile.mockResolvedValue(JSON.stringify({ name: '..escape', main: 'index.mjs' }));
            const result = await loader._loadManifest('/some/plugin');
            expect(result).toBeNull();
        });
    });
});
