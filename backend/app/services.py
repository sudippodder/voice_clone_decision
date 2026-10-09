import base64
import io
import json
import os
import httpx
from openai import OpenAI
from .config import settings


def transcribe_audio(audio: bytes, filename: str = "audio.webm") -> str:
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    client = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
    f = io.BytesIO(audio)
    f.name = filename
    result = client.audio.transcriptions.create(model="whisper-1", file=f)
    return result.text


def build_system_prompt(client, profile, memories) -> str:
    memory_text = "\n".join(
        f"- [{m.category}] {m.title}: {m.content}" for m in memories
    ) or "No verified memories have been added yet."
    call_name = (getattr(profile, "agent_call_name", "") or (profile.client.executive_name.split()[0] if profile and profile.client else "Shaun")).strip()
    return f"""You are the authorized AI voice representative for {profile.client.executive_name if profile else client.executive_name}. Your designated call/wake name is "{call_name}". People will address you directly as "{call_name}". You are NOT the human. Be transparent that you are the client's AI representative if asked or when identity could be misunderstood.

Executive profile:
About: {profile.about}
Personality: {profile.personality}
Leadership: {profile.leadership_style}
Decision making: {profile.decision_making}
Communication style: {profile.communication_style}
Business context: {profile.business_context}
Decision principles: {profile.decision_principles}
People context: {profile.people_context}
Agent rules: {profile.agent_rules}
Preferred language: {profile.preferred_language}

Verified memories:
{memory_text}

Behavior:
1. Speak naturally and concisely in the executive's communication style.
2. Use only information supported by the profile, verified memories, and the current conversation.
3. Never invent a decision, commitment, fact, relationship, or company policy.
4. If information is missing or the matter is high-impact, say that you cannot reliably represent the executive's position and ask for clarification or recommend human approval.
5. Prioritize the executive's documented principles over generic assistant behavior.
6. Never claim that the human personally spoke when you generated the response.
"""


def generate_response(client, profile, memories, history, user_text) -> str:
    if not settings.openai_api_key:
        # Safe local fallback for UI testing without an LLM key.
        return "I am the client's AI representative. The language model is not configured yet, so I cannot give a reliable executive-specific answer. Please configure OPENAI_API_KEY."
    llm = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
    messages = [{"role": "system", "content": build_system_prompt(client, profile, memories)}]
    for item in history[-12:]:
        messages.append({"role": item["role"], "content": item["text"]})
    messages.append({"role": "user", "content": user_text})
    try:
        result = llm.chat.completions.create(model=settings.llm_model, messages=messages, temperature=0.35)
    except Exception as e:
        if "temperature" in str(e).lower():
            result = llm.chat.completions.create(model=settings.llm_model, messages=messages)
        else:
            raise
    return result.choices[0].message.content.strip()


OPENAI_VOICES = {"alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer"}


def get_elevenlabs_voices() -> list[dict]:
    if not settings.elevenlabs_api_key:
        return []
    try:
        r = httpx.get("https://api.elevenlabs.io/v1/voices", headers={"xi-api-key": settings.elevenlabs_api_key}, timeout=20)
        if r.status_code == 200:
            voices = r.json().get("voices", [])
            results = []
            for v in voices:
                results.append({
                    "voice_id": v.get("voice_id", ""),
                    "name": v.get("name", "Unknown Voice"),
                    "category": v.get("category", "generated"),
                    "preview_url": v.get("preview_url", ""),
                    "description": (v.get("description") or v.get("labels", {}).get("description") or v.get("labels", {}).get("accent") or "").strip()
                })
            return results
    except Exception as e:
        print(f"Failed to fetch ElevenLabs voices: {e}")
    return []


def clone_voice(voice_name: str, audio: bytes, filename: str) -> str:
    if not settings.elevenlabs_api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is not configured in .env. Voice cloning requires an ElevenLabs API key.")

    headers = {"xi-api-key": settings.elevenlabs_api_key}
    
    # Determine audio MIME type
    lower_fn = (filename or "").lower()
    mime_type = "audio/mpeg"
    if lower_fn.endswith(".wav"):
        mime_type = "audio/wav"
    elif lower_fn.endswith(".webm"):
        mime_type = "audio/webm"
    elif lower_fn.endswith(".m4a") or lower_fn.endswith(".mp4"):
        mime_type = "audio/mp4"
    elif lower_fn.endswith(".ogg"):
        mime_type = "audio/ogg"

    files = {"files": (filename or "sample.mp3", audio, mime_type)}
    data = {"name": voice_name, "description": f"Authorized executive voice clone for {voice_name}"}

    try:
        r = httpx.post("https://api.elevenlabs.io/v1/voices/add", headers=headers, files=files, data=data, timeout=120)
    except httpx.RequestError as e:
        raise RuntimeError(f"Network error connecting to ElevenLabs voice cloning API: {e}")

    if r.status_code in (200, 201):
        voice_id = r.json().get("voice_id")
        if voice_id:
            return voice_id
        raise RuntimeError("ElevenLabs responded without a valid voice_id.")

    # Parse error response cleanly
    try:
        err_json = r.json()
        detail = err_json.get("detail", {})
        if isinstance(detail, dict):
            code = detail.get("code") or detail.get("status") or ""
            msg = detail.get("message") or str(detail)
            if code in ("paid_plan_required", "can_not_use_instant_voice_cloning") or "paid" in msg.lower():
                raise RuntimeError(
                    "Instant Voice Cloning requires an ElevenLabs paid subscription (Starter tier $5/mo or higher). "
                    "Your ElevenLabs key is currently on the free tier, which restricts instant voice cloning from uploaded audio. "
                    "You can upgrade your ElevenLabs account, or select an existing ElevenLabs voice / paste a custom voice ID."
                )
            raise RuntimeError(f"ElevenLabs error: {msg}")
        elif isinstance(detail, str):
            raise RuntimeError(f"ElevenLabs error: {detail}")
    except Exception as e:
        if isinstance(e, RuntimeError):
            raise
    
    raise RuntimeError(f"ElevenLabs returned HTTP {r.status_code}: {r.text[:300]}")


