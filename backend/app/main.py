import base64
from pathlib import Path
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from .config import settings
from .db import Base, engine, get_db
from .models import Client, ExecutiveProfile, Memory, Conversation, Message, CommunicationSituation, ExecutiveProfileVersion, ExecutiveProfileRecord
from .graph_memory import upsert_memory
from .vector_memory import save_chunks
from pypdf import PdfReader
import io
import json
from datetime import datetime
from .schemas import ClientCreate, ProfileUpdate, MemoryCreate, VoiceConfig
from .security import require_admin
from .services import clone_voice, generate_response, synthesize_voice, transcribe_audio

app = FastAPI(title="Executive Voice Agent API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=[x.strip() for x in settings.cors_origins.split(",")], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.on_event("startup")
def startup():
    with engine.begin() as conn:
        try:
            conn.execute(__import__("sqlalchemy").text("CREATE EXTENSION IF NOT EXISTS vector"))
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
def update_client(client_id: int, payload: dict, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c: raise HTTPException(404, "Client not found")
    allowed = {"name", "executive_name", "company", "industry", "email", "phone"}
    for key, value in payload.items():
        if key in allowed: setattr(c, key, str(value)[:320])
    db.commit(); db.refresh(c); return c

@app.put("/api/clients/{client_id}/voice", dependencies=[Depends(require_admin)])
def update_voice(client_id: int, payload: VoiceConfig, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c or not c.profile: raise HTTPException(404, "Client/profile not found")
    if payload.voice_authorized and not payload.voice_consent_text.strip():
        raise HTTPException(400, "Voice consent text is required")
    for k, v in payload.model_dump().items(): setattr(c.profile, k, v)
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
    db.commit()
    return {"voice_id": voice_id, "provider": "elevenlabs", "authorized": True}

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
        raise HTTPException(502, str(e))
