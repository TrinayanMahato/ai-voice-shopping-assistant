"""
Retrieval against per-store ChromaDB collections.

Each store has its own persistent Chroma directory:
    <settings.chroma_root_path>/<store_name>/
holding two collections:
    pdp_chunks    - product-scoped; metadata: product_id, chunk_type,
                    source_type, category, product_url, doc_title,
                    doc_version, embedding_model_version, last_updated
    store_context - store-scoped policies/promotions/categories, no product_id

Embeddings are produced here with the same OpenAI model the ingest pipeline
used and handed to Chroma as `query_embeddings`, so Chroma never loads an
embedding model of its own.

Hybrid search = one semantic query + one `$contains` keyword query, both
under the SAME metadata filter, merged by chunk id and ranked with exact
token hits first. Filtering both is deliberate: the previous pgvector
version OR'd the keyword clause against the whole WHERE, so a substring hit
could pull in chunks from other products.

Every returned row carries `similarity` (a true cosine) and `exact_match`
(whether the keyword pass surfaced it).

Chroma's client is synchronous and blocking; every call into it goes through
asyncio.to_thread, because this runs inside a live voice turn with a 450ms
per-tool budget.
"""
from __future__ import annotations

import asyncio
import logging
import re
from contextvars import ContextVar
from pathlib import Path
from typing import Any

import chromadb
from openai import AsyncOpenAI
from langsmith.wrappers import wrap_openai

from app.config import settings
from app.tools.client import ToolCallError

logger = logging.getLogger("chqme.voice_agent")

_openai = wrap_openai(AsyncOpenAI(api_key=settings.openai_api_key, timeout=10.0))

EMBEDDING_MODEL = "text-embedding-3-small"

# Bound by product_node / catalogue_node at the start of each turn. Tools are
# invoked with only the LLM's own JSON args (llm.py:_execute_tool), so store
# identity cannot travel through the tool signature.
current_store: ContextVar[str] = ContextVar("current_store")

_clients: dict[str, Any] = {}
_warned_models: set[str] = set()

_METADATA_PASSTHROUGH = (
    "product_id", "chunk_type", "source_type", "category",
    "product_url", "doc_title", "doc_version", "last_updated",
    "media_id", "feature_id", "image_url",
)


# --------------------------------------------------------------------------
# store / collection plumbing
# --------------------------------------------------------------------------

def _active_store() -> str:
    try:
        return current_store.get()
    except LookupError as exc:
        raise ToolCallError(
            "retrieval",
            RuntimeError("no store bound to this turn (current_store unset)"),
        ) from exc


def _client_for(store: str):
    """PersistentClient is expensive to build and Chroma rejects a second
    client on the same path with different settings, so cache per store."""
    if store not in _clients:
        path = Path(settings.chroma_root_path) / store
        if not path.is_dir():
            raise ToolCallError(
                "retrieval", FileNotFoundError(f"no Chroma store at {path}")
            )
        _clients[store] = chromadb.PersistentClient(path=str(path))
    return _clients[store]


def _collection(store: str, name: str):
    try:
        return _client_for(store).get_collection(name=name)
    except ToolCallError:
        raise
    except Exception as exc:  # noqa: BLE001 - missing collection, corrupt dir
        raise ToolCallError("retrieval", exc) from exc


def _space(collection) -> str:
    """Distance metric the collection was built with. Chroma defaults to l2,
    NOT cosine, so this has to be read rather than assumed.

    `.metadata` deliberately wins over `.configuration_json`. On chromadb
    1.5.9 the two disagree for the nester store - metadata says cosine,
    configuration_json says l2 - and measurement settles it in metadata's
    favour: querying the collection and comparing the returned distance
    against a numpy cosine of the stored embedding matched `1 - d` to 3e-07,
    while both l2 conversions were off by ~0.4. configuration_json is
    reporting defaults it never applied. Do not "fix" this precedence
    without re-running that comparison.
    """
    meta = getattr(collection, "metadata", None) or {}
    space = meta.get("hnsw:space")
    if not space:
        cfg = getattr(collection, "configuration_json", None) or {}
        space = ((cfg.get("hnsw") or {}).get("space")
                 or (cfg.get("spann") or {}).get("space"))
    return (space or "l2").lower()


