'use client';
import { useEffect, useState } from 'react';
const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:8000';
const KEY=process.env.NEXT_PUBLIC_ADMIN_API_KEY||'change-this-admin-key';
type Client={id:number;name:string;executive_name:string;company:string;industry:string;active:boolean};
export function ClientList({onOpen}:{onOpen:(id:number)=>void}){
 const [clients,setClients]=useState<Client[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
 async function load(){try{const r=await fetch(`${API}/api/clients`,{headers:{'X-Admin-Key':KEY}}); if(!r.ok) throw new Error(await r.text()); setClients(await r.json())}catch(e:any){setError(e.message)}finally{setLoading(false)}}
 useEffect(()=>{load()},[]);
 return <section><div className="flex items-center justify-between mb-5"><div><h2 className="text-xl font-bold">Clients</h2><p className="text-sm text-slate-500">Each client has independent settings and a separate voice agent.</p></div><button className="btn btn-secondary" onClick={load}>Refresh</button></div>
 {loading&&<div className="text-slate-400">Loading clients…</div>}{error&&<div className="card p-4 text-red-300">{error}<div className="text-xs mt-2">Set ADMIN_API_KEY in .env and the same value in ClientList.tsx for this MVP.</div></div>}
 <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{clients.map(c=><div key={c.id} className="card p-5"><div className="flex justify-between"><div><h3 className="text-lg font-bold">{c.name}</h3><p className="text-slate-400">{c.executive_name}</p></div><span className="text-xs px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-300">{c.active?'Active':'Inactive'}</span></div><div className="mt-5 text-sm text-slate-400">{c.company||'Company not set'} {c.industry&&`• ${c.industry}`}</div><div className="mt-5 grid grid-cols-2 gap-2"><button className="btn btn-secondary" onClick={()=>onOpen(c.id)}>Settings</button><button className="btn btn-primary" onClick={()=>onOpen(c.id)}>Talk to Agent</button></div></div>)}</div></section>
}
