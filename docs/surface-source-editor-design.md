# Surface Source Editor Design

## Overview

Replace the read-only `SurfaceSourceViewer` with a full source editor that lets users view and edit individual component source code within a surface. On save, the edited source is pushed to the server via the existing `update-surface` WebSocket flow and the rendered surface updates in real-time.

## Architecture

### Component: `SurfaceSourceEditor`

Replaces `SurfaceSourceViewer`. Located at `ui/src/components/features/SurfaceSourceEditor.tsx`.

```
SurfaceSourceEditor
├── Header bar (surface name, component count)
├── Component tab strip (one tab per component + "All" combined view)
├── Monaco Editor (editable for single component, read-only for "All" view)
├── Footer status bar (dirty indicator, save button, component metadata)
```

### Props

```typescript
interface SurfaceSourceEditorProps {
  surfaceId: string;
  data: SurfaceData | null;
  sources: Record<string, string>;
  onSave: (surfaceId: string, componentName: string, jsxSource: string, props: Record<string, unknown>) => void;
  onRemoveComponent?: (surfaceId: string, componentName: string) => void;
}
```

### Key Behaviors

1. **Per-component editing**: Each component in the surface gets its own tab in the editor. Selecting a tab loads that component's JSX source into an editable Monaco editor.

2. **Combined "All" view**: A read-only combined view (like the existing `SurfaceSourceViewer`) is available as the default tab, showing all components concatenated with metadata headers.

3. **Save flow**: `Ctrl+S` or the Save button calls `onSave(surfaceId, componentName, editedSource, existingProps)`, which routes through `useSurface.updateSurface()` → `wsService.updateSurface()` → WebSocket `update-surface` → server `handleUpdateSurface` → broadcasts `surface-updated` back. The rendered surface tab auto-refreshes.

4. **Dirty tracking**: Per-component dirty state tracked in local component state. Visual dirty dot shown on the component tab and in the footer.

5. **Compilation preview**: After save, if the surface tab is open, the component recompiles automatically (existing `ComponentWrapper` behavior).

6. **Toggle from SurfaceRenderer**: A `Code2` icon button in the `SurfaceRenderer` toolbar opens the source editor tab for the current surface.

## Data Flow

```
User edits source in Monaco
  → Ctrl+S / Save button
  → SurfaceSourceEditor.onSave(surfaceId, componentName, newSource, props)
  → App.tsx calls useSurface().updateSurface(surfaceId, componentName, newSource, props)
  → wsService.updateSurface(surfaceId, componentName, newSource, props)
  → WebSocket: { type: 'update-surface', payload: { surface_id, component_name, jsx_source, props } }
  → Server: handleUpdateSurface → surfaceManager.updateComponent()
  → Server broadcasts: { type: 'surface-updated', payload: { surfaceId, component, source, layout } }
  → useSurface hook receives 'surface-updated' → updates loadedSurfaces & componentSources
  → SurfaceRenderer re-renders with new source → ComponentWrapper recompiles
  → SurfaceSourceEditor receives updated `sources` prop → marks component as clean
```

## Changes Required

### New File
- `ui/src/components/features/SurfaceSourceEditor.tsx` — The editable source editor component

### Modified Files
- `ui/src/App.tsx` — Swap `SurfaceSourceViewer` import/usage for `SurfaceSourceEditor`, pass `onSave`/`onRemoveComponent` callbacks
- `ui/src/components/features/SurfaceRenderer.tsx` — Add "Edit Source" button to toolbar
- `ui/src/hooks/useSurface.ts` — Already exposes `updateSurface` and `removeSurfaceComponent`; just need to destructure them in App.tsx

### No Server Changes Required
The existing `update-surface` WebSocket handler and `surfaceManager.updateComponent()` already support the full edit-save-broadcast flow.
