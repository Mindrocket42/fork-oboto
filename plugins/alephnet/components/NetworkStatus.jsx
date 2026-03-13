/**
 * AlephNet Network Status — Sidebar widget.
 *
 * Shows connection status, node ID, and quick metrics.
 * Uses Surface Kit primitives available in plugin JSX scope.
 */

function NetworkStatus() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await surfaceApi.callTool('alephnet_status');
        setStatus(res);
      } catch {
        setStatus(null);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const connected = status?.running || false;
  const nodeId = status?.nodeId;
  const peers = status?.peers ?? 0;

  return (
    <div className="px-3 py-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
        <span className="text-[11px] font-medium text-zinc-300">
          {connected ? 'Connected' : 'Offline'}
        </span>
      </div>

      {connected && nodeId && (
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
          {status?.social && (
            <div className="flex justify-between text-[10px]">
              <span className="text-zinc-500">Friends</span>
              <span className="text-zinc-400">{status.social.friends}</span>
            </div>
          )}
        </div>
      )}

      {!connected && (
        <button
          onClick={async () => {
            try {
              await surfaceApi.callTool('alephnet_connect');
            } catch { /* ignore */ }
          }}
          className="w-full px-2 py-1 rounded text-[10px] text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors"
        >
          Connect
        </button>
      )}
    </div>
  );
}
