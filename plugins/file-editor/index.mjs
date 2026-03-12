/**
 * File Editor Plugin — Advanced LLM-powered file editing with search/replace patches.
 *
 * Provides surgical file editing tools that generate search/replace patches
 * instead of rewriting entire files. Includes fuzzy matching, atomic multi-file
 * transactions with rollback, and preview/dry-run support.
 *
 * Ported from tinyaleph's file-editor module.
 */

import fs from 'fs';
import path from 'path';
import { registerSettingsHandlers } from '../../src/plugins/plugin-settings-handlers.mjs';
import { consoleStyler } from '../../src/ui/console-styler.mjs';
import { applyPatch, applyPatches, validateEdit } from './engine/patchEngine.mjs';
import { SYSTEM_PROMPT } from './engine/prompts.mjs';
import { FileTransaction, TransactionManager, executeAtomic, validateEdits } from './engine/transaction.mjs';

const fsPromises = fs.promises;

const DEFAULT_SETTINGS = {
    enabled: true,
    createBackups: true,
    maxRetries: 2,
    maxTokens: 32768,
};

const SETTINGS_SCHEMA = [
    { key: 'enabled', label: 'Enabled', type: 'boolean', description: 'Enable or disable the file-editor plugin', default: true },
    { key: 'createBackups', label: 'Create Backups', type: 'boolean', description: 'Create .bak files before editing', default: true },
    { key: 'maxRetries', label: 'Max Retries', type: 'number', description: 'Max retries for LLM edit generation', default: 2 },
    { key: 'maxTokens', label: 'Max Tokens', type: 'number', description: 'Max tokens for LLM edit response', default: 32768 },
];

// ============================================================================
// LLM BRIDGE — adapts ai-man's api.ai to the file-editor's LLM interface
// ============================================================================

/**
 * Generate edits by asking the AI to produce search/replace patches.
 * @param {object} aiAPI — the plugin's api.ai object
 * @param {string} fileName — name of the file being edited
 * @param {string} fileContent — current file content
 * @param {string} instruction — what changes to make
 * @param {object} options — { maxTokens }
 * @returns {Promise<object>} — { thoughtProcess, edits[], error? }
 */
async function generateEdits(aiAPI, fileName, fileContent, instruction, options = {}) {
    const userMessage = `
FILENAME: ${fileName}

FILE CONTENT:
\`\`\`
${fileContent}
\`\`\`

USER INSTRUCTION: 
${instruction}
`;

    const fullPrompt = `${SYSTEM_PROMPT}\n\n${userMessage}\n\nRespond with valid JSON only.`;

    try {
        const response = await aiAPI.ask(fullPrompt, {
            temperature: 0.1,
            maxTokens: options.maxTokens || 32768,
        });

        return parseEditResponse(response);
    } catch (error) {
        return {
            thoughtProcess: `Error generating edits: ${error.message}`,
            edits: [],
            error: error.message,
        };
    }
}

/**
 * Parse the LLM response to extract edits.
 */
function parseEditResponse(content) {
    if (!content || typeof content !== 'string') {
        return { thoughtProcess: 'Empty response from LLM', edits: [], error: 'Empty response' };
    }

    let jsonStr = content.trim();

    // If wrapped in markdown code blocks, extract
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    // Try to find JSON object in response
    const jsonObjMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonObjMatch) jsonStr = jsonObjMatch[0];

    try {
        const parsed = JSON.parse(jsonStr);
        return {
            thoughtProcess: parsed.thoughtProcess || 'No thought process provided',
            edits: Array.isArray(parsed.edits) ? parsed.edits : [],
            raw: parsed,
        };
    } catch (parseError) {
        return {
            thoughtProcess: `Failed to parse response as JSON. Raw: ${content.slice(0, 200)}...`,
            edits: [],
            error: parseError.message,
            rawResponse: content,
        };
    }
}

/**
 * Generate edits with retry and exponential backoff.
 */
