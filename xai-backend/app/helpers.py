import os
import traceback
from fastapi import HTTPException, status
import json
import re
from typing import Optional, List, Any
from datetime import datetime
import boto3
from livekit.api import LiveKitAPI
from livekit.protocol import agent_dispatch

from app.core import db
from app.core.config import settings
from app.core.queries import PRODUCT_QUERY, BULK_PRODUCT_QUERY, GET_SELLER_BY_TOKEN_QUERY, GET_SELLER_BY_PRODUCT_QUERY, GET_SELLER_BY_CALL_ID_QUERY, GET_SELLER_DATA_QUERY, FEATURE_QUERY, GET_HOTSPOTS_BY_MEDIA_ID_QUERY, GET_TRANSCRIPT_MESSAGES_QUERY, INSERT_ERROR_LOG_QUERY, GET_USER_TOKEN_VALIDITY_QUERY, RESOLVE_SELLER_BY_ID_QUERY, RESOLVE_SELLER_BY_STORE_NAME_QUERY, RESOLVE_SELLER_BY_SHOP_NAME_QUERY
from app.schemas import ErrorLog

# ---------------------------------------------------------------------------
# S3 and MongoDB Configurations
# ---------------------------------------------------------------------------

AWS_ACCESS_KEY_ID = os.getenv("ACCESS_KEY")
AWS_SECRET_ACCESS_KEY = os.getenv("S3_SECRET_KEY")
AWS_DEFAULT_REGION = os.getenv("S3_REGION")
TRANSCRIPT_BUCKET_NAME = os.getenv("S3_BUCKET")
TRANSCRIPT_FOLDER_NAME = os.getenv("S3_PREFIX", "")
TRANSCRIPT_UPLOAD_ENABLED = os.getenv("TRANSCRIPT_UPLOAD_ENABLED", "").strip().lower() in (
    "1", "true", "yes", "on",
)

_SAFE = re.compile(r"[^A-Za-z0-9._-]+")

async def fetch_product(product_id: str, feature_id: Optional[int] = None) -> dict:
    try:
        feature_rows = None

        if db.db_pool is not None:
            async with db.db_pool.acquire() as conn:
                row = await conn.fetchrow(PRODUCT_QUERY, str(product_id))

                if row is not None and feature_id is not None:
                    feature_rows = await conn.fetch(
                        FEATURE_QUERY, row["aip_id"], feature_id
                    )
        else:
            conn = await db.get_db_connection()
            try:
                row = await conn.fetchrow(PRODUCT_QUERY, str(product_id))

                if row is not None and feature_id is not None:
                    feature_rows = await conn.fetch(
                        FEATURE_QUERY, row["aip_id"], feature_id
                    )
            finally:
                await conn.close()

        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product '{product_id}' not found",
            )

        result = dict(row)

        if isinstance(result.get("media_gallery"), str):
            result["media_gallery"] = json.loads(result["media_gallery"])

        # Always present. null when feature_id wasn't passed (or matched no rows),
        # otherwise a list of {feature_id, media_id, feature_name, feature_desc, media_params}.
        if feature_id is None:
            result["feature_media"] = None
        else:
            result["feature_media"] = [
                {
                    "feature_id": fr["feature_id"],
                    "media_id": fr["media_id"],
                    "feature_name": fr["feature_name"],
                    "feature_desc": fr["feature_desc"],
                    "media_params": (
                        json.loads(fr["media_params"])
                        if isinstance(fr["media_params"], str)
                        else fr["media_params"]
                    ),
                }
                for fr in feature_rows
            ] if feature_rows else []

        # Build URLs
        shop = result.get("shop")
        product_handle = result.get("product_handle")
        variant_id = result.get("shopify_variant_id")

        result["view_product_url"] = (
            f"https://{shop}/products/{product_handle}"
            if shop and product_handle
            else None
        )

        result["add_to_cart_url"] = (
            f"https://{shop}/cart/{variant_id}"
            if shop and variant_id
            else None
        )

        return result

    except HTTPException:
        raise
    except Exception as exc:
        print(f"!!! API ERROR in fetch_product: {exc}")
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {exc}",
        )

