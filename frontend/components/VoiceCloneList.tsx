'use client';

import React, { useEffect, useMemo, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const KEY = process.env.NEXT_PUBLIC_ADMIN_API_KEY || 'change-this-admin-key';

export type VoiceCloneItem = {
  id: number;
  client_id: number;
  client_name: string;
  executive_name: string;
  company?: string;
  name: string;
  voice_id: string;
  provider: string;
  description?: string;
  consent_text?: string;
  sample_filename?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type ClientOption = {
  id: number;
  name: string;
  executive_name: string;
  company?: string;
};

export function VoiceCloneList({
  onOpenClient,
}: {
  onOpenClient: (clientId: number, tab?: 'settings' | 'agent') => void;
}) {
  const [voices, setVoices] = useState<VoiceCloneItem[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Search & Filter
  const [search, setSearch] = useState('');
  const [selectedClientFilter, setSelectedClientFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState<'upload' | 'existing'>('upload');
  const [editingVoice, setEditingVoice] = useState<VoiceCloneItem | null>(null);
  const [deletingVoice, setDeletingVoice] = useState<VoiceCloneItem | null>(null);

  // Form Fields
  const [formClientId, setFormClientId] = useState<number | ''>('');
  const [formName, setFormName] = useState('');
  const [formVoiceId, setFormVoiceId] = useState('');
  const [formProvider, setFormProvider] = useState('elevenlabs');
  const [formDescription, setFormDescription] = useState('');
  const [formConsent, setFormConsent] = useState(
    'I authorize this system to generate synthetic speech using my voice for my AI executive representative.'
  );
  const [formSetActive, setFormSetActive] = useState(true);
  const [formAudioFile, setFormAudioFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Voice Test / Audio Player
  const [testingVoiceId, setTestingVoiceId] = useState<string | null>(null);
  const [testPhrase, setTestPhrase] = useState(
    'Hello, this is an official digital voice test for our executive team.'
  );
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Toast Notification
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  };

  // Load voices and clients
  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [voicesRes, clientsRes] = await Promise.all([
        fetch(`${API}/api/voices`, { headers: { 'X-Admin-Key': KEY } }),
        fetch(`${API}/api/clients`, { headers: { 'X-Admin-Key': KEY } }),
      ]);

      if (!voicesRes.ok) throw new Error(await voicesRes.text());
      if (!clientsRes.ok) throw new Error(await clientsRes.text());

      const voicesData = await voicesRes.json();
      const clientsData = await clientsRes.json();

      setVoices(voicesData);
      setClients(clientsData);

      if (clientsData.length > 0 && formClientId === '') {
        setFormClientId(clientsData[0].id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load voice clones.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // Filtered voices
  const filteredVoices = useMemo(() => {
    return voices.filter((v) => {
      const q = search.trim().toLowerCase();
      const matchesSearch =
        q === '' ||
        v.name.toLowerCase().includes(q) ||
        v.voice_id.toLowerCase().includes(q) ||
        v.client_name.toLowerCase().includes(q) ||
        v.executive_name.toLowerCase().includes(q) ||
        (v.description && v.description.toLowerCase().includes(q)) ||
        v.provider.toLowerCase().includes(q);

      const matchesClient =
        selectedClientFilter === 'all' || v.client_id === Number(selectedClientFilter);

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && v.is_active) ||
        (statusFilter === 'inactive' && !v.is_active);

      return matchesSearch && matchesClient && matchesStatus;
    });
  }, [voices, search, selectedClientFilter, statusFilter]);

  const activeVoicesCount = useMemo(() => voices.filter((v) => v.is_active).length, [voices]);

  // Open Add Modal
  const openAddModal = (defaultClientId?: number) => {
    setFormClientId(defaultClientId || (clients[0] ? clients[0].id : ''));
    setFormName('');
    setFormVoiceId('');
    setFormProvider('elevenlabs');
    setFormDescription('');
    setFormConsent(
      'I authorize this system to generate synthetic speech using my voice for my AI executive representative.'
    );
    setFormSetActive(true);
    setFormAudioFile(null);
    setFormError('');
    setShowAddModal(true);
  };

  // Submit Add Voice
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!formClientId) {
      setFormError('Please select a client.');
      return;
    }

    if (addMode === 'upload') {
      if (!formAudioFile) {
        setFormError('Please select an audio recording file (.mp3, .wav, .webm, etc.).');
        return;
      }
      if (!formConsent.trim()) {
        setFormError('Voice authorization consent text is required.');
        return;
      }

      setSubmitting(true);
      try {
        const fd = new FormData();
        fd.append('client_id', String(formClientId));
        fd.append('name', formName.trim());
        fd.append('description', formDescription.trim());
        fd.append('consent_text', formConsent.trim());
        fd.append('set_active', String(formSetActive));
        fd.append('file', formAudioFile);

        const res = await fetch(`${API}/api/voices/clone`, {
          method: 'POST',
          headers: { 'X-Admin-Key': KEY },
          body: fd,
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.detail || 'Failed to clone voice.');
        }

        const newVoice = await res.json();
        setVoices((prev) => [newVoice, ...prev]);
        setShowAddModal(false);
        showToast(`Voice clone "${newVoice.name}" created successfully!`, 'success');
        loadData();
      } catch (err: any) {
        setFormError(err.message || 'Error cloning voice.');
      } finally {
        setSubmitting(false);
      }
    } else {
      // Existing Voice ID mode
      if (!formName.trim()) {
        setFormError('Please enter a voice name.');
        return;
      }
      if (!formVoiceId.trim()) {
        setFormError('Please enter the provider Voice ID.');
        return;
      }

      setSubmitting(true);
      try {
        const body = {
          client_id: Number(formClientId),
          name: formName.trim(),
          voice_id: formVoiceId.trim(),
          provider: formProvider.trim() || 'elevenlabs',
          description: formDescription.trim(),
          consent_text: formConsent.trim(),
          is_active: formSetActive,
        };

        const res = await fetch(`${API}/api/voices`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Key': KEY,
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.detail || 'Failed to register voice clone.');
        }

        const newVoice = await res.json();
        setVoices((prev) => [newVoice, ...prev]);
        setShowAddModal(false);
        showToast(`Voice "${newVoice.name}" added to client successfully!`, 'success');
        loadData();
      } catch (err: any) {
        setFormError(err.message || 'Error saving voice clone.');
      } finally {
        setSubmitting(false);
      }
    }
  };

  // Activate a Voice
  const handleActivate = async (voice: VoiceCloneItem) => {
    try {
      const res = await fetch(`${API}/api/voices/${voice.id}/activate`, {
        method: 'POST',
        headers: { 'X-Admin-Key': KEY },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to activate voice.');
      }

      setVoices((prev) =>
        prev.map((v) =>
          v.client_id === voice.client_id
            ? { ...v, is_active: v.id === voice.id }
            : v
        )
      );
      showToast(`"${voice.name}" is now the active voice for ${voice.client_name}!`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Error activating voice.', 'error');
    }
  };

  // Open Edit Modal
  const openEditModal = (voice: VoiceCloneItem) => {
    setEditingVoice(voice);
    setFormName(voice.name);
    setFormVoiceId(voice.voice_id);
    setFormProvider(voice.provider);
    setFormDescription(voice.description || '');
    setFormConsent(voice.consent_text || '');
    setFormSetActive(voice.is_active);
    setFormError('');
  };

  // Submit Edit Voice
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVoice) return;
    setFormError('');

    if (!formName.trim()) {
      setFormError('Voice name is required.');
      return;
    }
    if (!formVoiceId.trim()) {
      setFormError('Voice ID is required.');
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        name: formName.trim(),
        voice_id: formVoiceId.trim(),
        provider: formProvider.trim(),
        description: formDescription.trim(),
        consent_text: formConsent.trim(),
        is_active: formSetActive,
      };

      const res = await fetch(`${API}/api/voices/${editingVoice.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': KEY,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to update voice clone.');
      }

      const updated = await res.json();
      setVoices((prev) =>
        prev.map((v) => (v.id === updated.id ? { ...v, ...updated } : v))
      );
      setEditingVoice(null);
      showToast(`Voice "${updated.name}" updated!`, 'success');
      loadData();
    } catch (err: any) {
      setFormError(err.message || 'Error updating voice.');
    } finally {
      setSubmitting(false);
    }
  };

  // Delete Voice
  const handleDeleteSubmit = async () => {
    if (!deletingVoice) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/voices/${deletingVoice.id}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Key': KEY },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to delete voice.');
      }

      setVoices((prev) => prev.filter((v) => v.id !== deletingVoice.id));
      showToast(`Voice "${deletingVoice.name}" deleted.`, 'success');
      setDeletingVoice(null);
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Error deleting voice.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Test Voice Synthesis
  const handleTestVoice = async (voice: VoiceCloneItem) => {
    if (testingVoiceId === voice.voice_id) {
      setTestingVoiceId(null);
      setAudioUrl(null);
      return;
    }

    setTestingVoiceId(voice.voice_id);
    showToast(`Synthesizing test phrase with ${voice.name}…`, 'success');

    try {
      const phrase = `Hello, I am the executive AI representative for ${voice.executive_name}. Voice synthesis is fully operational.`;
      const res = await fetch(`${API}/api/voices/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': KEY,
        },
        body: JSON.stringify({
          voice_id: voice.voice_id,
          text: phrase,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Speech synthesis failed. Check ElevenLabs key and voice ID.');
      }

      const data = await res.json();
      const audioBlobUrl = `data:${data.mime_type || 'audio/mpeg'};base64,${data.audio_base64}`;
      setAudioUrl(audioBlobUrl);
      const audio = new Audio(audioBlobUrl);
      audio.play().catch(() => {});
    } catch (err: any) {
      showToast(err.message || 'Voice test failed.', 'error');
      setTestingVoiceId(null);
    }
  };

  // Copy Voice ID
  const copyVoiceId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    showToast('Voice ID copied to clipboard!', 'success');
    setTimeout(() => setCopiedId(null), 2500);
  };

  return (
    <section className="space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl border text-sm font-medium transition-all duration-300 animate-in fade-in slide-in-from-bottom-5 ${
            toast.type === 'success'
              ? 'bg-[#0f241a] border-emerald-500/40 text-emerald-200'
              : 'bg-[#290d14] border-rose-500/40 text-rose-200'
          }`}
        >
          <span>{toast.type === 'success' ? '✓' : '⚠'}</span>
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-2 text-slate-400 hover:text-white text-xs font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Header & Actions Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-black text-white tracking-tight">Voice Clone Library</h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 font-bold">
              {voices.length} {voices.length === 1 ? 'Voice' : 'Voices'}
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Manage authorized synthetic executive voices, test audio pronunciations, and assign voices to clients.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            className="btn btn-secondary flex items-center gap-2 text-xs py-2.5 px-4 hover:border-slate-500 transition-colors"
            onClick={loadData}
            title="Reload voice clones"
          >
            <span>↻</span>
            <span>Refresh</span>
          </button>
          <button
            id="btn-add-voice"
            className="btn btn-primary flex items-center gap-2 text-xs py-2.5 px-4 shadow-lg shadow-violet-900/30 hover:shadow-violet-900/50 transition-all font-bold"
            onClick={() => openAddModal()}
          >
            <span className="text-base leading-none font-bold">+</span>
            <span>Add Voice for Client</span>
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4 bg-[#0e1424] border-slate-800">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Total Clones</span>
          <div className="text-2xl font-black text-white mt-1">{voices.length}</div>
          <span className="text-[11px] text-slate-500 mt-0.5 block">Configured models</span>
        </div>

        <div className="card p-4 bg-[#0e1424] border-slate-800">
          <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider block">Active Twins</span>
          <div className="text-2xl font-black text-emerald-300 mt-1">{activeVoicesCount}</div>
          <span className="text-[11px] text-slate-500 mt-0.5 block">Live in agent chats</span>
        </div>

        <div className="card p-4 bg-[#0e1424] border-slate-800">
          <span className="text-[11px] font-bold text-violet-400 uppercase tracking-wider block">Clients Covered</span>
          <div className="text-2xl font-black text-violet-300 mt-1">
            {new Set(voices.map((v) => v.client_id)).size} / {clients.length}
          </div>
          <span className="text-[11px] text-slate-500 mt-0.5 block">Clients with voices</span>
        </div>

        <div className="card p-4 bg-[#0e1424] border-slate-800">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Provider</span>
          <div className="text-xl font-black text-white mt-1 flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-violet-400"></span>
            <span>ElevenLabs</span>
          </div>
          <span className="text-[11px] text-slate-500 mt-0.5 block">Multilingual v2</span>
        </div>
      </div>

      {/* Search & Filter Controls */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-[#0d1220]/70 p-3 rounded-2xl border border-slate-800/80">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
          {/* Keyword Search */}
          <div className="relative flex-1 max-w-sm">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
            <input
              type="text"
              className="input !py-2 !pl-10 !pr-8 text-xs bg-[#090d17] border-slate-700/60 focus:border-violet-500 placeholder-slate-500"
              placeholder="Search by voice name, ID, or executive..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Client Filter Dropdown */}
          <select
            className="input !py-2 !px-3 text-xs bg-[#090d17] border-slate-700/60 focus:border-violet-500 text-slate-200 max-w-[200px]"
            value={selectedClientFilter}
            onChange={(e) => setSelectedClientFilter(e.target.value)}
          >
            <option value="all">All Clients ({clients.length})</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.executive_name})
              </option>
            ))}
          </select>
        </div>

        {/* Status Filter Pills */}
        <div className="flex items-center gap-1.5 self-start md:self-center">
          <button
            onClick={() => setStatusFilter('all')}
            className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${
              statusFilter === 'all'
                ? 'bg-violet-600/30 text-violet-200 border border-violet-500/50'
                : 'text-slate-400 hover:text-white bg-slate-800/40 border border-transparent'
            }`}
          >
            All ({voices.length})
          </button>
          <button
            onClick={() => setStatusFilter('active')}
            className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${
              statusFilter === 'active'
                ? 'bg-emerald-600/30 text-emerald-200 border border-emerald-500/50'
                : 'text-slate-400 hover:text-white bg-slate-800/40 border border-transparent'
            }`}
          >
            Primary Active ({activeVoicesCount})
          </button>
          <button
            onClick={() => setStatusFilter('inactive')}
            className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${
              statusFilter === 'inactive'
                ? 'bg-amber-600/30 text-amber-200 border border-amber-500/50'
                : 'text-slate-400 hover:text-white bg-slate-800/40 border border-transparent'
            }`}
          >
            Secondary ({voices.length - activeVoicesCount})
          </button>
        </div>
      </div>

      {/* Loading & Error States */}
      {loading && (
        <div className="flex flex-col items-center justify-center p-16 text-slate-400 gap-3">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium">Loading voice clone library…</p>
        </div>
      )}

      {error && !loading && (
        <div className="card p-5 bg-[#251016] border-rose-900/60 text-rose-200 space-y-2">
          <div className="flex items-center gap-2 font-bold text-base text-rose-400">
            <span>⚠</span>
            <span>Unable to load voice clone data</span>
          </div>
          <p className="text-sm text-rose-300/90">{error}</p>
          <button
            onClick={loadData}
            className="btn btn-secondary !py-1 !px-3 text-xs text-white mt-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty State when no voices exist */}
      {!loading && !error && voices.length === 0 && (
        <div className="card p-12 text-center border-dashed border-slate-700/80 bg-[#0e1322]/50">
          <div className="w-16 h-16 rounded-2xl bg-violet-600/20 border border-violet-500/30 text-violet-300 flex items-center justify-center text-3xl mx-auto mb-4">
            🎙
          </div>
          <h3 className="text-lg font-bold text-white mb-2">No Voice Clones Yet</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto mb-6">
            Add authorized synthetic voices for your executive clients by uploading a short voice sample or linking an existing ElevenLabs Voice ID.
          </p>
          <button
            className="btn btn-primary inline-flex items-center gap-2 px-5 py-2.5 shadow-lg shadow-violet-900/40"
            onClick={() => openAddModal()}
          >
            <span>+</span>
            <span>Add First Voice Clone</span>
          </button>
        </div>
      )}

      {/* Empty State when filters return no result */}
      {!loading && !error && voices.length > 0 && filteredVoices.length === 0 && (
        <div className="card p-10 text-center bg-[#0e1322]/40 border-slate-800">
          <p className="text-slate-300 font-semibold mb-1">
            No voice clones match your current filters.
          </p>
          <p className="text-xs text-slate-500 mb-4">
            Try clearing search keywords or resetting client filters.
          </p>
          <button
            onClick={() => {
              setSearch('');
              setSelectedClientFilter('all');
              setStatusFilter('all');
            }}
            className="btn btn-secondary text-xs !py-1.5 !px-3"
          >
            Reset Filters
          </button>
        </div>
      )}

      {/* Voice Clones Grid */}
      {!loading && !error && filteredVoices.length > 0 && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredVoices.map((v) => {
            const isTesting = testingVoiceId === v.voice_id;

            return (
              <div
                key={v.id}
                className={`card p-6 flex flex-col justify-between transition-all duration-200 group bg-gradient-to-b from-[#111728] to-[#0c101d] shadow-lg border ${
                  v.is_active
                    ? 'border-emerald-500/30 shadow-emerald-950/10'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                <div>
                  {/* Top: Icon, Voice Name, and Status Badge */}
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0 border shadow-md ${
                          v.is_active
                            ? 'bg-gradient-to-br from-emerald-600/30 to-violet-600/40 border-emerald-500/40 text-emerald-200 shadow-emerald-950/40'
                            : 'bg-slate-800/80 border-slate-700/60 text-slate-400'
                        }`}
                      >
                        🎙
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base font-bold text-white truncate group-hover:text-violet-200 transition-colors">
                          {v.name}
                        </h3>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[11px] text-slate-400">Client:</span>
                          <button
                            onClick={() => onOpenClient(v.client_id, 'settings')}
                            className="text-[11px] text-violet-300 hover:text-white font-semibold underline underline-offset-2 truncate"
                            title="Open client workspace"
                          >
                            {v.client_name} ({v.executive_name})
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Active/Inactive Status Badge */}
                    <span
                      className={`text-[10px] px-2.5 py-1 rounded-full font-bold flex items-center gap-1.5 flex-shrink-0 border ${
                        v.is_active
                          ? 'bg-emerald-950/70 text-emerald-300 border-emerald-500/40'
                          : 'bg-slate-800/80 text-slate-400 border-slate-700/60'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          v.is_active ? 'bg-emerald-400 shadow-sm shadow-emerald-400 animate-pulse' : 'bg-slate-500'
                        }`}
                      />
                      <span>{v.is_active ? 'Active Twin' : 'Secondary'}</span>
                    </span>
                  </div>

                  {/* Voice Details */}
                  <div className="space-y-2 py-3 border-y border-slate-800/70 text-xs">
                    {/* Voice ID & Copy */}
                    <div className="flex items-center justify-between text-slate-300">
                      <span className="text-slate-500 font-medium">Voice ID</span>
                      <div className="flex items-center gap-1.5 max-w-[210px]">
                        <code className="text-[11px] font-mono bg-slate-900/90 px-2 py-0.5 rounded border border-slate-800 text-violet-300 truncate">
                          {v.voice_id}
                        </code>
                        <button
                          onClick={() => copyVoiceId(v.voice_id)}
                          className="text-[10px] text-slate-400 hover:text-white p-1 hover:bg-slate-800 rounded transition-colors"
                          title="Copy Voice ID"
                        >
                          {copiedId === v.voice_id ? '✓' : '📋'}
                        </button>
                      </div>
                    </div>

                    {/* Provider */}
                    <div className="flex items-center justify-between text-slate-300">
                      <span className="text-slate-500 font-medium">Provider</span>
                      <span className="font-semibold text-slate-200 capitalize">
                        {v.provider || 'ElevenLabs'}
                      </span>
                    </div>

                    {/* Description or Consent Snippet */}
                    {v.description && (
                      <div className="text-slate-400 text-[11px] pt-1 leading-relaxed">
                        <span className="text-slate-500 font-medium">Note:</span> {v.description}
                      </div>
                    )}

                    {v.sample_filename && (
                      <div className="flex items-center justify-between text-slate-400 text-[11px]">
                        <span className="text-slate-500 font-medium">Sample</span>
                        <span className="truncate max-w-[190px]">{v.sample_filename}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="mt-5 space-y-2.5">
                  {/* Primary Action Buttons: Test Voice & Activate */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className={`btn flex items-center justify-center gap-1.5 text-xs py-2 px-3 font-semibold transition-all ${
                        isTesting
                          ? 'bg-violet-900/50 text-violet-200 border border-violet-500/50 animate-pulse'
                          : 'btn-secondary hover:border-slate-500'
                      }`}
                      onClick={() => handleTestVoice(v)}
                    >
                      <span>{isTesting ? '■' : '▶'}</span>
                      <span>{isTesting ? 'Playing…' : 'Test Voice'}</span>
                    </button>

                    {v.is_active ? (
                      <button
                        className="btn btn-secondary flex items-center justify-center gap-1 text-xs py-2 px-3 font-semibold opacity-60 cursor-default"
                        disabled
                      >
                        <span>✓</span>
                        <span>Active Twin</span>
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary flex items-center justify-center gap-1 text-xs py-2 px-3 font-bold shadow-md shadow-violet-950/40"
                        onClick={() => handleActivate(v)}
                      >
                        <span>⚡</span>
                        <span>Set as Active</span>
                      </button>
                    )}
                  </div>

                  {/* Secondary Management Row: Edit & Delete */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/50">
                    <button
                      onClick={() => openEditModal(v)}
                      className="text-xs text-slate-400 hover:text-violet-300 flex items-center gap-1.5 py-1 px-2 rounded-lg hover:bg-violet-950/30 transition-colors font-medium"
                    >
                      <span>✎</span>
                      <span>Edit Info</span>
                    </button>

                    <button
                      onClick={() => setDeletingVoice(v)}
                      className="text-xs text-slate-400 hover:text-rose-400 flex items-center gap-1.5 py-1 px-2 rounded-lg hover:bg-rose-950/30 transition-colors font-medium"
                    >
                      <span>🗑</span>
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ========================================================================= */}
      {/* ADD VOICE MODAL */}
      {/* ========================================================================= */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="card max-w-xl w-full p-6 md:p-8 bg-[#111624] border border-[#2e374f] shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-800">
              <div>
                <span className="eyebrow">VOICE GENERATION</span>
                <h3 className="text-xl font-black text-white mt-1">Add Voice Clone for Client</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Create a new cloned voice using an audio sample, or register an existing ElevenLabs Voice ID.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="flex gap-2 p-1 bg-[#090d17] rounded-xl border border-slate-800 mt-4">
              <button
                id="tab-mode-upload"
                type="button"
                onClick={() => setAddMode('upload')}
                className={`flex-1 text-xs py-2 px-3 rounded-lg font-bold transition-all ${
                  addMode === 'upload'
                    ? 'bg-violet-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                🎙 Upload & Clone Sample
              </button>
              <button
                id="tab-mode-existing"
                type="button"
                onClick={() => setAddMode('existing')}
                className={`flex-1 text-xs py-2 px-3 rounded-lg font-bold transition-all ${
                  addMode === 'existing'
                    ? 'bg-violet-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                🔑 Link Existing Voice ID
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleAddSubmit} className="mt-5 space-y-4">
              {formError && (
                <div className="p-3 bg-rose-950/60 border border-rose-800/80 rounded-xl text-xs text-rose-300 flex items-start gap-2">
                  <span className="font-bold">⚠</span>
                  <span>{formError}</span>
                </div>
              )}

              {/* Client Selection */}
              <div>
                <label className="label">
                  Assign to Client <span className="text-violet-400">*</span>
                </label>
                <select
                  id="select-voice-client"
                  required
                  className="input text-xs"
                  value={formClientId}
                  onChange={(e) => setFormClientId(Number(e.target.value))}
                >
                  <option value="" disabled>Select a client...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — Executive: {c.executive_name} {c.company ? `(${c.company})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Voice Name */}
              <div>
                <label className="label">
                  Voice Model Name <span className="text-violet-400">*</span>
                </label>
                <input
                  id="input-voice-name"
                  type="text"
                  required
                  className="input text-xs"
                  placeholder="e.g. Alex Morgan - Formal Keynote"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>

              {/* Upload Mode Specific Fields */}
              {addMode === 'upload' && (
                <>
                  <div>
                    <label className="label">
                      Audio Sample Recording <span className="text-violet-400">*</span>
                    </label>
                    <input
                      type="file"
                      required
                      accept="audio/*,.mp3,.wav,.webm,.m4a,.ogg"
                      className="input text-xs file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-violet-600 file:text-white hover:file:bg-violet-500"
                      onChange={(e) => setFormAudioFile(e.target.files?.[0] || null)}
                    />
                    <p className="text-[11px] text-slate-500 mt-1.5">
                      Upload 30–120 seconds of clear, background-noise-free executive speech.
                    </p>
                  </div>

                  <div>
                    <label className="label">
                      Voice Consent Authorization <span className="text-violet-400">*</span>
                    </label>
                    <textarea
                      required
                      className="input text-xs min-h-[75px]"
                      placeholder="Explicit consent text from the person whose voice is being cloned..."
                      value={formConsent}
                      onChange={(e) => setFormConsent(e.target.value)}
                    />
                  </div>
                </>
              )}

              {/* Existing Voice ID Specific Fields */}
              {addMode === 'existing' && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="label">
                        Provider Voice ID <span className="text-violet-400">*</span>
                      </label>
                      <input
                        id="input-voice-id"
                        type="text"
                        required
                        className="input text-xs font-mono"
                        placeholder="e.g. 21m00Tcm4TlvDq8ikWAM"
                        value={formVoiceId}
                        onChange={(e) => setFormVoiceId(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="label">Voice Provider</label>
                      <select
                        className="input text-xs"
                        value={formProvider}
                        onChange={(e) => setFormProvider(e.target.value)}
                      >
                        <option value="elevenlabs">ElevenLabs</option>
                        <option value="custom">Custom Provider</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="label">Description / Purpose</label>
                    <input
                      type="text"
                      className="input text-xs"
                      placeholder="e.g. Warm British accent for international meetings"
                      value={formDescription}
                      onChange={(e) => setFormDescription(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="label">Consent / Authorization Record</label>
                    <input
                      type="text"
                      className="input text-xs"
                      placeholder="e.g. Authorized by executive via written contract"
                      value={formConsent}
                      onChange={(e) => setFormConsent(e.target.value)}
                    />
                  </div>
                </>
              )}

              {/* Set Active Checkbox */}
              <div className="pt-2 flex items-center justify-between bg-[#0a0e17] p-3 rounded-xl border border-slate-800">
                <div>
                  <span className="text-xs font-bold text-slate-200 block">Set as Primary Active Twin</span>
                  <span className="text-[11px] text-slate-500">
                    Make this voice the active voice model for the selected client immediately.
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={formSetActive}
                    onChange={(e) => setFormSetActive(e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600"></div>
                </label>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  id="btn-cancel-voice"
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  disabled={submitting}
                  className="btn btn-secondary text-xs !py-2.5 !px-4"
                >
                  Cancel
                </button>
                <button
                  id="btn-submit-voice"
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary text-xs !py-2.5 !px-5 flex items-center gap-2 font-bold"
                >
                  {submitting && (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  <span>
                    {submitting
                      ? addMode === 'upload'
                        ? 'Cloning Voice…'
                        : 'Saving…'
                      : addMode === 'upload'
                      ? 'Clone Voice'
                      : 'Add Voice'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* EDIT VOICE MODAL */}
      {/* ========================================================================= */}
      {editingVoice && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="card max-w-lg w-full p-6 md:p-8 bg-[#111624] border border-[#2e374f] shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between pb-4 border-b border-slate-800">
              <div>
                <span className="eyebrow">EDIT VOICE CLONE</span>
                <h3 className="text-xl font-black text-white mt-1">
                  Edit &ldquo;{editingVoice.name}&rdquo;
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Client: <strong className="text-white">{editingVoice.client_name}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingVoice(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="mt-5 space-y-4">
              {formError && (
                <div className="p-3 bg-rose-950/60 border border-rose-800/80 rounded-xl text-xs text-rose-300 flex items-start gap-2">
                  <span className="font-bold">⚠</span>
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="label">
                  Voice Name <span className="text-violet-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  className="input text-xs"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">
                    Voice ID <span className="text-violet-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    className="input text-xs font-mono"
                    value={formVoiceId}
                    onChange={(e) => setFormVoiceId(e.target.value)}
                  />
                </div>

                <div>
                  <label className="label">Provider</label>
                  <input
                    type="text"
                    className="input text-xs"
                    value={formProvider}
                    onChange={(e) => setFormProvider(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="label">Description / Purpose</label>
                <textarea
                  className="input text-xs min-h-[60px]"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                />
              </div>

              <div>
                <label className="label">Consent Authorization Record</label>
                <textarea
                  className="input text-xs min-h-[60px]"
                  value={formConsent}
                  onChange={(e) => setFormConsent(e.target.value)}
                />
              </div>

              {/* Set Active Checkbox */}
              <div className="pt-2 flex items-center justify-between bg-[#0a0e17] p-3 rounded-xl border border-slate-800">
                <div>
                  <span className="text-xs font-bold text-slate-200 block">Active Voice Twin</span>
                  <span className="text-[11px] text-slate-500">
                    Set this as the client's current voice representative.
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={formSetActive}
                    onChange={(e) => setFormSetActive(e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600"></div>
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingVoice(null)}
                  disabled={submitting}
                  className="btn btn-secondary text-xs !py-2.5 !px-4"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary text-xs !py-2.5 !px-5 flex items-center gap-2 font-bold"
                >
                  {submitting && (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  <span>{submitting ? 'Saving…' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DELETE VOICE CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {deletingVoice && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="card max-w-md w-full p-6 md:p-8 bg-[#150d12] border border-rose-900/60 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-xl bg-rose-950/80 border border-rose-700/50 text-rose-300 flex items-center justify-center text-2xl mb-4">
              ⚠
            </div>

            <h3 className="text-xl font-black text-white">Delete Voice Clone?</h3>
            <p className="text-xs text-rose-200/80 mt-2 leading-relaxed">
              Are you sure you want to delete <strong className="text-white">{deletingVoice.name}</strong> (Client:{' '}
              <span className="text-white">{deletingVoice.client_name}</span>)?
            </p>

            {deletingVoice.is_active && (
              <div className="mt-4 p-3 bg-rose-950/40 rounded-xl border border-rose-900/40 text-[11px] text-rose-300/90">
                ⚠ This is currently the <strong>Active Voice Twin</strong> for {deletingVoice.client_name}. Deleting it will reassign another saved voice or unbind voice synthesis for this client.
              </div>
            )}

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-rose-900/30">
              <button
                type="button"
                onClick={() => setDeletingVoice(null)}
                disabled={submitting}
                className="btn btn-secondary text-xs !py-2.5 !px-4"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteSubmit}
                disabled={submitting}
                className="btn btn-danger text-xs !py-2.5 !px-5 flex items-center gap-2 font-bold"
              >
                {submitting && (
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                <span>{submitting ? 'Deleting…' : 'Delete Voice'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
