import base64
import time
from pathlib import Path
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from .config import settings
from .db import Base, engine, get_db
from .models import Client, ExecutiveProfile, Memory, Conversation, Message
from .schemas import ClientCreate, ClientUpdate, ProfileUpdate, MemoryCreate, VoiceConfig, TextTurnRequest, LoginRequest
from .security import require_admin
from .services import OPENAI_VOICES, clone_voice, generate_response, synthesize_voice, transcribe_audio, get_elevenlabs_voices, update_elevenlabs_voice_name

from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Executive Voice Agent API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=[x.strip() for x in settings.cors_origins.split(",")], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

uploads_dir = Path("uploads")
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    db = next(get_db())
    try:
        if db.query(Client).count() == 0:
            c = Client(name="Demo Client", executive_name="Alex Morgan", company="Demo Company", industry="Technology")
            db.add(c); db.flush()
            db.add(ExecutiveProfile(
                client_id=c.id,
                about="Founder and technology executive.",
                personality="Calm, analytical and direct.",
                leadership_style="Collaborative but accountable.",
                decision_making="Balances customer impact, delivery risk and long-term business value.",
                communication_style="Professional, concise and warm.",
                decision_principles="Protect long-term relationships, avoid unsupported commitments, and use evidence before making important decisions.",
                agent_rules="Do not invent facts. Escalate legal, financial and sensitive personnel decisions.",
                preferred_language="English",
                voice_id="onyx",
                voice_name="Onyx Persona",
                voice_provider="openai",
                voice_authorized=True,
                voice_consent_text="I explicitly authorize this AI executive representative to use OpenAI TTS Onyx neural voice."
            ))
            db.add(Memory(client_id=c.id, category="general", title="Demo principle", content="Be concise, practical and transparent when information is incomplete."))
            db.commit()
        # Ensure any client with empty profile gets basic defaults without overriding ElevenLabs configs
        pass
    finally:
        db.close()

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/api/auth/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    u = payload.username.strip().lower()
    p = payload.password.strip()

    # Secret executive account: virtualemployee / virtual@1234 only
    if u == "virtualemployee" and p == "virtual@1234":
        shaun_client = db.query(Client).filter(Client.executive_name.ilike("%shaun%")).first()
        return {
            "ok": True,
            "access_token": "token-virtualemployee-session",
            "admin_key": settings.admin_api_key,
            "user": {
                "username": "virtualemployee",
                "name": "Virtual Employee Executive",
                "role": "Executive Administrator",
                "email": shaun_client.email if shaun_client else "shaun@virtualemployee.com",
                "client_id": shaun_client.id if shaun_client else 4
            }
        }

    raise HTTPException(
        status_code=401,
        detail="Invalid credentials. Access restricted."
    )

@app.get("/api/auth/me")
def get_auth_me(token: str | None = None, db: Session = Depends(get_db)):
    shaun_client = db.query(Client).filter(Client.executive_name.ilike("%shaun%")).first()
    return {
        "authenticated": True,
        "user": {
            "username": "virtualemployee",
            "name": "Virtual Employee Executive",
            "role": "Executive Administrator",
            "email": shaun_client.email if shaun_client else "shaun@virtualemployee.com",
            "client_id": shaun_client.id if shaun_client else 4
        }
    }

@app.get("/api/clients", dependencies=[Depends(require_admin)])
def clients(db: Session = Depends(get_db)):
    all_clients = db.query(Client).order_by(Client.id.desc()).all()
    out = []
    for c in all_clients:
        out.append({
            "id": c.id,
            "name": c.name,
            "executive_name": c.executive_name,
            "company": c.company or "",
            "industry": c.industry or "",
            "email": c.email or "",
            "phone": c.phone or "",
            "active": c.active,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "voice_id": c.profile.voice_id if c.profile else "",
            "voice_name": c.profile.voice_name if c.profile else "",
            "voice_provider": c.profile.voice_provider if c.profile else "elevenlabs",
            "voice_authorized": c.profile.voice_authorized if c.profile else False,
        })
    return out

