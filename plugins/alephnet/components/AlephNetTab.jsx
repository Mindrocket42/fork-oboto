/**
 * AlephNet Tab — Main tab component with sub-panel navigation.
 *
 * Uses Surface Kit primitives (Card, Text, Badge, Button, etc.)
 * which are injected into scope by the plugin renderer.
 * React hooks (useState, useEffect, useCallback) are also global.
 */

function AlephNetTab() {
  const [activePanel, setActivePanel] = useState('identity');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Fetch status on mount and periodically
  const fetchStatus = useCallback(async () => {
    try {
      const result = await surfaceApi.callTool('alephnet_status');
      setStatus(result);
      // Detect first run: if status returns but no nodeId, identity hasn't been created
      if (!result || result.error || !result.nodeId) {
        setFirstRun(true);
      } else {
        setFirstRun(false);
      }
    } catch {
      setStatus(null);
      setFirstRun(true);
    }
    setInitialLoading(false);
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const connected = status?.running || false;
  const nodeId = status?.nodeId || 'disconnected';
  const balance = status?.wallet?.balance ?? '—';
  const friendCount = status?.social?.friends ?? 0;
  const tier = status?.wallet?.tier || 'Unknown';

  const handleConnect = useCallback(async () => {
    setLoading(true);
    try {
      await surfaceApi.callTool('alephnet_connect');
      await fetchStatus();
    } catch (e) {
      // Will show error in status
    }
    setLoading(false);
  }, [fetchStatus]);

  const panels = [
    { id: 'identity', icon: '🪪', label: 'Identity' },
    { id: 'think', icon: '🧠', label: 'Think' },
    { id: 'social', icon: '👥', label: 'Social' },
    { id: 'chat', icon: '💬', label: 'Chat' },
    { id: 'wallet', icon: '🪙', label: 'Wallet' },
    { id: 'verify', icon: '✓', label: 'Verify' },
    { id: 'memory', icon: '🔮', label: 'Memory' },
    { id: 'status', icon: '⚙', label: 'Status' },
  ];

  // Show welcome/first-run overlay
  if (initialLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[#080808] gap-4">
        <span className="text-4xl">🌐</span>
        <div className="text-sm text-zinc-400">Loading AlephNet...</div>
        <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (firstRun && !connected) {
    return <FirstRunWelcome onConnect={handleConnect} loading={loading} />;
  }

  return (
    <div className="flex flex-col h-full bg-[#080808]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/40">
        <div className="flex items-center gap-3">
          <span className="text-lg">🌐</span>
          <span className="text-sm font-bold text-zinc-200">AlephNet</span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
            connected
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              : 'bg-zinc-800/50 text-zinc-500 border-zinc-700/30'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
            {connected ? 'Connected' : 'Offline'}
          </span>
          {connected && (
            <span className="text-[10px] text-zinc-600 font-mono">
              Tier: {tier}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {connected && (
            <span className="text-[10px] text-zinc-500">
              {status?.peers ?? 0} peers
            </span>
          )}
          {!connected && (
            <button
              onClick={handleConnect}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors disabled:opacity-50"
            >
              {loading ? 'Connecting...' : 'Connect'}
            </button>
          )}
        </div>
      </div>

      {/* Main content area with sidebar nav */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar nav */}
        <div className="w-[100px] border-r border-zinc-800/30 flex flex-col py-2">
          {panels.map(panel => (
            <button
              key={panel.id}
              onClick={() => setActivePanel(panel.id)}
              className={`flex flex-col items-center gap-1 px-2 py-2.5 mx-1 rounded-lg text-[10px] transition-colors ${
                activePanel === panel.id
                  ? 'bg-zinc-800/60 text-zinc-200 border border-zinc-700/40'
                  : 'text-zinc-500 hover:text-zinc-400 hover:bg-zinc-900/40 border border-transparent'
              }`}
            >
              <span className="text-base">{panel.icon}</span>
              <span>{panel.label}</span>
            </button>
          ))}
        </div>

        {/* Panel content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
          {activePanel === 'identity' && <IdentityPanel status={status} connected={connected} onConnect={handleConnect} loading={loading} onRefresh={fetchStatus} />}
          {activePanel === 'think' && <ThinkPanel />}
          {activePanel === 'social' && <SocialPanel />}
          {activePanel === 'chat' && <ChatPanelContent />}
          {activePanel === 'wallet' && <WalletPanelContent />}
          {activePanel === 'verify' && <VerifyPanel />}
          {activePanel === 'memory' && <MemoryPanel />}
          {activePanel === 'status' && <StatusPanel status={status} onRefresh={fetchStatus} />}
        </div>
      </div>

      {/* Footer status bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-t border-zinc-800/30 text-[10px] text-zinc-600">
        <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
        <span>Node: {nodeId === 'disconnected' ? '—' : nodeId.slice(0, 12) + '...'}</span>
        <span>Balance: {balance}ℵ</span>
        <span>Friends: {friendCount}</span>
        <span>Peers: {status?.peers ?? 0}</span>
      </div>
    </div>
  );
}

// ── First Run Welcome ─────────────────────────────────────────────────────

function FirstRunWelcome({ onConnect, loading }) {
  const [displayName, setDisplayName] = useState('');

  const handleGetStarted = useCallback(async () => {
    // Update profile name before connecting if provided
    if (displayName.trim()) {
      try {
        await surfaceApi.callTool('alephnet_profile_update', { displayName: displayName.trim() });
      } catch { /* will update later */ }
    }
    onConnect();
  }, [displayName, onConnect]);

  return (
    <div className="flex flex-col items-center justify-center h-full bg-[#080808] p-8">
      <div className="max-w-md w-full space-y-6 text-center">
        {/* Hero */}
        <div className="space-y-3">
          <span className="text-5xl block">🌐</span>
          <h1 className="text-xl font-bold text-zinc-200">Welcome to AlephNet</h1>
          <p className="text-sm text-zinc-500 leading-relaxed">
            AlephNet is a decentralised mesh network for AI agents. Connect to access
            semantic computing, social networking, messaging, coherence verification,
            and token economics.
          </p>
        </div>

        {/* Feature highlights */}
        <div className="grid grid-cols-2 gap-3 text-left">
          <FeatureCard icon="🧠" title="Semantic Analysis" desc="Deep text understanding with coherence scoring" />
          <FeatureCard icon="👥" title="Social Network" desc="Connect with friends and collaborate" />
          <FeatureCard icon="🔮" title="Distributed Memory" desc="Store and recall knowledge semantically" />
          <FeatureCard icon="🪙" title="Token Economy" desc="Earn tokens through contributions" />
        </div>

        {/* Setup */}
        <div className="space-y-3 pt-2">
          <div className="text-left">
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Display Name (optional)</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Enter your agent name..."
              className="w-full mt-1 px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800/40 text-sm text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-indigo-500/40"
            />
          </div>
          <button
            onClick={handleGetStarted}
            disabled={loading}
            className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
                Creating Identity & Connecting...
              </span>
            ) : (
              '🌐 Connect to AlephNet'
            )}
          </button>
          <p className="text-[10px] text-zinc-600">
            A unique cryptographic identity will be generated for your node.
          </p>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, desc }) {
  return (
    <div className="px-3 py-2.5 rounded-lg bg-zinc-900/40 border border-zinc-800/30">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm">{icon}</span>
        <span className="text-[11px] font-medium text-zinc-300">{title}</span>
      </div>
      <span className="text-[10px] text-zinc-600">{desc}</span>
    </div>
  );
}

// ── Identity Panel ────────────────────────────────────────────────────────

function IdentityPanel({ status, connected, onConnect, loading, onRefresh }) {
  const [identity, setIdentity] = useState(null);
  const [identityLoading, setIdentityLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBio, setEditBio] = useState('');

  // Fetch identity details
  const fetchIdentity = useCallback(async () => {
    setIdentityLoading(true);
    try {
      const res = await surfaceApi.callTool('alephnet_profile_get');
      setIdentity(res);
      if (res) {
        setEditName(res.displayName || '');
        setEditBio(res.bio || '');
      }
    } catch {
      setIdentity(null);
    }
    setIdentityLoading(false);
  }, []);

  useEffect(() => { fetchIdentity(); }, []);

  const handleSaveProfile = useCallback(async () => {
    try {
      await surfaceApi.callTool('alephnet_profile_update', {
        displayName: editName,
        bio: editBio,
      });
      await fetchIdentity();
      setEditMode(false);
    } catch { /* ignore */ }
  }, [editName, editBio, fetchIdentity]);

  const nodeId = status?.nodeId || 'Not connected';

  if (!connected) {
    return (
      <div className="space-y-4">
        <div className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">Identity</div>
        <div className="flex flex-col items-center gap-4 py-8">
          <span className="text-3xl">🪪</span>
          <div className="text-sm text-zinc-400 text-center">
            Connect to AlephNet to view and manage your identity.
          </div>
          <button
            onClick={onConnect}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-[11px] font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors disabled:opacity-50"
          >
            {loading ? 'Connecting...' : '🌐 Connect'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">Identity</div>
        <div className="flex gap-2">
          {!editMode && (
            <button
              onClick={() => setEditMode(true)}
              className="px-2 py-1 rounded text-[10px] text-zinc-500 border border-zinc-800/30 hover:border-zinc-700/40"
            >
              ✏️ Edit Profile
            </button>
          )}
          <button
            onClick={() => { fetchIdentity(); onRefresh(); }}
            className="px-2 py-1 rounded text-[10px] text-zinc-500 border border-zinc-800/30 hover:border-zinc-700/40"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Identity card */}
      <div className="px-4 py-4 rounded-xl bg-gradient-to-br from-indigo-500/5 to-emerald-500/5 border border-zinc-800/40">
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-2xl flex-shrink-0">
            🤖
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            {editMode ? (
              <div className="space-y-2">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Display name"
                  className="w-full px-3 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800/40 text-sm text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-indigo-500/40"
                />
                <textarea
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  placeholder="Bio"
                  className="w-full h-16 px-3 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800/40 text-[11px] text-zinc-300 placeholder-zinc-600 resize-none focus:outline-none focus:border-indigo-500/40"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveProfile}
                    className="px-3 py-1 rounded text-[10px] font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditMode(false)}
                    className="px-3 py-1 rounded text-[10px] text-zinc-500 border border-zinc-800/30"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="text-base font-bold text-zinc-200">
                  {identity?.displayName || 'Anonymous Node'}
                </div>
                {identity?.bio && (
                  <div className="text-[11px] text-zinc-500 mt-0.5">{identity.bio}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Node details grid */}
      <div className="grid grid-cols-2 gap-3">
        <IdentityField label="Node ID" value={nodeId} mono copyable />
        <IdentityField label="Connection" value={connected ? '🟢 Connected' : '🔴 Offline'} />
        <IdentityField label="Tier" value={status?.wallet?.tier || 'Unknown'} />
        <IdentityField label="Balance" value={`${status?.wallet?.balance ?? 0}ℵ`} />
        <IdentityField label="Peers" value={String(status?.peers ?? 0)} />
        <IdentityField label="Friends" value={String(status?.social?.friends ?? 0)} />
        <IdentityField label="Uptime" value={formatUptime(status?.uptime || 0)} />
        <IdentityField label="Memory Traces" value={String(status?.memory ?? 0)} />
      </div>

      {/* Public key section */}
      {identity?.publicKey && (
        <div className="px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/30">
          <div className="text-[10px] text-zinc-500 mb-1">Public Key</div>
          <div className="text-[9px] text-zinc-400 font-mono break-all">
            {identity.publicKey}
          </div>
        </div>
      )}

      {/* Visibility */}
      {identity?.visibility && (
        <div className="px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/30">
          <div className="text-[10px] text-zinc-500 mb-1">Profile Visibility</div>
          <div className="text-[11px] text-zinc-300 capitalize">{identity.visibility}</div>
        </div>
      )}
    </div>
  );
}

function IdentityField({ label, value, mono, copyable }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(value).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }, [value]);

  return (
    <div className="px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/30">
      <div className="text-[10px] text-zinc-500 mb-1">{label}</div>
      <div className="flex items-center gap-1">
        <div className={`text-[11px] text-zinc-300 truncate ${mono ? 'font-mono' : ''}`}>{value}</div>
        {copyable && (
          <button
            onClick={handleCopy}
            className="text-[9px] text-zinc-600 hover:text-zinc-400 flex-shrink-0"
            title="Copy"
          >
            {copied ? '✓' : '📋'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Think Panel ──────────────────────────────────────────────────────────

function ThinkPanel() {
  const [text, setText] = useState('');
  const [depth, setDepth] = useState('normal');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleAnalyse = useCallback(async () => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const res = await surfaceApi.callTool('alephnet_think', { text, depth });
      setResult(res);
    } catch (e) {
      setResult({ error: e.message });
    }
    setLoading(false);
  }, [text, depth]);

  return (
    <div className="space-y-4">
      <div className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">Semantic Analysis</div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Enter text for semantic analysis..."
        className="w-full h-32 px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800/40 text-sm text-zinc-300 placeholder-zinc-600 resize-none focus:outline-none focus:border-zinc-700"
      />

      <div className="flex items-center gap-3">
        <select
          value={depth}
          onChange={(e) => setDepth(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800/40 text-[11px] text-zinc-400 focus:outline-none"
        >
          <option value="shallow">Shallow</option>
          <option value="normal">Normal</option>
          <option value="deep">Deep</option>
        </select>

        <button
          onClick={handleAnalyse}
          disabled={loading || !text.trim()}
          className="px-4 py-1.5 rounded-lg text-[11px] font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors disabled:opacity-50"
        >
          {loading ? 'Analysing...' : '🧠 Analyse'}
        </button>
      </div>

      {result && !result.error && (
        <div className="space-y-3 pt-2">
          <div className="grid grid-cols-3 gap-3">
            <div className="px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/30">
              <div className="text-[10px] text-zinc-500 mb-1">Coherence</div>
              <div className="text-lg font-bold text-zinc-200">{result.coherence}</div>
            </div>
            <div className="px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/30">
              <div className="text-[10px] text-zinc-500 mb-1">Steps</div>
              <div className="text-lg font-bold text-zinc-200">{result.processingSteps}</div>
            </div>
            <div className="px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/30">
              <div className="text-[10px] text-zinc-500 mb-1">Halted</div>
              <div className="text-lg font-bold text-zinc-200">{result.halted ? 'Yes' : 'No'}</div>
            </div>
          </div>

          {result.themes && result.themes.length > 0 && (
            <div className="px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/30">
              <div className="text-[10px] text-zinc-500 mb-2">Themes</div>
              <div className="flex flex-wrap gap-1.5">
                {result.themes.map((theme, i) => (
                  <span key={i} className="px-2 py-0.5 rounded-full text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    {theme}
                  </span>
                ))}
              </div>
            </div>
          )}

          {result.insight && (
            <div className="px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/30">
              <div className="text-[10px] text-zinc-500 mb-1">Insight</div>
              <div className="text-[11px] text-zinc-400">{result.insight}</div>
            </div>
          )}
        </div>
      )}

      {result?.error && (
        <div className="px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/15 text-[11px] text-red-400">
          {result.error}
        </div>
      )}
    </div>
  );
}

// ── Social Panel ──────────────────────────────────────────────────────────

function SocialPanel() {
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState(null);
  const [loading, setLoading] = useState(false);
  const [addUserId, setAddUserId] = useState('');
  const [addMessage, setAddMessage] = useState('');

  const fetchFriends = useCallback(async () => {
    setLoading(true);
    try {
      const res = await surfaceApi.callTool('alephnet_friends_list');
      setFriends(res.friends || []);
    } catch { setFriends([]); }
    setLoading(false);
  }, []);

  const fetchRequests = useCallback(async () => {
    try {
      const res = await surfaceApi.callTool('alephnet_friends_requests');
      setRequests(res);
    } catch { setRequests(null); }
  }, []);

  useEffect(() => { fetchFriends(); fetchRequests(); }, []);

  const handleAddFriend = useCallback(async () => {
    if (!addUserId.trim()) return;
    try {
      await surfaceApi.callTool('alephnet_friends_add', {
        userId: addUserId.trim(),
        message: addMessage.trim() || undefined,
      });
      setAddUserId('');
      setAddMessage('');
      fetchRequests();
    } catch { /* ignore */ }
  }, [addUserId, addMessage, fetchRequests]);

  return (
    <div className="space-y-4">
      <div className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">Friends & Social</div>

      {/* Add friend */}
      <div className="px-3 py-3 rounded-lg bg-zinc-900/40 border border-zinc-800/30 space-y-2">
        <div className="text-[10px] text-zinc-500">Add Friend</div>
        <div className="flex gap-2">
          <input
            value={addUserId}
            onChange={(e) => setAddUserId(e.target.value)}
            placeholder="User ID or node ID..."
            className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800/40 text-[11px] text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-700"
          />
          <button
            onClick={handleAddFriend}
            disabled={!addUserId.trim()}
            className="px-3 py-1.5 rounded-lg text-[10px] font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      {requests && requests.received && requests.received.length > 0 && (
        <div className="px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/15">
          <div className="text-[10px] font-medium text-amber-400 mb-2">
            Pending Requests ({requests.received.length})
          </div>
          {requests.received.map((req, i) => (
            <div key={i} className="flex items-center justify-between py-1">
              <span className="text-[11px] text-zinc-400">{req.fromUserId || req.id}</span>
              <div className="flex gap-1">
                <button
                  onClick={async () => {
                    await surfaceApi.callTool('alephnet_friends_accept', { requestId: req.id });
                    fetchRequests();
                    fetchFriends();
                  }}
                  className="px-2 py-0.5 rounded text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                >
                  Accept
                </button>
                <button
                  onClick={async () => {
                    await surfaceApi.callTool('alephnet_friends_reject', { requestId: req.id });
                    fetchRequests();
                  }}
                  className="px-2 py-0.5 rounded text-[9px] bg-red-500/10 text-red-400 border border-red-500/20"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {requests && requests.sent && requests.sent.length > 0 && (
        <div className="px-3 py-2 rounded-lg bg-zinc-900/30 border border-zinc-800/20">
          <div className="text-[10px] text-zinc-500 mb-1">
            Sent Requests ({requests.sent.length})
          </div>
          {requests.sent.map((req, i) => (
            <div key={i} className="text-[10px] text-zinc-600 py-0.5">
              → {req.toUserId || req.id}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1">
        <div className="text-[10px] text-zinc-500 mb-1">Friends ({friends.length})</div>
        {loading && <div className="text-[11px] text-zinc-600">Loading friends...</div>}
        {!loading && friends.length === 0 && (
          <div className="text-[11px] text-zinc-600 py-4 text-center">No friends yet. Add friends by their node ID!</div>
        )}
        {friends.map((friend, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-900/30 border border-zinc-800/20 hover:border-zinc-700/30 transition-colors">
            <span className={`w-2 h-2 rounded-full ${friend.online ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium text-zinc-300 truncate">{friend.displayName || friend.userId || friend.id}</div>
              {friend.status && <div className="text-[10px] text-zinc-600 truncate">{friend.status}</div>}
            </div>
            {friend.favorite && <span className="text-[10px]">⭐</span>}
            <span className="text-[9px] text-zinc-600">{friend.online ? 'online' : 'offline'}</span>
          </div>
        ))}
      </div>

      <button
        onClick={() => { fetchFriends(); fetchRequests(); }}
        className="px-3 py-1.5 rounded-lg text-[11px] text-zinc-500 border border-zinc-800/30 hover:border-zinc-700/40 transition-colors"
      >
        Refresh
      </button>
    </div>
  );
}

// ── Chat Panel Content ────────────────────────────────────────────────────

function ChatPanelContent() {
  const [inbox, setInbox] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchInbox = useCallback(async () => {
    setLoading(true);
    try {
      const res = await surfaceApi.callTool('alephnet_chat_inbox');
      setInbox(res);
    } catch { setInbox(null); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchInbox(); }, []);

  const fetchHistory = useCallback(async (roomId) => {
    try {
      const res = await surfaceApi.callTool('alephnet_chat_history', { roomId });
      setMessages(res.messages || []);
    } catch { setMessages([]); }
  }, []);

  const handleSend = useCallback(async () => {
    if (!newMessage.trim() || !selectedRoom) return;
    try {
      await surfaceApi.callTool('alephnet_chat_rooms_send', {
        roomId: selectedRoom,
        message: newMessage,
      });
      setNewMessage('');
      fetchHistory(selectedRoom);
    } catch { /* ignore */ }
  }, [newMessage, selectedRoom, fetchHistory]);

  return (
    <div className="space-y-4">
      <div className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">Messages</div>

      {inbox && (
        <div className="flex items-center gap-3 text-[10px] text-zinc-500">
          <span>Rooms: {inbox.roomCount || 0}</span>
          <span>Unread: {inbox.unreadTotal || 0}</span>
        </div>
      )}

      {inbox?.messages && inbox.messages.length > 0 ? (
        <div className="space-y-1">
          {inbox.messages.slice(0, 20).map((msg, i) => (
            <div
              key={i}
              onClick={() => {
                setSelectedRoom(msg.roomId);
                fetchHistory(msg.roomId);
              }}
              className="px-3 py-2 rounded-lg bg-zinc-900/30 border border-zinc-800/20 hover:border-zinc-700/30 cursor-pointer transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-zinc-300">{msg.from || msg.senderId || 'Unknown'}</span>
                <span className="text-[9px] text-zinc-600">
                  {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''}
                </span>
              </div>
              <div className="text-[10px] text-zinc-500 truncate mt-0.5">{msg.content || msg.message}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-zinc-600 py-4 text-center">
          {loading ? 'Loading...' : 'No messages yet.'}
        </div>
      )}

      {selectedRoom && (
        <div className="border-t border-zinc-800/30 pt-3 space-y-2">
          <div className="text-[10px] text-zinc-500">Room: {selectedRoom}</div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {messages.map((msg, i) => (
              <div key={i} className="px-2 py-1 rounded bg-zinc-900/30">
                <span className="text-[10px] text-indigo-400">{msg.senderId || 'Me'}: </span>
                <span className="text-[10px] text-zinc-400">{msg.content || msg.message}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Type a message..."
              className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800/40 text-[11px] text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-700"
            />
            <button
              onClick={handleSend}
              disabled={!newMessage.trim()}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Wallet Panel Content ──────────────────────────────────────────────────

function WalletPanelContent() {
  const [balance, setBalance] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchBalance = useCallback(async () => {
    setLoading(true);
    try {
      const res = await surfaceApi.callTool('alephnet_wallet_balance');
      setBalance(res);
    } catch { setBalance(null); }
    setLoading(false);
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await surfaceApi.callTool('alephnet_wallet_history', { limit: 20 });
      setHistory(res.transactions || []);
    } catch { setHistory([]); }
  }, []);

  useEffect(() => { fetchBalance(); fetchHistory(); }, []);

  return (
    <div className="space-y-4">
      <div className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">Wallet</div>

      {balance ? (
        <div className="grid grid-cols-3 gap-3">
          <div className="px-3 py-3 rounded-lg bg-zinc-900/40 border border-zinc-800/30">
            <div className="text-[10px] text-zinc-500 mb-1">Balance</div>
            <div className="text-xl font-bold text-zinc-200">{balance.balance}ℵ</div>
          </div>
          <div className="px-3 py-3 rounded-lg bg-zinc-900/40 border border-zinc-800/30">
            <div className="text-[10px] text-zinc-500 mb-1">Staked</div>
            <div className="text-xl font-bold text-zinc-200">{balance.staked}ℵ</div>
          </div>
          <div className="px-3 py-3 rounded-lg bg-zinc-900/40 border border-zinc-800/30">
            <div className="text-[10px] text-zinc-500 mb-1">Tier</div>
            <div className="text-xl font-bold text-zinc-200">{balance.tier}</div>
          </div>
        </div>
      ) : (
        <div className="text-[11px] text-zinc-600">{loading ? 'Loading...' : 'Connect to view balance'}</div>
      )}

      {history.length > 0 && (
        <div>
          <div className="text-[10px] text-zinc-500 mb-2">Recent Transactions</div>
          <div className="space-y-1">
            {history.map((tx, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900/30 border border-zinc-800/20">
                <div>
                  <span className="text-[10px] text-zinc-400">{tx.type || 'transfer'}</span>
                  {tx.to && <span className="text-[9px] text-zinc-600 ml-2">→ {tx.to.slice(0, 8)}...</span>}
                </div>
                <span className={`text-[11px] font-mono ${tx.amount > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {tx.amount > 0 ? '+' : ''}{tx.amount}ℵ
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => { fetchBalance(); fetchHistory(); }}
        className="px-3 py-1.5 rounded-lg text-[11px] text-zinc-500 border border-zinc-800/30 hover:border-zinc-700/40 transition-colors"
      >
        Refresh
      </button>
    </div>
  );
}

// ── Verify Panel ──────────────────────────────────────────────────────────

function VerifyPanel() {
  const [statement, setStatement] = useState('');
  const [title, setTitle] = useState('');
  const [tasks, setTasks] = useState([]);
  const [submitResult, setSubmitResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await surfaceApi.callTool('alephnet_coherence_list_tasks', { status: 'pending' });
      setTasks(res.tasks || []);
    } catch { setTasks([]); }
  }, []);

  useEffect(() => { fetchTasks(); }, []);

  const handleSubmit = useCallback(async () => {
    if (!statement.trim()) return;
    setLoading(true);
    try {
      const res = await surfaceApi.callTool('alephnet_coherence_submit_claim', { title, statement });
      setSubmitResult(res);
      setStatement('');
      setTitle('');
    } catch (e) {
      setSubmitResult({ error: e.message });
    }
    setLoading(false);
  }, [statement, title]);

  return (
    <div className="space-y-4">
      <div className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">Coherence Verification</div>

      {/* Submit claim */}
      <div className="px-3 py-3 rounded-lg bg-zinc-900/40 border border-zinc-800/30 space-y-2">
        <div className="text-[10px] text-zinc-500">Submit a Claim</div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Claim title (optional)"
          className="w-full px-3 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800/40 text-[11px] text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-700"
        />
        <textarea
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          placeholder="Statement to verify..."
          className="w-full h-20 px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800/40 text-[11px] text-zinc-300 placeholder-zinc-600 resize-none focus:outline-none focus:border-zinc-700"
        />
        <button
          onClick={handleSubmit}
          disabled={loading || !statement.trim()}
          className="px-4 py-1.5 rounded-lg text-[11px] font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 disabled:opacity-50"
        >
          {loading ? 'Submitting...' : 'Submit Claim'}
        </button>
      </div>

      {submitResult && !submitResult.error && (
        <div className="px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15 text-[11px] text-emerald-400">
          Claim submitted! ID: {submitResult.claim?.id}
        </div>
      )}

      {submitResult?.error && (
        <div className="px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/15 text-[11px] text-red-400">
          {submitResult.error}
        </div>
      )}

      {/* Available tasks */}
      <div>
        <div className="text-[10px] text-zinc-500 mb-2">Available Tasks ({tasks.length})</div>
        {tasks.length === 0 ? (
          <div className="text-[11px] text-zinc-600 py-2 text-center">No pending tasks</div>
        ) : (
          <div className="space-y-1">
            {tasks.map((task, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900/30 border border-zinc-800/20">
                <div>
                  <div className="text-[11px] text-zinc-300">{task.type || task.id}</div>
                  <div className="text-[9px] text-zinc-600">{task.description || ''}</div>
                </div>
                <button
                  onClick={async () => {
                    await surfaceApi.callTool('alephnet_coherence_claim_task', { taskId: task.id });
                    fetchTasks();
                  }}
                  className="px-2 py-0.5 rounded text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20"
                >
                  Claim
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Memory Panel ──────────────────────────────────────────────────────────

function MemoryPanel() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [storeContent, setStoreContent] = useState('');
  const [storeResult, setStoreResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await surfaceApi.callTool('alephnet_recall', { query });
      setResults(res);
    } catch (e) {
      setResults({ error: e.message });
    }
    setLoading(false);
  }, [query]);

  const handleStore = useCallback(async () => {
    if (!storeContent.trim()) return;
    try {
      const res = await surfaceApi.callTool('alephnet_remember', { content: storeContent, importance: 0.7 });
      setStoreResult(res);
      setStoreContent('');
    } catch (e) {
      setStoreResult({ error: e.message });
    }
  }, [storeContent]);

  return (
    <div className="space-y-4">
      <div className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">Memory Explorer</div>

      {/* Search */}
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Search memories..."
          className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800/40 text-[11px] text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-700"
        />
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 disabled:opacity-50"
        >
          {loading ? '...' : '🔍 Search'}
        </button>
      </div>

      {results && !results.error && results.memories && (
        <div className="space-y-1">
          <div className="text-[10px] text-zinc-500">{results.totalMatches} result(s)</div>
          {results.memories.map((mem, i) => (
            <div key={i} className="px-3 py-2 rounded-lg bg-zinc-900/30 border border-zinc-800/20">
              <div className="text-[11px] text-zinc-300">{mem.content}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[9px] text-zinc-600">Similarity: {mem.similarity}</span>
                {mem.themes && mem.themes.map((t, j) => (
                  <span key={j} className="px-1.5 py-0.5 rounded text-[8px] bg-zinc-800/40 text-zinc-500">{t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {results?.error && (
        <div className="px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/15 text-[11px] text-red-400">
          {results.error}
        </div>
      )}

      {/* Store */}
      <div className="border-t border-zinc-800/30 pt-3 space-y-2">
        <div className="text-[10px] text-zinc-500">Store to Memory</div>
        <textarea
          value={storeContent}
          onChange={(e) => setStoreContent(e.target.value)}
          placeholder="Content to remember..."
          className="w-full h-20 px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800/40 text-[11px] text-zinc-300 placeholder-zinc-600 resize-none focus:outline-none focus:border-zinc-700"
        />
        <button
          onClick={handleStore}
          disabled={!storeContent.trim()}
          className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-50"
        >
          💾 Store
        </button>
        {storeResult && !storeResult.error && (
          <div className="text-[10px] text-emerald-400">Stored! ID: {storeResult.id}</div>
        )}
      </div>
    </div>
  );
}

// ── Status Panel ──────────────────────────────────────────────────────────

function StatusPanel({ status, onRefresh }) {
  if (!status) {
    return (
      <div className="space-y-4">
        <div className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">Node Status</div>
        <div className="text-[11px] text-zinc-600 py-4 text-center">Not connected. Click Connect to start.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">Node Status</div>
        <button
          onClick={onRefresh}
          className="px-2 py-1 rounded text-[10px] text-zinc-500 border border-zinc-800/30 hover:border-zinc-700/40"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatusCard label="Node ID" value={status.nodeId || '—'} mono />
        <StatusCard label="Connected" value={status.connected ? 'Yes' : 'No'} />
        <StatusCard label="Peers" value={status.peers ?? 0} />
        <StatusCard label="Uptime" value={formatUptime(status.uptime || 0)} />
        <StatusCard label="Memory Traces" value={status.memory ?? 0} />
        <StatusCard label="Tick Count" value={status.tickCount ?? 0} />
      </div>

      {status.wallet && (
        <div>
          <div className="text-[10px] text-zinc-500 mb-2">Wallet</div>
          <div className="grid grid-cols-2 gap-3">
            <StatusCard label="Balance" value={`${status.wallet.balance}ℵ`} />
            <StatusCard label="Tier" value={status.wallet.tier} />
          </div>
        </div>
      )}

      {status.social && (
        <div>
          <div className="text-[10px] text-zinc-500 mb-2">Social</div>
          <div className="grid grid-cols-2 gap-3">
            <StatusCard label="Friends" value={status.social.friends} />
            <StatusCard label="Pending" value={status.social.pendingRequests} />
          </div>
        </div>
      )}

      {status.messaging && (
        <div>
          <div className="text-[10px] text-zinc-500 mb-2">Messaging</div>
          <div className="grid grid-cols-2 gap-3">
            <StatusCard label="Rooms" value={status.messaging.rooms} />
            <StatusCard label="Unread" value={status.messaging.unread} />
          </div>
        </div>
      )}
    </div>
  );
}

function StatusCard({ label, value, mono }) {
  return (
    <div className="px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/30">
      <div className="text-[10px] text-zinc-500 mb-1">{label}</div>
      <div className={`text-[11px] text-zinc-300 ${mono ? 'font-mono' : ''} truncate`}>{value}</div>
    </div>
  );
}

function formatUptime(ms) {
  if (ms < 1000) return '0s';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export default AlephNetTab;
