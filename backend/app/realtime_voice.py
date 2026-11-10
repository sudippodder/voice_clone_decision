import asyncio
import base64
import inspect
import io
import json
import re
from typing import AsyncGenerator, Callable, Any
import httpx
import websockets
from fastapi import WebSocket, WebSocketDisconnect
from openai import OpenAI, AsyncOpenAI

from .config import settings
from .db import SessionLocal
from .models import Client, Conversation, Message, Memory, ExecutiveProfile
from .decision_workflow import (
    retrieve_node,
    greeting_node,
    insufficient_evidence_node,
    sanitize_response_node,
    RESPONSE_MODES,
    DIRECTNESS_GUIDELINES,
)
from .services import transcribe_audio, synthesize_voice
from .storage import save_audio_file, save_pcm_as_wav, update_conversation_metadata


async def stream_decision_clauses(
    client_id: int,
    client: Any,
    profile: Any,
    memories: list,
    history: list,
    user_text: str,
) -> AsyncGenerator[str, None]:
    """Asynchronously streams decision sentences strictly grounded in client database evidence.
    Yields full sentences/clauses as soon as they are generated to enable sub-second voice synthesis.
    """
    state = {
        "client_id": client_id,
        "client": client,
        "profile": profile,
        "memories": memories,
        "history": history,
        "user_text": user_text,
    }

    # Step 1: Database retrieval & evidence evaluation (runs in worker thread so event loop remains responsive)
    retrieved = await asyncio.to_thread(retrieve_node, state)
    state.update(retrieved)

    # Fast-path 1: Pure greeting
    if state.get("is_pure_greeting", False):
        greeting_text = greeting_node(state)["response"]
        yield greeting_text
        return

    # Fast-path 2: Insufficient database evidence
    if not state.get("has_sufficient_evidence", False):
        refusal_text = insufficient_evidence_node(state)["response"]
        yield refusal_text
        return

    # Step 2: Assemble strict decision engine prompt
    mode_key = (getattr(profile, "response_length", None) or "short").lower()
    if mode_key not in RESPONSE_MODES:
        mode_key = "short"
    mode_config = RESPONSE_MODES[mode_key]

    directness_key = (getattr(profile, "default_directness", None) or "balanced").lower()
    directness_instruction = DIRECTNESS_GUIDELINES.get(directness_key, DIRECTNESS_GUIDELINES["balanced"])
    tone = getattr(profile, "default_tone", None) or "professional"

    # Format database evidence
    vector_items = state.get("vector_memories", [])
    if vector_items:
        vector_text = "\n".join(
            f"- [Doc: {item['source']} (Relevance: {item['similarity']})]: {item['content']}"
            for item in vector_items
        )
    else:
        vector_text = "None."

    record_items = state.get("profile_records", [])
    if record_items:
        record_text = "\n".join(
            f"- [{r['type'].upper()}]: {r['title']} -> {r['details']}"
            for r in record_items
        )
    else:
        record_text = "None."

    graph_items = state.get("graph_memories", [])
    graph_text = "\n".join(graph_items) if graph_items else "None."

    memory_items = state.get("memories", [])
    if memory_items:
        memory_text = "\n".join(
            f"- [{m.category}] {m.title}: {m.content}" for m in memory_items
        )
    else:
        memory_text = "None."

    situation_items = state.get("situation_guidelines", [])
    situation_text = "\n".join(situation_items) if situation_items else "None."

    system_prompt = f"""You are the Digital Executive Decision Intelligence Agent for {client.executive_name}.
You are a voice agent. Speak cleanly, directly, and naturally. Ground every answer strictly in {client.executive_name}'s database.

=======================================================
MANDATORY OPERATING RULES:
=======================================================
1. DATABASE IS THE EXCLUSIVE SOURCE OF TRUTH:
   Use ONLY the verified database records, profile policies, and document chunks provided below.
   NEVER use general world knowledge, training assumptions, or unverified opinions.
   NEVER fabricate policies, commitments, or precedents.

2. RETURN ONLY THE DIRECT SPOKEN ANSWER:
   - Output ONLY the direct answer/statement itself in clean spoken language.
   - NEVER output structural labels or headers like "Decision:", "Evidence:", "Reason:", "Caveat:", "Next step:", or "Source:".
   - NEVER read out document filenames, page numbers, or Q&A IDs (e.g. do NOT say "ExecutiveMind_General_Communication_QA_Part_1.docx.pdf" or "Q007").
   - If the database contains an exact answer for the user's inquiry (such as in an approved Q&A document or policy statement), deliver ONLY that exact answer directly (e.g. "I am functioning normally and ready to assist.").

3. ZERO CONVERSATIONAL FILLER:
   - NO pleasantries or filler ("Certainly!", "I would be delighted to help", "Thanks for asking").
   - NO AI disclaimers ("As an AI representation...", "According to the documents provided...").

4. {mode_config["instruction"]}
   Tone: {tone}.
   Directness: {directness_instruction}

5. INSUFFICIENT EVIDENCE:
   If the provided database records do not directly answer the inquiry or establish precedent, respond EXACTLY:
   "I cannot determine this from {client.executive_name}'s saved information. No relevant approved policy or decision record was found in the database."

6. GOVERNANCE & ESCALATION:
   If a question involves financial, legal, or personnel commitments exceeding recorded authority, state the decision limit in one sentence and escalate to {client.executive_name}.

=======================================================
EXECUTIVE DECISION PRINCIPLES & GOVERNANCE RULES
=======================================================
Executive: {client.executive_name} ({client.company or 'Enterprise'})
Decision Approach: {profile.decision_making}
Decision Principles: {profile.decision_principles}
Agent Rules: {profile.agent_rules}

=======================================================
APPROVED DATABASE EVIDENCE (SOURCE OF TRUTH)
=======================================================
[VERIFIED PROFILE RECORDS & PRECEDENTS]
{record_text}

[RETRIEVED DOCUMENT CHUNKS (pgvector)]
{vector_text}

[KNOWLEDGE GRAPH RELATIONS]
{graph_text}

[VERIFIED MEMORIES]
{memory_text}

[COMMUNICATION SITUATION GUIDELINES]
{situation_text}
"""

    if not settings.openai_api_key:
        yield f"System error: OPENAI_API_KEY is not configured for {client.executive_name}."
        return

    llm = AsyncOpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
    messages = [{"role": "system", "content": system_prompt}]

    for item in history[-6:]:
        if item.get("role") in ("user", "assistant"):
            messages.append({"role": item["role"], "content": item["text"]})

    messages.append({"role": "user", "content": user_text})

    model_name = settings.llm_model.lower()
    is_reasoning_model = any(k in model_name for k in ["o1", "o3", "gpt-5"])

    # Calculate token budget:
    base_output_tokens = mode_config["max_tokens"]
    effective_max_tokens = (base_output_tokens + 800) if is_reasoning_model else base_output_tokens

    call_kwargs: dict[str, Any] = {
        "model": settings.llm_model,
        "messages": messages,
        "max_completion_tokens": effective_max_tokens,
        "stream": True,
    }
    if not is_reasoning_model:
        call_kwargs["temperature"] = 0.1
    else:
        call_kwargs["reasoning_effort"] = "low"

    try:
        response_stream = await llm.chat.completions.create(**call_kwargs)
    except Exception as e:
        if "connect" in str(e).lower():
            # Fallback in case of dead environment proxy
            try:
                direct_llm = AsyncOpenAI(
                    api_key=settings.openai_api_key,
                    base_url=settings.openai_base_url,
                    http_client=httpx.AsyncClient(trust_env=False, timeout=60.0)
                )
                response_stream = await direct_llm.chat.completions.create(**call_kwargs)
            except Exception:
                raise e
        else:
            fallback_kwargs: dict[str, Any] = {
                "model": settings.llm_model,
                "messages": messages,
                "stream": True,
            }
            if "max_completion_tokens" in str(e).lower():
                fallback_kwargs["max_tokens"] = effective_max_tokens
            response_stream = await llm.chat.completions.create(**fallback_kwargs)

    # Accumulate tokens and yield completed sentences/clauses as soon as ready
    buffer = ""
    is_first_sentence = True

    async for chunk in response_stream:
        delta = chunk.choices[0].delta.content or ""
        if not delta:
            continue
        buffer += delta

        # Check for sentence or clause boundaries:
        # Match sentence end punctuation followed by whitespace OR at least 25 characters with terminal punctuation
        if re.search(r"[\.\?!;\n](?:\s+|$)", buffer) or (len(buffer) > 70 and " " in buffer[-12:]):
            match = re.search(r"^(.*?[\.\?!;\n])(?:\s+|$)(.*)$", buffer, re.DOTALL)
            if match and len(match.group(1).strip()) > 3:
                clause = match.group(1).strip()
                buffer = match.group(2).strip()
            elif len(buffer) > 70:
                last_space = buffer.rfind(" ")
                if last_space > 25:
                    clause = buffer[:last_space].strip()
                    buffer = buffer[last_space:].strip()
                else:
                    clause = ""
            else:
                clause = ""

            if clause:
                clause = sanitize_response_node({"response": clause})["response"]
                is_first_sentence = False
                if clause:
                    yield clause

    if buffer.strip():
        clause = sanitize_response_node({"response": buffer.strip()})["response"]
        if clause:
            yield clause


