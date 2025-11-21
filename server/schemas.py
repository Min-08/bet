from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


GameID = Literal["updown", "slot", "baccarat"]


class SessionCreate(BaseModel):
    game_id: GameID
    bet_amount: int = Field(gt=0, description="Virtual point amount for the bet")


class SessionResponse(BaseModel):
    session_key: str
    game_id: GameID
    bet_amount: int

    model_config = ConfigDict(from_attributes=True)


class VerifyKeyRequest(BaseModel):
    session_key: str


class VerifyKeyResponse(BaseModel):
    valid: bool
    message: str
    session_key: Optional[str] = None
    game_id: Optional[GameID] = None
    bet_amount: Optional[int] = None


class ReportResultRequest(BaseModel):
    session_key: str
    game_id: GameID
    bet_amount: int
    result: Literal["win", "lose", "tie"]
    payout_multiplier: float
    payout_amount: float
    timestamp: datetime
    bet_choice: Optional[str] = None
    detail: Optional[str] = None


class SessionListItem(BaseModel):
    session_key: str
    game_id: GameID
    bet_amount: int
    created_at: datetime
    used: bool

    model_config = ConfigDict(from_attributes=True)


class ResultListItem(BaseModel):
    session_key: str
    game_id: GameID
    bet_amount: int
    bet_choice: Optional[str]
    result: str
    payout_multiplier: float
    payout_amount: float
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)


class AdjustmentCreate(BaseModel):
    amount: float
    description: Optional[str] = None


class AdjustmentResponse(BaseModel):
    id: int
    amount: float
    description: Optional[str]
    created_at: datetime
    total_profit: float

    model_config = ConfigDict(from_attributes=True)


class GameSettingItem(BaseModel):
    game_id: GameID
    risk_enabled: bool
    risk_threshold: int
    casino_advantage_percent: float
    assist_enabled: bool
    assist_max_bet: int
    player_advantage_percent: float

    model_config = ConfigDict(from_attributes=True)


class GameSettingsUpdate(BaseModel):
    settings: List[GameSettingItem]
