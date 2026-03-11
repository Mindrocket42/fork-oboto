/**
 * SurfaceRenderer — Main orchestrator for rendering a surface tab.
 * Delegates to ComponentWrapper for each component, manages lifecycle & layout.
 * Includes an integrated source editor toggle so users can view/edit source
 * inline without opening a separate tab.
 */
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { Loader2, RefreshCw, Pin, Trash2, LayoutGrid, Code2, Eye } from 'lucide-react';
import type { SurfaceData, SurfaceComponent } from '../../hooks/useSurface';
import { wsService } from '../../services/wsService';
import { FlexGridContainer } from '../layout/FlexGrid';
import type { FlexGridLayout } from '../layout/FlexGrid';
import { WorkflowStatusBar } from './WorkflowStatusBar';
import type { Workflow, WorkflowInteraction } from '../../hooks/useWorkflow';
import { SurfaceLifecycleEmitter, createUseSurfaceLifecycle } from '../../hooks/useSurfaceLifecycle';
import { ComponentWrapper } from './surface/ComponentWrapper';
import { SurfaceSourceEditor } from './SurfaceSourceEditor';

export interface SurfaceRendererProps {
  surfaceId: string;
  data: SurfaceData | null;
  sources: Record<string, string>;
  onRefresh: () => void;
  onPinToggle?: (id: string) => void;
  onDelete?: (id: string) => void;
  /** Called when the user saves a component's source code via the integrated editor. */
  onSave?: (surfaceId: string, componentName: string, jsxSource: string, props: Record<string, unknown>) => void;
  /** Called when the user deletes a component via the integrated editor. */
  onRemoveComponent?: (surfaceId: string, componentName: string) => void;
  isFocused?: boolean;
  workflows?: Workflow[];
  interactions?: WorkflowInteraction[];
  onSubmitInteraction?: (workflowId: string, interactionId: string, data: Record<string, unknown>) => void;
  onCancelWorkflow?: (workflowId: string) => void;
}

function isFlexGridLayout(layout: unknown): layout is FlexGridLayout {
  return typeof layout === 'object' && layout !== null && (layout as FlexGridLayout).type === 'flex-grid';
}

