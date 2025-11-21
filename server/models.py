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
