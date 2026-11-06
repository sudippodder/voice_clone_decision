# Compatibility patch for newer or mismatched LangChain package versions
try:
    import langchain
    if not hasattr(langchain, "debug"):
        langchain.debug = False
    if not hasattr(langchain, "verbose"):
        langchain.verbose = False
    if not hasattr(langchain, "llm_cache"):
        langchain.llm_cache = None
except Exception:
    pass

try:
    import langchain_core.globals
    langchain_core.globals._HAS_LANGCHAIN = False
except Exception:
    pass

import re
import json
from typing import TypedDict, Any
from langgraph.graph import StateGraph, END
from openai import OpenAI
from sqlalchemy import select
from .config import settings
from .db import SessionLocal
from .models import ExecutiveProfileRecord, CommunicationSituation, Memory
from .graph_memory import retrieve_related
from .vector_memory import search_chunks

# =====================================================================
# Response Mode Configurations for Executive Decision Intelligence
# =====================================================================
RESPONSE_MODES = {
    "short": {
        "instruction": (
            "LENGTH BUDGET: Maximum 1-2 sentences (20-40 words).\n"
            "STYLE: Voice-first direct response. Provide ONLY the direct answer or decision statement. "
            "NEVER use structural labels like 'Decision:', 'Evidence:', 'Source:', 'Caveat:', or 'Next step:'. "
            "If the database provides an exact answer (such as in an approved Q&A document or policy), output ONLY that exact answer."
        ),
        "max_tokens": 120,
    },
    "moderate": {
        "instruction": (
            "LENGTH BUDGET: Maximum 2-3 sentences (40-70 words).\n"
            "STYLE: Voice-first response. State the direct answer or decision clearly and explain the rationale in natural spoken prose. "
            "NEVER use prefix labels like 'Decision:', 'Evidence:', 'Source:', 'Caveat:', or 'Next step:'. "
            "NEVER read out file names or citations. If the database provides an exact answer, output ONLY that exact answer directly."
        ),
        "max_tokens": 220,
    },
    "detailed": {
        "instruction": (
            "LENGTH BUDGET: 3-5 sentences (80-150 words).\n"
            "STYLE: State the direct answer first and provide comprehensive business rationale in clean spoken prose. "
            "Do NOT use robotic structural prefixes, bullet points, or section headings."
        ),
        "max_tokens": 450,
    },
}

DIRECTNESS_GUIDELINES = {
    "direct": "High directness: State the decision immediately with zero conversational preamble.",
    "balanced": "Balanced directness: Professional, direct, and straightforward.",
    "indirect": "Diplomatic: Frame the decision tactfully while remaining completely clear.",
}

# Regex patterns to detect pure conversational greetings
GREETING_PATTERN = re.compile(
    r"^(hi|hello|hey|good\s+(morning|afternoon|evening)|greetings|howdy)([\s,\.!\?]+(there|everyone)?)?[\s,\.!\?]*$",
    re.IGNORECASE
)

# Regex patterns to strip unwanted conversational openings/filler from LLM outputs
CHATTER_PATTERNS = [
    r"^(hello|hi|hey|greetings|good\s+(morning|afternoon|evening))[\s,\.!]*",
    r"^(certainly|sure|absolutely|of\s+course|gladly)[\s,\.!]*",
    r"^(as\s+an\s+ai|as\s+the\s+ai\s+representative|according\s+to\s+the\s+(documents|provided\s+context|database))[\s,\.!]*",
    r"^(i\s+would\s+be\s+happy\s+to\s+help|let\s+me\s+help\s+you\s+with\s+that)[\s,\.!]*",
    r"^(thank\s+you\s+for\s+(asking|reaching\s+out)|thanks\s+for\s+asking)[\s,\.!]*",
]


class DecisionState(TypedDict, total=False):
    client_id: int
    client: Any
    profile: Any
    memories: list
    profile_records: list[dict]
    situation_guidelines: list[str]
    history: list
    user_text: str
    graph_memories: list[str]
    vector_memories: list[dict]
    is_pure_greeting: bool
    has_sufficient_evidence: bool
    response: str


