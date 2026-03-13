/**
 * Tests for the SurfaceManager revision system.
 *
 * Covers: _createRevision, listRevisions, revertToRevision,
 * auto-snapshotting on mutations, pruning, and revert-is-undoable semantics.
 */
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Mock uuid (ESM named export doesn't work with ts-jest transform)
let _counter = 0;
jest.unstable_mockModule('uuid', () => ({
    v4: () => `test-uuid-${String(++_counter).padStart(8, '0')}`,
}));

// Mock consoleStyler to avoid pulling in UI dependency chain
jest.unstable_mockModule('../../ui/console-styler.mjs', () => ({
    consoleStyler: { logError: () => {} },
}));

// Dynamic import AFTER mocks are set up
const { SurfaceManager } = await import('../surface-manager.mjs');

let tmpDir;
let mgr;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'surf-rev-'));
    mgr = new SurfaceManager(tmpDir);
});

afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── helpers ────────────────────────────────────────────────────────

async function createTestSurface(name = 'TestSurface') {
    return mgr.createSurface(name, 'A test surface');
}

async function addComponent(surfaceId, compName, jsx) {
    return mgr.updateComponent(surfaceId, compName, jsx);
}

// ── basic snapshot creation ────────────────────────────────────────

describe('revision creation', () => {
    test('updateComponent creates a revision before mutating', async () => {
        const surface = await createTestSurface();
        const id = surface.id;

        await addComponent(id, 'Header', '<div>Header v1</div>');

        const revs = await mgr.listRevisions(id);
        expect(revs.length).toBe(1);
        expect(revs[0].action).toBe('update_component:Header');
        // The snapshot was of the EMPTY surface (before the mutation)
        expect(revs[0].componentCount).toBe(0);
    });

    test('subsequent updates create additional revisions', async () => {
        const { id } = await createTestSurface();

        await addComponent(id, 'Header', '<div>v1</div>');
        await addComponent(id, 'Header', '<div>v2</div>');
        await addComponent(id, 'Footer', '<div>footer</div>');

        const revs = await mgr.listRevisions(id);
        expect(revs.length).toBe(3);
        // Newest first
        expect(revs[0].revision).toBeGreaterThan(revs[1].revision);
    });

    test('removeComponent creates a revision', async () => {
        const { id } = await createTestSurface();
        await addComponent(id, 'Widget', '<div>widget</div>');

        await mgr.removeComponent(id, 'Widget');

        const revs = await mgr.listRevisions(id);
        // 1 from updateComponent + 1 from removeComponent
        expect(revs.length).toBe(2);
        expect(revs[0].action).toBe('remove_component:Widget');
    });

    test('updateLayout creates a revision', async () => {
        const { id } = await createTestSurface();

        await mgr.updateLayout(id, 'horizontal');

        const revs = await mgr.listRevisions(id);
        expect(revs.length).toBe(1);
        expect(revs[0].action).toBe('update_layout');
    });
});

// ── revert ─────────────────────────────────────────────────────────

