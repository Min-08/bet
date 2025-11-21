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
    session_key = Column(String, index=True, nullable=False)
    game_id = Column(String, nullable=False)
    bet_amount = Column(Integer, nullable=False)
    bet_choice = Column(String, nullable=True)
    result = Column(String, nullable=False)
    payout_multiplier = Column(Float, nullable=False)
    payout_amount = Column(Float, nullable=False)
    detail = Column(String, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)


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
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
