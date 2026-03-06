import React, { useEffect, useState, useCallback } from 'react';
import { wsService } from '../../services/wsService';
import { Folder, FolderOpen, ChevronRight, ArrowUp, Loader2, X, Check, Plus, Cloud, Link, Unlink, RefreshCw, Clock, Trash2 } from 'lucide-react';
import { useCloudSync } from '../../hooks/useCloudSync';
import { useWorkspaceHistory } from '../../hooks/useWorkspaceHistory';

interface DirectoryPickerProps {
  isOpen: boolean;
  currentPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

type TabMode = 'recent' | 'local' | 'cloud';

/**
 * Format a relative time string from an ISO date.
 */
function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}mo ago`;
  return `${Math.floor(diffMonth / 12)}y ago`;
}

const DirectoryPicker: React.FC<DirectoryPickerProps> = ({ isOpen, currentPath, onSelect, onClose }) => {
  const [browsePath, setBrowsePath] = useState(currentPath || '/');
  const [dirs, setDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabMode>('recent');
  const [selectedCloudWs, setSelectedCloudWs] = useState<string | null>(null);

  const cloud = useCloudSync();
  const showCloudTab = cloud.configured && cloud.loggedIn;

  const wsHistory = useWorkspaceHistory();

  useEffect(() => {
    if (isOpen && currentPath) {
      setBrowsePath(currentPath);
    }
  }, [isOpen, currentPath]);

  // Fetch workspace history when the recent tab is shown
  useEffect(() => {
    if (isOpen && activeTab === 'recent') {
      wsHistory.refresh();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab]);

  // Fetch cloud workspaces when cloud tab is opened
  useEffect(() => {
    if (isOpen && activeTab === 'cloud' && showCloudTab) {
      cloud.listWorkspaces();
    }
  }, [isOpen, activeTab, showCloudTab, cloud]);

  const loadDirs = useCallback((dirPath: string) => {
    setLoading(true);
    setError(null);
    setDirs([]);
    setBrowsePath(dirPath);
    
    const timeoutId = setTimeout(() => {
      setLoading((prev) => {
        if (prev) {
          setError("Request timed out. Server may be unreachable.");
          return false;
        }
        return prev;
      });
    }, 5000);

    try {
      wsService.listDirs(dirPath);
    } catch {
      clearTimeout(timeoutId);
      setError("Failed to send request.");
      setLoading(false);
    }
    
    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!isOpen || activeTab !== 'local') return;

    const unsub = wsService.on('dir-list', (payload: unknown) => {
      const p = payload as { path: string; dirs: string[] };
      if (p.path === browsePath) {
        setDirs(p.dirs);
        setLoading(false);
      }
    });

    const unsubErr = wsService.on('error', (payload: unknown) => {
      const msg = payload as string;
      if (msg.includes('list dirs')) {
        setError(msg);
        setLoading(false);
      }
    });

    const unsubDirCreated = wsService.on('dir-created', () => {
      loadDirs(browsePath);
    });

    const cleanupTimeout = loadDirs(browsePath);

    return () => {
      unsub();
      unsubErr();
      unsubDirCreated();
      if (cleanupTimeout) cleanupTimeout();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, browsePath, activeTab]);

  const goUp = () => {
    const parent = browsePath.replace(/\/[^/]+\/?$/, '') || '/';
    loadDirs(parent);
  };

  const navigateInto = (dirName: string) => {
    const newPath = browsePath === '/' ? `/${dirName}` : `${browsePath}/${dirName}`;
    loadDirs(newPath);
  };

  const handleCreateFolder = () => {
    const name = window.prompt("New Folder Name:");
    if (!name) return;
    
    const parent = browsePath.endsWith('/') ? browsePath : `${browsePath}/`;
    const newPath = `${parent}${name}`;
    
    wsService.createDir(newPath);
  };

  const handleSelect = () => {
    onSelect(browsePath);
    onClose();
  };

  const handleSelectFromHistory = (historyPath: string) => {
    onSelect(historyPath);
    onClose();
  };

  const handleSelectCloudWorkspace = () => {
    if (selectedCloudWs) {
      // Link if not already linked, otherwise just confirm selection
      if (cloud.linkedWorkspace?.id !== selectedCloudWs) {
        cloud.linkWorkspace(selectedCloudWs);
      }
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  if (!isOpen) return null;

  // Breadcrumb segments
  const pathSegments = browsePath.split('/').filter(Boolean);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md animate-fade-in"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="bg-[#0a0a0a] border border-zinc-800/60 rounded-2xl shadow-2xl shadow-black/50 w-full max-w-lg mx-4 flex flex-col max-h-[80vh] animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/40">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-zinc-200">Select Workspace</h2>
            {activeTab === 'recent' && (
              <p className="text-[10px] text-zinc-500 mt-1">Open a recently-used workspace folder</p>
            )}
            {activeTab === 'local' && (
              <div className="flex items-center gap-1 mt-1.5 overflow-x-auto custom-scrollbar">
                <button 
                  onClick={() => loadDirs('/')}
                  className="text-[10px] text-zinc-500 hover:text-indigo-400 font-mono shrink-0 transition-colors duration-100"
                >
                  /
                </button>
                {pathSegments.map((seg, i) => (
                  <React.Fragment key={i}>
                    <ChevronRight size={8} className="text-zinc-700 shrink-0" />
                    <button 
                      onClick={() => loadDirs('/' + pathSegments.slice(0, i + 1).join('/'))}
                      className={`text-[10px] font-mono shrink-0 transition-colors duration-100 ${
                        i === pathSegments.length - 1 
                          ? 'text-indigo-400 font-semibold' 
                          : 'text-zinc-500 hover:text-indigo-400'
                      }`}
                    >
                      {seg}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            )}
            {activeTab === 'cloud' && (
              <p className="text-[10px] text-zinc-500 mt-1">Link a cloud workspace for sync &amp; collaboration</p>
            )}
          </div>
          <button 
            onClick={onClose} 
            className="p-1.5 rounded-lg hover:bg-zinc-800/60 text-zinc-500 hover:text-zinc-300 transition-all duration-150 active:scale-90 ml-3 shrink-0"
          >
            <X size={14} />
          </button>
        </div>

        {/* Tab bar — always visible now (Recent + Local, optionally Cloud) */}
        <div className="flex items-center border-b border-zinc-800/30 bg-zinc-900/20">
          <button
            onClick={() => setActiveTab('recent')}
            className={`flex items-center gap-1.5 px-4 py-2 text-[11px] font-medium transition-all border-b-2 ${
              activeTab === 'recent'
                ? 'text-indigo-400 border-indigo-500'
                : 'text-zinc-500 border-transparent hover:text-zinc-300 hover:border-zinc-700'
            }`}
          >
            <Clock size={12} />
            Recent
          </button>
          <button
            onClick={() => setActiveTab('local')}
            className={`flex items-center gap-1.5 px-4 py-2 text-[11px] font-medium transition-all border-b-2 ${
              activeTab === 'local'
                ? 'text-indigo-400 border-indigo-500'
                : 'text-zinc-500 border-transparent hover:text-zinc-300 hover:border-zinc-700'
            }`}
          >
            <Folder size={12} />
            Browse
          </button>
          {showCloudTab && (
            <button
              onClick={() => setActiveTab('cloud')}
              className={`flex items-center gap-1.5 px-4 py-2 text-[11px] font-medium transition-all border-b-2 ${
                activeTab === 'cloud'
                  ? 'text-indigo-400 border-indigo-500'
                  : 'text-zinc-500 border-transparent hover:text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <Cloud size={12} />
              Cloud
              {cloud.linkedWorkspace && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.5)]" />
              )}
            </button>
          )}
        </div>

        {/* ── RECENT TAB ── */}
        {activeTab === 'recent' && (
          <>
            {/* History header bar */}
            <div className="flex items-center gap-2 px-5 py-2 border-b border-zinc-800/20 bg-zinc-900/10">
              <Clock size={12} className="text-zinc-500" />
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em]">
                Recent Workspaces
              </span>
              <div className="flex-1" />
              {wsHistory.history.length > 0 && (
                <button
                  onClick={() => wsHistory.clear()}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[9px] text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Clear all history"
                >
                  <Trash2 size={10} />
                  Clear
                </button>
              )}
              <button
                onClick={() => wsHistory.refresh()}
                className="p-1 rounded text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/60 transition-colors"
                title="Refresh"
              >
                <RefreshCw size={11} />
              </button>
            </div>

            {/* History list */}
            <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[400px] custom-scrollbar py-1">
              {wsHistory.loading && (
                <div className="flex flex-col items-center justify-center py-12 gap-2 animate-fade-in">
                  <Loader2 size={16} className="animate-spin text-indigo-400/50" />
                  <span className="text-[10px] text-zinc-600 font-medium">Loading...</span>
                </div>
              )}

              {!wsHistory.loading && wsHistory.history.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 gap-2 animate-fade-in">
                  <Clock size={24} className="text-zinc-700" />
                  <span className="text-[11px] text-zinc-600">No workspace history yet</span>
                  <span className="text-[10px] text-zinc-700">Open a workspace to start building your history</span>
                </div>
              )}

              {!wsHistory.loading && wsHistory.history.map((entry, idx) => {
                const isCurrent = currentPath && entry.path === currentPath;
                return (
                  <div
                    key={entry.path}
                    className={`flex items-center gap-2.5 w-full text-left px-5 py-2.5 transition-all duration-100 group animate-fade-in ${
                      isCurrent ? 'bg-indigo-500/5' : 'hover:bg-zinc-800/30'
                    }`}
                    style={{ animationDelay: `${idx * 0.02}s` }}
                  >
                    <button
                      className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                      onClick={() => handleSelectFromHistory(entry.path)}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        isCurrent
                          ? 'bg-indigo-500/15 border border-indigo-500/30'
                          : 'bg-zinc-800/50 border border-zinc-700/30 group-hover:border-indigo-500/30'
                      }`}>
                        <FolderOpen size={14} className={isCurrent ? 'text-indigo-400' : 'text-amber-500/60 group-hover:text-indigo-400'} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[12px] font-medium truncate ${
                          isCurrent ? 'text-indigo-300' : 'text-zinc-300 group-hover:text-zinc-100'
                        }`}>
                          {entry.name}
                        </p>
                        <p className="text-[10px] text-zinc-600 truncate font-mono">
                          {entry.path}
                        </p>
                      </div>
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[9px] text-zinc-600 tabular-nums whitespace-nowrap">
                        {formatRelativeTime(entry.lastOpened)}
                      </span>
                      {isCurrent ? (
                        <span className="text-[9px] text-indigo-400 font-bold uppercase tracking-wider bg-indigo-500/10 px-2 py-0.5 rounded">
                          Current
                        </span>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            wsHistory.remove(entry.path);
                          }}
                          className="p-1 rounded text-zinc-700 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                          title="Remove from history"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Recent footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800/40 bg-zinc-900/10 rounded-b-2xl">
              <span className="text-[10px] text-zinc-600 tabular-nums">
                {wsHistory.history.length} workspace{wsHistory.history.length !== 1 ? 's' : ''} in history
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-[10px] font-medium text-zinc-400 rounded-lg hover:bg-zinc-800/50 transition-all duration-150"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setActiveTab('local')}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-[10px] font-bold text-white rounded-lg bg-indigo-600 hover:bg-indigo-500 transition-all duration-150 shadow-lg shadow-indigo-600/20 active:scale-95"
                >
                  <Folder size={11} />
                  Browse...
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── LOCAL TAB ── */}
        {activeTab === 'local' && (
          <>
            {/* Navigation bar */}
            <div className="flex items-center gap-2 px-5 py-2 border-b border-zinc-800/20 bg-zinc-900/10">
              <button
                onClick={goUp}
                disabled={browsePath === '/'}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold rounded-lg bg-zinc-800/30 hover:bg-zinc-700/30 text-zinc-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150 active:scale-95 border border-zinc-800/30"
              >
                <ArrowUp size={11} />
                Up
              </button>
              <div className="flex-1" />
              <span className="text-[9px] text-zinc-600 tabular-nums">{dirs.length} items</span>
            </div>

            {/* Directory list */}
            <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[400px] custom-scrollbar">
              {loading && (
                <div className="flex flex-col items-center justify-center py-12 gap-2 animate-fade-in">
                  <Loader2 size={16} className="animate-spin text-indigo-400/50" />
                  <span className="text-[10px] text-zinc-600 font-medium">Loading...</span>
                </div>
              )}

              {error && (
                <div className="flex items-center justify-center py-12 animate-fade-in">
                  <span className="text-xs text-red-400/80">{error}</span>
                </div>
              )}

              {!loading && !error && dirs.length === 0 && (
                <div className="flex items-center justify-center py-12 animate-fade-in">
                  <span className="text-[11px] text-zinc-600 italic">No subdirectories</span>
                </div>
              )}

              {!loading && !error && dirs.map((dir, idx) => (
                <button
                  key={dir}
                  onClick={() => navigateInto(dir)}
                  className="flex items-center gap-2.5 w-full text-left px-5 py-2.5 hover:bg-zinc-800/30 transition-all duration-100 group animate-fade-in"
                  style={{ animationDelay: `${idx * 0.015}s` }}
                >
                  <Folder size={14} className="text-amber-500/50 shrink-0 group-hover:hidden transition-opacity duration-100" />
                  <FolderOpen size={14} className="text-amber-500/60 shrink-0 hidden group-hover:block transition-opacity duration-100" />
                  <span className="text-[12px] text-zinc-400 group-hover:text-zinc-200 truncate transition-colors duration-100">{dir}</span>
                  <ChevronRight size={11} className="ml-auto text-zinc-800 group-hover:text-zinc-600 shrink-0 transition-colors duration-100" />
                </button>
              ))}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800/40 bg-zinc-900/10 rounded-b-2xl">
              <span className="text-[10px] text-zinc-600 font-mono truncate max-w-[220px]">
                {browsePath}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCreateFolder}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800/50 transition-all duration-150 active:scale-95 border border-zinc-800/30"
                  title="Create New Folder"
                >
                  <Plus size={11} />
                  <span className="hidden sm:inline">New Folder</span>
                </button>
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-[10px] font-medium text-zinc-400 rounded-lg hover:bg-zinc-800/50 transition-all duration-150"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSelect}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-[10px] font-bold text-white rounded-lg bg-indigo-600 hover:bg-indigo-500 transition-all duration-150 shadow-lg shadow-indigo-600/20 active:scale-95"
                >
                  <Check size={11} />
                  Select
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── CLOUD TAB ── */}
        {activeTab === 'cloud' && (
          <>
            {/* Cloud workspace header */}
            <div className="flex items-center gap-2 px-5 py-2 border-b border-zinc-800/20 bg-zinc-900/10">
              <Cloud size={12} className="text-zinc-500" />
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em]">
                {cloud.org?.name || 'Cloud'} Workspaces
              </span>
              <div className="flex-1" />
              <button
                onClick={() => cloud.listWorkspaces()}
                className="p-1 rounded text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/60 transition-colors"
                title="Refresh"
              >
                <RefreshCw size={11} />
              </button>
            </div>

            {/* Currently linked workspace */}
            {cloud.linkedWorkspace && (
              <div className="mx-5 mt-3 flex items-center gap-2 p-2.5 bg-blue-500/5 border border-blue-500/15 rounded-lg">
                <Link size={13} className="text-blue-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-blue-300 truncate">
                    {cloud.linkedWorkspace.name || cloud.linkedWorkspace.id}
                  </p>
                  <p className="text-[10px] text-zinc-500">
                    {cloud.syncState === 'synced' ? '✓ Linked & synced' : cloud.syncState === 'syncing' ? '↻ Syncing...' : 'Currently linked'}
                  </p>
                </div>
                <button
                  onClick={() => cloud.unlinkWorkspace()}
                  className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                  title="Unlink workspace"
                >
                  <Unlink size={12} />
                </button>
              </div>
            )}

            {/* Cloud workspace list */}
            <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[400px] custom-scrollbar py-2">
              {cloud.workspaces.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <Cloud size={24} className="text-zinc-700" />
                  <span className="text-[11px] text-zinc-600">No cloud workspaces found</span>
                  <span className="text-[10px] text-zinc-700">Create one in Settings → Cloud</span>
                </div>
              ) : (
                cloud.workspaces.map((ws) => {
                  const isLinked = cloud.linkedWorkspace?.id === ws.id;
                  const isSelected = selectedCloudWs === ws.id;
                  return (
                    <button
                      key={ws.id}
                      onClick={() => setSelectedCloudWs(ws.id)}
                      className={`flex items-center gap-2.5 w-full text-left px-5 py-3 transition-all duration-100 group ${
                        isLinked
                          ? 'bg-blue-500/5'
                          : isSelected
                          ? 'bg-indigo-500/10 border-l-2 border-indigo-500'
                          : 'hover:bg-zinc-800/30'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        isLinked 
                          ? 'bg-blue-500/15 border border-blue-500/20' 
                          : isSelected
                          ? 'bg-indigo-500/15 border border-indigo-500/30'
                          : 'bg-zinc-800/50 border border-zinc-700/30 group-hover:border-indigo-500/30'
                      }`}>
                        <Cloud size={14} className={isLinked ? 'text-blue-400' : isSelected ? 'text-indigo-400' : 'text-zinc-500 group-hover:text-indigo-400'} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[12px] font-medium truncate ${
                          isLinked ? 'text-blue-300' : isSelected ? 'text-indigo-300' : 'text-zinc-300'
                        }`}>
                          {ws.name}
                        </p>
                        <p className="text-[10px] text-zinc-600">
                          {ws.slug} · {ws.status || 'idle'}
                        </p>
                      </div>
                      {isLinked ? (
                        <span className="text-[9px] text-blue-400 font-bold uppercase tracking-wider bg-blue-500/10 px-2 py-0.5 rounded">
                          Linked
                        </span>
                      ) : isSelected ? (
                        <Check size={12} className="text-indigo-400 shrink-0" />
                      ) : (
                        <Link size={12} className="text-zinc-700 group-hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-all shrink-0" />
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* Cloud footer — matches local tab layout */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800/40 bg-zinc-900/10 rounded-b-2xl">
              <span className="text-[10px] text-zinc-600 truncate max-w-[220px]">
                {selectedCloudWs
                  ? cloud.workspaces.find(w => w.id === selectedCloudWs)?.name || 'Selected'
                  : `${cloud.workspaces.length} workspace${cloud.workspaces.length !== 1 ? 's' : ''}`
                }
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-[10px] font-medium text-zinc-400 rounded-lg hover:bg-zinc-800/50 transition-all duration-150"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSelectCloudWorkspace}
                  disabled={!selectedCloudWs}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-[10px] font-bold text-white rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 transition-all duration-150 shadow-lg shadow-indigo-600/20 active:scale-95"
                >
                  <Link size={11} />
                  Select
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DirectoryPicker;