describe('revertToRevision', () => {
    test('restores surface metadata and component sources', async () => {
        const { id } = await createTestSurface();

        // v1
        await addComponent(id, 'Header', '<div>Header v1</div>');
        // v2 – overwrites Header
        await addComponent(id, 'Header', '<div>Header v2</div>');

        const revs = await mgr.listRevisions(id);
        const rev1Snapshot = revs.find(r => r.revision === 1);
        const rev2Snapshot = revs.find(r => r.revision === 2);
        expect(rev1Snapshot.componentCount).toBe(0);
        expect(rev2Snapshot.componentCount).toBe(1);

        // Revert to rev 2 (which has Header v1)
        const restored = await mgr.revertToRevision(id, 2);

        expect(restored.components.length).toBe(1);
        expect(restored.components[0].name).toBe('Header');

        // Verify the source file was restored
        const src = await mgr.getComponentSource(id, 'Header');
        expect(src).toBe('<div>Header v1</div>');
    });

    test('revert itself creates a new revision (so it can be undone)', async () => {
        const { id } = await createTestSurface();

        await addComponent(id, 'A', '<div>A</div>');
        await addComponent(id, 'A', '<div>A-changed</div>');

        const revsBefore = await mgr.listRevisions(id);
        const countBefore = revsBefore.length;

        await mgr.revertToRevision(id, 1);

        const revsAfter = await mgr.listRevisions(id);
        // Should have one more revision (the "revert_to:1" snapshot)
        expect(revsAfter.length).toBe(countBefore + 1);
        expect(revsAfter[0].action).toBe('revert_to:1');
    });

    test('revert removes stale component files', async () => {
        const { id } = await createTestSurface();

        // Add two components
        await addComponent(id, 'Alpha', '<div>alpha</div>');
        await addComponent(id, 'Beta', '<div>beta</div>');

        // Revert to rev 1 (empty surface, before Alpha was added)
        await mgr.revertToRevision(id, 1);

        // Both component source files should be gone
        const alpha = await mgr.getComponentSource(id, 'Alpha');
        const beta = await mgr.getComponentSource(id, 'Beta');
        expect(alpha).toBeNull();
        expect(beta).toBeNull();
    });

    test('throws on nonexistent revision', async () => {
        const { id } = await createTestSurface();
        await expect(mgr.revertToRevision(id, 999)).rejects.toThrow('Revision 999 not found');
    });
});

// ── listRevisions ──────────────────────────────────────────────────

describe('listRevisions', () => {
    test('returns empty array for surface with no revisions', async () => {
        const { id } = await createTestSurface();
        const revs = await mgr.listRevisions(id);
        expect(revs).toEqual([]);
    });

    test('returns revisions newest-first', async () => {
        const { id } = await createTestSurface();
        await addComponent(id, 'A', '<div>a</div>');
        await addComponent(id, 'B', '<div>b</div>');
        await addComponent(id, 'C', '<div>c</div>');

        const revs = await mgr.listRevisions(id);
        for (let i = 1; i < revs.length; i++) {
            expect(revs[i - 1].revision).toBeGreaterThan(revs[i].revision);
        }
    });
});

// ── pruning ────────────────────────────────────────────────────────

describe('revision pruning', () => {
    test('prunes revisions beyond MAX_REVISIONS (50)', async () => {
        const { id } = await createTestSurface();

        // Create 55 revisions (each updateComponent makes 1)
        for (let i = 0; i < 55; i++) {
            await addComponent(id, 'Comp', `<div>v${i}</div>`);
        }

        const revs = await mgr.listRevisions(id);
        expect(revs.length).toBeLessThanOrEqual(50);
    }, 30000);
});

// ── edge cases ─────────────────────────────────────────────────────

describe('edge cases', () => {
    test('revision files use zero-padded numbers', async () => {
        const { id } = await createTestSurface();
        await addComponent(id, 'X', '<div>x</div>');

        const revDir = path.join(tmpDir, '.surfaces', `${id}.revisions`);
        const files = await fs.readdir(revDir);
        expect(files).toContain('rev-0001.json');
    });

    test('snapshot contains full component source inline', async () => {
        const { id } = await createTestSurface();
        const jsx = '<div className="test">Hello</div>';
        await addComponent(id, 'Greeting', jsx);
        // The second update snapshots the state WITH Greeting v1
        await addComponent(id, 'Greeting', '<div>v2</div>');

        const revDir = path.join(tmpDir, '.surfaces', `${id}.revisions`);
        const files = (await fs.readdir(revDir)).sort();
        const rev2Content = JSON.parse(await fs.readFile(path.join(revDir, files[1]), 'utf8'));

        expect(rev2Content.componentSources).toBeDefined();
        expect(rev2Content.componentSources['Greeting']).toBe(jsx);
    });

    test('deleteSurface does not crash even if revisions dir exists', async () => {
        const { id } = await createTestSurface();
        await addComponent(id, 'Foo', '<div>foo</div>');

        await expect(mgr.deleteSurface(id)).resolves.toBe(true);
    });
});
