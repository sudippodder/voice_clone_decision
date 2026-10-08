'use client';

import { useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export type AuthUser = {
  username: string;
  name: string;
  role: string;
  email?: string;
  client_id?: number | null;
};

export function LoginScreen({
  onLoginSuccess,
}: {
  onLoginSuccess: (user: AuthUser) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!username.trim()) {
      setError('Username is required.');
      return;
    }
    if (!password) {
      setError('Password is required.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password: password,
        }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.detail || 'Authentication failed. Please verify your credentials.');
      }

      const data = await res.json();
      if (data.ok && data.user) {
        if (rememberMe) {
          localStorage.setItem('executive_auth_user', JSON.stringify(data.user));
          if (data.access_token) {
            localStorage.setItem('executive_auth_token', data.access_token);
          }
          if (data.admin_key) {
            localStorage.setItem('executive_admin_key', data.admin_key);
          }
        }
        onLoginSuccess(data.user);
      } else {
        throw new Error('Unexpected login response format.');
      }
    } catch (err: any) {
      setError(err.message || 'Login failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-slate-950">
      {/* Background Ambient Glows */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-violet-600/20 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-fuchsia-600/20 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-900/10 rounded-full blur-[100px] pointer-events-none"></div>

      <div className="w-full max-w-md relative z-10 animate-fade-in">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/30 text-violet-300 text-xs font-bold tracking-wider uppercase mb-3 shadow-inner">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            EXECUTIVEMIND AI • SECURE ACCESS
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">
            Executive Voice Portal
          </h1>
          <p className="text-sm text-slate-400 mt-2 max-w-sm mx-auto">
            Restricted access. Sign in to access your Executive Voice Twin, Digital Profile, and Autonomous Agent.
          </p>
        </div>

        {/* Login Box */}
        <div className="card p-7 bg-slate-900/90 backdrop-blur-xl border-violet-500/30 shadow-2xl shadow-violet-950/50">
          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs font-semibold flex items-start gap-2 animate-shake">
              <span className="text-base leading-none">⚠️</span>
              <span className="flex-1">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div>
              <label className="label text-xs font-bold text-slate-300">
                Account Username
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Enter username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input pl-10 text-sm bg-slate-950/80 border-slate-800 focus:border-violet-500"
                  required
                  autoFocus
                  autoComplete="username"
                />
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                  👤
                </span>
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="label text-xs font-bold text-slate-300 flex items-center justify-between">
                <span>Password</span>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-[11px] text-slate-400 hover:text-slate-200"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input pl-10 pr-10 text-sm bg-slate-950/80 border-slate-800 focus:border-violet-500 font-mono"
                  required
                  autoComplete="current-password"
                />
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                  🔒
                </span>
              </div>
            </div>

            {/* Options */}
            <div className="flex items-center justify-between text-xs pt-1">
              <label className="flex items-center gap-2 text-slate-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-slate-700 text-violet-600 focus:ring-violet-500 bg-slate-950"
                />
                <span>Remember session</span>
              </label>
              <span className="text-slate-500 text-[11px]">Authorized personnel only</span>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 active:scale-[0.99] transition shadow-lg shadow-violet-600/30 flex items-center justify-center gap-2 mt-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>Verifying Credentials…</span>
                </>
              ) : (
                <>
                  <span>🔐</span>
                  <span>Sign In to Executive Portal</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Security Footer Notice */}
        <div className="mt-6 text-center text-[11px] text-slate-500">
          Encrypted 256-bit TLS connection • Voice clone governance enabled
        </div>
      </div>
    </div>
  );
}
