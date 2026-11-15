from pydantic import BaseModel
from typing import Optional, Any, List
from enum import Enum

class BulkProductRequest(BaseModel):
    product_ids: List[str]



class ValidateCallToken(BaseModel):
    token: str


class GenerateMeetingToken(BaseModel):
    token: str


class GenerateAiSession(BaseModel):
    product_id: Optional[str] = None
    utm_data: Optional[str] = None
    cart_snapshot: Optional[Any] = None


class UpdateCallCost(BaseModel):
    ai_call_token: str
    cost: float


class SellerDataResponse(BaseModel):
    seller_id: int
    seller_name: str
    logo_url: Optional[str] = None
    text_color: Optional[str] = None
    theme_color: Optional[str] = None



class EndCallRequest(BaseModel):
    ai_id: Optional[int] = None
    duration_seconds: Optional[int] = 0
    finished: Optional[bool] = True


class ExportTranscriptRequest(BaseModel):
    ai_call_token: str


class UpdateIntentRequest(BaseModel):
    ai_call_token: str
    intent_data: dict



class RoleEnum(str, Enum):
    user = "user"
    agent = "agent"
    assistant = "assistant"


class AppendTranscriptRequest(BaseModel):
    ai_call_token: str
    role: RoleEnum
    message: str



class ReturnBase(BaseModel):
    status_code: int
    status_msg: str
    return_data: Optional[List] = []




class ErrorLog(BaseModel):
    api_name: str
    input_payload: Optional[str] = None
    db_error: str

class CreateChqmeOrderRequest(BaseModel):
    seller_id: int
    product_id: Optional[str] = None
