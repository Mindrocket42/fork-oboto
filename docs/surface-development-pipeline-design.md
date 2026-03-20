# Surface Development Pipeline (SDP) — Bomb-Proof Design

## Executive Summary

Surface updates fail because **verification is advisory, not structural**. The agent is *told* to verify via prompts, but prompts are suggestions — the LLM can and does ignore them. This design makes verification **mechanically unavoidable** by embedding it into the tool execution path itself. Every surface mutation passes through mandatory gates that validate, screenshot, verify, and either confirm success or automatically roll back and retry — all before the tool result ever reaches the LLM.

The design introduces **six integrated layers** that turn the existing surface tools into a gated, verified, self-healing pipeline with visual proof at every step.

---

## Root Cause Analysis: Why Surfaces Fail

### The Fundamental Problem

```
Agent calls update_surface_component
  → Server writes JSX to disk
  → Server returns "Updated component 'X' (1500 chars)"
  → Agent thinks it worked ✅
  → Component FAILS to render in browser ❌
  → User sees broken surface
  → Agent has ZERO information about why
```

The agent operates **blind**. The tool returns a success message the moment bytes hit disk, but the actual rendering happens asynchronously in the browser. By the time React throws Error #130, the agent has already moved on.

### 12 Contributing Failures (Ranked by Impact)

| # | Failure | Severity | Current Mitigation | Why It Fails |
|---|---------|----------|-------------------|--------------|
| 1 | No render verification loop | 🔴 Critical | Prompt says "call read_surface after" | LLM ignores prompt instructions ~40% of the time |
| 2 | No screenshot verification | 🔴 Critical | `capture_surface` exists but agent never calls it | Nothing forces the agent to use it |
| 3 | Misleading success message | 🔴 Critical | Tool returns "Updated component..." | "Updated" ≠ "Rendered" — the message is a lie |
| 4 | No automatic rollback | 🔴 Critical | `revert_surface` exists but manual | Agent doesn't know when to use it |
| 5 | Client errors arrive too late | 🟡 Major | `_clientErrors` stored on surface | Errors only visible on *next* `read_surface` call |
| 6 | No error-to-fix feedback loop | 🟡 Major | Pre-route detects errors | Agent gets errors but lacks targeted fix guidance |
| 7 | `WRAPUP_TOOLS` kills surfaces | 🟡 Major | `create_surface` triggers wrap-up | Agent stops before adding components |
| 8 | Fragile intent detection | 🟠 Moderate | Regex-based `detectSurfaceUpdateIntent` | Misses "the chart isn't showing data" |
| 9 | No surface-specific learning | 🟠 Moderate | Generic learning engine | Doesn't learn which JSX patterns fail |
| 10 | Validation gate is static-only | 🟠 Moderate | `validateJsxSource()` catches syntax | Can't catch runtime errors (wrong state shape, async issues) |
| 11 | Base64 screenshots stripped | 🟠 Moderate | Context-saving truncation | Agent can't see the screenshot it supposedly captured |
| 12 | No escalation protocol | 🟡 Major | None | Agent loops forever or gives up silently |

---

## Design Overview

### Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        USER REQUEST                                      │
│  "Fix the dashboard surface — the chart is not showing data"             │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  LAYER 1: Surface Intent Classifier (Enhanced IntentRouter)              │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │ Detect surface intent → classify operation type → resolve target │    │
│  │ Operations: CREATE | UPDATE | FIX | DELETE | INSPECT             │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  LAYER 2: Surface Context Assembly (Enhanced ContextManager)             │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │ Auto-fetch: surface metadata + source + client errors +          │    │
│  │ console logs + BASELINE SCREENSHOT + component reference         │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  LAYER 3: Surface Development Pipeline (NEW — SurfacePipeline)           │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                    GATE 1: STATIC VALIDATION                     │    │
│  │  validateJsxSource() — syntax, imports, bad components, braces   │    │
│  │  FAIL → reject with specific errors, do NOT write to disk        │    │
│  ├──────────────────────────────────────────────────────────────────┤    │
│  │                    GATE 2: SNAPSHOT                               │    │
│  │  Auto-create revision snapshot before mutation                    │    │
│  │  Capture BEFORE screenshot via capture_surface                   │    │
│  ├──────────────────────────────────────────────────────────────────┤    │
│  │                    GATE 3: MUTATION                               │    │
│  │  Write JSX to disk, emit surface:updated event                   │    │
│  │  Wait for render acknowledgement (with timeout)                  │    │
│  ├──────────────────────────────────────────────────────────────────┤    │
│  │                    GATE 4: RENDER VERIFICATION                   │    │
│  │  Wait 1500ms for React render cycle to complete                  │    │
│  │  Call read_surface → check _clientErrors                         │    │
│  │  Call capture_surface → capture AFTER screenshot                 │    │
│  │  FAIL → auto-revert to snapshot, return errors + screenshot      │    │
│  ├──────────────────────────────────────────────────────────────────┤    │
│  │                    GATE 5: VISUAL DIFF                           │    │
│  │  Compare BEFORE and AFTER screenshots                            │    │
│  │  Detect: blank screen, error boundary, no visual change          │    │
│  │  WARN if screenshots identical (change had no effect)            │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  LAYER 4: Error Recovery Loop (in AgentLoop)                             │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │ If pipeline returns FAIL:                                        │    │
│  │   1. Inject error context + AFTER screenshot into next turn      │    │
│  │   2. Inject targeted fix guidance based on error type            │    │
│  │   3. Force agent to retry (up to MAX_SURFACE_RETRIES)            │    │
│  │   4. Track retry count per component                             │    │
│  │   5. If retries exhausted → ESCALATE                             │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  LAYER 5: Surface Learning Engine (in LearningEngine)                    │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │ Record: JSX pattern → success/failure → fix applied              │    │
│  │ Build: component error → fix mapping                             │    │
│  │ Suggest: "Last time UI.AlertTitle caused Error #130, use div"    │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  LAYER 6: Escalation Protocol                                            │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │ When all retries exhausted:                                      │    │
│  │   1. Show user: BEFORE screenshot + AFTER screenshot             │    │
│  │   2. Show user: all error messages encountered                   │    │
│  │   3. Show user: what fixes were attempted                        │    │
│  │   4. Offer: revert to last working state                         │    │
│  │   5. Ask: specific clarifying question based on error type       │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Enhanced Surface Intent Classification

