import { useState, useEffect, useCallback } from 'react';
import { wsService } from '../services/wsService';

/** Shape of the persisted layout configuration */
export interface LayoutConfig {
  showHeader: boolean;
  showActivityBar: boolean;
  showSidebar: boolean;
  showStatusBar: boolean;
  showInputArea: boolean;
  showTabBar: boolean;
  sidebarWidth: number;
}

export function useUIState() {
  const [showGlobalPalette, setShowGlobalPalette] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDirPicker, setShowDirPicker] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [showTaskManager, setShowTaskManager] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [showTaskSidebar, setShowTaskSidebar] = useState(false);
  const [workspacePort, setWorkspacePort] = useState<number | null>(null);
  const [sandboxMode, setSandboxMode] = useState<'strict' | 'permissive'>('strict');

  // Layout visibility state (persisted via workspace state)
  const [showHeader, setShowHeader] = useState(true);
  const [showActivityBar, setShowActivityBar] = useState(true);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showStatusBar, setShowStatusBar] = useState(true);
  const [showInputArea, setShowInputArea] = useState(true);
  const [showTabBar, setShowTabBar] = useState(true);

  // Bulk setter: accepts a partial layout config, applies all provided values
  const setLayoutConfig = useCallback((config: Partial<LayoutConfig>) => {
    if (config.showHeader !== undefined) setShowHeader(config.showHeader);
    if (config.showActivityBar !== undefined) setShowActivityBar(config.showActivityBar);
    if (config.showSidebar !== undefined) setShowSidebar(config.showSidebar);
    if (config.showStatusBar !== undefined) setShowStatusBar(config.showStatusBar);
    if (config.showInputArea !== undefined) setShowInputArea(config.showInputArea);
    if (config.showTabBar !== undefined) setShowTabBar(config.showTabBar);
    if (config.sidebarWidth !== undefined) setSidebarWidth(config.sidebarWidth);
  }, []);

  // Getter: returns the current layout state as a LayoutConfig object
  const getLayoutConfig = useCallback((): LayoutConfig => ({
    showHeader,
    showActivityBar,
    showSidebar,
    showStatusBar,
    showInputArea,
    showTabBar,
    sidebarWidth,
  }), [showHeader, showActivityBar, showSidebar, showStatusBar, showInputArea, showTabBar, sidebarWidth]);

  // Sidebar resizing logic
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingSidebar) return;
      const newWidth = Math.max(240, Math.min(e.clientX, 600));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    if (isResizingSidebar) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar]);

  // Listen for LLM auth errors — automatically open the Secrets panel
  useEffect(() => {
    const unsubAuth = wsService.on('llm-auth-error', (payload: unknown) => {
      const p = payload as { errorMessage: string; context: string; suggestion: string };
      console.error('[LLM Auth Error]', p.suggestion || p.errorMessage);
      // Open the secrets panel so the user can configure API keys
      setShowSecrets(true);
    });

    // Listen for workspace server info
    const unsubServer = wsService.on('workspace:server-info', (payload: unknown) => {
      const p = payload as { port: number; sandboxMode?: 'strict' | 'permissive' };
      setWorkspacePort(p.port);
      if (p.sandboxMode) {
        setSandboxMode(p.sandboxMode);
      }
    });

    return () => {
      unsubAuth();
      unsubServer();
    };
  }, []);

  return {
    showGlobalPalette, setShowGlobalPalette,
    showSettings, setShowSettings,
    showDirPicker, setShowDirPicker,
    showShortcutsHelp, setShowShortcutsHelp,
    showTaskManager, setShowTaskManager,
    showTerminal, setShowTerminal,
    showSecrets, setShowSecrets,
    isLocked, setIsLocked,
    sidebarWidth, setSidebarWidth,
    isResizingSidebar, setIsResizingSidebar,
    showWizard, setShowWizard,
    showTaskSidebar, setShowTaskSidebar,
    workspacePort,
    sandboxMode,
    // Layout visibility
    showHeader, setShowHeader,
    showActivityBar, setShowActivityBar,
    showSidebar, setShowSidebar,
    showStatusBar, setShowStatusBar,
    showInputArea, setShowInputArea,
    showTabBar, setShowTabBar,
    setLayoutConfig,
    getLayoutConfig,
  };
}
