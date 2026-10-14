from pydantic import BaseModel, ConfigDict

class ClientCreate(BaseModel):
    name: str
    executive_name: str
    company: str = ""
    industry: str = ""
    email: str = ""
    phone: str = ""

class ProfileUpdate(BaseModel):
    about: str = ""
    responsibilities: str = ""
    thinking_examples: str = ""
    personality: str = ""
    leadership_style: str = ""
    decision_making: str = ""
    communication_style: str = ""
    business_context: str = ""
    decision_principles: str = ""
    people_context: str = ""
    agent_rules: str = ""
    preferred_language: str = "English"
    default_tone: str = "professional"
    default_directness: str = "balanced"
    response_length: str = "moderate"
    formality: str = "formal"
    humor_level: str = "occasional"
    greeting: str = ""
    closing: str = ""
    risk_tolerance: int = 50
    long_term_orientation: int = 65
    attention_to_detail: int = 70
    decision_speed: int = 55
    openness_to_ideas: int = 65
    preferred_evidence: str = "balanced"
    speaking_pace: str = "moderate"
    accent_notes: str = ""
    timezone: str = "Asia/Kolkata"
    model_config = ConfigDict(extra="ignore")

class VoiceConfig(BaseModel):
    voice_id: str = ""
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
