/**
 * FixGuidanceGenerator — maps client-side errors to targeted fix suggestions.
 *
 * Instead of making the agent guess what went wrong, this module matches
 * known error patterns against a curated fix database and produces
 * specific, actionable guidance.
 *
 * @module src/surfaces/fix-guidance-generator
 */

// ════════════════════════════════════════════════════════════════════════
// Known Error → Fix Patterns
// ════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} FixPattern
 * @property {RegExp} match        — regex to match error message
 * @property {string} diagnosis    — what the error means
 * @property {string[]} commonCauses — typical causes
 * @property {string} action       — what to do
 */

/** @type {FixPattern[]} */
const FIX_PATTERNS = [
  // React Error #130 — undefined component type
  {
    match: /element type is invalid|expected a string.*but got[: ]*undefined|error #130/i,
    diagnosis: 'A JSX element resolved to undefined — you used a component that does not exist in the sandbox.',
    commonCauses: [
      'UI.AlertTitle → use <div className="font-semibold">',
      'UI.AlertDescription → use <div className="text-sm">',
      'UI.Stack → use <div className="flex flex-col gap-2">',
      'UI.Icons.Atom → use UI.Icons.Activity',
      'UI.Icons.Orbit → use UI.Icons.RefreshCw',
      'UI.Icons.Cpu → use UI.Icons.Terminal',
    ],
    action: 'Find the undefined component in your JSX and replace it with a valid one from the list above.',
  },

  // Import statement errors
  {
    match: /cannot use import|import.*is not defined|unexpected token.*import/i,
    diagnosis: 'Surface components cannot use import statements — they run in a sandboxed environment.',
    commonCauses: [
      'All React hooks (useState, useEffect, useRef, useCallback, useMemo) are globals.',
      'All UI.* components (UI.Card, UI.Button, etc.) are globals.',
      'surfaceApi is a global.',
      'useSurfaceLifecycle is a global.',
    ],
    action: 'Remove ALL import/require statements from the component source.',
  },

  // Missing export default
  {
    match: /is not a function|is not a component|cannot read.*default/i,
    diagnosis: 'The component is not exported correctly or the default export is not a function.',
    commonCauses: [
      'Missing "export default function ComponentName(props) { ... }".',
      'Using arrow function without export: const X = () => {} — use export default function X() {}.',
      'Exporting a non-function (e.g. export default 42).',
    ],
    action: 'Ensure the component has exactly: export default function ComponentName(props) { return (...); }',
  },

  // Hook ordering / conditional hooks
  {
    match: /rendered more hooks|hooks.*different order|hook.*conditional/i,
    diagnosis: 'React hooks are being called conditionally or in a different order between renders.',
    commonCauses: [
      'Hooks inside if/else blocks, for loops, or early returns.',
      'Hooks after a conditional return statement.',
      'Dynamic hook count based on state values.',
    ],
    action: 'Move ALL useState/useEffect/useRef calls to the very top of the function body, before any conditionals or returns.',
  },

  // Cannot read property / undefined access
  {
    match: /cannot read propert(?:y|ies).*of (?:undefined|null)|TypeError:.*is not/i,
    diagnosis: 'Accessing a property on undefined or null — likely missing data or incorrect prop shape.',
    commonCauses: [
      'Calling .map() on data that might be undefined → use (data || []).map(...)',
      'Accessing nested object properties without null checks → use obj?.nested?.prop',
      'Using props that were not passed → add default values: ({ data = [] }) => ...',
    ],
    action: 'Add null/undefined guards around the property access. Use optional chaining (?.) and nullish coalescing (??).',
  },

  // Maximum update depth exceeded (infinite re-render)
  {
    match: /maximum update depth|too many re-renders|infinite/i,
    diagnosis: 'The component is triggering infinite re-renders — a state update is happening during render.',
    commonCauses: [
      'Calling setState directly in the render body (not inside useEffect or event handler).',
      'useEffect without dependency array → runs every render → updates state → re-render → loop.',
      'useEffect with state variable in deps AND updates that same variable.',
      'onClick={handler()} instead of onClick={handler} — () calls immediately.',
    ],
    action: 'Ensure setState is only called inside useEffect (with correct deps) or event handlers (onClick, onChange). Never call setState in the render body.',
  },

  // Syntax / parse errors from Babel
  {
    match: /unexpected token|syntaxerror|parse error|unterminated/i,
    diagnosis: 'The JSX source has a syntax error that prevents Babel from compiling it.',
    commonCauses: [
      'Unbalanced braces { } — count them carefully.',
      'Unbalanced angle brackets < > in JSX — every <Tag> needs </Tag> or <Tag />.',
      'Missing closing parenthesis in JSX return statement.',
      'Template literal backtick ` not closed.',
      'Stray characters outside the component function.',
    ],
    action: 'Check for unbalanced braces, parentheses, and angle brackets. Ensure every opening delimiter has a matching close.',
  },

  // JSX element closing tag mismatch
  {
    match: /closing tag.*does not match|expected.*closing tag/i,
    diagnosis: 'A JSX closing tag does not match its opening tag.',
    commonCauses: [
      'Opening <div> closed with </span>.',
      'Self-closing component <UI.Input /> written as <UI.Input></UI.Input>.',
      'Nested tags in wrong order — close inner tags before outer tags.',
    ],
    action: 'Verify every JSX opening tag has the correct matching closing tag in the right order.',
  },

  // require() in sandbox
  {
    match: /require is not defined|require.*not.*function/i,
    diagnosis: 'require() is not available in the surface sandbox — only global APIs are available.',
    commonCauses: [
      'Trying to require("react") — React is already a global.',
      'Trying to require a module — use surfaceApi.callTool or surfaceApi.fetch instead.',
    ],
    action: 'Remove all require() calls. Use the globally available APIs: UI.*, surfaceApi, React hooks.',
  },

  // Network / async errors in component
  {
    match: /fetch.*failed|network.*error|CORS|ERR_CONNECTION/i,
    diagnosis: 'The component is making a direct network request that failed. Use surfaceApi.fetch() instead of raw fetch().',
    commonCauses: [
      'Using window.fetch() or fetch() directly → CORS errors.',
      'Use surfaceApi.fetch(url, options) which proxies through the server.',
    ],
    action: 'Replace any direct fetch() calls with surfaceApi.fetch(url, options). This routes through the server and avoids CORS.',
  },
];

