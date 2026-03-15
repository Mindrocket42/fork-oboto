/**
 * @file Shared path-validation and SQL-LIKE escaping utilities
 * @module src/lib/path-validation
 *
 * Extracted from supabase-tools.mjs and supabase-workspace-provider.mjs
 * to eliminate duplication.
 */

/**
 * Escape SQL LIKE wildcard characters in user input.
 * @param {string} str - Raw user input
 * @returns {string} Escaped string safe for LIKE patterns
 */
export function escapeLikePattern(str) {
    return str.replace(/[%_\\]/g, '\\$&');
}

/**
 * Validate and normalize a relative file path within a workspace.
 * Rejects path traversal attempts (e.g. `../`, absolute paths).
 *
 * @param {string} filePath — Relative file path to validate
 * @returns {string} — Normalized safe path
 * @throws {Error} If the path attempts traversal or is absolute
 */
export function validateFilePath(filePath) {
    if (!filePath || typeof filePath !== 'string') {
        throw new Error('File path must be a non-empty string');
    }
    // Normalize backslashes to forward slashes
    const normalized = filePath.replace(/\\/g, '/');
    // Reject absolute paths
    if (normalized.startsWith('/')) {
        throw new Error(`Invalid file path: "${filePath}" — absolute paths not allowed`);
    }
    // Reject any segment that is '..'
    const segments = normalized.split('/');
    for (const seg of segments) {
        if (seg === '..') {
            throw new Error(`Invalid file path: "${filePath}" — path traversal (..) not allowed`);
        }
    }
    // Collapse any '.' segments and remove empty segments (e.g. 'a//b')
    const cleaned = segments.filter(s => s !== '' && s !== '.').join('/');
    if (!cleaned) {
        throw new Error(`Invalid file path: "${filePath}" — resolves to empty path`);
    }
    return cleaned;
}
