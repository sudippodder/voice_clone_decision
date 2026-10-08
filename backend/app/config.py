from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    database_url: str
    redis_url: str = "redis://redis:6379/0"
    cors_origins: str = "http://localhost:3000"
    admin_api_key: str = "change-me"
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-5-mini"
    elevenlabs_api_key: str = ""
    elevenlabs_model_id: str = "eleven_multilingual_v2"
    tts_provider: str = "elevenlabs"
    openai_tts_model: str = "tts-1"
    openai_tts_voice: str = "onyx"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
