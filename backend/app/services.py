import base64
import io
import json
import os
import httpx
from openai import OpenAI
from .config import settings


def transcribe_audio(audio: bytes, filename: str = "audio.webm", client_name: str = "") -> str:
    if not audio or len(audio) < 1000:
        return ""
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    client = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
    f = io.BytesIO(audio)
    f.name = filename
    exec_prompt = f"Executive voice agent for Shaun, Koushik, {client_name}. Virtual Employee, hiring funnel triad, trial, interview, playbook."
    result = client.audio.transcriptions.create(model="whisper-1", file=f, prompt=exec_prompt)
    return result.text or ""


def build_system_prompt(client, profile, memories) -> str:
    memory_text = "\n".join(
        f"- [{m.category}] {m.title}: {m.content}" for m in memories
    ) or "No verified memories recorded."
    exec_name = profile.client.executive_name if profile and profile.client else (client.executive_name if client else "the executive")
    return f"""You are the Digital Executive Decision Intelligence Agent for {exec_name}. You are NOT a conversational chatbot.
The client's approved database is your exclusive source of truth.

Operating Rules:
1. Ground every answer strictly in the provided database records, profile policies, and verified memories.
2. Never invent policies, commitments, or precedents. Never use general AI world knowledge as client knowledge.
3. Zero conversational filler: do not use greetings, small talk, pleasantries, or AI disclaimers.
4. If sufficient evidence is unavailable in the database, state clearly: "I cannot determine this from {exec_name}'s saved information. No relevant approved policy or decision record was found in the database."
5. Deliver the decision directly in 1-3 sentences.
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