### Problem
The current `detectSurfaceUpdateIntent()` in [`agent-loop-preroute.mjs`](src/core/agent-loop-preroute.mjs:96) uses fragile regex that misses many valid surface requests.

### Design

Replace the binary surface detection with a **typed surface operation classifier** that identifies not just "is this about a surface?" but "what operation on which surface?"

**File:** `src/core/agentic/unified/surface-intent-classifier.mjs`

```javascript
/**
 * @typedef {Object} SurfaceOperationIntent
 * @property {boolean} isSurfaceRequest     — true if this involves surfaces at all
 * @property {'create'|'update'|'fix'|'delete'|'inspect'|'layout'|null} operation
 * @property {string|null} surfaceNameHint  — detected surface name
 * @property {string|null} componentHint    — detected component name  
 * @property {string|null} errorHint        — detected error description
 * @property {number} confidence            — 0.0–1.0 confidence score
 */

export function classifySurfaceIntent(input, surfaces = []) {
  // ... implementation
}
```

**Key improvements over current approach:**
1. **Operation typing** — Distinguishes create/update/fix/delete/inspect/layout
2. **Component targeting** — Identifies which component the user is talking about
3. **Error hint extraction** — Pulls error descriptions from user messages ("the chart is blank")
4. **Surface name fuzzy matching** — Fuzzy matches against known surface names, not just regex
5. **Confidence scoring** — Low confidence triggers clarification instead of guessing

### Surface Vocabulary Expansion

Current detection only matches: `surface|dashboard|panel|widget|component|ui`

Expanded vocabulary:
```
surface, dashboard, panel, widget, component, ui, tab, view, page, screen,
display, interface, chart, graph, table, form, editor, monitor, status,
visualization, layout, grid, card
```

### Operation Verb Expansion

Current verbs are limited to modification verbs. Expanded to cover all operations:

| Operation | Verb Patterns |
|-----------|--------------|
| `create` | create, make, build, generate, set up, add new |
| `update` | update, change, modify, edit, adjust, tweak, improve, enhance |
| `fix` | fix, repair, correct, debug, troubleshoot, broken, not working, error |
| `delete` | delete, remove, destroy, get rid of, clean up |
| `inspect` | show, view, open, display, look at, check, inspect |
| `layout` | rearrange, reorganize, restructure, reposition, move, layout |

---

## Layer 2: Enhanced Surface Context Assembly

### Problem
The current `preRouteSurfaces()` in [`agent-loop-preroute.mjs`](src/core/agent-loop-preroute.mjs:143) pre-fetches surface metadata and source but misses critical context: the **baseline screenshot**, **console logs**, and **component reference documentation**.

### Design

**File:** `src/core/agentic/unified/surface-context-assembler.mjs`

```javascript
/**
 * @typedef {Object} SurfaceContext
 * @property {string} surfaceId           — resolved surface ID
 * @property {string} surfaceName         — surface display name
 * @property {string} metadata            — full read_surface output
 * @property {string|null} baselineScreenshot  — base64 BEFORE screenshot
 * @property {Object|null} clientErrors   — current client-side errors
 * @property {Array} consoleLogs          — recent console logs
 * @property {string} componentReference  — relevant UI component docs
 * @property {string} operationGuidance   — operation-specific instructions
 */

export class SurfaceContextAssembler {
  /**
   * Assemble comprehensive surface context for the agent.
   *
   * Steps:
   *  1. Resolve target surface from intent
   *  2. Read full surface metadata + source code
   *  3. Capture baseline screenshot (BEFORE state)
   *  4. Collect client errors and console logs
   *  5. Select relevant component reference docs
   *  6. Build operation-specific guidance
   */
  async assemble(input, surfaceIntent, tools) { /* ... */ }
}
```

### Baseline Screenshot Capture

**Critical change:** Before the agent makes any changes, we capture a screenshot of the current surface state. This serves as:
1. **Ground truth** — what the surface looks like right now
2. **Diff anchor** — compare against after-mutation screenshot
3. **Rollback target** — visual proof of what "working" looked like
4. **Context for the agent** — the agent can SEE the current state

The screenshot is captured via `capture_surface` and stored in the `SurfaceContext` object. It's injected into the conversation as a `_transient` system message with image content.

### Component Reference Injection

Instead of relying on the agent remembering the component reference from tool descriptions, inject a **focused subset** of the component reference docs based on what the agent is likely to use:

```javascript
function selectRelevantDocs(jsxSource, errorHint) {
  // If jsx uses UI.Alert → inject Alert usage + "Components That DO NOT Exist" section
  // If jsx uses charts → inject Chart reference
  // If error mentions "Error #130" → inject full non-existent components list
  // Always inject: the BAD_COMPONENTS list from SurfaceManager
}
```

