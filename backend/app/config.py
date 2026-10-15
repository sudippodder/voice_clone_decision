from pydantic import Field, AliasChoices
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    database_url: str
    redis_url: str = "redis://redis:6379/0"
    cors_origins: str = "http://localhost:3000"
    admin_api_key: str = "change-me"
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"
    elevenlabs_api_key: str = ""
    elevenlabs_model_id: str = "eleven_multilingual_v2"
    embedding_model: str = "text-embedding-3-small"
    neo4j_uri: str = ""
    neo4j_user: str = Field(default="neo4j", validation_alias=AliasChoices("neo4j_user", "neo4j_username"))
    neo4j_password: str = "change-this-neo4j-password"

    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

settings = Settings()
