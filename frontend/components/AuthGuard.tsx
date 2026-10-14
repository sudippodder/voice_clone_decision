'use client';

import React, { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const SESSION_KEY = 'exec_voice_agent_session';

interface SessionData {
  username: string;
  token: string;
  loginTime: number;
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  // Check saved session on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (saved) {
        const parsed: SessionData = JSON.parse(saved);
        if (parsed.username === 'admin') {
          setIsAuthenticated(true);
          return;
        }
      }
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
    setIsAuthenticated(false);
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setErrorMsg('Please enter both username and password.');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        if (rememberMe) {
          localStorage.setItem(
            SESSION_KEY,
            JSON.stringify({
              username: 'admin',
              token: data.token || 'admin-session',
              loginTime: Date.now(),
            })
          );
        } else {
          sessionStorage.setItem(
            SESSION_KEY,
            JSON.stringify({
              username: 'admin',
              token: data.token || 'admin-session',
              loginTime: Date.now(),
            })
          );
        }
        setIsAuthenticated(true);
        setErrorMsg('');
      } else {
        // Fallback check if backend call failed or was unauthenticated
        if (username.trim() === 'admin' && password === 'pass123') {
          localStorage.setItem(
            SESSION_KEY,
            JSON.stringify({
              username: 'admin',
              token: 'admin-fallback-token',
              loginTime: Date.now(),
            })
          );
          setIsAuthenticated(true);
          setErrorMsg('');
        } else {
          setErrorMsg(data.detail || 'Invalid username or password. Please use admin / pass123');
        }
      }
    } catch {
      // Local fallback in case backend is momentarily restarting
      if (username.trim() === 'admin' && password === 'pass123') {
        localStorage.setItem(
          SESSION_KEY,
          JSON.stringify({
            username: 'admin',
            token: 'admin-local-token',
            loginTime: Date.now(),
          })
        );
        setIsAuthenticated(true);
        setErrorMsg('');
      } else {
        setErrorMsg('Invalid username or password. Check credentials and retry.');
      }
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    setIsAuthenticated(false);
    setPassword('');
    setErrorMsg('');
  }

  // Initial checking state
  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-[#080b12] flex flex-col items-center justify-center p-6 text-center">
        <div className="relative flex items-center justify-center mb-5">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-violet-600 to-indigo-500 animate-pulse flex items-center justify-center text-2xl shadow-xl shadow-violet-900/40">
            🎙
          </div>
          <div className="absolute inset-0 rounded-2xl border-2 border-violet-500/40 animate-ping pointer-events-none" />
        </div>
        <div className="text-xs uppercase tracking-widest text-violet-400 font-bold mb-1">
          EXECUTIVEMIND AI
        </div>
        <div className="text-slate-400 text-sm">Verifying secure environment…</div>
      </div>
    );
  }

  // Login view
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#07090e] flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden">
        {/* Ambient lighting effects */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[350px] bg-violet-600/15 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-10 right-10 w-[300px] h-[300px] bg-indigo-600/10 rounded-full blur-[100px] pointer-events-none" />

        <div className="w-full max-w-md relative z-10">
          {/* Brand header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-950/60 border border-violet-500/30 text-[11px] font-bold text-violet-300 uppercase tracking-wider mb-4 shadow-inner">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              <span>Secure Gateway</span>
            </div>

            <div className="flex items-center justify-center gap-3 mb-2">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-700 flex items-center justify-center text-xl shadow-lg shadow-violet-950/60 border border-violet-400/30">
                🎙
              </div>
              <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                Executive Voice Agent
              </h1>
            </div>

            <p className="text-xs sm:text-sm text-slate-400 max-w-sm mx-auto">
              Authorized access portal for AI executive twins, voice cloning, and communication intelligence.
            </p>
          </div>

          {/* Login Card */}
          <div className="bg-[#0f1424]/90 backdrop-blur-xl border border-[#262f45] rounded-2xl p-6 sm:p-8 shadow-2xl shadow-black/80">

            {/* Error banner */}
            {errorMsg && (
              <div
                id="login-error-alert"
                className="mb-5 p-3 rounded-xl bg-rose-950/60 border border-rose-500/50 text-rose-200 text-xs flex items-center gap-2.5 animate-in fade-in duration-200"
              >
                <span className="text-base text-rose-400 font-bold shrink-0">⚠️</span>
                <div className="flex-1">{errorMsg}</div>
                <button
                  type="button"
                  onClick={() => setErrorMsg('')}
                  className="text-rose-400 hover:text-white font-bold text-xs"
                >
                  ✕
                </button>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="login-username" className="block text-xs font-bold text-slate-300 mb-2">
                  Username
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none z-10">
                    👤
                  </span>
                  <input
                    id="login-username"
                    type="text"
                    required
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter username"
                    style={{ paddingLeft: '42px' }}
                    className="input text-xs text-white bg-[#0b0f1a] border-[#293247] focus:border-violet-500"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="login-password" className="block text-xs font-bold text-slate-300 mb-2">
                  Password
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none z-10">
                    🔑
                  </span>
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    style={{ paddingLeft: '42px', paddingRight: '42px' }}
                    className="input text-xs text-white bg-[#0b0f1a] border-[#293247] focus:border-violet-500"
                  />
                  <button
                    type="button"
                    id="toggle-password"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-sm px-1 z-10 cursor-pointer"
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? '👁' : '👁‍🗨'}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 text-xs">
                <label className="flex items-center gap-2 cursor-pointer select-none text-slate-400 hover:text-slate-300">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-3.5 h-3.5 rounded bg-slate-900 border-slate-700 text-violet-600 focus:ring-0 cursor-pointer"
                  />
                  <span>Remember session</span>
                </label>
              </div>

              <button
                type="submit"
                id="btn-login-submit"
                disabled={loading}
                className="w-full mt-2 py-3 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-violet-950/60 transition-all flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
              >
                {loading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Authenticating…</span>
                  </>
                ) : (
                  <>
                    <span>Sign In to Console</span>
                    <span>→</span>
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-[#232a3e] text-center">
              <p className="text-[11px] text-slate-500 flex items-center justify-center gap-1.5">
                <span>🛡</span>
                <span>Protected by Executive Role-Based Authentication</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Authenticated state with unified Top Authentication Bar and children
  return (
    <div className="min-h-screen flex flex-col bg-[#080b12]">
      {/* Top Session Bar */}
      <div
        id="executive-auth-bar"
        className="bg-[#0c101c] border-b border-[#21293c] px-4 py-2 sm:px-8 flex items-center justify-between text-xs sticky top-0 z-50 backdrop-blur-md bg-opacity-95"
      >
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-slate-400 text-[11px] sm:text-xs">
            Logged in as <strong className="text-white font-semibold">admin</strong>
          </span>
          <span className="hidden sm:inline-block text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-violet-950/70 text-violet-300 border border-violet-600/30">
            System Admin
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 text-[11px] text-slate-400">
            <span>Executive Voice Platform</span>
            <span className="text-slate-600">•</span>
            <span className="text-emerald-400 font-medium">Session Active</span>
          </div>

          <button
            type="button"
            id="btn-logout"
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold bg-slate-800/80 hover:bg-rose-950/70 text-slate-300 hover:text-rose-200 border border-slate-700/60 hover:border-rose-700/50 transition-colors shadow-sm cursor-pointer"
            title="Log out and protect interface"
          >
            <span>⎋</span>
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* Main interface content */}
      <div className="flex-1">{children}</div>
    </div>
  );
}
