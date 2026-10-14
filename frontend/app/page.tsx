'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ClientList } from '../components/ClientList';
import { ClientWorkspace } from '../components/ClientWorkspace';

export default function Home() {
  const [activeClient, setActiveClient] = useState<{ id: number; tab: 'settings' | 'agent' } | null>(null);

  return (
    <main className="min-h-screen p-6 md:p-10">
      <header className="max-w-7xl mx-auto mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="text-sm text-violet-400 font-bold tracking-widest uppercase">EXECUTIVEMIND AI</div>
          <h1 className="text-3xl md:text-4xl font-black mt-1">Executive Voice Agent</h1>
          <p className="text-slate-400 mt-2">
            Build each client&apos;s digital executive and start an authorized voice conversation.
          </p>
        </div>

        {/* Global Navigation Switcher (when not in a specific client workspace) */}
        {!activeClient ? (
          <nav className="flex items-center gap-2 p-1.5 bg-[#0f1424] rounded-2xl border border-slate-800 shadow-xl self-start md:self-center">
            <Link
              id="nav-tab-clients"
              href="/"
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-violet-600 text-white shadow-md shadow-violet-950/50 transition-all"
            >
              <span>🏢</span>
              <span>Executive Clients</span>
            </Link>

            <Link
              id="nav-tab-voices"
              href="/voices"
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800/50 transition-all"
            >
              <span>🎙</span>
              <span>Voice Clones</span>
            </Link>
          </nav>
        ) : (
          <div className="hidden md:block text-xs text-slate-500">
            Workspace Mode • Executive Twin
          </div>
        )}
      </header>

      <div className="max-w-7xl mx-auto">
        {activeClient ? (
          <ClientWorkspace
            clientId={activeClient.id}
            initialTab={activeClient.tab}
            onBack={() => setActiveClient(null)}
          />
        ) : (
          <ClientList onOpen={(id, tab = 'settings') => setActiveClient({ id, tab })} />
        )}
      </div>
    </main>
  );
}
