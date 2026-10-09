'use client';

import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const KEY = process.env.NEXT_PUBLIC_ADMIN_API_KEY || 'change-this-admin-key';

export type Client = {
  id: number;
  name: string;
  executive_name: string;
  company: string;
  industry: string;
  email: string;
  phone: string;
  active: boolean;
  created_at?: string;
  voice_id?: string;
  voice_name?: string;
  voice_provider?: string;
  voice_authorized?: boolean;
};

export type VoiceItem = {
  voice_id: string;
  name: string;
  category: string;
  description?: string;
  preview_url?: string | null;
  provider: string;
  assigned_clients: { id: number; name: string; executive_name: string; voice_name: string }[];
};

export function ClientList({
  onOpen,
}: {
  onOpen: (id: number, initialTab?: 'settings' | 'agent') => void;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [voices, setVoices] = useState<VoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [error, setError] = useState('');
  const [notification, setNotification] = useState('');

  // Navigation tab in Clients area: 'clients' or 'voices'
  const [activeTab, setActiveTab] = useState<'clients' | 'voices'>('clients');

  // Filters
  const [clientSearch, setClientSearch] = useState('');
  const [clientStatusFilter, setClientStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [voiceSearch, setVoiceSearch] = useState('');
  const [voiceCategoryFilter, setVoiceCategoryFilter] = useState<'all' | 'cloned' | 'premade'>('all');

  // Modals
  const [modalType, setModalType] = useState<
    'add' | 'edit' | 'delete' | 'assign_voice' | 'clone_voice' | 'rename_voice' | null
  >(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<VoiceItem | null>(null);

  // Voice clone from library state
  const [cloneVoiceName, setCloneVoiceName] = useState('');
  const [cloneAudioFile, setCloneAudioFile] = useState<File | null>(null);
  const [cloneAudioUrl, setCloneAudioUrl] = useState<string | null>(null);
  const [cloneAssignClientId, setCloneAssignClientId] = useState<string>('');
  const [cloneConsentText, setCloneConsentText] = useState(
    'I confirm I have explicit permission and legal authorization to clone and use this voice for executive representation.'
  );
  const [isCloning, setIsCloning] = useState(false);
  const [cloneError, setCloneError] = useState('');

  // Voice rename state
  const [renameVoiceTarget, setRenameVoiceTarget] = useState<VoiceItem | null>(null);
  const [renameVoiceName, setRenameVoiceName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  // Form state for Add/Edit
  const [formName, setFormName] = useState('');
  const [formExecName, setFormExecName] = useState('');
  const [formCompany, setFormCompany] = useState('');
  const [formIndustry, setFormIndustry] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [formVoiceId, setFormVoiceId] = useState('');
  const [formVoiceName, setFormVoiceName] = useState('');
  const [formVoiceProvider, setFormVoiceProvider] = useState('elevenlabs');
  const [useCustomVoiceId, setUseCustomVoiceId] = useState(false);
  const [customVoiceInput, setCustomVoiceInput] = useState('');

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Audio preview state
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Load clients
  async function loadClients() {
    try {
      setLoading(true);
      setError('');
      const r = await fetch(`${API}/api/clients`, { headers: { 'X-Admin-Key': KEY } });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setClients(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load clients.');
    } finally {
      setLoading(false);
    }
  }

  // Load voice library
  async function loadVoices() {
    try {
      setLoadingVoices(true);
      const r = await fetch(`${API}/api/voice/library`, { headers: { 'X-Admin-Key': KEY } });
      if (r.ok) {
        const data = await r.json();
        setVoices(data.voices || []);
      }
    } catch (e) {
      console.log('Notice: Failed to load voice library:', e);
    } finally {
      setLoadingVoices(false);
    }
  }

  useEffect(() => {
    loadClients();
    loadVoices();
  }, []);

  // Stop audio on unmount
  useEffect(() => {
    return () => {
      if (currentAudio) {
        currentAudio.pause();
      }
    };
  }, [currentAudio]);

  function showToast(msg: string) {
    setNotification(msg);
    setTimeout(() => setNotification(''), 4000);
  }

  // Audio Preview helper
  async function playVoicePreview(voiceId: string, previewUrl?: string | null, provider: string = 'elevenlabs') {
    if (currentAudio) {
      currentAudio.pause();
      setCurrentAudio(null);
    }
    if (previewingVoiceId === voiceId) {
      setPreviewingVoiceId(null);
      return;
    }

    setPreviewingVoiceId(voiceId);

    // If we have direct MP3 preview URL from ElevenLabs
    if (previewUrl) {
      const audio = new Audio(previewUrl);
      setCurrentAudio(audio);
      audio.onended = () => {
        setPreviewingVoiceId(null);
        setCurrentAudio(null);
      };
      audio.play().catch(() => setPreviewingVoiceId(null));
      return;
    }

    // Otherwise generate via backend preview synthesis
    try {
      const res = await fetch(
        `${API}/api/voice/preview?voice=${encodeURIComponent(voiceId)}&provider=${encodeURIComponent(provider)}&text=Hello, this is a sample preview of this executive voice ID.`,
        { headers: { 'X-Admin-Key': KEY } }
      );
      if (res.ok) {
        const j = await res.json();
        if (j.audio_base64) {
          const audio = new Audio(`data:${j.mime_type};base64,${j.audio_base64}`);
          setCurrentAudio(audio);
          audio.onended = () => {
            setPreviewingVoiceId(null);
            setCurrentAudio(null);
          };
          await audio.play();
          return;
        }
      }
      setPreviewingVoiceId(null);
    } catch {
      setPreviewingVoiceId(null);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  }

  // Open Add Client modal
  function openAddModal() {
    const defaultVoice = voices.find((v) => v.category === 'cloned') || voices[0];
    setFormName('');
    setFormExecName('');
    setFormCompany('');
    setFormIndustry('');
    setFormEmail('');
    setFormPhone('');
    setFormActive(true);
    setFormVoiceId(defaultVoice?.voice_id || 'bfJAAFM54j2wqqMBZL9Y');
    setFormVoiceName(defaultVoice?.name || 'Executive Cloned Voice');
    setFormVoiceProvider('elevenlabs');
    setUseCustomVoiceId(false);
    setCustomVoiceInput('');
    setFormError('');
    setModalType('add');
  }

  // Open Edit Client modal
  function openEditModal(c: Client) {
    setSelectedClient(c);
    setFormName(c.name || '');
    setFormExecName(c.executive_name || '');
    setFormCompany(c.company || '');
    setFormIndustry(c.industry || '');
    setFormEmail(c.email || '');
    setFormPhone(c.phone || '');
    setFormActive(c.active !== false);
    setFormVoiceId(c.voice_id || 'bfJAAFM54j2wqqMBZL9Y');
    setFormVoiceName(c.voice_name || `${c.executive_name} Voice`);
    setFormVoiceProvider(c.voice_provider || 'elevenlabs');
    setUseCustomVoiceId(false);
    setCustomVoiceInput('');
    setFormError('');
    setModalType('edit');
  }

  // Open Delete modal
  function openDeleteModal(c: Client) {
    setSelectedClient(c);
    setModalType('delete');
  }

  // Save new client
  async function handleCreateClient() {
    if (!formName.trim() || !formExecName.trim()) {
      setFormError('Client name and Executive name are required.');
      return;
    }

    const targetVoiceId = useCustomVoiceId ? customVoiceInput.trim() : formVoiceId.trim();
    if (!targetVoiceId) {
      setFormError('Please select or specify a Voice ID.');
      return;
    }

    const targetVoiceName = formVoiceName.trim() || `${formExecName.trim()} Voice`;

    setSaving(true);
    setFormError('');

    try {
      const res = await fetch(`${API}/api/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': KEY },
        body: JSON.stringify({
          name: formName.trim(),
          executive_name: formExecName.trim(),
          company: formCompany.trim(),
          industry: formIndustry.trim(),
          email: formEmail.trim(),
          phone: formPhone.trim(),
          voice_id: targetVoiceId,
          voice_name: targetVoiceName,
          voice_provider: formVoiceProvider,
        }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.detail || 'Failed to create client.');
      }

      setModalType(null);
      showToast(`✓ Client "${formName}" created successfully!`);
      loadClients();
      loadVoices();
    } catch (e: any) {
      setFormError(e.message || 'Error creating client.');
    } finally {
      setSaving(false);
    }
  }

  // Update existing client
  async function handleUpdateClient() {
    if (!selectedClient) return;
    if (!formName.trim() || !formExecName.trim()) {
      setFormError('Client name and Executive name are required.');
      return;
    }

    const targetVoiceId = useCustomVoiceId ? customVoiceInput.trim() : formVoiceId.trim();
    const targetVoiceName = formVoiceName.trim() || `${formExecName.trim()} Voice`;

    setSaving(true);
    setFormError('');

    try {
      const res = await fetch(`${API}/api/clients/${selectedClient.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': KEY },
        body: JSON.stringify({
          name: formName.trim(),
          executive_name: formExecName.trim(),
          company: formCompany.trim(),
          industry: formIndustry.trim(),
          email: formEmail.trim(),
          phone: formPhone.trim(),
          active: formActive,
          voice_id: targetVoiceId,
          voice_name: targetVoiceName,
          voice_provider: formVoiceProvider,
        }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.detail || 'Failed to update client.');
      }

      setModalType(null);
      showToast(`✓ Client "${formName}" updated successfully!`);
      loadClients();
      loadVoices();
    } catch (e: any) {
      setFormError(e.message || 'Error updating client.');
    } finally {
      setSaving(false);
    }
  }

  // Remove client
  async function handleDeleteClient() {
    if (!selectedClient) return;
    setSaving(true);

    try {
      const res = await fetch(`${API}/api/clients/${selectedClient.id}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Key': KEY },
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.detail || 'Failed to delete client.');
      }

      setModalType(null);
      showToast(`✓ Client "${selectedClient.name}" removed successfully.`);
      loadClients();
      loadVoices();
    } catch (e: any) {
      setFormError(e.message || 'Error deleting client.');
    } finally {
      setSaving(false);
    }
  }

  // Assign voice from separate library list directly to a client
  async function assignVoiceToClient(voice: VoiceItem, clientId: number) {
    const cl = clients.find((c) => c.id === clientId);
    if (!cl) return;

    try {
      const res = await fetch(`${API}/api/clients/${clientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': KEY },
        body: JSON.stringify({
          voice_id: voice.voice_id,
          voice_name: voice.name,
          voice_provider: voice.provider,
        }),
      });

      if (res.ok) {
        showToast(`✓ Assigned voice "${voice.name}" to ${cl.name} (${cl.executive_name})!`);
        loadClients();
        loadVoices();
      } else {
        const j = await res.json().catch(() => ({}));
        alert(j.detail || 'Failed to assign voice.');
      }
    } catch (e: any) {
      alert(e.message || 'Network error assigning voice.');
    }
  }

  // Open Clone Voice modal
  function openCloneVoiceModal(defaultClientId?: number) {
    setCloneVoiceName('');
    setCloneAudioFile(null);
    if (cloneAudioUrl) {
      URL.revokeObjectURL(cloneAudioUrl);
      setCloneAudioUrl(null);
    }
    setCloneAssignClientId(defaultClientId ? String(defaultClientId) : '');
    setCloneConsentText(
      'I confirm I have explicit permission and legal authorization to clone and use this voice for executive representation.'
    );
    setCloneError('');
    setModalType('clone_voice');
  }

  // Handle clone audio file change
  function handleCloneFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setCloneAudioFile(f);
    if (cloneAudioUrl) {
      URL.revokeObjectURL(cloneAudioUrl);
    }
    const url = URL.createObjectURL(f);
    setCloneAudioUrl(url);
    if (!cloneVoiceName.trim()) {
      const baseName = f.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      setCloneVoiceName(`${baseName} Clone`);
    }
  }

  // Submit voice clone request
  async function handleCloneVoiceSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cloneVoiceName.trim()) {
      setCloneError('Please enter a recognizable name for this voice clone.');
      return;
    }
    if (!cloneAudioFile) {
      setCloneError('Please select a reference audio file (.mp3, .wav, .m4a, or .webm).');
      return;
    }
    if (!cloneConsentText.trim()) {
      setCloneError('Legal consent confirmation is required.');
      return;
    }

    try {
      setIsCloning(true);
      setCloneError('');
      const fd = new FormData();
      fd.append('voice_name', cloneVoiceName.trim());
      fd.append('file', cloneAudioFile);
      fd.append('consent_text', cloneConsentText.trim());
      fd.append('provider', 'elevenlabs');
      if (cloneAssignClientId) {
        fd.append('client_id', cloneAssignClientId);
      }

      const res = await fetch(`${API}/api/voice/clone`, {
        method: 'POST',
        headers: {
          'X-Admin-Key': KEY,
        },
        body: fd,
      });

      if (!res.ok) {
        const errText = await res.text();
        let msg = errText;
        try {
          const j = JSON.parse(errText);
          msg = j.detail || j.message || errText;
        } catch { }
        throw new Error(msg);
      }

      const data = await res.json();
      showToast(`🎉 Cloned voice "${data.voice_name}" created successfully! Voice ID: ${data.voice_id}`);
      setModalType(null);
      if (cloneAudioUrl) {
        URL.revokeObjectURL(cloneAudioUrl);
        setCloneAudioUrl(null);
      }
      await Promise.all([loadVoices(), loadClients()]);
    } catch (err: any) {
      setCloneError(err.message || 'Voice cloning failed.');
    } finally {
      setIsCloning(false);
    }
  }

  // Open Rename Voice modal
  function openRenameModal(v: VoiceItem) {
    setRenameVoiceTarget(v);
    setRenameVoiceName(v.name);
    setModalType('rename_voice');
  }

  // Submit Rename Voice request
  async function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!renameVoiceTarget || !renameVoiceName.trim()) return;
    try {
      setIsRenaming(true);
      const res = await fetch(`${API}/api/voice/${encodeURIComponent(renameVoiceTarget.voice_id)}/name`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': KEY,
        },
        body: JSON.stringify({ voice_name: renameVoiceName.trim() }),
      });
      if (!res.ok) {
        const errText = await res.text();
        let msg = errText;
        try {
          const j = JSON.parse(errText);
          msg = j.detail || errText;
        } catch { }
        throw new Error(msg);
      }
      showToast(`✓ Voice renamed to "${renameVoiceName.trim()}"`);
      setModalType(null);
      await Promise.all([loadVoices(), loadClients()]);
    } catch (err: any) {
      alert(err.message || 'Failed to rename voice.');
    } finally {
      setIsRenaming(false);
    }
  }

  // Filter clients
  const filteredClients = clients.filter((c) => {
    const query = clientSearch.toLowerCase();
    const matchesSearch =
      c.name.toLowerCase().includes(query) ||
      c.executive_name.toLowerCase().includes(query) ||
      (c.company && c.company.toLowerCase().includes(query)) ||
      (c.voice_name && c.voice_name.toLowerCase().includes(query)) ||
      (c.voice_id && c.voice_id.toLowerCase().includes(query));

    const matchesStatus =
      clientStatusFilter === 'all' ||
      (clientStatusFilter === 'active' && c.active) ||
      (clientStatusFilter === 'inactive' && !c.active);

    return matchesSearch && matchesStatus;
  });

  // Filter voices in separate list
  const filteredVoices = voices.filter((v) => {
    const query = voiceSearch.toLowerCase();
    const matchesSearch =
      v.name.toLowerCase().includes(query) ||
      v.voice_id.toLowerCase().includes(query) ||
      (v.description && v.description.toLowerCase().includes(query));

    const matchesCategory =
      voiceCategoryFilter === 'all' ||
      (voiceCategoryFilter === 'cloned' && v.category === 'cloned') ||
      (voiceCategoryFilter === 'premade' && v.category !== 'cloned');

    return matchesSearch && matchesCategory;
  });

  return (
    <section className="space-y-6">
      {/* Toast Notification */}
      {notification && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-sm flex items-center justify-between shadow-lg animate-fade-in">
          <span>{notification}</span>
          <button onClick={() => setNotification('')} className="text-emerald-400 font-bold ml-2">
            ✕
          </button>
        </div>
      )}

      {/* Top Header & Section Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-2">
            <span>👥</span> Clients & Voice Registry
          </h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Manage executive client accounts, add new representatives, and explore the dedicated Voice ID library.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              loadClients();
              loadVoices();
            }}
            className="btn btn-secondary text-xs flex items-center gap-1.5"
            title="Refresh list"
          >
            <span>🔄</span> Refresh
          </button>
          {activeTab === 'clients' ? (
            <button
              onClick={openAddModal}
              className="btn btn-primary text-xs flex items-center gap-1.5 shadow-md shadow-violet-600/30"
            >
              <span>➕</span> Add New Client
            </button>
          ) : (
            <button
              onClick={() => openCloneVoiceModal()}
              className="btn btn-primary text-xs flex items-center gap-1.5 shadow-md shadow-violet-600/30 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-bold"
            >
              <span>🎙️</span> + Clone New Voice
            </button>
          )}
        </div>
      </div>

      {/* Tabs: Clients vs Separate Voice IDs List */}
      <div className="flex border-b border-slate-800 gap-2">
        <button
          onClick={() => setActiveTab('clients')}
          className={`pb-3 px-4 text-sm font-bold flex items-center gap-2 border-b-2 transition ${activeTab === 'clients'
              ? 'border-violet-500 text-violet-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
        >
          <span>👥</span>
          Executive Clients
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-normal">
            {clients.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('voices')}
          className={`pb-3 px-4 text-sm font-bold flex items-center gap-2 border-b-2 transition ${activeTab === 'voices'
              ? 'border-violet-500 text-violet-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
        >
          <span>🎙️</span>
          Voice IDs & Clones Library (Separate List)
          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-950 text-violet-300 border border-violet-500/30 font-normal">
            {voices.length} Available
          </span>
        </button>
      </div>

      {/* TAB 1: EXECUTIVE CLIENTS LIST */}
      {activeTab === 'clients' && (
        <div className="space-y-4">
          {/* Search & Filters */}
          <div className="card p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="w-full sm:w-80">
              <input
                type="text"
                placeholder="Search clients, executives, companies, or voices…"
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                className="input text-xs py-2"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <span className="text-xs text-slate-400">Status:</span>
              {(['all', 'active', 'inactive'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setClientStatusFilter(st)}
                  className={`px-3 py-1 text-xs rounded-lg font-semibold capitalize transition ${clientStatusFilter === st
                      ? 'bg-violet-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-400 card flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin"></span>
              Loading executive clients…
            </div>
          ) : error ? (
            <div className="card p-5 text-red-300 border-red-500/30 bg-red-500/10">
              {error}
            </div>
          ) : filteredClients.length === 0 ? (
            <div className="card p-12 text-center text-slate-400">
              <div className="text-3xl mb-2">🔍</div>
              <h3 className="text-base font-bold text-white mb-1">No clients found</h3>
              <p className="text-xs text-slate-400 mb-4">
                {clientSearch ? 'Try a different search query or filter.' : 'Get started by creating your first executive client.'}
              </p>
              <button onClick={openAddModal} className="btn btn-primary text-xs">
                + Add Client
              </button>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
              {filteredClients.map((c) => {
                const isPlaying = previewingVoiceId === c.voice_id;

                return (
                  <div
                    key={c.id}
                    className="card p-5 flex flex-col justify-between hover:border-violet-500/40 transition-all shadow-md group"
                  >
                    <div>
                      {/* Top Bar: Name & Status */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div>
                          <h3 className="text-lg font-black text-white group-hover:text-violet-200 transition">
                            {c.name}
                          </h3>
                          <p className="text-sm font-semibold text-slate-300">
                            Executive: <span className="text-white">{c.executive_name}</span>
                          </p>
                        </div>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${c.active
                              ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                            }`}
                        >
                          {c.active ? 'Active' : 'Inactive'}
                        </span>
                      </div>

                      {/* Company & Industry info */}
                      <div className="text-xs text-slate-400 mb-4 flex items-center gap-1.5 flex-wrap">
                        <span>🏢 {c.company || 'Company not set'}</span>
                        {c.industry && (
                          <>
                            <span>•</span>
                            <span>{c.industry}</span>
                          </>
                        )}
                      </div>

                      {/* Assigned Voice Clone Box */}
                      <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 mb-4">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-slate-400 font-semibold flex items-center gap-1">
                            <span>🎙️</span> Assigned Voice Clone:
                          </span>
                          {c.voice_id && (
                            <button
                              type="button"
                              onClick={() => playVoicePreview(c.voice_id!, null, c.voice_provider || 'elevenlabs')}
                              className={`text-[11px] font-bold px-2 py-0.5 rounded transition ${isPlaying
                                  ? 'bg-emerald-600 text-white animate-pulse'
                                  : 'bg-violet-950/80 text-violet-300 hover:bg-violet-900 border border-violet-500/30'
                                }`}
                            >
                              {isPlaying ? '■ Playing' : '▶ Audio'}
                            </button>
                          )}
                        </div>

                        <div className="font-bold text-white text-xs truncate">
                          {c.voice_name || 'Standard Voice Persona'}
                        </div>

                        {c.voice_id && (
                          <div className="flex items-center justify-between mt-1 text-[11px] font-mono text-slate-400">
                            <span className="truncate">ID: {c.voice_id}</span>
                            <span className="text-[10px] uppercase font-sans font-semibold px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 ml-1 shrink-0">
                              {c.voice_provider === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI'}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="pt-3 border-t border-slate-800/80 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          className="btn btn-primary text-xs py-2 flex items-center justify-center gap-1"
                          onClick={() => onOpen(c.id, 'agent')}
                        >
                          <span>🎙️</span> Talk to Agent
                        </button>
                        <button
                          className="btn btn-secondary text-xs py-2 flex items-center justify-center gap-1"
                          onClick={() => onOpen(c.id, 'settings')}
                        >
                          <span>⚙️</span> Settings
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1 text-xs">
                        <button
                          type="button"
                          onClick={() => openEditModal(c)}
                          className="text-violet-300 hover:text-violet-200 font-semibold flex items-center gap-1 hover:underline"
                        >
                          <span>✏️</span> Edit Client Details
                        </button>

                        <button
                          type="button"
                          onClick={() => openDeleteModal(c)}
                          className="text-red-400 hover:text-red-300 font-semibold flex items-center gap-1 hover:underline"
                        >
                          <span>🗑️</span> Remove
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: SEPARATE VOICE IDS & CLONES LIBRARY */}
      {activeTab === 'voices' && (
        <div className="space-y-5">
          {/* Summary Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card p-4">
              <div className="text-xs text-slate-400 font-semibold uppercase">Total Voice IDs</div>
              <div className="text-2xl font-black text-white mt-1">{voices.length}</div>
            </div>
            <div className="card p-4 border-violet-500/30 bg-violet-950/20">
              <div className="text-xs text-violet-300 font-semibold uppercase">Cloned Voices</div>
              <div className="text-2xl font-black text-violet-200 mt-1">
                {voices.filter((v) => v.category === 'cloned').length}
              </div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-slate-400 font-semibold uppercase">Library Premade</div>
              <div className="text-2xl font-black text-white mt-1">
                {voices.filter((v) => v.category !== 'cloned').length}
              </div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-slate-400 font-semibold uppercase">Client In-Use</div>
              <div className="text-2xl font-black text-emerald-300 mt-1">
                {voices.filter((v) => v.assigned_clients && v.assigned_clients.length > 0).length}
              </div>
            </div>
          </div>

          {/* Voice Search & Filter Bar */}
          <div className="card p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="w-full sm:w-80">
              <input
                type="text"
                placeholder="Search Voice IDs, names, or categories…"
                value={voiceSearch}
                onChange={(e) => setVoiceSearch(e.target.value)}
                className="input text-xs py-2"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
              <span className="text-xs text-slate-400">Filter Category:</span>
              {(['all', 'cloned', 'premade'] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setVoiceCategoryFilter(cat)}
                  className={`px-3 py-1 text-xs rounded-lg font-semibold capitalize transition ${voiceCategoryFilter === cat
                      ? 'bg-violet-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                >
                  {cat === 'all' ? 'All Voices' : cat === 'cloned' ? 'Custom Clones' : 'Premade'}
                </button>
              ))}
              <button
                type="button"
                onClick={() => openCloneVoiceModal()}
                className="btn btn-primary text-xs flex items-center gap-1.5 shadow-md shadow-violet-600/30 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-bold ml-1"
              >
                <span>🎙️</span> + Clone New Voice
              </button>
            </div>
          </div>

          {loadingVoices ? (
            <div className="p-12 text-center text-slate-400 card flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin"></span>
              Loading Voice IDs library…
            </div>
          ) : filteredVoices.length === 0 ? (
            <div className="card p-12 text-center text-slate-400">
              <div className="text-3xl mb-2">🎙️</div>
              <h3 className="text-base font-bold text-white mb-1">No voices found</h3>
              <p className="text-xs text-slate-400 mb-4">
                {voiceSearch ? `No voices matching "${voiceSearch}".` : 'No voices available in this category.'}
              </p>
              <button
                type="button"
                onClick={() => openCloneVoiceModal()}
                className="btn btn-primary text-xs inline-flex items-center gap-1.5 shadow-md shadow-violet-600/30 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-bold"
              >
                <span>🎙️</span> Clone Your First Voice
              </button>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredVoices.map((v) => {
                const isPlaying = previewingVoiceId === v.voice_id;
                const isCloned = v.category === 'cloned';

                return (
                  <div
                    key={v.voice_id}
                    className={`p-4 rounded-xl border flex flex-col justify-between transition-all shadow-md ${isCloned
                        ? 'bg-gradient-to-br from-violet-950/30 via-slate-900 to-slate-900 border-violet-500/50 ring-1 ring-violet-500/20'
                        : 'bg-slate-900/80 border-slate-800'
                      }`}
                  >
                    <div>
                      {/* Name & Category Badge */}
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <h4 className="font-bold text-white text-sm truncate" title={v.name}>{v.name}</h4>
                          <button
                            type="button"
                            onClick={() => openRenameModal(v)}
                            className="text-slate-400 hover:text-violet-300 text-xs p-0.5 rounded transition shrink-0"
                            title="Rename Voice Clone"
                          >
                            ✏️
                          </button>
                        </div>
                        <span
                          className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0 ${isCloned
                              ? 'bg-violet-500/20 text-violet-300 border border-violet-500/40'
                              : 'bg-slate-800 text-slate-300 border border-slate-700'
                            }`}
                        >
                          {isCloned ? '🎙️ CLONED' : v.category || 'VOICE'}
                        </span>
                      </div>

                      {/* Voice ID with Copy Button */}
                      <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950/80 border border-slate-800 font-mono text-[11px] text-slate-400 mb-2">
                        <span className="truncate select-all">{v.voice_id}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(v.voice_id)}
                          className="ml-2 text-violet-400 hover:text-violet-300 shrink-0 text-xs"
                          title="Copy Voice ID"
                        >
                          {copiedId === v.voice_id ? '✓ Copied' : '📋 Copy'}
                        </button>
                      </div>

                      {v.description && (
                        <p className="text-xs text-slate-400 line-clamp-2 mb-3">{v.description}</p>
                      )}

                      {/* Assigned Clients Pill */}
                      <div className="mb-3 text-[11px]">
                        {v.assigned_clients && v.assigned_clients.length > 0 ? (
                          <div className="text-emerald-300 font-medium flex items-center gap-1.5 flex-wrap">
                            <span>✓ Assigned to:</span>
                            {v.assigned_clients.map((cl) => (
                              <span
                                key={cl.id}
                                className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-200 border border-emerald-500/30"
                              >
                                {cl.name} ({cl.executive_name})
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">Not currently assigned to any client</span>
                        )}
                      </div>
                    </div>

                    {/* Actions: Audio Preview & Assign Dropdown */}
                    <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => playVoicePreview(v.voice_id, v.preview_url, v.provider)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${isPlaying
                            ? 'bg-emerald-600 text-white animate-pulse'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                          }`}
                      >
                        {isPlaying ? '■ Playing…' : '▶ Preview'}
                      </button>

                      {/* Quick Assign Dropdown */}
                      {clients.length > 0 && (
                        <select
                          className="text-xs py-1.5 px-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-300 focus:border-violet-500"
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) {
                              assignVoiceToClient(v, Number(e.target.value));
                              e.target.value = '';
                            }
                          }}
                        >
                          <option value="" disabled>
                            Assign to client…
                          </option>
                          {clients.map((c) => (
                            <option key={c.id} value={c.id}>
                              Assign to: {c.name} ({c.executive_name})
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODAL: ADD NEW CLIENT */}
      {modalType === 'add' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="card w-full max-w-xl p-6 bg-slate-900 border-violet-500/40 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                <span>➕</span> Create New Executive Client
              </h3>
              <button
                onClick={() => setModalType(null)}
                className="text-slate-400 hover:text-white font-bold text-lg"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-200 text-xs">
                {formError}
              </div>
            )}

            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">
                    Client / Organization Name <span className="text-violet-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Acme Corp, Global Tech"
                    className="input text-xs"
                  />
                </div>
                <div>
                  <label className="label text-xs">
                    Executive Name <span className="text-violet-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formExecName}
                    onChange={(e) => {
                      setFormExecName(e.target.value);
                      if (!formVoiceName || formVoiceName.includes('Voice')) {
                        setFormVoiceName(`${e.target.value} Voice`);
                      }
                    }}
                    placeholder="e.g. Elena Rostova, Shaun"
                    className="input text-xs"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">Company / Division</label>
                  <input
                    type="text"
                    value={formCompany}
                    onChange={(e) => setFormCompany(e.target.value)}
                    placeholder="e.g. Virtual Employee, Acme"
                    className="input text-xs"
                  />
                </div>
                <div>
                  <label className="label text-xs">Industry</label>
                  <input
                    type="text"
                    value={formIndustry}
                    onChange={(e) => setFormIndustry(e.target.value)}
                    placeholder="e.g. Technology, Finance"
                    className="input text-xs"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">Email (optional)</label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="executive@company.com"
                    className="input text-xs"
                  />
                </div>
                <div>
                  <label className="label text-xs">Phone (optional)</label>
                  <input
                    type="text"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="+1 555-0199"
                    className="input text-xs"
                  />
                </div>
              </div>

              {/* Voice ID Selection from Separate List */}
              <div className="p-4 rounded-xl bg-slate-950/80 border border-violet-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-violet-300 uppercase tracking-wide">
                    Assign Initial Voice ID
                  </label>
                  <button
                    type="button"
                    onClick={() => setUseCustomVoiceId(!useCustomVoiceId)}
                    className="text-xs text-violet-400 hover:text-violet-300 underline"
                  >
                    {useCustomVoiceId ? 'Pick from library list' : 'Enter custom Voice ID'}
                  </button>
                </div>

                {!useCustomVoiceId ? (
                  <div>
                    <select
                      value={formVoiceId}
                      onChange={(e) => {
                        const vid = e.target.value;
                        setFormVoiceId(vid);
                        const found = voices.find((v) => v.voice_id === vid);
                        if (found) {
                          setFormVoiceName(found.name);
                        }
                      }}
                      className="input text-xs bg-slate-900"
                    >
                      <optgroup label="Custom Cloned Voices">
                        {voices
                          .filter((v) => v.category === 'cloned')
                          .map((v) => (
                            <option key={v.voice_id} value={v.voice_id}>
                              ★ {v.name} ({v.voice_id})
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="Library Premade Voices">
                        {voices
                          .filter((v) => v.category !== 'cloned')
                          .map((v) => (
                            <option key={v.voice_id} value={v.voice_id}>
                              {v.name} ({v.voice_id})
                            </option>
                          ))}
                      </optgroup>
                    </select>
                  </div>
                ) : (
                  <div>
                    <input
                      type="text"
                      placeholder="e.g. bfJAAFM54j2wqqMBZL9Y or EXAVITQu4vr4xnSDxMaL"
                      value={customVoiceInput}
                      onChange={(e) => setCustomVoiceInput(e.target.value)}
                      className="input font-mono text-xs"
                    />
                  </div>
                )}

                <div>
                  <label className="label text-xs">Voice Clone Name</label>
                  <input
                    type="text"
                    value={formVoiceName}
                    onChange={(e) => setFormVoiceName(e.target.value)}
                    placeholder="e.g. Shaun Executive Natural Voice"
                    className="input text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setModalType(null)}
                className="btn btn-secondary text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateClient}
                disabled={saving}
                className="btn btn-primary text-xs flex items-center gap-1.5 shadow-md shadow-violet-600/30"
              >
                {saving ? 'Creating Client…' : '✓ Create Client'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDIT CLIENT */}
      {modalType === 'edit' && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="card w-full max-w-xl p-6 bg-slate-900 border-violet-500/40 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                <span>✏️</span> Edit Client: {selectedClient.name}
              </h3>
              <button
                onClick={() => setModalType(null)}
                className="text-slate-400 hover:text-white font-bold text-lg"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-200 text-xs">
                {formError}
              </div>
            )}

            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">
                    Client / Organization Name <span className="text-violet-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="input text-xs"
                  />
                </div>
                <div>
                  <label className="label text-xs">
                    Executive Name <span className="text-violet-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formExecName}
                    onChange={(e) => setFormExecName(e.target.value)}
                    className="input text-xs"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">Company / Division</label>
                  <input
                    type="text"
                    value={formCompany}
                    onChange={(e) => setFormCompany(e.target.value)}
                    className="input text-xs"
                  />
                </div>
                <div>
                  <label className="label text-xs">Industry</label>
                  <input
                    type="text"
                    value={formIndustry}
                    onChange={(e) => setFormIndustry(e.target.value)}
                    className="input text-xs"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-3">
                <div>
                  <label className="label text-xs">Email</label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    className="input text-xs"
                  />
                </div>
                <div>
                  <label className="label text-xs">Phone</label>
                  <input
                    type="text"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    className="input text-xs"
                  />
                </div>
                <div>
                  <label className="label text-xs">Account Status</label>
                  <select
                    value={formActive ? 'active' : 'inactive'}
                    onChange={(e) => setFormActive(e.target.value === 'active')}
                    className="input text-xs bg-slate-900"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              {/* Assigned Voice ID Section */}
              <div className="p-4 rounded-xl bg-slate-950/80 border border-violet-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-violet-300 uppercase tracking-wide">
                    Assigned Voice ID & Name
                  </label>
                  <button
                    type="button"
                    onClick={() => setUseCustomVoiceId(!useCustomVoiceId)}
                    className="text-xs text-violet-400 hover:text-violet-300 underline"
                  >
                    {useCustomVoiceId ? 'Pick from library list' : 'Enter custom Voice ID'}
                  </button>
                </div>

                {!useCustomVoiceId ? (
                  <div>
                    <select
                      value={formVoiceId}
                      onChange={(e) => {
                        const vid = e.target.value;
                        setFormVoiceId(vid);
                        const found = voices.find((v) => v.voice_id === vid);
                        if (found) {
                          setFormVoiceName(found.name);
                        }
                      }}
                      className="input text-xs bg-slate-900"
                    >
                      <optgroup label="Custom Cloned Voices">
                        {voices
                          .filter((v) => v.category === 'cloned')
                          .map((v) => (
                            <option key={v.voice_id} value={v.voice_id}>
                              ★ {v.name} ({v.voice_id})
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="Library Premade Voices">
                        {voices
                          .filter((v) => v.category !== 'cloned')
                          .map((v) => (
                            <option key={v.voice_id} value={v.voice_id}>
                              {v.name} ({v.voice_id})
                            </option>
                          ))}
                      </optgroup>
                    </select>
                  </div>
                ) : (
                  <div>
                    <input
                      type="text"
                      placeholder="e.g. bfJAAFM54j2wqqMBZL9Y"
                      value={customVoiceInput || formVoiceId}
                      onChange={(e) => setCustomVoiceInput(e.target.value)}
                      className="input font-mono text-xs"
                    />
                  </div>
                )}

                <div>
                  <label className="label text-xs">Voice Clone Name</label>
                  <input
                    type="text"
                    value={formVoiceName}
                    onChange={(e) => setFormVoiceName(e.target.value)}
                    className="input text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setModalType(null)}
                className="btn btn-secondary text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUpdateClient}
                disabled={saving}
                className="btn btn-primary text-xs flex items-center gap-1.5 shadow-md shadow-violet-600/30"
              >
                {saving ? 'Saving…' : '✓ Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: DELETE CONFIRMATION */}
      {modalType === 'delete' && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="card w-full max-w-md p-6 bg-slate-900 border-red-500/40 shadow-2xl">
            <h3 className="text-lg font-black text-red-400 mb-2 flex items-center gap-2">
              <span>⚠️</span> Delete Client: {selectedClient.name}?
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed mb-4">
              Are you sure you want to remove <strong>{selectedClient.name}</strong> (Executive: {selectedClient.executive_name})?
              This will permanently delete this client, their executive profile, and any associated conversation memories.
            </p>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setModalType(null)}
                className="btn btn-secondary text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteClient}
                disabled={saving}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-lg transition"
              >
                {saving ? 'Deleting…' : '🗑️ Yes, Delete Client'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CLONE NEW VOICE FROM LIBRARY */}
      {modalType === 'clone_voice' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="card w-full max-w-lg p-6 bg-slate-900 border-violet-500/40 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  <span>🎙️</span> Instant Voice Cloning
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Clone a custom AI voice using ElevenLabs and add it to your library.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (cloneAudioUrl) URL.revokeObjectURL(cloneAudioUrl);
                  setCloneAudioUrl(null);
                  setModalType(null);
                }}
                className="text-slate-400 hover:text-slate-200 text-lg leading-none p-1"
              >
                ✕
              </button>
            </div>

            {cloneError && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs font-semibold">
                ⚠️ {cloneError}
              </div>
            )}

            <form onSubmit={handleCloneVoiceSubmit} className="space-y-4">
              {/* Voice Name (Editable) */}
              <div>
                <label className="label text-xs font-bold text-slate-200">
                  Voice Clone Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Shaun Morgan Strategic Tone"
                  value={cloneVoiceName}
                  onChange={(e) => setCloneVoiceName(e.target.value)}
                  className="input text-xs"
                  required
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Give this voice clone a recognizable name. You can edit this name at any time.
                </span>
              </div>

              {/* Audio Upload */}
              <div>
                <label className="label text-xs font-bold text-slate-200">
                  Reference Voice Audio Sample <span className="text-red-400">*</span>
                </label>
                <div className="border-2 border-dashed border-slate-700 hover:border-violet-500/60 rounded-xl p-4 text-center bg-slate-950/60 transition group cursor-pointer relative">
                  <input
                    type="file"
                    accept="audio/mp3,audio/wav,audio/m4a,audio/webm,audio/ogg,.mp3,.wav,.m4a,.webm"
                    onChange={handleCloneFileChange}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                  {cloneAudioFile ? (
                    <div className="space-y-2">
                      <div className="text-2xl">🎵</div>
                      <div className="text-xs font-bold text-violet-300 truncate">
                        {cloneAudioFile.name}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {(cloneAudioFile.size / (1024 * 1024)).toFixed(2)} MB • Click or drag to replace
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="text-2xl group-hover:scale-110 transition-transform">📂</div>
                      <div className="text-xs font-bold text-slate-300">
                        Choose an audio file or drag & drop
                      </div>
                      <div className="text-[11px] text-slate-400">
                        MP3, WAV, M4A, or WebM (Clear speech sample, 30s-3min recommended)
                      </div>
                    </div>
                  )}
                </div>

                {/* Audio preview player if file selected */}
                {cloneAudioUrl && (
                  <div className="mt-2.5 p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex flex-col gap-1.5">
                    <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
                      <span>🎧</span> Sample Playback Preview:
                    </span>
                    <audio controls src={cloneAudioUrl} className="w-full h-8" />
                  </div>
                )}
              </div>

              {/* Optional Assign to Client Dropdown */}
              <div>
                <label className="label text-xs font-bold text-slate-200">
                  Assign to Executive Client <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <select
                  value={cloneAssignClientId}
                  onChange={(e) => setCloneAssignClientId(e.target.value)}
                  className="input text-xs"
                >
                  <option value="">-- Keep in Voice Library (Unassigned for now) --</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — Executive: {c.executive_name} ({c.company || 'Client'})
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-slate-400 mt-1 block">
                  You can assign this voice to an executive immediately, or keep it in the library to assign later.
                </span>
              </div>

              {/* Legal Consent Acknowledgement */}
              <div>
                <label className="label text-xs font-bold text-slate-200">
                  Legal Authorization & Consent <span className="text-red-400">*</span>
                </label>
                <textarea
                  rows={2}
                  value={cloneConsentText}
                  onChange={(e) => setCloneConsentText(e.target.value)}
                  className="input text-xs resize-none"
                  required
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Confirms legal authorization for voice cloning per AI safety regulations.
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    if (cloneAudioUrl) URL.revokeObjectURL(cloneAudioUrl);
                    setCloneAudioUrl(null);
                    setModalType(null);
                  }}
                  disabled={isCloning}
                  className="btn btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCloning || !cloneVoiceName.trim() || !cloneAudioFile}
                  className="btn btn-primary text-xs flex items-center gap-1.5 shadow-md shadow-violet-600/30 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-bold"
                >
                  {isCloning ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                      Cloning Voice with ElevenLabs…
                    </>
                  ) : (
                    <>
                      <span>🚀</span> Clone Voice with ElevenLabs
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RENAME VOICE IN LIBRARY */}
      {modalType === 'rename_voice' && renameVoiceTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="card w-full max-w-md p-6 bg-slate-900 border-violet-500/40 shadow-2xl">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <span>✏️</span> Rename Voice Clone
              </h3>
              <button
                type="button"
                onClick={() => setModalType(null)}
                className="text-slate-400 hover:text-slate-200 text-lg leading-none p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRenameSubmit} className="space-y-4">
              <div>
                <label className="label text-xs font-bold text-slate-200">Voice ID</label>
                <div className="p-2 rounded bg-slate-950 border border-slate-800 font-mono text-xs text-slate-400 truncate">
                  {renameVoiceTarget.voice_id}
                </div>
              </div>

              <div>
                <label className="label text-xs font-bold text-slate-200">
                  New Voice Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={renameVoiceName}
                  onChange={(e) => setRenameVoiceName(e.target.value)}
                  className="input text-xs"
                  required
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalType(null)}
                  disabled={isRenaming}
                  className="btn btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRenaming || !renameVoiceName.trim()}
                  className="btn btn-primary text-xs flex items-center gap-1.5 shadow-md shadow-violet-600/30"
                >
                  {isRenaming ? 'Saving…' : '✓ Save Name'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
