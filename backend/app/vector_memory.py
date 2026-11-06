import re
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

def search_chunks(client_id: int, query: str, limit: int = 4, min_similarity: float = 0.28) -> list[dict]:
    """Search vector chunks for a specific client with hybrid (vector + lexical) matching.
    Returns an empty list if no chunks meet the minimum relevance threshold.
    """
    try:
        embedding = embed_text(query)
        clean_q = re.sub(r"\s+", " ", query.strip().lower().strip(".,!?;:\"'"))
        q_tokens = [w for w in clean_q.split() if len(w) >= 3]

        db = SessionLocal()
        try:
            chunks_dict: dict[int, dict] = {}

            # Strategy 1: Vector Search (native pgvector or in-memory fallback)
            try:
                if embedding is not None:
                    max_distance = 1.0 - min_similarity
                    stmt = select(
                        KnowledgeChunk,
                        KnowledgeChunk.embedding.cosine_distance(embedding).label("distance")
                    ).where(
                        KnowledgeChunk.client_id == client_id,
                        KnowledgeChunk.embedding.is_not(None),
                        KnowledgeChunk.embedding.cosine_distance(embedding) <= max_distance
                    ).order_by("distance").limit(limit * 2)

                    results = db.execute(stmt).all()
                    for row in results:
                        c = row.KnowledgeChunk
                        sim = round(1.0 - float(row.distance), 3)
                        chunks_dict[c.id] = {
                            "id": c.id,
                            "source": c.source_name or "upload",
                            "content": c.content,
                            "similarity": sim
                        }
            except Exception:
                db.rollback()
                # In-memory cosine similarity fallback
                if embedding is not None:
                    rows = db.execute(select(KnowledgeChunk).where(
                        KnowledgeChunk.client_id == client_id,
                        KnowledgeChunk.embedding.is_not(None)
                    )).scalars().all()
                    for row in rows:
                        if row.embedding:
                            sim = _cosine_similarity(row.embedding, embedding)
                            if sim >= min_similarity:
                                chunks_dict[row.id] = {
                                    "id": row.id,
                                    "source": row.source_name or "upload",
                                    "content": row.content,
                                    "similarity": round(sim, 3)
                                }

            # Strategy 2: Lexical Phrase & Token Matching across all client chunks
            if len(clean_q) >= 3:
                all_chunks = db.execute(select(KnowledgeChunk).where(
                    KnowledgeChunk.client_id == client_id
                )).scalars().all()

                for c in all_chunks:
                    norm_content = re.sub(r"\s+", " ", c.content.lower())
                    # Exact phrase match (e.g. "how are you", "risk-free trial")
                    if clean_q in norm_content:
                        if c.id in chunks_dict:
                            chunks_dict[c.id]["similarity"] = max(chunks_dict[c.id]["similarity"], 0.88)
                        else:
                            chunks_dict[c.id] = {
                                "id": c.id,
                                "source": c.source_name or "upload",
                                "content": c.content,
                                "similarity": 0.88
                            }
                    # Token overlap match: if at least 2 significant query tokens match
                    elif len(q_tokens) >= 2:
                        matched_tokens = sum(1 for t in q_tokens if t in norm_content)
                        if matched_tokens >= len(q_tokens):
                            overlap_sim = 0.65
                            if c.id in chunks_dict:
                                chunks_dict[c.id]["similarity"] = max(chunks_dict[c.id]["similarity"], overlap_sim)
                            else:
                                chunks_dict[c.id] = {
                                    "id": c.id,
                                    "source": c.source_name or "upload",
                                    "content": c.content,
                                    "similarity": overlap_sim
                                }

            ranked = sorted(chunks_dict.values(), key=lambda x: x["similarity"], reverse=True)
            return [
                {
                    "source": r["source"],
                    "content": r["content"],
                    "similarity": r["similarity"]
                }
                for r in ranked[:limit]
            ]
        finally:
            db.close()
    except Exception as e:
        print(f"Warning in search_chunks: {e}")
        return []
