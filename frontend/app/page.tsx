'use client';
import { useEffect, useState } from 'react';
import { ClientList } from '../components/ClientList';
import { ClientWorkspace } from '../components/ClientWorkspace';

export default function Home() {
  const [clientId, setClientId] = useState<number | null>(null);
  return <main className="min-h-screen p-6 md:p-10">
    <header className="max-w-7xl mx-auto mb-8 flex items-center justify-between">
      <div><div className="text-sm text-violet-400 font-bold tracking-widest">EXECUTIVEMIND AI</div><h1 className="text-3xl md:text-4xl font-black mt-1">Executive Voice Agent</h1><p className="text-slate-400 mt-2">Build each client's digital executive and start a voice conversation.</p></div>
      <div className="hidden md:block text-xs text-slate-500">MVP • Voice-first</div>
    </header>
    <div className="max-w-7xl mx-auto">{clientId ? <ClientWorkspace clientId={clientId} onBack={()=>setClientId(null)} /> : <ClientList onOpen={setClientId} />}</div>
  </main>
}
