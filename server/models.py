from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String

from .database import Base


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_key = Column(String, unique=True, index=True, nullable=False)
    game_id = Column(String, nullable=False)
    bet_amount = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    used = Column(Boolean, default=False, nullable=False)


class GameResult(Base):
    __tablename__ = "game_results"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=True)
    session_key = Column(String, index=True, nullable=False)
    game_id = Column(String, nullable=False)
    bet_amount = Column(Integer, nullable=False)
    bet_choice = Column(String, nullable=True)
    result = Column(String, nullable=False)
    payout_multiplier = Column(Float, nullable=False)
    payout_amount = Column(Float, nullable=False)
    detail = Column(String, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False)
    type = Column(String, nullable=False)  # charge | deduct | game
    game_type = Column(String, nullable=True)
    amount = Column(Integer, nullable=False)
    before_balance = Column(Integer, nullable=False)
    after_balance = Column(Integer, nullable=False)
    description = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False)
    pin = Column(String, nullable=False)
    balance = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class FinancialAdjustment(Base):
    __tablename__ = "financial_adjustments"

    id = Column(Integer, primary_key=True, index=True)
    amount = Column(Float, nullable=False)
    description = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class GameSetting(Base):
    __tablename__ = "game_settings"

    id = Column(Integer, primary_key=True, index=True)
    game_id = Column(String, unique=True, nullable=False)
    risk_enabled = Column(Boolean, default=True, nullable=False)
    risk_threshold = Column(Integer, default=50, nullable=False)
    casino_advantage_percent = Column(Float, default=15.0, nullable=False)
    assist_enabled = Column(Boolean, default=False, nullable=False)
    assist_max_bet = Column(Integer, default=50, nullable=False)
    player_advantage_percent = Column(Float, default=0.0, nullable=False)
    min_bet = Column(Integer, default=1, nullable=False)
    max_bet = Column(Integer, default=10000, nullable=False)
    maintenance_mode = Column(Boolean, default=False, nullable=False)
    slot_payout_triple_seven = Column(Float, default=10.0, nullable=False)
    slot_payout_triple_same = Column(Float, default=5.0, nullable=False)
    slot_payout_double_same = Column(Float, default=1.5, nullable=False)
    baccarat_payout_player = Column(Float, default=2.0, nullable=False)
    baccarat_payout_banker = Column(Float, default=1.95, nullable=False)
    baccarat_payout_tie = Column(Float, default=8.0, nullable=False)
    jackpot_enabled = Column(Boolean, default=False, nullable=False)
    jackpot_contrib_percent = Column(Float, default=0.0, nullable=False)
    jackpot_trigger_percent = Column(Float, default=0.0, nullable=False)  # 0~100
    jackpot_pool = Column(Float, default=0.0, nullable=False)
    updown_payout1 = Column(Float, default=7.0, nullable=False)
    updown_payout2 = Column(Float, default=5.0, nullable=False)
    updown_payout3 = Column(Float, default=4.0, nullable=False)
    updown_payout4 = Column(Float, default=3.0, nullable=False)
    updown_payout5 = Column(Float, default=2.0, nullable=False)
    updown_payout6 = Column(Float, default=0.0, nullable=False)
    updown_payout7 = Column(Float, default=0.0, nullable=False)
    updown_payout8 = Column(Float, default=0.0, nullable=False)
    updown_payout9 = Column(Float, default=0.0, nullable=False)
    updown_payout10 = Column(Float, default=0.0, nullable=False)
    slot_anim_step_ms = Column(Integer, default=60, nullable=False)
    slot_anim_steps1 = Column(Integer, default=24, nullable=False)
    slot_anim_steps2 = Column(Integer, default=34, nullable=False)
    slot_anim_steps3 = Column(Integer, default=48, nullable=False)
    slot_anim_stagger_ms = Column(Integer, default=0, nullable=False)
    slot_anim_extra_prob = Column(Float, default=0.2, nullable=False)
    slot_anim_extra_pct_min = Column(Float, default=0.0, nullable=False)
    slot_anim_extra_pct_max = Column(Float, default=0.1, nullable=False)
    slot_anim_smooth_strength = Column(Float, default=1.0, nullable=False)
    slot_anim_match_prob = Column(Float, default=1.0, nullable=False)
    slot_anim_match_min_pct = Column(Float, default=0.1, nullable=False)
    slot_anim_match_max_pct = Column(Float, default=0.4, nullable=False)
    slot_anim_match7_min_pct = Column(Float, default=0.3, nullable=False)
    slot_anim_match7_max_pct = Column(Float, default=0.6, nullable=False)
    slot_anim_extra25_prob = Column(Float, default=0.15, nullable=False)
    slot_anim_extra25_pct = Column(Float, default=0.25, nullable=False)
    slot_anim_smooth_threshold = Column(Float, default=0.25, nullable=False)
    bias_rules = Column(String, default="[]", nullable=False)  # JSON string
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class GlobalSetting(Base):
    __tablename__ = "global_settings"

    id = Column(Integer, primary_key=True, index=True)
    min_bet = Column(Integer, default=1, nullable=False)
    max_bet = Column(Integer, default=10000, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class GameLog(Base):
    __tablename__ = "game_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=True)
    user_name = Column(String, nullable=True)
    game_id = Column(String, nullable=True)
    action = Column(String, nullable=False)
    detail = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
