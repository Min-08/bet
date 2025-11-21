from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


GameID = Literal["updown", "slot", "baccarat"]


class SessionCreate(BaseModel):
    game_id: GameID
    bet_amount: int = Field(gt=0, description="Virtual point amount for the bet")


class SessionResponse(BaseModel):
    session_key: str
    game_id: GameID
    bet_amount: int

    class Config:
        orm_mode = True


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

    class Config:
        orm_mode = True


class ResultListItem(BaseModel):
    session_key: str
    game_id: GameID
    bet_amount: int
    bet_choice: Optional[str]
    result: str
    payout_multiplier: float
    payout_amount: float
    timestamp: datetime

    class Config:
        orm_mode = True
