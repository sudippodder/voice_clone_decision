'use client';
import { useEffect, useState } from 'react';
import { SettingsPanel } from './SettingsPanel';
import { VoiceAgent } from './VoiceAgent';
const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:8000'; const KEY=process.env.NEXT_PUBLIC_ADMIN_API_KEY||'change-this-admin-key';
export function ClientWorkspace({
  clientId,
  onBack,
  initialTab = 'settings',
}: {
  clientId: number;
  onBack: () => void;
  initialTab?: 'settings' | 'agent';
}) {
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<'settings' | 'agent'>(initialTab);
 async function load(){const r=await fetch(`${API}/api/clients/${clientId}`,{headers:{'X-Admin-Key':KEY}}); setData(await r.json())}
 useEffect(()=>{load()},[clientId]); if(!data) return <div>Loading…</div>;
 return <div><button className="text-sm text-slate-400 hover:text-white mb-5" onClick={onBack}>← Back to clients</button><div className="card p-5 mb-5 flex flex-col md:flex-row md:items-center justify-between gap-4"><div><h2 className="text-2xl font-black">{data.client.name}</h2><p className="text-slate-400">Digital executive: {data.client.executive_name}</p></div><div className="flex gap-2"><button className={`btn ${tab==='settings'?'btn-primary':'btn-secondary'}`} onClick={()=>setTab('settings')}>Settings</button><button className={`btn ${tab==='agent'?'btn-primary':'btn-secondary'}`} onClick={()=>setTab('agent')}>🎙 Talk to Agent</button></div></div>{tab==='settings'?<SettingsPanel data={data} onSaved={load} onTalkToAgent={()=>setTab('agent')}/>:<VoiceAgent data={data} />}</div>
}
