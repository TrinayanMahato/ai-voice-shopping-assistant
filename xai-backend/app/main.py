import json
import hashlib
from datetime import timedelta, datetime
from livekit.api import AccessToken, VideoGrants, LiveKitAPI
from livekit.protocol import room as r_proto
import traceback
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, Request, Header
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.schemas import BulkProductRequest, CreateChqmeOrderRequest, ValidateCallToken, GenerateMeetingToken, GenerateAiSession, UpdateCallCost, EndCallRequest, ExportTranscriptRequest, UpdateIntentRequest, AppendTranscriptRequest, ReturnBase, ErrorLog
from app.helpers import fetch_product, fetch_products_bulk, fetch_media_hotspots, fetch_welcome_info, fetch_turn_info, trigger_agent_dispatch, fetch_seller_data, upload_transcript, get_postgres_transcript, log_error, generate_token, validate_user_token, resolve_seller_id
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from typing import Optional

load_dotenv()

from app.core.config import settings
from app.core import db
from app.core.queries import (
    INSERT_TRANSCRIPT_RETURNING_ID_QUERY,
    GET_CALL_COST_QUERY,
    UPDATE_CALL_COST_QUERY,
    GET_ADVISORY_LOCK_QUERY,
    GET_ORDER_BY_TOKEN_QUERY,
    GET_ORDER_USER_BY_TOKEN_QUERY,
    UPDATE_ORDER_DURATION_QUERY,
    UPDATE_ORDER_STATUS_QUERY,
    UPDATE_ORDER_INTENT_QUERY,
    CHECK_ORDER_EXISTS_QUERY,
    GET_PRODUCT_IMAGE_QUERY,
    INSERT_AI_TOKEN_QUERY,
    CHECK_EXISTING_SESSION_QUERY,
    INSERT_AI_ORDER_QUERY,
    INSERT_CART_DATA_QUERY,
    CHECK_ORDER_EXISTS_QUERY_NO_SEMI,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db_pool()
    yield
    await db.close_db_pool()

app = FastAPI(
    title=settings.PROJECT_NAME,
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    print(f"--> Incoming request: {request.method} {request.url}")
    response = await call_next(request)
    print(f"<-- Completed request: {request.method} {request.url} - Status: {response.status_code}")
    return response

@app.get("/products/{product_id}", summary="Get product by path param")
async def get_product_by_path(
    product_id: str,
    feature_id: Optional[int] = Query(
        None, description="Optional feature id to fetch its media_id/media_params"
    ),
):
    return await fetch_product(product_id, feature_id)
 

@app.get("/media/{media_id}/hotspots", summary="Get hotspots by media ID")
async def get_media_hotspots(media_id: int):
    return await fetch_media_hotspots(media_id)


@app.get("/products", summary="Get product by query param")
async def get_product_by_query(
    product_id: str = Query(..., description="Shopify Product ID")
):
    return await fetch_product(product_id)

@app.post("/products/bulk", summary="Get multiple products by shopify_product_id list")
async def get_products_bulk(body: BulkProductRequest):
    """
    Accepts a JSON body:  { "product_ids": ["123", "456", "789"] }
    Returns a list of matching products with media_gallery and features.
    """
    products_list = await fetch_products_bulk(body.product_ids)
    return {"products": products_list}


@app.get("/validate-token", summary="Validate a call token and get store name")
async def validate_token(
    call_token: str = Query(..., description="The call token string to validate")
):
    return await fetch_welcome_info(call_token)
 
@app.get("/validate_turn", summary="Validate a turn using ai_call_id and get store name")
async def validate_turn(
    ai_call_id: str = Query(..., description="The AI call ID to validate")
):
    return await fetch_turn_info(ai_call_id)


@app.post("/validate_call_token", summary="Validate a call token via POST")
async def validate_call_token(payload: ValidateCallToken):
    async def execute_logic(connection):
        query = GET_ORDER_BY_TOKEN_QUERY
        row = await connection.fetchrow(query, payload.token)
        if row is None:
            return ReturnBase(status_code=-1, return_data=[], status_msg="Invalid token")
            
        if row["user_id"] is None:
            return ReturnBase(status_code=2, return_data=[], status_msg="no such user exist")
            
        returnList = [{
            "ai_id": row["ai_id"],
            "ai_call_token": row["ai_call_token"],
            "ai_status_code": row["ai_status_code"],
            "ai_demo_date": str(row["ai_demo_date"]) if row["ai_demo_date"] else None,
            "seller_id": row["seller_id"],
            "product_id": row["product_id"],
            "user_id": row["user_id"],
            "first_name": row["first_name"],
            "phone": row["phone"],
            "product_name": row["product_name"],
            "product_image": row["product_image"],
            "brand_name": row["brand_name"],
            "brand_logo": row["brand_logo"],
        }]
        return ReturnBase(status_code=0, return_data=returnList, status_msg="OK")

    conn_for_error = None
    should_close_error = False
    try:
        if db.db_pool is not None:
            async with db.db_pool.acquire() as conn:
                conn_for_error = conn
                return await execute_logic(conn)
        else:
            conn = await db.get_db_connection()
            conn_for_error = conn
            should_close_error = True
            try:
                return await execute_logic(conn)
            finally:
                await conn.close()
                conn_for_error = None
    except Exception as exc:
        print(f"!!! Error in validate_call_token: {exc}")
        traceback.print_exc()
        
        ref_id = "Unknown"
        if conn_for_error is not None:
            try:
                el = ErrorLog(api_name="validate_call_token", input_payload=payload.token, db_error=str(exc))
                ref_id = await log_error(el, conn_for_error)
            except Exception as log_exc:
                print(f"Failed to log error: {log_exc}")
                
        if should_close_error and conn_for_error is not None:
            try:
                await conn_for_error.close()
            except Exception:
                pass
                
        return ReturnBase(status_code=-1, status_msg=f"Server Error, Ref ID = {ref_id}")

@app.post("/update_call_cost", summary="Update call cost for an AI session")
async def update_call_cost(payload: UpdateCallCost):
    async def execute_logic(connection):
        query = GET_CALL_COST_QUERY
        row = await connection.fetchrow(query, payload.ai_call_token)
        
        if row is None:
            return ReturnBase(status_code=-1, return_data=[], status_msg="Invalid token")
            
        current_cost = row["call_cost"] if row["call_cost"] is not None else 0.0
        new_cost = current_cost + payload.cost
        
        update_query = UPDATE_CALL_COST_QUERY
        await connection.execute(update_query, new_cost, payload.ai_call_token)
        
        return ReturnBase(status_code=0, return_data=[{"ai_id": row["ai_id"], "new_cost": new_cost}], status_msg="Call cost updated successfully")

    conn_for_error = None
    should_close_error = False
    try:
        if db.db_pool is not None:
            async with db.db_pool.acquire() as conn:
                return await execute_logic(conn)
        else:
            conn = await db.get_db_connection()
            conn_for_error = conn
            should_close_error = True
            try:
                return await execute_logic(conn)
            finally:
                await conn.close()
                conn_for_error = None
    except Exception as exc:
        print(f"!!! Error in update_call_cost: {exc}")
        traceback.print_exc()
        
        ref_id = "Unknown"
        if conn_for_error is not None:
            try:
                el = ErrorLog(api_name="update_call_cost", input_payload=payload.ai_call_token, db_error=str(exc))
                ref_id = await log_error(el, conn_for_error)
            except Exception as log_exc:
                print(f"Failed to log error: {log_exc}")
                
        if should_close_error and conn_for_error is not None:
            try:
                await conn_for_error.close()
            except Exception:
                pass
                
        return ReturnBase(status_code=-1, status_msg=f"Server Error, Ref ID = {ref_id}")



@app.post("/generate_meeting_token", summary="Generate a LiveKit meeting token and dispatch agent")
async def generate_meeting_token(payload: GenerateMeetingToken):

    api = LiveKitAPI(settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
    try:
        req = r_proto.ListParticipantsRequest(room=payload.token)
        participants_res = await api.room.list_participants(req)
        for p in participants_res.participants:
            if "simli-tutor" in p.identity or "simli-tutor" in p.name:
                return ReturnBase(status_code=-1, return_data=[], status_msg="Meeting is already in progress")
    except Exception:
        pass
    finally:
        await api.aclose()

    async def execute_logic(connection):
        
        lock_id = int(hashlib.sha256(payload.token.encode()).hexdigest()[:15], 16)

        async with connection.transaction():
            
            # 3. Try to grab the lock instantly
            lock_acquired = await connection.fetchval(GET_ADVISORY_LOCK_QUERY, lock_id)
            if not lock_acquired:
                # If another request is currently processing this exact token, abort!
                return ReturnBase(status_code=-1, return_data=[], status_msg="Meeting generation already in progress")

            query = GET_ORDER_BY_TOKEN_QUERY
            order = await connection.fetchrow(query, payload.token)
    
            if order is None:
                return ReturnBase(status_code=-1, return_data=[], status_msg="Invalid token")
                
            print("order is valid")
            print(dict(order))
    
            # Room and participant details
            room_id = payload.token
            identity = f"CUST_{room_id}"
            participant_name = order["first_name"] or identity
    
    
            # Generate LiveKit JWT token
            token = (
                AccessToken(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
                .with_identity(identity)
    
                .with_name(participant_name)
                .with_metadata(
                    json.dumps({
                        "usertype": "CUST",
                        "cde_room_id": room_id,
                    })
                )
                .with_grants(
                    VideoGrants(
                        room_join=True,
                        room=room_id
                    )
                )
                .with_ttl(timedelta(minutes=30))
                .to_jwt()
            )
    
            # Dispatch the Simli agent into this room
            await trigger_agent_dispatch(
                room_name=room_id,
                agent_name="simli-tutor"
            )
    
            # Return response
            return ReturnBase(
                status_code=0,
                status_msg="Token Generated & Agent Dispatched",
                return_data=[{
                    "token": token,
                    "room_id": room_id,
                    "identity": identity,
                    "livekit_url": settings.LIVEKIT_URL,
                }]
            )

    conn_for_error = None
    should_close_error = False
    try:
        if db.db_pool is not None:
            async with db.db_pool.acquire() as conn:
                conn_for_error = conn
                return await execute_logic(conn)
        else:
            conn = await db.get_db_connection()
            conn_for_error = conn
            should_close_error = True
            try:
                return await execute_logic(conn)
            finally:
                await conn.close()
                conn_for_error = None
    except Exception as exc:
        print(f"!!! Error in generate_meeting_token: {exc}")
        traceback.print_exc()
        
        ref_id = "Unknown"
        if conn_for_error is not None:
            try:
                el = ErrorLog(api_name="generate_meeting_token", input_payload=payload.token, db_error=str(exc))
                ref_id = await log_error(el, conn_for_error)
            except Exception as log_exc:
                print(f"Failed to log error: {log_exc}")
                
        if should_close_error and conn_for_error is not None:
            try:
                await conn_for_error.close()
            except Exception:
                pass
                
        return ReturnBase(status_code=-2, status_msg=f"Server Error, Ref ID = {ref_id}")



@app.get("/api/get_seller_data", summary="Get seller display info by seller_id")
async def get_seller_data(
    seller_id: int = Query(..., description="Seller primary key")
):
    return await fetch_seller_data(seller_id)


@app.post("/end_call", summary="End call and update order status")
async def end_call(
    payload: EndCallRequest,
    ai_call_token: str = Header(default=None, alias="AI-CALL-TOKEN"),
):
    async def execute_logic(connection):
        print(f"[/end_call] Received request for token: {ai_call_token}")
        if not ai_call_token:
            print("[/end_call] Error: Missing AI call token")
            return ReturnBase(status_code=-1, return_data=[], status_msg="Missing AI call token")

        order_row = await connection.fetchrow(
            GET_ORDER_USER_BY_TOKEN_QUERY,
            ai_call_token
        )

        if order_row is None:
            print(f"[/end_call] Error: Token not found in ai_orders: {ai_call_token}")
            return ReturnBase(status_code=-1, return_data=[], status_msg="Invalid AI call token")

        ai_id = order_row["ai_id"]
        print(f"[/end_call] Found ai_id {ai_id} for token {ai_call_token}. Attempting to UPDATE ai_status_code to 30...")

        try:
            if payload.duration_seconds:
                try:
                    await connection.execute(
                        UPDATE_ORDER_DURATION_QUERY,
                        payload.duration_seconds, ai_id
                    )
                    print(f"[/end_call] Updated duration to {payload.duration_seconds} for ai_id {ai_id}")
                except Exception as duration_exc:
                    print(f"[/end_call] Exception during duration UPDATE query: {duration_exc}")

            if payload.finished is not False:
                result = await connection.fetchval(
                    UPDATE_ORDER_STATUS_QUERY,
                    30, ai_id
                )
                print(f"[/end_call] UPDATE query executed. Returned result: {result}")
            else:
                result = ai_id
                print(f"[/end_call] Call not finished (finished=False). Skipped ai_status_code update for ai_id {ai_id}")
        except Exception as e:
            print(f"[/end_call] Exception during UPDATE query: {e}")
            raise e

        if result is None:
            print(f"[/end_call] Error: ai_id {ai_id} not found during UPDATE (this shouldn't happen!)")
            return ReturnBase(status_code=-1, return_data=[], status_msg="AI order not found")

        # Best-effort PostgreSQL / S3 upload
        upload = {"ok": False, "reason": "transcript not found"}
        try:
            doc = await get_postgres_transcript(ai_id, connection)
        except Exception as exc:
            doc = None
            upload = {"ok": False, "reason": f"transcript read failed: {exc}"}

        if doc:
            upload = upload_transcript(ai_call_token=ai_call_token, document=doc)
            if upload.get("ok"):
                try:
                    with open("s3_uploads.log", "a") as f:
                        f.write(f"[{datetime.now().isoformat()}] SUCCESS (end_call): Uploaded transcript for ai_id={ai_id} to {upload.get('key')}\n")
                except Exception as e:
                    print(f"Failed to write to s3_uploads.log: {e}")
                    
                # Delete the transcript from the database now that it is safely in S3
                try:
                    await connection.execute("DELETE FROM ai_transcript WHERE ai_id = $1;", ai_id)
                except Exception as e:
                    print(f"Failed to delete transcript after upload: {e}")
            else:
                reason = upload.get("reason")
                try:
                    el = ErrorLog(api_name="end_call_s3_upload", input_payload=str(ai_call_token), db_error=f"S3 Upload failed: {reason}")
                    await log_error(el, connection)
                except Exception as e:
                    print(f"Failed to log S3 error: {e}")

        returnList = [{
            "ai_id": ai_id,
            "ai_status_code": 30,
            "transcript_uploaded": upload.get("ok", False),
            "s3_key": upload.get("key"),
            "upload_reason": upload.get("reason"),
        }]
        return ReturnBase(status_code=0, return_data=returnList, status_msg="Call ended")

    # DB acquisition pattern matching main.py
    conn_for_error = None
    should_close_error = False
    try:
        if db.db_pool is not None:
            async with db.db_pool.acquire() as conn:
                conn_for_error = conn
                return await execute_logic(conn)
        else:
            conn = await db.get_db_connection()
            conn_for_error = conn
            should_close_error = True
            try:
                return await execute_logic(conn)
            finally:
                await conn.close()
                conn_for_error = None
    except Exception as exc:
        print(f"!!! Error in end_call: {exc}")
        traceback.print_exc()
        
        ref_id = "Unknown"
        # Best effort log error using current connection if it's open/valid
        if conn_for_error is not None:
            try:
                el = ErrorLog(api_name="end_call", input_payload=str(ai_call_token), db_error=str(exc))
                ref_id = await log_error(el, conn_for_error)
            except Exception as log_exc:
                print(f"Failed to log error: {log_exc}")
        
        if should_close_error and conn_for_error is not None:
            try:
                await conn_for_error.close()
            except Exception:
                pass
                
        return ReturnBase(status_code=-1, status_msg=f"Server Error, Ref ID = {ref_id}")

@app.post("/update_intent", summary="Update intent in ai_orders")
async def update_intent(payload: UpdateIntentRequest):
    async def execute_logic(connection):
        import json
        intent_json_str = json.dumps(payload.intent_data)
        
        try:
            result = await connection.execute(
                UPDATE_ORDER_INTENT_QUERY,
                intent_json_str, payload.ai_call_token
            )
            return ReturnBase(status_code=0, return_data=[], status_msg=f"Intent updated ({result})")
        except Exception as e:
            print(f"[/update_intent] Exception during UPDATE query: {e}")
            raise e

    conn_for_error = None
    should_close_error = False
    try:
        if db.db_pool is not None:
            async with db.db_pool.acquire() as conn:
                conn_for_error = conn
                return await execute_logic(conn)
        else:
            conn = await db.get_db_connection()
            conn_for_error = conn
            should_close_error = True
            try:
                return await execute_logic(conn)
            finally:
                await conn.close()
                conn_for_error = None
    except Exception as exc:
        print(f"!!! Error in update_intent: {exc}")
        traceback.print_exc()
        
        ref_id = "Unknown"
        if conn_for_error is not None:
            try:
                el = ErrorLog(api_name="update_intent", input_payload=str(payload.ai_call_token), db_error=str(exc))
                ref_id = await log_error(el, conn_for_error)
            except Exception as log_exc:
                print(f"Failed to log error: {log_exc}")
        
        if should_close_error and conn_for_error is not None:
            try:
                await conn_for_error.close()
            except Exception:
                pass
                
        return ReturnBase(status_code=-1, status_msg=f"Server Error, Ref ID = {ref_id}")

@app.post("/export_transcript", summary="Export transcript to S3 using ai_call_token")
async def export_transcript(payload: ExportTranscriptRequest):
    async def execute_logic(connection):
        # 1. Look up ai_id from ai_call_token
        order_row = await connection.fetchrow(
            CHECK_ORDER_EXISTS_QUERY,
            payload.ai_call_token
        )
        
        if not order_row:
            return ReturnBase(status_code=-1, return_data=[], status_msg="Invalid AI call token")
            
        ai_id = order_row["ai_id"]
        
        # 2. Fetch transcript from Postgres
        try:
            doc = await get_postgres_transcript(ai_id, connection)
        except Exception as exc:
            doc = None
            return ReturnBase(status_code=-1, return_data=[], status_msg=f"Failed to read transcript: {exc}")
            
        if not doc:
            return ReturnBase(status_code=-1, return_data=[], status_msg="No transcript found for this call")
            
        # 3. Upload to S3
        upload = upload_transcript(ai_call_token=payload.ai_call_token, document=doc)
        
        if upload.get("ok"):
            try:
                with open("s3_uploads.log", "a") as f:
                    f.write(f"[{datetime.now().isoformat()}] SUCCESS (export_transcript): Uploaded transcript for ai_id={ai_id} to {upload.get('key')} (token: {payload.ai_call_token})\n")
            except Exception as e:
                print(f"Failed to write to s3_uploads.log: {e}")
                
            # Delete the transcript from the database now that it is safely in S3
            try:
                await connection.execute("DELETE FROM ai_transcript WHERE ai_id = $1;", ai_id)
            except Exception as e:
                print(f"Failed to delete transcript after upload: {e}")
                
            return ReturnBase(
                status_code=0, 
                return_data=[{"ai_id": ai_id, "s3_key": upload.get("key")}], 
                status_msg="Transcript successfully uploaded to S3"
            )
        else:
            reason = upload.get("reason")
            try:
                el = ErrorLog(api_name="export_transcript_s3_upload", input_payload=payload.ai_call_token, db_error=f"S3 Upload failed: {reason}")
                await log_error(el, connection)
            except Exception as e:
                print(f"Failed to log S3 error: {e}")
                
            return ReturnBase(
                status_code=-1, 
                return_data=[{"reason": reason}], 
                status_msg="Failed to upload transcript to S3"
            )

    # DB acquisition pattern matching main.py
    conn_for_error = None
    should_close_error = False
    try:
        if db.db_pool is not None:
            async with db.db_pool.acquire() as conn:
                conn_for_error = conn
                return await execute_logic(conn)
        else:
            conn = await db.get_db_connection()
            conn_for_error = conn
            should_close_error = True
            try:
                return await execute_logic(conn)
            finally:
                await conn.close()
                conn_for_error = None
    except Exception as exc:
        print(f"!!! Error in export_transcript: {exc}")
        traceback.print_exc()
        
        ref_id = "Unknown"
        if conn_for_error is not None:
            try:
                el = ErrorLog(api_name="export_transcript", input_payload=payload.ai_call_token, db_error=str(exc))
                ref_id = await log_error(el, conn_for_error)
            except Exception as log_exc:
                print(f"Failed to log error: {log_exc}")
                
        if should_close_error and conn_for_error is not None:
            try:
                await conn_for_error.close()
            except Exception:
                pass
                
        return ReturnBase(status_code=-1, status_msg=f"Server Error, Ref ID = {ref_id}")

@app.post("/generate_ai_session", summary="Generate AI session tokens")
async def generate_ai_session(
    token: str = Query(..., description="Access token"),
    shop: Optional[str] = Query(None, description="Shop name"),
    seller_id: Optional[int] = Query(None, description="Seller ID"),
    payload: Optional[GenerateAiSession] = None
):
    """Exchanges a regular user access_token (+ shop/seller_id) for a fresh
    ai_call_token -- the same token validate_otp mints
    inline, but on demand for a session that already has its access_token.
    `token`/`shop`/`seller_id` are plain query params, matching this app's own
    /update_product-style conventions (not an Authorization header)."""
    if payload is None:
        payload = GenerateAiSession()

    async def execute_logic(connection):
        # Resolve the regular session (access_token from login_otp/validate_otp) -> user_id.
        userid = await validate_user_token(token, connection)
        if userid == -1:
            return ReturnBase(status_code=-2, return_data=[], status_msg="Invalid token")

        # An AI call order needs a store (ai_orders.seller_id is NOT NULL).
        resolved_seller_id = await resolve_seller_id(connection, shop=shop, seller_id=seller_id)
        if resolved_seller_id is None:
            return ReturnBase(status_code=-1, return_data=[], status_msg="Store not found")

        resolved_product_id = str(payload.product_id) if payload.product_id else None
        featured_image = None
        if payload.product_id:
            product_row = await connection.fetchrow(
                GET_PRODUCT_IMAGE_QUERY,
                str(payload.product_id), resolved_seller_id
            )
            if product_row:
                featured_image = product_row["featured_image"]
                
        ai_atoken = generate_token()
        ai_rtoken = generate_token()
        await connection.execute(
            INSERT_AI_TOKEN_QUERY,
            userid, ai_atoken, ai_rtoken
        )

        # Open an AI call order for this session. Check if an active order exists.
        existing_order = await connection.fetchrow(
            CHECK_EXISTING_SESSION_QUERY,
            userid
        )

        if existing_order:
            ai_call_token = existing_order["ai_call_token"]
            ai_order = existing_order
        else:
            ai_call_token = generate_token()
            ai_order = await connection.fetchrow(
                INSERT_AI_ORDER_QUERY,
                userid,
                resolved_seller_id,
                resolved_product_id,
                ai_call_token,
                payload.utm_data
            )

        if payload.cart_snapshot:
            await connection.execute(
                INSERT_CART_DATA_QUERY,
                ai_order["ai_id"],
                "SMART_DEMO",
                json.dumps(payload.cart_snapshot)
            )

        returnList = [{
            "ai_access_token": ai_atoken,
            "ai_refresh_token": ai_rtoken,
            "ai_call_token": ai_call_token,
            "ai_id": ai_order["ai_id"],
            "ai_demo_date": str(ai_order["ai_demo_date"]) if ai_order["ai_demo_date"] else None,
            "seller_id": resolved_seller_id,
            "product_id": resolved_product_id,
            "featured_image": featured_image,
            "ai_status_code": ai_order["ai_status_code"],
        }]
        return ReturnBase(status_code=0, return_data=returnList, status_msg="OK")

    # DB acquisition pattern matching main.py
    conn_for_error = None
    should_close_error = False
    try:
        if db.db_pool is not None:
            async with db.db_pool.acquire() as conn:
                conn_for_error = conn
                return await execute_logic(conn)
        else:
            conn = await db.get_db_connection()
            conn_for_error = conn
            should_close_error = True
            try:
                return await execute_logic(conn)
            finally:
                await conn.close()
                conn_for_error = None
    except Exception as exc:
        print(f"!!! Error in generate_ai_session: {exc}")
        traceback.print_exc()
        
        ref_id = "Unknown"
        if conn_for_error is not None:
            try:
                el = ErrorLog(api_name="generate_ai_session", input_payload=str(token), db_error=str(exc))
                ref_id = await log_error(el, conn_for_error)
            except Exception as log_exc:
                print(f"Failed to log error: {log_exc}")
        
        if should_close_error and conn_for_error is not None:
            try:
                await conn_for_error.close()
            except Exception:
                pass
                
        return ReturnBase(status_code=-1, status_msg=f"Server Error, Ref ID = {ref_id}")


@app.post("/append_transcript", summary="Append a turn object to ai_transcript")
async def append_transcript(payload: AppendTranscriptRequest):
    """Inserts a new row into ai_transcript."""
    async def execute_logic(connection):
        if not payload.ai_call_token:
            return ReturnBase(status_code=-1, return_data=[], status_msg="Missing ai_call_token")

        # Lookup ai_id from ai_orders using the ai_call_token
        ai_id = await connection.fetchval(
            CHECK_ORDER_EXISTS_QUERY_NO_SEMI,
            payload.ai_call_token
        )
        
        if ai_id is None:
            return ReturnBase(status_code=-1, return_data=[], status_msg="Invalid ai_call_token")

        new_t_id = await connection.fetchval(
INSERT_TRANSCRIPT_RETURNING_ID_QUERY,
            ai_id,
            payload.role.value,
            payload.message,
            payload.ai_call_token
        )

        return ReturnBase(
            status_code=0,
            return_data=[{
                "t_id": new_t_id,
                "ai_id": ai_id,
                "action": "created",
            }],
            status_msg="Transcript created",
        )

    conn_for_error = None
    should_close_error = False
    try:
        if db.db_pool is not None:
            async with db.db_pool.acquire() as conn:
                conn_for_error = conn
                return await execute_logic(conn)
        else:
            conn = await db.get_db_connection()
            conn_for_error = conn
            should_close_error = True
            try:
                return await execute_logic(conn)
            finally:
                await conn.close()
                conn_for_error = None
    except Exception as exc:
        print(f"!!! Error in append_transcript: {exc}")
        traceback.print_exc()

        ref_id = "Unknown"
        if conn_for_error is not None:
            try:
                el = ErrorLog(
                    api_name="append_transcript",
                    input_payload=payload.ai_call_token,
                    db_error=str(exc),
                )
                ref_id = await log_error(el, conn_for_error)
            except Exception as log_exc:
                print(f"Failed to log error: {log_exc}")

        if should_close_error and conn_for_error is not None:
            try:
                await conn_for_error.close()
            except Exception:
                pass

        return ReturnBase(status_code=-1, status_msg=f"Server Error, Ref ID = {ref_id}")





@app.post("/create_chqme_order", summary="Create CHQME AI Order via headers")
async def create_chqme_order(
    payload: CreateChqmeOrderRequest,
    chqme_access_token: Optional[str] = Header(default=None, alias="chqme-access-token"),
    chqme_session_id: str = Header(..., alias="chqme-session-id")
):
    async def execute_logic(connection):
        user_id = 0
        if chqme_access_token:
            # Reusing the existing valid token fetch function
            uid = await validate_user_token(chqme_access_token, connection)
            if uid != -1:
                user_id = uid

        # Use chqme_session_id directly as the ai_call_token
        result = await connection.fetchrow(
            INSERT_AI_ORDER_QUERY,
            user_id,
            payload.seller_id,
            payload.product_id,
            chqme_session_id,  # ai_call_token
            None  # utm_data
        )

        response_dict = dict(result)
        response_dict["auth_status"] = "unauthenticated" if user_id == 0 else "authenticated"
        return ReturnBase(status_code=0, return_data=[response_dict], status_msg="Order created successfully")

    conn_for_error = None
    should_close_error = False
    try:
        if db.db_pool is not None:
            async with db.db_pool.acquire() as conn:
                conn_for_error = conn
                return await execute_logic(conn)
        else:
            conn = await db.get_db_connection()
            conn_for_error = conn
            should_close_error = True
            try:
                return await execute_logic(conn)
            finally:
                await conn.close()
    except Exception as e:
        import logging
        logging.error(f"REAL ERROR IN CREATE CHQME ORDER: {e}")
        ref_id = generate_token()
        
        return ReturnBase(status_code=-1, status_msg=f"Server Error, Ref ID = {ref_id}")





@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    import logging
    logging.error(f"422 Validation Error: {exc.errors()}")
    logging.error(f"Body: {await request.body()}")
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "body": str(await request.body())},
    )