export const SurfaceRenderer: React.FC<SurfaceRendererProps> = ({
  surfaceId,
  data,
  sources,
  onRefresh,
  onPinToggle,
  onDelete,
  onSave,
  onRemoveComponent,
  isFocused = true,
  workflows = [],
  interactions = [],
  onSubmitInteraction,
  onCancelWorkflow,
}) => {
  // Toggle between rendered view and inline source editor
  const [viewMode, setViewMode] = useState<'render' | 'source'>('render');
  const useFlexGrid = isFlexGridLayout(data?.layout);

  // ─── Lifecycle ───
  const [lifecycleEmitter] = useState(() => new SurfaceLifecycleEmitter());
  const surfaceLifecycleHook = useMemo(() => createUseSurfaceLifecycle(lifecycleEmitter), [lifecycleEmitter]);

  useEffect(() => { lifecycleEmitter.setFocused(isFocused); }, [isFocused, lifecycleEmitter]);
  useEffect(() => {
    lifecycleEmitter.emitMount();
    return () => { lifecycleEmitter.emitUnmount(); };
  }, [lifecycleEmitter]);

  // ─── Component helpers ───
  const componentMap = useMemo(() => {
    const map: Record<string, SurfaceComponent> = {};
    if (data) { for (const comp of data.components) { map[comp.name] = comp; } }
    return map;
  }, [data]);

  const renderComponentsByName = useCallback((names: string[]) => {
    return names.map(name => {
      const comp = componentMap[name];
      if (!comp) {
        return (
          <div key={name} className="p-3 text-xs text-zinc-600 border border-dashed border-zinc-800 rounded-lg text-center">
            Component &quot;{name}&quot; not found
          </div>
        );
      }
      return (
        <ComponentWrapper key={comp.id} component={comp} source={sources[comp.id]} surfaceId={surfaceId} useSurfaceLifecycle={surfaceLifecycleHook} />
      );
    });
  }, [componentMap, sources, surfaceId, surfaceLifecycleHook]);

  const unplacedComponents = useMemo(() => {
    if (!data) return [];
    if (!useFlexGrid) return data.components;
    const layout = data.layout as FlexGridLayout;
    const placedNames = new Set<string>();
    for (const row of layout.rows) { for (const cell of row.cells) { for (const name of cell.components) { placedNames.add(name); } } }
    return data.components.filter(c => !placedNames.has(c.name));
  }, [data, useFlexGrid]);

  const layoutLabel = useMemo(() => {
    if (useFlexGrid) return 'flex-grid';
    if (data) return data.layout as string;
    return 'loading';
  }, [data, useFlexGrid]);

  const handleDelete = useCallback(() => {
    if (!data) return;
    if (confirm(`Are you sure you want to delete "${data.name}"?`)) {
      wsService.deleteSurface(surfaceId);
      onDelete?.(surfaceId);
    }
  }, [data, surfaceId, onDelete]);

  // ─── Loading ───
  if (!data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-3">
        <Loader2 size={24} className="animate-spin" />
        <p className="text-xs uppercase tracking-widest">Loading Surface...</p>
      </div>
    );
  }

  return (
    <div id={`surface-${surfaceId}`} className="flex-1 flex flex-col bg-[#080808] min-h-0 overflow-hidden text-zinc-200 w-full min-w-0">
      {/* Toolbar */}
      <div className="h-9 border-b border-zinc-800/60 flex items-center justify-between px-3 bg-[#0c0c0c] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-[12px] font-bold text-zinc-200 truncate">{data.name}</h2>
          {data.description && <span className="text-[10px] text-zinc-600 truncate hidden md:inline">— {data.description}</span>}
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800/60 text-zinc-500 font-mono uppercase tracking-wider flex items-center gap-1">
            <LayoutGrid size={9} />
            {layoutLabel}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Toggle between rendered view and source editor */}
          <button
            onClick={() => setViewMode(prev => prev === 'render' ? 'source' : 'render')}
            className={`p-1.5 rounded transition-colors ${
              viewMode === 'source'
                ? 'bg-cyan-500/20 text-cyan-400'
                : 'hover:bg-cyan-500/20 text-zinc-600 hover:text-cyan-400'
            }`}
            title={viewMode === 'source' ? 'Switch to Rendered View' : 'Edit Source'}
          >
            {viewMode === 'source' ? <Eye size={12} /> : <Code2 size={12} />}
          </button>
          <button onClick={() => onPinToggle?.(surfaceId)} className={`p-1.5 rounded transition-colors ${data.pinned ? 'bg-indigo-500/20 text-indigo-400' : 'hover:bg-zinc-800 text-zinc-600'}`} title={data.pinned ? "Unpin" : "Pin"}>
            <Pin size={12} />
          </button>
          <button onClick={onRefresh} className="p-1.5 hover:bg-zinc-800 text-zinc-600 rounded transition-colors" title="Refresh">
            <RefreshCw size={12} />
          </button>
          <button onClick={handleDelete} className="p-1.5 hover:bg-red-500/20 text-zinc-600 hover:text-red-400 rounded transition-colors" title="Delete">
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Workflow Status Bar */}
      {(workflows.length > 0 || interactions.length > 0) && (
        <WorkflowStatusBar workflows={workflows} interactions={interactions} onSubmitInteraction={onSubmitInteraction || (() => {})} onCancelWorkflow={onCancelWorkflow || (() => {})} />
      )}

      {/* Content — toggled between rendered view and inline source editor */}
      {viewMode === 'source' ? (
        <SurfaceSourceEditor
          surfaceId={surfaceId}
          data={data}
          sources={sources}
          onSave={onSave ?? (() => {})}
          onRemoveComponent={onRemoveComponent}
        />
      ) : useFlexGrid ? (
        <div className="flex-1 flex flex-col min-h-0 w-full min-w-0">
          <FlexGridContainer layout={data.layout as FlexGridLayout} renderComponents={renderComponentsByName} className="flex-1" />
          {unplacedComponents.length > 0 && (
            <div className="border-t border-zinc-800/40 p-4 flex flex-col gap-4 overflow-y-auto max-h-[200px]">
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest">Unplaced Components</div>
              {unplacedComponents.map(comp => (
                <ComponentWrapper key={comp.id} component={comp} source={sources[comp.id]} surfaceId={surfaceId} useSurfaceLifecycle={surfaceLifecycleHook} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className={`flex-1 overflow-y-auto p-4 w-full min-w-0 ${
          data.layout === 'grid' ? 'grid grid-cols-1 gap-6' :
          data.layout === 'horizontal' ? 'flex flex-row gap-6 overflow-x-auto' :
          'flex flex-col gap-6'
        }`}>
          {data.components.length === 0 ? (
            <div className="col-span-full" />
          ) : (
            data.components.map(comp => (
              <ComponentWrapper key={comp.id} component={comp} source={sources[comp.id]} surfaceId={surfaceId} useSurfaceLifecycle={surfaceLifecycleHook} />
            ))
          )}
        </div>
      )}
    </div>
  );
};