async def fetch_products_bulk(product_ids: List[str]) -> List[dict]:
    if not product_ids:
        return []

    try:
        if db.db_pool is not None:
            async with db.db_pool.acquire() as conn:
                rows = await conn.fetch(BULK_PRODUCT_QUERY, product_ids)
        else:
            conn = await db.get_db_connection()
            rows = await conn.fetch(BULK_PRODUCT_QUERY, product_ids)
            await conn.close()

        results = []

        for row in rows:
            item = dict(row)

            if isinstance(item.get("media_gallery"), str):
                item["media_gallery"] = json.loads(item["media_gallery"])

            # Build URLs
            shop = item.get("shop")
            product_handle = item.get("product_handle")
            variant_id = item.get("shopify_variant_id")

            item["view_product_url"] = (
                f"https://{shop}/products/{product_handle}"
                if shop and product_handle
                else None
            )

            item["add_to_cart_url"] = (
                f"https://{shop}/cart/{variant_id}"
                if shop and variant_id
                else None
            )

            results.append(item)

        return results

    except Exception as exc:
        print(f"!!! API ERROR in fetch_products_bulk: {exc}")
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {exc}",
        )

async def fetch_media_hotspots(media_id: int) -> dict:
    try:
        async def execute_logic(connection):
            rows = await connection.fetch(GET_HOTSPOTS_BY_MEDIA_ID_QUERY, media_id)
            if not rows:
                return {"media_id": media_id, "features": []}
            
            features = []
            for r in rows:
                features.append({
                    "feature_id": r["feature_id"],
                    "feature_name": r["feature_name"],
                    "feature_desc": r["feature_desc"],
                    "media_params": (
                        json.loads(r["media_params"])
                        if isinstance(r["media_params"], str)
                        else r["media_params"]
                    )
                })
            return {"media_id": media_id, "features": features}

        if db.db_pool is not None:
            async with db.db_pool.acquire() as conn:
                return await execute_logic(conn)
        else:
            conn = await db.get_db_connection()
            try:
                return await execute_logic(conn)
            finally:
                await conn.close()
    except Exception as exc:
        print(f"!!! API ERROR in fetch_media_hotspots: {exc}")
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {exc}",
        )


async def fetch_welcome_info(ai_call_token: str) -> dict:
    try:
        def build_store_payload(row: dict) -> dict:
            shop = row["shop"]
            annotations = row.get("annotations")
            if isinstance(annotations, str):
                annotations = json.loads(annotations)
            elif annotations is None:
                annotations = []

            return {
                "seller_id": row["seller_id"],
                "shop": shop,
                "store_name": row["store_name"],
                "brand_name": row["brand_name"],
                "logo_url": row["logo_url"],
                "theme_color": row["theme_color"],
                "text_color": row["text_color"],
                "storefront_url": f"https://{shop}" if shop else None,
                "welcome_image_url": row["welcome_image"],
                "welcome_text": row["welcome_text"],
                "media_id": row.get("media_id"),
                "annotations": annotations,
                "product_name": row.get("product_title"),
            }

        async def execute_logic(connection):
            seller_row = await connection.fetchrow(GET_SELLER_BY_TOKEN_QUERY, ai_call_token)

            if seller_row is None:
                return {
                    "valid": False,
                    "error": "Invalid or unrecognized ai_call_token",
                    "store": None,
                }

            # Check if there is a product_id associated with this order
            order_product_id = seller_row.get("product_id")

            if not order_product_id:
                return {
                    "valid": True,
                    "store": build_store_payload(dict(seller_row)),
                }

            # If product_id exists, fetch product details
            product_row = await connection.fetchrow(
                GET_SELLER_BY_PRODUCT_QUERY, order_product_id, seller_row["seller_id"]
            )

            if product_row is None:
                # Fallback to store payload if product not found in ai_products
                return {
                    "valid": True,
                    "store": build_store_payload(dict(seller_row)),
                }

            return {
                "valid": True,
                "store": build_store_payload(dict(product_row)),
            }

        if db.db_pool is not None:
            async with db.db_pool.acquire() as conn:
                return await execute_logic(conn)
        else:
            conn = await db.get_db_connection()
            try:
                return await execute_logic(conn)
            finally:
                await conn.close()

    except Exception as exc:
        print(f"!!! API ERROR in fetch_welcome_info: {exc}")
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {exc}",
        )

