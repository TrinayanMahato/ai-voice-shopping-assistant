"""
All wire/state contracts in one place. The LiveKit agent, Redis session store,
LangGraph state, and the LLM's structured output all speak these shapes.
"""
from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Inbound: what the LiveKit agent sends us on each finalized user transcript
# ---------------------------------------------------------------------------

class TurnInput(BaseModel):
    call_id: str                       # LiveKit room id
    customer_id: Optional[str] = None
    transcript: str                    # STT output for this turn
    turn_number: int
    # Optional explicit UI signal, e.g. customer tapped a product card
    # shown on the in-call UI. Rule-based context-shift override uses this.
    selected_product_id: Optional[str] = None
    selected_feature_code: Optional[str] = None
    interrupted_previous_turn: bool = False
    store_name: Optional[str] = None
    voice_name: Optional[str] = None

# call initialize schema

class InitializeInput(BaseModel):
    call_id: str                       # LiveKit room id
    customer_id: Optional[str] = None
    language: Optional[str] = "en-IN"
    ai_id: Optional[int] = None


# ---------------------------------------------------------------------------
# Session state — persisted in Redis, keyed by call_id
# ---------------------------------------------------------------------------

class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    interrupted: bool = False


class SessionState(BaseModel):
    call_id: str
    customer_id: Optional[str] = None
    store_name: Optional[str] = None
    current_product_id: Optional[str] = None
    message_history: list[Message] = Field(default_factory=list)
    conversation_summary: str = ""
    last_shown_products: list[str] = Field(default_factory=list)
    turn_number: int = 0
    updated_at: str = ""
    cart_data: list = Field(default_factory=list)
    default_language: Optional[str] = "en-IN"
    last_answers_language: Optional[str] = None


# ---------------------------------------------------------------------------
# Outbound: structured response — split at the orchestrator boundary into
# TTS (`message`) and data-channel payload (`products`, `current_product_id`)
# ---------------------------------------------------------------------------

class Bbox(BaseModel):
    x: int
    y: int
    width: int
    height: int

class Center(BaseModel):
    x: int
    y: int

class MediaParamsImage(BaseModel):
    url: str
    width: int
    height: int

class MediaParams(BaseModel):
    bbox: Bbox
    center: Center
    image: MediaParamsImage

class Feature(BaseModel):
    feature_id: int
    feature_code: str
    feature_name: str
    feature_desc: str
    media_params: MediaParams

class MediaGalleryItem(BaseModel):
    media_id: int
    media_url: str
    media_type: str
    features: list[Feature] = Field(default_factory=list)

class HighlightedFeature(BaseModel):
    image_url: str
    feature_name: str
    feature_desc: str
    bbox: Bbox
    center: Center

class ProductCard(BaseModel):
    aip_id: int
    shopify_product_id: str
    description_text: str
    feature_image: str
    view_product_url: Optional[str] = None
    add_to_cart_url: Optional[str] = None
    media_gallery: list[MediaGalleryItem] = Field(default_factory=list)

class BuyingIntent(BaseModel):
    intent: Literal["low", "medium", "high"]
    explanation: str


class AgentResponse(BaseModel):
    message: str                                   # goes to TTS, 1-3 sentences
    current_product_id: Optional[str] = None
    product_ids: list[str] = Field(default_factory=list)
    question_for_you: list[str] = Field(default_factory=list)
    feature_id: Optional[int] = None
    media_id: Optional[str] = None
    language: str
    buying_intent: BuyingIntent


# ---------------------------------------------------------------------------
# Router node output
# ---------------------------------------------------------------------------

class RouterDecision(BaseModel):
    route: Literal["product", "catalogue"]
    resolved_product_id: Optional[str] = None
    is_context_shift: bool = False
    reasoning: str = ""   # short internal note, never shown to customer
