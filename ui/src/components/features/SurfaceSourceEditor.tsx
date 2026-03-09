/**
 * SurfaceSourceEditor — Editable Monaco editor for surface component source code.
 *
 * Provides per-component tabs so users can select and edit individual components,
 * plus a read-only "All" view that shows the combined source. On save (Ctrl+S or
 * button), the edited source is pushed to the server via the existing
 * update-surface WebSocket flow.
 */
import React, { useMemo, useState, useCallback, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { Loader2, Code2, Save, Trash2, Eye, Pencil } from 'lucide-react';
import type { SurfaceData, SurfaceComponent } from '../../hooks/useSurface';

/* ─── Types ─────────────────────────────────────────────────────────────── */

interface SurfaceSourceEditorProps {
  surfaceId: string;
  data: SurfaceData | null;
  sources: Record<string, string>;
  /** Called when the user saves a component's source code. */
  onSave: (surfaceId: string, componentName: string, jsxSource: string, props: Record<string, unknown>) => void;
  /** Optional: called when the user deletes a component. */
  onRemoveComponent?: (surfaceId: string, componentName: string) => void;
}

/* ─── Constants ─────────────────────────────────────────────────────────── */

const ALL_VIEW_ID = '__all__';

/* ─── Helpers ───────────────────────────────────────────────────────────── */

/** Build a combined read-only source string showing all components. */
function buildCombinedSource(data: SurfaceData, sources: Record<string, string>, surfaceId: string): string {
  const parts: string[] = [];
  parts.push(`// Surface: ${data.name}`);
  if (data.description) parts.push(`// ${data.description}`);
  parts.push(`// ID: ${surfaceId}`);
  parts.push(`// Layout: ${typeof data.layout === 'string' ? data.layout : JSON.stringify(data.layout)}`);
  parts.push(`// Components: ${data.components.length}`);
  parts.push('');

  if (data.components.length === 0) {
    parts.push('// (No components in this surface)');
  }

  for (const comp of data.components) {
    const source = sources[comp.id];
    parts.push(`// ─── Component: ${comp.name} ─────────────────────────────────`);
    parts.push(`// Source file: ${comp.sourceFile}`);
    parts.push(`// Order: ${comp.order}`);
    if (Object.keys(comp.props).length > 0) {
      parts.push(`// Props: ${JSON.stringify(comp.props)}`);
    }
    parts.push('');
    parts.push(source || '// (Source not loaded)');
    parts.push('');
  }

  return parts.join('\n');
}

/* ─── Component ─────────────────────────────────────────────────────────── */

export const SurfaceSourceEditor: React.FC<SurfaceSourceEditorProps> = ({
  surfaceId,
  data,
  sources,
  onSave,
  onRemoveComponent,
}) => {
  // Which component tab is active — ALL_VIEW_ID or a component id
  const [activeCompId, setActiveCompId] = useState<string>(ALL_VIEW_ID);

  // Per-component edited source buffers keyed by component id
  const [editBuffers, setEditBuffers] = useState<Record<string, string>>({});

  // Effective edit buffers: strip out any buffer whose value now matches
  // the canonical source (i.e. server pushed an update after save).
  const effectiveBuffers = useMemo(() => {
    const result: Record<string, string> = {};
    for (const [compId, edited] of Object.entries(editBuffers)) {
      const canonical = sources[compId] ?? '';
      // Keep only if the edit diverges from the canonical source
      if (edited !== canonical) {
        result[compId] = edited;
      }
    }
    return result;
  }, [editBuffers, sources]);

  // Track which components have unsaved changes
  const dirtySet = useMemo(() => new Set(Object.keys(effectiveBuffers)), [effectiveBuffers]);

  // Active component metadata
  const activeComp: SurfaceComponent | undefined = useMemo(
    () => data?.components.find(c => c.id === activeCompId),
    [data, activeCompId]
  );

  // Monaco editor ref
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  // Determine content to display
  const editorContent = useMemo(() => {
    if (!data) return '';
    if (activeCompId === ALL_VIEW_ID) {
      return buildCombinedSource(data, sources, surfaceId);
    }
    // Single component — prefer edit buffer, fall back to saved source
    return effectiveBuffers[activeCompId] ?? sources[activeCompId] ?? '// (Source not loaded)';
  }, [data, sources, surfaceId, activeCompId, effectiveBuffers]);

  const isReadOnly = activeCompId === ALL_VIEW_ID;
  const isDirty = activeCompId !== ALL_VIEW_ID && dirtySet.has(activeCompId);

  // ─── Handlers ────────────────────────────────────────────────────────

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (value === undefined || activeCompId === ALL_VIEW_ID) return;
    setEditBuffers(prev => ({ ...prev, [activeCompId]: value }));
  }, [activeCompId]);

  const handleSave = useCallback(() => {
    if (!activeComp || activeCompId === ALL_VIEW_ID) return;
    const currentSource = editBuffers[activeCompId] ?? sources[activeCompId] ?? '';
    onSave(surfaceId, activeComp.name, currentSource, activeComp.props);
  }, [activeComp, activeCompId, editBuffers, sources, surfaceId, onSave]);

  const handleRemove = useCallback(() => {
    if (!activeComp || !onRemoveComponent) return;
    if (!confirm(`Delete component "${activeComp.name}" from this surface?`)) return;
    onRemoveComponent(surfaceId, activeComp.name);
    setActiveCompId(ALL_VIEW_ID);
  }, [activeComp, surfaceId, onRemoveComponent]);

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    // Bind Ctrl/Cmd+S to save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSave();
    });
  }, [handleSave]);

  // ─── Loading state ───────────────────────────────────────────────────

  if (!data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-3">
        <Loader2 size={24} className="animate-spin" />
        <p className="text-xs uppercase tracking-widest">Loading surface source...</p>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col bg-[#080808] min-h-0 overflow-hidden text-zinc-200 w-full min-w-0">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="h-9 border-b border-zinc-800/60 flex items-center justify-between px-3 bg-[#0c0c0c] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Code2 size={13} className="text-cyan-400 shrink-0" />
          <h2 className="text-[12px] font-bold text-zinc-200 truncate">
            Source: {data.name}
          </h2>
          <span className="text-[10px] text-zinc-600 truncate hidden md:inline">
            {data.components.length} component{data.components.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Actions for single-component view */}
        {activeCompId !== ALL_VIEW_ID && (
          <div className="flex items-center gap-1 shrink-0">
            {isDirty && (
              <span className="text-[9px] text-amber-400 mr-1 font-medium">Modified</span>
            )}
            <button
              onClick={handleSave}
              disabled={!isDirty}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded transition-colors
                disabled:opacity-30 disabled:cursor-not-allowed
                bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30"
              title="Save (Ctrl+S)"
            >
              <Save size={11} />
              Save
            </button>
            {onRemoveComponent && (
              <button
                onClick={handleRemove}
                className="p-1 rounded hover:bg-red-500/20 text-zinc-600 hover:text-red-400 transition-colors"
                title="Delete component"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Component tabs ─────────────────────────────────────────────── */}
      <div className="border-b border-zinc-800/40 flex items-end overflow-x-auto bg-[#0a0a0a] shrink-0">
        {/* All (combined) tab */}
        <button
          onClick={() => setActiveCompId(ALL_VIEW_ID)}
          className={`
            flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium border-r border-zinc-800/30
            transition-colors relative shrink-0
            ${activeCompId === ALL_VIEW_ID
              ? 'bg-[#080808] text-zinc-200'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#0e0e0e]'}
          `}
        >
          {activeCompId === ALL_VIEW_ID && (
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-cyan-500" />
          )}
          <Eye size={10} />
          All
        </button>

        {/* Per-component tabs */}
        {data.components.map(comp => {
          const isActive = activeCompId === comp.id;
          const compDirty = dirtySet.has(comp.id);
          return (
            <button
              key={comp.id}
              onClick={() => setActiveCompId(comp.id)}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium border-r border-zinc-800/30
                transition-colors relative shrink-0
                ${isActive
                  ? 'bg-[#080808] text-zinc-200'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#0e0e0e]'}
              `}
            >
              {isActive && (
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-indigo-500" />
              )}
              <Pencil size={9} className={isActive ? 'text-indigo-400' : 'text-zinc-600'} />
              <span className="max-w-[100px] truncate">{comp.name}</span>
              {compDirty && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 animate-pulse" />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Monaco Editor ──────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0">
        <Editor
          key={activeCompId} // remount editor when switching components
          height="100%"
          language="typescript"
          theme="vs-dark"
          value={editorContent}
          onChange={handleEditorChange}
          onMount={handleEditorMount}
          options={{
            readOnly: isReadOnly,
            minimap: { enabled: true, maxColumn: 80 },
            fontSize: 12,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            renderWhitespace: 'selection',
            padding: { top: 12 },
            tabSize: 2,
            bracketPairColorization: { enabled: true },
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            ...(isReadOnly ? { domReadOnly: true } : {}),
          }}
          loading={
            <div className="flex items-center justify-center h-full text-zinc-500">
              <Loader2 size={20} className="animate-spin mr-2" />
              <span className="text-xs">Loading editor...</span>
            </div>
          }
        />
      </div>

      {/* ── Footer status bar ──────────────────────────────────────────── */}
      {activeComp && (
        <div className="h-6 border-t border-zinc-800/40 flex items-center justify-between px-3 bg-[#0a0a0a] text-[9px] text-zinc-600 shrink-0">
          <div className="flex items-center gap-3">
            <span>Component: <span className="text-zinc-400">{activeComp.name}</span></span>
            <span>Order: {activeComp.order}</span>
            {Object.keys(activeComp.props).length > 0 && (
              <span>Props: {Object.keys(activeComp.props).length}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isDirty ? (
              <span className="text-amber-400 font-medium">● Unsaved</span>
            ) : (
              <span className="text-emerald-500/60">✓ Saved</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
