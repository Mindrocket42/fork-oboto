/**
 * WorkspaceServerLog — HTTP request/error logger for the workspace content server.
 *
 * Appends JSON-lines to `{workspaceRoot}/server.log` and maintains an
 * in-memory ring buffer of the last 50 entries for fast retrieval.
 *
 * Design goals:
 *   - Fire-and-forget file writes (never blocks request handling)
 *   - Log rotation: if file exceeds 1 MB, truncate to last 500 lines
 *   - Singleton accessor via {@link getServerLog} so other modules
 *     (e.g. SurfacePipeline) can read recent logs without DI threading
 *
 * @module src/server/workspace-server-log
 */

import fs from 'fs';
import path from 'path';

// ════════════════════════════════════════════════════════════════════════
// Module-level singleton
// ════════════════════════════════════════════════════════════════════════

/** @type {WorkspaceServerLog|null} */
let _instance = null;

/**
 * Return the current singleton WorkspaceServerLog, or null if none exists.
 * @returns {WorkspaceServerLog|null}
 */
export function getServerLog() {
  return _instance;
}

// ════════════════════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════════════════════

const RING_BUFFER_SIZE = 50;
const ROTATION_CHECK_INTERVAL = 100; // check every N writes
const MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB
const ROTATION_KEEP_LINES = 500;

// ════════════════════════════════════════════════════════════════════════
// WorkspaceServerLog Class
// ════════════════════════════════════════════════════════════════════════

export class WorkspaceServerLog {
  /**
   * @param {string} workspaceRoot — absolute path to the workspace directory
   */
  constructor(workspaceRoot) {
    // Destroy any existing singleton to prevent orphaned instances
    if (_instance && _instance !== this) {
      _instance.destroy();
    }

    /** @private */
    this._workspaceRoot = workspaceRoot;
    /** @private */
    this._logFilePath = workspaceRoot ? path.join(workspaceRoot, 'server.log') : null;

    /** @private @type {Object[]} — ring buffer of recent log entries */
    this._buffer = [];
    /** @private */
    this._writeCount = 0;
    /** @private — prevents concurrent rotation */
    this._rotating = false;
    /** @private @type {string[]} — queued lines deferred during rotation */
    this._pendingWrites = [];

    /** @private @type {fs.WriteStream|null} — append-mode write stream for serialized writes */
    this._writeStream = null;
    if (this._logFilePath) {
      this._writeStream = fs.createWriteStream(this._logFilePath, { flags: 'a', encoding: 'utf8' });
      this._writeStream.on('error', () => {
        // Silently ignore write errors — logging must never crash the server
      });
    }

    // Set module-level singleton
    _instance = this;
  }

  // ════════════════════════════════════════════════════════════════════
  // Public API
  // ════════════════════════════════════════════════════════════════════

  /**
   * Log a completed HTTP request.
   *
   * @param {string} method   — HTTP method (GET, POST, etc.)
   * @param {string} url      — request URL path
   * @param {number} statusCode — response status code
   * @param {number} durationMs — request duration in milliseconds
   */
  logRequest(method, url, statusCode, durationMs) {
    const safeUrl = url.split('?')[0] + (url.includes('?') ? '?[redacted]' : '');
    const entry = {
      ts: new Date().toISOString(),
      method,
      url: safeUrl,
      status: statusCode,
      ms: durationMs,
    };
    this._pushEntry(entry);
    this._writeToFile(entry);
  }

  /**
   * Log a request that resulted in an error (implicitly status 500).
   *
   * @param {string} method — HTTP method
   * @param {string} url    — request URL path
   * @param {Error|string} error — the error that occurred
   * @param {number} [durationMs=0] — request duration in milliseconds
   */
  logError(method, url, error, durationMs = 0) {
    const safeUrl = url.split('?')[0] + (url.includes('?') ? '?[redacted]' : '');
    const errorMsg = error instanceof Error ? error.message : String(error);
    const entry = {
      ts: new Date().toISOString(),
      method,
      url: safeUrl,
      status: 500,
      ms: durationMs,
      error: errorMsg,
    };
    this._pushEntry(entry);
    this._writeToFile(entry);
  }

  /**
   * Return the last N log entries as human-readable formatted strings.
   *
   * Format: `[HH:MM:SS] GET /path → 200 (12ms)`
   *
   * @param {number} [count=10]
   * @returns {string[]}
   */
  getRecentLogs(count = 10) {
    const entries = this._buffer.slice(-count);
    return entries.map((e) => this._formatEntry(e));
  }

  /**
   * Return the last N error-only entries as formatted strings.
   *
   * @param {number} [count=5]
   * @returns {string[]}
   */
  getRecentErrorLogs(count = 5) {
    const errors = this._buffer.filter((e) => e.error);
    return errors.slice(-count).map((e) => this._formatEntry(e));
  }

