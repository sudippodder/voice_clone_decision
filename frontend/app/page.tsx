'use client';

import { useEffect, useState } from 'react';
import { ClientList } from '../components/ClientList';
import { ClientWorkspace } from '../components/ClientWorkspace';
import { LoginScreen, AuthUser } from '../components/LoginScreen';

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);
  const [initialTab, setInitialTab] = useState<'settings' | 'agent'>('settings');

  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem('executive_auth_user');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.username) {
          setUser(parsed);
          // If shaun has a client_id, we can also default to it or let them view list
        }
      }
    } catch {
      localStorage.removeItem('executive_auth_user');
    }
  }, []);

  function handleOpenClient(id: number, tab: 'settings' | 'agent' = 'settings') {
    setClientId(id);
    setInitialTab(tab);
  }

  function handleLogout() {
    localStorage.removeItem('executive_auth_user');
    localStorage.removeItem('executive_auth_token');
    localStorage.removeItem('executive_admin_key');
    setUser(null);
    setClientId(null);
  }

  // Prevent flash before hydration
  if (!mounted) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500 text-sm">
        <span className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mr-2"></span>
        Loading Executive Portal…
      </div>
    );
  }

  // Full Section Login Protection
  if (!user) {
    return <LoginScreen onLoginSuccess={(u) => setUser(u)} />;
  }

  return (
    <main className="min-h-screen p-6 md:p-10 bg-slate-950 text-slate-100">
      <header className="max-w-7xl mx-auto mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800/80">
        <div>
          <div className="text-xs text-violet-400 font-bold tracking-widest uppercase flex items-center gap-2">
            <span>EXECUTIVEMIND AI</span>
            <span>•</span>
            <span className="text-slate-400 font-normal">ENTERPRISE VOICE AGENT</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-black mt-1 text-white tracking-tight">
            Executive Voice Agent
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            Digital executive voice twins, decision-making profiles, and autonomous conversational agents.
          </p>
        </div>

        {/* Authenticated User Toolbar */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="px-3.5 py-1.5 rounded-xl bg-slate-900 border border-violet-500/30 flex items-center gap-2 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-xs text-slate-300">
              Account: <strong className="text-white font-bold">{user.name}</strong>{' '}
              <span className="text-[10px] uppercase font-bold text-violet-400 px-1.5 py-0.5 rounded bg-violet-950/60 border border-violet-500/30 ml-1">
                {user.role}
              </span>
            </span>
          </div>

          {user.client_id && clientId !== user.client_id && (
            <button
              onClick={() => handleOpenClient(user.client_id!, 'settings')}
              className="btn btn-secondary text-xs flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800"
              title="Open Shaun's Profile"
            >
              <span>🏢</span> Shaun&apos;s Profile
            </button>
          )}

          <button
            onClick={handleLogout}
            className="btn btn-secondary text-xs hover:border-red-500/50 hover:text-red-300 flex items-center gap-1.5 bg-slate-900"
            title="Sign out of executive session"
          >
            <span>🚪</span> Sign Out
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto">
        {clientId ? (
          <ClientWorkspace
            clientId={clientId}
            onBack={() => setClientId(null)}
            initialTab={initialTab}
          />
        ) : (
          <ClientList onOpen={handleOpenClient} />
        )}
      </div>
    </main>
  );
}
