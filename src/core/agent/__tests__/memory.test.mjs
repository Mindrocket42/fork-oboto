/**
 * memory.test.mjs — Tests for AssociativeStringStore (retract, supersede, dedup)
 * @module src/core/agent/__tests__/memory.test
 *
 * No mocking is needed: getTransformersPipeline() returns
 * { transformersPipeline: undefined, isTransformersLoaded: false } by default,
 * so the lexical fallback path is exercised automatically.
 */

import { AssociativeStringStore, cosineSimilarity } from '../memory.mjs';

// ---------------------------------------------------------------------------
// cosineSimilarity
// ---------------------------------------------------------------------------
describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns 0 when either vector is zero', () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
    expect(cosineSimilarity([1, 2], [0, 0])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AssociativeStringStore — basic operations
// ---------------------------------------------------------------------------
describe('AssociativeStringStore', () => {
  let store;

  beforeEach(() => {
    store = new AssociativeStringStore();
  });

  // --- add / basic ----------------------------------------------------------
  describe('add()', () => {
    it('returns an id for a new entry', async () => {
      const id = await store.add('hello world');
      expect(id).toBe(1);
    });

    it('returns null when text is falsy', async () => {
      expect(await store.add('')).toBeNull();
      expect(await store.add(null)).toBeNull();
      expect(await store.add(undefined)).toBeNull();
    });

    it('stores meta alongside the text', async () => {
      const id = await store.add('fact', { source: 'test' });
      const item = store.items.get(id);
      expect(item.meta).toEqual({ source: 'test' });
    });

    it('sets validity to "valid" by default', async () => {
      const id = await store.add('fact');
      expect(store.items.get(id).validity).toBe('valid');
    });
  });

  // --- deduplication --------------------------------------------------------
  describe('deduplication', () => {
    it('returns the existing id when adding duplicate text', async () => {
      const id1 = await store.add('same text');
      const id2 = await store.add('same text');
      expect(id1).toBe(id2);
      expect(store.list().length).toBe(1);
    });

    it('allows re-adding text that was retracted', async () => {
      const id1 = await store.add('retractable');
      store.retract(id1);
      const id2 = await store.add('retractable');
      expect(id2).not.toBe(id1);
      expect(store.list().length).toBe(2);
    });

    it('treats different text as distinct entries', async () => {
      const id1 = await store.add('alpha');
      const id2 = await store.add('beta');
      expect(id1).not.toBe(id2);
      expect(store.list().length).toBe(2);
    });
  });

  // --- retract --------------------------------------------------------------
  describe('retract()', () => {
    it('marks an existing item as retracted and returns true', async () => {
      const id = await store.add('to be retracted');
      const result = store.retract(id, 'wrong info');
      expect(result).toBe(true);
      const item = store.items.get(id);
      expect(item.validity).toBe('retracted');
      expect(item.retractionReason).toBe('wrong info');
      expect(item.retractedAt).toEqual(expect.any(Number));
    });

    it('returns false for a non-existent id', () => {
      expect(store.retract(999)).toBe(false);
    });

    it('sets retractionReason to null when no reason provided', async () => {
      const id = await store.add('oops');
      store.retract(id);
      expect(store.items.get(id).retractionReason).toBeNull();
    });
  });

  // --- supersede ------------------------------------------------------------
  describe('supersede()', () => {
    it('marks the old item as superseded and creates a new item', async () => {
      const oldId = await store.add('Earth is flat');
      const newId = await store.supersede(oldId, 'Earth is round');
      expect(newId).not.toBe(oldId);
      expect(store.items.get(oldId).validity).toBe('superseded');
      expect(store.items.get(newId).text).toBe('Earth is round');
      expect(store.items.get(newId).validity).toBe('valid');
    });

    it('records the supersedes link in meta', async () => {
      const oldId = await store.add('old fact');
      const newId = await store.supersede(oldId, 'new fact', { note: 'correction' });
      const newItem = store.items.get(newId);
      expect(newItem.meta.supersedes).toBe(oldId);
      expect(newItem.meta.note).toBe('correction');
    });

    it('returns null when superseding a non-existent id', async () => {
      const result = await store.supersede(999, 'whatever');
      expect(result).toBeNull();
    });

    it('sets retractedAt on the old item', async () => {
      const oldId = await store.add('stale');
      await store.supersede(oldId, 'fresh');
      const oldItem = store.items.get(oldId);
      expect(oldItem.retractedAt).toEqual(expect.any(Number));
      expect(oldItem.retractionReason).toBe('Superseded by new entry');
    });
  });

  // --- associate (recall) ---------------------------------------------------
  describe('associate()', () => {
    it('returns matching items via lexical fallback', async () => {
      await store.add('The sky is blue');
      await store.add('Grass is green');
      const results = await store.associate('sky');
      expect(results.length).toBe(1);
      expect(results[0].text).toBe('The sky is blue');
    });

    it('excludes retracted items from recall', async () => {
      const id = await store.add('secret info');
      await store.add('public info');
      store.retract(id);
      const results = await store.associate('info');
      expect(results.every(r => r.validity !== 'retracted')).toBe(true);
      expect(results.length).toBe(1);
      expect(results[0].text).toBe('public info');
    });

    it('returns empty array for empty query', async () => {
      await store.add('something');
      expect(await store.associate('')).toEqual([]);
    });

    it('returns empty array when store is empty', async () => {
      expect(await store.associate('anything')).toEqual([]);
    });

    it('superseded items receive reduced score', async () => {
      const oldId = await store.add('info about cats');
      await store.supersede(oldId, 'updated info about cats');
      const results = await store.associate('cats');
      // The superseded entry should have score * 0.3
      const supersededResult = results.find(r => r.validity === 'superseded');
      const validResult = results.find(r => r.validity === 'valid');
      expect(validResult).toBeDefined();
      if (supersededResult) {
        expect(supersededResult.score).toBeLessThan(validResult.score);
      }
    });

    it('respects maxResults limit', async () => {
      await store.add('alpha match');
      await store.add('beta match');
      await store.add('gamma match');
      await store.add('delta match');
      const results = await store.associate('match', 2);
      expect(results.length).toBe(2);
    });
  });

  // --- list / clear ---------------------------------------------------------
  describe('list() and clear()', () => {
    it('list() returns all items including retracted ones', async () => {
      const id = await store.add('a');
      await store.add('b');
      store.retract(id);
      expect(store.list().length).toBe(2);
    });

    it('clear() removes all items and resets nextId', async () => {
      await store.add('x');
      await store.add('y');
      store.clear();
      expect(store.list().length).toBe(0);
      const id = await store.add('z');
      expect(id).toBe(1);
    });
  });
});
