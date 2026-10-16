import base64
from pathlib import Path
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from .config import settings
from .db import Base, engine, get_db
from .models import Client, ExecutiveProfile, Memory, Conversation, Message, CommunicationSituation, ExecutiveProfileVersion, ExecutiveProfileRecord, KnowledgeChunk, VoiceClone
from .graph_memory import upsert_memory, delete_client_graph
from .vector_memory import save_chunks
from pypdf import PdfReader
import io
import json
from datetime import datetime
from .schemas import ClientCreate, ClientUpdate, ProfileUpdate, MemoryCreate, VoiceConfig, VoiceCloneCreate, VoiceCloneUpdate, VoiceTestRequest, LoginRequest
from .security import require_admin
from .services import clone_voice, generate_response, synthesize_voice, transcribe_audio

app = FastAPI(title="Executive Voice Agent API", version="0.1.0")
#app.add_middleware(CORSMiddleware, allow_origins=[x.strip() for x in settings.cors_origins.split(",")], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup():
    with engine.begin() as conn:
        try:
            conn.execute(__import__("sqlalchemy").text("CREATE EXTENSION IF NOT EXISTS vector"))
        except Exception:
            pass

        # Auto-migrate missing columns for existing databases
        migration_statements = [
            "ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS responsibilities TEXT DEFAULT ''",
            "ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS thinking_examples TEXT DEFAULT ''",
            "ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS default_tone VARCHAR(40) DEFAULT 'professional'",
            "ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS default_directness VARCHAR(30) DEFAULT 'balanced'",
            "ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS response_length VARCHAR(30) DEFAULT 'moderate'",
            "ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS formality VARCHAR(30) DEFAULT 'formal'",
            "ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS humor_level VARCHAR(30) DEFAULT 'occasional'",
            "ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS greeting VARCHAR(500) DEFAULT ''",
            "ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS closing VARCHAR(500) DEFAULT ''",
            "ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS risk_tolerance INTEGER NOT NULL DEFAULT 50",
            "ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS long_term_orientation INTEGER NOT NULL DEFAULT 65",
            "ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS attention_to_detail INTEGER NOT NULL DEFAULT 70",
            "ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS decision_speed INTEGER NOT NULL DEFAULT 55",
            "ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS openness_to_ideas INTEGER NOT NULL DEFAULT 65",
            "ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS preferred_evidence VARCHAR(50) NOT NULL DEFAULT 'balanced'",
            "ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS speaking_pace VARCHAR(40) NOT NULL DEFAULT 'moderate'",
            "ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS accent_notes VARCHAR(500) NOT NULL DEFAULT ''",
            "ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata'",
            "ALTER TABLE clients ADD COLUMN IF NOT EXISTS email VARCHAR(320) DEFAULT ''",
            "ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone VARCHAR(50) DEFAULT ''",
            "ALTER TABLE clients ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE",
        ]
        for stmt in migration_statements:
            try:
                conn.execute(__import__("sqlalchemy").text(stmt))
            except Exception:
                pass

    Base.metadata.create_all(bind=engine)
    db = next(get_db())
    try:
        if db.query(Client).count() == 0:
            # Demo client
            c = Client(name="Demo Client", executive_name="Alex Morgan", company="Demo Company", industry="Technology")
            db.add(c); db.flush()
            db.add(ExecutiveProfile(client_id=c.id, about="Founder and technology executive.", personality="Calm, analytical and direct.", leadership_style="Collaborative but accountable.", decision_making="Balances customer impact, delivery risk and long-term business value.", communication_style="Professional, concise and warm.", decision_principles="Protect long-term relationships, avoid unsupported commitments, and use evidence before making important decisions.", agent_rules="Do not invent facts. Escalate legal, financial and sensitive personnel decisions.", preferred_language="English"))
            db.add(Memory(client_id=c.id, category="general", title="Demo principle", content="Be concise, practical and transparent when information is incomplete."))
            # Add Shaun user if not exists
            if not db.query(Client).filter_by(name="Shaun").first():
                shaun = Client(name="Shaun", executive_name="Shaun", email="test@virtualemployee.com")
                db.add(shaun); db.flush()
                db.add(ExecutiveProfile(client_id=shaun.id))
            db.commit()
    finally:
        db.close()

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/api/auth/login")
def api_login(payload: LoginRequest):
    if payload.username == "admin" and payload.password == "pass123":
        admin_key = settings.admin_api_key or "change-this-admin-key"
        token = f"admin-session-{admin_key}"
        return {
            "ok": True,
            "success": True,
            "user": {
                "username": "admin",
                "name": "Administrator",
                "role": "admin",
                "email": "admin@executivemind.ai",
            },
            "username": "admin",
            "token": token,
            "access_token": token,
            "admin_api_key": admin_key,
            "admin_key": admin_key,
            "message": "Authentication successful"
        }
    raise HTTPException(status_code=401, detail="Invalid username or password")

