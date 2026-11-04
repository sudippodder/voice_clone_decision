'use client';

import React, { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const KEY = process.env.NEXT_PUBLIC_ADMIN_API_KEY || 'change-this-admin-key';

interface ConversationListItem {
  id: number;
  client_id: number;
  title: string;
  summary: string;
  channel: string;
  duration_seconds: number;
  message_count: number;
  created_at: string | null;
  updated_at: string | null;
}

interface MessageItem {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  created_at: string | null;
  audio_url: string | null;
  audio_duration: number | null;
  audio_mime: string | null;
}

interface ConversationDetail extends ConversationListItem {
  messages: MessageItem[];
}

export function ConversationHistory({ clientId }: { clientId: number }) {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeConv, setActiveConv] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [downloadingAudio, setDownloadingAudio] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Load conversation list
  async function loadConversations(selectFirst = false) {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API}/api/clients/${clientId}/conversations`, {
        headers: { 'X-Admin-Key': KEY },
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to load conversations');
      }
      const data: ConversationListItem[] = await res.json();
      setConversations(data);

      if (selectFirst && data.length > 0) {
        setSelectedId(data[0].id);
      } else if (selectedId && !data.some((c) => c.id === selectedId)) {
        setSelectedId(data.length > 0 ? data[0].id : null);
      }
    } catch (err: any) {
      setError(err.message || 'Error loading conversation history');
    } finally {
      setLoading(false);
    }
  }

  // Load single conversation detail
  async function loadConversationDetail(convId: number) {
    try {
      setLoadingDetail(true);
      const res = await fetch(`${API}/api/clients/${clientId}/conversations/${convId}`, {
        headers: { 'X-Admin-Key': KEY },
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to load conversation details');
      }
      const data: ConversationDetail = await res.json();
      setActiveConv(data);
    } catch (err: any) {
      console.error('Failed to load conversation detail:', err);
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    loadConversations(true);
  }, [clientId]);

  useEffect(() => {
    if (selectedId) {
      loadConversationDetail(selectedId);
    } else {
      setActiveConv(null);
    }
  }, [selectedId]);

  // Download entire call recording as concatenated WAV
  async function downloadCallAudio(convId: number) {
    try {
      setDownloadingAudio(true);
      const res = await fetch(`${API}/api/clients/${clientId}/conversations/${convId}/audio`, {
        headers: { 'X-Admin-Key': KEY },
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'No audio recordings found for this call');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `call_recording_client_${clientId}_conv_${convId}.wav`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message || 'Error downloading call audio recording');
    } finally {
      setDownloadingAudio(false);
    }
  }

  // Delete conversation & on-disk audio recordings
  async function handleDelete(convId: number) {
    if (!confirm('Are you sure you want to permanently delete this conversation and all saved voice audio recordings?')) {
      return;
    }
    try {
      setDeletingId(convId);
      const res = await fetch(`${API}/api/clients/${clientId}/conversations/${convId}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Key': KEY },
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to delete conversation');
      }
      // Reload list
      await loadConversations(false);
      if (selectedId === convId) {
        const remaining = conversations.filter((c) => c.id !== convId);
        setSelectedId(remaining.length > 0 ? remaining[0].id : null);
      }
    } catch (err: any) {
      alert(err.message || 'Error deleting conversation');
    } finally {
      setDeletingId(null);
    }
  }

  // Format helpers
  function formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return '0s';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  }

  function formatDate(isoString: string | null): string {
    if (!isoString) return 'Just now';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  }

  // Filtered conversations
  const filtered = conversations.filter((c) => {
    const matchesSearch =
      !searchQuery.trim() ||
      c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.summary.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesChannel =
      channelFilter === 'all' ||
      (channelFilter === 'realtime' && c.channel?.includes('realtime')) ||
      (channelFilter === 'http' && c.channel?.includes('http'));
    return matchesSearch && matchesChannel;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner / Controls */}
      <div className="card p-5 bg-[#111624] border border-[#252d40] flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <span>📻</span> Call History & Voice Recordings
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Review past voice conversations, read database-grounded transcripts, listen to user and cloned executive voice tracks, and download audio recordings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => loadConversations(false)}
            className="btn btn-secondary text-xs flex items-center gap-1.5"
            disabled={loading}
          >
            <span>🔄</span> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="card p-4 bg-red-950/40 border border-red-800 text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Main Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Conversation Sessions List */}
        <div className="lg:col-span-5 card p-4 bg-[#111624] border border-[#252d40] space-y-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Recorded Sessions ({filtered.length})
            </span>
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="text-xs bg-[#0c111d] border border-[#30394e] text-slate-300 rounded px-2 py-1 outline-none"
            >
              <option value="all">All Channels</option>
              <option value="realtime">Real-time Voice</option>
              <option value="http">Standard Turn</option>
            </select>
          </div>

          {/* Search box */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search by topic or title…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#0c111d] border border-[#30394e] rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2 text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>

          {/* List items */}
          <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
            {loading && conversations.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Loading call history…
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-[#252d40] rounded-xl text-slate-500 text-xs">
                {conversations.length === 0
                  ? 'No voice conversations recorded yet. Start a conversation in the "Talk to Agent" tab!'
                  : 'No conversations match your search filter.'}
              </div>
            ) : (
              filtered.map((c) => {
                const isSelected = c.id === selectedId;
                const isRealtime = c.channel?.includes('realtime');
                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-[#1e1b4b]/60 border-indigo-500/70 shadow-lg shadow-indigo-500/10'
                        : 'bg-[#0d1220] border-[#252d40] hover:border-[#38425a] hover:bg-[#131929]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-semibold text-slate-100 line-clamp-1">
                        {c.title || `Conversation #${c.id}`}
                      </h4>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(c.id);
                        }}
                        disabled={deletingId === c.id}
                        title="Delete conversation & audio"
                        className="text-slate-500 hover:text-rose-400 text-xs px-1 py-0.5 rounded transition-colors"
                      >
                        {deletingId === c.id ? '…' : '🗑'}
                      </button>
                    </div>

                    {c.summary && (
                      <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                        {c.summary}
                      </p>
                    )}

                    <div className="flex items-center flex-wrap gap-2 mt-2.5 pt-2 border-t border-[#1f2739] text-[11px] text-slate-400">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          isRealtime
                            ? 'bg-indigo-900/60 text-indigo-300 border border-indigo-700/50'
                            : 'bg-sky-900/60 text-sky-300 border border-sky-700/50'
                        }`}
                      >
                        {isRealtime ? '⚡ Real-Time' : '🎙 Standard'}
                      </span>
                      <span>⏱ {formatDuration(c.duration_seconds)}</span>
                      <span>💬 {c.message_count} msgs</span>
                      <span className="ml-auto text-[10px] text-slate-500">
                        {formatDate(c.updated_at || c.created_at)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Detailed Transcript & Audio Players */}
        <div className="lg:col-span-7 card p-5 bg-[#111624] border border-[#252d40] min-h-[500px]">
          {loadingDetail ? (
            <div className="p-16 text-center text-slate-400 text-sm">
              Loading conversation details & audio tracks…
            </div>
          ) : !activeConv ? (
            <div className="p-16 text-center text-slate-500 space-y-2">
              <span className="text-3xl block">🎙</span>
              <p className="text-sm font-medium">Select a conversation session on the left</p>
              <p className="text-xs">You will see the complete transcripts, speech playback, and full call download options.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Conversation Header */}
              <div className="p-4 rounded-xl bg-[#0d1220] border border-[#252d40] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      {activeConv.title || `Conversation #${activeConv.id}`}
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Recorded {formatDate(activeConv.created_at)} • Channel: <span className="text-slate-300 font-semibold">{activeConv.channel}</span>
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => downloadCallAudio(activeConv.id)}
                      disabled={downloadingAudio}
                      className="btn btn-primary text-xs flex items-center gap-1.5 py-1.5 px-3"
                      title="Download the full call audio concatenated as a single WAV file"
                    >
                      <span>📥</span>
                      {downloadingAudio ? 'Preparing Audio…' : 'Download Full Call (.WAV)'}
                    </button>
                    <button
                      onClick={() => handleDelete(activeConv.id)}
                      className="btn btn-quiet-danger text-xs py-1.5 px-2.5"
                      title="Delete conversation"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {activeConv.summary && (
                  <div className="p-3 bg-[#111728] rounded-lg border border-[#20293d] text-xs text-slate-300 leading-relaxed">
                    <strong className="text-indigo-300 block mb-1">Executive Summary:</strong>
                    {activeConv.summary}
                  </div>
                )}

                <div className="flex items-center gap-4 text-xs text-slate-400 pt-1">
                  <div>
                    Total Duration: <strong className="text-slate-200">{formatDuration(activeConv.duration_seconds)}</strong>
                  </div>
                  <div>
                    Total Exchanges: <strong className="text-slate-200">{activeConv.messages.length} messages</strong>
                  </div>
                </div>
              </div>

              {/* Message Feed */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
                  Exchanges & Voice Audio Tracks
                </h4>

                {activeConv.messages.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-[#252d40] rounded-xl">
                    No messages recorded in this session.
                  </div>
                ) : (
                  activeConv.messages.map((m) => {
                    const isUser = m.role === 'user';
                    return (
                      <div
                        key={m.id}
                        className={`p-4 rounded-xl border space-y-2.5 transition-all ${
                          isUser
                            ? 'bg-[#121b2d] border-[#223352] mr-0 ml-auto max-w-[92%]'
                            : 'bg-[#151329] border-[#342852] ml-0 mr-auto max-w-[96%]'
                        }`}
                      >
                        {/* Header */}
                        <div className="flex items-center justify-between text-xs">
                          <span
                            className={`font-bold flex items-center gap-1.5 ${
                              isUser ? 'text-sky-300' : 'text-purple-300'
                            }`}
                          >
                            <span>{isUser ? '👤' : '👔'}</span>
                            <span>{isUser ? 'User Voice Query' : 'Digital Executive (Cloned Voice)'}</span>
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {formatDate(m.created_at)}
                          </span>
                        </div>

                        {/* Text Content */}
                        <p className="text-sm text-slate-100 leading-relaxed whitespace-pre-wrap">
                          {m.text}
                        </p>

                        {/* Audio Player (if recorded) */}
                        {m.audio_url ? (
                          <div className="mt-3 pt-2.5 border-t border-slate-700/40 space-y-1.5">
                            <div className="flex items-center justify-between text-[11px] text-slate-400">
                              <span className="flex items-center gap-1 font-medium text-slate-300">
                                <span>🔊</span> Audio Recording
                                {m.audio_duration ? ` (${formatDuration(m.audio_duration)})` : ''}
                              </span>
                              <a
                                href={`${API}${m.audio_url}`}
                                download={`msg_${m.id}_${m.role}.wav`}
                                className="text-indigo-400 hover:text-indigo-300 underline font-medium"
                              >
                                Download Clip
                              </a>
                            </div>
                            <audio
                              controls
                              preload="metadata"
                              src={`${API}${m.audio_url}`}
                              className="w-full h-8 outline-none rounded bg-[#0b0f19]"
                            />
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-500 italic pt-1">
                            (Text-only input — no audio track captured)
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

