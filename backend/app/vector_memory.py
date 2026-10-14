from openai import OpenAI
from sqlalchemy import select, text
from .config import settings
from .db import SessionLocal
from .models import KnowledgeChunk

def embed_text(content: str) -> list[float] | None:
    if not settings.openai_api_key:
        return None
    client = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
    response = client.embeddings.create(model=settings.embedding_model, input=content[:8000])
    return response.data[0].embedding

def save_chunks(client_id: int, source_name: str, content: str) -> int:
    chunks = [content[i:i+1200] for i in range(0, len(content), 1000) if content[i:i+1200].strip()]
    db = SessionLocal()
    try:
        for idx, chunk in enumerate(chunks):
            embedding = embed_text(chunk)
            db.add(KnowledgeChunk(client_id=client_id, source_name=source_name, chunk_index=idx, content=chunk, embedding=embedding))
        db.commit()
        return len(chunks)
    finally:
        db.close()

def _cosine_similarity(v1: list[float], v2: list[float]) -> float:
    try:
        dot = sum(a * b for a, b in zip(v1, v2))
        norm1 = sum(a * a for a in v1) ** 0.5
        norm2 = sum(b * b for b in v2) ** 0.5
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return dot / (norm1 * norm2)
    except Exception:
        return 0.0

def search_chunks(client_id: int, query: str, limit: int = 5) -> list[str]:
    try:
        embedding = embed_text(query)
        if embedding is None:
            return []
        db = SessionLocal()
        try:
            # Try native pgvector query if extension is present
            try:
                rows = db.execute(select(KnowledgeChunk).where(
                    KnowledgeChunk.client_id == client_id,
                    KnowledgeChunk.embedding.is_not(None)
                ).order_by(KnowledgeChunk.embedding.cosine_distance(embedding)).limit(limit)).scalars().all()
                return [f"[Vector source: {row.source_name}] {row.content}" for row in rows]
            except Exception:
                db.rollback()
                # Fallback: in-memory cosine similarity (works on standard PostgreSQL without pgvector)
                rows = db.execute(select(KnowledgeChunk).where(
                    KnowledgeChunk.client_id == client_id,
                    KnowledgeChunk.embedding.is_not(None)
                )).scalars().all()
                if not rows:
                    return []
                scored = []
                for row in rows:
                    if row.embedding:
                        sim = _cosine_similarity(row.embedding, embedding)
                        scored.append((sim, row))
                scored.sort(key=lambda x: x[0], reverse=True)
                return [f"[Vector source: {row.source_name}] {row.content}" for _, row in scored[:limit]]
        finally:
            db.close()
    except Exception as e:
        print(f"Warning in search_chunks: {e}")
        return []
