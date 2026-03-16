/**
 * AlephNet Network Status — Sidebar widget.
 *
 * Shows connection status, node ID, and quick metrics.
 * Handles three states:
 *   1. Connected — shows live metrics
 *   2. Offline with identity — shows reconnect button
 *   3. Skill unavailable — shows install guidance
 *
 * Uses Surface Kit primitives available in plugin JSX scope.
 */

function NetworkStatus() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [connecting, setConnecting] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await surfaceApi.callTool('alephnet_status');
      if (res && res.error) {
        setError(res.error);
        setStatus(null);
      } else {
        setStatus(res);
        setError(null);
      }
    } catch (e) {
      setError(e.message || 'Unable to reach AlephNet');
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const connected = status?.running || false;
  const nodeId = status?.nodeId;
  const peers = status?.peers ?? 0;

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      await surfaceApi.callTool('alephnet_connect');
      await fetchStatus();
    } catch { /* ignore */ }
    setConnecting(false);
  }, [fetchStatus]);

  // State 3: Skill unavailable / error
  if (error) {
    return (
      <div className="px-3 py-2 space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500/60" />
          <span className="text-[11px] font-medium text-zinc-400">Unavailable</span>
        </div>
        <div className="text-[10px] text-zinc-600 leading-relaxed">
          {error.includes('skill') || error.includes('unavailable')
            ? 'AlephNet skill not installed. Install the alephnet-node skill to connect.'
            : error
          }
        </div>
        <button
          onClick={fetchStatus}
          className="w-full px-2 py-1 rounded text-[10px] text-zinc-500 bg-zinc-900/40 border border-zinc-800/30 hover:border-zinc-700/40 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // State 1: Connected
  if (connected && nodeId) {
    return (
      <div className="px-3 py-2 space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] font-medium text-zinc-300">Connected</span>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-[10px]">
            <span className="text-zinc-500">Node</span>
            <span className="text-zinc-400 font-mono">{nodeId.slice(0, 10)}...</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-zinc-500">Peers</span>
            <span className="text-zinc-400">{peers}</span>
          </div>
          {status?.wallet && (
            <div className="flex justify-between text-[10px]">
              <span className="text-zinc-500">Balance</span>
              <span className="text-zinc-400">{status.wallet.balance}ℵ</span>
            </div>
          )}
          {status?.wallet?.tier && (
            <div className="flex justify-between text-[10px]">
              <span className="text-zinc-500">Tier</span>
              <span className="text-zinc-400">{status.wallet.tier}</span>
            </div>
          )}
          {status?.social && (
            <div className="flex justify-between text-[10px]">
              <span className="text-zinc-500">Friends</span>
              <span className="text-zinc-400">{status.social.friends}</span>
            </div>
          )}
          {status?.messaging && status.messaging.unread > 0 && (
            <div className="flex justify-between text-[10px]">
              <span className="text-zinc-500">Unread</span>
              <span className="text-amber-400 font-medium">{status.messaging.unread}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // State 2: Offline (skill available but not connected)
  return (
    <div className="px-3 py-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-zinc-600" />
        <span className="text-[11px] font-medium text-zinc-400">Offline</span>
      </div>
      <div className="text-[10px] text-zinc-600">
        Not connected to the mesh network.
      </div>
      <button
        onClick={handleConnect}
        disabled={connecting}
        className="w-full px-2 py-1.5 rounded text-[10px] font-medium text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors disabled:opacity-50"
      >
        {connecting ? (
          <span className="flex items-center justify-center gap-1.5">
            <span className="w-3 h-3 border border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
            Connecting...
          </span>
        ) : (
          '🌐 Connect'
        )}
      </button>
    </div>
  );
}

export default NetworkStatus;
