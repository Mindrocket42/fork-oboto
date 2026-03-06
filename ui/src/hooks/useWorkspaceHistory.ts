import { useState, useEffect, useCallback } from 'react';
import { wsService } from '../services/wsService';

export interface WorkspaceHistoryEntry {
  path: string;
  name: string;
  lastOpened: string;
  openCount: number;
}

/**
 * Hook for managing workspace folder history.
 * Communicates with the server via WebSocket to list, remove, and clear
 * recently-opened workspace folders.
 */
export function useWorkspaceHistory() {
  const [history, setHistory] = useState<WorkspaceHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Listen for workspace:history responses from the server
  useEffect(() => {
    const unsub = wsService.on('workspace:history', (payload: unknown) => {
      const p = payload as { history: WorkspaceHistoryEntry[]; error?: string };
      setHistory(p.history || []);
      setLoading(false);
    });
    return unsub;
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    wsService.getWorkspaceHistory();
  }, []);

  const remove = useCallback((path: string) => {
    wsService.removeWorkspaceHistoryEntry(path);
  }, []);

  const clear = useCallback(() => {
    wsService.clearWorkspaceHistory();
  }, []);

  return { history, loading, refresh, remove, clear };
}
