import React, { useState, useEffect, useMemo, useRef } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { wsService } from '../../services/wsService';
import { compileComponent } from './surface/surfaceCompiler';

interface PluginHostProps {
  /** Plugin name */
  pluginName: string;
  /** Component filename (relative to plugin dir) */
  componentFile: string;
  /** Optional props to pass to the rendered component */
  componentProps?: Record<string, unknown>;
  /** Fallback content while loading */
  fallback?: React.ReactNode;
}

/**
 * PluginHost renders a plugin UI component by fetching its JSX source
 * from the server and compiling it at runtime using the surface compiler.
 *
 * This provides a sandboxed rendering environment similar to how Surfaces work.
 */
const PluginHost: React.FC<PluginHostProps> = ({
  pluginName,
  componentFile,
  componentProps = {},
  fallback,
}) => {
  const [source, setSource] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const sourceReceivedRef = useRef(false);

  // Reset state during render when plugin/component changes.
  // This is a React-recommended pattern for synchronising state with props
  // *without* an Effect.  It triggers a synchronous re-render before the
  // browser paints, which avoids the stale-UI flash that useEffect would cause.
  // See: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevKey, setPrevKey] = useState(`${pluginName}/${componentFile}`);
  const currentKey = `${pluginName}/${componentFile}`;
  if (currentKey !== prevKey) {
    setPrevKey(currentKey);
    setSource(null);
    setFetchError(null);
  }

  // Subscribe to WS for component source and request it
  useEffect(() => {
    sourceReceivedRef.current = false;

    const unsub = wsService.on('plugin:component-source', (payload: unknown) => {
      const data = payload as {
        pluginName: string;
        componentFile: string;
        source: string | null;
        error: string | null;
      };

      if (data.pluginName === pluginName && data.componentFile === componentFile) {
        if (data.error) {
          setFetchError(data.error);
        } else if (data.source) {
          setSource(data.source);
          sourceReceivedRef.current = true;
        }
      }
    });

    // Also listen for plugin:error as a fallback — some server-side security
    // checks may respond with this type instead of plugin:component-source.
    const unsubError = wsService.on('plugin:error', (payload: unknown) => {
      const data = payload as { error?: string; pluginName?: string; componentFile?: string };
      // Only handle errors for this specific plugin+component (if tagged)
      // and only before we've received the source — use a ref to avoid
      // stale closure.
      if (data?.error && !sourceReceivedRef.current
          && data.pluginName === pluginName
          && (!data.componentFile || data.componentFile === componentFile)) {
        setFetchError(data.error);
      }
    });

    // Timeout: if no response arrives within 10 seconds, show an error
    // instead of spinning forever (e.g. if isLocalRequest() fails silently).
    const timeoutId = setTimeout(() => {
      if (!sourceReceivedRef.current) {
        setFetchError(
          `Timed out loading component "${componentFile}" from plugin "${pluginName}". ` +
          'The server may not be responding or localhost security check may be failing.'
        );
      }
    }, 10_000);

    wsService.sendMessage('plugin:get-component', { pluginName, componentFile });

    return () => {
      unsub();
      unsubError();
      clearTimeout(timeoutId);
    };
  }, [pluginName, componentFile]);

  // Derive compiled component from source (synchronous transform, not an effect)
  const { CompiledComponent, compileError } = useMemo(() => {
    if (!source) return { CompiledComponent: null, compileError: null };
    try {
      const Component = compileComponent(source, `${pluginName}/${componentFile}`);
      return {
        CompiledComponent: Component as React.FC<Record<string, unknown>>,
        compileError: null,
      };
    } catch (err) {
      return {
        CompiledComponent: null,
        compileError: `Failed to compile component: ${(err as Error).message}`,
      };
    }
  }, [source, pluginName, componentFile]);

  // Derive loading and error from state (no explicit loading state needed)
  const error = fetchError || compileError;
  const loading = !source && !fetchError;

  if (loading) {
    return fallback || (
      <div className="flex items-center justify-center h-full text-zinc-500 text-xs gap-2 p-4">
        <Loader2 size={14} className="animate-spin" />
        Loading plugin component...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded p-4 m-2">
        <div className="flex items-center gap-2">
          <AlertCircle size={14} className="shrink-0" />
          <div>
            <p className="font-medium">Plugin Error</p>
            <p className="text-[10px] text-red-500 mt-0.5">{error}</p>
          </div>
        </div>
        <button
          onClick={() => {
            setFetchError(null);
            setSource(null);
          }}
          className="px-3 py-1 rounded text-[10px] font-medium bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (CompiledComponent) {
    return (
      <div className="plugin-host" data-plugin={pluginName} data-component={componentFile}>
        <ErrorBoundary pluginName={pluginName}>
          <CompiledComponent {...componentProps} />
        </ErrorBoundary>
      </div>
    );
  }

  return null;
};

/**
 * Error boundary to catch rendering errors in plugin components.
 */
class ErrorBoundary extends React.Component<
  { pluginName: string; children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { pluginName: string; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded p-3 m-2">
          <AlertCircle size={14} className="shrink-0" />
          <div>
            <p className="font-medium">Plugin Render Error ({this.props.pluginName})</p>
            <p className="text-[10px] text-red-500 mt-0.5">{this.state.error?.message}</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default PluginHost;
