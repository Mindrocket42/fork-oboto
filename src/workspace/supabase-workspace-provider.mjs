/**
 * @file Supabase-backed workspace provider
 * @module src/workspace/supabase-workspace-provider
 *
 * Implements {@link IWorkspaceProvider} using a Supabase project as the
 * backing store.
 *
 * - Workspace metadata lives in the `workspaces` table.
 * - Workspace files are tracked in the `workspace_files` table with binary
 *   content stored in the `workspace-files` Supabase Storage bucket.
 *
 * The Supabase client is **injected via the constructor** — this module does
 * NOT import `@supabase/supabase-js` directly, keeping it environment-agnostic.
 *
 * Supabase client shape expected:
 * ```
 * supabaseClient.from('table').select(...).eq(...).single()
 * supabaseClient.storage.from('bucket').upload(path, blob, opts)
 * supabaseClient.storage.from('bucket').download(path)
 * supabaseClient.storage.from('bucket').remove([path])
 * ```
 */

import { IWorkspaceProvider } from './workspace-provider.mjs';
import { escapeLikePattern, validateFilePath } from '../lib/path-validation.mjs';

/** Name of the Supabase Storage bucket for workspace file content */
const FILE_BUCKET = 'workspace-files';

/**
 * Generate a URL-friendly slug from a human-readable name.
 *
 * @param {string} name
 * @returns {string}
 */