  /**
   * Update the workspace root (e.g. on workspace switch).
   * Clears the ring buffer and resets the log file path.
   *
   * @param {string} newRoot — new workspace root path
   */
  setWorkspaceRoot(newRoot) {
    // Close existing stream before switching paths
    if (this._writeStream) {
      try { this._writeStream.end(); } catch { /* ignore */ }
      this._writeStream = null;
    }
    this._workspaceRoot = newRoot;
    this._logFilePath = newRoot ? path.join(newRoot, 'server.log') : null;
    this._buffer = [];
    this._writeCount = 0;
    // Open new stream for the new workspace
    if (this._logFilePath) {
      this._writeStream = fs.createWriteStream(this._logFilePath, { flags: 'a', encoding: 'utf8' });
      this._writeStream.on('error', () => {});
    }
  }

  /**
   * Cleanup and clear the module-level singleton.
   */
  destroy() {
    if (this._writeStream) {
      try { this._writeStream.end(); } catch { /* ignore */ }
      this._writeStream = null;
    }
    this._buffer = [];
    this._writeCount = 0;
    this._pendingWrites = [];
    if (_instance === this) {
      _instance = null;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ════════════════════════════════════════════════════════════════════

  /**
   * Push an entry into the ring buffer, evicting the oldest if full.
   * @private
   * @param {Object} entry
   */
  _pushEntry(entry) {
    this._buffer.push(entry);
    if (this._buffer.length > RING_BUFFER_SIZE) {
      this._buffer.shift();
    }
  }

  /**
   * Fire-and-forget write of a JSON-line to the log file.
   * Triggers rotation check every ROTATION_CHECK_INTERVAL writes.
   * @private
   * @param {Object} entry
   */
  _writeToFile(entry) {
    if (!this._logFilePath) return;

    try {
      const line = JSON.stringify(entry) + '\n';

      if (this._rotating) {
        // Queue writes while rotation is in progress to avoid data loss
        this._pendingWrites.push(line);
        return;
      }

      // Use the write stream for serialized, non-interleaving writes
      if (this._writeStream) {
        this._writeStream.write(line);
      }

      this._writeCount++;
      if (this._writeCount % ROTATION_CHECK_INTERVAL === 0) {
        this._maybeRotate();
      }
    } catch {
      // Silently ignore — logging must never crash the server
    }
  }

  /**
   * Check file size and rotate (truncate to last N lines) if needed.
   * Runs asynchronously, fire-and-forget. Queued writes are flushed after rotation.
   * @private
   */
  async _maybeRotate() {
    if (!this._logFilePath || this._rotating) return;
    this._rotating = true;

    try {
      const stat = await fs.promises.stat(this._logFilePath);
      if (stat.size > MAX_FILE_SIZE_BYTES) {
        // Close the write stream before truncating to avoid
        // interleaved writes during rotation
        if (this._writeStream) {
          this._writeStream.end();
          this._writeStream = null;
        }

        const content = await fs.promises.readFile(this._logFilePath, 'utf8');
        const lines = content.split('\n').filter((l) => l.trim());
        const truncated = lines.slice(-ROTATION_KEEP_LINES).join('\n') + '\n';
        await fs.promises.writeFile(this._logFilePath, truncated, 'utf8');

        // Re-open the stream in append mode
        this._writeStream = fs.createWriteStream(this._logFilePath, { flags: 'a', encoding: 'utf8' });
        this._writeStream.on('error', () => {});
      }
    } catch {
      // Silently ignore rotation failures — re-open stream if needed
      if (!this._writeStream && this._logFilePath) {
        try {
          this._writeStream = fs.createWriteStream(this._logFilePath, { flags: 'a', encoding: 'utf8' });
          this._writeStream.on('error', () => {});
        } catch { /* ignore */ }
      }
    } finally {
      this._rotating = false;
      // Flush any writes that were queued during rotation
      this._flushPendingWrites();
    }
  }

  /**
   * Flush queued writes that accumulated while rotation was in progress.
   * @private
   */
  _flushPendingWrites() {
    if (!this._logFilePath || this._pendingWrites.length === 0) return;

    const batch = this._pendingWrites.join('');
    this._pendingWrites = [];

    if (this._writeStream) {
      this._writeStream.write(batch);
    }
  }

  /**
   * Format a log entry as a human-readable string.
   *
   * @private
   * @param {Object} entry
   * @returns {string}
   */
  _formatEntry(entry) {
    const time = entry.ts ? entry.ts.substring(11, 19) : '??:??:??';
    const arrow = entry.error ? '⚠' : '→';
    const suffix = entry.error ? ` ERROR: ${entry.error}` : '';
    return `[${time}] ${entry.method} ${entry.url} ${arrow} ${entry.status} (${entry.ms}ms)${suffix}`;
  }
}
