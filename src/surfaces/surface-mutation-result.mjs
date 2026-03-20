/**
 * SurfaceMutationResult — Structured result from the surface pipeline.
 *
 * Every surface mutation (update_surface_component) returns an instance
 * of this class rather than a bare string.  It captures:
 *   - Which gates passed / failed
 *   - Before and after screenshots
 *   - Client-side errors
 *   - Auto-revert status
 *   - Targeted fix guidance
 *
 * The {@link format} method produces agent-readable text.
 *
 * @module src/surfaces/surface-mutation-result
 */

// ════════════════════════════════════════════════════════════════════════
// SurfaceMutationResult Class
// ════════════════════════════════════════════════════════════════════════

export class SurfaceMutationResult {
  /**
   * @param {Object} mutation — the original mutation request
   * @param {string} mutation.surface_id
   * @param {string} mutation.component_name
   * @param {string} [mutation.surface_name]
   */
  constructor(mutation) {
    /** @type {string} */
    this.surfaceId = mutation.surface_id;
    /** @type {string} */
    this.componentName = mutation.component_name;
    /** @type {string} */
    this.surfaceName = mutation.surface_name || mutation.surface_id;

    /** @type {boolean} */
    this.success = false;
    /** @type {string} 'pending' | 'passed' | 'failed:validation' | 'failed:render' | etc. */
    this.status = 'pending';

    /** @type {string[]} */
    this.errors = [];
    /** @type {string[]} */
    this.warnings = [];

    /** @type {string[]} */
    this.gatesPassed = [];
    /** @type {string|null} */
    this.failedGate = null;

    /** @type {string|null} base64 before screenshot */
    this.beforeScreenshot = null;
    /** @type {string|null} base64 after screenshot */
    this.afterScreenshot = null;

    /** @type {boolean} */
    this.autoReverted = false;
    /** @type {number|null} revision used for rollback */
    this.snapshotRevision = null;

    /** @type {string|null} */
    this.fixGuidance = null;
  }

  // ════════════════════════════════════════════════════════════════════
  // Gate tracking
  // ════════════════════════════════════════════════════════════════════

  /**
   * Mark a gate as passed.
   * @param {string} gateName
   */
  passGate(gateName) {
    this.gatesPassed.push(gateName);
  }

  /**
   * Mark a gate as failed with errors.
   * @param {string} gateName
   * @param {string[]} errors
   * @param {string[]} [warnings]
   */
  fail(gateName, errors, warnings) {
    this.success = false;
    this.status = `failed:${gateName}`;
    this.failedGate = gateName;
    this.errors.push(...(errors || []));
    if (warnings) this.warnings.push(...warnings);
  }

  /**
   * Mark the entire mutation as succeeded.
   */
  succeed() {
    this.success = true;
    this.status = 'passed';
  }

  // ════════════════════════════════════════════════════════════════════
  // State setters
  // ════════════════════════════════════════════════════════════════════

  /** @param {string|null} base64 */
  setBeforeScreenshot(base64) {
    this.beforeScreenshot = base64;
  }

  /** @param {string|null} base64 */
  setAfterScreenshot(base64) {
    this.afterScreenshot = base64;
  }

  /** @param {number} revisionId */
  setSnapshotRevision(revisionId) {
    this.snapshotRevision = revisionId;
  }

  /** @param {boolean} reverted */
  setAutoReverted(reverted) {
    this.autoReverted = reverted;
  }

  /** @param {string} guidance */
  setFixGuidance(guidance) {
    this.fixGuidance = guidance;
  }

  /** @param {string} warning */
  addWarning(warning) {
    this.warnings.push(warning);
  }

  // ════════════════════════════════════════════════════════════════════
  // Formatting
  // ════════════════════════════════════════════════════════════════════

  /**
   * Format the result as agent-readable text.
   *
   * Success produces a concise confirmation.
   * Failure produces detailed error context with fix guidance.
   *
   * @returns {string}
   */
  format() {
    if (this.success) {
      return this._formatSuccess();
    }
    return this._formatFailure();
  }

  /**
   * @private
   * @returns {string}
   */
  _formatSuccess() {
    const lines = [
      `✅ SURFACE UPDATE VERIFIED`,
      `Component: ${this.componentName}`,
      `Surface: ${this.surfaceName} (ID: ${this.surfaceId})`,
      `Gates passed: ${this.gatesPassed.join(' → ')}`,
      `Status: Component rendered successfully with no client-side errors.`,
    ];

    if (this.warnings.length > 0) {
      lines.push('');
      lines.push('Warnings:');
      for (const w of this.warnings) {
        lines.push(`  ⚠️ ${w}`);
      }
    }

    if (this.afterScreenshot) {
      lines.push('');
      lines.push('[AFTER SCREENSHOT: displayed to user as image]');
    }

    return lines.join('\n');
  }

  /**
   * @private
   * @returns {string}
   */
  _formatFailure() {
    const revertMsg = this.autoReverted
      ? ` — AUTO-REVERTED to revision ${this.snapshotRevision}`
      : '';

    const lines = [
      `❌ SURFACE UPDATE FAILED${revertMsg}`,
      `Component: ${this.componentName}`,
      `Surface: ${this.surfaceName} (ID: ${this.surfaceId})`,
      `Failed gate: ${this.failedGate}`,
      `Gates passed: ${this.gatesPassed.length > 0 ? this.gatesPassed.join(' → ') : '(none)'}`,
    ];

    if (this.errors.length > 0) {
      lines.push('');
      lines.push('Errors:');
      for (const e of this.errors) {
        lines.push(`  ❌ ${e}`);
      }
    }

    if (this.warnings.length > 0) {
      lines.push('');
      lines.push('Warnings:');
      for (const w of this.warnings) {
        lines.push(`  ⚠️ ${w}`);
      }
    }

    if (this.afterScreenshot) {
      lines.push('');
      lines.push('[ERROR SCREENSHOT: displayed to user as image]');
    }

    if (this.fixGuidance) {
      lines.push('');
      lines.push('Fix Guidance:');
      lines.push(this.fixGuidance);
    }

    if (this.autoReverted) {
      lines.push('');
      lines.push(
        'The surface has been auto-reverted to the last working state. ' +
        'Fix the error and call update_surface_component again.',
      );
    }

    return lines.join('\n');
  }
}