def _to_similarity(distance: float, space: str) -> float:
    if space == "cosine":
        return 1.0 - distance
    if space == "ip":
        return -distance
    return 1.0 / (1.0 + distance)   # l2: monotonic rank only, not a cosine score


# --------------------------------------------------------------------------
# query helpers
# --------------------------------------------------------------------------

async def _embed(text: str) -> list[float]:
    resp = await _openai.embeddings.create(model=EMBEDDING_MODEL, input=text)
    return resp.data[0].embedding


def _where(clauses: list[dict]) -> dict | None:
    """Chroma needs an explicit $and once there is more than one key."""
    if not clauses:
        return None
    return clauses[0] if len(clauses) == 1 else {"$and": clauses}


def _check_embedding_model(meta: dict) -> None:
    """Ingest tags rows with a version suffix (text-embedding-3-small-v1), so
    match on prefix - an exact compare would warn on every healthy store."""
    version = meta.get("embedding_model_version")
    if not version or version.startswith(EMBEDDING_MODEL):
        return
    if version not in _warned_models:
        _warned_models.add(version)
        logger.warning(
            "embedding_model_mismatch",
            extra={"ingested_with": version, "querying_with": EMBEDDING_MODEL},
        )


def _keyword_filter(query: str) -> dict | None:
    """Build a where_document clause for the exact-token pass.

    Matching is a substring test, so passing the whole utterance is useless -
    customers speak in sentences ("do you have the FLEM-AF-16L-BK in stock")
    and the full sentence never appears verbatim in a chunk. Tokenize instead
    and match the identifier-shaped tokens: the point of this pass is SKUs,
    sizes and colour codes that embeddings blur, not ordinary words the
    semantic pass already handles.

    $regex rather than $contains, because $contains is case-sensitive and
    chunks store SKUs uppercase ("... SKU FLEM-AF-16L-BK ..."), so a
    lowercased token silently matches nothing. Measured against the nester
    store: lowercase $contains 0 hits, (?i) $regex 2 hits. chromadb 1.5.9
    honours inline regex flags in where_document.

    Returns None when nothing qualifies, so the caller can skip the query
    entirely rather than spend a round trip on a filter that cannot match.
    """
    # >=3 rather than >=4 so short size codes survive ("16l", "4kg"). The
    # digit-or-hyphen requirement is what keeps ordinary words out.
    tokens = {
        t for t in re.split(r"[^\w-]+", query.lower())
        if len(t) >= 3 and (any(c.isdigit() for c in t) or "-" in t)
    }
    if not tokens:
        return None
    alternation = "|".join(re.escape(t) for t in sorted(tokens))
    return {"$regex": f"(?i)(?:{alternation})"}


def _query_sync(collection, embedding, n_results, where, where_document) -> dict:
    kwargs: dict[str, Any] = {
        "query_embeddings": [embedding],
        "n_results": n_results,
        "include": ["documents", "metadatas", "distances"],
    }
    if where:
        kwargs["where"] = where
    if where_document:
        kwargs["where_document"] = where_document
    return collection.query(**kwargs)


def _rows(result: dict, space: str) -> dict[str, dict]:
    out: dict[str, dict] = {}
    ids = (result.get("ids") or [[]])[0]
    docs = (result.get("documents") or [[]])[0]
    metas = (result.get("metadatas") or [[]])[0]
    dists = (result.get("distances") or [[]])[0]
    for cid, doc, meta, dist in zip(ids, docs, metas, dists):
        meta = meta or {}
        _check_embedding_model(meta)
        row = {k: meta.get(k) for k in _METADATA_PASSTHROUGH}
        row["content"] = doc
        row["similarity"] = _to_similarity(dist, space)
        out[cid] = row
    return out