def check_is_greeting(text: str) -> bool:
    clean = text.strip().lower()
    clean_alpha = re.sub(r"[^\w\s\u0980-\u09FF]", " ", clean).strip()
    words = clean_alpha.split()
    if not words or len(words) > 8:
        return False

    # Check conversational pleasantries and check-ins
    pleasantries = [
        "how are you", "how are you doing", "how are things", "how is it going",
        "how s it going", "how do you do", "how r u", "are you there", "can you hear me"
    ]
    if any(p == clean_alpha or clean_alpha.startswith(p) for p in pleasantries):
        return True

    greeting_words = {
        "hi", "hello", "hey", "greetings", "howdy", "good",
        "হায়", "হ্যালো", "হাই", "নমস্কার", "সালাম"
    }
    if words[0] in greeting_words:
        filler = {
            "there", "everyone", "shaun", "shawn", "koushik", "song", "sawan", "son",
            "sir", "mr", "morning", "afternoon", "evening", "day", "how", "are",
            "you", "can", "hear", "me", "to", "you", "doing", "speaking",
            "কেমন", "আছো", "আছেন", "শৌন", "কৌশিক"
        }
        remaining = [w for w in words[1:] if w not in filler]
        if len(remaining) == 0:
            return True

    return bool(GREETING_PATTERN.match(text.strip()))


def retrieve_node(state: DecisionState) -> DecisionState:
    client_id = state.get("client_id", 0)
    user_text = state.get("user_text", "").strip()

    # 1. Similarity-Gated Hybrid Vector + Lexical Search (Threshold >= 0.28)
    try:
        vector_memories = search_chunks(client_id, user_text, limit=4, min_similarity=0.28)
    except Exception as e:
        print(f"Vector retrieval error: {e}")
        vector_memories = []

    # 2. Detect if input is a greeting/pleasantry AND has no specific document chunk match
    if check_is_greeting(user_text) and not vector_memories:
        return {
            "is_pure_greeting": True,
            "has_sufficient_evidence": True,
            "graph_memories": [],
            "vector_memories": [],
            "profile_records": [],
            "situation_guidelines": [],
        }

    # 3. Neo4j Graph Retrieval
    try:
        graph_memories = retrieve_related(client_id, user_text)
    except Exception as e:
        print(f"Graph retrieval error: {e}")
        graph_memories = []

    # 4. PostgreSQL Relational Query: Verified Profile Records & Situations
    profile_records: list[dict] = []
    situation_guidelines: list[str] = []
    query_tokens = [w.lower().strip(".,!?;:\"'") for w in user_text.split() if len(w) >= 4]

    try:
        db = SessionLocal()
        try:
            # Query verified profile records (principles, past decisions, projects, policies)
            records = db.execute(
                select(ExecutiveProfileRecord).where(
                    ExecutiveProfileRecord.client_id == client_id,
                    ExecutiveProfileRecord.verification_status.in_(["verified", "approved"])
                )
            ).scalars().all()

            for r in records:
                combined_text = f"{r.title} {r.payload}".lower()
                if not query_tokens or any(token in combined_text for token in query_tokens):
                    try:
                        parsed_payload = json.loads(r.payload) if isinstance(r.payload, str) else r.payload
                        details = parsed_payload.get("details", "") if isinstance(parsed_payload, dict) else str(parsed_payload)
                    except Exception:
                        details = str(r.payload)
                    profile_records.append({
                        "type": r.record_type,
                        "title": r.title,
                        "details": details
                    })

            # Query communication situations
            situations = db.execute(
                select(CommunicationSituation).where(
                    CommunicationSituation.client_id == client_id,
                    CommunicationSituation.enabled == True
                )
            ).scalars().all()

            for sit in situations:
                sit_text = f"{sit.name} {sit.trigger_description}".lower()
                if any(token in sit_text for token in query_tokens):
                    situation_guidelines.append(
                        f"[{sit.name}] Tone: {sit.tone}. Guidance: {sit.response_guidelines}"
                    )
        finally:
            db.close()
    except Exception as e:
        print(f"Relational retrieval error: {e}")

    # 4b. Detect meta-queries about stored documents or records
    client = state.get("client")
    exec_name = client.executive_name if client else "the executive"
    meta_phrases = [
        "how many document", "how much document", "what document", "how many record",
        "how much record", "what record", "documents right now", "record right now",
        "records right now", "record is there", "documents are there", "what is saved in db",
        "what is in the db", "what is stored", "list documents", "list records", "tell how many"
    ]
    if any(phrase in user_text.lower() for phrase in meta_phrases):
        try:
            db_meta = SessionLocal()
            try:
                from .models import KnowledgeChunk, Memory as DBMemory
                c_chunks = db_meta.query(KnowledgeChunk).filter(KnowledgeChunk.client_id == client_id).all()
                chunk_count = len(c_chunks)
                sources = sorted(list(set(c.source_name for c in c_chunks if getattr(c, "source_name", None))))
                c_mems = db_meta.query(DBMemory).filter(DBMemory.client_id == client_id).all()
                mem_count = len(c_mems)
                mem_titles = [m.title for m in c_mems]

                sources_str = ", ".join(sources) if sources else "verified playbook files"
                sample_titles = ", ".join(mem_titles[:4]) if mem_titles else "core policies"

                profile_records.append({
                    "type": "database_summary",
                    "title": f"Verified Database Records for {exec_name}",
                    "details": (
                        f"{exec_name}'s database currently stores {chunk_count} verified knowledge document chunks "
                        f"from {sources_str}, and {mem_count} approved operational memories "
                        f"including {sample_titles}."
                    )
                })
            finally:
                db_meta.close()
        except Exception as meta_err:
            print(f"Meta retrieval error: {meta_err}")

    # 5. Check if query matches fundamental executive profile fields
    profile = state.get("profile")
    profile_relevant = False
    if profile:
        profile_content = f"{profile.about} {profile.decision_principles} {profile.agent_rules} {profile.business_context}".lower()
        if any(token in profile_content for token in query_tokens if len(token) >= 5):
            profile_relevant = True

    # 5b. Check verified memories
    memory_items = state.get("memories", [])
    memory_matches = False
    if memory_items and query_tokens:
        for m in memory_items:
            m_text = f"{m.category} {m.title} {m.content}".lower()
            if any(token in m_text for token in query_tokens if len(token) >= 4):
                memory_matches = True
                break

    # 6. Evaluate Evidence Gate
    has_evidence = bool(vector_memories or graph_memories or profile_records or profile_relevant or memory_matches)

    return {
        "is_pure_greeting": False,
        "vector_memories": vector_memories,
        "graph_memories": graph_memories,
        "profile_records": profile_records,
        "situation_guidelines": situation_guidelines,
        "has_sufficient_evidence": has_evidence,
    }