@app.post("/api/clients", dependencies=[Depends(require_admin)])
def create_client(payload: ClientCreate, db: Session = Depends(get_db)):
    data = payload.model_dump()
    v_id = data.pop("voice_id", None) or "bfJAAFM54j2wqqMBZL9Y"
    v_name = data.pop("voice_name", None) or f"{payload.executive_name} Voice"
    v_provider = data.pop("voice_provider", None) or "elevenlabs"

    c = Client(**data)
    db.add(c); db.flush()
    call_name = payload.executive_name.split()[0] if payload.executive_name else "Alex"
    profile = ExecutiveProfile(
        client_id=c.id,
        voice_id=v_id,
        voice_name=v_name,
        voice_provider=v_provider,
        voice_authorized=True,
        agent_call_name=call_name,
        voice_consent_text=f"I explicitly authorize the AI voice representative for {payload.executive_name}."
    )
    db.add(profile)
    db.commit()
    db.refresh(c)
    return {
        "id": c.id,
        "name": c.name,
        "executive_name": c.executive_name,
        "company": c.company or "",
        "industry": c.industry or "",
        "email": c.email or "",
        "phone": c.phone or "",
        "active": c.active,
        "voice_id": profile.voice_id,
        "voice_name": profile.voice_name,
        "voice_provider": profile.voice_provider,
        "voice_authorized": profile.voice_authorized,
    }

