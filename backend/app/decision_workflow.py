from typing import TypedDict, Any
from langgraph.graph import StateGraph, END
from openai import OpenAI
from .config import settings
from .graph_memory import retrieve_related
from .vector_memory import search_chunks

class DecisionState(TypedDict, total=False):
    client_id: int
    client: Any
    profile: Any
    memories: list
    history: list
    user_text: str
    graph_memories: list[str]
    vector_memories: list[str]
    response: str

def retrieve_node(state: DecisionState) -> DecisionState:
    try:
        graph_memories = retrieve_related(state["client_id"], state["user_text"])
    except Exception:
        graph_memories = []
    try:
        vector_memories = search_chunks(state["client_id"], state["user_text"])
    except Exception:
        vector_memories = []
    return {"graph_memories": graph_memories, "vector_memories": vector_memories}

def reason_node(state: DecisionState) -> DecisionState:
    client = state["client"]
    profile = state["profile"]
    memory_text = "\n".join(f"- [{m.category}] {m.title}: {m.content}" for m in state.get("memories", [])) or "No verified memories available."
    graph_text = "\n".join(state.get("graph_memories", [])) or "No matching graph relationships found."
    vector_text = "\n".join(state.get("vector_memories", [])) or "No matching vector-search chunks found."
    system = f"""You are the transparent AI voice representative for {client.executive_name}. Never claim to be the human.
Use only the profile, memories, graph evidence and conversation. Distinguish documented facts from inference. If evidence is missing or the matter is high-impact, say so and recommend contacting the executive.

PROFILE
About: {profile.about}
Personality: {profile.personality}
Leadership: {profile.leadership_style}
Decision approach: {profile.decision_making}
Communication style: {profile.communication_style}
Business context: {profile.business_context}
Decision principles: {profile.decision_principles}
People context: {profile.people_context}
Agent rules: {profile.agent_rules}
Preferred language: {profile.preferred_language}

POSTGRES / VECTOR MEMORY
{memory_text}

NEO4J GRAPH MEMORY
{graph_text}

RETRIEVED DOCUMENT / HISTORY CHUNKS (pgvector)
{vector_text}

Respond naturally and concisely in the executive's documented communication style. Do not invent commitments, decisions or policies."""
    if not settings.openai_api_key:
        return {"response": "I am the client's AI representative. GPT reasoning is not configured yet. Please set OPENAI_API_KEY to enable executive-specific responses."}
    llm = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
    messages = [{"role":"system", "content":system}]
    for item in state.get("history", [])[-12:]:
        if item.get("role") in ("user", "assistant"):
            messages.append({"role":item["role"], "content":item["text"]})
    messages.append({"role":"user", "content":state["user_text"]})
    kwargs = {}
    if not any(k in settings.llm_model.lower() for k in ["o1", "o3", "gpt-5"]):
        kwargs["temperature"] = 0.25
    try:
        result = llm.chat.completions.create(model=settings.llm_model, messages=messages, **kwargs)
    except Exception:
        # Fallback without temperature if model rejects temperature
        result = llm.chat.completions.create(model=settings.llm_model, messages=messages)
    return {"response": (result.choices[0].message.content or "I need more information to answer reliably.").strip()}

def build_graph():
    graph = StateGraph(DecisionState)
    graph.add_node("retrieve", retrieve_node)
    graph.add_node("reason", reason_node)
    graph.set_entry_point("retrieve")
    graph.add_edge("retrieve", "reason")
    graph.add_edge("reason", END)
    return graph.compile()

workflow = build_graph()

def run_decision(client_id: int, client: Any, profile: Any, memories: list, history: list, user_text: str) -> str:
    result = workflow.invoke({"client_id":client_id, "client":client, "profile":profile, "memories":memories, "history":history, "user_text":user_text})
    return result["response"]
