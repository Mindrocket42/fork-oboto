/**
 * Sentient Bridge — CJS/ESM interop layer for loading SentientObserver.
 *
 * The sentient-core.js module (skills/alephnet-node/lib/sentient-core.js) is
 * written in CommonJS and uses `require()` for all its dependencies.  The
 * ai-man cognitive system is pure ESM.  This bridge module uses Node's
 * `createRequire()` to load the CJS module from ESM context.
 *
 * The bridge is lazy — it only loads the CJS module on first call to
 * `loadSentientCore()`, and caches the result for subsequent calls.
 *
 * @module src/core/agentic/cognitive/sentient-bridge
 */

import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cached module references
let _sentientCoreModule = null;
let _tinyAlephBackend = null;
let _tinyAlephBackendKey = null;

/**
 * Resolve the path to the sentient-core.js skill module.
 * Walks up from src/core/agentic/cognitive/ to the project root,
 * then into skills/alephnet-node/lib/.
 *
 * @returns {string} Absolute path to sentient-core.js
 */
function resolveSentientCorePath() {
  // From src/core/agentic/cognitive/ → project root is 4 levels up
  const projectRoot = resolve(__dirname, '..', '..', '..', '..');
  return resolve(projectRoot, 'skills', 'alephnet-node', 'lib', 'sentient-core.js');
}

/**
 * Load the SentientObserver CJS module from ESM context.
 *
 * Uses `createRequire()` anchored at the sentient-core.js directory so
 * that its internal `require('./smf')`, `require('./prsc')`, etc. resolve
 * correctly against the skills/alephnet-node/lib/ directory.
 *
 * @returns {{ SentientObserver: Function, SentientState: Function }}
 * @throws {Error} If the module cannot be loaded
 */
export function loadSentientCore() {
  if (_sentientCoreModule) return _sentientCoreModule;

  try {
    const corePath = resolveSentientCorePath();

    // Create a require function anchored at the sentient-core *directory*
    // so that require('./smf'), require('./prsc'), etc. resolve correctly.
    // Anchoring at the file itself works in current Node versions but is
    // an implementation detail — anchoring at the directory is explicit.
    const requireFn = createRequire(resolve(dirname(corePath), 'package.json'));

    // Load the CJS module
    _sentientCoreModule = requireFn(corePath);

    return _sentientCoreModule;
  } catch (err) {
    // Do not cache the error — allow retries (e.g. after skill installation)
    const loadErr = new Error(
      `Failed to load SentientObserver from skills/alephnet-node: ${err.message}`
    );
    loadErr.cause = err;
    throw loadErr;
  }
}

/**
 * Load the @aleph-ai/tinyaleph npm package backend.
 *
 * The SentientObserver constructor requires a `backend` object with
 * `textToOrderedState()`.  This function loads the tinyaleph package
 * and returns its `createBackend()` result.
 *
 * @param {Object} [options] - Backend configuration options
 * @param {number} [options.primeCount=64] - Number of primes to use
 * @returns {Object} TinyAleph backend with textToOrderedState()
 * @throws {Error} If @aleph-ai/tinyaleph cannot be loaded
 */
export function loadTinyAlephBackend(options = {}) {
  const cacheKey = JSON.stringify(options);
  if (_tinyAlephBackend && _tinyAlephBackendKey === cacheKey) return _tinyAlephBackend;

  try {
    // createRequire from the project root so tinyaleph resolves from
    // the project's node_modules
    const projectRoot = resolve(__dirname, '..', '..', '..', '..');
    const requireFn = createRequire(resolve(projectRoot, 'package.json'));
    const tinyaleph = requireFn('@aleph-ai/tinyaleph');

    let result;

    // tinyaleph exports createBackend or we can use the default backend
    if (typeof tinyaleph.createBackend === 'function') {
      result = tinyaleph.createBackend(options);
    } else if (typeof tinyaleph.textToOrderedState === 'function') {
      // Fallback: construct a minimal backend if createBackend doesn't exist
      // The SentientObserver only needs backend.textToOrderedState(text)
      result = { textToOrderedState: tinyaleph.textToOrderedState };
    } else {
      // No recognized export — throw a clear error rather than returning
      // an unvalidated object that would fail deep inside SentientObserver
      throw new Error(
        '@aleph-ai/tinyaleph module does not export createBackend() or textToOrderedState()'
      );
    }

    _tinyAlephBackend = result;
    _tinyAlephBackendKey = cacheKey;
    return _tinyAlephBackend;
  } catch (err) {
    throw new Error(
      `Failed to load @aleph-ai/tinyaleph backend: ${err.message}`
    );
  }
}

/**
 * Check whether the SentientObserver is available (all dependencies met).
 * Does NOT throw — returns { available, error }.
 *
 * @returns {{ available: boolean, error: string|null }}
 */
export function checkSentientAvailability() {
  try {
    loadSentientCore();
    loadTinyAlephBackend();
    return { available: true, error: null };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

/**
 * Reset the module cache.  Used in tests to force re-loading.
 */
export function resetBridgeCache() {
  _sentientCoreModule = null;
  _tinyAlephBackend = null;
  _tinyAlephBackendKey = null;
}
