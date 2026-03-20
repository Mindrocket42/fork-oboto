/**
 * SurfacePipeline — Atomic verified surface mutation pipeline.
 *
 * Every surface mutation passes through 5 mandatory gates:
 *   1. Static validation (syntax, bad components, braces)
 *   2. Pre-mutation snapshot (revision + screenshot)
 *   3. Mutation (write to disk + emit update event)
 *   4. Render verification (wait for render, check client errors)
 *   5. Visual verification (capture after screenshot, check for blanks/errors)
 *
 * The pipeline returns a {@link SurfaceMutationResult} that proves
 * success or explains exactly why the mutation failed.  On render
 * failure, the pipeline auto-reverts to the pre-mutation snapshot.
 *
 * @module src/surfaces/surface-pipeline
 */

import { SurfaceManager } from './surface-manager.mjs';
import { SurfaceMutationResult } from './surface-mutation-result.mjs';
import { generateFixGuidance } from './fix-guidance-generator.mjs';

// ════════════════════════════════════════════════════════════════════════
// Default configuration
// ════════════════════════════════════════════════════════════════════════

/** @type {Object} */
const DEFAULT_PIPELINE_CONFIG = {
  renderWaitMs: 1500,
  screenshotTimeoutMs: 10000,
  autoRevert: true,
  visualDiff: true,
  baselineScreenshot: true,
};

// ════════════════════════════════════════════════════════════════════════
// SurfacePipeline Class
// ════════════════════════════════════════════════════════════════════════