def greeting_node(state: DecisionState) -> DecisionState:
    profile = state.get("profile")
    client = state.get("client")
    exec_name = client.executive_name if client else "the executive"

    if profile and profile.greeting and profile.greeting.strip():
        greeting_text = profile.greeting.strip()
    else:
        greeting_text = f"I am the digital decision representative for {exec_name}. How can I assist with documented business policies or decisions?"

    return {"response": greeting_text}


def insufficient_evidence_node(state: DecisionState) -> DecisionState:
    client = state.get("client")
    exec_name = client.executive_name if client else "the executive"
    refusal = (
        f"I cannot determine this from {exec_name}'s saved information. "
        "No relevant approved policy or decision record was found in the database."
    )
    return {"response": refusal}


def reason_node(state: DecisionState) -> DecisionState:
    client = state["client"]
    profile = state["profile"]
    user_text = state.get("user_text", "").strip()

    # Determine response mode and token budget from executive profile
    mode_key = (getattr(profile, "response_length", None) or "short").lower()
    if mode_key not in RESPONSE_MODES:
        mode_key = "short"
    mode_config = RESPONSE_MODES[mode_key]

    directness_key = (getattr(profile, "default_directness", None) or "balanced").lower()
    directness_instruction = DIRECTNESS_GUIDELINES.get(directness_key, DIRECTNESS_GUIDELINES["balanced"])
    tone = getattr(profile, "default_tone", None) or "professional"

    # Format database evidence
    vector_items = state.get("vector_memories", [])
    if vector_items:
        vector_text = "\n".join(
            f"- [Doc: {item['source']} (Relevance: {item['similarity']})]: {item['content']}"
            for item in vector_items
        )
    else:
        vector_text = "None."

    record_items = state.get("profile_records", [])
    if record_items:
        record_text = "\n".join(
            f"- [{r['type'].upper()}]: {r['title']} -> {r['details']}"
            for r in record_items
        )
    else:
        record_text = "None."

    graph_items = state.get("graph_memories", [])
    graph_text = "\n".join(graph_items) if graph_items else "None."

    memory_items = state.get("memories", [])
    if memory_items:
        memory_text = "\n".join(
            f"- [{m.category}] {m.title}: {m.content}" for m in memory_items
        )
    else:
        memory_text = "None."

    situation_items = state.get("situation_guidelines", [])
    situation_text = "\n".join(situation_items) if situation_items else "None."

    system_prompt = f"""You are the Digital Executive Decision Intelligence Agent for {client.executive_name}.
You are a voice agent. Speak cleanly, directly, and naturally. Ground every answer strictly in {client.executive_name}'s database.

=======================================================
MANDATORY OPERATING RULES:
=======================================================
1. DATABASE IS THE EXCLUSIVE SOURCE OF TRUTH:
   Use ONLY the verified database records, profile policies, and document chunks provided below.
   NEVER use general world knowledge, training assumptions, or unverified opinions.
   NEVER fabricate policies, commitments, or precedents.

2. RETURN ONLY THE DIRECT SPOKEN ANSWER:
   - Output ONLY the direct answer/statement itself in clean spoken language.
   - NEVER output structural labels or headers like "Decision:", "Evidence:", "Reason:", "Caveat:", "Next step:", or "Source:".
   - NEVER read out document filenames, page numbers, or Q&A IDs (e.g. do NOT say "ExecutiveMind_General_Communication_QA_Part_1.docx.pdf" or "Q007").
   - If the database contains an exact answer for the user's inquiry (such as in an approved Q&A document or policy statement), deliver ONLY that exact answer directly (e.g. "I am functioning normally and ready to assist.").

3. ZERO CONVERSATIONAL FILLER:
   - NO pleasantries or filler ("Certainly!", "I would be delighted to help", "Thanks for asking").
   - NO AI disclaimers ("As an AI representation...", "According to the documents provided...").

4. {mode_config["instruction"]}
   Tone: {tone}.
   Directness: {directness_instruction}

5. INSUFFICIENT EVIDENCE:
   If the provided database records do not directly answer the inquiry or establish precedent, respond EXACTLY:
   "I cannot determine this from {client.executive_name}'s saved information. No relevant approved policy or decision record was found in the database."

6. GOVERNANCE & ESCALATION:
   If a question involves financial, legal, or personnel commitments exceeding recorded authority, state the decision limit in one sentence and escalate to {client.executive_name}.

=======================================================
EXECUTIVE DECISION PRINCIPLES & GOVERNANCE RULES
=======================================================
Executive: {client.executive_name} ({client.company or 'Enterprise'})
Decision Approach: {profile.decision_making}
Decision Principles: {profile.decision_principles}
Agent Rules: {profile.agent_rules}

=======================================================
APPROVED DATABASE EVIDENCE (SOURCE OF TRUTH)
=======================================================
[VERIFIED PROFILE RECORDS & PRECEDENTS]
{record_text}

[RETRIEVED DOCUMENT CHUNKS (pgvector)]
{vector_text}

[KNOWLEDGE GRAPH RELATIONS]
{graph_text}

[VERIFIED MEMORIES]
{memory_text}

[COMMUNICATION SITUATION GUIDELINES]
{situation_text}
"""

    if not settings.openai_api_key:
        return {"response": f"System error: OPENAI_API_KEY is not configured for {client.executive_name}."}

    llm = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
    messages = [{"role": "system", "content": system_prompt}]

    # Maintain recent conversation turns
    for item in state.get("history", [])[-6:]:
        if item.get("role") in ("user", "assistant"):
            messages.append({"role": item["role"], "content": item["text"]})

    messages.append({"role": "user", "content": user_text})

    model_name = settings.llm_model.lower()
    is_reasoning_model = any(k in model_name for k in ["o1", "o3", "gpt-5"])

    # Calculate token budget:
    # Reasoning models (gpt-5, o1, o3) spend 200-400 tokens on internal reasoning before producing output.
    base_output_tokens = mode_config["max_tokens"]
    effective_max_tokens = (base_output_tokens + 800) if is_reasoning_model else base_output_tokens

    call_kwargs: dict[str, Any] = {
        "model": settings.llm_model,
        "messages": messages,
        "max_completion_tokens": effective_max_tokens,
    }
    if not is_reasoning_model:
        call_kwargs["temperature"] = 0.1
    else:
        call_kwargs["reasoning_effort"] = "low"

    try:
        result = llm.chat.completions.create(**call_kwargs)
        raw_text = result.choices[0].message.content or ""
    except Exception as e:
        fallback_kwargs: dict[str, Any] = {
            "model": settings.llm_model,
            "messages": messages,
        }
        if "max_completion_tokens" in str(e).lower():
            fallback_kwargs["max_tokens"] = effective_max_tokens
        result = llm.chat.completions.create(**fallback_kwargs)
        raw_text = result.choices[0].message.content or ""

    if not raw_text.strip():
        # Fallback if reasoning model depleted tokens
        try:
            retry_res = llm.chat.completions.create(
                model=settings.llm_model,
                messages=messages,
                max_completion_tokens=1200
            )
            raw_text = retry_res.choices[0].message.content or ""
        except Exception:
            pass

    if not raw_text.strip():
        raw_text = f"I am the digital representative for {client.executive_name}. Based on our recorded database, please restate your question."

    return {"response": raw_text.strip()}


