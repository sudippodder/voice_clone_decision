from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
import json
from pgvector.sqlalchemy import Vector as _PgVector

class SafeVector(_PgVector):
    def get_col_spec(self, **kw):
        return "JSON"

    def bind_processor(self, dialect):
        def process(value):
            if value is None:
                return None
            if isinstance(value, str):
                return value
            return json.dumps(value)
        return process

    def result_processor(self, dialect, coltype):
        def process(value):
            if isinstance(value, list):
                return value
            if isinstance(value, str):
                try:
                    return json.loads(value)
                except Exception:
                    return [float(x) for x in value.strip("[]").split(",") if x.strip()]
            return None
        return process

Vector = SafeVector
from .db import Base

class Client(Base):
    __tablename__ = "clients"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    executive_name: Mapped[str] = mapped_column(String(200), nullable=False)
    company: Mapped[str] = mapped_column(String(200), default="")
    industry: Mapped[str] = mapped_column(String(200), default="")
    email: Mapped[str] = mapped_column(String(320), default="")
    phone: Mapped[str] = mapped_column(String(50), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    profile = relationship("ExecutiveProfile", back_populates="client", uselist=False, cascade="all, delete-orphan")
    memories = relationship("Memory", back_populates="client", cascade="all, delete-orphan")
    voice_clones = relationship("VoiceClone", back_populates="client", cascade="all, delete-orphan")

class ExecutiveProfile(Base):
    __tablename__ = "executive_profiles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), unique=True, nullable=False)
    about: Mapped[str] = mapped_column(Text, default="")
    responsibilities: Mapped[str] = mapped_column(Text, default="")
    thinking_examples: Mapped[str] = mapped_column(Text, default="")
    personality: Mapped[str] = mapped_column(Text, default="")
    leadership_style: Mapped[str] = mapped_column(Text, default="")
    decision_making: Mapped[str] = mapped_column(Text, default="")
    communication_style: Mapped[str] = mapped_column(Text, default="")
    business_context: Mapped[str] = mapped_column(Text, default="")
    decision_principles: Mapped[str] = mapped_column(Text, default="")
    people_context: Mapped[str] = mapped_column(Text, default="")
    agent_rules: Mapped[str] = mapped_column(Text, default="")
    preferred_language: Mapped[str] = mapped_column(String(50), default="English")
    default_tone: Mapped[str] = mapped_column(String(40), default="professional")
    default_directness: Mapped[str] = mapped_column(String(30), default="balanced")
    response_length: Mapped[str] = mapped_column(String(30), default="moderate")
    formality: Mapped[str] = mapped_column(String(30), default="formal")
    humor_level: Mapped[str] = mapped_column(String(30), default="occasional")
    greeting: Mapped[str] = mapped_column(String(500), default="")
    closing: Mapped[str] = mapped_column(String(500), default="")
    risk_tolerance: Mapped[int] = mapped_column(Integer, default=50)
    long_term_orientation: Mapped[int] = mapped_column(Integer, default=65)
    attention_to_detail: Mapped[int] = mapped_column(Integer, default=70)
    decision_speed: Mapped[int] = mapped_column(Integer, default=55)
    openness_to_ideas: Mapped[int] = mapped_column(Integer, default=65)
    preferred_evidence: Mapped[str] = mapped_column(String(50), default="balanced")
    speaking_pace: Mapped[str] = mapped_column(String(40), default="moderate")
    accent_notes: Mapped[str] = mapped_column(String(500), default="")
    timezone: Mapped[str] = mapped_column(String(80), default="Asia/Kolkata")
    voice_id: Mapped[str] = mapped_column(String(200), default="")
    voice_provider: Mapped[str] = mapped_column(String(50), default="elevenlabs")
    voice_authorized: Mapped[bool] = mapped_column(Boolean, default=False)
    voice_consent_text: Mapped[str] = mapped_column(Text, default="")
    client = relationship("Client", back_populates="profile")

class Memory(Base):
    __tablename__ = "memories"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), nullable=False)
    category: Mapped[str] = mapped_column(String(100), default="general")
    title: Mapped[str] = mapped_column(String(300), default="")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    client = relationship("Client", back_populates="memories")

class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"), nullable=False)
    role: Mapped[str] = mapped_column(String(30), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True)
    source_name: Mapped[str] = mapped_column(String(500), default="upload")
    chunk_index: Mapped[int] = mapped_column(Integer, default=0)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding = mapped_column(Vector(1536), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CommunicationSituation(Base):
    __tablename__ = "communication_situations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    audience: Mapped[str] = mapped_column(String(80), default="general")
    trigger_description: Mapped[str] = mapped_column(Text, default="")
    tone: Mapped[str] = mapped_column(String(40), default="professional")
    response_guidelines: Mapped[str] = mapped_column(Text, default="")
    example_response: Mapped[str] = mapped_column(Text, default="")
    priority: Mapped[int] = mapped_column(Integer, default=100)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class ExecutiveProfileVersion(Base):
    __tablename__ = "executive_profile_versions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    change_summary: Mapped[str] = mapped_column(String(500), default="Profile updated")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ExecutiveProfileRecord(Base):
    """Flexible repeatable profile items such as principles, people, projects and cases."""
    __tablename__ = "executive_profile_records"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True)
    record_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    payload: Mapped[str] = mapped_column(Text, default="{}")
    source_type: Mapped[str] = mapped_column(String(40), default="explicit")
    verification_status: Mapped[str] = mapped_column(String(40), default="needs_review")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class VoiceClone(Base):
    __tablename__ = "voice_clones"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    voice_id: Mapped[str] = mapped_column(String(200), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), default="elevenlabs")
    description: Mapped[str] = mapped_column(Text, default="")
    consent_text: Mapped[str] = mapped_column(Text, default="")
    sample_filename: Mapped[str] = mapped_column(String(300), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    client = relationship("Client", back_populates="voice_clones")