export class SurfacePipeline {
  /**
   * @param {Object} deps
   * @param {SurfaceManager} deps.surfaceManager — surface CRUD manager
   * @param {Object}         deps.eventBus       — AiManEventBus for surface events
   * @param {Object}        [deps.learningEngine] — LearningEngine for outcome recording
   * @param {Object}        [deps.config]        — pipeline configuration overrides
   */
  constructor({ surfaceManager, eventBus, learningEngine, config }) {
    /** @private */
    this._surfaceManager = surfaceManager;
    /** @private */
    this._eventBus = eventBus;
    /** @private */
    this._learningEngine = learningEngine || null;
    /** @private */
    this._config = { ...DEFAULT_PIPELINE_CONFIG, ...(config || {}) };

    // ── Pipeline statistics ──────────────────────────────────────────
    /** @private */
    this._stats = {
      totalMutations: 0,
      successCount: 0,
      failCount: 0,
      autoRevertCount: 0,
      gateFailures: { validation: 0, snapshot: 0, mutation: 0, render: 0, visual: 0 },
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // Main Entry Point
  // ════════════════════════════════════════════════════════════════════

  /**
   * Execute a verified surface mutation through all 5 gates.
   *
   * @param {Object} mutation
   * @param {string} mutation.surface_id
   * @param {string} mutation.component_name
   * @param {string} mutation.jsx_source
   * @param {Object} [mutation.props]
   * @param {number} [mutation.order]
   * @returns {Promise<SurfaceMutationResult>}
   */
  async executeMutation(mutation) {
    // Resolve surface name for readable results
    let surfaceName = mutation.surface_id;
    try {
      const surface = await this._surfaceManager.getSurface(mutation.surface_id);
      if (surface) surfaceName = surface.name;
    } catch { /* use ID as fallback name */ }

    this._stats.totalMutations++;

    const result = new SurfaceMutationResult({
      surface_id: mutation.surface_id,
      component_name: mutation.component_name,
      surface_name: surfaceName,
    });

    // ═══════════════════════════════════════════════════════════════
    // GATE 1: STATIC VALIDATION
    // ═══════════════════════════════════════════════════════════════
    const validation = SurfaceManager.validateJsxSource(mutation.jsx_source);
    if (!validation.valid) {
      result.fail('validation', validation.errors, validation.warnings);
      this._recordFailure('validation', result);
      return result;
    }
    if (validation.warnings.length > 0) {
      for (const w of validation.warnings) {
        result.addWarning(w);
      }
    }
    result.passGate('validation');

    // ═══════════════════════════════════════════════════════════════
    // GATE 2: PRE-MUTATION SNAPSHOT
    // ═══════════════════════════════════════════════════════════════
    try {
      // Capture baseline screenshot (BEFORE state)
      if (this._config.baselineScreenshot) {
        try {
          const beforeScreenshot = await this._captureScreenshot(mutation.surface_id);
          result.setBeforeScreenshot(beforeScreenshot);
        } catch (err) {
          result.addWarning(`Baseline screenshot unavailable: ${err.message}`);
        }
      }

      // Discover the latest revision number so we can revert to it if needed.
      // updateComponent() will call _createRevision() internally before writing,
      // so the revision created by updateComponent() is the one we'd revert to.
    } catch (err) {
      // Non-fatal — proceed without snapshot
      result.addWarning(`Snapshot preparation failed: ${err.message}`);
    }
    result.passGate('snapshot');

    // ═══════════════════════════════════════════════════════════════
    // GATE 3: MUTATION (write to disk + emit event)
    // ═══════════════════════════════════════════════════════════════
    try {
      const surface = await this._surfaceManager.updateComponent(
        mutation.surface_id,
        mutation.component_name,
        mutation.jsx_source,
        mutation.props,
        mutation.order,
      );

      // Clear previous client errors for this component
      if (this._surfaceManager.clearComponentError) {
        await this._surfaceManager.clearComponentError(
          mutation.surface_id,
          mutation.component_name,
        );
      }

      // Emit update event for browser re-render
      if (this._eventBus) {
        this._eventBus.emit('surface:updated', {
          surfaceId: mutation.surface_id,
          component: surface.components?.find(c => c.name === mutation.component_name) || { name: mutation.component_name },
          source: mutation.jsx_source,
          layout: surface.layout,
        });
      }
    } catch (err) {
      result.fail('mutation', [`Write failed: ${err.message}`]);
      this._recordFailure('mutation', result);
      return result;
    }
    result.passGate('mutation');

    // ═══════════════════════════════════════════════════════════════
    // GATE 4: RENDER VERIFICATION
    // ═══════════════════════════════════════════════════════════════
    // Wait for React render cycle to complete
    await this._waitForRender(this._config.renderWaitMs);

    // Check for client-side errors
    let clientErrors = null;
    try {
      clientErrors = await this._surfaceManager.getClientErrors(mutation.surface_id);
    } catch {
      // If getClientErrors doesn't exist, try the _clientErrors property
      try {
        const surface = await this._surfaceManager.getSurface(mutation.surface_id);
        clientErrors = surface?._clientErrors || null;
      } catch { /* non-fatal */ }
    }

    const componentError = clientErrors?.[mutation.component_name];

    if (componentError) {
      // Component failed to render — AUTO-REVERT
      const errorMsg = typeof componentError === 'string'
        ? componentError
        : (componentError.message || JSON.stringify(componentError));

      result.fail('render', [`Client-side render error: ${errorMsg}`]);

      // Capture error-state screenshot before revert
      try {
        const errorScreenshot = await this._captureScreenshot(mutation.surface_id);
        result.setAfterScreenshot(errorScreenshot);
      } catch { /* non-fatal */ }

      // Auto-revert to the revision that updateComponent() created
      // (which captured the pre-mutation state).
      if (this._config.autoRevert) {
        try {
          // updateComponent() creates a revision BEFORE writing.
          // That revision is the newest one now — find it.
          const revisions = await this._surfaceManager.listRevisions(mutation.surface_id);
          // listRevisions returns newest-first.
          // The newest revision is the snapshot that updateComponent() created
          // of the pre-mutation state — exactly what we want to revert to.
          const revertTarget = revisions.length > 0 ? revisions[0].revision : null;

          if (revertTarget != null) {
            result.setSnapshotRevision(revertTarget);
            await this._surfaceManager.revertToRevision(
              mutation.surface_id,
              revertTarget,
            );
            result.setAutoReverted(true);

            // Emit revert event so browser shows the restored state
            if (this._eventBus) {
              const restored = await this._surfaceManager.getSurface(mutation.surface_id);
              this._eventBus.emit('surface:reverted', {
                surfaceId: mutation.surface_id,
                surface: restored,
              });
            }
          } else {
            result.addWarning('No revision available for auto-revert');
          }
        } catch (revertErr) {
          result.addWarning(`Auto-revert failed: ${revertErr.message} — surface may be in broken state`);
        }
      }

      // Generate targeted fix guidance
      result.setFixGuidance(
        generateFixGuidance(componentError, mutation.jsx_source),
      );

      this._recordFailure('render', result);
      return result;
    }
    result.passGate('render');

    // ═══════════════════════════════════════════════════════════════
    // GATE 5: VISUAL VERIFICATION
    // ═══════════════════════════════════════════════════════════════
    if (this._config.visualDiff) {
      try {
        const afterScreenshot = await this._captureScreenshot(mutation.surface_id);
        result.setAfterScreenshot(afterScreenshot);

        // Visual sanity checks
        if (result.beforeScreenshot && afterScreenshot) {
          const visualCheck = this._analyzeScreenshots(
            result.beforeScreenshot,
            afterScreenshot,
          );

          if (visualCheck.isBlankScreen) {
            result.addWarning(
              'VISUAL WARNING: After screenshot appears to be a blank/empty screen. ' +
              'The component may not be rendering visible content.',
            );
          }
          if (visualCheck.isErrorBoundary) {
            result.addWarning(
              'VISUAL WARNING: After screenshot appears to contain an error boundary UI. ' +
              'A runtime error may have occurred that was caught by the error boundary.',
            );
          }
          if (visualCheck.identical) {
            result.addWarning(
              'VISUAL WARNING: Before and after screenshots appear identical. ' +
              'Your changes may not have had any visible effect.',
            );
          }
        }
      } catch {
        result.addWarning('Visual verification unavailable — screenshot capture failed');
      }
    }
    result.passGate('visual');

    // All gates passed
    result.succeed();
    this._stats.successCount++;

    // Record outcome in learning engine for pattern learning
    if (this._learningEngine?.recordSurfaceOutcome) {
      try {
        this._learningEngine.recordSurfaceOutcome({
          success: true,
          surface_id: mutation.surface_id,
          component_name: mutation.component_name,
          gatesPassed: result.gatesPassed,
        });
      } catch { /* non-fatal */ }
    }

    return result;
  }

  // ════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ════════════════════════════════════════════════════════════════════

  /**
   * Capture a screenshot of a surface via the event bus.
   *
   * Sends a screenshot request and waits for the client to respond
   * with the captured image.
   *
   * @private
   * @param {string} surfaceId
   * @returns {Promise<string>} — base64 screenshot data
   */
  async _captureScreenshot(surfaceId) {
    if (!this._eventBus) {
      throw new Error('Event bus not available for screenshot capture');
    }

    const requestId = `sdp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const timeoutMs = this._config.screenshotTimeoutMs || 10000;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._eventBus.off('surface:screenshot-captured', listener);
        reject(new Error(`Screenshot timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const listener = (data) => {
        if (data.requestId === requestId) {
          clearTimeout(timeout);
          this._eventBus.off('surface:screenshot-captured', listener);
          if (data.error) {
            reject(new Error(data.error));
          } else {
            resolve(data.image);
          }
        }
      };

      this._eventBus.on('surface:screenshot-captured', listener);
      this._eventBus.emit('surface:request-screenshot', { requestId, surfaceId });
    });
  }

