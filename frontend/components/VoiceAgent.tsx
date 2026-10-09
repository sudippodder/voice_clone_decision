'use client';
import { useRef, useState } from 'react';
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'; const KEY = process.env.NEXT_PUBLIC_ADMIN_API_KEY || 'change-this-admin-key';
export function VoiceAgent({ data }: { data: any }) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [recordSeconds, setRecordSeconds] = useState(0);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const audioObjRef = useRef<HTMLAudioElement | null>(null);

  async function start() {
    setError('');
    setTranscript('');
    setResponse('');
    setAudioUrl(null);
    setRecordSeconds(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRef.current = mr;
      chunks.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };

      mr.onstop = async () => {
        clearInterval(timerRef.current);
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' });
        await send(blob);
      };

      mr.start(250);
      setRecording(true);

      timerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch (e: any) {
      setError(e.message || 'Microphone access failed. Please check browser permissions.');
    }
  }

  function stop() {
    if (mediaRef.current && mediaRef.current.state !== 'inactive') {
      mediaRef.current.stop();
    }
    setRecording(false);
    clearInterval(timerRef.current);
  }

  async function playAudio(url: string, fallbackText: string) {
    try {
      if (audioObjRef.current) {
        audioObjRef.current.pause();
      }
      const sound = new Audio(url);
      audioObjRef.current = sound;
      setPlaying(true);
      sound.onended = () => setPlaying(false);
      sound.onerror = () => {
        setPlaying(false);
        if ('speechSynthesis' in window) {
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(fallbackText));
        }
      };
      await sound.play();
    } catch (err) {
      setPlaying(false);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(fallbackText));
      }
    }
  }

  async function send(blob: Blob) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'voice.webm');
      if (conversationId) fd.append('conversation_id', String(conversationId));

      const r = await fetch(`${API}/api/clients/${data.client.id}/voice/turn`, {
        method: 'POST',
        headers: { 'X-Admin-Key': KEY },
        body: fd,
      });

      const j = await r.json();
      if (!r.ok) {
        throw new Error(j.detail || 'Voice turn failed on server.');
      }

      setConversationId(j.conversation_id);
      setTranscript(j.transcript);
      setResponse(j.response);

      if (j.audio_base64 && j.mime_type !== 'audio/speech-synthesis') {
        const soundUrl = `data:${j.mime_type};base64,${j.audio_base64}`;
        setAudioUrl(soundUrl);
        await playAudio(soundUrl, j.response);
      } else if ('speechSynthesis' in window) {
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(j.response));
      }
    } catch (e: any) {
      setError(e.message || 'Voice request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="card p-8 text-center relative overflow-hidden">
        <div className="text-xs uppercase tracking-[.25em] text-violet-400 font-bold mb-1">
          DIGITAL EXECUTIVE REPRESENTATIVE
        </div>
        <h2 className="text-3xl font-black">{data.client.executive_name}</h2>
        <p className="text-slate-400 text-sm mt-1">
          {data.profile?.voice_authorized ? (
            <span className="text-emerald-400 font-medium flex items-center justify-center gap-1.5 flex-wrap">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Voice Active:
              <strong className="text-white font-semibold">{data.profile?.voice_name || 'Custom Voice Clone'}</strong>
              <span className="text-slate-500">•</span>
              <span className="font-mono text-emerald-200 text-xs">{data.profile?.voice_id}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 uppercase">
                {data.profile?.voice_provider === 'elevenlabs' ? 'ElevenLabs' : data.profile?.voice_provider?.toUpperCase()}
              </span>
            </span>
          ) : (
            <span className="text-amber-400 font-medium">● Voice Not Configured</span>
          )}
        </p>

        {/* Visualizer Circle */}
        <div
          className={`mx-auto my-8 w-36 h-36 rounded-full flex flex-col items-center justify-center border-2 transition-all duration-300 ${recording
            ? 'border-red-500 bg-red-500/20 scale-105 shadow-[0_0_35px_rgba(239,68,68,0.4)]'
            : busy
              ? 'border-amber-400 bg-amber-500/10 animate-pulse'
              : playing
                ? 'border-emerald-400 bg-emerald-500/10 shadow-[0_0_25px_rgba(52,211,153,0.3)]'
                : 'border-violet-500/40 bg-violet-500/10'
            }`}
        >
          <div className="text-4xl">
            {recording ? '🔴' : busy ? '⏳' : playing ? '🔊' : '🎙️'}
          </div>
          {recording && (
            <span className="text-xs font-mono font-bold text-red-300 mt-1">
              00:{recordSeconds < 10 ? `0${recordSeconds}` : recordSeconds}
            </span>
          )}
        </div>

        {/* State Label */}
        <p className="text-slate-300 mb-6 text-sm font-medium">
          {recording
            ? 'Listening... Speak clearly, then click "Stop & Send" when done.'
            : busy
              ? 'Analyzing speech & synthesizing executive reply...'
              : playing
                ? 'speaking...'
                : 'Click "Start Talking", say your message, and click "Stop & Send".'}
        </p>

        {/* Action Controls */}
        <div className="flex justify-center items-center gap-4">
          {!recording ? (
            <button
              className="btn btn-primary px-8 py-3 text-base flex items-center gap-2 shadow-lg shadow-violet-600/20"
              onClick={start}
              disabled={busy || !data.profile?.voice_authorized}
            >
              <span>🎙️</span>
              {busy ? 'Processing Reply…' : 'Start Talking'}
            </button>
          ) : (
            <button
              className="btn bg-red-600 hover:bg-red-500 text-white font-bold px-8 py-3 text-base flex items-center gap-2 animate-pulse shadow-lg shadow-red-600/30"
              onClick={stop}
            >
              <span>⏹️</span>
              Stop & Send
            </button>
          )}

          {audioUrl && !recording && !busy && (
            <button
              className="btn btn-secondary text-sm px-4 py-3 flex items-center gap-2 text-violet-300 border-violet-500/40 hover:bg-violet-950/40"
              onClick={() => playAudio(audioUrl, response)}
              title="Replay Voice Audio"
            >
              <span>🔄</span> {playing ? 'Playing…' : 'Replay Voice'}
            </button>
          )}
        </div>

        {!data.profile?.voice_authorized && (
          <p className="text-amber-300 text-sm mt-5 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 inline-block">
            ⚠️ An authorized cloned voice is not configured yet. Configure one in <strong>Settings → Voice</strong>.
          </p>
        )}

        {error && (
          <div className="mt-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm text-left">
            ✕ {error}
          </div>
        )}
      </div>

      {/* Transcript & Response Area */}
      {(transcript || response) && (
        <div className="space-y-4">
          <div className="card p-5 border-slate-800">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between">
              <span>You Said</span>
              <span className="text-[10px] text-slate-600">STT via Whisper</span>
            </div>
            <p className="mt-2 text-slate-200 leading-relaxed">{transcript || '...'}</p>
          </div>

          <div className="card p-5 border-violet-500/30 bg-violet-950/10">
            <div className="text-xs font-bold text-violet-400 uppercase tracking-wider flex items-center justify-between">
              <span>{data.client.executive_name} (AI Representative)</span>
              {audioUrl && (
                <button
                  onClick={() => playAudio(audioUrl, response)}
                  className="text-xs text-violet-300 hover:text-white underline"
                >
                  🔊 Replay audio
                </button>
              )}
            </div>
            <p className="mt-2 text-slate-100 leading-relaxed whitespace-pre-line">{response}</p>
          </div>
        </div>
      )}
    </div>
  );
}

