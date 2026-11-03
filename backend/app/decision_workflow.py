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
            "LENGTH BUDGET: Maximum 1-3 sentences (30-60 words).\n"
            "STRUCTURE: State the exact decision or policy answer in the first sentence. "
            "Follow with the primary database-recorded reason or condition. Stop immediately. "
            "Never summarize documents or add conversational filler."
        ),
        "max_tokens": 120,
    },
    "moderate": {
        "instruction": (
            "LENGTH BUDGET: 3-5 sentences (60-120 words).\n"
            "STRUCTURE: State the decision first, cite the key database evidence/constraint, "
            "mention one relevant caveat or authority limit, and state the next practical step."
        ),
        "max_tokens": 220,
    },
    "detailed": {
        "instruction": (
            "LENGTH BUDGET: 150-250 words.\n"
            "STRUCTURE: State the decision, key database evidence, trade-offs, risks, "
            "and execution requirements. Only provide this level if detailed analysis was explicitly requested."
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
    clean = text.strip()
    return bool(GREETING_PATTERN.match(clean))


def retrieve_node(state: DecisionState) -> DecisionState:
    client_id = state.get("client_id", 0)
    user_text = state.get("user_text", "").strip()

    # 1. Detect if input is simply a greeting
    if check_is_greeting(user_text):
        return {
            "is_pure_greeting": True,
            "has_sufficient_evidence": True,
            "graph_memories": [],
            "vector_memories": [],
            "profile_records": [],
            "situation_guidelines": [],
        }

    # 2. Similarity-Gated Vector Search (Threshold >= 0.40)
    try:
        vector_memories = search_chunks(client_id, user_text, limit=4, min_similarity=0.40)
    except Exception as e:
        print(f"Vector retrieval error: {e}")
        vector_memories = []

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

    # 5. Check if query matches fundamental executive profile fields
    profile = state.get("profile")
    profile_relevant = False
    if profile:
        profile_content = f"{profile.about} {profile.decision_principles} {profile.agent_rules} {profile.business_context}".lower()
        if any(token in profile_content for token in query_tokens if len(token) >= 5):
            profile_relevant = True

    # 6. Evaluate Evidence Gate
    has_evidence = bool(vector_memories or graph_memories or profile_records or profile_relevant)

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
You are NOT a conversational chatbot. You are a precise decision engine grounded strictly in {client.executive_name}'s database.

=======================================================
MANDATORY OPERATING RULES:
=======================================================
1. DATABASE IS THE EXCLUSIVE SOURCE OF TRUTH:
   Use ONLY the verified database records, profile policies, and document chunks provided below.
   NEVER use general world knowledge, training assumptions, or unverified opinions.
   NEVER fabricate policies, commitments, or precedents.

2. ZERO HUMAN TALK / NO CONVERSATIONAL FILLER:
   - NO greetings ("Hello", "Hi", "Good morning").
   - NO pleasantries or filler ("Certainly!", "I would be delighted to help", "Thanks for asking").
   - NO AI disclaimers ("As an AI representation...", "According to the documents provided...").
   - Deliver the decision and rationale directly and professionally.

3. {mode_config["instruction"]}
   Tone: {tone}.
   Directness: {directness_instruction}

4. INSUFFICIENT EVIDENCE:
   If the provided database records do not directly answer the inquiry or establish precedent, respond EXACTLY:
   "I cannot determine this from {client.executive_name}'s saved information. No relevant approved policy or decision record was found in the database."

5. GOVERNANCE & ESCALATION:
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

    call_kwargs: dict[str, Any] = {
        "model": settings.llm_model,
        "messages": messages,
        "max_completion_tokens": mode_config["max_tokens"],
    }
    if not is_reasoning_model:
        call_kwargs["temperature"] = 0.1

    try:
        result = llm.chat.completions.create(**call_kwargs)
        raw_text = result.choices[0].message.content or ""
    except Exception as e:
        fallback_kwargs: dict[str, Any] = {
            "model": settings.llm_model,
            "messages": messages,
        }
        if "max_completion_tokens" in str(e).lower():
            fallback_kwargs["max_tokens"] = mode_config["max_tokens"]
        result = llm.chat.completions.create(**fallback_kwargs)
        raw_text = result.choices[0].message.content or ""

    return {"response": raw_text.strip()}


def sanitize_response_node(state: DecisionState) -> DecisionState:
    """Strips accidental conversational filler and pleasantries from the generated response."""
    text = state.get("response", "").strip()

    # Strip conversational chatter patterns
    for pattern in CHATTER_PATTERNS:
        text = re.sub(pattern, "", text, flags=re.IGNORECASE).strip()

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
