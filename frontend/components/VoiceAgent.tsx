'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiUrl, getWsUrl, getAdminKey } from '../utils/api';

export type DiscussionTurn = {
  id: string | number;
  userText: string;
  assistantText: string;
  timestamp: string;
  audioUrl?: string | null;
};

function pcmToWavBlob(pcmBytes: Uint8Array, sampleRate = 24000): Blob {
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);
  // "RIFF"
  view.setUint32(0, 0x52494646, false);
  view.setUint32(4, 36 + pcmBytes.length, true);
  // "WAVE"
  view.setUint32(8, 0x57415645, false);
  // "fmt "
  view.setUint32(12, 0x666d7420, false);
  view.setUint32(16, 16, true); // Linear PCM subchunk length
  view.setUint16(20, 1, true); // 1 = PCM format
  view.setUint16(22, 1, true); // 1 channel (mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate (sampleRate * 1 channel * 2 bytes/sample)
  view.setUint16(32, 2, true); // Block align (1 channel * 2 bytes)
  view.setUint16(34, 16, true); // 16 bits per sample
  // "data"
  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, pcmBytes.length, true);

  return new Blob([wavHeader, pcmBytes as unknown as BlobPart], { type: 'audio/wav' });
}

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
  const [wsConnected, setWsConnected] = useState(false);
  const [wsStatusMsg, setWsStatusMsg] = useState('');
  const [textInput, setTextInput] = useState('');

  // Discussion History & Pagination (default to newest first)
  const [discussions, setDiscussions] = useState<DiscussionTurn[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const sortOrderRef = useRef<'asc' | 'desc'>('desc');
  useEffect(() => {
    sortOrderRef.current = sortOrder;
  }, [sortOrder]);
  const [playingTurnId, setPlayingTurnId] = useState<string | number | null>(null);

  // Audio recording refs
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const shouldSendRef = useRef<boolean>(true);
  const timerRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // WebSocket & Web Audio Continuous Streaming refs
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<any>(null);
  const pingIntervalRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const pcmQueueRef = useRef<Float32Array[]>([]);
  const pcmQueueOffsetRef = useRef<number>(0);
  const leftoverByteRef = useRef<Uint8Array | null>(null);
  const isStreamingPlaybackStartedRef = useRef<boolean>(false);
  const isStreamingTurnFinishedRef = useRef<boolean>(false);
  const receivedPcmChunksRef = useRef<Uint8Array[]>([]);
  const playedAnyPcmRef = useRef<boolean>(false);
  const recognitionRef = useRef<any>(null);
  const isAgentSpeakingRef = useRef<boolean>(false);
  const transcriptRef = useRef<string>('');
  const responseRef = useRef<string>('');

  // Load existing discussions from backend when component opens
  useEffect(() => {
    async function loadRecentConversation() {
      try {
        const res = await fetch(`${getApiUrl()}/api/clients/${data.client.id}/conversations`, {
          headers: { 'X-Admin-Key': getAdminKey() },
        });
        if (!res.ok) return;
        const convList = await res.json();
        if (Array.isArray(convList) && convList.length > 0) {
          const latest = convList[0];
          setConversationId(latest.id);
          const detRes = await fetch(`${getApiUrl()}/api/clients/${data.client.id}/conversations/${latest.id}`, {
            headers: { 'X-Admin-Key': getAdminKey() },
          });
          if (!detRes.ok) return;
          const det = await detRes.json();
          if (det.messages && Array.isArray(det.messages)) {
            const pairs: DiscussionTurn[] = [];
            const msgs = det.messages;
            for (let i = 0; i < msgs.length; i++) {
              if (msgs[i].role === 'user') {
                const u = msgs[i];
                const a = msgs[i + 1]?.role === 'assistant' ? msgs[i + 1] : null;
                pairs.push({
                  id: u.id || `hist-${i}`,
                  userText: u.text,
                  assistantText: a ? a.text : '',
                  timestamp: u.created_at ? new Date(u.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
                  audioUrl: a?.audio_url ? `${getApiUrl()}${a.audio_url}` : null,
                });
                if (a) i++;
              } else if (msgs[i].role === 'assistant') {
                pairs.push({
                  id: msgs[i].id || `hist-${i}`,
                  userText: '',
                  assistantText: msgs[i].text,
                  timestamp: msgs[i].created_at ? new Date(msgs[i].created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
                  audioUrl: msgs[i].audio_url ? `${getApiUrl()}${msgs[i].audio_url}` : null,
                });
              }
            }
            if (pairs.length > 0) {
              setDiscussions(pairs);
              if (sortOrderRef.current === 'desc') {
                setCurrentPage(1);
              } else {
                setCurrentPage(Math.ceil(pairs.length / 10));
              }
            }
          }
        }
      } catch (err) {
        console.warn('Could not load past conversation history', err);
      }
    }
    loadRecentConversation();
  }, [data.client.id]);

  function playTurnAudio(turnId: string | number, url: string) {
    if (playingTurnId === turnId && isPlaying) {
      stopAudio();
      setPlayingTurnId(null);
      return;
    }
    stopAudioInternal();
    const audio = new Audio(url);
    audioRef.current = audio;
    setPlayingTurnId(turnId);
    setIsPlaying(true);
    setIsPlaybackPaused(false);
    audio.onplay = () => {
      setIsPlaying(true);
      setIsPlaybackPaused(false);
    };
    audio.onended = () => {
      setIsPlaying(false);
      setIsPlaybackPaused(false);
      setPlayingTurnId(null);
    };
    audio.onerror = () => {
      setIsPlaying(false);
      setIsPlaybackPaused(false);
      setPlayingTurnId(null);
    };
    audio.play().catch(console.error);
  }

  useEffect(() => {
    isAgentSpeakingRef.current = isPlaying;
  }, [isPlaying]);

  function ensureAudioContext(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      // Do not force sampleRate: 24000 on AudioContext constructor.
      // In Windows WASAPI, passing 24000 forces the browser/OS audio mixer into an emulated software resampler mode
      // that causes static, buzzing, and "hazy" distortion on Realtek and standard hardware devices.
      // AudioContext uses the device's native hardware sample rate, and AudioBuffer handles 24000Hz cleanly.
      audioCtxRef.current = new AudioCtx();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }

  // --- REAL-TIME WEBSOCKET MANAGEMENT ---
  const connectWebSocket = useCallback(() => {
    // If an existing socket is already OPEN or CONNECTING, do not open another
    if (wsRef.current) {
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        return;
      }
      try {
        wsRef.current.close(1000);
      } catch (e) {}
      wsRef.current = null;
    }

    try {
      const base = getWsUrl();
      const wsUrl = `${base}/api/clients/${data.client.id}/voice/realtime`;
      setWsStatusMsg('Connecting…');
      console.log('[VoiceAgent] Connecting WebSocket to:', wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current !== ws) return;
        console.log('[VoiceAgent] WebSocket connected successfully to:', wsUrl);
        setWsConnected(true);
        setWsStatusMsg('');
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 15000);
      };

      ws.onmessage = async (evt) => {
        try {
          const msg = JSON.parse(evt.data);

          if (msg.type === 'pong') {
            return;
          } else if (msg.type === 'session_started') {
            setWsConnected(true);
          } else if (msg.type === 'warning') {
            console.warn('[VoiceAgent] Server warning:', msg.message);
          } else if (msg.type === 'user_transcript') {
            setTranscript(msg.text || '');
            transcriptRef.current = msg.text || '';
          } else if (msg.type === 'agent_thinking') {
            setBusy(true);
            setBusyStep('Executive reasoning from database records…');
          } else if (msg.type === 'agent_text_chunk') {
            setBusy(false);
            setResponse((prev) => {
              const updated = prev ? prev + ' ' + msg.text : msg.text;
              responseRef.current = updated;
              return updated;
            });
          } else if (msg.type === 'audio_chunk') {
            setBusy(false);
            if (msg.audio_base64) {
              await queueAudioChunk(
                msg.audio_base64,
                msg.mime_type || 'audio/pcm',
                msg.sample_rate || 24000
              );
            }
          } else if (msg.type === 'agent_turn_finished') {
            setBusy(false);
            setBusyStep('');
            isStreamingTurnFinishedRef.current = true;
            if (msg.conversation_id) setConversationId(msg.conversation_id);

            let turnAudioUrl: string | null = null;
            // Assemble complete PCM buffer into standard playable WAV blob for replay
            if (receivedPcmChunksRef.current.length > 0) {
              const totalBytes = receivedPcmChunksRef.current.reduce((acc, c) => acc + c.length, 0);
              const merged = new Uint8Array(totalBytes);
              let offset = 0;
              for (const chunk of receivedPcmChunksRef.current) {
                merged.set(chunk, offset);
                offset += chunk.length;
              }
              const wavBlob = pcmToWavBlob(merged, 24000);
              const fullUrl = URL.createObjectURL(wavBlob);
              turnAudioUrl = fullUrl;
              setLastAudioUrl(fullUrl);

              // Auto-play fallback if Web Audio queue was blocked by browser policy
              if (!playedAnyPcmRef.current) {
                stopAudioInternal();
                const fallbackAudio = new Audio(fullUrl);
                audioRef.current = fallbackAudio;
                fallbackAudio.onplay = () => {
                  setIsPlaying(true);
                  setIsPlaybackPaused(false);
                };
                fallbackAudio.onended = () => {
                  setIsPlaying(false);
                };
                fallbackAudio.play().catch(() => {});
              }
            } else {
              setIsPlaying(false);
              setIsPlaybackPaused(false);
              if (msg.assistant_audio_url) {
                turnAudioUrl = `${getApiUrl()}${msg.assistant_audio_url}`;
                setLastAudioUrl(turnAudioUrl);
              }
            }

            // Commit completed turn to discussion history
            const finalAssistant = (msg.full_response || responseRef.current || '').trim();
            const finalUser = (transcriptRef.current || '').trim();
            if (finalUser || finalAssistant) {
              const newTurn: DiscussionTurn = {
                id: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                userText: finalUser,
                assistantText: finalAssistant,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                audioUrl: turnAudioUrl,
              };
              setDiscussions((prev) => {
                if (
                  prev.length > 0 &&
                  prev[prev.length - 1].userText === newTurn.userText &&
                  prev[prev.length - 1].assistantText === newTurn.assistantText
                ) {
                  return prev;
                }
                const updated = [...prev, newTurn];
                if (sortOrderRef.current === 'desc') {
                  setCurrentPage(1);
                } else {
                  setCurrentPage(Math.ceil(updated.length / 10));
                }
                return updated;
              });
            }
          } else if (msg.type === 'interrupted') {
            stopAudioInternal();
            setBusy(false);
            setBusyStep('');
          } else if (msg.type === 'error') {
            setError(msg.message || 'Real-time voice error');
            setWsStatusMsg(msg.message || 'Server error');
            setBusy(false);
            setBusyStep('');
          }
        } catch (e) {
          console.error('Error handling WebSocket message:', e);
        }
      };

      ws.onclose = (evt) => {
        console.log('[VoiceAgent] WebSocket closed with code:', evt.code, evt.reason);
        if (wsRef.current === ws) {
          wsRef.current = null;
          setWsConnected(false);
          const shortUrl = wsUrl.replace(/^wss?:\/\//, '');
          const reasonText =
            evt.code === 1008
              ? 'Voice configuration needed (code 1008)'
              : evt.code === 1006
              ? `Connection refused at ${shortUrl}`
              : `Closed (code ${evt.code})`;
          setWsStatusMsg(reasonText);
        }
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        // Do not auto-reconnect if closure was intentional (code 1000)
        if (evt.code !== 1000) {
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(() => {
            connectWebSocket();
          }, 3000);
        }
      };

      ws.onerror = (err) => {
        console.warn('[VoiceAgent] WebSocket error on:', wsUrl, err);
        if (wsRef.current === ws) {
          setWsConnected(false);
          const shortUrl = wsUrl.replace(/^wss?:\/\//, '');
          setWsStatusMsg(`Failed to connect to ${shortUrl}`);
        }
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      };
    } catch (e) {
      console.warn('WebSocket connection not initialized:', e);
      setWsConnected(false);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        connectWebSocket();
      }, 3000);
    }
  }, [data.client.id]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (wsRef.current) {
        try {
          wsRef.current.close(1000);
        } catch (e) {}
        wsRef.current = null;
      }
    };
  }, [connectWebSocket]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      stopAudioInternal();
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

  // --- CONTINUOUS RAW PCM STREAM PLAYER (FIFO QUEUE) ---
  function ensurePcmPlayer(ctx: AudioContext): ScriptProcessorNode {
    if (scriptNodeRef.current) {
      return scriptNodeRef.current;
    }

    // 2048 buffer size gives ~42.6ms buffer at 48kHz for low-latency, glitch-free audio
    const node = ctx.createScriptProcessor(2048, 1, 2);
    node.onaudioprocess = (event) => {
      const outLeft = event.outputBuffer.getChannelData(0);
      const hasRight = event.outputBuffer.numberOfChannels > 1;
      const queue = pcmQueueRef.current;

      // Jitter buffer pre-buffering check:
      // Wait for at least ~120ms of audio (ctx.sampleRate * 0.12) before beginning playback,
      // or start immediately if the backend turn is already finished.
      if (!isStreamingPlaybackStartedRef.current) {
        let totalBuffered = 0;
        for (let j = 0; j < queue.length; j++) {
          totalBuffered += queue[j].length;
        }
        totalBuffered -= pcmQueueOffsetRef.current;

        const minBufferSamples = Math.round(ctx.sampleRate * 0.12);
        if (totalBuffered >= minBufferSamples || isStreamingTurnFinishedRef.current) {
          if (totalBuffered > 0) {
            isStreamingPlaybackStartedRef.current = true;
          }
        }
      }

      if (!isStreamingPlaybackStartedRef.current || queue.length === 0) {
        outLeft.fill(0);
        if (hasRight) {
          event.outputBuffer.getChannelData(1).fill(0);
        }
        if (isStreamingTurnFinishedRef.current && queue.length === 0) {
          if (isStreamingPlaybackStartedRef.current) {
            isStreamingPlaybackStartedRef.current = false;
            setIsPlaying(false);
            setIsPlaybackPaused(false);
          }
        }
        return;
      }

      let written = 0;
      while (written < outLeft.length && queue.length > 0) {
        const chunk = queue[0];
        const available = chunk.length - pcmQueueOffsetRef.current;
        const needed = outLeft.length - written;

        if (available <= needed) {
          outLeft.set(chunk.subarray(pcmQueueOffsetRef.current), written);
          written += available;
          queue.shift();
          pcmQueueOffsetRef.current = 0;
        } else {
          outLeft.set(
            chunk.subarray(pcmQueueOffsetRef.current, pcmQueueOffsetRef.current + needed),
            written
          );
          pcmQueueOffsetRef.current += needed;
          written += needed;
        }
      }

      if (written < outLeft.length) {
        outLeft.fill(0, written);
        if (isStreamingTurnFinishedRef.current && queue.length === 0) {
          isStreamingPlaybackStartedRef.current = false;
          setIsPlaying(false);
          setIsPlaybackPaused(false);
        }
      }

      if (hasRight) {
        event.outputBuffer.getChannelData(1).set(outLeft);
      }
    };

    node.connect(ctx.destination);
    scriptNodeRef.current = node;
    return node;
  }

  async function queueAudioChunk(base64: string, mime: string, sampleRate = 24000) {
    if (mime === 'audio/pcm' || sampleRate) {
      try {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const newBytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          newBytes[i] = binaryString.charCodeAt(i);
        }

        // Store PCM bytes for replay WAV assembly
        receivedPcmChunksRef.current.push(newBytes);

        // Prepend any odd leftover byte from prior chunk to guarantee 16-bit 2-byte boundary alignment
        let rawBytes: Uint8Array;
        if (leftoverByteRef.current && leftoverByteRef.current.length > 0) {
          rawBytes = new Uint8Array(leftoverByteRef.current.length + newBytes.length);
          rawBytes.set(leftoverByteRef.current, 0);
          rawBytes.set(newBytes, leftoverByteRef.current.length);
          leftoverByteRef.current = null;
        } else {
          rawBytes = newBytes;
        }

        if (rawBytes.length % 2 !== 0) {
          leftoverByteRef.current = rawBytes.slice(rawBytes.length - 1);
          rawBytes = rawBytes.subarray(0, rawBytes.length - 1);
        }

        if (rawBytes.length === 0) return;

        // Convert 16-bit signed PCM (little-endian) to Float32 [-1.0, 1.0]
        const numSamples = rawBytes.length / 2;
        const dataView = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
        const float32 = new Float32Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
          float32[i] = dataView.getInt16(i * 2, true) / 32768.0;
        }

        const ctx = ensureAudioContext();
        ensurePcmPlayer(ctx);

        // High quality linear interpolation resampling to match the hardware AudioContext sampleRate
        let resampled: Float32Array;
        if (ctx.sampleRate === sampleRate) {
          resampled = float32;
        } else {
          const ratio = sampleRate / ctx.sampleRate;
          const dstLength = Math.round(numSamples * (ctx.sampleRate / sampleRate));
          resampled = new Float32Array(dstLength);
          for (let i = 0; i < dstLength; i++) {
            const pos = i * ratio;
            const idx = Math.floor(pos);
            const frac = pos - idx;
            const s0 = idx < numSamples ? float32[idx] : float32[numSamples - 1];
            const s1 = idx + 1 < numSamples ? float32[idx + 1] : s0;
            resampled[i] = s0 + frac * (s1 - s0);
          }
        }

        // Push continuous resampled audio into the FIFO stream queue
        pcmQueueRef.current.push(resampled);

        playedAnyPcmRef.current = true;
        setIsPlaying(true);
        setIsPlaybackPaused(false);
      } catch (pcmErr) {
        console.warn('PCM streaming audio chunk error:', pcmErr);
      }
    } else if (mime.startsWith('audio/mpeg') || mime.startsWith('audio/mp3')) {
      try {
        const audioUrl = `data:${mime};base64,${base64}`;
        setLastAudioUrl(audioUrl);
        stopAudioInternal();
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        audio.onplay = () => {
          setIsPlaying(true);
          setIsPlaybackPaused(false);
        };
        audio.onended = () => setIsPlaying(false);
        audio.play().catch(() => {});
      } catch (mp3Err) {
        console.warn('Batch MP3 playback error:', mp3Err);
      }
    }
  }

  // --- BARGE-IN & INTERRUPTION ---
  function stopAudioInternal() {
    // Clear continuous PCM streaming queue
    pcmQueueRef.current = [];
    pcmQueueOffsetRef.current = 0;
    leftoverByteRef.current = null;
    isStreamingPlaybackStartedRef.current = false;
    isStreamingTurnFinishedRef.current = false;

    // Disconnect script node to release Web Audio processing immediately
    if (scriptNodeRef.current) {
      try {
        scriptNodeRef.current.disconnect();
      } catch (e) {}
      scriptNodeRef.current = null;
    }

    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }

    // Stop batch HTMLAudioElement if playing
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    setIsPlaying(false);
    setIsPlaybackPaused(false);
  }

  const stopAudio = useCallback(() => {
    stopAudioInternal();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }
  }, []);

  function pauseAudio() {
    if (audioCtxRef.current && audioCtxRef.current.state === 'running') {
      audioCtxRef.current.suspend();
      setIsPlaybackPaused(true);
      setIsPlaying(false);
    } else if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      setIsPlaybackPaused(true);
      setIsPlaying(false);
    }
  }

  function resumeAudio() {
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
      setIsPlaybackPaused(false);
      setIsPlaying(true);
    } else if (audioRef.current && audioRef.current.paused) {
      audioRef.current.play().catch(() => {});
      setIsPlaybackPaused(false);
      setIsPlaying(true);
    }
  }

  function replayAudio() {
    if (!lastAudioUrl) return;
    stopAudioInternal();

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

  // --- RECORDING & STREAMING CONTROLS ---
  async function startRecording() {
    setError('');

    // Ensure any previously completed exchange is safely committed to discussions so it NEVER vanishes
    if (transcriptRef.current && responseRef.current) {
      const uText = transcriptRef.current.trim();
      const aText = responseRef.current.trim();
      if (uText || aText) {
        setDiscussions((prev) => {
          if (
            prev.length > 0 &&
            prev[prev.length - 1].userText === uText &&
            prev[prev.length - 1].assistantText === aText
          ) {
            return prev;
          }
          const updated = [
            ...prev,
            {
              id: `turn-${Date.now()}`,
              userText: uText,
              assistantText: aText,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              audioUrl: lastAudioUrl,
            },
          ];
          if (sortOrderRef.current === 'desc') {
            setCurrentPage(1);
          } else {
            setCurrentPage(Math.ceil(updated.length / 10));
          }
          return updated;
        });
      }
    }

    // Reset ONLY active live buffers for the incoming turn
    setTranscript('');
    transcriptRef.current = '';
    setResponse('');
    responseRef.current = '';
    setRecordSeconds(0);
    setIsPaused(false);
    shouldSendRef.current = true;
    receivedPcmChunksRef.current = [];
    playedAnyPcmRef.current = false;

    // Direct user gesture initializes Web Audio Context to bypass autoplay restrictions
    ensureAudioContext();

    if (isAgentSpeakingRef.current) {
      stopAudio();
    } else {
      stopAudioInternal();
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connectWebSocket();
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(
          'Microphone access is blocked by your browser because this page is not in a Secure Context (HTTPS or localhost). Please open the site via http://localhost:3000, or use HTTPS, or configure chrome://flags/#unsafely-treat-insecure-origin-as-secure.'
        );
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      mediaRef.current = mr;
      chunks.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };

      // Set up browser SpeechRecognition if supported
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const rec = new SpeechRecognition();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = data.profile?.preferred_language === 'Bengali' ? 'bn-BD' : 'en-US';

          rec.onresult = (evt: any) => {
            let liveTranscript = '';
            for (let i = 0; i < evt.results.length; i++) {
              liveTranscript += evt.results[i][0].transcript;
            }
            if (liveTranscript) {
              setTranscript(liveTranscript);
              transcriptRef.current = liveTranscript;
            }
          };

          rec.onerror = (recErr: any) => {
            console.warn('SpeechRecognition event warning:', recErr);
          };

          rec.start();
          recognitionRef.current = rec;
        } catch (recErr) {
          console.warn('Browser SpeechRecognition not active:', recErr);
        }
      }

      mr.onstop = async () => {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }

        if (recognitionRef.current) {
          try {
            recognitionRef.current.stop();
          } catch (e) {}
          recognitionRef.current = null;
        }

        if (shouldSendRef.current && chunks.current.length > 0) {
          const blob = new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' });
          await submitTurn(blob);
        }
      };

      mr.start(250);
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
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
      recognitionRef.current = null;
    }
    setRecording(false);
    setIsPaused(false);
    chunks.current = [];
    setRecordSeconds(0);
  }

  // --- SUBMIT TURN (STREAMING WEBSOCKET WITH HTTP FALLBACK) ---
  async function submitTurn(blob: Blob) {
    setBusy(true);
    setBusyStep('Connecting to real-time decision stream…');

    // If WebSocket is currently establishing connection, wait briefly
    if (wsRef.current && (wsRef.current.readyState as number) === WebSocket.CONNECTING) {
      for (let i = 0; i < 4; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if ((wsRef.current?.readyState as number) === WebSocket.OPEN) break;
      }
    }

    // Priority 1: Fast WebSocket Streaming Path
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      if (blob.size < 1000) {
        setError('Recording was too short or silent. Please speak clearly for at least 1-2 seconds.');
        setBusy(false);
        setBusyStep('');
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        const base64Audio = (reader.result as string).split(',')[1];
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const liveText = transcriptRef.current.trim();
          if (liveText) {
            wsRef.current.send(
              JSON.stringify({
                type: 'user_transcription',
                text: liveText,
                audio_base64: base64Audio,
                filename: 'voice.webm',
                conversation_id: conversationId,
              })
            );
          } else {
            wsRef.current.send(
              JSON.stringify({
                type: 'audio_turn',
                audio_base64: base64Audio,
                filename: 'voice.webm',
                conversation_id: conversationId,
              })
            );
          }
        }
      };
      reader.readAsDataURL(blob);
      return;
    }

    // Priority 2: HTTP Fallback if WebSocket is disconnected
    try {
      setBusyStep('Processing turn via HTTP fallback…');
      if (blob.size < 1000) {
        throw new Error('Recording was too short or silent. Please speak clearly for at least 1-2 seconds.');
      }

      const fd = new FormData();
      fd.append('audio', blob, 'voice.webm');
      if (conversationId) fd.append('conversation_id', String(conversationId));

      const r = await fetch(`${getApiUrl()}/api/clients/${data.client.id}/voice/turn`, {
        method: 'POST',
        headers: { 'X-Admin-Key': getAdminKey() },
        body: fd,
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Voice turn request failed');

      setConversationId(j.conversation_id);
      setTranscript(j.transcript || '');
      transcriptRef.current = j.transcript || '';
      setResponse(j.response || '');
      responseRef.current = j.response || '';

      let turnAudioUrl: string | null = null;
      if (j.audio_base64) {
        turnAudioUrl = `data:${j.mime_type || 'audio/mpeg'};base64,${j.audio_base64}`;
        setLastAudioUrl(turnAudioUrl);
        stopAudioInternal();
        const audio = new Audio(turnAudioUrl);
        audioRef.current = audio;
        audio.onplay = () => setIsPlaying(true);
        audio.onended = () => setIsPlaying(false);
        await audio.play().catch(() => {});
      } else if (j.audio_url) {
        turnAudioUrl = `${getApiUrl()}${j.audio_url}`;
        setLastAudioUrl(turnAudioUrl);
      }

      if (j.transcript || j.response) {
        setDiscussions((prev) => {
          const updated = [
            ...prev,
            {
              id: `turn-${Date.now()}`,
              userText: j.transcript || '',
              assistantText: j.response || '',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              audioUrl: turnAudioUrl,
            },
          ];
          if (sortOrderRef.current === 'desc') {
            setCurrentPage(1);
          } else {
            setCurrentPage(Math.ceil(updated.length / 10));
          }
          return updated;
        });
      }
    } catch (e: any) {
      setError(e.message || 'Voice request failed.');
    } finally {
      setBusy(false);
      setBusyStep('');
    }
  }

  // --- TEXT QUESTION SUBMISSION (TESTING & ACCESSIBILITY) ---
  async function submitTextQuery(overrideText?: string) {
    const query = (overrideText ?? textInput).trim();
    if (!query) return;

    setError('');

    // Ensure any previously completed exchange is safely committed to discussions so it NEVER vanishes
    if (transcriptRef.current && responseRef.current) {
      const uText = transcriptRef.current.trim();
      const aText = responseRef.current.trim();
      if (uText || aText) {
        setDiscussions((prev) => {
          if (
            prev.length > 0 &&
            prev[prev.length - 1].userText === uText &&
            prev[prev.length - 1].assistantText === aText
          ) {
            return prev;
          }
          const updated = [
            ...prev,
            {
              id: `turn-${Date.now()}`,
              userText: uText,
              assistantText: aText,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              audioUrl: lastAudioUrl,
            },
          ];
          if (sortOrderRef.current === 'desc') {
            setCurrentPage(1);
          } else {
            setCurrentPage(Math.ceil(updated.length / 10));
          }
          return updated;
        });
      }
    }

    setTranscript(query);
    transcriptRef.current = query;
    setTextInput('');
    setResponse('');
    responseRef.current = '';
    receivedPcmChunksRef.current = [];
    playedAnyPcmRef.current = false;
    stopAudioInternal();
    ensureAudioContext();

    setBusy(true);
    setBusyStep('Executive reasoning from database records…');

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'user_transcription',
          text: query,
          conversation_id: conversationId,
        })
      );
      return;
    }

    connectWebSocket();
    setTimeout(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'user_transcription',
            text: query,
            conversation_id: conversationId,
          })
        );
      } else {
        setError('Real-time connection unavailable. Please refresh or retry.');
        setBusy(false);
        setBusyStep('');
      }
    }, 500);
  }

  const isVoiceReady = Boolean(data.profile?.voice_authorized && data.profile?.voice_id);

  // Pagination & Sorting calculations (10 discussions per page)
  const ITEMS_PER_PAGE = 10;
  const sortedDiscussions = useMemo(() => {
    return sortOrder === 'desc' ? [...discussions].reverse() : discussions;
  }, [discussions, sortOrder]);

  const totalPages = Math.ceil(sortedDiscussions.length / ITEMS_PER_PAGE) || 1;
  const safePage = Math.min(Math.max(currentPage, 1), totalPages);
  const startIndex = (safePage - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, sortedDiscussions.length);
  const currentDiscussions = useMemo(() => {
    return sortedDiscussions.slice(startIndex, endIndex);
  }, [sortedDiscussions, startIndex, endIndex]);

  // Is an active live turn currently in progress?
  const isLiveTurnActive = Boolean(
    recording ||
    busy ||
    (transcript && !discussions.some((d) => d.userText === transcript)) ||
    (response && !discussions.some((d) => d.assistantText === response))
  );

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

        {/* Real-time Streaming Status Badge */}
        <div className="flex items-center justify-center gap-2 mb-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              connectWebSocket();
            }}
            title={wsConnected ? 'Real-time WebSocket streaming connected' : 'Click to connect real-time stream'}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/30 text-violet-300 text-xs font-bold tracking-wider uppercase transition-colors hover:bg-violet-500/20 cursor-pointer"
          >
            <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            {wsConnected ? '⚡ REAL-TIME VOICE STREAMING ACTIVE' : 'DIGITAL EXECUTIVE VOICE AGENT (CONNECT)'}
          </button>
          {wsConnected ? (
            <span className="text-[11px] font-mono text-emerald-400/90 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/30">
              PCM 24kHz • &lt;800ms Latency
            </span>
          ) : (
            <span
              onClick={() => {
                alert(
                  `Real-Time Stream Diagnostics:\n\n` +
                  `Target WebSocket URL:\n${getWsUrl()}/api/clients/${data.client.id}/voice/realtime\n\n` +
                  `Current Status:\n${wsStatusMsg || 'Disconnected'}\n\n` +
                  `Troubleshooting:\n` +
                  `1. If using Nginx reverse proxy, ensure 'Upgrade' and 'Connection: upgrade' headers are configured.\n` +
                  `2. If backend is on port 3855, verify port is reachable or specified in NEXT_PUBLIC_API_URL.\n` +
                  `3. Check browser console (F12) for detailed network traces.`
                );
              }}
              className="text-[11px] font-mono text-amber-400/90 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-500/30 max-w-sm truncate cursor-pointer hover:border-amber-400"
              title="Click for WebSocket connection diagnostics"
            >
              HTTP Fallback {wsStatusMsg ? `(${wsStatusMsg})` : 'Active'} ⓘ
            </span>
          )}
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
          {recording && !isPaused && (
            <>
              <div className="absolute w-44 h-44 rounded-full border border-red-500/30 animate-ping opacity-75" />
              <div className="absolute w-52 h-52 rounded-full border border-red-500/20 animate-pulse" />
            </>
          )}

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
              {busyStep || 'Streaming decision reasoning and synthesizing voice…'}
            </span>
          ) : isPlaying ? (
            <span className="text-emerald-300 font-semibold flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              AI Executive is speaking in real time… Click <em>Interrupt</em> anytime to barge in.
            </span>
          ) : isPlaybackPaused ? (
            <span className="text-amber-300">
              ⏸️ Audio speech paused. Click <em>Resume Speech</em> or <em>Stop</em>.
            </span>
          ) : (
            'Click "Start Talking" or type below to speak with the digital executive in real time.'
          )}
        </p>

        {/* Permanent Action Controls Dock */}
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
              <span>{busy ? 'Streaming…' : isPlaying ? 'Interrupt & Speak' : 'Start Talking'}</span>
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

          {/* 2. PAUSE BUTTON */}
          <button
            id="btn-pause-action"
            type="button"
            className={`btn flex items-center gap-2 px-5 py-2.5 text-sm font-bold transition ${
              (recording && !isPaused) || isPlaying
                ? 'btn-secondary text-amber-300 border-amber-500/40 hover:bg-amber-950/30'
                : isPaused || isPlaybackPaused
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

          {/* 3. STOP / INTERRUPT BUTTON */}
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
          >
            <span>⏹️</span>
            <span>
              {recording
                ? 'Stop & Send'
                : isPlaying
                ? 'Interrupt (Barge-In)'
                : isPlaybackPaused
                ? 'Stop Speech'
                : 'Stop'}
            </span>
          </button>

          {/* 4. CANCEL RECORDING */}
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

          {/* 5. REPLAY PREVIOUS RESPONSE */}
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

        {/* Quick Text Input Form for immediate testing & accessibility */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitTextQuery();
          }}
          className="mt-6 max-w-xl mx-auto flex items-center gap-2"
        >
          <input
            type="text"
            className="flex-1 bg-[#090d16] border border-[#232b3e] focus:border-violet-500 rounded-xl px-4 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none transition"
            placeholder={`Ask ${data.client.executive_name} a question (or speak using microphone)...`}
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            disabled={busy || recording}
          />
          <button
            type="submit"
            className="btn btn-primary px-4 py-2 text-xs font-bold whitespace-nowrap"
            disabled={busy || recording || !textInput.trim() || !isVoiceReady}
          >
            {busy ? '…' : 'Ask'}
          </button>
        </form>

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
            <button
              type="button"
              onClick={() => setError('')}
              className="text-slate-400 hover:text-white text-xs underline ml-2"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Active Live Turn Card (In-Progress Turn) */}
      {isLiveTurnActive && (transcript || response || recording || busy) && (
        <div className="card p-5 border-2 border-violet-500/50 bg-[#101526] shadow-xl shadow-violet-950/30 space-y-3 animate-fade-in">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider">
            <span className="flex items-center gap-2 text-violet-300">
              <span className="w-2.5 h-2.5 rounded-full bg-violet-400 animate-ping" />
              <span>Active Turn (In Progress)</span>
            </span>
            {recording && (
              <span className="text-red-400 font-mono animate-pulse">● Recording Voice ({formatTime(recordSeconds)})</span>
            )}
            {busy && (
              <span className="text-amber-400 font-mono animate-pulse">✦ AI Thinking & Streaming…</span>
            )}
          </div>

          {transcript && (
            <div className="p-4 rounded-xl bg-[#0a0e1a] border border-slate-800">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <span>👤</span> You said
              </div>
              <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">{transcript}</p>
            </div>
          )}

          {response && (
            <div className="p-4 rounded-xl bg-[#141b30] border border-violet-900/60">
              <div className="flex items-center justify-between text-[11px] font-bold text-violet-400 uppercase tracking-wider mb-1">
                <span className="flex items-center gap-1.5">
                  <span>✦</span> {data.client.executive_name} (AI Twin)
                </span>
                {isPlaying && (
                  <button
                    type="button"
                    onClick={stopAudio}
                    className="text-[11px] text-red-300 hover:text-white flex items-center gap-1 bg-red-950/40 px-2 py-0.5 rounded border border-red-500/30 font-medium"
                  >
                    <span>⏹️</span> Interrupt
                  </button>
                )}
              </div>
              <p className="text-slate-100 text-sm leading-7 whitespace-pre-wrap">{response}</p>
            </div>
          )}
        </div>
      )}

      {/* Discussion History Feed & Pagination */}
      <div className="space-y-4">
        {/* Discussion History Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-[#0d1220] rounded-2xl border border-[#232b3e]">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span>💬</span>
              <span>Discussion History</span>
            </h3>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 font-bold">
              {discussions.length} {discussions.length === 1 ? 'Discussion' : 'Discussions'}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Sort Toggle */}
            <button
              type="button"
              onClick={() => {
                setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
                setCurrentPage(1);
              }}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-[#161d2d] border border-[#2b354c] text-slate-300 hover:text-white flex items-center gap-1 font-medium transition"
              title="Toggle discussion sort order"
            >
              <span>{sortOrder === 'asc' ? '↓ Oldest First' : '↑ Newest First'}</span>
            </button>

            {/* Start New Conversation / Clear */}
            <button
              type="button"
              onClick={() => {
                if (discussions.length === 0 || window.confirm('Start a fresh conversation? This clears the on-screen discussion history.')) {
                  stopAudioInternal();
                  setDiscussions([]);
                  setConversationId(null);
                  setTranscript('');
                  transcriptRef.current = '';
                  setResponse('');
                  responseRef.current = '';
                  setCurrentPage(1);
                }
              }}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-[#1a1528] border border-violet-800/40 text-violet-300 hover:text-white hover:bg-violet-900/40 flex items-center gap-1 font-semibold transition"
              title="Start a fresh conversation"
            >
              <span>+ New Session</span>
            </button>
          </div>
        </div>

        {/* Discussion Items List */}
        {discussions.length === 0 && !isLiveTurnActive ? (
          <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-[#252d40] rounded-2xl bg-[#0a0e1a]/50">
            No previous discussions in this session yet. Click <strong className="text-slate-400">&quot;Start Talking&quot;</strong> or type a message below to begin.
          </div>
        ) : (
          <div className="space-y-4">
            {currentDiscussions.map((turn, idx) => {
              const globalIndex = sortOrder === 'asc' ? startIndex + idx + 1 : sortedDiscussions.length - (startIndex + idx);
              const isPlayingThis = isPlaying && playingTurnId === turn.id;

              return (
                <div
                  key={turn.id}
                  className="card p-5 border border-slate-800/80 bg-[#0e1424] space-y-3.5 shadow-md hover:border-slate-700 transition"
                >
                  <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800/60 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-violet-950/60 text-violet-300 border border-violet-800/40 font-bold">
                        #{globalIndex}
                      </span>
                      {turn.timestamp && <span>{turn.timestamp}</span>}
                    </div>

                    {turn.audioUrl && (
                      <button
                        type="button"
                        onClick={() => playTurnAudio(turn.id, turn.audioUrl!)}
                        className={`text-xs px-2.5 py-1 rounded-lg border flex items-center gap-1.5 transition font-medium ${
                          isPlayingThis
                            ? 'bg-red-950/60 border-red-500/50 text-red-300 hover:bg-red-900/60'
                            : 'bg-violet-950/40 border-violet-700/40 text-violet-300 hover:text-white hover:bg-violet-900/50'
                        }`}
                      >
                        <span>{isPlayingThis ? '⏹️' : '▶️'}</span>
                        <span>{isPlayingThis ? 'Stop Audio' : 'Replay Voice'}</span>
                      </button>
                    )}
                  </div>

                  {turn.userText && (
                    <div className="p-4 rounded-xl bg-[#0b101c] border-l-4 border-l-slate-400 border border-slate-800/80">
                      <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                        <span>👤</span> You said
                      </div>
                      <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">{turn.userText}</p>
                    </div>
                  )}

                  {turn.assistantText && (
                    <div className="p-4 rounded-xl bg-[#13192c] border-l-4 border-l-violet-500 border border-violet-950/60 shadow-md">
                      <div className="text-[11px] font-bold text-violet-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                        <span>✦</span> {data.client.executive_name} (AI Twin)
                      </div>
                      <p className="text-slate-100 text-sm leading-7 whitespace-pre-wrap font-normal">
                        {turn.assistantText}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Pagination Controls Bar (Shows when discussions > 10) */}
            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-[#0d1220] rounded-2xl border border-[#232b3e] text-xs">
                <span className="text-slate-400">
                  Showing <strong className="text-white">{startIndex + 1}–{endIndex}</strong> of{' '}
                  <strong className="text-white">{discussions.length}</strong> discussions
                </span>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                    disabled={safePage === 1}
                    className="btn btn-secondary px-3 py-1.5 text-xs disabled:opacity-40"
                  >
                    ◀ Previous
                  </button>

                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                    <button
                      key={pageNum}
                      type="button"
                      onClick={() => setCurrentPage(pageNum)}
                      className={`px-3 py-1.5 rounded-lg font-bold text-xs transition ${
                        pageNum === safePage
                          ? 'bg-violet-600 text-white shadow-md shadow-violet-950/60'
                          : 'bg-[#151c2c] text-slate-400 hover:text-white hover:bg-slate-800 border border-[#273248]'
                      }`}
                    >
                      {pageNum}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                    disabled={safePage === totalPages}
                    className="btn btn-secondary px-3 py-1.5 text-xs disabled:opacity-40"
                  >
                    Next ▶
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
