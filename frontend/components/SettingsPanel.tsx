'use client';
import { useState, useEffect } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const KEY = process.env.NEXT_PUBLIC_ADMIN_API_KEY || 'change-this-admin-key';

const STANDARD_CONSENT =
  'I explicitly authorize this system to generate synthetic speech and create a digital voice twin representative for my AI executive representative.';

const sections = [
  ['about', 'Executive Profile'],
  ['personality', 'Personality'],
  ['leadership_style', 'Leadership Style'],
  ['decision_making', 'Thinking & Decision Making'],
  ['communication_style', 'Communication Style'],
  ['business_context', 'Business & Knowledge'],
  ['people_context', 'People & Relationships'],
  ['decision_principles', 'Decision Principles'],
  ['agent_rules', 'Agent Rules'],
];

const OPENAI_VOICE_PRESETS = [
  {
    id: 'onyx',
    name: 'Onyx',
    tone: 'Authoritative, Deep, Executive',
    badge: 'Recommended for Leadership',
    desc: 'Deep gravitas and commanding presence. Ideal for CEOs, Founders, and Senior Leaders.',
  },
  {
    id: 'alloy',
    name: 'Alloy',
    tone: 'Neutral, Balanced, Precise',
    badge: 'Corporate Standard',
    desc: 'Clear, modern delivery suitable for technology, finance, and operational briefings.',
  },
  {
    id: 'echo',
    name: 'Echo',
    tone: 'Calm, Deliberate, Thoughtful',
    badge: 'Analytical',
    desc: 'Steady, measured cadence; communicates deep deliberation and calculated strategy.',
  },
  {
    id: 'nova',
    name: 'Nova',
    tone: 'Warm, Dynamic, Articulate',
    badge: 'Executive Presence',
    desc: 'Engaging, warm executive presence with energetic and articulate pronunciation.',
  },
  {
    id: 'fable',
    name: 'Fable',
    tone: 'Charismatic, British-tinged',
    badge: 'Distinguished',
    desc: 'Polished, expressive tone suitable for international advisory and boardroom dialogue.',
  },
  {
    id: 'shimmer',
    name: 'Shimmer',
    tone: 'Clear, Optimistic, Sharp',
    badge: 'Bright & Crisp',
    desc: 'Crisp enunciation, forward-looking, accessible and confident delivery.',
  },
  {
    id: 'ash',
    name: 'Ash',
    tone: 'Direct, Decisive, Confident',
    badge: 'Action-Oriented',
    desc: 'Concise, focused tone; perfect for rapid, no-fluff executive conversations.',
  },
  {
    id: 'coral',
    name: 'Coral',
    tone: 'Conversational, Empathetic',
    badge: 'Partner-facing',
    desc: 'Approachable, warm tone for talent management, partner alliances, and client relations.',
  },
  {
    id: 'sage',
    name: 'Sage',
    tone: 'Smooth, Composed, Analytical',
    badge: 'Advisory Intelligence',
    desc: 'Soothing yet razor-sharp cadence for high-level strategy and executive intelligence.',
  },
];