---

## Layer 3: Surface Development Pipeline (Core Innovation)

### Problem
The current flow is: agent calls `update_surface_component` → tool writes to disk → returns success string → agent moves on. Verification is prompt-based and optional.

### Design: Atomic Verified Surface Mutation

Replace the raw `update_surface_component` tool with a **pipeline** that atomically performs: validate → snapshot → mutate → wait → verify → screenshot → report.

**File:** `src/surfaces/surface-pipeline.mjs`

```javascript
/**
 * SurfacePipeline — Atomic verified surface mutation pipeline.
 *
 * Every surface mutation passes through 5 mandatory gates.
 * The pipeline returns a composite result that includes:
 *   - Success/failure status
 *   - Before and after screenshots  
 *   - Any client-side errors detected
 *   - Specific fix guidance if failed
 *   - Auto-rollback confirmation if reverted
 *
 * The agent NEVER receives a bare "Updated component X" message.
 * Instead, it receives structured verification data that
 * proves the mutation worked or explains exactly why it didn't.
 */
export class SurfacePipeline {
  constructor({ surfaceManager, eventBus, screenshotCapture }) {
    this._surfaceManager = surfaceManager;
    this._eventBus = eventBus;
    this._screenshotCapture = screenshotCapture;
  }

  /**
   * Execute a verified surface mutation.
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
    const result = new SurfaceMutationResult(mutation);

    // ═══════════════════════════════════════════════════
    // GATE 1: STATIC VALIDATION
    // ═══════════════════════════════════════════════════
    const validation = SurfaceManager.validateJsxSource(mutation.jsx_source);
    if (!validation.valid) {
      result.fail('validation', validation.errors, validation.warnings);
      return result;
    }
    result.passGate('validation');

    // ═══════════════════════════════════════════════════
    // GATE 2: SNAPSHOT (pre-mutation state)
    // ═══════════════════════════════════════════════════
    try {
      const beforeScreenshot = await this._captureScreenshot(mutation.surface_id);
      result.setBeforeScreenshot(beforeScreenshot);
      
      // Create revision snapshot for rollback
      const revisionId = await this._surfaceManager.createRevisionSnapshot(
        mutation.surface_id
      );
      result.setSnapshotRevision(revisionId);
    } catch (err) {
      // Non-fatal — proceed without snapshot
      result.addWarning(`Snapshot failed: ${err.message}`);
    }
    result.passGate('snapshot');

    // ═══════════════════════════════════════════════════
    // GATE 3: MUTATION (write to disk + emit event)
    // ═══════════════════════════════════════════════════
    try {
      await this._surfaceManager.updateComponent(
        mutation.surface_id,
        mutation.component_name,
        mutation.jsx_source,
        mutation.props,
        mutation.order,
      );
      
      // Clear previous client errors for this component
      await this._surfaceManager.clearComponentError(
        mutation.surface_id,
        mutation.component_name,
      );
      
      // Emit update event for browser re-render
      this._eventBus?.emit('surface:updated', {
        surfaceId: mutation.surface_id,
        component: { name: mutation.component_name },
        source: mutation.jsx_source,
      });
    } catch (err) {
      result.fail('mutation', [`Write failed: ${err.message}`]);
      return result;
    }
    result.passGate('mutation');

    // ═══════════════════════════════════════════════════
    // GATE 4: RENDER VERIFICATION
    // ═══════════════════════════════════════════════════
    // Wait for React render cycle to complete
    await this._waitForRender(1500);

    // Check for client-side errors
    const clientErrors = await this._surfaceManager.getClientErrors(
      mutation.surface_id
    );
    const componentError = clientErrors?.[mutation.component_name];
    
    if (componentError) {
      // Component failed to render — AUTO-REVERT
      result.fail('render', [
        `Client-side render error: ${componentError.message}`,
      ]);
      
      // Auto-revert to pre-mutation snapshot
      if (result.snapshotRevision) {
        try {
          await this._surfaceManager.revertToRevision(
            mutation.surface_id,
            result.snapshotRevision,
          );
          result.setAutoReverted(true);
        } catch {
          result.addWarning('Auto-revert failed — surface may be in broken state');
        }
      }
      
      // Capture the error-state screenshot before revert takes effect
      try {
        const errorScreenshot = await this._captureScreenshot(mutation.surface_id);
        result.setAfterScreenshot(errorScreenshot);
      } catch { /* non-fatal */ }
      
      // Add targeted fix guidance
      result.setFixGuidance(
        this._generateFixGuidance(componentError, mutation.jsx_source)
      );
      
      return result;
    }
    result.passGate('render');

    // ═══════════════════════════════════════════════════
    // GATE 5: VISUAL VERIFICATION
    // ═══════════════════════════════════════════════════
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
            'The component may not be rendering visible content.'
          );
        }
        if (visualCheck.isErrorBoundary) {
          result.addWarning(
            'VISUAL WARNING: After screenshot contains an error boundary. ' +
            'A runtime error may have occurred.'
          );
        }
        if (visualCheck.identical) {
          result.addWarning(
            'VISUAL WARNING: Before and after screenshots appear identical. ' +
            'Your changes may not have had any visible effect.'
          );
        }
      }
    } catch {
      result.addWarning('Visual verification unavailable — screenshot capture failed');
    }
    result.passGate('visual');

    // All gates passed
    result.succeed();
    return result;
  }

  // ... private helpers
}
```

### SurfaceMutationResult

