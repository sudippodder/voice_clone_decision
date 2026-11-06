'use client';
import { useEffect, useState } from 'react';
import { SettingsPanel } from './SettingsPanel';
import { VoiceAgent } from './VoiceAgent';
import { ConversationHistory } from './ConversationHistory';
import { getApiUrl, getAdminKey } from '../utils/api';

export function ClientWorkspace({
  clientId,
  initialTab = 'settings',
  onBack,
}: {
  clientId: number;
  initialTab?: 'settings' | 'agent' | 'history';
  onBack: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<'settings' | 'agent' | 'history'>(initialTab);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      const r = await fetch(`${getApiUrl()}/api/clients/${clientId}`, {
        headers: { 'X-Admin-Key': getAdminKey() },
      });
      const json = await r.json();
      if (!r.ok || !json.client) throw new Error(json.detail || 'Failed to load client');
      setData(json);
    } catch (err: any) {
      setError(err.message || 'Error connecting to backend');
    }
  }

  useEffect(() => {
    load();
  }, [clientId]);

  if (error)
    return (
      <div className="card p-6 text-center">
        <p className="text-red-400 mb-4">{error}</p>
        <button className="btn btn-secondary mr-2" onClick={onBack}>
          ← Back
        </button>
        <button className="btn btn-primary" onClick={load}>
          Retry
        </button>
      </div>
    );

  if (!data || !data.client) return <div>Loading…</div>;

  return (
    <div>
      <button className="text-sm text-slate-400 hover:text-white mb-5" onClick={onBack}>
        ← Back to clients
      </button>

      <div className="card p-5 mb-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black">{data.client.name}</h2>
          <p className="text-slate-400">Digital executive: {data.client.executive_name}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            className={`btn ${tab === 'settings' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab('settings')}
          >
            Settings
          </button>
          <button
            className={`btn ${tab === 'agent' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab('agent')}
          >
            🎙 Talk to Agent
          </button>
          <button
            className={`btn ${tab === 'history' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab('history')}
          >
            📻 Call History & Recordings
          </button>
        </div>
      </div>

      {tab === 'settings' ? (
        <SettingsPanel data={data} onSaved={load} />
      ) : tab === 'history' ? (
        <ConversationHistory clientId={data.client.id} />
      ) : (
        <VoiceAgent data={data} />
      )}
    </div>
  );
}

