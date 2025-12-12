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
    user_id: Optional[int] = None
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


class TransactionItem(BaseModel):
    id: int
    user_id: int
    type: str
    game_type: Optional[str] = None
    amount: int
    before_balance: int
    after_balance: int
    description: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class GameSettingsUpdate(BaseModel):
    settings: List[GameSettingItem]


class GameLogItem(BaseModel):
    id: int
    user_id: Optional[int] = None
    user_name: Optional[str] = None
    game_id: Optional[str] = None
    action: str
    detail: Optional[str] = None
    created_at: datetime
    created_at_kst: str

    model_config = ConfigDict(from_attributes=True)


class UserBase(BaseModel):
    name: str


class UserCreate(UserBase):
    pin: str
    initial_balance: int = 0


class UserItem(UserBase):
    id: int
    balance: int
    pin: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class LoginRequest(BaseModel):
    name: str
    pin: str


class LoginResponse(BaseModel):
    token: str
    user: UserItem


class AdjustBalanceRequest(BaseModel):
    delta: int
    reason: Optional[str] = None


class MeResponse(UserItem):
    pass


class GameBaseRequest(BaseModel):
    bet_amount: int = Field(gt=0)


class UpdownRequest(GameBaseRequest):
    guesses: List[int]


class UpdownGuessRequest(BaseModel):
    guess: int


class SlotRequest(GameBaseRequest):
    pass


class BaccaratRequest(GameBaseRequest):
    bet_choice: Literal["player", "banker", "tie"]


class GameResponse(BaseModel):
    result: Literal["win", "lose", "tie", "pending"]
    payout_multiplier: float
    payout_amount: float
    delta: float
    balance: float
    detail: Optional[dict] = None
