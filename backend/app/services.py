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
    return f"""You are the authorized AI voice representative for {profile.client.executive_name if profile else client.executive_name}. You are NOT the human. Be transparent that you are the client's AI representative if asked or when identity could be misunderstood.

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


def generate_response(client_id: int, client, profile, memories, history, user_text) -> str:
    # LangGraph orchestrates graph retrieval and GPT reasoning.
    from .decision_workflow import run_decision
    return run_decision(client_id, client, profile, memories, history, user_text)


def clone_voice(voice_name: str, audio: bytes, filename: str) -> str:
    if not settings.elevenlabs_api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is not configured")
    headers = {"xi-api-key": settings.elevenlabs_api_key}
    files = {"files": (filename, audio, "audio/webm")}
    data = {"name": voice_name, "description": "Authorized executive digital voice"}
    r = httpx.post("https://api.elevenlabs.io/v1/voices/add", headers=headers, files=files, data=data, timeout=120)
    r.raise_for_status()
    return r.json()["voice_id"]


def synthesize_voice(text: str, voice_id: str) -> tuple[bytes, str]:
    if not settings.elevenlabs_api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is not configured")
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {"xi-api-key": settings.elevenlabs_api_key, "Content-Type": "application/json", "Accept": "audio/mpeg"}
    payload = {
        "text": text,
        "model_id": settings.elevenlabs_model_id,
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.85, "style": 0.15, "use_speaker_boost": True},
    }
    r = httpx.post(url, headers=headers, json=payload, timeout=120)
    r.raise_for_status()
    return r.content, "audio/mpeg"
