"""
Central configuration. All values come from environment variables (.env in dev).
Nothing here should be hardcoded when this goes to staging/prod.
"""
from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

load_dotenv()  # This injects .env into os.environ so LangSmith can read it

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")

    # --- LLM ---
    openai_api_key: str = ""
    router_model: str = "gpt-4o-mini"      # cheap/fast — intent + PID resolution
    response_model: str = "gpt-4o"          # product / catalogue generation

    # --- Redis (session state) ---
    redis_url: str = "redis://localhost:6379/0"
    session_ttl_seconds: int = 60 * 30      # call max duration + buffer

    # --- ChromaDB (per-store persistent vector stores) ---
    # One directory per store: <chroma_root_path>/<store_name>/
    chroma_root_path: str = "./app/data/chroma"
    chroma_pdp_collection: str = "pdp_chunks"
    chroma_store_collection: str = "pdp_chunks"  # TODO: change back to "store_context" once indexed


    # --- Postgres (async transcript persistence, analytics) ---
    postgres_dsn: str = "postgresql://user:pass@localhost:5432/chqme"

    # --- Internal tool APIs (ChQMe product/catalogue services) ---
    # NOTE: these base URLs + the paths in app/tools/*.py are ASSUMED to match
    # the contract described in the design doc's tool table. Once the real
    # API contract is shared, only app/tools/*.py needs to change — nothing
    # else in the graph depends on transport details.
    product_api_base_url: str = "http://product-service.internal"
    catalogue_api_base_url: str = "http://catalogue-service.internal"
    tool_call_timeout_seconds: float = 0.45   # 450ms hard budget per tool call
    tool_call_retries: int = 1

    # --- Cache TTLs ---
    inventory_cache_ttl_seconds: int = 45
    pricing_cache_ttl_seconds: int = 45
    static_cache_ttl_seconds: int = 60 * 60  # product details, policies

    # --- Observability ---
    langsmith_tracing: bool = False
    log_level: str = "INFO"
    
    


settings = Settings()
