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
