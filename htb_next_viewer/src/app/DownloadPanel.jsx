'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { LogIn, LogOut, RefreshCw, Download, Square, CheckSquare, Search, Terminal, Loader } from 'lucide-react';

export default function DownloadPanel() {
  const [loginStatus, setLoginStatus] = useState('checking'); // checking | logged_in | browser_open | logged_out
  const [pathId, setPathId] = useState(null);
  const [modules, setModules] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [moduleSearch, setModuleSearch] = useState('');
  const [fetchingModules, setFetchingModules] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [downloadState, setDownloadState] = useState('idle'); // idle | running | done
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  const [logs, setLogs] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [saveImages, setSaveImages] = useState(true);
  const [forceRedownload, setForceRedownload] = useState(false);
  const [downloadDir, setDownloadDir] = useState('');
  const [moduleSource, setModuleSource] = useState('path'); // 'path' | 'dashboard'
  const pollRef = useRef(null);
  const logRef = useRef(null);

  const fetchModulesRef = useRef(null);

  const fetchModules = useCallback(async (source = 'path') => {
    setFetchingModules(true);
    setFetchError(null);
    try {
      const url = source === 'dashboard' ? '/api/auth/dashboard-modules' : '/api/path/modules';
      const res = await fetch(url);
      const data = await res.json();
      if (data.modules) {
        setModules(data.modules);
        setSelectedIds(new Set(data.modules.map(m => m.id)));
        setModuleSource(source);
        if (data.pathId) setPathId(data.pathId);
      } else {
        setFetchError(data.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      setFetchError(err.message);
    }
    setFetchingModules(false);
  }, []);

  fetchModulesRef.current = fetchModules;

  const checkStatus = useCallback(async (autoFetchOnCache = false) => {
    try {
      const res = await fetch('/api/auth/status');
      const data = await res.json();
      if (data.loggedIn) {
        setLoginStatus('logged_in');
        setPathId(data.pathId);
        if (autoFetchOnCache && data.hasModulesCache) fetchModulesRef.current?.();
        return true;
      } else if (data.browserOpen) {
        setLoginStatus('browser_open');
      } else {
        setLoginStatus('logged_out');
      }
    } catch {
      setLoginStatus('logged_out');
    }
    return false;
  }, []);

  // On mount: check status + load default download dir
  useEffect(() => {
    checkStatus().then(loggedIn => {
      if (loggedIn) fetchModules();
    });
    fetch('/api/download/dir').then(r => r.json()).then(d => setDownloadDir(d.dir)).catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [checkStatus, fetchModules]);

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const startLogin = async () => {
    setLoginStatus('browser_open');
    await fetch('/api/auth/login', { method: 'POST' });
    pollRef.current = setInterval(async () => {
      const res = await fetch('/api/auth/status').catch(() => null);
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (data.browserOpen) return; // browser encore ouvert, attendre
      clearInterval(pollRef.current);
      if (data.loggedIn) {
        setLoginStatus('logged_in');
        setPathId(data.pathId);
        fetchModulesRef.current?.();
      } else {
        setLoginStatus('logged_out');
      }
    }, 3000);
  };

  const loadPathModules = async () => {
    setFetchingModules(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/path/modules');
      const data = await res.json();
      if (data.modules) {
        setModules(data.modules);
        setSelectedIds(new Set(data.modules.map(m => m.id)));
        setModuleSource('path');
        if (data.pathId) setPathId(data.pathId);
        setFetchingModules(false);
        return;
      }
    } catch {}
    setFetchingModules(false);
    startLogin(); // pas de cache → lancer Chrome
  };

  const loadDashboardModules = async (force = false) => {
    setFetchError(null);
    const res = await fetch('/api/auth/dashboard-modules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    });
    const data = await res.json().catch(() => ({}));
    // Cache valide → charger directement sans browser
    if (data.status === 'cached') {
      fetchModulesRef.current?.('dashboard');
      return;
    }
    setLoginStatus('browser_open');
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const r = await fetch('/api/auth/status').catch(() => null);
      if (!r) return;
      const d = await r.json().catch(() => ({}));
      if (d.browserOpen) return;
      clearInterval(pollRef.current);
      setLoginStatus('logged_in');
      fetchModulesRef.current?.('dashboard');
    }, 3000);
  };

  const refreshPathModules = async () => {
    setLoginStatus('browser_open');
    setFetchError(null);
    await fetch('/api/auth/refresh-path-modules', { method: 'POST' });
    pollRef.current = setInterval(async () => {
      const res = await fetch('/api/auth/status').catch(() => null);
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (data.browserOpen) return; // browser encore ouvert, attendre
      clearInterval(pollRef.current);
      if (data.loggedIn) {
        setLoginStatus('logged_in');
        setPathId(data.pathId);
        fetchModulesRef.current?.();
      } else {
        setLoginStatus('logged_out');
      }
    }, 3000);
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setLoginStatus('logged_out');
    setModules([]);
    setSelectedIds(new Set());
    setPathId(null);
  };

  const toggleModule = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === filteredModules.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredModules.map(m => m.id)));
    }
  };

  const startDownload = async () => {
    const selected = modules.filter(m => selectedIds.has(m.id));
    if (!selected.length) return;

    setDownloadState('running');
    setLogs([]);
    setDownloadProgress({ current: 0, total: selected.length });

    const res = await fetch('/api/download/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modules: selected, saveImages, forceRedownload, downloadDir }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (const part of parts) {
        if (!part.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(part.slice(6));
          if (event.type === 'sessionId') setSessionId(event.sessionId);
          else if (event.type === 'log') setLogs(l => [...l, { module: event.module, line: event.line }]);
          else if (event.type === 'progress') setDownloadProgress({ current: event.current, total: event.total });
          else if (event.type === 'done') setDownloadState('done');
        } catch {}
      }
    }
  };

  const stopDownload = async () => {
    if (sessionId) await fetch('/api/download/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) });
    setDownloadState('idle');
  };

  const filteredModules = modules.filter(m => m.title.toLowerCase().includes(moduleSearch.toLowerCase()));
  const allFilteredSelected = filteredModules.length > 0 && filteredModules.every(m => selectedIds.has(m.id));

  return (
    <div className="dl-panel">
      {/* Auth section */}
      <div className="dl-section">
        <div className="dl-section-header">
          <span className="dl-section-title">Session</span>
          <div className="dl-status">
            {loginStatus === 'checking' && <><Loader size={14} className="dl-spin" /> Checking...</>}
            {loginStatus === 'logged_in' && <><span className="dl-dot green" /> Logged in {pathId && `-Path #${pathId}`}</>}
            {loginStatus === 'browser_open' && <><Loader size={14} className="dl-spin" /> Browser open -log in then wait...</>}
            {loginStatus === 'logged_out' && <><span className="dl-dot red" /> Not logged in</>}
          </div>
        </div>
        <div className="dl-actions">
          <button className={`dl-btn ${moduleSource === 'path' ? 'primary' : 'secondary'}`} onClick={loadPathModules} disabled={loginStatus === 'browser_open' || fetchingModules}>
            {loginStatus === 'browser_open' || fetchingModules ? <Loader size={14} className="dl-spin" /> : <LogIn size={14} />}
            {loginStatus === 'browser_open' ? 'Browser open...' : 'Load Path Modules'}
          </button>
          <button className={`dl-btn ${moduleSource === 'dashboard' ? 'primary' : 'secondary'}`} onClick={() => loadDashboardModules(false)} disabled={loginStatus === 'browser_open' || fetchingModules}>
            {fetchingModules ? <Loader size={14} className="dl-spin" /> : <LogIn size={14} />}
            Load Dashboard Modules
          </button>
          {loginStatus === 'logged_in' && (
            <button
              className="dl-btn secondary"
              onClick={() => moduleSource === 'dashboard' ? loadDashboardModules(true) : startLogin()}
              disabled={fetchingModules || loginStatus === 'browser_open'}
            >
              {fetchingModules ? <Loader size={14} className="dl-spin" /> : <RefreshCw size={14} />}
              {fetchingModules ? 'Loading...' : `Force Reload (${moduleSource === 'dashboard' ? 'Dashboard' : 'Path'})`}
            </button>
          )}
          {loginStatus === 'logged_in' && (
            <button className="dl-btn danger" onClick={logout}>
              <LogOut size={14} /> Logout
            </button>
          )}
        </div>
      </div>

      {fetchError && (
        <div className="dl-section" style={{ color: 'var(--color-red, #f87171)', fontSize: '13px' }}>
          {fetchError === 'session_expired' && '⚠ Session expirée -reconnecte-toi.'}
          {fetchError === 'no_path_id' && '⚠ Path ID introuvable -reconnecte-toi pour le re-détecter.'}
          {fetchError === 'no_cache' && (
            <span>
              ⚠ Modules pas encore en cache.{' '}
              <button className="dl-btn secondary" style={{fontSize:'12px',padding:'2px 8px'}} onClick={refreshPathModules}>
                Charger les modules du path
              </button>
            </span>
          )}
          {fetchError === 'rate_limited' && (
            <span>⚠ Cloudflare rate limit -attends quelques minutes puis clique sur <strong>Load Current Path Modules</strong>.</span>
          )}
          {!['session_expired','no_path_id','no_cache','rate_limited'].includes(fetchError) && `⚠ ${fetchError}`}
        </div>
      )}

      {/* Module list */}
      {modules.length > 0 && (
        <div className="dl-section dl-modules-section">
          <div className="dl-section-header">
            <span className="dl-section-title">{moduleSource === 'dashboard' ? 'Dashboard' : 'Path'} Modules ({selectedIds.size}/{modules.length} selected)</span>
            <div className="dl-search-wrap">
              <Search size={13} />
              <input
                className="dl-search"
                placeholder="Search..."
                value={moduleSearch}
                onChange={e => setModuleSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="dl-module-list">
            <label className="dl-module-item dl-select-all" onClick={toggleAll}>
              {allFilteredSelected ? <CheckSquare size={15} /> : <Square size={15} />}
              <span>Select all</span>
            </label>
            {filteredModules.map(m => (
              <label key={m.id} className="dl-module-item" onClick={() => toggleModule(m.id)}>
                {selectedIds.has(m.id) ? <CheckSquare size={15} /> : <Square size={15} />}
                <span>{m.title}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Controls */}
      {modules.length > 0 && (
        <div className="dl-section dl-controls">
          <div className="dl-dir-row">
            <span className="dl-dir-label">Save to:</span>
            <input
              className="dl-dir-input"
              value={downloadDir}
              onChange={e => setDownloadDir(e.target.value)}
              spellCheck={false}
            />
          </div>
          <label className="dl-checkbox-label">
            <input type="checkbox" checked={saveImages} onChange={e => setSaveImages(e.target.checked)} />
            Save images locally
          </label>
          <label className="dl-checkbox-label">
            <input type="checkbox" checked={forceRedownload} onChange={e => setForceRedownload(e.target.checked)} />
            Force re-download (ignore cache)
          </label>
          <div className="dl-actions">
            {downloadState !== 'running' ? (
              <button
                className="dl-btn primary dl-btn-big"
                onClick={startDownload}
                disabled={selectedIds.size === 0 || loginStatus !== 'logged_in'}
              >
                <Download size={16} /> Download Selected ({selectedIds.size})
              </button>
            ) : (
              <button className="dl-btn danger" onClick={stopDownload}>
                <Square size={14} /> Stop
              </button>
            )}
          </div>
          {downloadState === 'running' && (
            <div className="dl-progress-wrap">
              <div className="dl-progress-bar">
                <div
                  className="dl-progress-fill"
                  style={{ width: `${downloadProgress.total ? (downloadProgress.current / downloadProgress.total) * 100 : 0}%` }}
                />
              </div>
              <span className="dl-progress-label">{downloadProgress.current}/{downloadProgress.total}</span>
            </div>
          )}
          {downloadState === 'done' && <span className="dl-done-msg">✓ Download complete!</span>}
        </div>
      )}

      {/* Log terminal */}
      {logs.length > 0 && (
        <div className="dl-section dl-log-section">
          <div className="dl-section-header">
            <span className="dl-section-title"><Terminal size={14} /> Logs</span>
          </div>
          <div className="dl-log-terminal" ref={logRef}>
            {logs.map((entry, i) => (
              <div
                key={i}
                className={`dl-log-line ${entry.line.includes('[!]') || entry.line.includes('[✗]') ? 'err' : entry.line.includes('[✓]') || entry.line.includes('[+]') ? 'ok' : ''}`}
              >
                {entry.line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
