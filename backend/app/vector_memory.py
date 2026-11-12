import re
import httpx
from openai import OpenAI
from sqlalchemy import select, text
from .config import settings
from .db import SessionLocal
from .models import KnowledgeChunk

# Common conversational stopwords to ignore in keyword overlap scoring
STOPWORDS = {
    "what", "about", "the", "how", "are", "you", "can", "explain", "tell", "me",
    "is", "in", "of", "for", "to", "a", "an", "and", "or", "with", "this", "that",
    "does", "do", "we", "our", "it", "there", "please", "give", "any", "information",
    "why", "when", "where", "which", "who", "whom", "whose", "their", "they", "them",
    "i", "my", "your", "yours", "us", "he", "she", "him", "her", "his", "say", "said",
    "speak", "know"
}

_EMBED_CACHE: dict[str, list[float]] = {}

def embed_text(content: str) -> list[float] | None:
    if not settings.openai_api_key or not content.strip():
        return None
    cache_key = content.strip().lower()[:500]
    if cache_key in _EMBED_CACHE:
        return _EMBED_CACHE[cache_key]
    try:
        client = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
        response = client.embeddings.create(model=settings.embedding_model, input=content[:8000])
        emb = response.data[0].embedding
        if len(_EMBED_CACHE) > 500:
            _EMBED_CACHE.clear()
        _EMBED_CACHE[cache_key] = emb
        return emb
    except Exception as err:
        if "connect" in str(err).lower():
            # Fallback in case of dead environment proxy
            direct_http = httpx.Client(trust_env=False, timeout=30.0)
            direct_client = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url, http_client=direct_http)
            response = direct_client.embeddings.create(model=settings.embedding_model, input=content[:8000])
            emb = response.data[0].embedding
            _EMBED_CACHE[cache_key] = emb
            return emb
        print(f"Warning: Failed to generate embedding: {err}")
        return None

def split_content_into_chunks(content: str, max_chars: int = 1200, overlap: int = 150) -> list[str]:
    """Splits document content naturally by paragraphs or sentences while preserving context boundaries."""
    paragraphs = re.split(r"\n\s*\n", content.strip())
    chunks: list[str] = []
    current = ""

    for p in paragraphs:
        p_clean = p.strip()
        if not p_clean:
            continue
        if len(current) + len(p_clean) + 2 <= max_chars:
            current = (current + "\n\n" + p_clean) if current else p_clean
        else:
            if current:
                chunks.append(current)
            if len(p_clean) <= max_chars:
                current = p_clean
            else:
                # Fallback for huge paragraphs without double newlines: split on sentence boundaries
                sentences = re.split(r"(?<=[.!?])\s+", p_clean)
                sub_chunk = ""
                for s in sentences:
                    if len(sub_chunk) + len(s) + 1 <= max_chars:
                        sub_chunk = (sub_chunk + " " + s) if sub_chunk else s
                    else:
                        if sub_chunk:
                            chunks.append(sub_chunk)
                        sub_chunk = s
                current = sub_chunk

    if current:
        chunks.append(current)

    # Fallback to sliding window if content could not be chunked
    if not chunks:
        chunks = [content[i:i+max_chars] for i in range(0, len(content), max_chars - overlap) if content[i:i+max_chars].strip()]

    return chunks

def save_chunks(client_id: int, source_name: str, content: str) -> int:
    chunks = split_content_into_chunks(content)
    db = SessionLocal()
    try:
        for idx, chunk in enumerate(chunks):
            embedding = embed_text(chunk)
            db.add(KnowledgeChunk(
                client_id=client_id,
                source_name=source_name,
                chunk_index=idx,
                content=chunk,
                embedding=embedding
            ))
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
    """Optimized hybrid (vector + lexical) search for client knowledge chunks.
    Combines dense semantic vector search with punctuation-insensitive, stem-aware keyword matching.
    """
    try:
        embedding = embed_text(query)

        # 1. Normalized phrase for punctuation-insensitive matching (removes colons, hyphens, quotes, newlines)
        clean_q_alpha = re.sub(r"[^\w\s]", " ", query.lower())
        clean_q_phrase = re.sub(r"\s+", " ", clean_q_alpha).strip()

        # 2. Extract substantive query keywords (filtering stopwords)
        q_tokens = [w for w in clean_q_phrase.split() if len(w) >= 3 and w not in STOPWORDS]
        if not q_tokens:
            q_tokens = [w for w in clean_q_phrase.split() if len(w) >= 3]

        db = SessionLocal()
        try:
            chunks_dict: dict[int, dict] = {}

            # Retrieve candidate knowledge chunks for this client
            all_chunks = db.execute(select(KnowledgeChunk).where(
                KnowledgeChunk.client_id == client_id
            )).scalars().all()

            for c in all_chunks:
                # 1. Semantic Vector Similarity (in-memory cosine similarity)
                if embedding is not None and c.embedding:
                    sim = _cosine_similarity(c.embedding, embedding)
                    if sim >= min_similarity:
                        chunks_dict[c.id] = {
                            "id": c.id,
                            "source": c.source_name or "upload",
                            "content": c.content,
                            "similarity": round(sim, 3)
                        }

                # 2. Resilient Lexical Matching (exact phrase + stemmed keywords)
                if len(clean_q_phrase) >= 3:
                    norm_content_alpha = re.sub(r"[^\w\s]", " ", c.content.lower())
                    norm_content_phrase = re.sub(r"\s+", " ", norm_content_alpha)

                    # Case A: Exact phrase match (e.g. section titles like "Stakeholder Responsibility")
                    if len(clean_q_phrase) >= 5 and clean_q_phrase in norm_content_phrase:
                        exact_sim = 0.95
                        if c.id in chunks_dict:
                            chunks_dict[c.id]["similarity"] = max(chunks_dict[c.id]["similarity"], exact_sim)
                        else:
                            chunks_dict[c.id] = {
                                "id": c.id,
                                "source": c.source_name or "upload",
                                "content": c.content,
                                "similarity": exact_sim
                            }

                    # Case B: Substantive token overlap with morphological stem support
                    elif q_tokens:
                        doc_words = set(norm_content_phrase.split())
                        matched = 0
                        for qw in q_tokens:
                            stem = qw[:5] if len(qw) >= 6 else (qw[:4] if len(qw) >= 4 else qw)
                            if qw in doc_words or any(dw.startswith(stem) or qw.startswith(dw[:4]) for dw in doc_words if len(dw) >= 4):
                                matched += 1

                        # Require 1 keyword for 1-2 word queries, or 50% (min 2) for longer queries
                        min_required = 1 if len(q_tokens) <= 2 else max(2, int(len(q_tokens) * 0.5))
                        if matched >= min_required:
                            overlap_ratio = matched / len(q_tokens)
                            lex_sim = round(0.55 + 0.35 * overlap_ratio, 3)
                            if c.id in chunks_dict:
                                chunks_dict[c.id]["similarity"] = max(chunks_dict[c.id]["similarity"], lex_sim)
                            else:
                                chunks_dict[c.id] = {
                                    "id": c.id,
                                    "source": c.source_name or "upload",
                                    "content": c.content,
                                    "similarity": lex_sim
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
