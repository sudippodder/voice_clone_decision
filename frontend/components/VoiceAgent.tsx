'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const KEY = process.env.NEXT_PUBLIC_ADMIN_API_KEY || 'change-this-admin-key';

export function VoiceAgent({ data }: { data: any }) {
  const [recording, setRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [busyStep, setBusyStep] = useState('');
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlaybackPaused, setIsPlaybackPaused] = useState(false);
  const [lastAudioUrl, setLastAudioUrl] = useState<string | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const shouldSendRef = useRef<boolean>(true);
  const timerRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Timer logic during active recording
  useEffect(() => {
    if (recording && !isPaused) {
      timerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [recording, isPaused]);

  function formatTime(totalSeconds: number) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // --- RECORDING CONTROLS ---

  async function startRecording() {
    setError('');
    setTranscript('');
    setResponse('');
    setRecordSeconds(0);
    setIsPaused(false);
    shouldSendRef.current = true;

    // Stop any existing agent audio
    stopAudio();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      mediaRef.current = mr;
      chunks.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };

      mr.onstop = async () => {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }

        if (shouldSendRef.current && chunks.current.length > 0) {
          const blob = new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' });
          if (blob.size > 0) {
            await sendAudio(blob);
          } else {
            setError('No audio recorded. Please try speaking again.');
          }
        }
      };

      mr.start(250); // Emit chunks every 250ms for smooth buffering
      setRecording(true);
    } catch (e: any) {
      setError(e.message || 'Microphone access denied or audio device not found.');
      setRecording(false);
    }
  }

  function pauseRecording() {
    if (mediaRef.current && mediaRef.current.state === 'recording') {
      mediaRef.current.pause();
      setIsPaused(true);
    }
  }

  function resumeRecording() {
    if (mediaRef.current && mediaRef.current.state === 'paused') {
      mediaRef.current.resume();
      setIsPaused(false);
    }
  }

  function stopAndSend() {
    shouldSendRef.current = true;
    if (mediaRef.current && mediaRef.current.state !== 'inactive') {
      mediaRef.current.stop();
    }
    setRecording(false);
    setIsPaused(false);
  }

  function cancelRecording() {
    shouldSendRef.current = false;
    if (mediaRef.current && mediaRef.current.state !== 'inactive') {
      mediaRef.current.stop();
    }
    setRecording(false);
    setIsPaused(false);
    chunks.current = [];
    setRecordSeconds(0);
  }

  // --- PLAYBACK CONTROLS ---

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setIsPlaybackPaused(false);
  }, []);

  function pauseAudio() {
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      setIsPlaybackPaused(true);
      setIsPlaying(false);
    }
  }

  function resumeAudio() {
    if (audioRef.current && audioRef.current.paused) {
      audioRef.current.play().catch(() => {});
      setIsPlaybackPaused(false);
      setIsPlaying(true);
    }
  }

  function replayAudio() {
    if (!lastAudioUrl) return;
    stopAudio();
    const audio = new Audio(lastAudioUrl);
    audioRef.current = audio;
    audio.onplay = () => {
      setIsPlaying(true);
      setIsPlaybackPaused(false);
    };
    audio.onpause = () => {
      if (audio.currentTime < audio.duration) {
        setIsPlaybackPaused(true);
        setIsPlaying(false);
      }
    };
    audio.onended = () => {
      setIsPlaying(false);
      setIsPlaybackPaused(false);
    };
    audio.onerror = () => {
      setIsPlaying(false);
      setIsPlaybackPaused(false);
    };
    audio.play().catch(() => {});
  }

  // --- API CALL ---

  async function sendAudio(blob: Blob) {
    setBusy(true);
    setBusyStep('Transcribing your speech and evaluating response…');

    try {
      const fd = new FormData();
      fd.append('audio', blob, 'voice.webm');
      if (conversationId) fd.append('conversation_id', String(conversationId));

      const r = await fetch(`${API}/api/clients/${data.client.id}/voice/turn`, {
        method: 'POST',
        headers: { 'X-Admin-Key': KEY },
        body: fd,
      });

      const j = await r.json().catch(() => ({}));

      if (!r.ok) {
        throw new Error(j.detail || 'Voice turn request failed');
      }

      setConversationId(j.conversation_id);
      setTranscript(j.transcript || '');
      setResponse(j.response || '');

      if (j.audio_base64) {
        setBusyStep('Playing synthesized executive voice…');
        const audioUrl = `data:${j.mime_type || 'audio/mpeg'};base64,${j.audio_base64}`;
        setLastAudioUrl(audioUrl);

        stopAudio();
        const audio = new Audio(audioUrl);
        audioRef.current = audio;

        audio.onplay = () => {
          setIsPlaying(true);
          setIsPlaybackPaused(false);
        };
        audio.onpause = () => {
          if (audio.currentTime < audio.duration) {
            setIsPlaybackPaused(true);
            setIsPlaying(false);
          }
        };
        audio.onended = () => {
          setIsPlaying(false);
          setIsPlaybackPaused(false);
        };
        audio.onerror = () => {
          setIsPlaying(false);
          setIsPlaybackPaused(false);
        };

        await audio.play().catch(() => {});
      }
    } catch (e: any) {
      setError(e.message || 'Voice request failed.');
    } finally {
      setBusy(false);
      setBusyStep('');
    }
  }

  const isVoiceReady = Boolean(data.profile?.voice_authorized && data.profile?.voice_id);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Main Conversation Hub */}
      <div className="card p-8 text-center relative overflow-hidden bg-[#111624] border border-[#252d40] shadow-2xl">
        {/* Ambient Top Glow */}
        <div
          className={`absolute -top-24 left-1/2 -translate-x-1/2 w-80 h-32 blur-3xl pointer-events-none transition-all duration-700 ${
            recording
              ? isPaused
                ? 'bg-amber-500/20'
                : 'bg-red-500/25'
              : isPlaying
              ? 'bg-violet-600/30'
              : 'bg-indigo-600/10'
          }`}
        />

        {/* Header Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/30 text-violet-300 text-xs font-bold tracking-wider uppercase mb-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          DIGITAL EXECUTIVE VOICE AGENT
        </div>

        <h2 className="text-3xl font-black mt-2 text-white tracking-tight">
          {data.client.executive_name}
        </h2>

        <p className="text-sm text-slate-400 mt-1">
          {isVoiceReady ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
              <span>●</span> Authorized Digital Twin Active ({data.profile.voice_provider || 'ElevenLabs'})
            </span>
          ) : (
            <span className="text-amber-400 font-medium">
              ⚠️ Voice not authorized. Configure in Settings &gt; Voice.
            </span>
          )}
        </p>

        {/* Central Orb / Pulse Graphic */}
        <div className="relative mx-auto my-8 flex items-center justify-center">
          {/* Animated concentric ripples when recording */}
          {recording && !isPaused && (
            <>
              <div className="absolute w-44 h-44 rounded-full border border-red-500/30 animate-ping opacity-75" />
              <div className="absolute w-52 h-52 rounded-full border border-red-500/20 animate-pulse" />
            </>
          )}

          {/* Animated concentric ripples when AI is speaking */}
          {isPlaying && (
            <>
              <div className="absolute w-44 h-44 rounded-full border border-violet-500/30 animate-ping opacity-75" />
              <div className="absolute w-52 h-52 rounded-full border border-violet-500/20 animate-pulse" />
            </>
          )}

          <div
            className={`w-36 h-36 rounded-full flex flex-col items-center justify-center transition-all duration-300 border-2 shadow-inner relative z-10 ${
              recording
                ? isPaused
                  ? 'border-amber-400 bg-amber-500/15 shadow-amber-950/60'
                  : 'border-red-500 bg-red-500/20 shadow-red-950/60 scale-105'
                : isPlaying
                ? 'border-violet-400 bg-violet-600/20 shadow-violet-950/60 scale-105'
                : 'border-violet-500/40 bg-violet-500/10 hover:border-violet-400'
            }`}
          >
            <div className="text-5xl select-none">
              {recording ? (isPaused ? '⏸️' : '🎙️') : isPlaying ? '🔊' : '🎙️'}
            </div>

            {/* Live recording timer badge */}
            {recording && (
              <div
                className={`mt-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold tracking-wider ${
                  isPaused ? 'bg-amber-950/80 text-amber-300' : 'bg-red-950/80 text-red-300 animate-pulse'
                }`}
              >
                {formatTime(recordSeconds)}
              </div>
            )}
          </div>
        </div>

        {/* Live Status Description */}
        <p className="text-slate-300 text-sm font-medium mb-6 min-h-[24px]">
          {recording ? (
            isPaused ? (
              <span className="text-amber-300">
                ⏸️ <strong>Recording Paused</strong> ({formatTime(recordSeconds)}) — Click <em>Resume</em> to continue or <em>Stop &amp; Send</em>.
              </span>
            ) : (
              <span className="text-red-400">
                🔴 <strong>Listening to your voice</strong>… Click <em>Pause</em> or <em>Stop &amp; Send</em> when finished.
              </span>
            )
          ) : busy ? (
            <span className="text-violet-300 flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
              {busyStep || 'Thinking and synthesizing voice response…'}
            </span>
          ) : isPlaying ? (
            <span className="text-emerald-300 font-semibold flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              AI Executive is speaking… Click <em>Pause</em> or <em>Stop</em> anytime.
            </span>
          ) : isPlaybackPaused ? (
            <span className="text-amber-300">
              ⏸️ Audio speech paused. Click <em>Resume Speech</em> or <em>Stop</em>.
            </span>
          ) : (
            'Click "Start Talking" and speak to the digital executive representative.'
          )}
        </p>

        {/* Permanent Action Controls Dock (Always Visible) */}
        <div className="flex flex-wrap items-center justify-center gap-3 p-3 bg-[#0d1220] rounded-2xl border border-[#232b3e] max-w-xl mx-auto shadow-lg">
          {/* 1. START / RESUME RECORDING */}
          {!recording ? (
            <button
              id="btn-start-talking"
              className="btn btn-primary px-6 py-2.5 text-sm font-bold flex items-center gap-2 shadow-lg shadow-violet-950/50 hover:scale-[1.02] active:scale-[0.98] transition"
              onClick={startRecording}
              disabled={busy || !isVoiceReady}
            >
              <span>🎙️</span>
              <span>{busy ? 'Processing Turn…' : 'Start Talking'}</span>
            </button>
          ) : isPaused ? (
            <button
              id="btn-resume-recording"
              type="button"
              className="btn btn-primary px-6 py-2.5 text-sm font-bold flex items-center gap-2 shadow-lg shadow-violet-950/50 hover:scale-[1.02] active:scale-[0.98] transition"
              onClick={resumeRecording}
            >
              <span>▶️</span>
              <span>Resume</span>
            </button>
          ) : (
            <div className="btn bg-red-600/20 border border-red-500/50 text-red-300 px-5 py-2.5 text-sm font-bold flex items-center gap-2 cursor-default select-none">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400 animate-pulse" />
              <span>Recording ({formatTime(recordSeconds)})</span>
            </div>
          )}

          {/* 2. PAUSE BUTTON (Always visible) */}
          <button
            id="btn-pause-action"
            type="button"
            className={`btn flex items-center gap-2 px-5 py-2.5 text-sm font-bold transition ${
              (recording && !isPaused) || isPlaying
                ? 'btn-secondary text-amber-300 border-amber-500/40 hover:bg-amber-950/30'
                : isPaused
                ? 'btn-primary'
                : isPlaybackPaused
                ? 'btn-primary'
                : 'btn-secondary opacity-40 cursor-not-allowed'
            }`}
            onClick={() => {
              if (recording && !isPaused) pauseRecording();
              else if (recording && isPaused) resumeRecording();
              else if (isPlaying) pauseAudio();
              else if (isPlaybackPaused) resumeAudio();
            }}
            disabled={!recording && !isPlaying && !isPlaybackPaused}
            title={
              recording
                ? isPaused
                  ? 'Click to resume recording'
                  : 'Click to pause recording'
                : isPlaying
                ? 'Click to pause AI voice response'
                : isPlaybackPaused
                ? 'Click to resume AI voice response'
                : 'Pause (active while recording or listening to AI)'
            }
          >
            <span>{isPaused || isPlaybackPaused ? '▶️' : '⏸️'}</span>
            <span>
              {isPaused
                ? 'Resume'
                : isPlaybackPaused
                ? 'Resume Speech'
                : isPlaying
                ? 'Pause Speech'
                : 'Pause'}
            </span>
          </button>

          {/* 3. STOP BUTTON (Always visible) */}
          <button
            id="btn-stop-action"
            type="button"
            className={`btn flex items-center gap-2 px-6 py-2.5 text-sm font-bold transition ${
              recording
                ? 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-950/60'
                : isPlaying || isPlaybackPaused
                ? 'bg-red-950/60 hover:bg-red-900/60 border border-red-500/50 text-red-300'
                : 'btn-secondary opacity-40 cursor-not-allowed'
            }`}
            onClick={() => {
              if (recording) stopAndSend();
              else if (isPlaying || isPlaybackPaused) stopAudio();
            }}
            disabled={!recording && !isPlaying && !isPlaybackPaused}
            title={
              recording
                ? 'Stop recording and send audio to executive AI'
                : isPlaying || isPlaybackPaused
                ? 'Stop AI voice playback'
                : 'Stop (active while recording or listening to AI)'
            }
          >
            <span>⏹️</span>
            <span>
              {recording
                ? 'Stop & Send'
                : isPlaying || isPlaybackPaused
                ? 'Stop Speech'
                : 'Stop'}
            </span>
          </button>

          {/* 4. CANCEL RECORDING (Visible while recording or paused) */}
          {recording && (
            <button
              id="btn-cancel-recording"
              type="button"
              className="btn btn-quiet px-3 py-2 text-xs text-slate-400 hover:text-white"
              onClick={cancelRecording}
              title="Discard this recording without sending"
            >
              Discard
            </button>
          )}

          {/* 5. REPLAY PREVIOUS RESPONSE (Visible when audio available) */}
          {!recording && !isPlaying && !isPlaybackPaused && lastAudioUrl && (
            <button
              id="btn-replay-audio"
              type="button"
              className="btn btn-quiet px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-1.5 border border-slate-700"
              onClick={replayAudio}
              title="Replay previous AI speech"
            >
              <span>🔁</span>
              <span>Replay</span>
            </button>
          )}
        </div>

        {/* Missing Voice Warning Notice */}
        {!isVoiceReady && (
          <div className="mt-6 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs text-left flex items-start gap-2.5">
            <span className="text-base leading-none">⚠️</span>
            <div className="flex-1">
              <strong>Voice Twin Not Activated:</strong> An authorized voice clone has not been assigned to {data.client.executive_name}.
              Switch to the <strong>Settings &gt; Voice Digital Twin</strong> tab to select or clone an authorized voice before initiating conversation.
            </div>
          </div>
        )}

        {/* Error Alert Display */}
        {error && (
          <div className="mt-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-xs font-semibold text-left flex items-start gap-2.5">
            <span className="text-base leading-none">⚠️</span>
            <span className="flex-1">{error}</span>
          </div>
        )}
      </div>

      {/* Transcript & AI Response History Cards */}
      {(transcript || response) && (
        <div className="space-y-4 animate-fade-in">
          {/* User Transcript Card */}
          {transcript && (
            <div className="card p-5 border-l-4 border-l-slate-400 bg-[#0e1320]">
              <div className="flex items-center justify-between text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                <span className="flex items-center gap-1.5">
                  <span>👤</span> You said
                </span>
              </div>
              <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">
                {transcript}
              </p>
            </div>
          )}

          {/* AI Executive Response Card */}
          {response && (
            <div className="card p-5 border-l-4 border-l-violet-500 bg-[#121829] shadow-lg shadow-violet-950/20">
              <div className="flex items-center justify-between text-xs font-bold text-violet-400 uppercase tracking-wider mb-2">
                <span className="flex items-center gap-1.5">
                  <span className="text-sm">✦</span> {data.client.executive_name} (AI Twin)
                </span>
                {lastAudioUrl && (
                  <div className="flex items-center gap-2">
                    {isPlaying ? (
                      <button
                        type="button"
                        onClick={pauseAudio}
                        className="text-[11px] text-amber-300 hover:text-amber-200 flex items-center gap-1 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-500/30"
                      >
                        <span>⏸️</span> Pause
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={replayAudio}
                        className="text-[11px] text-violet-300 hover:text-white flex items-center gap-1 bg-violet-950/40 px-2 py-0.5 rounded border border-violet-500/30"
                      >
                        <span>▶️</span> {isPlaybackPaused ? 'Resume' : 'Play Audio'}
                      </button>
                    )}
                    {(isPlaying || isPlaybackPaused) && (
                      <button
                        type="button"
                        onClick={stopAudio}
                        className="text-[11px] text-red-300 hover:text-white flex items-center gap-1 bg-red-950/40 px-2 py-0.5 rounded border border-red-500/30"
                      >
                        <span>⏹️</span> Stop
                      </button>
                    )}
                  </div>
                )}
              </div>
              <p className="text-slate-100 text-sm leading-7 whitespace-pre-wrap font-normal">
                {response}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
