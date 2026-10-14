from neo4j import GraphDatabase
import hashlib
from .config import settings

_driver = None

CATEGORY_LABELS = {
    "decision_principle": "Principle",
    "principle": "Principle",
    "decision": "Decision",
    "decision_case": "Decision",
    "experience": "Experience",
    "outcome": "Outcome",
    "person": "Person",
    "belief": "Belief",
    "uploaded_knowledge": "Knowledge",
}


def driver():
    global _driver
    if not settings.neo4j_uri or not settings.neo4j_password:
        return None
    if _driver is None:
        _driver = GraphDatabase.driver(settings.neo4j_uri, auth=(settings.neo4j_user, settings.neo4j_password))
    return _driver


def upsert_memory(client_id: int, category: str, title: str, content: str):
    d = driver()
    if not d:
        return
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()[:24]
    key = f"{client_id}:memory:{title}:{digest}"
    kind = CATEGORY_LABELS.get(category.lower(), "Memory")
    with d.session() as session:
        session.run("""
        MERGE (c:Client {client_id: $client_id})
        MERGE (m:Memory {key: $key})
        SET m.category=$category, m.kind=$kind, m.title=$title, m.content=$content, m.updated_at=datetime()
        MERGE (c)-[:HAS_MEMORY]->(m)
        MERGE (k:KnowledgeType {name:$kind, client_id:$client_id})
        MERGE (m)-[:CLASSIFIED_AS]->(k)
        WITH m
        MATCH (other:Memory)
        WHERE other.key <> m.key AND other.category = m.category
          AND other.content IS NOT NULL
          AND any(term IN split(toLower(m.content), ' ') WHERE size(term) > 5 AND toLower(other.content) CONTAINS term)
        WITH m, other LIMIT 5
        MERGE (m)-[:RELATED_TO]->(other)
        """, client_id=client_id, key=key, category=category, kind=kind, title=title, content=content)


def retrieve_related(client_id: int, query: str, limit: int = 8) -> list[str]:
    d = driver()
    if not d:
        return []
    terms = [word.lower().strip(".,!?;:") for word in query.split() if len(word) >= 4][:8]
    if not terms:
        return []
    with d.session() as session:
        result = session.run("""
        MATCH (c:Client {client_id:$client_id})-[:HAS_MEMORY]->(m:Memory)
        WHERE any(term IN $terms WHERE toLower(m.content) CONTAINS term OR toLower(m.title) CONTAINS term)
        OPTIONAL MATCH (m)-[:RELATED_TO]-(related:Memory)
        RETURN DISTINCT m.title AS title, m.content AS content,
               collect(DISTINCT related.title)[0..3] AS related_titles
        LIMIT $limit
        """, client_id=client_id, terms=terms, limit=limit)
        return [f"[Graph memory] {r['title']}: {r['content']} (related: {', '.join(r['related_titles'] or [])})" for r in result]


def close_driver():
    global _driver
    if _driver is not None:
        _driver.close()
        _driver = None