async def _hybrid(collection, query: str, embedding, where, top_k: int) -> list[dict]:
    space = _space(collection)

    passes = [asyncio.to_thread(_query_sync, collection, embedding, top_k, where, None)]
    kw_filter = _keyword_filter(query)
    if kw_filter is not None:
        # Same `where` as the semantic pass. The pgvector version OR'd the
        # keyword clause against the whole WHERE, which let chunks from other
        # products through; filtering both passes is what closes that.
        passes.append(
            asyncio.to_thread(_query_sync, collection, embedding, top_k, where, kw_filter)
        )

    results = await asyncio.gather(*passes, return_exceptions=True)

    failures = [r for r in results if isinstance(r, Exception)]
    if len(failures) == len(results):
        raise ToolCallError("retrieval", failures[0])
    for exc in failures:
        logger.warning("chroma_query_partial_failure", extra={"cause": str(exc)})

    # results[0] is always the semantic pass; results[1], when present, is the
    # keyword pass. zip stops at the shorter side, so this holds either way.
    merged: dict[str, dict] = {}
    for is_keyword, res in zip((False, True), results):
        if isinstance(res, Exception):
            continue
        for cid, row in _rows(res, space).items():
            prev = merged.get(cid)
            if prev is None:
                row["exact_match"] = is_keyword
                merged[cid] = row
            else:
                prev["exact_match"] = prev["exact_match"] or is_keyword
                prev["similarity"] = max(prev["similarity"], row["similarity"])

    # Exact-token hits outrank pure semantic ones. If the customer says a SKU
    # out loud, the chunk literally containing it must not be pushed below a
    # chunk that merely reads similar - which is what a plain similarity sort
    # did. Kept as a separate sort key rather than a boost added to the score,
    # so `similarity` stays a true cosine.
    ranked = sorted(
        merged.values(),
        key=lambda r: (r["exact_match"], r["similarity"]),
        reverse=True,
    )
    return ranked[:top_k]


# --------------------------------------------------------------------------
# tools
# --------------------------------------------------------------------------

async def retrieve_pdp_context(
    query: str,
    product_id: str | None = None,
    top_k: int = 8,
) -> list[dict]:
    """
    Product-scoped retrieval - used by the product node. Metadata pre-filter
    (product_id / chunk_type) is applied to both the semantic and keyword
    passes, so a chunk from another product can never surface.

    No stock filter: in_stock is not ingested metadata, and stock is live
    data anyway - get_inventory_status or the row's product_url own that.
    """
    store_name = _active_store()
    collection = _collection(store_name, settings.chroma_pdp_collection)
    embedding = await _embed(query)

    logger.info(
        f"RETRIEVAL_START: store={store_name}, query='{query}', product_id={product_id}"
    )

    where = None
    if product_id:
        where = {"product_id": product_id}

    results = await _hybrid(collection, query, embedding, where, top_k)
    
    logger.info(
        f"RETRIEVAL_RESULTS: store={store_name}, "
        f"total_chunks_found={len(results)}, "
        f"retrieved_chunks={results}"
    )
    
    return results


async def retrieve_store_context(
    query: str,
    chunk_types: list[str] | None = None,
    top_k: int = 3,
) -> list[dict]:
    """
    Store-level collection (shipping, returns, promotions, categories) -
    catalogue node. No product scoping needed: the collection holds no
    product_id, and cross-store isolation is structural (one dir per store).
    """
    # TODO: remove this guard once store_context collection is properly indexed
    try:
        collection = _collection(_active_store(), settings.chroma_store_collection)
    except ToolCallError:
        import logging
        logging.getLogger(__name__).warning(
            "store_context collection not found for store '%s' — returning empty results",
            _active_store(),
        )
        return []

    embedding = await _embed(query)

    clauses: list[dict] = []
    if chunk_types:
        clauses.append({"chunk_type": {"$in": list(chunk_types)}})

    return await _hybrid(collection, query, embedding, _where(clauses), top_k)