@app.get("/api/auth/verify")
def api_verify(x_admin_key: str | None = Header(default=None)):
    if settings.admin_api_key and x_admin_key != settings.admin_api_key:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return {"authenticated": True, "username": "admin"}


@app.get("/api/clients", dependencies=[Depends(require_admin)])
def clients(db: Session = Depends(get_db)):
    return db.query(Client).order_by(Client.id.desc()).all()

@app.post("/api/clients", dependencies=[Depends(require_admin)])
def create_client(payload: ClientCreate, db: Session = Depends(get_db)):
    c = Client(**payload.model_dump())
    db.add(c); db.flush(); db.add(ExecutiveProfile(client_id=c.id)); db.commit(); db.refresh(c)
    return c

@app.get("/api/clients/{client_id}", dependencies=[Depends(require_admin)])
def get_client(client_id: int, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c: raise HTTPException(404, "Client not found")
    records = db.query(ExecutiveProfileRecord).filter_by(client_id=client_id).order_by(ExecutiveProfileRecord.updated_at.desc()).all()
    parsed_records = [{"id": r.id, "client_id": r.client_id, "record_type": r.record_type, "title": r.title, "payload": json.loads(r.payload or "{}"), "source_type": r.source_type, "verification_status": r.verification_status, "created_at": r.created_at, "updated_at": r.updated_at} for r in records]
    return {"client": c, "profile": c.profile, "memories": c.memories, "communication_situations": db.query(CommunicationSituation).filter_by(client_id=client_id).order_by(CommunicationSituation.priority.asc()).all(), "profile_records": parsed_records}

@app.put("/api/clients/{client_id}/profile", dependencies=[Depends(require_admin)])
def update_profile(client_id: int, payload: ProfileUpdate, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c: raise HTTPException(404, "Client not found")
    p = c.profile or ExecutiveProfile(client_id=client_id)
    for k, v in payload.model_dump().items(): setattr(p, k, v)
    db.add(p); db.flush()
    latest = db.query(ExecutiveProfileVersion).filter(ExecutiveProfileVersion.client_id == client_id).order_by(ExecutiveProfileVersion.version_number.desc()).first()
    version_number = (latest.version_number + 1) if latest else 1
    snapshot = {column.name: getattr(p, column.name) for column in p.__table__.columns if column.name not in {"id", "client_id"}}
    db.add(ExecutiveProfileVersion(client_id=client_id, version_number=version_number, snapshot=json.dumps(snapshot, default=str), change_summary="Executive profile saved"))
    db.commit(); db.refresh(p)
    return p

@app.get("/api/clients/{client_id}/communication-situations", dependencies=[Depends(require_admin)])
def list_communication_situations(client_id: int, db: Session = Depends(get_db)):
    if not db.get(Client, client_id): raise HTTPException(404, "Client not found")
    return db.query(CommunicationSituation).filter(CommunicationSituation.client_id == client_id).order_by(CommunicationSituation.priority.asc(), CommunicationSituation.id.asc()).all()

@app.post("/api/clients/{client_id}/communication-situations", dependencies=[Depends(require_admin)])
def create_communication_situation(client_id: int, payload: dict, db: Session = Depends(get_db)):
    if not db.get(Client, client_id): raise HTTPException(404, "Client not found")
    allowed = {"name", "audience", "trigger_description", "tone", "response_guidelines", "example_response", "priority", "enabled"}
    data = {k: v for k, v in payload.items() if k in allowed}
    if not str(data.get("name", "")).strip(): raise HTTPException(422, "Situation name is required")
    if len(data.get("name", "")) > 160: raise HTTPException(422, "Situation name must be 160 characters or fewer")
    data["client_id"] = client_id
    item = CommunicationSituation(**data); db.add(item); db.commit(); db.refresh(item); return item

@app.patch("/api/clients/{client_id}/communication-situations/{situation_id}", dependencies=[Depends(require_admin)])
def update_communication_situation(client_id: int, situation_id: int, payload: dict, db: Session = Depends(get_db)):
    item = db.query(CommunicationSituation).filter_by(id=situation_id, client_id=client_id).first()
    if not item: raise HTTPException(404, "Situation not found")
    allowed = {"name", "audience", "trigger_description", "tone", "response_guidelines", "example_response", "priority", "enabled"}
    for key, value in payload.items():
        if key in allowed: setattr(item, key, value)
    if not item.name.strip(): raise HTTPException(422, "Situation name is required")
    item.updated_at = datetime.utcnow(); db.commit(); db.refresh(item); return item

@app.delete("/api/clients/{client_id}/communication-situations/{situation_id}", dependencies=[Depends(require_admin)])
def delete_communication_situation(client_id: int, situation_id: int, db: Session = Depends(get_db)):
    item = db.query(CommunicationSituation).filter_by(id=situation_id, client_id=client_id).first()
    if not item: raise HTTPException(404, "Situation not found")
    db.delete(item); db.commit(); return {"ok": True}

@app.get("/api/clients/{client_id}/profile-versions", dependencies=[Depends(require_admin)])
def list_profile_versions(client_id: int, db: Session = Depends(get_db)):
    if not db.get(Client, client_id): raise HTTPException(404, "Client not found")
    return db.query(ExecutiveProfileVersion).filter_by(client_id=client_id).order_by(ExecutiveProfileVersion.version_number.desc()).all()

@app.post("/api/clients/{client_id}/profile-records", dependencies=[Depends(require_admin)])
def create_profile_record(client_id: int, payload: dict, db: Session = Depends(get_db)):
    if not db.get(Client, client_id): raise HTTPException(404, "Client not found")
    record_type = str(payload.get("record_type", "")).strip()
    title = str(payload.get("title", "")).strip()
    if not record_type or len(record_type) > 80: raise HTTPException(422, "Valid record_type is required")
    if not title or len(title) > 240: raise HTTPException(422, "Title is required (240 characters max)")
    data = {"record_type": record_type, "title": title, "payload": json.dumps(payload.get("payload", {}), ensure_ascii=False), "source_type": payload.get("source_type", "explicit"), "verification_status": payload.get("verification_status", "needs_review"), "client_id": client_id}
    item = ExecutiveProfileRecord(**data); db.add(item); db.commit(); db.refresh(item)
    return {"id": item.id, "client_id": item.client_id, "record_type": item.record_type, "title": item.title, "payload": json.loads(item.payload or "{}"), "source_type": item.source_type, "verification_status": item.verification_status, "created_at": item.created_at, "updated_at": item.updated_at}

@app.patch("/api/clients/{client_id}/profile-records/{record_id}", dependencies=[Depends(require_admin)])
def update_profile_record(client_id: int, record_id: int, payload: dict, db: Session = Depends(get_db)):
    item = db.query(ExecutiveProfileRecord).filter_by(id=record_id, client_id=client_id).first()
    if not item: raise HTTPException(404, "Profile item not found")
    if "title" in payload:
        title = str(payload["title"]).strip()
        if not title or len(title) > 240: raise HTTPException(422, "Title is required (240 characters max)")
        item.title = title
    if "payload" in payload: item.payload = json.dumps(payload["payload"], ensure_ascii=False)
    if payload.get("source_type") in {"explicit", "imported", "inferred"}: item.source_type = payload["source_type"]
    if payload.get("verification_status") in {"needs_review", "verified", "rejected"}: item.verification_status = payload["verification_status"]
    item.updated_at = datetime.utcnow(); db.commit(); db.refresh(item)
    return {"id": item.id, "client_id": item.client_id, "record_type": item.record_type, "title": item.title, "payload": json.loads(item.payload or "{}"), "source_type": item.source_type, "verification_status": item.verification_status, "created_at": item.created_at, "updated_at": item.updated_at}

@app.delete("/api/clients/{client_id}/profile-records/{record_id}", dependencies=[Depends(require_admin)])
def delete_profile_record(client_id: int, record_id: int, db: Session = Depends(get_db)):
    item = db.query(ExecutiveProfileRecord).filter_by(id=record_id, client_id=client_id).first()
    if not item: raise HTTPException(404, "Profile item not found")
    db.delete(item); db.commit(); return {"ok": True}

@app.post("/api/clients/{client_id}/profile-versions/{version_id}/restore", dependencies=[Depends(require_admin)])
def restore_profile_version(client_id: int, version_id: int, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    version = db.query(ExecutiveProfileVersion).filter_by(id=version_id, client_id=client_id).first()
    if not c or not version: raise HTTPException(404, "Profile version not found")
    try: snapshot = json.loads(version.snapshot)
    except Exception: raise HTTPException(400, "Saved profile snapshot is invalid")
    p = c.profile or ExecutiveProfile(client_id=client_id)
    allowed = {column.name for column in ExecutiveProfile.__table__.columns} - {"id", "client_id"}
    for key, value in snapshot.items():
        if key in allowed: setattr(p, key, value)
    db.add(p); db.flush()
    latest = db.query(ExecutiveProfileVersion).filter_by(client_id=client_id).order_by(ExecutiveProfileVersion.version_number.desc()).first()
    next_number = latest.version_number + 1 if latest else 1
    restored = {column.name: getattr(p, column.name) for column in p.__table__.columns if column.name not in {"id", "client_id"}}
    db.add(ExecutiveProfileVersion(client_id=client_id, version_number=next_number, snapshot=json.dumps(restored, default=str), change_summary=f"Restored from version {version.version_number}"))
    db.commit(); db.refresh(p); return p

@app.patch("/api/clients/{client_id}", dependencies=[Depends(require_admin)])
@app.put("/api/clients/{client_id}", dependencies=[Depends(require_admin)])
def update_client(client_id: int, payload: dict, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c: raise HTTPException(404, "Client not found")
    allowed = {"name", "executive_name", "company", "industry", "email", "phone"}
    for key, value in payload.items():
        if key in allowed and value is not None:
            setattr(c, key, str(value).strip()[:320])
        elif key == "active" and value is not None:
            setattr(c, "active", bool(value))
    db.commit(); db.refresh(c); return c

@app.delete("/api/clients/{client_id}", dependencies=[Depends(require_admin)])
def delete_client(client_id: int, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(404, "Client not found")

    # 1. Clean conversations and messages
    conv_ids = [conv.id for conv in db.query(Conversation).filter_by(client_id=client_id).all()]
    if conv_ids:
        db.query(Message).filter(Message.conversation_id.in_(conv_ids)).delete(synchronize_session=False)
        db.query(Conversation).filter_by(client_id=client_id).delete(synchronize_session=False)

    # 2. Clean knowledge chunks, situations, profile records, profile versions, memories, profile
    db.query(KnowledgeChunk).filter_by(client_id=client_id).delete(synchronize_session=False)
    db.query(CommunicationSituation).filter_by(client_id=client_id).delete(synchronize_session=False)
    db.query(ExecutiveProfileRecord).filter_by(client_id=client_id).delete(synchronize_session=False)
    db.query(ExecutiveProfileVersion).filter_by(client_id=client_id).delete(synchronize_session=False)
    db.query(Memory).filter_by(client_id=client_id).delete(synchronize_session=False)
    db.query(ExecutiveProfile).filter_by(client_id=client_id).delete(synchronize_session=False)

    # 3. Clean client
    db.delete(c)
    db.commit()

    # 4. Clean graph memory if configured
    try:
        delete_client_graph(client_id)
    except Exception:
        pass

    return {"ok": True, "message": f"Client {client_id} deleted successfully"}

@app.put("/api/clients/{client_id}/voice", dependencies=[Depends(require_admin)])
def update_voice(client_id: int, payload: VoiceConfig, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c or not c.profile: raise HTTPException(404, "Client/profile not found")
    if payload.voice_authorized and not payload.voice_consent_text.strip():
        raise HTTPException(400, "Voice consent text is required")
    for k, v in payload.model_dump().items(): setattr(c.profile, k, v)
    if payload.voice_id:
        # Sync with VoiceClone table
        existing = db.query(VoiceClone).filter_by(client_id=client_id, voice_id=payload.voice_id).first()
        if not existing:
            db.query(VoiceClone).filter_by(client_id=client_id).update({"is_active": False})
            vc = VoiceClone(client_id=client_id, name=f"{c.executive_name} Voice", voice_id=payload.voice_id, provider=payload.voice_provider or "elevenlabs", consent_text=payload.voice_consent_text, is_active=True)
            db.add(vc)
        else:
            db.query(VoiceClone).filter_by(client_id=client_id).update({"is_active": False})
            existing.is_active = True
            existing.provider = payload.voice_provider or existing.provider
            existing.consent_text = payload.voice_consent_text or existing.consent_text
    db.commit(); db.refresh(c.profile)
    return c.profile

@app.post("/api/clients/{client_id}/voice/clone", dependencies=[Depends(require_admin)])
async def create_voice_clone(client_id: int, consent_text: str = Form(...), file: UploadFile = File(...), db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c or not c.profile: raise HTTPException(404, "Client/profile not found")
    if not consent_text.strip(): raise HTTPException(400, "Consent is required")
    audio = await file.read()
    if len(audio) < 10_000: raise HTTPException(400, "Voice sample is too small")
    try:
        voice_id = clone_voice(c.executive_name, audio, file.filename or "voice.webm")
    except Exception as e:
        raise HTTPException(502, f"Voice cloning provider error: {e}")
    c.profile.voice_id = voice_id
    c.profile.voice_provider = "elevenlabs"
    c.profile.voice_authorized = True
    c.profile.voice_consent_text = consent_text

    # Register in VoiceClone table
    db.query(VoiceClone).filter_by(client_id=client_id).update({"is_active": False})
    vc = VoiceClone(client_id=client_id, name=f"{c.executive_name} Voice Clone", voice_id=voice_id, provider="elevenlabs", consent_text=consent_text, sample_filename=file.filename or "sample.webm", is_active=True)
    db.add(vc)
    db.commit()
    return {"voice_id": voice_id, "provider": "elevenlabs", "authorized": True}

@app.get("/api/voices", dependencies=[Depends(require_admin)])
def list_voice_clones(db: Session = Depends(get_db)):
    # Auto-sync existing client profile voices
    clients_with_voices = db.query(Client).join(Client.profile).filter(ExecutiveProfile.voice_id != "").all()
    for cl in clients_with_voices:
        if cl.profile and cl.profile.voice_id:
            exists = db.query(VoiceClone).filter_by(client_id=cl.id, voice_id=cl.profile.voice_id).first()
            if not exists:
                db.add(VoiceClone(
                    client_id=cl.id,
                    name=f"{cl.executive_name} Primary Voice",
                    voice_id=cl.profile.voice_id,
                    provider=cl.profile.voice_provider or "elevenlabs",
                    consent_text=cl.profile.voice_consent_text or "",
                    is_active=True
                ))
                db.commit()

    records = db.query(VoiceClone).order_by(VoiceClone.is_active.desc(), VoiceClone.id.desc()).all()
    res = []
    for r in records:
        cl = db.get(Client, r.client_id)
        res.append({
            "id": r.id,
            "client_id": r.client_id,
            "client_name": cl.name if cl else "Unknown",
            "executive_name": cl.executive_name if cl else "Unknown",
            "company": cl.company if cl else "",
            "name": r.name,
            "voice_id": r.voice_id,
            "provider": r.provider,
            "description": r.description or "",
            "consent_text": r.consent_text or "",
            "sample_filename": r.sample_filename or "",
            "is_active": r.is_active,
            "created_at": r.created_at,
            "updated_at": r.updated_at
        })
    return res

@app.post("/api/voices", dependencies=[Depends(require_admin)])
def create_voice_clone_record(payload: VoiceCloneCreate, db: Session = Depends(get_db)):
    client = db.get(Client, payload.client_id)
    if not client:
        raise HTTPException(404, "Client not found")

    if payload.is_active:
        db.query(VoiceClone).filter_by(client_id=payload.client_id).update({"is_active": False})
        if client.profile:
            client.profile.voice_id = payload.voice_id.strip()
            client.profile.voice_provider = payload.provider.strip()
            client.profile.voice_authorized = True
            client.profile.voice_consent_text = payload.consent_text.strip()

    vc = VoiceClone(
        client_id=payload.client_id,
        name=payload.name.strip(),
        voice_id=payload.voice_id.strip(),
        provider=payload.provider.strip() or "elevenlabs",
        description=payload.description.strip(),
        consent_text=payload.consent_text.strip(),
        is_active=payload.is_active
    )
    db.add(vc)
    db.commit()
    db.refresh(vc)
    return {
        "id": vc.id,
        "client_id": vc.client_id,
        "client_name": client.name,
        "executive_name": client.executive_name,
        "company": client.company,
        "name": vc.name,
        "voice_id": vc.voice_id,
        "provider": vc.provider,
        "description": vc.description,
        "consent_text": vc.consent_text,
        "sample_filename": vc.sample_filename,
        "is_active": vc.is_active,
        "created_at": vc.created_at,
        "updated_at": vc.updated_at
    }

@app.post("/api/voices/clone", dependencies=[Depends(require_admin)])
async def clone_voice_for_client(
    client_id: int = Form(...),
    name: str = Form(default=""),
    description: str = Form(default=""),
    consent_text: str = Form(default=""),
    set_active: bool = Form(default=True),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    client = db.get(Client, client_id)
    if not client or not client.profile:
        raise HTTPException(404, "Client not found")
    if not consent_text.strip():
        raise HTTPException(400, "Consent text is required")
    audio = await file.read()
    if len(audio) < 1_000:
        raise HTTPException(400, "Voice sample audio is too small")

    voice_title = name.strip() or f"{client.executive_name} Voice Twin"
    try:
        voice_id = clone_voice(voice_title, audio, file.filename or "voice.webm")
    except Exception as e:
        raise HTTPException(502, f"Voice cloning provider error: {e}")

    if set_active:
        db.query(VoiceClone).filter_by(client_id=client_id).update({"is_active": False})
        client.profile.voice_id = voice_id
        client.profile.voice_provider = "elevenlabs"
        client.profile.voice_authorized = True
        client.profile.voice_consent_text = consent_text.strip()

    vc = VoiceClone(
        client_id=client_id,
        name=voice_title,
        voice_id=voice_id,
        provider="elevenlabs",
        description=description.strip(),
        consent_text=consent_text.strip(),
        sample_filename=file.filename or "sample.webm",
        is_active=set_active
    )
    db.add(vc)
    db.commit()
    db.refresh(vc)
    return {
        "id": vc.id,
        "client_id": vc.client_id,
        "client_name": client.name,
        "executive_name": client.executive_name,
        "company": client.company,
        "name": vc.name,
        "voice_id": vc.voice_id,
        "provider": vc.provider,
        "description": vc.description,
        "consent_text": vc.consent_text,
        "sample_filename": vc.sample_filename,
        "is_active": vc.is_active,
        "created_at": vc.created_at,
        "updated_at": vc.updated_at
    }

@app.patch("/api/voices/{voice_record_id}", dependencies=[Depends(require_admin)])
def update_voice_clone_record(voice_record_id: int, payload: VoiceCloneUpdate, db: Session = Depends(get_db)):
    vc = db.get(VoiceClone, voice_record_id)
    if not vc:
        raise HTTPException(404, "Voice clone not found")
    client = db.get(Client, vc.client_id)

    data = payload.model_dump(exclude_unset=True)
    if "is_active" in data and data["is_active"]:
        db.query(VoiceClone).filter_by(client_id=vc.client_id).update({"is_active": False})
        if client and client.profile:
            client.profile.voice_id = data.get("voice_id", vc.voice_id)
            client.profile.voice_provider = data.get("provider", vc.provider)
            client.profile.voice_authorized = True
            client.profile.voice_consent_text = data.get("consent_text", vc.consent_text)

    for k, v in data.items():
        if v is not None:
            setattr(vc, k, v)
    vc.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(vc)
    return {
        "id": vc.id,
        "client_id": vc.client_id,
        "client_name": client.name if client else "Unknown",
        "executive_name": client.executive_name if client else "Unknown",
        "company": client.company if client else "",
        "name": vc.name,
        "voice_id": vc.voice_id,
        "provider": vc.provider,
        "description": vc.description,
        "consent_text": vc.consent_text,
        "sample_filename": vc.sample_filename,
        "is_active": vc.is_active,
        "created_at": vc.created_at,
        "updated_at": vc.updated_at
    }

@app.post("/api/voices/{voice_record_id}/activate", dependencies=[Depends(require_admin)])
def activate_voice_for_client(voice_record_id: int, db: Session = Depends(get_db)):
    vc = db.get(VoiceClone, voice_record_id)
    if not vc:
        raise HTTPException(404, "Voice clone not found")
    client = db.get(Client, vc.client_id)
    if not client:
        raise HTTPException(404, "Client not found")

    db.query(VoiceClone).filter_by(client_id=vc.client_id).update({"is_active": False})
    vc.is_active = True
    if client.profile:
        client.profile.voice_id = vc.voice_id
        client.profile.voice_provider = vc.provider
        client.profile.voice_authorized = True
        client.profile.voice_consent_text = vc.consent_text
    db.commit()
    return {"ok": True, "message": f"Voice '{vc.name}' set as active for {client.name}"}

@app.delete("/api/voices/{voice_record_id}", dependencies=[Depends(require_admin)])
def delete_voice_clone_record(voice_record_id: int, db: Session = Depends(get_db)):
    vc = db.get(VoiceClone, voice_record_id)
    if not vc:
        raise HTTPException(404, "Voice clone not found")
    client = db.get(Client, vc.client_id)
    was_active = vc.is_active
    client_id = vc.client_id
    db.delete(vc)
    db.commit()

    if was_active and client and client.profile:
        remaining = db.query(VoiceClone).filter_by(client_id=client_id).order_by(VoiceClone.id.desc()).first()
        if remaining:
            remaining.is_active = True
            client.profile.voice_id = remaining.voice_id
            client.profile.voice_provider = remaining.provider
            client.profile.voice_authorized = True
            client.profile.voice_consent_text = remaining.consent_text
        else:
            client.profile.voice_id = ""
            client.profile.voice_authorized = False
        db.commit()
    return {"ok": True, "message": "Voice clone deleted"}

@app.post("/api/voices/test", dependencies=[Depends(require_admin)])
def test_voice_synthesis(payload: VoiceTestRequest):
    if not payload.voice_id.strip():
        raise HTTPException(400, "Voice ID is required")
    try:
        audio_bytes, mime = synthesize_voice(payload.text.strip() or "Hello, this is a test.", payload.voice_id.strip())
        return {
            "audio_base64": base64.b64encode(audio_bytes).decode(),
            "mime_type": mime
        }
    except Exception as e:
        raise HTTPException(502, f"Speech synthesis failed: {e}")

@app.post("/api/clients/{client_id}/memories", dependencies=[Depends(require_admin)])
def add_memory(client_id: int, payload: MemoryCreate, db: Session = Depends(get_db)):
    if not db.get(Client, client_id): raise HTTPException(404, "Client not found")
    m = Memory(client_id=client_id, **payload.model_dump()); db.add(m); db.commit(); db.refresh(m)
    try:
        upsert_memory(client_id, m.category, m.title, m.content)
    except Exception:
        # Graph availability must not prevent PostgreSQL memory persistence.
        pass
    return m

@app.post("/api/clients/{client_id}/knowledge/upload", dependencies=[Depends(require_admin)])
async def upload_knowledge(client_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(404, "Client not found")
    raw = await file.read()
    name = file.filename or "upload.txt"
    try:
        if name.lower().endswith(".pdf"):
            reader = PdfReader(io.BytesIO(raw))
            content = "\n".join(page.extract_text() or "" for page in reader.pages)
        else:
            content = raw.decode("utf-8", errors="replace")
        if not content.strip():
            raise HTTPException(400, "No extractable text found. Upload a text-based PDF or UTF-8 text file.")
        count = save_chunks(client_id, name, content)
        # Keep a concise source record in relational memory and the graph.
        summary = content[:1200]
        memory = Memory(client_id=client_id, category="uploaded_knowledge", title=name, content=summary)
        db.add(memory); db.commit(); db.refresh(memory)
        try:
            upsert_memory(client_id, memory.category, memory.title, memory.content)
        except Exception:
            pass
        return {"ok": True, "filename": name, "chunks_saved": count, "characters_extracted": len(content)}
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(502, f"Knowledge ingestion failed: {exc}")

@app.get("/api/clients/{client_id}/knowledge", dependencies=[Depends(require_admin)])
def list_knowledge(client_id: int, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(404, "Client not found")
    chunks = db.query(KnowledgeChunk).filter(KnowledgeChunk.client_id == client_id).order_by(KnowledgeChunk.source_name.asc(), KnowledgeChunk.chunk_index.asc()).all()
    documents_map = {}
    for ch in chunks:
        sname = ch.source_name or "upload"
        if sname not in documents_map:
            documents_map[sname] = {
                "source_name": sname,
                "chunk_count": 0,
                "total_characters": 0,
                "created_at": ch.created_at,
                "has_embeddings": False,
                "chunks": [],
            }
        doc = documents_map[sname]
        doc["chunk_count"] += 1
        doc["total_characters"] += len(ch.content or "")
        if ch.embedding is not None:
            doc["has_embeddings"] = True
        doc["chunks"].append({
            "id": ch.id,
            "chunk_index": ch.chunk_index,
            "content": ch.content,
            "char_count": len(ch.content or ""),
            "has_embedding": ch.embedding is not None,
            "created_at": ch.created_at,
        })
    docs = list(documents_map.values())
    return {
        "client_id": client_id,
        "total_documents": len(docs),
        "total_chunks": len(chunks),
        "documents": docs
    }

@app.delete("/api/clients/{client_id}/knowledge", dependencies=[Depends(require_admin)])
def delete_knowledge_source(client_id: int, source_name: str, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(404, "Client not found")
    deleted_chunks = db.query(KnowledgeChunk).filter(
        KnowledgeChunk.client_id == client_id,
        KnowledgeChunk.source_name == source_name
    ).delete(synchronize_session=False)
    db.query(Memory).filter(
        Memory.client_id == client_id,
        Memory.category == "uploaded_knowledge",
        Memory.title == source_name
    ).delete(synchronize_session=False)
    db.commit()
    return {"ok": True, "deleted_chunks": deleted_chunks, "source_name": source_name}

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
        raise HTTPException(400, "An authorized cloned voice is not configured for this client")
    raw = await audio.read()
    try:
        transcript = transcribe_audio(raw, audio.filename or "audio.webm")
        conversation = db.get(Conversation, conversation_id) if conversation_id else None
        if conversation is None or conversation.client_id != client_id:
            conversation = Conversation(client_id=client_id); db.add(conversation); db.flush()
        previous = db.query(Message).filter(Message.conversation_id == conversation.id).order_by(Message.id.asc()).all()
        history = [{"role": m.role, "text": m.text} for m in previous]
        memories = db.query(Memory).filter(Memory.client_id == client_id).all()
        response = generate_response(client_id, c, p, memories, history, transcript)
        db.add(Message(conversation_id=conversation.id, role="user", text=transcript))
        db.add(Message(conversation_id=conversation.id, role="assistant", text=response))
        db.commit()
        audio_bytes, mime = synthesize_voice(response, p.voice_id)
        return {"conversation_id": conversation.id, "transcript": transcript, "response": response, "audio_base64": base64.b64encode(audio_bytes).decode(), "mime_type": mime}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        import traceback
        traceback.print_exc()
        raise HTTPException(502, f"Voice processing error: {str(e)}")