async def stream_elevenlabs_tts(
    voice_id: str,
    text_generator: AsyncGenerator[str, None],
    on_audio_chunk: Callable[[str, str, int], Any],
):
    """Pipes text stream into ElevenLabs WebSocket Streaming API and yields base64 raw PCM audio chunks.
    Raw PCM (pcm_24000) avoids browser MP3 chunk decoding artifacts and ensures seamless playback.
    """
    if not settings.elevenlabs_api_key or not voice_id:
        return

    uri = (
        f"wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input"
        f"?model_id={settings.elevenlabs_model_id}&output_format=pcm_24000"
    )

    headers = {"xi-api-key": settings.elevenlabs_api_key}
    connect_kwargs: dict[str, Any] = {"open_timeout": 8}

    # Compatibility for websockets library version parameter naming
    sig = inspect.signature(websockets.connect)
    if "additional_headers" in sig.parameters:
        connect_kwargs["additional_headers"] = headers
    elif "extra_headers" in sig.parameters:
        connect_kwargs["extra_headers"] = headers

    try:
        async with websockets.connect(uri, **connect_kwargs) as ws:
            # 1. Handshake with voice settings
            bos = {
                "text": " ",
                "voice_settings": {
                    "stability": 0.5,
                    "similarity_boost": 0.85,
                },
                "xi_api_key": settings.elevenlabs_api_key,
            }
            await ws.send(json.dumps(bos))

            # Producer task: Stream text into ElevenLabs WebSocket
            async def send_text():
                try:
                    async for sentence in text_generator:
                        if sentence:
                            payload = {
                                "text": sentence + " ",
                                "try_trigger_generation": True,
                            }
                            await ws.send(json.dumps(payload))
                    # End of stream (EOS)
                    await ws.send(json.dumps({"text": ""}))
                except Exception as send_err:
                    clean_err = str(send_err).encode("ascii", "replace").decode("ascii")
                    print(f"Error streaming text to ElevenLabs: {clean_err}")

            # Consumer task: Read raw PCM audio chunks from ElevenLabs WebSocket
            async def receive_audio():
                try:
                    async for message in ws:
                        if isinstance(message, str):
                            data = json.loads(message)
                            audio_b64 = data.get("audio")
                            if audio_b64:
                                await on_audio_chunk(audio_b64, "audio/pcm", 24000)
                            if data.get("isFinal"):
                                break
                except Exception as recv_err:
                    clean_err = str(recv_err).encode("ascii", "replace").decode("ascii")
                    print(f"Error receiving audio from ElevenLabs: {clean_err}")

            await asyncio.gather(send_text(), receive_audio())

    except Exception as exc:
        clean_exc = str(exc).encode("ascii", "replace").decode("ascii")
        print(f"ElevenLabs WebSocket streaming exception: {clean_exc}")
        raise