def sanitize_response_node(state: DecisionState) -> DecisionState:
    """Strips accidental conversational filler, robotic labels, and metadata from the response."""
    text = state.get("response", "").strip()

    # Normalize special unicode punctuation for clean TTS and display
    text = text.replace("\u2011", "-").replace("\u2012", "-").replace("\u2013", "-").replace("\u2014", " - ")
    text = text.replace("\u2018", "'").replace("\u2019", "'").replace("\u201c", '"').replace("\u201d", '"')

    # Strip structural label prefixes: "Decision:", "Answer:", "Response:", "Direct Answer:"
    text = re.sub(r"^(decision|direct answer|answer|response)\s*:\s*", "", text, flags=re.IGNORECASE).strip()

    # Strip metadata/evidence suffix blocks if present
    text = re.sub(r"(?:\s+)(?:evidence|source|citation)\s*:\s*.*?(?=(?:\s+(?:caveat|next step|next practical step)|\Z))", "", text, flags=re.IGNORECASE | re.DOTALL).strip()
    text = re.sub(r"(?:\s+)(?:caveat|restriction)\s*:\s*.*?(?=(?:\s+(?:next step|next practical step)|\Z))", "", text, flags=re.IGNORECASE | re.DOTALL).strip()
    text = re.sub(r"(?:\s+)(?:next step|next practical step)\s*:\s*.*$", "", text, flags=re.IGNORECASE | re.DOTALL).strip()

    # Strip conversational chatter patterns
    for pattern in CHATTER_PATTERNS:
        text = re.sub(pattern, "", text, flags=re.IGNORECASE).strip()

    # Final cleanup of any leading label
    text = re.sub(r"^(decision|direct answer|answer|response)\s*:\s*", "", text, flags=re.IGNORECASE).strip()

    if text:
        text = text[0].upper() + text[1:]

    return {"response": text}


