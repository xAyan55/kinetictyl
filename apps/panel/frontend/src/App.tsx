import React, { useState, useEffect } from 'react';

interface User {
  id: number;
  username: string;
  email: string;
  role: string;
}

interface Server {
  id: string;
  name: string;
  type: string;
  version: string;
  port: number;
  status: string;
  ramLimit: number;
  diskLimit: number;
  address: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<'login' | 'dashboard' | 'server' | 'admin'>('login');
  const [servers, setServers] = useState<Server[]>([]);
  const [activeServer, setActiveServer] = useState<Server | null>(null);
  
  // Login form state
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // Console state
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [commandInput, setCommandInput] = useState('');
  const [socket, setSocket] = useState<WebSocket | null>(null);

  useEffect(() => {
    fetchMe();
  }, []);

  const fetchMe = async () => {
    try {
      const res = await fetch('/auth/me');
      const data = await res.json();
      if (data.success) {
        setUser(data.user);
        setView('dashboard');
        loadServers();
      }
    } catch {
      setView('login');
    }
  };

  const loadServers = async () => {
    try {
      const res = await fetch('/api/servers');
      const data = await res.json();
      if (data.success) {
        setServers(data.servers);
      }
    } catch (err) {
      console.error("Failed to load servers", err);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity, password })
      });
      const data = await res.json();
      if (data.success) {
        setUser(data.user);
        setView('dashboard');
        loadServers();
      } else {
        setAuthError(data.error || 'Login failed.');
      }
    } catch (err: any) {
      setAuthError('Connection failed.');
    }
  };

  const handleLogout = async () => {
    await fetch('/auth/logout', { method: 'POST' });
    setUser(null);
    setView('login');
  };

  const openServer = (server: Server) => {
    setActiveServer(server);
    setView('server');
    setConsoleLogs([]);

    // Open WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?uuid=${server.id}`);
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'console_output') {
          setConsoleLogs(prev => [...prev.slice(-400), data.args[0]]);
        }
      } catch (err) {
        console.error(err);
      }
    };

    setSocket(ws);
  };

  const sendPower = (action: string) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ event: 'power_action', args: [action] }));
    }
  };

  const sendCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim() || !socket) return;
    socket.send(JSON.stringify({ event: 'console_input', args: [commandInput] }));
    setCommandInput('');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header Navigation */}
      <header style={{ height: '60px', backgroundColor: '#131924', borderBottom: '1px solid #242f42', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '18px', fontWeight: '700', color: '#3b82f6', letterSpacing: '0.5px' }}>KINETICTYL</span>
          {user && (
            <nav style={{ display: 'flex', gap: '12px' }}>
              <button className="btn btn-secondary" onClick={() => setView('dashboard')}>Servers</button>
              {user.role === 'admin' && (
                <button className="btn btn-secondary" onClick={() => setView('admin')}>Admin Panel</button>
              )}
            </nav>
          )}
        </div>
        <div>
          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ color: '#9ca3af' }}>{user.username} ({user.role})</span>
              <button className="btn btn-secondary" onClick={handleLogout}>Logout</button>
            </div>
          ) : (
            <span style={{ color: '#9ca3af', fontSize: '13px' }}>v1.0.0 (No-Docker Native)</span>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main style={{ flex: 1, padding: '24px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
        {/* VIEW: LOGIN */}
        {view === 'login' && (
          <div style={{ maxWidth: '400px', margin: '80px auto' }} className="card">
            <h2 style={{ marginBottom: '20px', fontSize: '20px', fontWeight: '600' }}>Login to Panel</h2>
            {authError && <div style={{ color: '#ef4444', marginBottom: '16px', fontSize: '13px' }}>{authError}</div>}
            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: '#9ca3af' }}>Username or Email</label>
                <input className="input" type="text" value={identity} onChange={e => setIdentity(e.target.value)} required />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: '#9ca3af' }}>Password</label>
                <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
              </div>
              <button type="submit" className="btn btn-primary" style={{ marginTop: '8px' }}>Log In</button>
            </form>
          </div>
        )}

        {/* VIEW: DASHBOARD */}
        {view === 'dashboard' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h1 style={{ fontSize: '22px', fontWeight: '600' }}>Your Servers</h1>
            </div>
            {servers.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>
                No servers assigned yet — an administrator must provision one for your account.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
                {servers.map(server => (
                  <div key={server.id} className="card" style={{ cursor: 'pointer' }} onClick={() => openServer(server)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                      <div>
                        <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '4px' }}>{server.name}</h3>
                        <span style={{ fontSize: '12px', color: '#9ca3af' }}>{server.type} {server.version}</span>
                      </div>
                      <span className={`badge badge-${server.status}`}>{server.status}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#9ca3af', display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}>
                      <span>Address: {server.address}</span>
                      <span>RAM: {Math.floor(server.ramLimit / (1024 * 1024))} MB</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW: SERVER MANAGEMENT */}
        {view === 'server' && activeServer && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h1 style={{ fontSize: '22px', fontWeight: '600' }}>{activeServer.name}</h1>
                <span style={{ fontSize: '13px', color: '#9ca3af' }}>{activeServer.type} {activeServer.version} · {activeServer.address}</span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-success" onClick={() => sendPower('start')}>Start</button>
                <button className="btn btn-secondary" onClick={() => sendPower('stop')}>Stop</button>
                <button className="btn btn-danger" onClick={() => sendPower('kill')}>Kill</button>
              </div>
            </div>

            {/* Console Window */}
            <div className="card" style={{ backgroundColor: '#000000', padding: '16px', fontFamily: 'var(--font-mono)', minHeight: '400px', maxHeight: '500px', overflowY: 'auto', marginBottom: '16px' }}>
              {consoleLogs.length === 0 ? (
                <div style={{ color: '#6b7280' }}>Connected to server console. Output streams will appear here...</div>
              ) : (
                consoleLogs.map((log, i) => <div key={i} style={{ whiteSpace: 'pre-wrap', color: '#d1d5db', fontSize: '13px' }}>{log}</div>)
              )}
            </div>

            <form onSubmit={sendCommand} style={{ display: 'flex', gap: '8px' }}>
              <input className="input" type="text" placeholder="Type a console command..." value={commandInput} onChange={e => setCommandInput(e.target.value)} />
              <button type="submit" className="btn btn-primary">Send</button>
            </form>
          </div>
        )}

        {/* VIEW: ADMIN PANEL */}
        {view === 'admin' && (
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: '600', marginBottom: '20px' }}>Administration Panel</h1>
            <div className="card" style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>System Overview</h3>
              <p style={{ color: '#9ca3af', fontSize: '13px' }}>Kinetictyl is running in Docker-Free mode directly on OpenJDK runtime supervisor processes.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
