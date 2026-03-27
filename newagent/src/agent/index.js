// Agent module barrel export
export { apiKey, MAX_CONTEXT_TURNS, DEFAULT_MODEL, INITIAL_VFS, DEFAULT_PERSONA, AgentResponseSchema, buildSystemPrompt, buildAgentFunction } from './config.js';
export { loadDependencies, getAstModules, getTransformersPipeline } from './loader.js';
export { cosineSimilarity, AssociativeStringStore } from './memory.js';
export { VirtualFileSystem, VFSSyncAdapter } from './vfs.js';
export { PipelineExecutionError, ASTManager, UtilityAdapter, PipelineEngine } from './pipeline.js';
export { executeCommand } from './executor.js';
export { getRuntime, executeFunction } from './api.js';
export { AgentRunner } from './AgentRunner.js';
export { AGENT_SOURCE_DIR, AGENT_PROJECT_ROOT, getSourceManifest, selfRead, selfWrite, selfList, selfRestart, invalidateModuleCache, mountSourceInVFS } from './self-awareness.js';