def route_decision(state: DecisionState) -> str:
    if state.get("is_pure_greeting", False):
        return "greeting"
    if not state.get("has_sufficient_evidence", False):
        return "refuse"
    return "reason"


def build_graph():
    graph = StateGraph(DecisionState)
    graph.add_node("retrieve", retrieve_node)
    graph.add_node("greeting", greeting_node)
    graph.add_node("refuse", insufficient_evidence_node)
    graph.add_node("reason", reason_node)
    graph.add_node("sanitize", sanitize_response_node)

    graph.set_entry_point("retrieve")

    graph.add_conditional_edges(
        "retrieve",
        route_decision,
        {
            "greeting": "greeting",
            "refuse": "refuse",
            "reason": "reason",
        }
    )

    graph.add_edge("greeting", END)
    graph.add_edge("refuse", END)
    graph.add_edge("reason", "sanitize")
    graph.add_edge("sanitize", END)

    return graph.compile()


try:
    workflow = build_graph()
except Exception as exc:
    print(f"Warning: Could not compile LangGraph workflow: {exc}")
    workflow = None


def run_decision(client_id: int, client: Any, profile: Any, memories: list, history: list, user_text: str) -> str:
    state: DecisionState = {
        "client_id": client_id,
        "client": client,
        "profile": profile,
        "memories": memories,
        "history": history,
        "user_text": user_text,
    }

    if workflow is not None:
        try:
            result = workflow.invoke(state)
            return result["response"]
        except Exception as e:
            print(f"LangGraph invocation error, falling back to direct pipeline: {e}")

    # Deterministic fallback pipeline executing identical node logic
    retrieved = retrieve_node(state)
    state.update(retrieved)

    route = route_decision(state)
    if route == "greeting":
        return greeting_node(state)["response"]
    elif route == "refuse":
        return insufficient_evidence_node(state)["response"]

    reasoned = reason_node(state)
    state.update(reasoned)
    sanitized = sanitize_response_node(state)
    return sanitized["response"]
