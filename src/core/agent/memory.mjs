// ==========================================
// DUAL MEMORY ENGINE (Semantic & Lexical)
// ==========================================

import { getTransformersPipeline } from './loader.mjs';

// Cosine Similarity helper
export const cosineSimilarity = (vecA, vecB) => {
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += Math.pow(vecA[i], 2);
        normB += Math.pow(vecB[i], 2);
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

export class AssociativeStringStore {
  constructor() {
    this.items = new Map();
    this.nextId = 1;
  }

  async add(text, meta = null) {
    if (!text) return null;

    // Deduplication: skip if an identical entry already exists
    for (const existing of this.items.values()) {
      if (existing.text === text && existing.validity !== 'retracted') return existing.id;
    }

    const id = this.nextId++;
    const item = {
      id,
      text,
      meta,
      createdAt: Date.now(),
      embedding: null,
      provenance: meta?.provenance || null,   // { source, tool, args, iteration }
      validity: 'valid',                       // 'valid' | 'retracted' | 'superseded'
    };
    
    const { transformersPipeline, isTransformersLoaded } = getTransformersPipeline();

    // Attempt Semantic Embedding if available
    if (isTransformersLoaded && transformersPipeline) {
        try {
            const output = await transformersPipeline(text, { pooling: 'mean', normalize: true });
            item.embedding = Array.from(output.data);
        } catch (e) { console.warn("Embedding failed, falling back to lexical."); }
    }
    
    this.items.set(id, item);
    return id;
  }

  /**
   * Mark a memory item as retracted (invalid). It will no longer appear in recalls.
   * @param {number} id — memory item ID
   * @param {string} [reason] — why this item was retracted
   * @returns {boolean} true if the item was found and retracted
   */
  retract(id, reason) {
    const item = this.items.get(id);
    if (item) {
      item.validity = 'retracted';
      item.retractedAt = Date.now();
      item.retractionReason = reason || null;
      return true;
    }
    return false;
  }

  /**
   * Supersede an existing memory item with corrected information.
   * The old item is marked as 'superseded' and a new item is created.
   * @param {number} oldId — ID of the item to supersede
   * @param {string} newText — corrected text
   * @param {Object} [meta] — optional metadata for the new item
   * @returns {Promise<number|null>} the new item's ID, or null if oldId not found
   */
  async supersede(oldId, newText, meta = null) {
    const oldItem = this.items.get(oldId);
    if (!oldItem) return null;
    this.retract(oldId, 'Superseded by new entry');
    oldItem.validity = 'superseded';
    return this.add(newText, { ...meta, supersedes: oldId });
  }

  list() { return Array.from(this.items.values()); }

  async associate(query, maxResults = 3) {
    if (!query || this.items.size === 0) return [];
    
    const { transformersPipeline, isTransformersLoaded } = getTransformersPipeline();

    let results = [];
    if (isTransformersLoaded && transformersPipeline) {
        // Semantic Search
        const queryOutput = await transformersPipeline(query, { pooling: 'mean', normalize: true });
        const queryEmbedding = Array.from(queryOutput.data);
        
        for (const item of this.items.values()) {
            // Skip retracted entries during recall (Fix 7)
            if (item.validity === 'retracted') continue;

            if (item.embedding) {
                let score = cosineSimilarity(queryEmbedding, item.embedding);
                // Reduce score for superseded entries (Fix 7)
                if (item.validity === 'superseded') score *= 0.3;
                if (score > 0.3) results.push({ ...item, score });
            }
        }
    } else {
        // Lexical Fallback (Simple Substring/Keyword overlap)
        const qLower = query.toLowerCase();
        for (const item of this.items.values()) {
            // Skip retracted entries during recall (Fix 7)
            if (item.validity === 'retracted') continue;

            let score = item.text.toLowerCase().includes(qLower) ? 1.0 : 0;
            // Reduce score for superseded entries (Fix 7)
            if (item.validity === 'superseded') score *= 0.3;
            if (score > 0) results.push({ ...item, score });
        }
    }
    
    return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
  }

  clear() { this.items.clear(); this.nextId = 1; }
}
