// ==========================================
// DUAL MEMORY ENGINE (Semantic & Lexical)
// ==========================================

import { getTransformersPipeline } from './loader.js';

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
    const id = this.nextId++;
    const item = { id, text, meta, createdAt: Date.now(), embedding: null };
    
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
            if (item.embedding) {
                const score = cosineSimilarity(queryEmbedding, item.embedding);
                if (score > 0.3) results.push({ ...item, score });
            }
        }
    } else {
        // Lexical Fallback (Simple Substring/Keyword overlap)
        const qLower = query.toLowerCase();
        for (const item of this.items.values()) {
            let score = item.text.toLowerCase().includes(qLower) ? 1.0 : 0;
            if (score > 0) results.push({ ...item, score });
        }
    }
    
    return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
  }

  clear() { this.items.clear(); this.nextId = 1; }
}