async def fetch_turn_info(ai_call_id: str) -> dict:
    try:
        async def execute_logic(connection):
            row = await connection.fetchrow(GET_SELLER_BY_CALL_ID_QUERY, ai_call_id)
            
            if row is None or not row["ai_call_token"]:
                return {
                    "valid": False,
                    "error": "Invalid or unrecognized ai_call_id / ai_call_token",
                    "store_name": None
                }

            return {
                "valid": True,
                "store_name": row["store_name"]
            }

        if db.db_pool is not None:
            async with db.db_pool.acquire() as conn:
                return await execute_logic(conn)
        else:
            conn = await db.get_db_connection()
            try:
                return await execute_logic(conn)
            finally:
                await conn.close()

    except Exception as exc:
        print(f"!!! DB ERROR in fetch_turn_info: {type(exc).__name__}: {exc}")
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {exc}",
        )

async def trigger_agent_dispatch(room_name: str, agent_name: str):

    print(f"Triggering LiveKit agent dispatch for room: {room_name}, agent: {agent_name}")
    api = LiveKitAPI(settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
    try:
        req = agent_dispatch.CreateAgentDispatchRequest(
            room=room_name,
            agent_name=agent_name
        )
        await api.agent_dispatch.create_dispatch(req)
        print(f"Successfully dispatched agent to room {room_name}")
    except Exception as e:
        print(f"Failed to dispatch agent: {e}")
    finally:
        await api.aclose()

async def fetch_seller_data(seller_id: int) -> dict:
    try:
        async def execute_logic(connection):
            row = await connection.fetchrow(GET_SELLER_DATA_QUERY, seller_id)

            if row is None:
                return {
                    "status_code": 1,
                    "status_msg": "Seller not found",
                    "return_data": None,
                }

            return {
                "status_code": 0,
                "status_msg": "success",
                "return_data": {
                    "seller_id": row["seller_id"],
                    "seller_name": row["seller_name"],
                    "logo_url": row["logo_url"],
                    "text_color": row["text_color"],
                    "theme_color": row["theme_color"],
                },
            }

        if db.db_pool is not None:
            async with db.db_pool.acquire() as conn:
                return await execute_logic(conn)
        else:
            conn = await db.get_db_connection()
            try:
                return await execute_logic(conn)
            finally:
                await conn.close()

    except Exception as exc:
        print(f"!!! API ERROR in fetch_seller_data: {exc}")
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {exc}",
        )

def _slug(value, fallback: str = "anon") -> str:
    """Filesystem/URL-safe token for use inside an S3 object key."""
    out = _SAFE.sub("-", (str(value) if value is not None else "").strip()).strip("-")
    return out[:64] or fallback

def build_key(*, ai_call_token) -> str:
    """Deterministic per-``ai_call_token`` object key so re-uploads overwrite one object."""
    name = f"{_slug(ai_call_token)}.json"
    return f"{TRANSCRIPT_FOLDER_NAME}{name}"

def _client():
    """Build an S3 client from env creds. Raises if boto3 isn't installed."""
    import boto3  # lazy: keep boto3 optional for the rest of the app

    return boto3.client(
        "s3",
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
        region_name=AWS_DEFAULT_REGION,
    )

