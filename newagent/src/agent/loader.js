// ==========================================
// DYNAMIC MODULE LOADER (AST & Transformers)
// ==========================================

let acorn, walk, astring, transformersPipeline;
let isTransformersLoaded = false;
let isAstLoaded = false;

export const getAstModules = () => ({ acorn, walk, astring, isAstLoaded });
export const getTransformersPipeline = () => ({ transformersPipeline, isTransformersLoaded });

export const loadDependencies = async () => {
    try {
        acorn = await import('https://cdn.jsdelivr.net/npm/acorn@8.11.3/+esm');
        walk = await import('https://cdn.jsdelivr.net/npm/acorn-walk@8.3.2/+esm');
        astring = await import('https://cdn.jsdelivr.net/npm/astring@1.8.6/+esm');
        isAstLoaded = true;
    } catch (e) {
        console.warn("Failed to load AST modules, falling back to regex mock.", e);
    }
    
    try {
        const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1/+esm');
        env.allowLocalModels = false;
        transformersPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        isTransformersLoaded = true;
    } catch (e) {
        console.warn("Failed to load Transformers.js (likely CORS/WASM limit in Canvas). Falling back to Lexical memory.", e);
    }

    return { isAstLoaded, isTransformersLoaded };
};