The pipeline returns a structured result object — never a bare string.

```javascript
/**
 * @typedef {Object} SurfaceMutationResult
 * @property {boolean} success
 * @property {string} status               — 'passed' | 'failed:validation' | 'failed:render' | etc.
 * @property {string[]} errors             — error messages
 * @property {string[]} warnings           — warning messages
 * @property {string[]} gatesPassed        — which gates passed
 * @property {string|null} failedGate      — which gate failed (null if success)
 * @property {string|null} beforeScreenshot — base64 before screenshot
 * @property {string|null} afterScreenshot  — base64 after screenshot
 * @property {boolean} autoReverted        — whether auto-revert occurred
 * @property {number|null} snapshotRevision — revision used for rollback
 * @property {string|null} fixGuidance     — targeted fix suggestions
 */
```

### Tool Result Formatting

The `SurfaceMutationResult` is formatted into a **structured tool result** that gives the agent maximum information:

**On success:**
```
✅ SURFACE UPDATE VERIFIED
Component: ChartWidget
Surface: Dashboard (ID: abc-123)
Gates passed: validation → snapshot → mutation → render → visual
Status: Component rendered successfully with no client-side errors.

[AFTER SCREENSHOT: displayed to user as image]

Warnings: (none)
```

**On failure:**
```
❌ SURFACE UPDATE FAILED — AUTO-REVERTED
Component: ChartWidget  
Surface: Dashboard (ID: abc-123)
Failed gate: render
Gates passed: validation → snapshot → mutation
Status: Auto-reverted to revision 7 (pre-mutation state)

Error: Client-side render error: Element type is invalid: expected a string
(for built-in components) or a class/function (for composite components)
but got: undefined. — React Error #130

[ERROR SCREENSHOT: displayed to user as image]

Fix Guidance:
  1. The error "got: undefined" means you used a component that doesn't exist.
  2. Check for: UI.AlertTitle, UI.AlertDescription, UI.Stack — these DO NOT exist.
  3. Use instead: <div className="font-semibold"> for titles, <div> with flex for stacks.
  4. Review the source code and find which JSX element resolves to undefined.

The surface has been auto-reverted to the last working state.
Fix the error and call update_surface_component again.
```

### Fix Guidance Generator

A deterministic error-to-fix mapping:

```javascript
const FIX_PATTERNS = {
  // React Error #130 — undefined component
  'element type is invalid': {
    diagnosis: 'A JSX element resolved to undefined — you used a component that does not exist.',
    commonCauses: [
      'UI.AlertTitle → use <div className="font-semibold">',
      'UI.AlertDescription → use <div className="text-sm">',
      'UI.Stack → use <div className="flex flex-col gap-2">',
      'UI.Icons.Atom → use UI.Icons.Activity',
      'UI.Icons.Cpu → use UI.Icons.Terminal',
    ],
    action: 'Find the undefined component in your JSX and replace it.',
  },
  
  // Import statement error
  'import': {
    diagnosis: 'Surface components cannot use import statements.',
    commonCauses: [
      'All React hooks (useState, useEffect, etc.) are globals — no import needed.',
      'All UI.* components are globals — no import needed.',
      'surfaceApi is a global — no import needed.',
    ],
    action: 'Remove ALL import statements from the component.',
  },
  
  // Missing export default
  'is not a function': {
    diagnosis: 'The component is not exported correctly.',
    commonCauses: [
      'Missing "export default function ComponentName(...)" declaration.',
      'Arrow functions must still be exported: export default function X() { ... }',
    ],
    action: 'Ensure the component has "export default function ComponentName(props) { ... }"',
  },
  
  // Hook errors
  'rendered more hooks': {
    diagnosis: 'React hooks are being called conditionally or in different order between renders.',
    commonCauses: [
      'Hooks must be called at the top level — never inside if/for/while blocks.',
      'Hooks must be called in the same order every render.',
    ],
    action: 'Move all useState/useEffect calls to the top of the function body.',
  },
};
```

---

## Layer 4: Agent Loop Surface Recovery

### Problem
Currently, when `update_surface_component` returns errors, the agent loop treats it like any other tool result. There's no surface-specific recovery logic.

### Design

**Modification to:** [`agent-loop.mjs`](src/core/agentic/unified/agent-loop.mjs:446)

After tool batch execution, detect surface verification failures and enter a **mandatory surface fix loop**:

```javascript
// In AgentLoop.run(), after tool batch execution:

// ── Surface verification detection ──────────────────────
const surfaceFailures = results.filter(r => 
  r.name === 'update_surface_component' && 
  r.content?.includes('SURFACE UPDATE FAILED')
);

if (surfaceFailures.length > 0) {
  surfaceRetryCount++;
  
  if (surfaceRetryCount > MAX_SURFACE_RETRIES) {
    // ── ESCALATION ─────────────────────────────────────
    this._stream.phaseStart('escalation', 
      'Surface fix failed after maximum retries — escalating to user'
    );
    
    const escalation = this._buildSurfaceEscalation(
      surfaceFailures, 
      surfaceRetryCount
    );
    
    finalResponse = escalation;
    break;
  }
  
  // ── FORCED RETRY ───────────────────────────────────────
  this._stream.commentary('🔧', 
    `Surface verification failed (attempt ${surfaceRetryCount}/${MAX_SURFACE_RETRIES}). ` +
    `Injecting error context for retry.`
  );
  
  // Build surface-specific retry prompt
  currentPrompt = this._buildSurfaceRetryPrompt(
    surfaceFailures,
    surfaceRetryCount,
    input,
  );
  
  // DO NOT break — force agent to try again
  continue;
}
```