def upload_transcript(ai_call_token: str, document: dict) -> dict:
    """Upload the transcript document as JSON. Returns ``{ok, key?, reason?}``."""
    if not TRANSCRIPT_UPLOAD_ENABLED:
        return {"ok": False, "reason": "transcript upload disabled"}
    if not (AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY):
        return {"ok": False, "reason": "AWS credentials not configured"}
    if not TRANSCRIPT_BUCKET_NAME:
        return {"ok": False, "reason": "S3 bucket not configured"}
    if not document:
        return {"ok": False, "reason": "empty document"}

    key = build_key(ai_call_token=ai_call_token)
    body = json.dumps(document, default=str, ensure_ascii=False, indent=2)
    
    try:
        with open("s3_target_paths.log", "a") as f:
            f.write(f"Preparing to upload to S3 Path: {key}\n")
    except Exception:
        pass

    try:
        resp = _client().put_object(
            Bucket=TRANSCRIPT_BUCKET_NAME,
            Key=key,
            Body=body.encode("utf-8"),
            ContentType="application/json; charset=utf-8",
        )
    except Exception as exc:
        print(f"Transcript upload failed: {exc}")
        return {"ok": False, "reason": str(exc)}

    status = resp.get("ResponseMetadata", {}).get("HTTPStatusCode")
    if status == 200:
        return {"ok": True, "key": key}
    return {"ok": False, "reason": f"unexpected S3 status {status}"}

async def get_postgres_transcript(ai_id: int, connection) -> Optional[dict]:
    """Fetch transcript document from PostgreSQL ai_transcript table."""
    query = """
        SELECT "Role" as role, "Messages" as message, created_at
        FROM ai_transcript
        WHERE ai_id = $1
        ORDER BY t_id ASC;
    """
    rows = await connection.fetch(query, ai_id)
    if not rows:
        return None
        
    messages = []
    for row in rows:
        messages.append({
            "role": row["role"],
            "message": row["message"],
            "created_at": row["created_at"].isoformat() if row["created_at"] else None
        })
        
    return {
        "ai_id": ai_id,
        "transcript": messages
    }

async def log_error(data: ErrorLog, conn) -> str:
    try:
        query = """
            INSERT INTO error_logs (api_name, input_payload, db_error_text)
            VALUES ($1, $2, $3)
            RETURNING err_ref_id;
        """
        # input_payload is json in PostgreSQL, so we encode it as JSON string
        payload_json = json.dumps(data.input_payload)
        ref_id = await conn.fetchval(query, data.api_name, payload_json, data.db_error)
        return str(ref_id)
    except Exception as e:
        print(f"Failed to log error to DB: {e}")
        return "Unknown"

def generate_token() -> str:
    import secrets
    return secrets.token_hex(32)

async def validate_user_token(token: str, conn) -> int:
    import datetime
    row = await conn.fetchrow(
        GET_USER_TOKEN_VALIDITY_QUERY,
        token
    )
    if row is None:
        return -1
    
    if row["token_validity"] and row["token_validity"] < datetime.datetime.now():
        return -1
        
    return row["user_id"]

async def resolve_seller_id(conn, shop: Optional[str] = None, seller_id: Optional[int] = None) -> Optional[int]:
    if seller_id is not None:
        exists = await conn.fetchval(RESOLVE_SELLER_BY_ID_QUERY, seller_id)
        if exists:
            return exists

    if shop:
        seller_id_resolved = await conn.fetchval(
            RESOLVE_SELLER_BY_STORE_NAME_QUERY,
            shop
        )
        if seller_id_resolved:
            return seller_id_resolved

        seller_id_resolved = await conn.fetchval(
            RESOLVE_SELLER_BY_SHOP_NAME_QUERY,
            shop
        )
        if seller_id_resolved:
            return seller_id_resolved

    return None