def update_elevenlabs_voice_name(voice_id: str, new_name: str) -> bool:
    """Updates the voice clone name on ElevenLabs account if applicable."""
    if not settings.elevenlabs_api_key or not voice_id or voice_id in OPENAI_VOICES:
        return False
    try:
        url = f"https://api.elevenlabs.io/v1/voices/{voice_id}/edit"
        headers = {"xi-api-key": settings.elevenlabs_api_key}
        r = httpx.post(url, headers=headers, data={"name": new_name}, timeout=15)
        return r.status_code == 200
    except Exception as e:
        print(f"Notice: Failed to update voice name on ElevenLabs: {e}")
        return False


def synthesize_voice(text: str, voice_id: str = "onyx", voice_provider: str = "openai") -> tuple[bytes, str]:
    if not voice_id or voice_id.startswith("demo_") or voice_id == "browser":
        # Fallback to client-side Web Speech API
        return b"", "audio/speech-synthesis"

    v_lower = (voice_id or "").lower().strip()
    is_openai_voice = v_lower in OPENAI_VOICES
    provider = (voice_provider or "openai").lower().strip()

    # 1. ElevenLabs synthesis (when provider is elevenlabs OR when voice_id is not an OpenAI preset)
    if (provider == "elevenlabs" or not is_openai_voice) and settings.elevenlabs_api_key:
        try:
            url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
            headers = {"xi-api-key": settings.elevenlabs_api_key, "Content-Type": "application/json", "Accept": "audio/mpeg"}
            payload = {
                "text": text,
                "model_id": settings.elevenlabs_model_id or "eleven_multilingual_v2",
                "voice_settings": {"stability": 0.5, "similarity_boost": 0.85, "style": 0.15, "use_speaker_boost": True},
            }
            r = httpx.post(url, headers=headers, json=payload, timeout=60)
            if r.status_code == 200 and r.content:
                return r.content, "audio/mpeg"
            else:
                print(f"ElevenLabs TTS status {r.status_code}: {r.text[:200]}")
        except Exception as e:
            print(f"ElevenLabs synthesis error: {e}")

    # 2. OpenAI TTS synthesis
    if settings.openai_api_key:
        try:
            client = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
            target_voice = v_lower if is_openai_voice else (settings.openai_tts_voice or "onyx")
            response = client.audio.speech.create(
                model=settings.openai_tts_model,
                voice=target_voice,
                input=text,
                response_format="mp3",
            )
            return response.content, "audio/mpeg"
        except Exception as e:
            print(f"OpenAI TTS synthesis error: {e}")

    return b"", "audio/speech-synthesis"
    if (provider == "elevenlabs" or not is_openai_voice) and settings.elevenlabs_api_key:
        try:
            url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
            headers = {"xi-api-key": settings.elevenlabs_api_key, "Content-Type": "application/json", "Accept": "audio/mpeg"}
            payload = {
                "text": text,
                "model_id": settings.elevenlabs_model_id or "eleven_multilingual_v2",
                "voice_settings": {"stability": 0.5, "similarity_boost": 0.85, "style": 0.15, "use_speaker_boost": True},
            }
            r = httpx.post(url, headers=headers, json=payload, timeout=60)
            if r.status_code == 200 and r.content:
                return r.content, "audio/mpeg"
            else:
                print(f"ElevenLabs TTS status {r.status_code}: {r.text[:200]}")
        except Exception as e:
            print(f"ElevenLabs synthesis error: {e}")

    # 3. OpenAI TTS synthesis
    if settings.openai_api_key:
        try:
            client = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
            target_voice = v_lower if is_openai_voice else (settings.openai_tts_voice or "onyx")
            response = client.audio.speech.create(
                model=settings.openai_tts_model,
                voice=target_voice,
                input=text,
                response_format="mp3",
            )
            return response.content, "audio/mpeg"
        except Exception as e:
            print(f"OpenAI TTS synthesis error: {e}")

    return b"", "audio/speech-synthesis"