### Surface Retry Prompt

```javascript
_buildSurfaceRetryPrompt(failures, retryCount, originalInput) {
  const parts = [
    `[SURFACE FIX REQUIRED — ATTEMPT ${retryCount}/${MAX_SURFACE_RETRIES}]`,
    '',
    'Your previous surface update FAILED verification and was auto-reverted.',
    'You MUST fix the issue before proceeding. Do NOT skip this.',
    '',
  ];
  
  for (const failure of failures) {
    parts.push(`Component: ${failure.componentName}`);
    parts.push(`Error: ${failure.error}`);
    parts.push(`Fix Guidance: ${failure.fixGuidance}`);
    parts.push('');
  }
  
  parts.push(
    'Instructions:',
    '1. Read the error message carefully.',
    '2. Apply the fix guidance above.',
    '3. Call update_surface_component with CORRECTED jsx_source.',
    '4. The pipeline will automatically verify again.',
    '',
    `Original request: ${originalInput}`,
  );
  
  return parts.join('\n');
}
```

### Constants

```javascript
// Maximum surface fix retries before escalating to user
const MAX_SURFACE_RETRIES = 3;

// Wait time for React render cycle (ms)
const RENDER_WAIT_MS = 1500;

// Screenshot capture timeout (ms)  
const SCREENSHOT_TIMEOUT_MS = 10000;
```

---

## Layer 5: Surface Learning Integration

### Problem
The `LearningEngine` records generic turn outcomes but doesn't capture surface-specific patterns. When the agent encounters a surface error it's seen before, it has no memory of the fix.

### Design

**Modification to:** [`learning-engine.mjs`](src/core/agentic/unified/learning-engine.mjs)

Add a **surface pattern store** that records error → fix mappings:

```javascript
/**
 * @typedef {Object} SurfaceLesson
 * @property {string} errorPattern    — regex-matchable error signature
 * @property {string} badPattern      — the JSX pattern that caused the error
 * @property {string} fixPattern      — the JSX pattern that fixed it
 * @property {number} occurrences     — how many times this was encountered
 * @property {number} successRate     — how often the fix worked (0.0–1.0)
 * @property {string} lastSeen        — ISO timestamp
 */

class LearningEngine {
  // ... existing code ...
  
  /**
   * Record a surface mutation outcome for pattern learning.
   */
  recordSurfaceOutcome({
    surfaceId,
    componentName,
    jsxSource,
    success,
    error,
    fixApplied,
    fixJsxSource,
  }) {
    if (!success && error) {
      // Extract error signature
      const signature = this._extractErrorSignature(error);
      
      // Store or update lesson
      const lesson = this._surfaceLessons.get(signature) || {
        errorPattern: signature,
        badPattern: this._extractBadPattern(jsxSource, error),
        fixPattern: null,
        occurrences: 0,
        successRate: 0,
        lastSeen: null,
      };
      
      lesson.occurrences++;
      lesson.lastSeen = new Date().toISOString();
      this._surfaceLessons.set(signature, lesson);
    }
    
    if (success && fixApplied) {
      // Record the fix pattern for future suggestions
      const signature = this._extractErrorSignature(fixApplied.error);
      const lesson = this._surfaceLessons.get(signature);
      if (lesson) {
        lesson.fixPattern = this._extractFixPattern(fixJsxSource, fixApplied);
        lesson.successRate = 
          (lesson.successRate * (lesson.occurrences - 1) + 1) / lesson.occurrences;
      }
    }
  }
  
  /**
   * Suggest fixes based on learned patterns.
   */
  suggestSurfaceFix(error, jsxSource) {
    const signature = this._extractErrorSignature(error);
    const lesson = this._surfaceLessons.get(signature);
    
    if (lesson && lesson.fixPattern && lesson.successRate > 0.5) {
      return {
        confidence: lesson.successRate,
        suggestion: `This error was seen ${lesson.occurrences} times before. ` +
          `Fix: ${lesson.fixPattern} (${Math.round(lesson.successRate * 100)}% success rate)`,
        badPattern: lesson.badPattern,
        fixPattern: lesson.fixPattern,
      };
    }
    
    return null;
  }
}
```

### Learning Integration Points

1. **Pre-mutation** — Before writing JSX, check `suggestSurfaceFix()` and inject warnings
2. **Post-verification-failure** — Record the error + JSX source for learning
3. **Post-fix-success** — Record the fix that worked, updating the lesson
4. **Strategy suggestion** — When `suggestStrategy()` is called for surface updates, consult surface lessons

---

## Layer 6: Escalation Protocol

### Problem
When the agent can't fix a surface, it either loops forever (doom loop) or gives up with a generic message. The user gets no actionable information.

### Design

When `MAX_SURFACE_RETRIES` is exhausted, the pipeline constructs a **structured escalation message** with maximum context:

