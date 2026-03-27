/* eslint-disable no-unused-expressions, @typescript-eslint/no-unused-expressions */
/**
 * Surface Component Compiler
 * Transpiles JSX source code into React components within a sandboxed scope.
 */
import React, { useState, useMemo } from 'react';
import { transform } from 'sucrase';
import { UI } from '../../../surface-kit';
import { surfaceApi } from './surfaceApi';

/**
 * Module shim for surface component sandbox.
 * When the AI generates `import X from 'react'` or similar,
 * sucrase converts it to `var X = require('react')`.
 */
const sandboxModules: Record<string, unknown> = {
  react: React,
  React: React,
};

export const sandboxRequire = (moduleName: string): unknown => {
  const mod = sandboxModules[moduleName];
  if (mod) return mod;
  console.warn(`[Surface] Unknown import: "${moduleName}" — surface components should not use imports.`);
  return {};
};

/**
 * Sandboxed fetch that restricts outbound requests to localhost only.
 * Surfaces should use surfaceApi.fetchRoute() for workspace routes, but
 * if they use raw fetch(), this prevents exfiltration to external hosts.
 *
 * In "permissive" mode (controlled by workspace setting `surface.sandboxMode`),
 * this falls through to the native fetch with no restrictions.
 */
const sandboxFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  // In permissive mode, allow all network access — no restrictions
  if (surfaceApi.sandboxMode === 'permissive') {
    return fetch(input, init);
  }

  try {
    const url = typeof input === 'string'
      ? new URL(input, window.location.origin)
      : input instanceof URL
        ? input
        : new URL(input.url, window.location.origin);
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      console.warn(`[Surface] Blocked fetch to external host: ${url.hostname} (set surface.sandboxMode to "permissive" to allow)`);
      return Promise.reject(new Error(`Surface fetch restricted to localhost (blocked: ${url.hostname}). Set surface.sandboxMode to "permissive" in workspace settings to allow external requests.`));
    }
  } catch {
    // If URL parsing fails, block it — we can't verify the target host.
    console.warn(`[Surface] Blocked fetch — could not parse URL for safety check`);
    return Promise.reject(new Error('Surface fetch: unable to verify URL target'));
  }
  return fetch(input, init);
};

/**
 * Network-related globals that surface code must not access directly
 * in strict mode. `fetch` is replaced with sandboxFetch; the others
 * are blocked entirely.
 *
 * In permissive mode, all globals are passed through unmodified.
 */
const BLOCKED_NETWORK_APIS = new Set([
  'XMLHttpRequest', 'EventSource', 'WebSocket',
]);

const createSandboxedProxy = (targetObj: typeof globalThis) => {
  return new Proxy(targetObj, {
    get(target, prop) {
      // In permissive mode, pass everything through unmodified
      if (surfaceApi.sandboxMode === 'permissive') {
        const value = (target as any)[prop];
        if (typeof value === 'function') return value.bind(target);
        return value;
      }
      if (prop === 'fetch') return sandboxFetch;
      // Block other network APIs to prevent data exfiltration
      if (typeof prop === 'string' && BLOCKED_NETWORK_APIS.has(prop)) return undefined;
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }
  });
};

/**
 * Compile a JSX source string into a React component.
 * @param source Raw JSX/TSX source code
 * @param componentName Name for error messages
 * @param useSurfaceLifecycle Optional lifecycle hook to inject
 * @param surfaceConsole Optional console proxy for capturing component logs
 */
export const compileComponent = (
  source: string,
  componentName: string,
  useSurfaceLifecycle?: () => unknown,
  surfaceConsole?: Console,
): React.ComponentType<unknown> | null => {
  try {
    const cleanedSource = source.replace(/^\s*import\s+type\s+\{[^}]*\}\s+from\s+['"][^'"]*['"];?\s*$/gm, '');

    const { code } = transform(cleanedSource, {
      transforms: ['jsx', 'typescript', 'imports'],
      production: true,
    });

    const moduleFactory = new Function(
      'React', 'useState', 'useEffect', 'useRef', 'useCallback', 'useMemo',
      'surfaceApi', 'UI', 'useSurfaceLifecycle', 'console', 'exports', 'require', 'module',
      'fetch', 'window', 'globalThis', 'self',
      code
    );

    const exports: { default?: React.ComponentType<unknown> } = {};
    const module = { exports };

    const lifecycleHook = useSurfaceLifecycle || (() => ({
      isFocused: true, onFocus: () => () => {}, onBlur: () => () => {},
      onMount: () => () => {}, onUnmount: () => () => {}
    }));

    // Use the provided surfaceConsole proxy (captures logs to server) or
    // fall back to the real console when no proxy is available.
    const consoleProxy = surfaceConsole || console;

    moduleFactory(
      React, useState, React.useEffect, React.useRef, React.useCallback, useMemo,
      surfaceApi, UI, lifecycleHook, consoleProxy, exports, sandboxRequire, module,
      sandboxFetch,
      createSandboxedProxy(window),
      createSandboxedProxy(globalThis),
      createSandboxedProxy(self)
    );

    return exports.default || (module.exports as { default?: React.ComponentType<unknown> }).default || null;
  } catch (err) {
    console.error(`Failed to compile component ${componentName}:`, err);
    throw err;
  }
};