// ════════════════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════════════════

/**
 * Generate targeted fix guidance from an error message and optional JSX source.
 *
 * @param {string|{message?: string}} error — client-side error (string or object with .message)
 * @param {string} [jsxSource] — the JSX source that caused the error
 * @returns {string} — formatted fix guidance text
 */
export function generateFixGuidance(error, jsxSource) {
  const errorMsg = typeof error === 'string' ? error : (error?.message || String(error));

  const parts = [];

  // Match against known patterns
  let matched = false;
  for (const pattern of FIX_PATTERNS) {
    if (pattern.match.test(errorMsg)) {
      matched = true;
      parts.push(`  Diagnosis: ${pattern.diagnosis}`);
      parts.push('  Common causes:');
      for (const cause of pattern.commonCauses) {
        parts.push(`    • ${cause}`);
      }
      parts.push(`  Action: ${pattern.action}`);
      break; // Use first match
    }
  }

  // If no pattern matched, give generic guidance
  if (!matched) {
    parts.push(`  Diagnosis: Unrecognized error — "${errorMsg.substring(0, 200)}"`);
    parts.push('  General guidance:');
    parts.push('    • Check for import statements (remove them — all APIs are globals).');
    parts.push('    • Check for non-existent UI.* components (see docs/guides/surface-components.md).');
    parts.push('    • Ensure the component has "export default function ComponentName(props) { ... }".');
    parts.push('    • Check for unbalanced braces, parentheses, and brackets.');
    parts.push('    • Add null checks for data that might be undefined.');
  }

  // If JSX source is provided, try to identify specific problematic lines
  if (jsxSource) {
    const specificIssues = _scanForKnownBadPatterns(jsxSource);
    if (specificIssues.length > 0) {
      parts.push('');
      parts.push('  Detected issues in source code:');
      for (const issue of specificIssues) {
        parts.push(`    🔍 ${issue}`);
      }
    }
  }

  return parts.join('\n');
}

// ════════════════════════════════════════════════════════════════════════
// Source Code Scanner
// ════════════════════════════════════════════════════════════════════════

/**
 * Scan JSX source for known bad patterns that cause common failures.
 *
 * @private
 * @param {string} source — JSX source code
 * @returns {string[]} — list of detected issues
 */
function _scanForKnownBadPatterns(source) {
  const issues = [];

  // Non-existent UI components
  const badComponents = {
    'UI.AlertTitle': 'Use <div className="font-semibold"> instead',
    'UI.AlertDescription': 'Use <div className="text-sm"> instead',
    'UI.Stack': 'Use <div className="flex flex-col gap-2"> instead',
    'UI.Icons.Atom': 'Use UI.Icons.Activity instead',
    'UI.Icons.Orbit': 'Use UI.Icons.RefreshCw instead',
    'UI.Icons.Cpu': 'Use UI.Icons.Terminal instead',
    'UI.Icons.Brain': 'Use UI.Icons.Activity instead',
    'UI.Icons.Database': 'Use UI.Icons.Terminal instead',
  };

  for (const [bad, fix] of Object.entries(badComponents)) {
    if (source.includes(bad)) {
      issues.push(`Found "${bad}" which does NOT exist. ${fix}.`);
    }
  }

  // Import statements
  const importMatch = source.match(/^import\s+.+from\s+['"].+['"]/m);
  if (importMatch) {
    issues.push(`Found import statement: "${importMatch[0]}". Remove it — all APIs are globals.`);
  }

  // require() calls
  if (/\brequire\s*\(/.test(source)) {
    issues.push('Found require() call. Remove it — use global APIs instead.');
  }

  // Missing export default function
  if (!/export\s+default\s+function\b/.test(source)) {
    issues.push('Missing "export default function ComponentName(...)". Add it.');
  }

  // Direct fetch() calls (should use surfaceApi.fetch)
  if (/\bfetch\s*\(/.test(source) && !/surfaceApi\.fetch/.test(source)) {
    issues.push('Direct fetch() call detected — use surfaceApi.fetch() to avoid CORS issues.');
  }

  // setState in render body (common infinite loop cause)
  const setStateInBody = source.match(/^\s*set\w+\(/m);
  if (setStateInBody && !/useEffect|onClick|onChange|onSubmit|addEventListener/.test(
    source.substring(Math.max(0, source.indexOf(setStateInBody[0]) - 200), source.indexOf(setStateInBody[0]))
  )) {
    issues.push('Possible setState call in render body — this causes infinite re-renders. Wrap in useEffect or event handler.');
  }

  return issues;
}

/**
 * Check if an error message likely represents a surface render failure.
 *
 * @param {string} errorMsg — error message text
 * @returns {boolean}
 */
export function isSurfaceRenderError(errorMsg) {
  if (!errorMsg || typeof errorMsg !== 'string') return false;
  return FIX_PATTERNS.some(p => p.match.test(errorMsg));
}