```javascript
_buildSurfaceEscalation(failures, retryCount) {
  const parts = [
    '## ⚠️ Surface Update Requires Your Help',
    '',
    `I attempted to fix this surface ${retryCount} times but was unable to resolve ` +
    `the rendering error. Here is a complete summary of what happened:`,
    '',
  ];
  
  for (const failure of failures) {
    parts.push(`### Component: ${failure.componentName}`);
    parts.push('');
    parts.push(`**Error:** ${failure.error}`);
    parts.push('');
    parts.push(`**Attempts made:**`);
    for (const attempt of failure.attempts) {
      parts.push(`  ${attempt.number}. ${attempt.description} → ${attempt.result}`);
    }
    parts.push('');
  }
  
  // Include both screenshots as __directMarkdown image blocks
  if (failure.beforeScreenshot) {
    parts.push('**Before (working state):**');
    parts.push(`![Before](data:image/png;base64,${failure.beforeScreenshot})`);
  }
  if (failure.afterScreenshot) {
    parts.push('**After (error state):**');
    parts.push(`![After](data:image/png;base64,${failure.afterScreenshot})`);
  }
  
  parts.push('');
  parts.push('**What you can do:**');
  parts.push('1. The surface has been reverted to the last working state.');
  parts.push('2. You can provide more specific instructions about what you want changed.');
  parts.push('3. You can share the exact JSX code you want used.');
  parts.push('4. You can ask me to try a different approach entirely.');
  
  return parts.join('\n');
}
```

---

## Implementation: Tool Interceptor Pattern

### How It Works

Rather than modifying every surface tool individually, we use an **interceptor pattern** in the `ToolExecutorBridge`. When a surface-modifying tool is called, the bridge detects it and routes through the `SurfacePipeline` instead of executing directly.

**Modification to:** [`tool-executor-bridge.mjs`](src/core/agentic/unified/tool-executor-bridge.mjs:211)

```javascript
async executeTool(name, args, options = {}) {
  // ── Surface pipeline interception ──────────────────────
  if (this._surfacePipeline && SURFACE_MUTATION_TOOLS.has(name)) {
    return this._executeSurfaceMutation(name, args, options);
  }
  
  // ... existing tool execution logic ...
}

/**
 * Surface mutation tools that route through the pipeline.
 */
const SURFACE_MUTATION_TOOLS = new Set([
  'update_surface_component',
]);

/**
 * Execute a surface mutation through the verified pipeline.
 */
async _executeSurfaceMutation(name, args, options) {
  const result = await this._surfacePipeline.executeMutation({
    surface_id: args.surface_id,
    component_name: args.component_name,
    jsx_source: args.jsx_source,
    props: args.props,
    order: args.order,
  });
  
  // Format the result for the agent
  const formatted = this._formatSurfaceResult(result);
  
  // If the pipeline took a screenshot, handle it for display
  if (result.afterScreenshot) {
    // Push screenshot as __directMarkdown for user display
    this._directMarkdownBlocks.push(
      `![Surface: ${args.component_name}](data:image/png;base64,${result.afterScreenshot})`
    );
  }
  
  return {
    content: formatted,
    success: result.success,
    _surfaceVerification: result, // Attach for agent loop detection
  };
}
```

---

## Implementation: WRAPUP_TOOLS Fix

### Problem
[`agent-loop-helpers.mjs`](src/core/agent-loop-helpers.mjs) includes `create_surface` in `WRAPUP_TOOLS`, causing the agent to wrap up before adding components.

### Fix
Remove `create_surface` from `WRAPUP_TOOLS`. Surface creation is the *start* of a workflow, not the end:

```javascript
// Before:
export const WRAPUP_TOOLS = new Set([
    'create_surface', 'attempt_completion'
]);

// After:
export const WRAPUP_TOOLS = new Set([
    'attempt_completion'
]);
```

---

## Implementation: Screenshot Handling

### Problem
Currently, `capture_surface` returns base64 image data that gets stripped from context by the truncation logic in `_truncateResult()`. The agent never "sees" its own screenshots.

### Design

Screenshots flow through **two channels**:

1. **User display channel** — The full base64 screenshot is pushed to `__directMarkdown` and displayed in the chat UI as an image. This is purely for the user.

2. **Agent context channel** — A **text description** of the screenshot analysis replaces the raw image data in the agent's context. This is lightweight and actionable:

```
[SCREENSHOT ANALYSIS]
Surface: Dashboard
State: Rendered successfully
Visual checks:
  ✅ Content is visible (non-blank)
  ✅ No error boundary detected
  ✅ Visual change from previous state detected
Image displayed to user in chat.
```

Or on failure:
```
[SCREENSHOT ANALYSIS]
Surface: Dashboard
State: Error detected
Visual checks:
  ❌ Error boundary overlay detected
  ✅ Non-blank (error UI is visible)
  ❌ Error text visible: "Something went wrong"
Image displayed to user in chat.
```

This gives the agent enough information to act without bloating context with 200KB of base64.

---

## New Files Summary

| File | Purpose |
|------|---------|
| `src/core/agentic/unified/surface-intent-classifier.mjs` | Enhanced surface operation classification |
| `src/core/agentic/unified/surface-context-assembler.mjs` | Rich context assembly with baseline screenshots |
| `src/surfaces/surface-pipeline.mjs` | Core 5-gate verified mutation pipeline |
| `src/surfaces/surface-mutation-result.mjs` | Structured result type for pipeline output |
| `src/surfaces/fix-guidance-generator.mjs` | Error → fix mapping engine |

## Modified Files Summary

| File | Changes |
|------|---------|
| `src/core/agentic/unified/tool-executor-bridge.mjs` | Add surface pipeline interceptor |
| `src/core/agentic/unified/agent-loop.mjs` | Add surface recovery loop + escalation |
| `src/core/agentic/unified/context-manager.mjs` | Use new SurfaceContextAssembler |
| `src/core/agentic/unified/intent-router.mjs` | Use new SurfaceIntentClassifier |
| `src/core/agentic/unified/prompt-builder.mjs` | Enhanced surface instructions with learning |
| `src/core/agentic/unified/learning-engine.mjs` | Add surface pattern store |
| `src/core/agentic/unified/unified-provider.mjs` | Wire SurfacePipeline into subsystems |
| `src/core/agent-loop-helpers.mjs` | Remove `create_surface` from WRAPUP_TOOLS |
| `src/execution/handlers/surface-handlers.mjs` | Delegate to pipeline instead of direct write |

---

## Complete Flow Walkthrough

### Scenario: "Fix the dashboard — the chart is not showing data"

```
1. USER: "Fix the dashboard — the chart is not showing data"