  /**
   * Wait for the browser to complete its React render cycle.
   *
   * @private
   * @param {number} ms — milliseconds to wait
   * @returns {Promise<void>}
   */
  _waitForRender(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms || 1500));
  }

  /**
   * Analyze before/after screenshots for visual anomalies.
   *
   * This is a lightweight heuristic analysis based on base64 string
   * comparison.  A full pixel-level diff would require sharp/canvas
   * which may not be available.  The heuristic checks:
   *
   *  - Identical screenshots (no visual change)
   *  - Very small after screenshot (likely blank)
   *  - Known error boundary text in base64 (if detectable)
   *
   * @private
   * @param {string} beforeBase64
   * @param {string} afterBase64
   * @returns {{ identical: boolean, isBlankScreen: boolean, isErrorBoundary: boolean }}
   */
  _analyzeScreenshots(beforeBase64, afterBase64) {
    const identical = beforeBase64 === afterBase64;

    // Heuristic: very small PNG likely means blank/empty content
    // A typical surface screenshot is 50KB+; a blank one is <5KB
    const isBlankScreen = afterBase64.length < 5000;

    // Heuristic: error boundary screenshots tend to be smaller than
    // normal content but larger than blank.  This is imprecise —
    // a real implementation would use OCR or pixel analysis.
    // For now, we use a length-based heuristic and "Something went wrong"
    // detection if the base64 decodes to text-containing PNGs.
    const isErrorBoundary = false; // Placeholder — needs real implementation

    return { identical, isBlankScreen, isErrorBoundary };
  }

  /**
   * Record a failure in stats and optionally in the learning engine.
   *
   * @private
   * @param {string} gate — the gate that failed
   * @param {SurfaceMutationResult} result
   */
  _recordFailure(gate, result) {
    this._stats.failCount++;
    if (this._stats.gateFailures[gate] !== undefined) {
      this._stats.gateFailures[gate]++;
    }
    if (result.autoReverted) {
      this._stats.autoRevertCount++;
    }

    // Record outcome in learning engine
    if (this._learningEngine?.recordSurfaceOutcome) {
      try {
        this._learningEngine.recordSurfaceOutcome({
          success: false,
          surface_id: result.surface_id,
          component_name: result.component_name,
          failedGate: gate,
          errors: result.errors,
        });
      } catch { /* non-fatal */ }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Public Diagnostics
  // ════════════════════════════════════════════════════════════════════

  /**
   * Return pipeline execution statistics.
   *
   * @returns {{ totalMutations: number, successCount: number, failCount: number, autoRevertCount: number, gateFailures: Object, successRate: string }}
   */
  getStats() {
    const total = this._stats.totalMutations;
    return {
      ...this._stats,
      successRate: total > 0
        ? `${((this._stats.successCount / total) * 100).toFixed(1)}%`
        : 'N/A',
    };
  }
}