async function generateEditsWithRetry(aiAPI, fileName, fileContent, instruction, options = {}) {
    const maxRetries = options.maxRetries || 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await generateEdits(aiAPI, fileName, fileContent, instruction, options);

            if (result.edits && result.edits.length > 0) return result;
            if (result.thoughtProcess?.toLowerCase().includes('no change') ||
                result.thoughtProcess?.toLowerCase().includes('already')) {
                return result;
            }

            lastError = result.error || 'No edits generated';
        } catch (error) {
            lastError = error.message;
        }

        if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }

    return { thoughtProcess: `Failed after ${maxRetries} attempts: ${lastError}`, edits: [], error: lastError };
}

// ============================================================================
// PLUGIN ACTIVATION
// ============================================================================

/**
 * Called when the plugin is activated.
 * @param {import('../../src/plugins/plugin-api.mjs').PluginAPI} api
 */
export async function activate(api) {
    consoleStyler.log('plugin', '📝 File Editor plugin activating...');

    const { pluginSettings } = await registerSettingsHandlers(
        api, 'file-editor', DEFAULT_SETTINGS, SETTINGS_SCHEMA
    );

    // Persistent transaction manager
    const txManager = new TransactionManager({
        baseDir: api.workingDir,
    });
    api.setInstance({ txManager });

    // ── Tool 1: file_edit ─────────────────────────────────────────────────
    // LLM-powered surgical file editing
    api.tools.register({
        name: 'file_edit',
        description:
            'Edit a file using LLM-generated search/replace patches. Instead of rewriting the ' +
            'entire file, the AI generates precise patches that are applied surgically. Ideal for ' +
            'large files. Returns the number of edits applied and any errors.',
        parameters: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Path to the file to edit (relative to workspace or absolute)',
                },
                instruction: {
                    type: 'string',
                    description: 'Natural language instruction describing what changes to make',
                },
                backup: {
                    type: 'boolean',
                    description: 'Whether to create a .bak backup before editing (default: from settings)',
                },
            },
            required: ['filePath', 'instruction'],
        },
        handler: async (args) => {
            const resolvedPath = path.resolve(api.workingDir, args.filePath);
            const fileName = path.basename(resolvedPath);

            // Read the file
            let originalContent;
            try {
                originalContent = await fsPromises.readFile(resolvedPath, 'utf-8');
            } catch (readError) {
                return JSON.stringify({
                    success: false,
                    error: `Failed to read file: ${readError.message}`,
                    filePath: resolvedPath,
                });
            }

            // Generate edits via LLM
            const result = await generateEditsWithRetry(
                api.ai, fileName, originalContent, args.instruction,
                { maxRetries: pluginSettings.maxRetries, maxTokens: pluginSettings.maxTokens }
            );

            if (result.error && (!result.edits || result.edits.length === 0)) {
                return JSON.stringify({
                    success: false,
                    error: result.error,
                    thoughtProcess: result.thoughtProcess,
                    filePath: resolvedPath,
                });
            }

            if (!result.edits || result.edits.length === 0) {
                return JSON.stringify({
                    success: true,
                    noChanges: true,
                    thoughtProcess: result.thoughtProcess,
                    filePath: resolvedPath,
                    message: 'No edits were necessary',
                });
            }

            // Apply edits sequentially
            let modifiedContent = originalContent;
            const appliedEdits = [];
            const failedEdits = [];

            for (const edit of result.edits) {
                try {
                    modifiedContent = applyPatch(modifiedContent, edit);
                    appliedEdits.push(edit);
                } catch (patchError) {
                    failedEdits.push({ edit, error: patchError.message });
                }
            }

            // Write back if changed
            if (modifiedContent !== originalContent) {
                try {
                    const doBackup = args.backup ?? pluginSettings.createBackups;
                    if (doBackup) {
                        await fsPromises.writeFile(`${resolvedPath}.bak`, originalContent, 'utf-8');
                    }
                    await fsPromises.writeFile(resolvedPath, modifiedContent, 'utf-8');

                    api.events.emit('file-edited', {
                        filePath: resolvedPath,
                        editsApplied: appliedEdits.length,
                        editsFailed: failedEdits.length,
                    });

                    return JSON.stringify({
                        success: true,
                        filePath: resolvedPath,
                        thoughtProcess: result.thoughtProcess,
                        editsApplied: appliedEdits.length,
                        editsFailed: failedEdits.length,
                        failedEdits: failedEdits.length > 0 ? failedEdits : undefined,
                        message: `Applied ${appliedEdits.length} edit(s) to ${fileName}`,
                    });
                } catch (writeError) {
                    return JSON.stringify({
                        success: false,
                        error: `Failed to write file: ${writeError.message}`,
                        filePath: resolvedPath,
                    });
                }
            } else {
                return JSON.stringify({
                    success: true,
                    noChanges: true,
                    thoughtProcess: result.thoughtProcess,
                    filePath: resolvedPath,
                    message: 'File content unchanged after applying edits',
                });
            }
        },
    });

    // ── Tool 2: file_edit_preview ─────────────────────────────────────────
    // Preview edits without applying
    api.tools.register({
        name: 'file_edit_preview',
        description:
            'Preview proposed edits to a file without applying them. Shows what changes ' +
            'the LLM would make. Use this to verify changes before committing.',
        parameters: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Path to the file to preview edits for',
                },
                instruction: {
                    type: 'string',
                    description: 'Natural language instruction describing what changes to make',
                },
            },
            required: ['filePath', 'instruction'],
        },
        handler: async (args) => {
            const resolvedPath = path.resolve(api.workingDir, args.filePath);
            const fileName = path.basename(resolvedPath);

            let originalContent;
            try {
                originalContent = await fsPromises.readFile(resolvedPath, 'utf-8');
            } catch (readError) {
                return JSON.stringify({
                    success: false,
                    error: `Failed to read file: ${readError.message}`,
                });
            }

            const result = await generateEdits(
                api.ai, fileName, originalContent, args.instruction,
                { maxTokens: pluginSettings.maxTokens }
            );

            return JSON.stringify({
                success: !result.error,
                filePath: resolvedPath,
                thoughtProcess: result.thoughtProcess,
                edits: result.edits,
                error: result.error,
            });
        },
    });

    // ── Tool 3: file_edit_apply_patch ─────────────────────────────────────
    // Apply raw search/replace patches directly (no LLM call)
    api.tools.register({
        name: 'file_edit_apply_patch',
        description:
            'Apply one or more search/replace patches directly to a file without using the LLM. ' +
            'Each patch has a searchBlock (exact text to find) and replaceBlock (replacement text). ' +
            'The searchBlock must be unique in the file.',
        parameters: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Path to the file to patch',
                },
                patches: {
                    type: 'array',
                    description: 'Array of patch objects',
                    items: {
                        type: 'object',
                        properties: {
                            searchBlock: {
                                type: 'string',
                                description: 'Exact text to find (must be unique in the file)',
                            },
                            replaceBlock: {
                                type: 'string',
                                description: 'Text to replace the search block with (empty string to delete)',
                            },
                        },
                        required: ['searchBlock', 'replaceBlock'],
                    },
                },
                backup: {
                    type: 'boolean',
                    description: 'Whether to create a .bak backup',
                },
            },
            required: ['filePath', 'patches'],
        },
        handler: async (args) => {
            const resolvedPath = path.resolve(api.workingDir, args.filePath);

            let content;
            try {
                content = await fsPromises.readFile(resolvedPath, 'utf-8');
            } catch (readError) {
                return JSON.stringify({
                    success: false,
                    error: `Failed to read file: ${readError.message}`,
                });
            }

            const result = applyPatches(content, args.patches);

            if (result.applied > 0 && result.finalContent !== content) {
                try {
                    const doBackup = args.backup ?? pluginSettings.createBackups;
                    if (doBackup) {
                        await fsPromises.writeFile(`${resolvedPath}.bak`, content, 'utf-8');
                    }
                    await fsPromises.writeFile(resolvedPath, result.finalContent, 'utf-8');

                    api.events.emit('file-patched', {
                        filePath: resolvedPath,
                        applied: result.applied,
                        failed: result.failed,
                    });
                } catch (writeError) {
                    return JSON.stringify({
                        success: false,
                        error: `Failed to write file: ${writeError.message}`,
                    });
                }
            }

            return JSON.stringify({
                success: result.failed === 0,
                filePath: resolvedPath,
                applied: result.applied,
                failed: result.failed,
                errors: result.errors.length > 0 ? result.errors : undefined,
                message: `Applied ${result.applied} patch(es), ${result.failed} failed`,
            });
        },
    });

    // ── Tool 4: file_edit_transaction ─────────────────────────────────────
    // Atomic multi-file editing with rollback
    api.tools.register({
        name: 'file_edit_transaction',
        description:
            'Perform atomic multi-file edits with automatic rollback on failure. ' +
            'Provide an array of edits across multiple files. All edits are validated first, ' +
            'then committed atomically — if any file write fails, all changes are rolled back.',
        parameters: {
            type: 'object',
            properties: {
                edits: {
                    type: 'array',
                    description: 'Array of edit objects for multiple files',
                    items: {
                        type: 'object',
                        properties: {
                            filePath: {
                                type: 'string',
                                description: 'Path to the file to edit',
                            },
                            searchBlock: {
                                type: 'string',
                                description: 'Exact text to find in the file',
                            },
                            replaceBlock: {
                                type: 'string',
                                description: 'Text to replace the search block with',
                            },
                        },
                        required: ['filePath', 'searchBlock', 'replaceBlock'],
                    },
                },
                dryRun: {
                    type: 'boolean',
                    description: 'If true, validate edits without applying them',
                },
            },
            required: ['edits'],
        },
        handler: async (args) => {
            // Resolve all file paths
            const resolvedEdits = args.edits.map(edit => ({
                ...edit,
                filePath: path.resolve(api.workingDir, edit.filePath),
            }));

            if (args.dryRun) {
                const validation = await validateEdits(resolvedEdits, {
                    baseDir: api.workingDir,
                });

                return JSON.stringify({
                    success: validation.valid,
                    dryRun: true,
                    files: validation.files,
                    errors: validation.errors.length > 0 ? validation.errors : undefined,
                    message: validation.valid
                        ? `All ${resolvedEdits.length} edit(s) validated successfully`
                        : `Validation failed with ${validation.errors.length} error(s)`,
                });
            }

            const result = await executeAtomic(resolvedEdits, {
                baseDir: api.workingDir,
                createBackups: pluginSettings.createBackups,
            });

            if (result.success) {
                api.events.emit('transaction-committed', {
                    filesCommitted: result.filesCommitted,
                    editsApplied: result.editsApplied,
                });
            }

            return JSON.stringify({
                success: result.success,
                filesCommitted: result.filesCommitted,
                editsApplied: result.editsApplied,
                backupsCreated: result.backupsCreated,
                errors: result.errors?.length > 0 ? result.errors : undefined,
                rollbackPerformed: result.rollbackPerformed,
                message: result.success
                    ? `Committed ${result.editsApplied} edit(s) across ${result.filesCommitted} file(s)`
                    : `Transaction failed: ${result.error}`,
            });
        },
    });

    consoleStyler.log('plugin', '📝 File Editor plugin activated — 4 tools registered');
}

/**
 * Called when the plugin is deactivated.
 * @param {import('../../src/plugins/plugin-api.mjs').PluginAPI} api
 */
export async function deactivate(api) {
    const state = api.getInstance();
    if (state?.txManager) {
        // Clean up any pending transactions
        for (const tx of state.txManager.list()) {
            if (tx.state === 'pending' || tx.state === 'validated') {
                tx.abort();
            }
        }
    }
    api.setInstance(null);
    consoleStyler.log('plugin', '📝 File Editor plugin deactivated');
}