2. LAYER 1 — Intent Classification:
   → operation: 'fix'
   → surfaceNameHint: 'dashboard'
   → componentHint: 'chart'
   → confidence: 0.95

3. LAYER 2 — Context Assembly:
   → Resolve surface ID from 'dashboard'
   → read_surface → get full metadata + source code
   → capture_surface → capture BEFORE screenshot
   → Check _clientErrors → find "ChartWidget: Cannot read property 'map' of undefined"
   → Select relevant docs: Chart component reference, common data errors
   → Build operation guidance: "FIX" workflow instructions

4. AGENT LOOP — Turn 1:
   Agent sees:
   - Full source code of ChartWidget
   - BEFORE screenshot (chart area is blank)
   - Client error: "Cannot read property 'map' of undefined"
   - Fix guidance from learning engine: "Last time 'map of undefined' → add null check"
   
   Agent calls: update_surface_component with fixed JSX

5. LAYER 3 — Pipeline:
   GATE 1 (validation): ✅ JSX is syntactically valid
   GATE 2 (snapshot):   ✅ Revision 12 created, BEFORE screenshot stored
   GATE 3 (mutation):   ✅ Written to disk, event emitted
   GATE 4 (render):     ⏳ Wait 1500ms... 
                         ✅ No _clientErrors for ChartWidget
   GATE 5 (visual):     📸 AFTER screenshot captured
                         ✅ Non-blank, no error boundary
                         ✅ Visual change detected
   
   → RESULT: SUCCESS

6. AGENT LOOP — sees success:
   "✅ SURFACE UPDATE VERIFIED — ChartWidget rendered successfully."
   [AFTER screenshot displayed to user]

7. LAYER 5 — Learning:
   → Record: {error: 'map of undefined', fix: 'null check', success: true}
   → Update success rate for this pattern

8. AGENT → USER:
   "I fixed the ChartWidget — the data array wasn't being null-checked 
   before mapping. Added a guard: `(data || []).map(...)`. The chart 
   should now display correctly."
   [Screenshot of working chart attached]
```

### Scenario: "Fix the dashboard — the chart is not showing data" (with failure + recovery)

```
1-4. Same as above

5. LAYER 3 — Pipeline (ATTEMPT 1):
   GATE 1 (validation): ✅ 
   GATE 2 (snapshot):   ✅ Revision 12
   GATE 3 (mutation):   ✅ 
   GATE 4 (render):     ⏳ Wait 1500ms...
                         ❌ ChartWidget: "UI.AlertTitle is not defined"
                         → AUTO-REVERT to revision 12
   GATE 5 (visual):     📸 Error screenshot captured
   
   → RESULT: FAILED at 'render' gate

6. LAYER 4 — Recovery Loop (Retry 1/3):
   Agent sees:
   "[SURFACE FIX REQUIRED — ATTEMPT 1/3]
   Error: UI.AlertTitle is not defined
   Fix: UI.AlertTitle does not exist. Use <div className='font-semibold'> instead."
   
   Agent calls: update_surface_component with corrected JSX

7. LAYER 3 — Pipeline (ATTEMPT 2):
   All gates pass.
   → RESULT: SUCCESS

8. LAYER 5 — Learning:
   → Record: {error: 'AlertTitle not defined', fix: 'div.font-semibold', success: true}

9. AGENT → USER:
   "Fixed the ChartWidget. Initial fix attempt used UI.AlertTitle which 
   doesn't exist — corrected to use a div. Chart now renders correctly."
   [Screenshot attached]
```

### Scenario: All retries exhausted (escalation)

```
5-6. Pipeline fails 3 times with different errors each time

7. LAYER 6 — Escalation:
   "## ⚠️ Surface Update Requires Your Help
   
   I attempted to fix ChartWidget 3 times but was unable to resolve 
   the rendering error. Here is what happened:
   
   1. Fixed null data check → New error: UI.Sparkline props mismatch
   2. Fixed Sparkline props → New error: infinite re-render loop
   3. Added useEffect deps → New error: stale closure over data
   
   [BEFORE screenshot: chart area blank]
   [AFTER screenshot: error boundary]
   
   The surface has been reverted to the last working state.
   
   What you can do:
   1. Provide more specific instructions about the chart behavior
   2. Share the data format the chart should display
   3. Ask me to try a completely different approach"