export function SettingsPanel({
  data,
  onSaved,
  onTalkToAgent,
}: {
  data: any;
  onSaved: () => void;
  onTalkToAgent?: () => void;
}) {
  const p = data.profile || {};

  const [form, setForm] = useState({ ...p });
  const [saving, setSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');

  // Editable Executive Identity states
  const [executiveName, setExecutiveName] = useState(data.client?.executive_name || '');
  const [companyName, setCompanyName] = useState(data.client?.company || '');
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [identityMsg, setIdentityMsg] = useState('');

  // Voice Twin states
  const initialProvider = p.voice_provider === 'cosyvoice' ? 'elevenlabs' : (p.voice_provider || 'elevenlabs');
  const initialVoiceId = p.voice_id === 'ceo_voice_clone' ? 'onyx' : (p.voice_id || 'bfJAAFM54j2wqqMBZL9Y');
  const initialVoiceName = p.voice_name || (initialProvider === 'elevenlabs' ? `${data.client?.executive_name || 'Executive'} Voice Clone` : 'Default Persona');

  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [consent, setConsent] = useState(p.voice_consent_text || STANDARD_CONSENT);
  const [customVoiceId, setCustomVoiceId] = useState(initialVoiceId);
  const [voiceName, setVoiceName] = useState(initialVoiceName);
  const [cloneVoiceName, setCloneVoiceName] = useState(`${data.client?.executive_name || 'Executive'} Voice Clone`);
  const [voiceProvider, setVoiceProvider] = useState(initialProvider);
  const [activeVoiceTab, setActiveVoiceTab] = useState<'clone' | 'library' | 'openai'>('clone');
  const [cloning, setCloning] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState('');
  const [voiceError, setVoiceError] = useState('');

  // ElevenLabs library state
  const [elevenVoices, setElevenVoices] = useState<any[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [hasElevenKey, setHasElevenKey] = useState(false);
  const [voiceFilter, setVoiceFilter] = useState('');

  // Audio preview state
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);

  const setField = (k: string, v: string) => setForm((x: any) => ({ ...x, [k]: v }));

  // Keep cloneVoiceName in sync if user changes executive name and cloneVoiceName was default
  useEffect(() => {
    if (executiveName && (!cloneVoiceName || cloneVoiceName.includes('Voice Clone'))) {
      setCloneVoiceName(`${executiveName} Voice Clone`);
    }
  }, [executiveName]);

  // Load ElevenLabs voices list
  useEffect(() => {
    setLoadingVoices(true);
    fetch(`${API}/api/voice/elevenlabs/voices`, { headers: { 'X-Admin-Key': KEY } })
      .then((r) => r.json())
      .then((j) => {
        if (j.voices) setElevenVoices(j.voices);
        if (j.has_key) setHasElevenKey(true);
      })
      .catch((err) => console.log('Notice: ElevenLabs voices not loaded:', err))
      .finally(() => setLoadingVoices(false));
  }, []);

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] || null;
    setVoiceFile(f);
    setVoiceError('');
    if (f) {
      setAudioPreviewUrl(URL.createObjectURL(f));
    } else {
      setAudioPreviewUrl(null);
    }
  }

  async function playPreview(voiceId: string, provider: string = 'elevenlabs', sampleText?: string) {
    if (currentAudio) {
      currentAudio.pause();
      setCurrentAudio(null);
    }
    if (previewingVoice === voiceId) {
      setPreviewingVoice(null);
      return;
    }
    setPreviewingVoice(voiceId);

    const txt = sampleText || `Hello, I am the authorized AI voice representative for ${executiveName || data.client.executive_name}. Voice synthesis is fully operational.`;

    try {
      const res = await fetch(
        `${API}/api/voice/preview?voice=${encodeURIComponent(voiceId)}&provider=${encodeURIComponent(provider)}&text=${encodeURIComponent(txt)}`,
        { headers: { 'X-Admin-Key': KEY } }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.detail || 'Voice preview synthesis failed.');
      }
      const json = await res.json();
      if (json.audio_base64) {
        const audio = new Audio(`data:${json.mime_type};base64,${json.audio_base64}`);
        setCurrentAudio(audio);
        audio.onended = () => {
          setPreviewingVoice(null);
          setCurrentAudio(null);
        };
        await audio.play();
      } else if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(txt);
        u.onend = () => setPreviewingVoice(null);
        window.speechSynthesis.speak(u);
      }
    } catch (err: any) {
      setPreviewingVoice(null);
      setVoiceError(err.message || 'Audio preview failed.');
    }
  }

  async function saveIdentity() {
    if (!executiveName.trim()) {
      setIdentityMsg('Executive name is required.');
      return;
    }
    setSavingIdentity(true);
    setIdentityMsg('');
    try {
      const res = await fetch(`${API}/api/clients/${data.client.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': KEY },
        body: JSON.stringify({
          executive_name: executiveName.trim(),
          company: companyName.trim(),
        }),
      });
      setSavingIdentity(false);
      if (res.ok) {
        setIdentityMsg('✓ Executive identity updated successfully.');
        onSaved();
      } else {
        const j = await res.json().catch(() => ({}));
        setIdentityMsg(j.detail || 'Failed to update executive identity.');
      }
    } catch (e: any) {
      setSavingIdentity(false);
      setIdentityMsg(e.message || 'Network error updating identity.');
    }
  }

  async function saveProfile() {
    setSaving(true);
    setProfileMsg('');
    try {
      // 1. Persist editable executive identity simultaneously
      if (executiveName.trim()) {
        await fetch(`${API}/api/clients/${data.client.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Key': KEY },
          body: JSON.stringify({
            executive_name: executiveName.trim(),
            company: companyName.trim(),
          }),
        });
      }

      // 2. Persist profile details
      const r = await fetch(`${API}/api/clients/${data.client.id}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': KEY },
        body: JSON.stringify({
          ...form,
          voice_name: voiceName,
          agent_call_name: form.agent_call_name || executiveName.trim().split(' ')[0] || 'Shaun',
        }),
      });
      setSaving(false);
      if (r.ok) {
        setProfileMsg('✓ Executive profile and identity saved successfully.');
        onSaved();
      } else {
        const j = await r.json().catch(() => ({}));
        setProfileMsg(j.detail || 'Save failed.');
      }
    } catch (e: any) {
      setSaving(false);
      setProfileMsg(e.message || 'Network error saving profile.');
    }
  }

  async function uploadAndCloneVoice() {
    setVoiceMsg('');
    setVoiceError('');

    if (!voiceFile) {
      setVoiceError('Please choose an audio file (.mp3, .wav, .m4a, or .webm) containing the executive’s voice.');
      return;
    }

    if (!consent.trim()) {
      setVoiceError('Voice authorization / consent record is required before cloning.');
      return;
    }

    const targetCloneName = cloneVoiceName.trim() || `${executiveName.trim() || 'Executive'} Voice Clone`;

    setCloning(true);
    setVoiceMsg(`Uploading sample and creating Instant Voice Clone "${targetCloneName}" via ElevenLabs AI…`);

    try {
      const fd = new FormData();
      fd.append('file', voiceFile);
      fd.append('consent_text', consent);
      fd.append('voice_name', targetCloneName);
      fd.append('provider', 'elevenlabs');

      const r = await fetch(`${API}/api/clients/${data.client.id}/voice/clone`, {
        method: 'POST',
        headers: { 'X-Admin-Key': KEY },
        body: fd,
      });

      const j = await r.json().catch(() => ({}));
      setCloning(false);

      if (r.ok) {
        const returnedName = j.voice_name || targetCloneName;
        setVoiceMsg(`✓ Voice "${returnedName}" cloned via ElevenLabs POST /v1/voices/add! voice_id "${j.voice_id}" successfully saved to database.`);
        setCustomVoiceId(j.voice_id);
        setVoiceName(returnedName);
        setVoiceProvider(j.provider || 'elevenlabs');
        onSaved();
      } else {
        setVoiceError(j.detail || 'Failed to clone voice sample.');
        setVoiceMsg('');
      }
    } catch (e: any) {
      setCloning(false);
      setVoiceError(e.message || 'Network error during voice clone upload.');
      setVoiceMsg('');
    }
  }

  async function saveVoiceConfig(voiceIdToUse?: string, providerToUse?: string, voiceNameToUse?: string) {
    setVoiceMsg('');
    setVoiceError('');

    const targetVoiceId = voiceIdToUse !== undefined ? voiceIdToUse : customVoiceId.trim();
    const targetProvider = providerToUse !== undefined ? providerToUse : (voiceProvider || 'elevenlabs');
    const targetVoiceName = voiceNameToUse !== undefined ? voiceNameToUse : (voiceName.trim() || `${executiveName || 'Executive'} Voice Clone`);

    if (!targetVoiceId) {
      setVoiceError('Please select or enter a Voice ID.');
      return;
    }

    const consentTextToUse = consent.trim() || STANDARD_CONSENT;

    setManualSaving(true);
    try {
      const r = await fetch(`${API}/api/clients/${data.client.id}/voice`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': KEY },
        body: JSON.stringify({
          voice_id: targetVoiceId,
          voice_name: targetVoiceName,
          voice_provider: targetProvider,
          voice_authorized: true,
          voice_consent_text: consentTextToUse,
        }),
      });

      const j = await r.json().catch(() => ({}));
      setManualSaving(false);

      if (r.ok) {
        setVoiceMsg(`✓ Saved voice "${targetVoiceName}" (ID: ${targetVoiceId}, ${targetProvider.toUpperCase()}) to profile.`);
        setCustomVoiceId(targetVoiceId);
        setVoiceName(targetVoiceName);
        setVoiceProvider(targetProvider);
        onSaved();
      } else {
        setVoiceError(j.detail || 'Failed to update voice configuration.');
      }
    } catch (e: any) {
      setManualSaving(false);
      setVoiceError(e.message || 'Network error updating voice configuration.');
    }
  }

  async function saveVoiceNameOnly() {
    const targetName = voiceName.trim();
    if (!targetName) {
      setVoiceError('Voice clone name cannot be empty.');
      return;
    }
    setVoiceMsg('');
    setVoiceError('');
    setManualSaving(true);
    try {
      const r = await fetch(`${API}/api/clients/${data.client.id}/voice/name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': KEY },
        body: JSON.stringify({ voice_name: targetName }),
      });
      const j = await r.json().catch(() => ({}));
      setManualSaving(false);
      if (r.ok) {
        setVoiceMsg(`✓ ${j.message || `Voice clone renamed to "${targetName}"!`}`);
        setVoiceName(targetName);
        onSaved();
      } else {
        setVoiceError(j.detail || 'Failed to rename voice clone.');
      }
    } catch (e: any) {
      setManualSaving(false);
      setVoiceError(e.message || 'Network error updating voice clone name.');
    }
  }

  const isCurrentVoice = (id: string, prov: string) =>
    customVoiceId.toLowerCase() === id.toLowerCase() && voiceProvider === prov;

  const filteredElevenVoices = elevenVoices.filter(
    (v) =>
      v.name.toLowerCase().includes(voiceFilter.toLowerCase()) ||
      v.voice_id.toLowerCase().includes(voiceFilter.toLowerCase()) ||
      (v.description && v.description.toLowerCase().includes(voiceFilter.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* 1. Editable Executive Identity */}
      <div className="card p-6 border-violet-500/20 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <span>👤</span> Executive Identity & Representation
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Edit the executive’s name, business, and language representation settings.
            </p>
          </div>
          <button
            type="button"
            onClick={saveIdentity}
            disabled={savingIdentity}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-violet-600 hover:bg-violet-500 text-white shadow-md shadow-violet-600/20 transition flex items-center gap-1.5 self-start sm:self-auto"
          >
            {savingIdentity ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                Saving Identity…
              </>
            ) : (
              <>
                <span>💾</span> Save Executive Name
              </>
            )}
          </button>
        </div>

        {identityMsg && (
          <div className="mb-4 text-xs font-semibold px-3.5 py-2.5 rounded-xl bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 flex items-center gap-2">
            <span>✓</span> {identityMsg}
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="label text-xs font-bold text-slate-300">
              Executive Name <span className="text-violet-400">*</span>
            </label>
            <input
              className="input font-semibold text-white focus:border-violet-500 bg-slate-900"
              value={executiveName}
              onChange={(e) => setExecutiveName(e.target.value)}
              placeholder="e.g. Shaun Morgan, Sudip Podder"
            />
            <p className="text-[11px] text-slate-400 mt-1">Primary executive persona name represented by the AI</p>
          </div>
          <div>
            <label className="label text-xs font-bold text-slate-300">Company / Organization</label>
            <input
              className="input text-white focus:border-violet-500 bg-slate-900"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Demo Company, Tech Corp"
            />
            <p className="text-[11px] text-slate-400 mt-1">Company affiliation for business context</p>
          </div>
          <div>
            <label className="label text-xs font-bold text-slate-300">Preferred Language</label>
            <input
              className="input focus:border-violet-500 bg-slate-900"
              value={form.preferred_language || ''}
              onChange={(e) => setField('preferred_language', e.target.value)}
              placeholder="e.g. English, Spanish"
            />
            <p className="text-[11px] text-slate-400 mt-1">Language for LLM responses & synthesis</p>
          </div>
        </div>
      </div>

      {/* 2. Digital Profile */}
      <div className="card p-6">
        <h3 className="text-lg font-bold mb-4">Digital Executive Profile</h3>
        <div className="grid md:grid-cols-2 gap-5">
          {sections.map(([key, title]) => (
            <div key={key} className="md:col-span-1">
              <label className="label">{title}</label>
              <textarea
                className="input min-h-28"
                value={form[key] || ''}
                onChange={(e) => setField(key, e.target.value)}
                placeholder={`Describe ${title.toLowerCase()} in the client's own words…`}
              />
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button className="btn btn-primary" onClick={saveProfile} disabled={saving}>
            {saving ? 'Saving…' : 'Save Executive Profile & Identity'}
          </button>
          {profileMsg && <span className="text-sm text-slate-300">{profileMsg}</span>}
        </div>
      </div>

      {/* 3. Voice Digital Twin & Voice Cloning Studio */}
      <div className="card p-6 border-violet-500/30">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-5 mb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">🎙️</span>
              <h3 className="text-xl font-bold text-white">Digital Voice Twin Studio</h3>
              <span className="text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
                ElevenLabs Voice Engine
              </span>
            </div>
            <p className="text-sm text-slate-400 mt-1">
              Upload executive voice recordings to clone, or connect custom and library voice IDs.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            {customVoiceId && p.voice_authorized ? (
              <div className="flex items-center gap-2 flex-wrap">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-white font-bold">{voiceName || 'Executive Clone'}</span>
                    <span className="text-slate-500">•</span>
                    <span className="font-mono text-emerald-200">{customVoiceId}</span>
                    <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 text-[10px] text-emerald-300 uppercase border border-emerald-500/30">
                      {voiceProvider === 'elevenlabs' ? 'ElevenLabs' : voiceProvider.toUpperCase()}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => playPreview(customVoiceId, voiceProvider)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white flex items-center gap-1.5 shadow-sm transition"
                >
                  {previewingVoice === customVoiceId ? '■ Playing…' : '▶ Test Voice'}
                </button>
              </div>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                No Authorized Voice Set
              </span>
            )}
          </div>
        </div>

        {/* Saved Voice Clone Name Quick-Editor */}
        <div className="mb-5 p-4 rounded-xl bg-slate-900/90 border border-violet-500/30 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm">
          <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2.5">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-violet-400">🏷️</span>
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wide">
                Active Voice Clone Name:
              </span>
            </div>
            <input
              type="text"
              value={voiceName}
              onChange={(e) => setVoiceName(e.target.value)}
              placeholder="e.g. Sudip Podder Voice Clone"
              className="input py-2 px-3 text-xs font-semibold text-white flex-1 bg-slate-950 focus:border-violet-500"
            />
          </div>
          <button
            type="button"
            onClick={saveVoiceNameOnly}
            disabled={manualSaving}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold rounded-lg transition shadow-md flex items-center gap-1.5 shrink-0 self-end md:self-auto"
          >
            {manualSaving ? 'Saving…' : '💾 Update Voice Name'}
          </button>
        </div>

        {/* Status Banners */}
        {voiceMsg && (
          <div className="mb-5 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-base">✓</span>
              <span>{voiceMsg}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {customVoiceId && (
                <button
                  type="button"
                  onClick={() => playPreview(customVoiceId, voiceProvider)}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition"
                >
                  ▶ Test Audio
                </button>
              )}
              {onTalkToAgent && (
                <button
                  type="button"
                  onClick={onTalkToAgent}
                  className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-bold flex items-center gap-1 transition"
                >
                  🎙️ Talk to Agent
                </button>
              )}
            </div>
          </div>
        )}


        {voiceError && (
          <div className="mb-5 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-sm">
            <div className="font-semibold text-red-300 mb-1 flex items-center gap-1.5">
              <span>⚠️</span> Voice Configuration Notice
            </div>
            <p className="leading-relaxed">{voiceError}</p>
          </div>
        )}

        {/* Consent Section */}
        <div className="mb-6 p-4 rounded-xl bg-slate-900/40 border border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              Executive Voice Authorization & Legal Consent Record
            </label>
            <button
              type="button"
              className="text-xs text-violet-400 hover:text-violet-300 underline"
              onClick={() => setConsent(STANDARD_CONSENT)}
            >
              Reset Standard Consent
            </button>
          </div>
          <textarea
            className="input min-h-16 text-xs text-slate-300 font-mono"
            value={consent}
            onChange={(e) => setConsent(e.target.value)}
            placeholder="Type or confirm executive voice authorization..."
          />
        </div>

        {/* Voice Feature Tabs */}
        <div className="flex border-b border-slate-800 mb-6 gap-2">
          <button
            type="button"
            onClick={() => setActiveVoiceTab('clone')}
            className={`pb-3 px-4 text-sm font-bold flex items-center gap-2 border-b-2 transition ${activeVoiceTab === 'clone'
                ? 'border-violet-500 text-violet-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
          >
            <span>🎙️</span>
            Instant Voice Cloning (Audio Upload)
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-600/30 text-violet-200 border border-violet-500/40 font-normal">
              Primary Feature
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveVoiceTab('library')}
            className={`pb-3 px-4 text-sm font-bold flex items-center gap-2 border-b-2 transition ${activeVoiceTab === 'library'
                ? 'border-violet-500 text-violet-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
          >
            <span>📁</span>
            ElevenLabs Library & Custom ID
            {elevenVoices.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300 font-normal">
                {elevenVoices.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveVoiceTab('openai')}
            className={`pb-3 px-4 text-sm font-bold flex items-center gap-2 border-b-2 transition ${activeVoiceTab === 'openai'
                ? 'border-violet-500 text-violet-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
          >
            <span>🤖</span>
            OpenAI Preset Personas
          </button>
        </div>

        {/* TAB 1: INSTANT VOICE CLONING VIA AUDIO UPLOAD */}
        {activeVoiceTab === 'clone' && (
          <div className="space-y-6">
            <div className="p-6 rounded-2xl bg-gradient-to-br from-violet-950/40 via-slate-900 to-slate-900 border border-violet-500/40 shadow-lg">
              <div className="max-w-2xl mb-5">
                <div className="text-xs font-bold uppercase tracking-wider text-violet-400 mb-1">
                  Audio Sample Upload · ElevenLabs API
                </div>
                <h4 className="text-lg font-bold text-white mb-1.5">
                  Clone {executiveName || data.client.executive_name}’s Voice
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed mb-4">
                  Upload an audio file (1 to 5 minutes of clean speaking without background noise) in <strong>.mp3, .wav, .m4a, or .webm</strong> format.
                  Our voice cloning engine calls ElevenLabs <code className="text-violet-300 bg-violet-950/80 px-1.5 py-0.5 rounded border border-violet-500/30 font-mono text-[11px]">POST /v1/voices/add</code> to generate a dedicated <code className="text-emerald-300 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-500/30 font-mono text-[11px]">voice_id</code> and saves it to the database for this executive.
                </p>

                {/* Voice Clone Name Input */}
                <div className="mb-5 p-4 rounded-xl bg-violet-950/20 border border-violet-500/40">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-violet-300 uppercase tracking-wider flex items-center gap-1.5">
                      <span>🏷️</span> Voice Clone Name <span className="text-violet-400">*</span>
                    </label>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 font-medium">
                      Editable Before & After Cloning
                    </span>
                  </div>
                  <input
                    type="text"
                    value={cloneVoiceName}
                    onChange={(e) => setCloneVoiceName(e.target.value)}
                    placeholder={`e.g. ${executiveName || 'Executive'} Voice Clone`}
                    className="input bg-slate-950 text-white font-semibold text-sm focus:border-violet-500 py-2.5"
                  />
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    Enter any custom name for your cloned voice (e.g. &quot;{executiveName || 'Executive'} Natural Voice&quot;). It will be saved in PostgreSQL and on your ElevenLabs account, and can be edited anytime.
                  </p>
                </div>

                {/* Pipeline visual diagram */}
                <div className="p-3.5 rounded-xl bg-slate-950/90 border border-violet-500/30">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-violet-400 mb-2 flex items-center gap-1.5">
                    <span>⚡</span> ElevenLabs Voice Cloning & Real-time Synthesis Pipeline
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
                      <div className="text-violet-300 font-bold mb-0.5 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-400"></span> 1. Audio Sample
                      </div>
                      <div className="text-slate-400 text-[11px]">Upload reference (.mp3/.wav)</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
                      <div className="text-violet-300 font-bold mb-0.5 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-400"></span> 2. ElevenLabs API
                      </div>
                      <div className="text-slate-400 text-[11px] font-mono">POST /v1/voices/add</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-900/90 border border-emerald-500/30 bg-emerald-950/20">
                      <div className="text-emerald-300 font-bold mb-0.5 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> 3. Save to DB
                      </div>
                      <div className="text-slate-400 text-[11px]">Attach voice_id & name to profile</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
                      <div className="text-violet-300 font-bold mb-0.5 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-400"></span> 4. Real-time TTS
                      </div>
                      <div className="text-slate-400 text-[11px]">LLM text ➔ Cloned Audio</div>
                    </div>
                  </div>
                </div>
              </div>


              {/* Upload Drop Area */}
              <div className="mb-5">
                <div className="border-2 border-dashed border-violet-500/40 hover:border-violet-400 rounded-xl p-6 text-center bg-violet-950/10 transition">
                  <input
                    id="executive-voice-file"
                    type="file"
                    accept="audio/*,.mp3,.wav,.m4a,.webm"
                    onChange={handleFileSelected}
                    className="hidden"
                  />
                  <label
                    htmlFor="executive-voice-file"
                    className="cursor-pointer flex flex-col items-center justify-center gap-2"
                  >
                    <span className="w-12 h-12 rounded-full bg-violet-600/20 border border-violet-500/40 flex items-center justify-center text-xl text-violet-300">
                      🎙️
                    </span>
                    <span className="text-sm font-bold text-violet-200 hover:underline">
                      {voiceFile ? 'Choose a different audio file' : 'Click to select audio file or drag & drop here'}
                    </span>
                    <span className="text-xs text-slate-400">
                      Supports MP3, WAV, M4A, WebM (Recommended: 30 seconds to 3 minutes of high clarity speech)
                    </span>
                  </label>
                </div>

                {/* Selected File Details & Audio Player */}
                {voiceFile && (
                  <div className="mt-4 p-4 rounded-xl bg-slate-900/90 border border-slate-700 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-400 font-bold">✓ Selected File:</span>
                        <strong className="text-white text-sm">{voiceFile.name}</strong>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                        {(voiceFile.size / (1024 * 1024)).toFixed(2)} MB
                      </span>
                    </div>

                    {audioPreviewUrl && (
                      <div>
                        <div className="text-[11px] text-slate-400 mb-1 font-medium">
                          Listen to uploaded audio sample:
                        </div>
                        <audio controls className="w-full h-8" src={audioPreviewUrl}>
                          Your browser does not support audio playback.
                        </audio>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <button
                  type="button"
                  onClick={uploadAndCloneVoice}
                  disabled={cloning || !voiceFile}
                  className={`w-full sm:w-auto px-6 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg transition ${cloning || !voiceFile
                      ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                      : 'bg-violet-600 hover:bg-violet-500 text-white shadow-violet-600/30 hover:scale-[1.01]'
                    }`}
                >
                  {cloning ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                      Cloning Voice with ElevenLabs…
                    </>
                  ) : (
                    <>
                      <span>🎙️</span>
                      Clone Voice & Activate for Executive
                    </>
                  )}
                </button>

                {customVoiceId && voiceProvider === 'elevenlabs' && (
                  <button
                    type="button"
                    onClick={() => playPreview(customVoiceId, 'elevenlabs')}
                    className="w-full sm:w-auto px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-sm font-semibold flex items-center justify-center gap-2 transition"
                  >
                    {previewingVoice === customVoiceId ? '■ Playing…' : '▶ Test My Cloned Voice'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: ELEVENLABS VOICE LIBRARY & CUSTOM VOICE ID */}
        {activeVoiceTab === 'library' && (
          <div className="space-y-6">
            <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h4 className="text-base font-bold text-white">Your ElevenLabs Voice Library</h4>
                  <p className="text-xs text-slate-400">
                    Select an existing custom cloned voice or premade voice from your ElevenLabs account.
                  </p>
                </div>
                <input
                  type="text"
                  placeholder="Filter voices…"
                  value={voiceFilter}
                  onChange={(e) => setVoiceFilter(e.target.value)}
                  className="input text-xs w-full sm:w-48 py-1.5"
                />
              </div>

              {loadingVoices ? (
                <div className="p-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin"></span>
                  Loading voices from ElevenLabs account…
                </div>
              ) : filteredElevenVoices.length > 0 ? (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-96 overflow-y-auto pr-1">
                  {filteredElevenVoices.map((v) => {
                    const isSelected = isCurrentVoice(v.voice_id, 'elevenlabs');
                    const isPlaying = previewingVoice === v.voice_id;

                    return (
                      <div
                        key={v.voice_id}
                        className={`p-3.5 rounded-xl border flex flex-col justify-between transition ${isSelected
                            ? 'bg-violet-950/40 border-violet-500 ring-1 ring-violet-500'
                            : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                          }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-white text-sm truncate">{v.name}</span>
                            <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                              {v.category || 'voice'}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 truncate mb-1">
                            ID: {v.voice_id}
                          </div>
                          {v.description && (
                            <p className="text-xs text-slate-400 line-clamp-2 mb-2">{v.description}</p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80 mt-2">
                          <button
                            type="button"
                            onClick={() => playPreview(v.voice_id, 'elevenlabs')}
                            className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 transition ${isPlaying
                                ? 'bg-emerald-600 text-white animate-pulse'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                              }`}
                          >
                            {isPlaying ? '■ Playing' : '▶ Preview'}
                          </button>

                          <button
                            type="button"
                            onClick={() => saveVoiceConfig(v.voice_id, 'elevenlabs', v.name)}
                            disabled={manualSaving}
                            className={`flex-1 py-1 px-2.5 rounded text-xs font-semibold transition ${isSelected
                                ? 'bg-emerald-600 text-white'
                                : 'bg-violet-600 hover:bg-violet-500 text-white'
                              }`}
                          >
                            {isSelected ? '✓ Active Voice' : 'Set as Voice'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-6 text-center text-xs text-slate-400">
                  No voices found matching &quot;{voiceFilter}&quot;.
                </div>
              )}
            </div>

            {/* Direct Custom Voice ID Input */}
            <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800">
              <h4 className="text-sm font-bold text-white mb-1">
                Enter Custom ElevenLabs Voice ID & Voice Name Directly
              </h4>
              <p className="text-xs text-slate-400 mb-3">
                If you cloned an executive voice directly on ElevenLabs (e.g. <code className="text-emerald-300 bg-emerald-950 px-1 py-0.5 rounded font-mono text-[11px]">bfJAAFM54j2wqqMBZL9Y</code>), enter the Voice ID and custom name below to save and activate it.
              </p>
              <div className="grid md:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="label text-xs font-bold text-slate-300">
                    ElevenLabs Voice ID <span className="text-violet-400">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. bfJAAFM54j2wqqMBZL9Y or EXAVITQu4vr4xnSDxMaL"
                    value={customVoiceId}
                    onChange={(e) => setCustomVoiceId(e.target.value)}
                    className="input font-mono text-sm bg-slate-950 text-white"
                  />
                </div>
                <div>
                  <label className="label text-xs font-bold text-slate-300">
                    Voice Clone Name
                  </label>
                  <input
                    type="text"
                    placeholder={`e.g. ${executiveName || 'Executive'} Custom Clone`}
                    value={voiceName}
                    onChange={(e) => setVoiceName(e.target.value)}
                    className="input text-sm bg-slate-950 text-white"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => playPreview(customVoiceId, 'elevenlabs')}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-bold"
                >
                  {previewingVoice === customVoiceId ? '■ Playing…' : '▶ Test Voice ID'}
                </button>
                <button
                  type="button"
                  onClick={() => saveVoiceConfig(customVoiceId, 'elevenlabs', voiceName)}
                  disabled={manualSaving}
                  className="px-5 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-bold transition"
                >
                  {manualSaving ? 'Saving…' : 'Save Voice Name & Activate ID'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: OPENAI PRESET PERSONAS */}
        {activeVoiceTab === 'openai' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-400">
                Standard OpenAI neural voices (tts-1 / tts-1-hd). Suitable as neutral personas when voice cloning is not required.
              </p>
              <span className="text-xs text-violet-400 font-mono">OpenAI TTS</span>
            </div>

            <div className="grid md:grid-cols-3 gap-3.5">
              {OPENAI_VOICE_PRESETS.map((voice) => {
                const isSelected = isCurrentVoice(voice.id, 'openai');
                const isPlaying = previewingVoice === voice.id;

                return (
                  <div
                    key={voice.id}
                    onClick={() => {
                      setCustomVoiceId(voice.id);
                      setVoiceProvider('openai');
                    }}
                    className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${isSelected
                        ? 'bg-violet-950/40 border-violet-500 shadow-[0_0_20px_rgba(139,92,246,0.25)] ring-1 ring-violet-500'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900/90'
                      }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-bold text-white text-base flex items-center gap-1.5">
                          {voice.name}
                          {isSelected && <span className="text-xs text-emerald-400">✓ Active</span>}
                        </span>
                        <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
                          {voice.badge}
                        </span>
                      </div>
                      <div className="text-xs text-violet-300 font-medium mb-1">
                        {voice.tone}
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed mb-3">
                        {voice.desc}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          playPreview(voice.id, 'openai');
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${isPlaying
                            ? 'bg-emerald-600 text-white animate-pulse'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                          }`}
                      >
                        {isPlaying ? '■ Playing…' : '▶ Preview'}
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          saveVoiceConfig(voice.id, 'openai');
                        }}
                        disabled={manualSaving}
                        className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition ${isSelected
                            ? 'bg-violet-600 hover:bg-violet-500 text-white shadow-sm'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                          }`}
                      >
                        {isSelected ? 'Saved as Active' : 'Select & Save'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
