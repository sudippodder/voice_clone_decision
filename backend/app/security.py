from fastapi import Header, HTTPException
from .config import settings

def require_admin(x_admin_key: str | None = Header(default=None)):
    if settings.admin_api_key and x_admin_key != settings.admin_api_key:
        raise HTTPException(status_code=401, detail="Invalid admin API key")