async def handle_realtime_voice_websocket(websocket: WebSocket, client_id: int):
    """Main WebSocket handler for real-time voice sessions."""
    await websocket.accept()
    print(f"[WebSocket] Accepted connection for client_id={client_id}")

    db = SessionLocal()
    executive_name = f"Executive #{client_id}"
    voice_id = ""
    is_authorized = False

    try:
        c = db.get(Client, client_id)
        if not c:
            print(f"[WebSocket] Client {client_id} not found in database. Closing.")
            await websocket.send_json({"type": "error", "message": "Client not found in database"})
            await websocket.close(code=1000)
            return

        executive_name = c.executive_name
        p = c.profile
        if p:
            voice_id = (p.voice_id or "").strip()
            is_authorized = bool(p.voice_authorized)

        # Fallback to active VoiceClone table record if profile voice_id is unset
        if not voice_id:
            from .models import VoiceClone
            active_vc = db.query(VoiceClone).filter_by(client_id=client_id, is_active=True).first()
            if active_vc and active_vc.voice_id:
                voice_id = active_vc.voice_id.strip()
                is_authorized = True

        # If a voice_id is configured and ElevenLabs key exists, authorize it
        if voice_id and settings.elevenlabs_api_key:
            is_authorized = True

        print(f"[WebSocket] Client {client_id} ({executive_name}) session active (voice_id='{voice_id}', authorized={is_authorized})")
    except Exception as db_err:
        import traceback
        traceback.print_exc()
        print(f"[WebSocket] Error querying client {client_id}: {db_err}")
    finally:
        db.close()

    # Initial session handshake - ALWAYS keep connection open!
    await websocket.send_json({
        "type": "session_started",
        "client_id": client_id,
        "executive_name": executive_name,
        "voice_id": voice_id,
        "voice_authorized": is_authorized,
    })

    if not is_authorized or not voice_id:
        print(f"[WebSocket] Note: Client {client_id} voice not fully configured. Spoken output will be silent until selected in Settings.")
        await websocket.send_json({
            "type": "warning",
            "message": f"Voice twin is not yet configured for {executive_name}. Real-time transcription and reasoning are active; speech synthesis will activate once a voice is selected in Settings > Voice.",
        })

    active_turn_task: asyncio.Task | None = None
    current_conversation_id: int | None = None

    async def run_turn(
        user_query: str,
        conv_id: int | None,
        user_audio_bytes: bytes | None = None,
        user_audio_ext: str = "webm",
    ):
        nonlocal current_conversation_id
        session_db = SessionLocal()
        try:
            client_obj = session_db.get(Client, client_id)
            if not client_obj:
                await websocket.send_json({"type": "error", "message": "Client not found in database."})
                return
            profile_obj = client_obj.profile
            executive_name = client_obj.executive_name

            conversation = session_db.get(Conversation, conv_id) if conv_id else None
            if conversation is None or conversation.client_id != client_id:
                conversation = Conversation(client_id=client_id, channel="voice_realtime")
                session_db.add(conversation)
                session_db.commit()
                session_db.refresh(conversation)

            current_conversation_id = conversation.id

            # Save user message & optional voice audio
            user_msg = Message(conversation_id=conversation.id, role="user", text=user_query)
            session_db.add(user_msg)
            session_db.commit()
            session_db.refresh(user_msg)

            if user_audio_bytes:
                user_url, user_dur = save_audio_file(
                    client_id=client_id,
                    conv_id=conversation.id,
                    msg_id=user_msg.id,
                    role="user",
                    audio_bytes=user_audio_bytes,
                    extension=user_audio_ext,
                )
                user_msg.audio_url = user_url
                user_msg.audio_duration = user_dur
                user_msg.audio_mime = f"audio/{user_audio_ext}"
                session_db.commit()

            # Load history and memories while session is open
            previous = session_db.query(Message).filter(Message.conversation_id == conversation.id).order_by(Message.id.asc()).all()
            history_list = [{"role": m.role, "text": m.text} for m in previous]
            memories_list = session_db.query(Memory).filter(Memory.client_id == client_id).all()

            # Notify client of thinking state
            await websocket.send_json({
                "type": "agent_thinking",
                "conversation_id": current_conversation_id,
                "user_query": user_query,
            })

            accumulated_clauses: list[str] = []
            audio_synthesized = False
            collected_pcm_chunks: list[bytes] = []
            clause_queue: asyncio.Queue[str | None] = asyncio.Queue()

            async def generate_clauses_task():
                try:
                    async for clause in stream_decision_clauses(
                        client_id, client_obj, profile_obj, memories_list, history_list, user_query
                    ):
                        if clause:
                            accumulated_clauses.append(clause)
                            await websocket.send_json({
                                "type": "agent_text_chunk",
                                "text": clause,
                                "conversation_id": current_conversation_id,
                            })
                            await clause_queue.put(clause)
                except Exception as gen_err:
                    clean_err = str(gen_err).encode("ascii", "replace").decode("ascii")
                    print(f"Error streaming decision clauses: {clean_err}")
                finally:
                    await clause_queue.put(None)

            async def text_iterator():
                while True:
                    item = await clause_queue.get()
                    if item is None:
                        break
                    yield item

            async def audio_chunk_consumer(audio_b64: str, mime: str, sample_rate: int):
                if mime == "audio/pcm":
                    try:
                        collected_pcm_chunks.append(base64.b64decode(audio_b64))
                    except Exception:
                        pass
                await websocket.send_json({
                    "type": "audio_chunk",
                    "audio_base64": audio_b64,
                    "mime_type": mime,
                    "sample_rate": sample_rate,
                    "conversation_id": current_conversation_id,
                })

            async def tts_streaming_task():
                nonlocal audio_synthesized
                if not voice_id:
                    async for _ in text_iterator():
                        pass
                    return
                try:
                    await stream_elevenlabs_tts(voice_id, text_iterator(), audio_chunk_consumer)
                    audio_synthesized = True
                except asyncio.CancelledError:
                    raise
                except Exception as tts_err:
                    clean_err = str(tts_err).encode("ascii", "replace").decode("ascii")
                    print(f"Streaming TTS error, falling back to batch synthesis: {clean_err}")

            # Run LLM clause generation and TTS streaming in parallel
            await asyncio.gather(generate_clauses_task(), tts_streaming_task())

            if not accumulated_clauses:
                fallback_text = (
                    f"I am the digital representative for {executive_name}. "
                    "Based on our saved database records, please clarify your question."
                )
                accumulated_clauses.append(fallback_text)
                await websocket.send_json({
                    "type": "agent_text_chunk",
                    "text": fallback_text,
                    "conversation_id": current_conversation_id,
                })

            final_response_text = " ".join(accumulated_clauses).strip()
            assistant_audio_url = None

            # Save assistant response & cloned voice audio
            if final_response_text:
                assistant_msg = Message(conversation_id=current_conversation_id, role="assistant", text=final_response_text)
                session_db.add(assistant_msg)
                session_db.commit()
                session_db.refresh(assistant_msg)

                if collected_pcm_chunks:
                    merged_pcm = b"".join(collected_pcm_chunks)
                    ast_url, ast_dur = save_pcm_as_wav(
                        client_id=client_id,
                        conv_id=current_conversation_id,
                        msg_id=assistant_msg.id,
                        role="assistant",
                        pcm_bytes=merged_pcm,
                        sample_rate=24000,
                    )
                    assistant_msg.audio_url = ast_url
                    assistant_msg.audio_duration = ast_dur
                    assistant_msg.audio_mime = "audio/wav"
                    session_db.commit()
                    assistant_audio_url = ast_url

                # Batch fallback if streaming TTS did not produce audio
                elif not audio_synthesized and settings.elevenlabs_api_key:
                    try:
                        audio_bytes, mime = synthesize_voice(final_response_text, voice_id)
                        ast_url, ast_dur = save_audio_file(
                            client_id=client_id,
                            conv_id=current_conversation_id,
                            msg_id=assistant_msg.id,
                            role="assistant",
                            audio_bytes=audio_bytes,
                            extension="mp3",
                        )
                        assistant_msg.audio_url = ast_url
                        assistant_msg.audio_duration = ast_dur
                        assistant_msg.audio_mime = mime
                        session_db.commit()
                        assistant_audio_url = ast_url

                        await websocket.send_json({
                            "type": "audio_chunk",
                            "audio_base64": base64.b64encode(audio_bytes).decode(),
                            "mime_type": mime,
                            "conversation_id": current_conversation_id,
                        })
                    except Exception as synth_err:
                        clean_err = str(synth_err).encode("ascii", "replace").decode("ascii")
                        print(f"Fallback synthesis error: {clean_err}")

            # Update conversation metadata (title, summary, duration)
            update_conversation_metadata(
                conv_id=current_conversation_id,
                db=session_db,
                user_query=user_query,
                channel="voice_realtime",
            )

            await websocket.send_json({
                "type": "agent_turn_finished",
                "full_response": final_response_text,
                "conversation_id": current_conversation_id,
                "assistant_audio_url": assistant_audio_url,
                "user_audio_url": user_msg.audio_url if "user_msg" in locals() else None,
            })
        except Exception as turn_err:
            clean_err = str(turn_err).encode("ascii", "replace").decode("ascii")
            print(f"Turn execution error: {clean_err}")
            await websocket.send_json({
                "type": "error",
                "message": f"Voice turn error: {clean_err}",
            })
        finally:
            session_db.close()

    try:
        while True:
            raw_msg = await websocket.receive_text()
            try:
                data = json.loads(raw_msg)
            except Exception:
                continue

            msg_type = data.get("type")

            # Case 0: Heartbeat Ping/Pong
            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            # Case 1: User Barge-In / Interruption
            if msg_type == "interrupt":
                if active_turn_task and not active_turn_task.done():
                    active_turn_task.cancel()
                    active_turn_task = None
                await websocket.send_json({
                    "type": "interrupted",
                    "conversation_id": current_conversation_id,
                })

            # Case 2: Real-time user transcription (from browser STT or fast client)
            elif msg_type == "user_transcription":
                user_text = data.get("text", "").strip()
                conv_id = data.get("conversation_id", current_conversation_id)
                audio_b64 = data.get("audio_base64")
                user_audio_bytes = None
                user_audio_ext = "webm"
                if audio_b64:
                    try:
                        user_audio_bytes = base64.b64decode(audio_b64)
                        filename = data.get("filename", "voice.webm")
                        if "wav" in filename:
                            user_audio_ext = "wav"
                    except Exception:
                        pass
                if user_text:
                    if active_turn_task and not active_turn_task.done():
                        active_turn_task.cancel()
                    active_turn_task = asyncio.create_task(
                        run_turn(
                            user_query=user_text,
                            conv_id=conv_id,
                            user_audio_bytes=user_audio_bytes,
                            user_audio_ext=user_audio_ext,
                        )
                    )

            # Case 3: Binary audio turn (transcribed via Whisper on backend)
            elif msg_type == "audio_turn":
                audio_b64 = data.get("audio_base64", "")
                filename = data.get("filename", "voice.webm")
                conv_id = data.get("conversation_id", current_conversation_id)

                if not audio_b64:
                    await websocket.send_json({
                        "type": "error",
                        "message": "No audio data received. Please try speaking again.",
                    })
                    continue

                raw_audio = base64.b64decode(audio_b64)
                if len(raw_audio) < 1000:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Audio recording was too short or silent. Please speak clearly for at least 1-2 seconds.",
                    })
                    continue

                try:
                    transcript = await asyncio.to_thread(transcribe_audio, raw_audio, filename, executive_name)
                    if not transcript or not transcript.strip():
                        await websocket.send_json({
                            "type": "error",
                            "message": "No clear speech detected in recording. Please check your microphone and speak clearly.",
                        })
                        continue

                    await websocket.send_json({
                        "type": "user_transcript",
                        "text": transcript,
                        "conversation_id": conv_id,
                    })
                    if active_turn_task and not active_turn_task.done():
                        active_turn_task.cancel()
                    active_turn_task = asyncio.create_task(
                        run_turn(
                            user_query=transcript,
                            conv_id=conv_id,
                            user_audio_bytes=raw_audio,
                            user_audio_ext="webm" if "webm" in filename else "wav",
                        )
                    )
                except Exception as stt_err:
                    clean_err = str(stt_err).encode("ascii", "replace").decode("ascii")
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Transcription error: {clean_err}",
                    })

            # Case 4: Heartbeat ping
            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        print(f"[WebSocket] Client {client_id} disconnected normally.")
        if active_turn_task and not active_turn_task.done():
            active_turn_task.cancel()
    except Exception as loop_err:
        import traceback
        traceback.print_exc()
        clean_err = str(loop_err).encode("ascii", "replace").decode("ascii")
        print(f"[WebSocket] Session exception for client {client_id}: {clean_err}")
        if active_turn_task and not active_turn_task.done():
            active_turn_task.cancel()

