from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
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

class ExecutiveProfile(Base):
    __tablename__ = "executive_profiles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), unique=True, nullable=False)
    about: Mapped[str] = mapped_column(Text, default="")
    personality: Mapped[str] = mapped_column(Text, default="")
    leadership_style: Mapped[str] = mapped_column(Text, default="")
    decision_making: Mapped[str] = mapped_column(Text, default="")
    communication_style: Mapped[str] = mapped_column(Text, default="")
    business_context: Mapped[str] = mapped_column(Text, default="")
    decision_principles: Mapped[str] = mapped_column(Text, default="")
    people_context: Mapped[str] = mapped_column(Text, default="")
    agent_rules: Mapped[str] = mapped_column(Text, default="")
    preferred_language: Mapped[str] = mapped_column(String(50), default="English")
    voice_id: Mapped[str] = mapped_column(String(200), default="onyx")
    voice_name: Mapped[str] = mapped_column(String(200), default="", nullable=True)
    voice_provider: Mapped[str] = mapped_column(String(50), default="openai")
    voice_authorized: Mapped[bool] = mapped_column(Boolean, default=False)
    voice_consent_text: Mapped[str] = mapped_column(Text, default="")
    agent_call_name: Mapped[str] = mapped_column(String(100), default="Shaun")
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
