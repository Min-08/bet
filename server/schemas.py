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
    min_bet: int
    max_bet: int
    maintenance_mode: bool
    slot_payout_triple_seven: float
    slot_payout_triple_same: float
    slot_payout_double_same: float
    baccarat_payout_player: float
    baccarat_payout_banker: float
    baccarat_payout_tie: float
    jackpot_enabled: bool
    jackpot_contrib_percent: float
    jackpot_trigger_percent: float
    jackpot_pool: float
    updown_payout1: float
    updown_payout2: float
    updown_payout3: float
    updown_payout4: float
    updown_payout5: float
    updown_payout6: float
    updown_payout7: float
    updown_payout8: float
    updown_payout9: float
    updown_payout10: float
    slot_anim_step_ms: int
    slot_anim_steps1: int
    slot_anim_steps2: int
    slot_anim_steps3: int
    slot_anim_stagger_ms: int
    slot_anim_extra_prob: float
    slot_anim_extra_pct_min: float
    slot_anim_extra_pct_max: float
    slot_anim_smooth_strength: float
    slot_anim_match_prob: float
    slot_anim_match_min_pct: float
    slot_anim_match_max_pct: float
    slot_anim_match7_min_pct: float
    slot_anim_match7_max_pct: float
    slot_anim_extra25_prob: float
    slot_anim_extra25_pct: float
    slot_anim_smooth_threshold: float
    bias_rules: List[dict] | None = None

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


class GlobalSettingItem(BaseModel):
    min_bet: int
    max_bet: int

    model_config = ConfigDict(from_attributes=True)


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