function slugify(name) {
    return name
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * @implements {IWorkspaceProvider}
 */
export class SupabaseWorkspaceProvider extends IWorkspaceProvider {
    /**
     * @param {object} deps
     * @param {object} deps.supabaseClient - Supabase client instance (service-role recommended)
     * @param {string} deps.orgId - Organisation ID that owns the workspaces
     */
    constructor({ supabaseClient, orgId }) {
        super();
        /** @private */
        this._sc = supabaseClient;
        /** @private */
        this._orgId = orgId;
    }

    // ── helpers ───────────────────────────────────────────────────────────

    /**
     * Map a Supabase `workspaces` row to a {@link WorkspaceInfo} object.
     *
     * @param {object} row - Row from the `workspaces` table
     * @returns {import('./workspace-provider.mjs').WorkspaceInfo}
     * @private
     */
    _toWorkspaceInfo(row) {
        return {
            id: row.id,
            name: row.name,
            slug: row.slug ?? null,
            description: row.description ?? '',
            status: row.status ?? 'idle',
            taskGoal: row.task_goal ?? null,
            currentStep: row.current_step ?? null,
            nextSteps: row.next_steps ?? [],
            sharedMemory: row.shared_memory ?? {},
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            lastActiveAt: row.last_active_at ?? null,
            provider: 'cloud',
        };
    }

    /**
     * Throw a descriptive error if the Supabase response has an error.
     *
     * @param {{ data: any, error: any }} result
     * @param {string} context - Human-readable context for the error message
     * @returns {any} `result.data`
     * @private
     */
    _unwrap(result, context) {
        if (result.error) {
            throw new Error(`SupabaseWorkspaceProvider.${context}: ${result.error.message}`);
        }
        return result.data;
    }

    // ── IWorkspaceProvider implementation ─────────────────────────────────

    /** @override */
    async create(name, options = {}) {
        const slug = options.slug || slugify(name);
        const now = new Date().toISOString();

        const row = {
            name,
            slug,
            org_id: this._orgId,
            description: options.description || '',
            status: options.initialState?.status || 'idle',
            task_goal: options.initialState?.taskGoal || null,
            current_step: options.initialState?.currentStep || null,
            next_steps: options.initialState?.nextSteps || [],
            shared_memory: options.initialState?.sharedMemory || {},
            last_active_at: now,
        };

        const data = this._unwrap(
            await this._sc
                .from('workspaces')
                .insert(row)
                .select('*')
                .single(),
            'create',
        );

        return this._toWorkspaceInfo(data);
    }

    /** @override */
    async get(id) {
        const { data, error } = await this._sc
            .from('workspaces')
            .select('*')
            .eq('id', id)
            .is('deleted_at', null)
            .single();

        if (error) {
            // PGRST116 = "no rows returned" — workspace not found
            if (error.code === 'PGRST116') return null;
            throw new Error(`SupabaseWorkspaceProvider.get: ${error.message}`);
        }
        return this._toWorkspaceInfo(data);
    }

    /** @override */
    async list(filter = {}) {
        let query = this._sc
            .from('workspaces')
            .select('*')
            .eq('org_id', this._orgId)
            .is('deleted_at', null)
            .order('updated_at', { ascending: false });

        if (filter.status) {
            query = query.eq('status', filter.status);
        }

        const data = this._unwrap(await query, 'list');
        return (data ?? []).map((row) => this._toWorkspaceInfo(row));
    }

    /** @override */
    async update(id, updates) {
        const mapped = {};

        if (updates.name !== undefined) mapped.name = updates.name;
        if (updates.slug !== undefined) mapped.slug = updates.slug;
        if (updates.description !== undefined) mapped.description = updates.description;
        if (updates.status !== undefined) mapped.status = updates.status;
        if (updates.taskGoal !== undefined) mapped.task_goal = updates.taskGoal;
        if (updates.currentStep !== undefined) mapped.current_step = updates.currentStep;
        if (updates.nextSteps !== undefined) mapped.next_steps = updates.nextSteps;

        if (updates.sharedMemory !== undefined) {
            // Merge rather than replace
            const { data: existing } = await this._sc
                .from('workspaces')
                .select('shared_memory')
                .eq('id', id)
                .single();

            mapped.shared_memory = {
                ...(existing?.shared_memory || {}),
                ...updates.sharedMemory,
            };
        }

        mapped.updated_at = new Date().toISOString();
        mapped.last_active_at = mapped.updated_at;

        const data = this._unwrap(
            await this._sc
                .from('workspaces')
                .update(mapped)
                .eq('id', id)
                .select('*')
                .single(),
            'update',
        );

        return this._toWorkspaceInfo(data);
    }

    /** @override */
    async delete(id) {
        // Soft-delete: set deleted_at rather than removing the row
        this._unwrap(
            await this._sc
                .from('workspaces')
                .update({ deleted_at: new Date().toISOString() })
                .eq('id', id),
            'delete',
        );
    }

    /** @override */
    async getState(id) {
        const data = this._unwrap(
            await this._sc
                .from('workspaces')
                .select('status, task_goal, current_step, next_steps, shared_memory')
                .eq('id', id)
                .single(),
            'getState',
        );

        return {
            status: data.status ?? 'idle',
            taskGoal: data.task_goal ?? null,
            currentStep: data.current_step ?? null,
            nextSteps: data.next_steps ?? [],
            sharedMemory: data.shared_memory ?? {},
        };
    }

    /** @override */
    async updateState(id, state) {
        const mapped = {};

        if (state.status !== undefined) mapped.status = state.status;
        if (state.taskGoal !== undefined) mapped.task_goal = state.taskGoal;
        if (state.currentStep !== undefined) mapped.current_step = state.currentStep;
        if (state.nextSteps !== undefined) mapped.next_steps = state.nextSteps;

        if (state.sharedMemory !== undefined) {
            const { data: existing } = await this._sc
                .from('workspaces')
                .select('shared_memory')
                .eq('id', id)
                .single();

            mapped.shared_memory = {
                ...(existing?.shared_memory || {}),
                ...state.sharedMemory,
            };
        }

        if (state.progressData !== undefined) {
            // Store progressData as a key in shared_memory
            if (!mapped.shared_memory) {
                const { data: existing } = await this._sc
                    .from('workspaces')
                    .select('shared_memory')
                    .eq('id', id)
                    .single();
                mapped.shared_memory = existing?.shared_memory || {};
            }
            mapped.shared_memory._progressData = state.progressData;
        }

        mapped.updated_at = new Date().toISOString();
        mapped.last_active_at = mapped.updated_at;

        this._unwrap(
            await this._sc
                .from('workspaces')
                .update(mapped)
                .eq('id', id),
            'updateState',
        );
    }

    /** @override */
    async listFiles(id, directory = '') {
        let query = this._sc
            .from('workspace_files')
            .select('file_path, file_type, file_size, mime_type, updated_at')
            .eq('workspace_id', id)
            .eq('is_deleted', false)
            .order('file_path', { ascending: true });

        if (directory) {
            // Validate the directory path to prevent traversal
            const safeDir = validateFilePath(directory);
            // Escape LIKE wildcards (%, _) and filter to files under the directory
            query = query.like('file_path', `${escapeLikePattern(safeDir)}%`);
        }

        const data = this._unwrap(await query, 'listFiles');

        return (data ?? []).map((row) => ({
            path: row.file_path,
            type: row.file_type ?? undefined,
            size: row.file_size ?? undefined,
            mimeType: row.mime_type ?? undefined,
            updatedAt: row.updated_at ?? undefined,
            isDirectory: false, // Supabase storage is flat — directories are implicit
        }));
    }

    /** @override */
    async readFile(id, filePath) {
        const safePath = validateFilePath(filePath);
        // Look up the storage_path via workspace_files
        const record = this._unwrap(
            await this._sc
                .from('workspace_files')
                .select('storage_path')
                .eq('workspace_id', id)
                .eq('file_path', safePath)
                .eq('is_deleted', false)
                .single(),
            'readFile (lookup)',
        );

        const { data, error } = await this._sc.storage
            .from(FILE_BUCKET)
            .download(record.storage_path);

        if (error || !data) {
            throw new Error(
                `SupabaseWorkspaceProvider.readFile: download failed – ${error?.message ?? 'no data'}`,
            );
        }

        return data.text();
    }

    /** @override */
    async writeFile(id, filePath, content) {
        const safePath = validateFilePath(filePath);
        const storagePath = `${id}/${safePath}`;

        // Upload to storage bucket (upsert)
        const blob = new Blob([content], { type: 'text/plain' });
        const { error: uploadErr } = await this._sc.storage
            .from(FILE_BUCKET)
            .upload(storagePath, blob, { upsert: true });

        if (uploadErr) {
            throw new Error(`SupabaseWorkspaceProvider.writeFile: upload failed – ${uploadErr.message}`);
        }

        // Check if a workspace_files record already exists
        const { data: existing } = await this._sc
            .from('workspace_files')
            .select('id, version')
            .eq('workspace_id', id)
            .eq('file_path', safePath)
            .eq('is_deleted', false)
            .maybeSingle();

        const byteSize = new TextEncoder().encode(content).byteLength;

        if (existing) {
            await this._sc
                .from('workspace_files')
                .update({
                    storage_path: storagePath,
                    file_size: byteSize,
                    updated_at: new Date().toISOString(),
                    version: (existing.version ?? 1) + 1,
                })
                .eq('id', existing.id);
        } else {
            const ext = safePath.split('.').pop() ?? '';
            await this._sc.from('workspace_files').insert({
                workspace_id: id,
                file_path: safePath,
                storage_path: storagePath,
                file_type: ext,
                file_size: byteSize,
                mime_type: 'text/plain',
            });
        }
    }

    /** @override */
    async deleteFile(id, filePath) {
        const safePath = validateFilePath(filePath);
        // Look up the storage_path
        const { data: record } = await this._sc
            .from('workspace_files')
            .select('id, storage_path')
            .eq('workspace_id', id)
            .eq('file_path', safePath)
            .eq('is_deleted', false)
            .maybeSingle();

        if (!record) return; // nothing to delete

        // Remove from storage bucket
        await this._sc.storage
            .from(FILE_BUCKET)
            .remove([record.storage_path]);

        // Soft-delete the workspace_files record
        await this._sc
            .from('workspace_files')
            .update({ is_deleted: true, updated_at: new Date().toISOString() })
            .eq('id', record.id);
    }
}