@app.get("/api/clients/{client_id}", dependencies=[Depends(require_admin)])
def get_client(client_id: int, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c: raise HTTPException(404, "Client not found")
    return {"client": c, "profile": c.profile, "memories": c.memories}

@app.put("/api/clients/{client_id}", dependencies=[Depends(require_admin)])
def update_client(client_id: int, payload: ClientUpdate, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c: raise HTTPException(404, "Client not found")
    data = payload.model_dump(exclude_unset=True)
    v_id = data.pop("voice_id", None)
    v_name = data.pop("voice_name", None)
    v_prov = data.pop("voice_provider", None)

    for k, v in data.items():
        if v is not None:
            setattr(c, k, v)

    if c.profile:
        if v_id is not None:
            c.profile.voice_id = v_id
        if v_name is not None:
            c.profile.voice_name = v_name
            if c.profile.voice_provider == "elevenlabs" and c.profile.voice_id:
                update_elevenlabs_voice_name(c.profile.voice_id, v_name)
        if v_prov is not None:
            c.profile.voice_provider = v_prov
    db.commit()
    db.refresh(c)
    return {
        "id": c.id,
        "name": c.name,
        "executive_name": c.executive_name,
        "company": c.company or "",
        "industry": c.industry or "",
        "email": c.email or "",
        "phone": c.phone or "",
        "active": c.active,
        "voice_id": c.profile.voice_id if c.profile else "",
        "voice_name": c.profile.voice_name if c.profile else "",
        "voice_provider": c.profile.voice_provider if c.profile else "elevenlabs",
        "voice_authorized": c.profile.voice_authorized if c.profile else False,
    }

@app.delete("/api/clients/{client_id}", dependencies=[Depends(require_admin)])
def delete_client(client_id: int, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c: raise HTTPException(404, "Client not found")
    conv_ids = [conv.id for conv in db.query(Conversation).filter(Conversation.client_id == client_id).all()]
    if conv_ids:
        db.query(Message).filter(Message.conversation_id.in_(conv_ids)).delete(synchronize_session=False)
        db.query(Conversation).filter(Conversation.id.in_(conv_ids)).delete(synchronize_session=False)
    client_name = c.name
    db.delete(c)
    db.commit()
    return {"ok": True, "message": f"Client '{client_name}' and all associated records removed successfully"}

@app.get("/api/voice/library", dependencies=[Depends(require_admin)])
def get_voice_library(db: Session = Depends(get_db)):
    eleven_voices = get_elevenlabs_voices()
    clients = db.query(Client).all()
    usage_map = {}
    for cl in clients:
        if cl.profile and cl.profile.voice_id:
            vid = cl.profile.voice_id
            usage_map.setdefault(vid, []).append({
                "id": cl.id,
                "name": cl.name,
                "executive_name": cl.executive_name,
                "voice_name": cl.profile.voice_name or cl.executive_name
            })
    registered_ids = {v.get("voice_id") for v in eleven_voices}
    library = []
    for v in eleven_voices:
        vid = v.get("voice_id")
        assigned = usage_map.get(vid, [])
        library.append({
            "voice_id": vid,
            "name": v.get("name"),
            "category": v.get("category", "voice"),
            "description": v.get("description", ""),
            "preview_url": v.get("preview_url"),
            "provider": "elevenlabs",
            "assigned_clients": assigned,
        })
    for cl in clients:
        if cl.profile and cl.profile.voice_id and cl.profile.voice_id not in registered_ids:
            vid = cl.profile.voice_id
            registered_ids.add(vid)
            library.append({
                "voice_id": vid,
                "name": cl.profile.voice_name or f"{cl.executive_name} Custom Voice",
                "category": "custom",
                "description": f"Custom voice assigned to {cl.name}",
                "preview_url": None,
                "provider": cl.profile.voice_provider or "elevenlabs",
                "assigned_clients": usage_map.get(vid, []),
            })
    return {
        "voices": library,
        "cloned_count": sum(1 for v in library if v.get("category") == "cloned"),
        "total_count": len(library)
    }

@app.put("/api/clients/{client_id}/profile", dependencies=[Depends(require_admin)])
def update_profile(client_id: int, payload: ProfileUpdate, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c: raise HTTPException(404, "Client not found")
    p = c.profile or ExecutiveProfile(client_id=client_id)
    for k, v in payload.model_dump().items(): setattr(p, k, v)
    db.add(p); db.commit(); db.refresh(p)
    return p

@app.put("/api/clients/{client_id}/voice", dependencies=[Depends(require_admin)])
def update_voice(client_id: int, payload: VoiceConfig, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c or not c.profile: raise HTTPException(404, "Client/profile not found")
    if payload.voice_authorized and not payload.voice_consent_text.strip():
        raise HTTPException(400, "Voice consent text is required")
    if payload.voice_name and payload.voice_provider == "elevenlabs" and payload.voice_id:
        update_elevenlabs_voice_name(payload.voice_id, payload.voice_name)
    for k, v in payload.model_dump().items(): setattr(c.profile, k, v)
    db.commit(); db.refresh(c.profile)
    return c.profile

@app.put("/api/clients/{client_id}/voice/name", dependencies=[Depends(require_admin)])
def update_voice_clone_name(client_id: int, payload: dict, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c or not c.profile: raise HTTPException(404, "Client/profile not found")
    new_name = payload.get("voice_name", "").strip()
    if not new_name:
        raise HTTPException(400, "Voice clone name cannot be empty")
    c.profile.voice_name = new_name
    synced = False
    if c.profile.voice_provider == "elevenlabs" and c.profile.voice_id:
        synced = update_elevenlabs_voice_name(c.profile.voice_id, new_name)
    db.commit()
    db.refresh(c.profile)
    return {
        "ok": True, 
        "voice_name": new_name, 
        "voice_id": c.profile.voice_id, 
        "elevenlabs_synced": synced,
        "message": f"Voice clone renamed to '{new_name}' in database" + (" and synced to ElevenLabs!" if synced else ".")
    }

@app.get("/api/voice/elevenlabs/voices", dependencies=[Depends(require_admin)])
def list_elevenlabs_voices():
    return {"voices": get_elevenlabs_voices(), "has_key": bool(settings.elevenlabs_api_key)}

@app.post("/api/voice/clone", dependencies=[Depends(require_admin)])
async def clone_library_voice(
    voice_name: str = Form(...),
    file: UploadFile = File(...),
    consent_text: str = Form(default="I confirm I hold proper legal authorization and consent to clone this voice."),
    client_id: int | None = Form(default=None),
    provider: str = Form(default="elevenlabs"),
    db: Session = Depends(get_db)
):
    target_voice_name = voice_name.strip()
    if not target_voice_name:
        raise HTTPException(400, "Voice Clone Name is required.")
    
    audio = await file.read()
    if len(audio) < 1000:
        raise HTTPException(400, "Audio sample is too short or empty (minimum 1KB).")

    # Local audit record
    try:
        uploads_dir = Path("uploads")
        uploads_dir.mkdir(parents=True, exist_ok=True)
        sample_path = uploads_dir / f"library_clone_{int(time.time())}_{file.filename or 'voice.webm'}"
        sample_path.write_bytes(audio)
    except Exception as e:
        print(f"Notice: Failed to save audio sample locally: {e}")

    chosen_provider = provider.lower().strip() if provider else "elevenlabs"

    if chosen_provider == "elevenlabs":
        if not settings.elevenlabs_api_key:
            raise HTTPException(400, "ELEVENLABS_API_KEY is not configured in .env. Please configure your ElevenLabs API key for voice cloning.")
        try:
            voice_id = clone_voice(target_voice_name, audio, file.filename or "voice.mp3")
            provider_out = "elevenlabs"
        except RuntimeError as e:
            raise HTTPException(400, str(e))
        except Exception as e:
            raise HTTPException(502, f"Voice cloning failed: {e}")
    else:
        raise HTTPException(400, "Only ElevenLabs is currently supported for instant voice cloning.")

    assigned_client_info = None
    if client_id is not None:
        c = db.get(Client, client_id)
        if c and c.profile:
            c.profile.voice_id = voice_id
            c.profile.voice_name = target_voice_name
            c.profile.voice_provider = provider_out
            c.profile.voice_authorized = True
            c.profile.voice_consent_text = consent_text
            db.commit()
            assigned_client_info = {
                "id": c.id,
                "name": c.name,
                "executive_name": c.executive_name
            }

    return {
        "ok": True,
        "voice_id": voice_id,
        "voice_name": target_voice_name,
        "provider": provider_out,
        "category": "cloned",
        "assigned_to_client": assigned_client_info,
        "message": f"Successfully created voice clone '{target_voice_name}' with ElevenLabs! Voice ID: {voice_id}" + (f" and assigned to {assigned_client_info['executive_name']}." if assigned_client_info else " (Saved to Voice Library).")
    }

@app.put("/api/voice/{voice_id}/name", dependencies=[Depends(require_admin)])
def update_library_voice_name(voice_id: str, payload: dict, db: Session = Depends(get_db)):
    new_name = payload.get("voice_name", "").strip()
    if not new_name:
        raise HTTPException(400, "Voice name cannot be empty")
    synced = update_elevenlabs_voice_name(voice_id, new_name)
    profiles = db.query(ExecutiveProfile).filter(ExecutiveProfile.voice_id == voice_id).all()
    for p in profiles:
        p.voice_name = new_name
    db.commit()
    return {
        "ok": True,
        "voice_id": voice_id,
        "voice_name": new_name,
        "elevenlabs_synced": synced,
        "affected_clients_count": len(profiles),
        "message": f"Voice renamed to '{new_name}'" + (" and synced to ElevenLabs!" if synced else ".")
    }

@app.post("/api/clients/{client_id}/voice/clone", dependencies=[Depends(require_admin)])
async def create_voice_clone(
    client_id: int, 
    consent_text: str = Form(...), 
    file: UploadFile = File(...), 
    voice_name: str = Form(default=""),
    voice_choice: str = Form(default=""), 
    provider: str = Form(default="elevenlabs"),
    db: Session = Depends(get_db)
):
    c = db.get(Client, client_id)
    if not c or not c.profile: raise HTTPException(404, "Client/profile not found")
    if not consent_text.strip(): raise HTTPException(400, "Consent is required")
    audio = await file.read()
    if len(audio) < 1000: raise HTTPException(400, "Voice sample audio is too short or empty (minimum 1KB)")

    # Save uploaded voice sample locally as reference audit record
    try:
        uploads_dir = Path("uploads")
        uploads_dir.mkdir(parents=True, exist_ok=True)
        sample_path = uploads_dir / f"client_{client_id}_sample_{file.filename or 'voice.webm'}"
        sample_path.write_bytes(audio)
    except Exception as e:
        print(f"Notice: Failed to save audio sample locally: {e}")

    chosen_provider = provider.lower().strip() if provider else "elevenlabs"
    target_voice_name = voice_name.strip() or f"{c.executive_name} Voice Clone"
    
    if chosen_provider == "elevenlabs":
        if not settings.elevenlabs_api_key:
            raise HTTPException(400, "ELEVENLABS_API_KEY is not configured in .env. Please configure your ElevenLabs API key for voice cloning.")
        try:
            voice_id = clone_voice(target_voice_name, audio, file.filename or "voice.mp3")
            provider_out = "elevenlabs"
        except RuntimeError as e:
            raise HTTPException(400, str(e))
        except Exception as e:
            raise HTTPException(502, f"Voice cloning failed: {e}")
    else:
        # OpenAI TTS neural voice assignment
        voice_id = voice_choice if voice_choice in OPENAI_VOICES else (settings.openai_tts_voice or "onyx")
        provider_out = "openai"
        target_voice_name = f"OpenAI {voice_id.capitalize()}"


    c.profile.voice_id = voice_id
    c.profile.voice_name = target_voice_name
    c.profile.voice_provider = provider_out
    c.profile.voice_authorized = True
    c.profile.voice_consent_text = consent_text
    db.commit()
    return {
        "voice_id": voice_id,
        "voice_name": target_voice_name,
        "provider": provider_out, 
        "authorized": True,
        "executive_name": c.executive_name,
        "message": f"Successfully configured {provider_out.upper()} voice \"{target_voice_name}\" for {c.executive_name}! Voice ID: {voice_id}"
    }

@app.get("/api/voice/preview", dependencies=[Depends(require_admin)])
def preview_voice(voice: str = "onyx", text: str = "Hello, I am your digital executive representative.", provider: str = "openai"):
    audio_bytes, mime = synthesize_voice(text, voice, provider)
    return {"voice": voice, "provider": provider, "audio_base64": base64.b64encode(audio_bytes).decode(), "mime_type": mime}


@app.post("/api/clients/{client_id}/memories", dependencies=[Depends(require_admin)])
def add_memory(client_id: int, payload: MemoryCreate, db: Session = Depends(get_db)):
    if not db.get(Client, client_id): raise HTTPException(404, "Client not found")
    m = Memory(client_id=client_id, **payload.model_dump()); db.add(m); db.commit(); db.refresh(m); return m

@app.delete("/api/memories/{memory_id}", dependencies=[Depends(require_admin)])
def delete_memory(memory_id: int, db: Session = Depends(get_db)):
    m = db.get(Memory, memory_id)
    if not m: raise HTTPException(404, "Memory not found")
    db.delete(m); db.commit(); return {"ok": True}

@app.post("/api/clients/{client_id}/voice/turn", dependencies=[Depends(require_admin)])
async def voice_turn(client_id: int, audio: UploadFile = File(...), conversation_id: int | None = Form(default=None), db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c or not c.profile: raise HTTPException(404, "Client/profile not found")
    p = c.profile
    if not p.voice_authorized or not p.voice_id:
        raise HTTPException(400, "An authorized voice is not configured for this client")
    raw = await audio.read()
    try:
        transcript = transcribe_audio(raw, audio.filename or "audio.webm")
        conversation = db.get(Conversation, conversation_id) if conversation_id else None
        if conversation is None or conversation.client_id != client_id:
            conversation = Conversation(client_id=client_id); db.add(conversation); db.flush()
        previous = db.query(Message).filter(Message.conversation_id == conversation.id).order_by(Message.id.asc()).all()
        history = [{"role": m.role, "text": m.text} for m in previous]
        memories = db.query(Memory).filter(Memory.client_id == client_id).all()
        response = generate_response(c, p, memories, history, transcript)
        db.add(Message(conversation_id=conversation.id, role="user", text=transcript))
        db.add(Message(conversation_id=conversation.id, role="assistant", text=response))
        db.commit()
        audio_bytes, mime = synthesize_voice(response, p.voice_id, p.voice_provider)
        return {"conversation_id": conversation.id, "transcript": transcript, "response": response, "audio_base64": base64.b64encode(audio_bytes).decode(), "mime_type": mime}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        db.rollback()
        raise HTTPException(502, str(e))

@app.post("/api/clients/{client_id}/voice/text_turn", dependencies=[Depends(require_admin)])
def voice_text_turn(client_id: int, payload: TextTurnRequest, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c or not c.profile: raise HTTPException(404, "Client/profile not found")
    p = c.profile
    if not p.voice_authorized or not p.voice_id:
        raise HTTPException(400, "An authorized voice is not configured for this client")
    text = payload.text.strip()
    if not text:
        raise HTTPException(400, "Empty speech or text input")
    try:
        conversation = db.get(Conversation, payload.conversation_id) if payload.conversation_id else None
        if conversation is None or conversation.client_id != client_id:
            conversation = Conversation(client_id=client_id); db.add(conversation); db.flush()
        previous = db.query(Message).filter(Message.conversation_id == conversation.id).order_by(Message.id.asc()).all()
        history = [{"role": m.role, "text": m.text} for m in previous]
        memories = db.query(Memory).filter(Memory.client_id == client_id).all()
        response = generate_response(c, p, memories, history, text)
        db.add(Message(conversation_id=conversation.id, role="user", text=text))
        db.add(Message(conversation_id=conversation.id, role="assistant", text=response))
        db.commit()
        audio_bytes, mime = synthesize_voice(response, p.voice_id, p.voice_provider)
        return {"conversation_id": conversation.id, "transcript": text, "response": response, "audio_base64": base64.b64encode(audio_bytes).decode(), "mime_type": mime}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        db.rollback()
        raise HTTPException(502, str(e))