```

---

## Configuration

All SDP parameters are configurable via the unified config:

```javascript
// In resolveUnifiedConfig():
surface: {
  pipeline: {
    enabled: true,                  // Master switch for SDP
    renderWaitMs: 1500,             // Wait time for React render
    screenshotTimeoutMs: 10000,     // Screenshot capture timeout
    maxRetries: 3,                  // Max auto-retries before escalation
    autoRevert: true,               // Auto-revert on render failure
    visualDiff: true,               // Enable visual diff checks
    baselineScreenshot: true,       // Capture BEFORE screenshots
  },
  learning: {
    enabled: true,                  // Surface-specific learning
    maxLessons: 500,                // Max stored error→fix patterns
  },
  validation: {
    strictMode: false,              // Reject on warnings too (not just errors)
    maxSourceLength: 50000,         // Maximum JSX source length
  },
}
```

---

## Testing Strategy

### Unit Tests

| Test | Validates |
|------|-----------|
| `surface-pipeline.test.mjs` | All 5 gates pass/fail correctly |
| `surface-intent-classifier.test.mjs` | Intent classification accuracy |
| `fix-guidance-generator.test.mjs` | Error → fix mapping correctness |
| `surface-mutation-result.test.mjs` | Result formatting for agent |

### Integration Tests

| Test | Validates |
|------|-----------|
| Pipeline + SurfaceManager | Mutation → verification → rollback flow |
| Pipeline + EventBus | Screenshot request → response cycle |
| AgentLoop + Pipeline | Retry loop + escalation behavior |
| Learning + Pipeline | Lesson recording and suggestion |

### Manual Verification Checklist

- [ ] Create surface → add component → verify screenshot captured
- [ ] Update component with bad JSX → verify auto-revert
- [ ] Update component with UI.AlertTitle → verify specific fix guidance
- [ ] Exhaust retries → verify escalation message with screenshots
- [ ] Fix after escalation → verify learning records the fix
- [ ] Second occurrence of same error → verify learning suggests fix
- [ ] `create_surface` no longer triggers premature wrap-up

---

## Design Principles

1. **Structural, not advisory** — Verification is in the execution path, not in prompts
2. **Atomic mutations** — Every surface change is snapshot → mutate → verify → confirm/revert
3. **Visual proof** — Screenshots at every step, displayed to user, summarized for agent
4. **Targeted recovery** — Error messages map to specific fixes, not generic retry
5. **Bounded retry** — Maximum 3 attempts before escalating with full context
6. **Learn from failure** — Every error→fix pair is stored for future reference
7. **Graceful degradation** — If screenshots fail, pipeline still validates via read_surface
8. **No silent failures** — Every surface mutation returns explicit pass/fail, never just "Updated"
9. **User visibility** — User always sees before/after screenshots, not just text
10. **Backward compatible** — Pipeline wraps existing tools, doesn't replace the tool API

---

## Migration Path

### Phase 1: Core Pipeline (Week 1)
- Implement `SurfacePipeline` with 5 gates
- Implement `SurfaceMutationResult`
- Implement `FixGuidanceGenerator`
- Wire interceptor into `ToolExecutorBridge`
- Remove `create_surface` from `WRAPUP_TOOLS`

### Phase 2: Recovery Loop (Week 1)
- Add surface retry detection in `AgentLoop`
- Implement `_buildSurfaceRetryPrompt`
- Implement `_buildSurfaceEscalation`
- Add `MAX_SURFACE_RETRIES` configuration

### Phase 3: Enhanced Context (Week 2)
- Implement `SurfaceIntentClassifier`
- Implement `SurfaceContextAssembler`
- Wire into `ContextManager.preRoute()`
- Add baseline screenshot capture

### Phase 4: Learning (Week 2)
- Add surface pattern store to `LearningEngine`
- Implement `recordSurfaceOutcome`
- Implement `suggestSurfaceFix`
- Wire into pipeline pre-mutation phase

### Phase 5: Testing & Hardening (Week 3)
- Unit tests for all new modules
- Integration tests for full pipeline flow
- Manual verification against common failure scenarios
- Performance testing (screenshot capture latency)

---

## Implementation Status (Updated 2026-03-20)

All core pipeline components have been implemented and pass syntax verification.

### New Files Created

| File | Purpose | Status |
|------|---------|--------|
| `src/surfaces/surface-mutation-result.mjs` | Structured result type for pipeline output | ✅ Complete |
| `src/surfaces/fix-guidance-generator.mjs` | Error → fix guidance mapper with 10+ error patterns | ✅ Complete |
| `src/surfaces/surface-pipeline.mjs` | Core 5-gate pipeline (validate→snapshot→mutate→render→visual) | ✅ Complete |

### Modified Files

| File | Changes | Status |
|------|---------|--------|
| `src/core/agentic/unified/tool-executor-bridge.mjs` | SURFACE_MUTATION_TOOLS, `setSurfacePipeline()`, interceptor in `executeTool()`, `_executeSurfaceMutation()`, `_formatSurfaceResult()` | ✅ Complete |
| `src/core/agentic/unified/unified-provider.mjs` | Import SurfacePipeline, create in init step 7.5, wire to ToolBridge, diagnostics | ✅ Complete |
| `src/core/agentic/unified/agent-loop.mjs` | `surfaceFailureCount` counter, `MAX_SURFACE_RETRIES`, failure detection in tool results, `_buildSurfaceEscalation()` | ✅ Complete |
| `src/core/agentic/unified/learning-engine.mjs` | `_surfaceLessons` Map, `_surfaceStats`, `recordSurfaceOutcome()`, `suggestSurfaceFix()`, `_buildErrorSignature()` | ✅ Complete |

### Remaining Work

| Item | Priority | Notes |
|------|----------|-------|
| Unit tests | High | Test each gate, auto-revert, fix guidance mapping |
| Client-side screenshot handler | High | `surface:request-screenshot` → `surface:screenshot-captured` event flow |
| SurfaceIntentClassifier | Medium | Enhanced intent detection (currently uses existing `detectSurfaceUpdateIntent`) |
| Integration test | Medium | End-to-end pipeline test with mock surface manager |
| Visual diff upgrade | Low | Replace heuristic base64 comparison with pixel-level analysis |
