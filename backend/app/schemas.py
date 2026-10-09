from pydantic import BaseModel, ConfigDict

class ClientCreate(BaseModel):
    name: str
    executive_name: str
    company: str = ""
    industry: str = ""
    email: str = ""
    phone: str = ""
    voice_id: str | None = None
    voice_name: str | None = None
    voice_provider: str | None = "elevenlabs"
    model_config = ConfigDict(extra="ignore")

class ClientUpdate(BaseModel):
    name: str | None = None
    executive_name: str | None = None
    company: str | None = None
    industry: str | None = None
    email: str | None = None
    phone: str | None = None
    active: bool | None = None
    voice_id: str | None = None
    voice_name: str | None = None
    voice_provider: str | None = None
    model_config = ConfigDict(extra="ignore")

class ProfileUpdate(BaseModel):
    about: str = ""
    personality: str = ""
    leadership_style: str = ""
    decision_making: str = ""
    communication_style: str = ""
    business_context: str = ""
    decision_principles: str = ""
    people_context: str = ""
    agent_rules: str = ""
    preferred_language: str = "English"
    agent_call_name: str = "Shaun"
    voice_name: str | None = None
    model_config = ConfigDict(extra="ignore")

class TextTurnRequest(BaseModel):
    text: str
    conversation_id: int | None = None

class VoiceConfig(BaseModel):
    voice_id: str = "onyx"
    voice_name: str = ""
    voice_provider: str = "elevenlabs"
    voice_authorized: bool = False
    voice_consent_text: str = ""

class MemoryCreate(BaseModel):
    category: str = "general"
    title: str = ""
    content: str

class VoiceTurnResponse(BaseModel):
    transcript: str
    response: str
    audio_base64: str
    mime_type: str = "audio/mpeg"

class LoginRequest(BaseModel):
    username: str
    password: str
