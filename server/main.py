import uuid
import os
import secrets
import random
import time
import hmac
import hashlib
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Tuple

from fastapi import Depends, FastAPI, HTTPException, Request, Header
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from . import models, schemas
from .database import Base, SessionLocal, engine, get_db


BASE_DIR = Path(__file__).resolve().parent
WEBCLIENT_DIR = BASE_DIR.parent / "webclient"
KST = timezone(timedelta(hours=9))
GAME_LABELS: Dict[str, str] = {
    "updown": "업다운",
    "slot": "슬롯 머신",
    "baccarat": "바카라",
    "horse": "온라인 경마",
}
SECRET_KEY = os.environ.get("TOKEN_SECRET", "dev-secret")
ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "adminpass")
UPDOWN_STATE: Dict[int, dict] = {}
SLOT_PENDING: Dict[str, dict] = {}
BACCARAT_PENDING: Dict[str, dict] = {}
HORSE_PENDING: Dict[str, dict] = {}
HORSE_SESSIONS: Dict[str, dict] = {}
TOKEN_PREFIX = "Bearer "

# Horse race simulation constants (pure probability engine)
HORSE_TRACK_LENGTH = 1000.0
HORSE_DT = 1 / 60
HORSE_MAX_TICKS = 20000
HORSE_TIMELINE_INTERVAL = 0.2
HORSE_SEGMENTS = [
    (0.0, 0.40, "straight"),
    (0.40, 0.5, "corner"),
    (0.5, 0.90, "straight"),
    (0.90, 1.0, "corner"),
]
HORSE_LAPS = 2
HORSE_STAT_TOTAL = 300
HORSE_MIN_STAT = 20
HORSE_HEARTBEAT_TIMEOUT = 8  # seconds
OD_ALPHA = 0.15
OD_PHI = 0.35
OD_ETA_MIN = 1.0
OD_LAMBDA = 0.035
OD_RHO = 2.0
OD_MU = 0.6
OD_H_HALF = 1.5
HT_TWEAK = 0.15
SPD_K_SD = 0.45
ACC_K_A = 1.4
K_T = 1.2
K_C = 1.3
K_R = 1.4
SIGMA_MIN = 0.03
SIGMA_MAX = 0.25
NOISE_MAX = 0.05
BIAS_COOLDOWN_STATE: dict[str, float] = {}
HORSE_MAPS: Dict[str, dict] = {
    "oval": {
        "id": "oval",
        "name": "OVAL",
        "corner_count": 2,
        "weights": {"speed": 1.0, "accel": 0.9, "stamina": 0.5, "cornering": 0.6, "stability": -0.25},
        "wind_mean": 0.0,
        "wind_sigma": 0.08,
        "slope_profile": [(0.0, 0.25, 0.0), (0.25, 0.5, 0.01), (0.5, 0.75, -0.008), (0.75, 1.0, 0.0)],
    },
    # 향후 L/U 맵 추가 예정
}


def to_kst_str(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(KST).strftime("%Y-%m-%d %H:%M:%S")


def get_profit_totals(db: Session) -> Tuple[float, float, float]:
    game_total = (
        db.query(
            func.coalesce(
                func.sum(models.GameResult.bet_amount - models.GameResult.payout_amount),
                0.0,
            )
        ).scalar()
        or 0.0
    )
    adjustment_total = (
        db.query(func.coalesce(func.sum(models.FinancialAdjustment.amount), 0.0)).scalar()
        or 0.0
    )
    game_total = float(game_total)
    adjustment_total = float(adjustment_total)
    return game_total, adjustment_total, game_total + adjustment_total


def ensure_game_settings_columns() -> None:
    with engine.begin() as conn:
        existing_cols = {
            row[1]
            for row in conn.exec_driver_sql("PRAGMA table_info('game_settings')").fetchall()
        }
        migrations = []
        if "assist_enabled" not in existing_cols:
            migrations.append(
                "ALTER TABLE game_settings ADD COLUMN assist_enabled BOOLEAN NOT NULL DEFAULT 0"
            )
        if "assist_max_bet" not in existing_cols:
            migrations.append(
                "ALTER TABLE game_settings ADD COLUMN assist_max_bet INTEGER NOT NULL DEFAULT 50"
            )
        if "player_advantage_percent" not in existing_cols:
            migrations.append(
                "ALTER TABLE game_settings ADD COLUMN player_advantage_percent FLOAT NOT NULL DEFAULT 0.0"
            )
        if "min_bet" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN min_bet INTEGER NOT NULL DEFAULT 1")
        if "max_bet" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN max_bet INTEGER NOT NULL DEFAULT 10000")
        if "maintenance_mode" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN maintenance_mode BOOLEAN NOT NULL DEFAULT 0")
        if "slot_payout_triple_seven" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN slot_payout_triple_seven FLOAT NOT NULL DEFAULT 10.0")
        if "slot_payout_triple_same" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN slot_payout_triple_same FLOAT NOT NULL DEFAULT 5.0")
        if "slot_payout_double_same" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN slot_payout_double_same FLOAT NOT NULL DEFAULT 1.5")
        if "baccarat_payout_player" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN baccarat_payout_player FLOAT NOT NULL DEFAULT 2.0")
        if "baccarat_payout_banker" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN baccarat_payout_banker FLOAT NOT NULL DEFAULT 1.95")
        if "baccarat_payout_tie" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN baccarat_payout_tie FLOAT NOT NULL DEFAULT 8.0")
        if "jackpot_enabled" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN jackpot_enabled BOOLEAN NOT NULL DEFAULT 0")
        if "jackpot_contrib_percent" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN jackpot_contrib_percent FLOAT NOT NULL DEFAULT 0.0")
        if "jackpot_trigger_percent" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN jackpot_trigger_percent FLOAT NOT NULL DEFAULT 0.0")
        if "jackpot_pool" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN jackpot_pool FLOAT NOT NULL DEFAULT 0.0")
        if "updown_payout1" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN updown_payout1 FLOAT NOT NULL DEFAULT 7.0")
        if "updown_payout2" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN updown_payout2 FLOAT NOT NULL DEFAULT 5.0")
        if "updown_payout3" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN updown_payout3 FLOAT NOT NULL DEFAULT 4.0")
        if "updown_payout4" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN updown_payout4 FLOAT NOT NULL DEFAULT 3.0")
        if "updown_payout5" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN updown_payout5 FLOAT NOT NULL DEFAULT 2.0")
        if "updown_payout6" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN updown_payout6 FLOAT NOT NULL DEFAULT 0.0")
        if "updown_payout7" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN updown_payout7 FLOAT NOT NULL DEFAULT 0.0")
        if "updown_payout8" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN updown_payout8 FLOAT NOT NULL DEFAULT 0.0")
        if "updown_payout9" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN updown_payout9 FLOAT NOT NULL DEFAULT 0.0")
        if "updown_payout10" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN updown_payout10 FLOAT NOT NULL DEFAULT 0.0")
        if "slot_anim_step_ms" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN slot_anim_step_ms INTEGER NOT NULL DEFAULT 60")
        if "slot_anim_steps1" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN slot_anim_steps1 INTEGER NOT NULL DEFAULT 24")
        if "slot_anim_steps2" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN slot_anim_steps2 INTEGER NOT NULL DEFAULT 34")
        if "slot_anim_steps3" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN slot_anim_steps3 INTEGER NOT NULL DEFAULT 48")
        if "slot_anim_stagger_ms" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN slot_anim_stagger_ms INTEGER NOT NULL DEFAULT 0")
        if "slot_anim_extra_prob" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN slot_anim_extra_prob FLOAT NOT NULL DEFAULT 0.2")
        if "slot_anim_extra_pct_min" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN slot_anim_extra_pct_min FLOAT NOT NULL DEFAULT 0.0")
        if "slot_anim_extra_pct_max" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN slot_anim_extra_pct_max FLOAT NOT NULL DEFAULT 0.1")
        if "slot_anim_smooth_strength" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN slot_anim_smooth_strength FLOAT NOT NULL DEFAULT 1.0")
        if "slot_anim_match_prob" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN slot_anim_match_prob FLOAT NOT NULL DEFAULT 1.0")
        if "slot_anim_match_min_pct" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN slot_anim_match_min_pct FLOAT NOT NULL DEFAULT 0.1")
        if "slot_anim_match_max_pct" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN slot_anim_match_max_pct FLOAT NOT NULL DEFAULT 0.4")
        if "slot_anim_match7_min_pct" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN slot_anim_match7_min_pct FLOAT NOT NULL DEFAULT 0.3")
        if "slot_anim_match7_max_pct" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN slot_anim_match7_max_pct FLOAT NOT NULL DEFAULT 0.6")
        if "slot_anim_extra25_prob" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN slot_anim_extra25_prob FLOAT NOT NULL DEFAULT 0.15")
        if "slot_anim_extra25_pct" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN slot_anim_extra25_pct FLOAT NOT NULL DEFAULT 0.25")
        if "slot_anim_smooth_threshold" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN slot_anim_smooth_threshold FLOAT NOT NULL DEFAULT 0.25")
        if "bias_rules" not in existing_cols:
            migrations.append("ALTER TABLE game_settings ADD COLUMN bias_rules TEXT NOT NULL DEFAULT '[]'")
        if "user_id" not in existing_cols:
            try:
                conn.exec_driver_sql(
                    "ALTER TABLE game_results ADD COLUMN user_id INTEGER"
                )
            except Exception:
                pass
        for sql in migrations:
            conn.exec_driver_sql(sql)

        existing_cols_global = {
            row[1]
            for row in conn.exec_driver_sql("PRAGMA table_info('global_settings')").fetchall()
        }
        if not existing_cols_global:
            conn.exec_driver_sql(
                """
                CREATE TABLE IF NOT EXISTS global_settings (
                    id INTEGER PRIMARY KEY,
                    min_bet INTEGER NOT NULL DEFAULT 1,
                    max_bet INTEGER NOT NULL DEFAULT 10000,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )


def ensure_default_game_settings(db: Session) -> None:
    defaults = {
        "updown": {
            "risk_enabled": True,
            "risk_threshold": 1000,
            "casino_advantage_percent": 15.0,
            "assist_enabled": False,
            "assist_max_bet": 50,
            "player_advantage_percent": 0.0,
            "min_bet": 1,
            "max_bet": 10000,
            "maintenance_mode": False,
            "slot_payout_triple_seven": 10.0,
            "slot_payout_triple_same": 5.0,
            "slot_payout_double_same": 1.5,
            "baccarat_payout_player": 2.0,
            "baccarat_payout_banker": 1.95,
            "baccarat_payout_tie": 8.0,
            "jackpot_enabled": False,
            "jackpot_contrib_percent": 0.0,
            "jackpot_trigger_percent": 0.0,
            "jackpot_pool": 0.0,
            "updown_payout1": 7.0,
            "updown_payout2": 5.0,
            "updown_payout3": 4.0,
            "updown_payout4": 3.0,
            "updown_payout5": 2.0,
            "updown_payout6": 0.0,
            "updown_payout7": 0.0,
            "updown_payout8": 0.0,
            "updown_payout9": 0.0,
            "updown_payout10": 0.0,
            "slot_anim_step_ms": 60,
            "slot_anim_steps1": 24,
            "slot_anim_steps2": 34,
            "slot_anim_steps3": 48,
            "slot_anim_stagger_ms": 0,
            "slot_anim_extra_prob": 0.2,
            "slot_anim_extra_pct_min": 0.0,
            "slot_anim_extra_pct_max": 0.1,
            "slot_anim_smooth_strength": 1.0,
            "slot_anim_match_prob": 1.0,
            "slot_anim_match_min_pct": 0.1,
            "slot_anim_match_max_pct": 0.4,
            "slot_anim_match7_min_pct": 0.3,
            "slot_anim_match7_max_pct": 0.6,
            "slot_anim_extra25_prob": 0.15,
            "slot_anim_extra25_pct": 0.25,
            "slot_anim_smooth_threshold": 0.25,
            "bias_rules": "[]",
        },
        "slot": {
            "risk_enabled": True,
            "risk_threshold": 1000,
            "casino_advantage_percent": 15.0,
            "assist_enabled": False,
            "assist_max_bet": 50,
            "player_advantage_percent": 0.0,
            "min_bet": 1,
            "max_bet": 10000,
            "maintenance_mode": False,
            "slot_payout_triple_seven": 10.0,
            "slot_payout_triple_same": 5.0,
            "slot_payout_double_same": 1.5,
            "baccarat_payout_player": 2.0,
            "baccarat_payout_banker": 1.95,
            "baccarat_payout_tie": 8.0,
            "jackpot_enabled": False,
            "jackpot_contrib_percent": 0.0,
            "jackpot_trigger_percent": 0.0,
            "jackpot_pool": 0.0,
            "updown_payout1": 7.0,
            "updown_payout2": 5.0,
            "updown_payout3": 4.0,
            "updown_payout4": 3.0,
            "updown_payout5": 2.0,
            "updown_payout6": 0.0,
            "updown_payout7": 0.0,
            "updown_payout8": 0.0,
            "updown_payout9": 0.0,
            "updown_payout10": 0.0,
            "slot_anim_step_ms": 60,
            "slot_anim_steps1": 24,
            "slot_anim_steps2": 34,
            "slot_anim_steps3": 48,
            "slot_anim_stagger_ms": 0,
            "slot_anim_extra_prob": 0.2,
            "slot_anim_extra_pct_min": 0.0,
            "slot_anim_extra_pct_max": 0.1,
            "slot_anim_smooth_strength": 1.0,
            "slot_anim_match_prob": 1.0,
            "slot_anim_match_min_pct": 0.1,
            "slot_anim_match_max_pct": 0.4,
            "slot_anim_match7_min_pct": 0.3,
            "slot_anim_match7_max_pct": 0.6,
            "slot_anim_extra25_prob": 0.15,
            "slot_anim_extra25_pct": 0.25,
            "slot_anim_smooth_threshold": 0.25,
            "bias_rules": json.dumps(
                [
                    {
                        "id": "house-slot-default",
                        "enabled": True,
                        "direction": "house",
                        "probability": 0.2,
                        "games": ["slot"],
                        "priority": 1,
                        "bet_min": 1,
                        "bet_max": 10**12,
                    }
                ]
            ),
        },
        "baccarat": {
            "risk_enabled": True,
            "risk_threshold": 1000,
            "casino_advantage_percent": 20.0,
            "assist_enabled": False,
            "assist_max_bet": 50,
            "player_advantage_percent": 0.0,
            "min_bet": 1,
            "max_bet": 10000,
            "maintenance_mode": False,
            "slot_payout_triple_seven": 10.0,
            "slot_payout_triple_same": 5.0,
            "slot_payout_double_same": 1.5,
            "baccarat_payout_player": 2.0,
            "baccarat_payout_banker": 1.95,
            "baccarat_payout_tie": 8.0,
            "jackpot_enabled": False,
            "jackpot_contrib_percent": 0.0,
            "jackpot_trigger_percent": 0.0,
            "jackpot_pool": 0.0,
            "updown_payout1": 7.0,
            "updown_payout2": 5.0,
            "updown_payout3": 4.0,
            "updown_payout4": 3.0,
            "updown_payout5": 2.0,
            "updown_payout6": 0.0,
            "updown_payout7": 0.0,
            "updown_payout8": 0.0,
            "updown_payout9": 0.0,
            "updown_payout10": 0.0,
            "slot_anim_step_ms": 60,
            "slot_anim_steps1": 24,
            "slot_anim_steps2": 34,
            "slot_anim_steps3": 48,
            "slot_anim_stagger_ms": 0,
            "slot_anim_extra_prob": 0.2,
            "slot_anim_extra_pct_min": 0.0,
            "slot_anim_extra_pct_max": 0.1,
            "slot_anim_smooth_strength": 1.0,
            "slot_anim_match_prob": 1.0,
            "slot_anim_match_min_pct": 0.1,
            "slot_anim_match_max_pct": 0.4,
            "slot_anim_match7_min_pct": 0.3,
            "slot_anim_match7_max_pct": 0.6,
            "slot_anim_extra25_prob": 0.15,
            "slot_anim_extra25_pct": 0.25,
            "slot_anim_smooth_threshold": 0.25,
            "bias_rules": json.dumps(
                [
                    {
                        "id": "house-baccarat-default",
                        "enabled": True,
                        "direction": "house",
                        "probability": 0.2,
                        "games": ["baccarat"],
                        "priority": 1,
                        "bet_min": 1,
                        "bet_max": 10**12,
                    }
                ]
            ),
        },
        "horse": {
            "risk_enabled": True,
            "risk_threshold": 1000,
            "casino_advantage_percent": 0.0,
            "assist_enabled": False,
            "assist_max_bet": 50,
            "player_advantage_percent": 0.0,
            "min_bet": 1,
            "max_bet": 10000,
            "maintenance_mode": False,
            "slot_payout_triple_seven": 10.0,
            "slot_payout_triple_same": 5.0,
            "slot_payout_double_same": 1.5,
            "baccarat_payout_player": 2.0,
            "baccarat_payout_banker": 1.95,
            "baccarat_payout_tie": 8.0,
            "jackpot_enabled": False,
            "jackpot_contrib_percent": 0.0,
            "jackpot_trigger_percent": 0.0,
            "jackpot_pool": 0.0,
            "updown_payout1": 7.0,
            "updown_payout2": 5.0,
            "updown_payout3": 4.0,
            "updown_payout4": 3.0,
            "updown_payout5": 2.0,
            "updown_payout6": 0.0,
            "updown_payout7": 0.0,
            "updown_payout8": 0.0,
            "updown_payout9": 0.0,
            "updown_payout10": 0.0,
            "slot_anim_step_ms": 60,
            "slot_anim_steps1": 24,
            "slot_anim_steps2": 34,
            "slot_anim_steps3": 48,
            "slot_anim_stagger_ms": 0,
            "slot_anim_extra_prob": 0.2,
            "slot_anim_extra_pct_min": 0.0,
            "slot_anim_extra_pct_max": 0.1,
            "slot_anim_smooth_strength": 1.0,
            "slot_anim_match_prob": 1.0,
            "slot_anim_match_min_pct": 0.1,
            "slot_anim_match_max_pct": 0.4,
            "slot_anim_match7_min_pct": 0.3,
            "slot_anim_match7_max_pct": 0.6,
            "slot_anim_extra25_prob": 0.15,
            "slot_anim_extra25_pct": 0.25,
            "slot_anim_smooth_threshold": 0.25,
            "bias_rules": "[]",
        },
    }
    for game_id, cfg in defaults.items():
        existing = (
            db.query(models.GameSetting)
            .filter(models.GameSetting.game_id == game_id)
            .first()
        )
        if existing:
            # Backfill 기본 bias_rules가 비어 있을 경우만 채움
            if not existing.bias_rules or existing.bias_rules in ("[]", "null"):
                existing.bias_rules = cfg.get("bias_rules", "[]")
                db.add(existing)
            continue
        setting = models.GameSetting(
            game_id=game_id,
            risk_enabled=cfg["risk_enabled"],
            risk_threshold=cfg["risk_threshold"],
            casino_advantage_percent=cfg["casino_advantage_percent"],
            assist_enabled=cfg["assist_enabled"],
            assist_max_bet=cfg["assist_max_bet"],
            player_advantage_percent=cfg["player_advantage_percent"],
            min_bet=cfg["min_bet"],
            max_bet=cfg["max_bet"],
            maintenance_mode=cfg["maintenance_mode"],
            slot_payout_triple_seven=cfg["slot_payout_triple_seven"],
            slot_payout_triple_same=cfg["slot_payout_triple_same"],
            slot_payout_double_same=cfg["slot_payout_double_same"],
            baccarat_payout_player=cfg["baccarat_payout_player"],
            baccarat_payout_banker=cfg["baccarat_payout_banker"],
            baccarat_payout_tie=cfg["baccarat_payout_tie"],
            jackpot_enabled=cfg["jackpot_enabled"],
            jackpot_contrib_percent=cfg["jackpot_contrib_percent"],
            jackpot_trigger_percent=cfg["jackpot_trigger_percent"],
            jackpot_pool=cfg["jackpot_pool"],
            updown_payout1=cfg["updown_payout1"],
            updown_payout2=cfg["updown_payout2"],
            updown_payout3=cfg["updown_payout3"],
            updown_payout4=cfg["updown_payout4"],
            updown_payout5=cfg["updown_payout5"],
            updown_payout6=cfg.get("updown_payout6", 0.0),
            updown_payout7=cfg.get("updown_payout7", 0.0),
            updown_payout8=cfg.get("updown_payout8", 0.0),
            updown_payout9=cfg.get("updown_payout9", 0.0),
            updown_payout10=cfg.get("updown_payout10", 0.0),
            slot_anim_step_ms=cfg.get("slot_anim_step_ms", 60),
            slot_anim_steps1=cfg.get("slot_anim_steps1", 24),
            slot_anim_steps2=cfg.get("slot_anim_steps2", 34),
            slot_anim_steps3=cfg.get("slot_anim_steps3", 48),
            slot_anim_stagger_ms=cfg.get("slot_anim_stagger_ms", 0),
            slot_anim_extra_prob=cfg.get("slot_anim_extra_prob", 0.2),
            slot_anim_extra_pct_min=cfg.get("slot_anim_extra_pct_min", 0.0),
            slot_anim_extra_pct_max=cfg.get("slot_anim_extra_pct_max", 0.1),
            slot_anim_smooth_strength=cfg.get("slot_anim_smooth_strength", 1.0),
            slot_anim_match_prob=cfg.get("slot_anim_match_prob", 1.0),
            slot_anim_match_min_pct=cfg.get("slot_anim_match_min_pct", 0.1),
            slot_anim_match_max_pct=cfg.get("slot_anim_match_max_pct", 0.4),
            slot_anim_match7_min_pct=cfg.get("slot_anim_match7_min_pct", 0.3),
            slot_anim_match7_max_pct=cfg.get("slot_anim_match7_max_pct", 0.6),
            slot_anim_extra25_prob=cfg.get("slot_anim_extra25_prob", 0.15),
            slot_anim_extra25_pct=cfg.get("slot_anim_extra25_pct", 0.25),
            slot_anim_smooth_threshold=cfg.get("slot_anim_smooth_threshold", 0.25),
            bias_rules=cfg.get("bias_rules", "[]"),
        )
        db.add(setting)
    db.commit()


def log_game_event(
    db: Session,
    user: models.User | None,
    game_id: str | None,
    action: str,
    detail: dict | str,
    commit: bool = True,
) -> models.GameLog:
    detail_str = (
        json.dumps(detail, ensure_ascii=False) if isinstance(detail, (dict, list)) else str(detail)
    )
    log = models.GameLog(
        user_id=user.id if user else None,
        user_name=user.name if user else None,
        game_id=game_id,
        action=action,
        detail=detail_str,
    )
    db.add(log)
    if commit:
        db.commit()
    return log


def sign_token(user_id: int, expires_sec: int = 86400) -> str:
    ts = int(time.time())
    payload = f"{user_id}:{ts}:{ts+expires_sec}"
    sig = hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"


def verify_token(token: str) -> int:
    parts = token.split(":")
    if len(parts) != 4:
        raise HTTPException(status_code=401, detail="Invalid token")
    user_id, issued, expires, sig = parts
    try:
        user_id_int = int(user_id)
        exp_int = int(expires)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if exp_int < int(time.time()):
        raise HTTPException(status_code=401, detail="Token expired")
    raw = ":".join(parts[:3])
    expected = hmac.new(SECRET_KEY.encode(), raw.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise HTTPException(status_code=401, detail="Invalid token")
    return user_id_int


def get_current_user(
    authorization: str | None = Header(None), db: Session = Depends(get_db)
):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = authorization.split(" ", 1)[1]
    user_id = verify_token(token)
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    return user


def require_admin(admin_secret: str | None = Header(None)):
    if admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=401, detail="Admin unauthorized")


def get_global_limits(db: Session) -> tuple[int, int]:
    gs = db.query(models.GlobalSetting).filter(models.GlobalSetting.id == 1).first()
    if not gs:
        gs = models.GlobalSetting(id=1, min_bet=1, max_bet=10000)
        db.add(gs)
        db.commit()
        db.refresh(gs)
    return gs.min_bet, gs.max_bet


def enforce_bet_limits(
    game_setting: models.GameSetting, global_min: int, global_max: int, bet_amount: int
) -> None:
    effective_min = max(global_min, game_setting.min_bet)
    effective_max = min(global_max, game_setting.max_bet)
    if bet_amount > effective_max:
        raise HTTPException(status_code=400, detail="최대 베팅 한도입니다.")
    if bet_amount < effective_min:
        raise HTTPException(status_code=400, detail="최소 베팅 한도입니다.")
    if game_setting.maintenance_mode:
        raise HTTPException(status_code=400, detail="점검 중입니다.")

app = FastAPI(
    title="Virtual Probability Simulation",
    description="Educational betting simulation used for classroom exercises.",
)

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

app.mount(
    "/admin_static",
    StaticFiles(directory=str(BASE_DIR / "static")),
    name="admin_static",
)
app.mount(
    "/game_static",
    StaticFiles(directory=str(WEBCLIENT_DIR / "static")),
    name="game_static",
)


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_game_settings_columns()
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "INSERT OR IGNORE INTO global_settings (id, min_bet, max_bet) VALUES (1, 1, 10000)"
        )
    db = SessionLocal()
    try:
        ensure_default_game_settings(db)
    finally:
        db.close()


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    return RedirectResponse(url="/admin")


@app.get("/admin", include_in_schema=False)
def admin_dashboard(request: Request, db: Session = Depends(get_db)):
    sessions = (
        db.query(models.Session)
        .order_by(models.Session.created_at.desc())
        .limit(25)
        .all()
    )
    results = (
        db.query(models.GameResult)
        .order_by(models.GameResult.timestamp.desc())
        .limit(25)
        .all()
    )
    all_results = db.query(models.GameResult).all()

    def _format_kst(dt):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(KST).strftime("%m-%d %H:%M")

    for session in sessions:
        session.created_kst = _format_kst(session.created_at)
    for result in results:
        result.timestamp_kst = _format_kst(result.timestamp)

    game_stats: List[Dict[str, object]] = []
    stats_map: Dict[str, Dict[str, object]] = {}
    for row in all_results:
        stat = stats_map.setdefault(
            row.game_id,
            {
                "game_id": row.game_id,
                "game_name": GAME_LABELS.get(row.game_id, row.game_id),
                "total": 0,
                "player_wins": 0,
                "casino_wins": 0,
                "ties": 0,
                "profit": 0.0,
            },
        )
        stat["total"] += 1
        if row.result == "win":
            stat["player_wins"] += 1
        elif row.result == "lose":
            stat["casino_wins"] += 1
        else:
            stat["ties"] += 1
        stat["profit"] += row.bet_amount - row.payout_amount

    for stat in stats_map.values():
        contested = stat["player_wins"] + stat["casino_wins"]
        stat["player_win_rate"] = (
            (stat["player_wins"] / contested * 100) if contested else 0.0
        )
        stat["casino_win_rate"] = (
            (stat["casino_wins"] / contested * 100) if contested else 0.0
        )
        game_stats.append(stat)
    game_stats.sort(key=lambda item: item["game_name"])
    adjustments = (
        db.query(models.FinancialAdjustment)
        .order_by(models.FinancialAdjustment.created_at.desc())
        .limit(10)
        .all()
    )
    for adjustment in adjustments:
        adjustment.created_kst = _format_kst(adjustment.created_at)

    game_settings = (
        db.query(models.GameSetting)
        .order_by(models.GameSetting.game_id.asc())
        .all()
    )

    game_profit_total, adjustment_total, total_profit = get_profit_totals(db)

    return templates.TemplateResponse(
        "admin.html",
        {
            "request": request,
            "sessions": sessions,
            "results": results,
            "game_stats": game_stats,
            "adjustments": adjustments,
            "game_profit_total": game_profit_total,
            "adjustment_total": adjustment_total,
            "total_profit": total_profit,
        "game_settings": game_settings,
        "game_labels": GAME_LABELS,
    },
)


@app.get("/admin/settings", include_in_schema=False)
def admin_settings_page(request: Request):
    return templates.TemplateResponse(
        "settings.html",
        {"request": request},
    )


@app.get("/game", include_in_schema=False)
def game_client() -> FileResponse:
    game_page = WEBCLIENT_DIR / "index.html"
    if not game_page.exists():
        raise HTTPException(status_code=404, detail="Game client not found.")
    return FileResponse(game_page)


@app.get("/horse-verify", include_in_schema=False)
def horse_verify_page() -> FileResponse:
    page = BASE_DIR / "static" / "horse_verify.html"
    if not page.exists():
        raise HTTPException(status_code=404, detail="Verify page not found.")
    return FileResponse(page)


@app.post("/create_session", response_model=schemas.SessionResponse)
def create_session(
    payload: schemas.SessionCreate, db: Session = Depends(get_db), admin=Depends(require_admin)
) -> schemas.SessionResponse:
    session_key = uuid.uuid4().hex[:8]
    session = models.Session(
        session_key=session_key,
        game_id=payload.game_id,
        bet_amount=payload.bet_amount,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return schemas.SessionResponse(
        session_key=session.session_key,
        game_id=session.game_id,
        bet_amount=session.bet_amount,
    )


@app.post("/verify_key", response_model=schemas.VerifyKeyResponse)
def verify_key(
    payload: schemas.VerifyKeyRequest, db: Session = Depends(get_db)
) -> schemas.VerifyKeyResponse:
    session = (
        db.query(models.Session)
        .filter(models.Session.session_key == payload.session_key)
        .first()
    )
    if session is None:
        return schemas.VerifyKeyResponse(
            valid=False, message="세션 키가 존재하지 않습니다."
        )
    if session.used:
        return schemas.VerifyKeyResponse(
            valid=False, message="이미 사용된 세션 키입니다."
        )
    session.used = True
    db.add(session)
    db.commit()
    db.refresh(session)
    return schemas.VerifyKeyResponse(
        valid=True,
        message="OK",
        session_key=session.session_key,
        game_id=session.game_id,
        bet_amount=session.bet_amount,
    )


@app.post("/report_result")
def report_result(
    payload: schemas.ReportResultRequest, db: Session = Depends(get_db)
):
    session = (
        db.query(models.Session)
        .filter(models.Session.session_key == payload.session_key)
        .first()
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Session key not found.")
    if session.game_id != payload.game_id:
        raise HTTPException(
            status_code=400, detail="Game mismatch for session key."
        )
    if session.bet_amount != payload.bet_amount:
        raise HTTPException(
            status_code=400, detail="Bet amount mismatch for session."
        )
    existing_result = (
        db.query(models.GameResult)
        .filter(models.GameResult.session_key == payload.session_key)
        .first()
    )
    if existing_result:
        raise HTTPException(status_code=400, detail="Result already logged.")

    result = models.GameResult(
        session_key=payload.session_key,
        game_id=payload.game_id,
        bet_amount=payload.bet_amount,
        bet_choice=payload.bet_choice,
        result=payload.result,
        payout_multiplier=payload.payout_multiplier,
        payout_amount=payload.payout_amount,
        detail=payload.detail,
        timestamp=payload.timestamp,
    )

    db.add(result)
    db.commit()

    return {
        "message": "Result stored.",
        "session_key": payload.session_key,
        "result_id": result.id,
    }


@app.get("/sessions", response_model=List[schemas.SessionListItem])
def list_sessions(limit: int = 50, db: Session = Depends(get_db)):
    limit = min(limit, 200)
    sessions = (
        db.query(models.Session)
        .order_by(models.Session.created_at.desc())
        .limit(limit)
        .all()
    )
    return sessions


@app.get("/results", response_model=List[schemas.ResultListItem])
def list_results(limit: int = 50, db: Session = Depends(get_db)):
    limit = min(limit, 200)
    results = (
        db.query(models.GameResult)
        .order_by(models.GameResult.timestamp.desc())
        .limit(limit)
        .all()
    )
    return results


@app.post("/api/login", response_model=schemas.LoginResponse)
def api_login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = (
        db.query(models.User)
        .filter(models.User.name == payload.name, models.User.pin == payload.pin)
        .first()
    )
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = sign_token(user.id)
    return schemas.LoginResponse(
        token=token,
        user=schemas.UserItem(
            id=user.id, name=user.name, balance=user.balance, pin=user.pin
        ),
    )


@app.get("/api/me", response_model=schemas.MeResponse)
def api_me(current_user: models.User = Depends(get_current_user)):
    return schemas.MeResponse(
        id=current_user.id, name=current_user.name, balance=current_user.balance
    )


@app.post("/adjustments", response_model=schemas.AdjustmentResponse)
def create_adjustment(
    payload: schemas.AdjustmentCreate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    if payload.amount == 0:
        raise HTTPException(status_code=400, detail="Amount must be non-zero.")

    adjustment = models.FinancialAdjustment(
        amount=payload.amount,
        description=payload.description,
    )
    db.add(adjustment)
    db.commit()
    db.refresh(adjustment)

    _, _, total_profit = get_profit_totals(db)

    return schemas.AdjustmentResponse(
        id=adjustment.id,
        amount=adjustment.amount,
        description=adjustment.description,
        created_at=adjustment.created_at,
        total_profit=total_profit,
    )


@app.delete("/adjustments/{adjustment_id}")
def delete_adjustment(adjustment_id: int, db: Session = Depends(get_db)):
    adjustment = (
        db.query(models.FinancialAdjustment)
        .filter(models.FinancialAdjustment.id == adjustment_id)
        .first()
    )
    if adjustment is None:
        raise HTTPException(status_code=404, detail="Adjustment not found.")
    db.delete(adjustment)
    db.commit()
    _, _, total_profit = get_profit_totals(db)
    return {
        "message": "Adjustment deleted.",
        "total_profit": total_profit,
        "adjustment_id": adjustment_id,
    }


@app.delete("/sessions/{session_key}")
def delete_session(
    session_key: str, db: Session = Depends(get_db), admin=Depends(require_admin)
):
    session = (
        db.query(models.Session)
        .filter(models.Session.session_key == session_key)
        .first()
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Session key not found.")

    db.query(models.GameResult).filter(
        models.GameResult.session_key == session_key
    ).delete()
    db.delete(session)
    db.commit()

    game_profit_total, adjustment_total, total_profit = get_profit_totals(db)

    return {
        "message": "Session deleted",
        "session_key": session_key,
        "game_profit_total": game_profit_total,
        "adjustment_total": adjustment_total,
        "total_profit": total_profit,
    }


@app.delete("/reset")
def reset_database(db: Session = Depends(get_db), admin=Depends(require_admin)):
    deleted_results = db.query(models.GameResult).delete()
    deleted_sessions = db.query(models.Session).delete()
    db.commit()
    return {
        "message": "All session and result data removed.",
        "deleted_sessions": deleted_sessions,
        "deleted_results": deleted_results,
    }


@app.post("/api/admin/users", response_model=schemas.UserItem)
def admin_create_user(
    payload: schemas.UserCreate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    user = models.User(
        name=payload.name,
        pin=payload.pin,
        balance=payload.initial_balance,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return schemas.UserItem(id=user.id, name=user.name, balance=user.balance)


@app.get("/api/admin/users", response_model=List[schemas.UserItem])
def admin_list_users(
    search: str | None = None,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    query = db.query(models.User)
    if search:
        query = query.filter(models.User.name.contains(search))
    users = query.order_by(models.User.created_at.desc()).limit(200).all()
    return [
        schemas.UserItem(id=u.id, name=u.name, balance=u.balance, pin=u.pin)
        for u in users
    ]


@app.post("/api/admin/users/{user_id}/adjust_balance", response_model=schemas.UserItem)
def admin_adjust_balance(
    user_id: int,
    payload: schemas.AdjustBalanceRequest,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    before = user.balance
    user.balance += payload.delta
    user.updated_at = datetime.utcnow()
    db.add(
        models.Transaction(
            user_id=user.id,
            type="charge" if payload.delta >= 0 else "deduct",
            amount=payload.delta,
            before_balance=before,
            after_balance=user.balance,
            description=payload.reason,
        )
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return schemas.UserItem(id=user.id, name=user.name, balance=user.balance)


def process_game_result(
    db: Session,
    user: models.User,
    game_id: str,
    bet_amount: int,
    result: str,
    multiplier: float,
    detail: dict,
    bet_choice: str | None = None,
    payout_amount_override: float | None = None,
    charge_bet: bool = True,
):
    payout_amount = payout_amount_override if payout_amount_override is not None else bet_amount * multiplier
    if abs(multiplier - 1.5) < 1e-9 and payout_amount_override is None:
        payout_amount = math.ceil(payout_amount)
    if charge_bet:
        delta = int(round(payout_amount - bet_amount))
    else:
        delta = int(round(payout_amount))
    apply_balance_change(
        db,
        user,
        delta,
        description=f"game:{game_id}",
        game_type=game_id,
        result_type="game",
    )
    db.add(
        models.GameResult(
            user_id=user.id,
            session_key=str(uuid.uuid4()),
            game_id=game_id,
            bet_amount=bet_amount,
            bet_choice=bet_choice,
            result=result,
            payout_multiplier=multiplier,
            payout_amount=payout_amount,
            detail=str(detail),
            timestamp=datetime.utcnow(),
        )
    )
    log_game_event(
        db,
        user,
        game_id,
        "result",
        {
            "bet_amount": bet_amount,
            "result": result,
            "payout_multiplier": multiplier,
            "payout_amount": payout_amount,
            "detail": detail,
        },
        commit=False,
    )
    db.commit()
    db.refresh(user)
    return schemas.GameResponse(
        result=result,
        payout_multiplier=multiplier,
        payout_amount=payout_amount,
        delta=delta,
        balance=user.balance,
        detail=detail,
    )


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.query(models.Transaction).filter(models.Transaction.user_id == user_id).delete()
    db.query(models.GameResult).filter(models.GameResult.user_id == user_id).delete()
    db.delete(user)
    db.commit()
    return {"message": "deleted", "user_id": user_id}


@app.get("/api/admin/users/{user_id}/transactions", response_model=List[schemas.TransactionItem])
def admin_user_transactions(
    user_id: int,
    limit: int = 20,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    limit = min(limit, 200)
    txns = (
        db.query(models.Transaction)
        .filter(models.Transaction.user_id == user_id)
        .order_by(models.Transaction.created_at.desc())
        .limit(limit)
        .all()
    )
    return txns


@app.get("/api/admin/game_logs", response_model=List[schemas.GameLogItem])
def admin_game_logs(
    limit: int = 200,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    limit = min(limit, 500)
    logs = (
        db.query(models.GameLog)
        .order_by(models.GameLog.created_at.desc())
        .limit(limit)
        .all()
    )
    items = []
    for log in logs:
        items.append(
            schemas.GameLogItem(
                id=log.id,
                user_id=log.user_id,
                user_name=log.user_name,
                game_id=log.game_id,
                action=log.action,
                detail=log.detail,
                created_at=log.created_at,
                created_at_kst=to_kst_str(log.created_at),
            )
        )
    return items


@app.post("/api/game/updown", response_model=schemas.GameResponse)
def api_game_updown(
    payload: schemas.UpdownRequest, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if current_user.balance < payload.bet_amount:
        raise HTTPException(status_code=400, detail="잔액이 부족합니다.")
    setting = (
        db.query(models.GameSetting)
        .filter(models.GameSetting.game_id == "updown")
        .first()
    )
    if setting is None:
        raise HTTPException(status_code=400, detail="설정이 없습니다.")
    global_min, global_max = get_global_limits(db)
    enforce_bet_limits(setting, global_min, global_max, payload.bet_amount)
    payouts = [
        setting.updown_payout1,
        setting.updown_payout2,
        setting.updown_payout3,
        setting.updown_payout4,
        setting.updown_payout5,
        setting.updown_payout6,
        setting.updown_payout7,
        setting.updown_payout8,
        setting.updown_payout9,
        setting.updown_payout10,
    ]
    payouts = normalize_payouts(payouts)
    log_game_event(
        db,
        current_user,
        "updown",
        "auto_play",
        {"bet_amount": payload.bet_amount, "guesses": payload.guesses[:5]},
        commit=False,
    )
    result, multiplier, detail = play_updown_logic(payload.guesses, payouts)
    rules = parse_bias_rules(setting)
    bias_ctx = build_bias_context(db, current_user, "updown", payload.bet_amount, None)
    base_result = result
    result, multiplier, applied_rule = apply_bias("updown", payload.bet_amount, result, multiplier, rules, bias_ctx)
    if applied_rule:
        detail["bias_rule"] = applied_rule
    if applied_rule and result != base_result:
        last_guess = payload.guesses[-1] if payload.guesses else None
        detail = align_updown_detail(detail, result, last_guess)
    return process_game_result(
        db,
        current_user,
        "updown",
        payload.bet_amount,
        result,
        multiplier,
        detail,
    )


@app.post("/api/game/updown/start")
def api_game_updown_start(
    bet_amount: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if bet_amount <= 0:
        raise HTTPException(status_code=400, detail="베팅 포인트가 필요합니다.")
    if current_user.balance < bet_amount:
        raise HTTPException(status_code=400, detail="잔액이 부족합니다.")
    setting = (
        db.query(models.GameSetting)
        .filter(models.GameSetting.game_id == "updown")
        .first()
    )
    if setting is None:
        raise HTTPException(status_code=400, detail="설정이 없습니다.")
    global_min, global_max = get_global_limits(db)
    enforce_bet_limits(setting, global_min, global_max, bet_amount)
    payouts = [
        setting.updown_payout1,
        setting.updown_payout2,
        setting.updown_payout3,
        setting.updown_payout4,
        setting.updown_payout5,
        setting.updown_payout6,
        setting.updown_payout7,
        setting.updown_payout8,
        setting.updown_payout9,
        setting.updown_payout10,
    ]
    payouts = normalize_payouts(payouts)
    target = random.randint(1, 100)
    UPDOWN_STATE[current_user.id] = {
        "target": target,
        "attempts": 0,
        "guesses": [],
        "bet_amount": bet_amount,
        "payouts": payouts,
    }
    apply_balance_change(
        db,
        current_user,
        -bet_amount,
        description="game:updown:start",
        game_type="updown",
        result_type="game",
    )
    log_game_event(
        db,
        current_user,
        "updown",
        "start",
        {"bet_amount": bet_amount, "target": target},
    )
    db.commit()
    db.refresh(current_user)
    return {"message": "게임 시작", "remaining": len(payouts), "balance": current_user.balance}


@app.post("/api/game/updown/guess", response_model=schemas.GameResponse)
def api_game_updown_guess(
    payload: schemas.UpdownGuessRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    result_data, finished = play_updown_guess(current_user.id, payload.guess)
    detail = result_data["detail"]
    log_game_event(
        db,
        current_user,
        "updown",
        "guess",
        {
            "guess": payload.guess,
            "attempt": detail.get("attempts"),
            "hint": detail.get("hint"),
            "finished": finished,
        },
    )
    if finished:
        UPDOWN_STATE.pop(current_user.id, None)
        # Apply bias for final outcome
        setting = (
            db.query(models.GameSetting)
            .filter(models.GameSetting.game_id == "updown")
            .first()
        )
        rules = parse_bias_rules(setting) if setting else []
        bias_ctx = build_bias_context(db, current_user, "updown", result_data["bet_amount"], None)
        base_result = result_data["result"]
        adj_result, adj_multiplier, applied_rule = apply_bias(
            "updown",
            result_data["bet_amount"],
            result_data["result"],
            result_data["multiplier"],
            rules,
            bias_ctx,
        )
        if applied_rule:
            detail["bias_rule"] = applied_rule
        if applied_rule and adj_result != base_result:
            detail = align_updown_detail(detail, adj_result, payload.guess)
        return process_game_result(
            db,
            current_user,
            "updown",
            result_data["bet_amount"],
            adj_result,
            adj_multiplier,
            detail,
            charge_bet=False,
        )
    return schemas.GameResponse(
        result="pending",
        payout_multiplier=0,
        payout_amount=0,
        delta=0,
        balance=current_user.balance,
        detail=result_data["detail"],
    )


@app.post("/api/game/slot/start", response_model=schemas.GameResponse)
def api_game_slot_start(
    payload: schemas.SlotRequest, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if current_user.balance < payload.bet_amount:
        raise HTTPException(status_code=400, detail="잔액이 부족합니다.")
    setting = (
        db.query(models.GameSetting)
        .filter(models.GameSetting.game_id == "slot")
        .first()
    )
    if setting is None:
        raise HTTPException(status_code=400, detail="설정이 없습니다.")
    global_min, global_max = get_global_limits(db)
    enforce_bet_limits(setting, global_min, global_max, payload.bet_amount)
    # 진행 중 세션이 있으면 거부
    if any(p.get("user_id") == current_user.id for p in SLOT_PENDING.values()):
        raise HTTPException(status_code=400, detail="진행 중인 슬롯 게임이 있습니다.")
    apply_balance_change(
        db,
        current_user,
        -payload.bet_amount,
        description="game:slot:start",
        game_type="slot",
        result_type="game",
    )
    session_id = str(uuid.uuid4())
    SLOT_PENDING[session_id] = {
        "user_id": current_user.id,
        "bet_amount": payload.bet_amount,
        "created_at": datetime.utcnow(),
    }
    log_game_event(
        db,
        current_user,
        "slot",
        "start",
        {"bet_amount": payload.bet_amount, "session_id": session_id},
        commit=False,
    )
    db.commit()
    db.refresh(current_user)
    return schemas.GameResponse(
        result="pending",
        payout_multiplier=0.0,
        payout_amount=0.0,
        delta=-payload.bet_amount,
        balance=current_user.balance,
        detail={"session_id": session_id, "anim": build_slot_anim(setting)},
    )


@app.post("/api/game/slot/resolve", response_model=schemas.GameResponse)
def api_game_slot_resolve(
    payload: schemas.SessionResolveRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pending = SLOT_PENDING.get(payload.session_id)
    if not pending:
        raise HTTPException(status_code=400, detail="대기 중인 슬롯 게임이 없습니다.")
    if pending["user_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="본인의 게임만 완료할 수 있습니다.")
    bet_amount = pending["bet_amount"]
    setting = (
        db.query(models.GameSetting)
        .filter(models.GameSetting.game_id == "slot")
        .first()
    )
    if setting is None:
        raise HTTPException(status_code=400, detail="설정이 없습니다.")
    try:
        response = run_slot_round(db, current_user, setting, bet_amount, charge_bet=False)
    finally:
        SLOT_PENDING.pop(payload.session_id, None)
    return response


@app.post("/api/game/slot", response_model=schemas.GameResponse)
def api_game_slot(
    payload: schemas.SlotRequest, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if current_user.balance < payload.bet_amount:
        raise HTTPException(status_code=400, detail="잔액이 부족합니다.")
    setting = (
        db.query(models.GameSetting)
        .filter(models.GameSetting.game_id == "slot")
        .first()
    )
    if setting is None:
        raise HTTPException(status_code=400, detail="설정이 없습니다.")
    global_min, global_max = get_global_limits(db)
    enforce_bet_limits(setting, global_min, global_max, payload.bet_amount)
    return run_slot_round(db, current_user, setting, payload.bet_amount, charge_bet=True)


@app.post("/api/game/baccarat/start", response_model=schemas.GameResponse)
def api_game_baccarat_start(
    payload: schemas.BaccaratRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.balance < payload.bet_amount:
        raise HTTPException(status_code=400, detail="잔액이 부족합니다.")
    setting = (
        db.query(models.GameSetting)
        .filter(models.GameSetting.game_id == "baccarat")
        .first()
    )
    if setting is None:
        raise HTTPException(status_code=400, detail="설정이 없습니다.")
    setting_dict = {
        "maintenance_mode": bool(setting.maintenance_mode) if setting else False,
        "baccarat_payout_player": setting.baccarat_payout_player if setting else 2.0,
        "baccarat_payout_banker": setting.baccarat_payout_banker if setting else 1.95,
        "baccarat_payout_tie": setting.baccarat_payout_tie if setting else 8.0,
    }
    if setting_dict["maintenance_mode"]:
        raise HTTPException(status_code=400, detail="점검 중입니다.")
    gmin, gmax = get_global_limits(db)
    enforce_bet_limits(setting, gmin, gmax, payload.bet_amount)
    if any(p.get("user_id") == current_user.id for p in BACCARAT_PENDING.values()):
        raise HTTPException(status_code=400, detail="진행 중인 바카라 게임이 있습니다.")
    apply_balance_change(
        db,
        current_user,
        -payload.bet_amount,
        description="game:baccarat:start",
        game_type="baccarat",
        result_type="game",
    )
    session_id = str(uuid.uuid4())
    BACCARAT_PENDING[session_id] = {
        "user_id": current_user.id,
        "bet_amount": payload.bet_amount,
        "bet_choice": payload.bet_choice,
        "created_at": datetime.utcnow(),
    }
    log_game_event(
        db,
        current_user,
        "baccarat",
        "start",
        {"bet_amount": payload.bet_amount, "bet_choice": payload.bet_choice, "session_id": session_id},
        commit=False,
    )
    db.commit()
    db.refresh(current_user)
    return schemas.GameResponse(
        result="pending",
        payout_multiplier=0.0,
        payout_amount=0.0,
        delta=-payload.bet_amount,
        balance=current_user.balance,
        detail={"session_id": session_id, "bet_choice": payload.bet_choice},
    )


@app.post("/api/game/baccarat/resolve", response_model=schemas.GameResponse)
def api_game_baccarat_resolve(
    payload: schemas.SessionResolveRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pending = BACCARAT_PENDING.get(payload.session_id)
    if not pending:
        raise HTTPException(status_code=400, detail="대기 중인 바카라 게임이 없습니다.")
    if pending["user_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="본인의 게임만 완료할 수 있습니다.")
    bet_amount = pending["bet_amount"]
    bet_choice = pending["bet_choice"]
    setting = (
        db.query(models.GameSetting)
        .filter(models.GameSetting.game_id == "baccarat")
        .first()
    )
    if setting is None:
        raise HTTPException(status_code=400, detail="설정이 없습니다.")
    setting_dict = {
        "maintenance_mode": bool(setting.maintenance_mode) if setting else False,
        "baccarat_payout_player": setting.baccarat_payout_player if setting else 2.0,
        "baccarat_payout_banker": setting.baccarat_payout_banker if setting else 1.95,
        "baccarat_payout_tie": setting.baccarat_payout_tie if setting else 8.0,
    }
    if setting_dict["maintenance_mode"]:
        raise HTTPException(status_code=400, detail="점검 중입니다.")
    gmin, gmax = get_global_limits(db)
    enforce_bet_limits(setting, gmin, gmax, bet_amount)
    try:
        response = run_baccarat_round(db, current_user, setting_dict, bet_amount, bet_choice, charge_bet=False)
    finally:
        BACCARAT_PENDING.pop(payload.session_id, None)
    return response


@app.post("/api/game/baccarat", response_model=schemas.GameResponse)
def api_game_baccarat(
    payload: schemas.BaccaratRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.balance < payload.bet_amount:
        raise HTTPException(status_code=400, detail="잔액이 부족합니다.")
    setting = (
        db.query(models.GameSetting)
        .filter(models.GameSetting.game_id == "baccarat")
        .first()
    )
    if setting is None:
        raise HTTPException(status_code=400, detail="설정이 없습니다.")
    setting_dict = {
        "maintenance_mode": bool(setting.maintenance_mode) if setting else False,
        "baccarat_payout_player": setting.baccarat_payout_player if setting else 2.0,
        "baccarat_payout_banker": setting.baccarat_payout_banker if setting else 1.95,
        "baccarat_payout_tie": setting.baccarat_payout_tie if setting else 8.0,
    }
    if setting_dict["maintenance_mode"]:
        raise HTTPException(status_code=400, detail="점검 중입니다.")
    gmin, gmax = get_global_limits(db)
    enforce_bet_limits(setting, gmin, gmax, payload.bet_amount)
    return run_baccarat_round(db, current_user, setting_dict, payload.bet_amount, payload.bet_choice, charge_bet=True)


@app.get("/api/horse/history")
def api_horse_history(limit: int = 100, db: Session = Depends(get_db)):
    limit = min(max(limit, 1), 500)
    rows = (
        db.query(models.GameResult)
        .filter(models.GameResult.game_id == "horse")
        .order_by(models.GameResult.timestamp.desc())
        .limit(limit)
        .all()
    )
    history = []
    for r in rows:
        detail = r.detail if isinstance(r.detail, dict) else {}
        seed = detail.get("race_seed")
        winner_id = detail.get("winner_id")
        bet_choice = detail.get("bet_choice")
        history.append(
            {
                "id": r.id,
                "seed": seed,
                "winner_id": winner_id,
                "bet_choice": bet_choice,
                "bet_amount": r.bet_amount,
                "payout_amount": r.payout_amount,
                "result": r.result,
                "timestamp": r.timestamp,
            }
        )
    return {"history": history}


def _load_horse_result_by_id(db: Session, game_result_id: int) -> models.GameResult:
    row = (
        db.query(models.GameResult)
        .filter(models.GameResult.id == game_result_id, models.GameResult.game_id == "horse")
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="경마 기록을 찾을 수 없습니다.")
    return row


def _parse_detail(detail_raw):
    if isinstance(detail_raw, dict):
        return detail_raw
    try:
        return json.loads(detail_raw or "{}")
    except Exception:
        return {}


@app.get("/api/horse/replay/{game_result_id}")
def api_horse_replay(game_result_id: int, db: Session = Depends(get_db)):
    row = _load_horse_result_by_id(db, game_result_id)
    detail = _parse_detail(row.detail)
    return {
        "id": row.id,
        "seed": detail.get("race_seed"),
        "detail": detail,
        "bet_amount": row.bet_amount,
        "payout_amount": row.payout_amount,
        "result": row.result,
        "timestamp": row.timestamp,
    }


@app.get("/api/horse/replay/by-seed/{seed}")
def api_horse_replay_by_seed(seed: str, db: Session = Depends(get_db)):
    rows = (
        db.query(models.GameResult)
        .filter(models.GameResult.game_id == "horse")
        .order_by(models.GameResult.timestamp.desc())
        .limit(1000)
        .all()
    )
    for row in rows:
        detail = _parse_detail(row.detail)
        if str(detail.get("race_seed")) == str(seed):
            return {
                "id": row.id,
                "seed": detail.get("race_seed"),
                "detail": detail,
                "bet_amount": row.bet_amount,
                "payout_amount": row.payout_amount,
                "result": row.result,
                "timestamp": row.timestamp,
            }
    raise HTTPException(status_code=404, detail="해당 시드의 경마 기록을 찾을 수 없습니다.")


@app.post("/api/game/horse/start", response_model=schemas.GameResponse)
def api_game_horse_start(
    payload: schemas.HorseStartRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    raise HTTPException(status_code=410, detail="Deprecated endpoint. Use /api/horse/session/* APIs.")


# =========================
# New horse session workflow (fixed payout, client-side sim)
# =========================


def sweep_horse_sessions():
    now = datetime.utcnow()
    expired = []
    for sid, sess in list(HORSE_SESSIONS.items()):
        if sess.get("status") == "RUNNING":
            last = sess.get("last_heartbeat") or sess.get("created_at") or now
            if (now - last).total_seconds() > HORSE_HEARTBEAT_TIMEOUT:
                sess["status"] = "FORFEIT"
                sess["ended_at"] = now
                expired.append((sid, sess))
    return expired


def ensure_no_active_horse_session(user_id: int):
    for sess in HORSE_SESSIONS.values():
        if sess.get("user_id") == user_id and sess.get("status") in ("CREATED", "RUNNING"):
            raise HTTPException(status_code=400, detail="진행 중인 경마 세션이 있습니다.")


def smoothstep(edge0: float, edge1: float, t: float) -> float:
    u = min(1.0, max(0.0, (t - edge0) / (edge1 - edge0)))
    return u * u * (3 - 2 * u)


def eff_exp(raw: float, k: float) -> float:
    return 1 - math.exp(-k * raw)


@app.post("/api/horse/session/create", response_model=schemas.HorseSessionCreateResponse)
def api_horse_session_create(
    payload: schemas.HorseSessionCreateRequest,
    current_user: models.User = Depends(get_current_user),
):
    sweep_horse_sessions()
    ensure_no_active_horse_session(current_user.id)
    session_id = str(uuid.uuid4())
    seed = random.getrandbits(32)
    horses = generate_horse_pool(seed)
    map_type = "oval"
    now = datetime.utcnow()
    HORSE_SESSIONS[session_id] = {
        "user_id": current_user.id,
        "bet_amount": payload.bet_amount,
        "seed": seed,
        "horses": horses,
        "map_type": map_type,
        "track_length": HORSE_TRACK_LENGTH,
        "laps": HORSE_LAPS,
        "status": "CREATED",
        "created_at": now,
        "last_heartbeat": now,
        "selected_horse": None,
    }
    # 클라이언트에는 최소 정보만 노출 (id/name만 전달)
    horses_public = [{"id": h["id"], "name": h.get("name", h["id"])} for h in horses]
    return schemas.HorseSessionCreateResponse(
        session_id=session_id,
        seed=seed,
        horses=horses_public,
        track_length=HORSE_TRACK_LENGTH,
        laps=HORSE_LAPS,
        map_type=map_type,
        timeout_seconds=HORSE_HEARTBEAT_TIMEOUT,
    )


@app.post("/api/horse/session/lock")
def api_horse_session_lock(
    payload: schemas.HorseSessionLockRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sweep_horse_sessions()
    sess = HORSE_SESSIONS.get(payload.session_id)
    if not sess or sess.get("user_id") != current_user.id:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    if sess.get("status") not in ("CREATED",):
        raise HTTPException(status_code=400, detail="세션 상태가 올바르지 않습니다.")
    if payload.bet_amount != sess.get("bet_amount"):
        raise HTTPException(status_code=400, detail="베팅 금액이 세션과 일치하지 않습니다.")
    if current_user.balance < payload.bet_amount:
        raise HTTPException(status_code=400, detail="잔액이 부족합니다.")
    horse_ids = {h["id"] for h in sess.get("horses", [])}
    if payload.horse_id not in horse_ids:
        raise HTTPException(status_code=400, detail="선택한 말이 유효하지 않습니다.")

    # 차감
    apply_balance_change(
        db,
        current_user,
        -payload.bet_amount,
        description="horse:lock",
        game_type="horse",
        result_type="game",
    )
    db.commit()
    db.refresh(current_user)

    sess["status"] = "RUNNING"
    sess["selected_horse"] = payload.horse_id
    sess["last_heartbeat"] = datetime.utcnow()
    return {"status": "ok", "balance": current_user.balance}


@app.post("/api/horse/session/heartbeat")
def api_horse_session_heartbeat(
    payload: schemas.HorseSessionHeartbeatRequest,
    current_user: models.User = Depends(get_current_user),
):
    expired = sweep_horse_sessions()
    sess = HORSE_SESSIONS.get(payload.session_id)
    if not sess or sess.get("user_id") != current_user.id:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    if sess.get("status") == "RUNNING":
        sess["last_heartbeat"] = datetime.utcnow()
    return {"status": sess.get("status"), "expired": [sid for sid, _ in expired]}


@app.post("/api/horse/session/finish", response_model=schemas.GameResponse)
def api_horse_session_finish(
    payload: schemas.HorseSessionFinishRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sweep_horse_sessions()
    sess = HORSE_SESSIONS.get(payload.session_id)
    if not sess or sess.get("user_id") != current_user.id:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    if sess.get("status") != "RUNNING":
        raise HTTPException(status_code=400, detail="세션 상태가 올바르지 않습니다.")
    bet = sess.get("bet_amount", 0)
    chosen = sess.get("selected_horse")
    if not chosen:
        raise HTTPException(status_code=400, detail="말을 선택하지 않았습니다.")

    horses = sess.get("horses") or []
    map_type = sess.get("map_type", "oval")
    race_seed = sess.get("seed")
    winner_id, events, profile, sim_detail = run_horse_race(horses, map_type, race_seed)
    result = "win" if chosen == winner_id else "lose"
    payout_multiplier = 3.0 if result == "win" else 0.0
    payout_amount = bet * payout_multiplier

    delta = payout_amount
    if delta:
        apply_balance_change(
            db,
            current_user,
            delta,
            description="horse:finish",
            game_type="horse",
            result_type="game",
        )

    sess["status"] = "FINISHED"
    sess["ended_at"] = datetime.utcnow()
    horses_public = [
        {
            "id": h["id"],
            "name": h.get("name", h["id"]),
            "stats": h.get("stats"),
            "condition": sim_detail.get("conditions", {}).get(h["id"]),
        }
        for h in horses
    ]
    detail = {
        "session_id": payload.session_id,
        "horses": horses_public,
        "map_type": map_type,
        "map_name": profile.get("name", map_type) if isinstance(profile, dict) else map_type,
        "race_seed": race_seed,
        "winner_id": winner_id,
        "bet_choice": chosen,
        "events": events,
        "timeline": sim_detail.get("timeline"),
        "finish_times": sim_detail.get("finish_times"),
        "track_length": sim_detail.get("track_length", HORSE_TRACK_LENGTH),
        "laps": sim_detail.get("laps", HORSE_LAPS),
    }
    log_game_event(
        db,
        current_user,
        "horse",
        "finish",
        {**detail, "bet_amount": bet, "result": result},
        commit=False,
    )
    db.commit()
    db.refresh(current_user)
    return schemas.GameResponse(
        result=result,
        payout_multiplier=payout_multiplier,
        payout_amount=payout_amount,
        delta=delta,
        balance=current_user.balance,
        detail=detail,
    )


@app.post("/api/horse/session/forfeit")
def api_horse_session_forfeit(
    payload: schemas.HorseSessionForfeitRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sweep_horse_sessions()
    sess = HORSE_SESSIONS.get(payload.session_id)
    if not sess or sess.get("user_id") != current_user.id:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    if sess.get("status") in ("FINISHED", "FORFEIT"):
        return {"status": sess.get("status")}
    sess["status"] = "FORFEIT"
    sess["ended_at"] = datetime.utcnow()
    log_game_event(
        db,
        current_user,
        "horse",
        "forfeit",
        {"session_id": payload.session_id},
        commit=True,
    )
    return {"status": "FORFEIT"}


@app.post("/api/game/horse/resolve", response_model=schemas.GameResponse)
def api_game_horse_resolve(
    payload: schemas.HorseResolveRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    raise HTTPException(status_code=410, detail="Deprecated endpoint. Use /api/horse/session/* APIs.")


def apply_balance_change(
    db: Session,
    user: models.User,
    delta: int,
    description: str,
    game_type: str | None = None,
    result_type: str = "game",
):
    before = user.balance
    user.balance += delta
    user.updated_at = datetime.utcnow()
    db.add(
        models.Transaction(
            user_id=user.id,
            type=result_type,
            game_type=game_type,
            amount=delta,
            before_balance=before,
            after_balance=user.balance,
            description=description,
        )
    )
    db.add(user)


def normalize_payouts(payouts: List[float]) -> List[float]:
    """Trim payouts at the first non-positive entry to reflect available attempts."""
    normalized = []
    for p in payouts:
        if p <= 0:
            break
        normalized.append(p)
    return normalized


def generate_horse_pool(seed: int | None = None) -> List[dict]:
    """Generate 4 horses using fixed stat budget (sum=N) with constrained speed."""
    rng = random.Random(seed)
    horses = []
    total = HORSE_STAT_TOTAL
    min_stat = HORSE_MIN_STAT
    min_other_sum = 4 * min_stat
    # Base speed ensures >=50 and <=100, and spread <=30 using per-horse offset.
    base_speed = min(70, 50 + rng.randint(0, 20))
    for i in range(4):
        # Speed with max spread 30
        speed_offset = rng.randint(0, 30)
        speed_val = min(100, base_speed + speed_offset)
        # Ensure enough budget remains for other stats
        max_allowed_speed = total - min_other_sum
        if speed_val > max_allowed_speed:
            speed_val = max(max_allowed_speed, 50)
        remaining = total - speed_val
        extra = max(0, remaining - min_other_sum)
        cuts = sorted([rng.randint(0, extra) for _ in range(3)])
        portions = [
            cuts[0],
            cuts[1] - cuts[0],
            cuts[2] - cuts[1],
            extra - cuts[2],
        ]
        rng.shuffle(portions)
        stats = {
            "speed": speed_val,
            "accel": min_stat + portions[0],
            "stamina": min_stat + portions[1],
            "stability": min_stat + portions[2],
            "cornering": min_stat + portions[3],
        }
        horses.append({"id": f"h{i+1}", "name": f"Horse {i+1}", "stats": stats})
    return horses


def run_horse_race(
    horses: List[dict], map_key: str, seed: int | None = None
) -> tuple[str, list, dict, dict]:
    """
    Horse race engine (pure physics + stochastic events) per FINAL INTEGRATED SPEC.
    """
    rng = random.Random(seed)
    profile = HORSE_MAPS.get(map_key, HORSE_MAPS["oval"])
    finish_distance = HORSE_TRACK_LENGTH * HORSE_LAPS
    slope_profile = [
        (0.0, 0.25, 0.0),
        (0.25, 0.50, 0.01),
        (0.50, 0.75, -0.008),
        (0.75, 1.0, 0.0),
    ]
    wind_sigma = 0.08

    def in_corner(frac: float) -> bool:
        return any(
            seg_type == "corner" and start <= frac < end
            for start, end, seg_type in HORSE_SEGMENTS
        )

    def slope_at(frac: float) -> float:
        for start, end, slope in slope_profile:
            if start <= frac < end:
                return slope
        return 0.0

    def condition_factor(stability: int) -> float:
        R_eff = eff_exp(stability / 100, K_R)
        sigma = SIGMA_MIN + (SIGMA_MAX - SIGMA_MIN) * (1 - R_eff)
        z = rng.normalvariate(0, sigma)
        return math.exp(z)

    # Constants
    Vref = 15.0
    gamma = 2.2
    gamma2 = 2.6
    e0 = 0.015
    e1 = 0.035
    P0 = 8.0
    P1 = 10.0
    V0 = 14.0
    V1 = 6.0
    D0 = 0.010
    D1 = 0.0006
    Bc = 2.3
    KAPPA = 0.03
    eps = 1e-6
    ALAT0 = 2.0
    ALAT1 = 5.5
    H0 = 0.9
    Hdecay = 2.8

    traits = []
    for h in horses:
        stats = h.get("stats", {})
        heat_resist = 0.9 + 0.3 * rng.random()  # [0.9,1.2]
        recover_rate = 0.85 + 0.25 * rng.random()  # [0.85,1.1]
        luck = 0.8 + 0.4 * rng.random()  # [0.8,1.2]
        tactic_roll = rng.random()
        tactic = "front" if tactic_roll < 0.33 else "stalker" if tactic_roll < 0.66 else "closer"
        traits.append(
            {
                "horse_id": h["id"],
                "heat_resist": heat_resist,
                "recover_rate": recover_rate,
                "luck": luck,
                "tactic": tactic,
                "stats": stats,
            }
        )

    states = []
    for idx, (h, tr) in enumerate(zip(horses, traits)):
        stats = tr["stats"]
        F = condition_factor(stats.get("stability", HORSE_MIN_STAT))
        states.append(
            {
                "idx": idx,
                "horse_id": h["id"],
                "pos": 0.0,
                "v": 0.0,
                "stats": stats,
                "finished": False,
                "finish_time": math.inf,
                "condition": F,
                "E": 1.0,
                "H": 0.0,
                "trait": tr,
                "prev_event": None,
            }
        )

    timeline = []
    next_sample = 0.0
    t = 0.0
    events_flat = []

    def push_event(kind: str, st, magnitude: float, note: str):
        events_flat.append(
            {
                "t": round(t, 3),
                "horse_id": st["horse_id"],
                "kind": kind,
                "mag": magnitude,
                "note": note,
            }
        )

    while t < HORSE_MAX_TICKS * HORSE_DT:
        if all(st["finished"] for st in states):
            break

        wind = rng.normalvariate(0.0, wind_sigma)
        wind_factor = max(0.2, 1 + wind)

        # sort by position for slipstream/contact
        ordered = sorted(states, key=lambda s: (-s["pos"], s["horse_id"]))
        for rank, st in enumerate(ordered):
            st["rank"] = rank + 1

        for st in states:
            if st["finished"]:
                continue
            total_frac = st["pos"] / finish_distance
            lap_frac = (st["pos"] % HORSE_TRACK_LENGTH) / HORSE_TRACK_LENGTH
            in_cor = in_corner(lap_frac)
            slope = slope_at(lap_frac)

            stats = st["stats"]
            Sn = stats.get("speed", HORSE_MIN_STAT) / 100
            An = stats.get("accel", HORSE_MIN_STAT) / 100
            Tn = stats.get("stamina", HORSE_MIN_STAT) / 100
            Cn = stats.get("cornering", HORSE_MIN_STAT) / 100
            T_eff = eff_exp(Tn, K_T)
            C_eff = eff_exp(Cn, K_C)
            R_eff = eff_exp(stats.get("stability", HORSE_MIN_STAT) / 100, K_R)
            trait = st["trait"]
            heat_resist = trait["heat_resist"]
            recover_rate = trait["recover_rate"]
            luck = trait["luck"]

            # Target speed (profiling only)
            Vcap_base = V0 + V1 * math.sqrt(Sn)
            if trait["tactic"] == "front":
                target_v = Vcap_base * 0.90
                if total_frac > 0.65:
                    target_v *= 0.92
            elif trait["tactic"] == "stalker":
                target_v = Vcap_base * 0.85
                if total_frac > 0.50:
                    target_v *= 1.05
            else:  # closer
                target_v = Vcap_base * (0.75 + 0.15 * total_frac)

            # Speed cap & saturation
            Vcap = Vcap_base
            eta = 1.8 + 1.2 * (1 - An)
            sat = max(0.0, 1 - (st["v"] / max(Vcap, 1e-6)) ** eta)

            # Power
            Pmax = P0 + P1 * Sn
            P = Pmax * st["condition"] * (0.35 + 0.65 * st["E"])
            power_push = P * sat

            # Drag
            drag = (D0 * (st["v"] ** 2) + D1 * (st["v"] ** 3)) * wind_factor

            # Slipstream
            lead = next((s for s in ordered if s["pos"] > st["pos"] and (s["pos"] - st["pos"]) < 20), None)
            if lead:
                drag *= 0.9
                st["H"] += 0.01
                push_event("SLIP", st, 0.1, "슬립스트림")

            # Slope
            drag += 9.8 * slope * st["v"] / Vref

            # Events (Poisson)
            lambda_stumble = 0.003 * (1 + (1 - R_eff))
            if st["prev_event"] == "STUMBLE":
                lambda_stumble *= (1 + (1 - R_eff))
            p_stumble = 1 - math.exp(-lambda_stumble * HORSE_DT)
            if rng.random() < p_stumble:
                mag = rng.uniform(0.08, 0.18)
                power_push *= (1 - mag)
                st["v"] *= (1 - 0.5 * mag)
                st["prev_event"] = "STUMBLE"
                push_event("STUMBLE", st, mag, "stumble")
            else:
                st["prev_event"] = None

            p_boost = 1 - math.exp(-(0.0025 * luck) * HORSE_DT)
            if rng.random() < p_boost:
                mag = rng.uniform(0.04, 0.12)
                power_push *= (1 + mag)
                st["prev_event"] = "BOOST"
                push_event("BOOST", st, mag, "boost")

            if lead and (lead["pos"] - st["pos"]) < 6:
                p_contact = 1 - math.exp(-0.02 * HORSE_DT)
                if rng.random() < p_contact:
                    hit = rng.uniform(0.05, 0.15)
                    st["v"] *= (1 - hit)
                    st["prev_event"] = "CONTACT"
                    push_event("CONTACT", st, hit, "contact")

            # Corner braking
            kappa = KAPPA if in_cor else 0.0
            a_lat_max = ALAT0 + ALAT1 * (C_eff ** 1.1)
            a_lat_eff = a_lat_max / (1 + st["H"])
            v_corner_max = math.sqrt(a_lat_eff / max(kappa, eps)) if kappa > 0 else float("inf")
            corner_brake = Bc * (st["v"] - v_corner_max) ** 2 if st["v"] > v_corner_max else 0.0

            # Corner miss penalty
            if in_cor and v_corner_max < float("inf") and v_corner_max > 0:
                excess = (st["v"] - v_corner_max) / v_corner_max
                if excess > 0.25:
                    st["H"] += 0.15 * excess
                    st["v"] *= (1 - 0.08 * excess)
                    push_event("CORNER_MISS", st, excess, "corner miss")

            # Energy/heat drain
            speed_load = 1 + SPD_K_SD * Sn
            dE = (
                e0 * speed_load * ((st["v"] / Vref) ** gamma)
                + e1 * (1 if in_cor else 0) * ((st["v"] / Vref) ** gamma2) * (1 - 0.5 * T_eff)
            ) * HORSE_DT
            dH = (
                H0
                * (1 if in_cor else 0)
                * ((st["v"] / Vref) ** 2)
                * (1 - C_eff)
                * (1 + HT_TWEAK * (1 - T_eff))
                * HORSE_DT
            )

            # Overheat cap
            heat_cap = max(0.6, 1.0 - 0.2 * heat_resist)
            if st["H"] > heat_cap:
                power_push *= 0.75
                push_event("HEATCAP", st, st["H"], "heat cap")

            # Overdrive
            w_od = smoothstep(0.7, 0.9, total_frac)
            h_ratio = st["H"] / (st["H"] + OD_H_HALF)
            spurt_gate = max(0.35, min(1.0, 0.7 + 0.3 * st["E"] - 0.2 * h_ratio))
            iod = (
                w_od
                * max(0.0, min(1.0, 0.35 + 0.65 * T_eff - 0.3 * (1 - R_eff)))
                * smoothstep(0.12, 0.3, st["E"])
                * (1 - math.exp(-ACC_K_A * An))
                * spurt_gate
            )
            eta_eff = max(OD_ETA_MIN, eta * (1 - OD_PHI * iod))
            sat_eff = max(0.0, 1 - (st["v"] / max(Vcap, 1e-6)) ** eta_eff)
            # Preserve prior modifiers (events/heat cap) by scaling current push
            if sat > 1e-6:
                power_push *= (sat_eff / sat)
            else:
                power_push = P * sat_eff
            power_push *= (1 + OD_ALPHA * iod)
            dE += OD_LAMBDA * iod * (st["v"] / Vref) ** OD_RHO * HORSE_DT
            dH *= (1 + OD_MU * iod)

            # Recovery when slow
            if st["v"] < target_v * 0.6:
                dE *= 0.8 * recover_rate
                dH *= 0.8 * recover_rate

            st["E"] = min(1.0, max(0.0, st["E"] - dE))
            st["H"] = max(0.0, st["H"] + dH - Hdecay * st["H"] * HORSE_DT * heat_resist)

            # Acceleration
            a_val = power_push - drag - corner_brake
            st["v"] = max(0.0, st["v"] + a_val * HORSE_DT)
            st["pos"] += st["v"] * HORSE_DT
            if st["pos"] >= finish_distance:
                st["pos"] = finish_distance
                st["finished"] = True
                st["finish_time"] = t

        t += HORSE_DT
        if t >= next_sample:
            timeline.append(
                {
                    "t": round(t, 3),
                    "positions": [s["pos"] for s in states],
                    "speeds": [s["v"] for s in states],
                    "energy": [s["E"] for s in states],
                    "heat": [s["H"] for s in states],
                }
            )
            next_sample += HORSE_TIMELINE_INTERVAL

    # ensure all finish times are finite
    for st in states:
        if not math.isfinite(st["finish_time"]):
            st["finish_time"] = t

    winner_idx = min(range(len(states)), key=lambda i: (states[i]["finish_time"], states[i]["idx"]))
    winner_id = states[winner_idx]["horse_id"]
    finish_times = {s["horse_id"]: s["finish_time"] for s in states}

    sim_detail = {
        "timeline": timeline,
        "finish_times": finish_times,
        "laps": HORSE_LAPS,
        "track_length": HORSE_TRACK_LENGTH,
        "conditions": {s["horse_id"]: s["condition"] for s in states},
    }

    return winner_id, events_flat, profile, sim_detail


def estimate_horse_win_probs(horses: List[dict], sims: int = 200, seed: int | None = None) -> List[float]:
    rng = random.Random(seed)
    wins = [0 for _ in horses]
    for i in range(sims):
        sim_seed = rng.getrandbits(32)
        winner_id, _, _, _ = run_horse_race(horses, "oval", sim_seed)
        for idx, h in enumerate(horses):
            if h["id"] == winner_id:
                wins[idx] += 1
                break
    return [w / sims for w in wins]


def play_updown_logic(guesses: List[int], payouts: List[float] | None = None) -> tuple[str, float, dict]:
    target = random.randint(1, 100)
    payouts_full = payouts or [7, 5, 4, 3, 2, 0, 0, 0, 0, 0]
    payouts_eff = normalize_payouts(payouts_full)
    max_attempts = len(payouts_eff)
    detail = {"target": target, "guesses": guesses}
    multiplier = 0.0
    result = "lose"
    for idx, guess in enumerate(guesses[: max_attempts]):
        attempt = idx + 1
        if guess == target:
            result = "win"
            multiplier = payouts_eff[idx] if idx < max_attempts else 0
            break
    detail["attempts"] = len(guesses[: max_attempts])
    detail["max_attempts"] = max_attempts
    return result, multiplier, detail


def align_updown_detail(detail: dict, result: str, last_guess: int | None = None) -> dict:
    """Keep displayed target/hint consistent with final result after bias."""
    guesses = list(detail.get("guesses") or [])
    target = detail.get("target")
    attempts = detail.get("attempts", len(guesses))
    hint = detail.get("hint")
    lg = last_guess if last_guess is not None else (guesses[-1] if guesses else None)
    if result == "win":
        # Force a matching guess
        if lg is None and guesses:
            lg = guesses[-1]
        if lg is not None:
            target = lg
            if guesses:
                guesses[-1] = lg
            else:
                guesses.append(lg)
            hint = "CORRECT"
        detail.update({"target": target, "guesses": guesses, "attempts": attempts, "hint": hint})
    else:  # lose
        if lg is not None and target == lg:
            # pick a target not guessed
            for t in range(1, 101):
                if t != lg and t not in guesses:
                    target = t
                    break
        if hint is not None and lg is not None:
            if target > lg:
                hint = "UP"
            elif target < lg:
                hint = "DOWN"
            else:
                hint = "DOWN"
        detail.update({"target": target, "guesses": guesses, "attempts": attempts, "hint": hint})
    return detail


def play_updown_guess(user_id: int, guess: int) -> tuple[dict, bool]:
    state = UPDOWN_STATE.get(user_id)
    if not state:
        raise HTTPException(status_code=400, detail="게임을 시작해주세요.")
    target = state["target"]
    state["attempts"] += 1
    state["guesses"].append(guess)
    attempts = state["attempts"]
    finished = False
    result = "continue"
    multiplier = 0.0
    payouts = state.get("payouts") or [7, 5, 4, 3, 2, 0, 0, 0, 0, 0]
    hint = "UP" if guess < target else "DOWN" if guess > target else "CORRECT"
    if guess == target:
        finished = True
        result = "win"
        if attempts == 1:
            multiplier = payouts[0]
        elif attempts == 2:
            multiplier = payouts[1]
        elif attempts == 3:
            multiplier = payouts[2]
        elif attempts == 4:
            multiplier = payouts[3]
        elif attempts == 5:
            multiplier = payouts[4]
        elif attempts == 6:
            multiplier = payouts[5]
        elif attempts == 7:
            multiplier = payouts[6]
        elif attempts == 8:
            multiplier = payouts[7]
        elif attempts == 9:
            multiplier = payouts[8]
        elif attempts == 10:
            multiplier = payouts[9]
    elif attempts >= len(payouts):
        finished = True
        result = "lose"
        multiplier = 0.0
    detail = {
        "target": target,
        "guesses": list(state["guesses"]),
        "attempts": attempts,
        "hint": hint,
        "max_attempts": len(payouts),
    }
    return {
        "result": result,
        "multiplier": multiplier,
        "detail": detail,
        "bet_amount": state["bet_amount"],
        "finished": finished,
    }, finished


def play_slot_logic(
    setting: models.GameSetting, bet_amount: int, db: Session
) -> tuple[str, float, dict, float | None]:
    symbols = [random.choice(["A", "B", "C", "D", "7"]) for _ in range(3)]
    if symbols.count("7") == 3:
        multiplier = setting.slot_payout_triple_seven
    elif len(set(symbols)) == 1:
        multiplier = setting.slot_payout_triple_same
    elif len(set(symbols)) == 2:
        multiplier = setting.slot_payout_double_same
    else:
        multiplier = 0
    jackpot_win = False
    jackpot_amount = 0.0
    if setting.jackpot_enabled and bet_amount > 0 and setting.jackpot_trigger_percent > 0:
        contrib = bet_amount * (setting.jackpot_contrib_percent / 100.0)
        setting.jackpot_pool += contrib
        db.add(setting)
        if random.random() < (setting.jackpot_trigger_percent / 100.0):
            jackpot_win = True
            jackpot_amount = setting.jackpot_pool
            setting.jackpot_pool = 0.0
            db.add(setting)
    result = "win" if multiplier > 0 or jackpot_win else "lose"
    total_payout = bet_amount * multiplier + jackpot_amount
    detail = {"symbols": symbols, "jackpot_win": jackpot_win, "jackpot_amount": jackpot_amount, "pool": setting.jackpot_pool}
    payout_override = total_payout if jackpot_win else None
    return result, float(multiplier), detail, payout_override


def parse_bias_rules(setting: models.GameSetting) -> list[dict]:
    if isinstance(setting.bias_rules, list):
        return setting.bias_rules
    try:
        rules = json.loads(setting.bias_rules or "[]")
        if isinstance(rules, list):
            return rules
    except Exception:
        pass
    return []


def get_user_streak(db: Session, user_id: int, game_id: str, lookback: int = 50) -> tuple[int, int]:
    """Return consecutive win/lose streak counts for the user/game."""
    win_streak = 0
    lose_streak = 0
    results = (
        db.query(models.GameResult)
        .filter(models.GameResult.user_id == user_id, models.GameResult.game_id == game_id)
        .order_by(models.GameResult.timestamp.desc())
        .limit(lookback)
        .all()
    )
    for res in results:
        if res.result == "win":
            if lose_streak > 0:
                break
            win_streak += 1
        elif res.result == "lose":
            if win_streak > 0:
                break
            lose_streak += 1
        else:
            break
    return win_streak, lose_streak


def get_recent_rtp(db: Session, game_id: str, window: int = 100) -> float | None:
    rows = (
        db.query(models.GameResult)
        .filter(models.GameResult.game_id == game_id)
        .order_by(models.GameResult.timestamp.desc())
        .limit(window)
        .all()
    )
    total_bet = sum(r.bet_amount for r in rows)
    total_payout = sum(r.payout_amount for r in rows)
    if total_bet <= 0:
        return None
    return float(total_payout) / float(total_bet)


def build_bias_context(db: Session, user: models.User, game_id: str, bet_amount: int, bet_choice: str | None) -> dict:
    win_streak, lose_streak = get_user_streak(db, user.id, game_id)
    rtp_recent = get_recent_rtp(db, game_id)
    return {
        "user_id": user.id,
        "game_id": game_id,
        "bet_amount": bet_amount,
        "bet_choice": bet_choice,
        "win_streak": win_streak,
        "lose_streak": lose_streak,
        "rtp_recent": rtp_recent,
    }


def build_slot_anim(setting: models.GameSetting) -> dict:
    return {
        "step_ms": setting.slot_anim_step_ms,
        "steps1": setting.slot_anim_steps1,
        "steps2": setting.slot_anim_steps2,
        "steps3": setting.slot_anim_steps3,
        "stagger_ms": setting.slot_anim_stagger_ms,
        "extra_prob": setting.slot_anim_extra_prob,
        "extra_pct_min": setting.slot_anim_extra_pct_min,
        "extra_pct_max": setting.slot_anim_extra_pct_max,
        "smooth_strength": setting.slot_anim_smooth_strength,
        "match_prob": setting.slot_anim_match_prob,
        "match_min_pct": setting.slot_anim_match_min_pct,
        "match_max_pct": setting.slot_anim_match_max_pct,
        "match7_min_pct": setting.slot_anim_match7_min_pct,
        "match7_max_pct": setting.slot_anim_match7_max_pct,
        "extra25_prob": setting.slot_anim_extra25_prob,
        "extra25_pct": setting.slot_anim_extra25_pct,
        "smooth_threshold": setting.slot_anim_smooth_threshold,
    }


def run_slot_round(
    db: Session,
    current_user: models.User,
    setting: models.GameSetting,
    bet_amount: int,
    charge_bet: bool = True,
) -> schemas.GameResponse:
    result, multiplier, detail, payout_override = play_slot_logic(setting, bet_amount, db)
    base_result = result
    rules = parse_bias_rules(setting)
    bias_ctx = build_bias_context(db, current_user, "slot", bet_amount, None)
    result, multiplier, applied_rule = apply_bias("slot", bet_amount, result, multiplier, rules, bias_ctx)
    if applied_rule:
        detail["bias_rule"] = applied_rule
    if applied_rule and result != base_result:
        payout_override = None
        if result == "lose":
            detail["symbols"] = ["A", "B", "C"]
            detail["jackpot_win"] = False
            detail["jackpot_amount"] = 0.0
            multiplier = 0.0
        else:  # forced win
            final_symbols = ["A", "A", "B"]
            final_multiplier = max(multiplier, setting.slot_payout_double_same)
            if final_multiplier >= setting.slot_payout_triple_seven:
                final_symbols = ["7", "7", "7"]
                final_multiplier = setting.slot_payout_triple_seven
            elif final_multiplier >= setting.slot_payout_triple_same:
                final_symbols = ["A", "A", "A"]
                final_multiplier = setting.slot_payout_triple_same
            multiplier = final_multiplier
            detail["symbols"] = final_symbols
            detail["jackpot_win"] = False
            detail["jackpot_amount"] = 0.0
    detail["anim"] = build_slot_anim(setting)
    log_game_event(
        db,
        current_user,
        "slot",
        "play",
        {"bet_amount": bet_amount, "anim": detail.get("anim", {}), "bias_rule": detail.get("bias_rule")},
        commit=False,
    )
    return process_game_result(
        db,
        current_user,
        "slot",
        bet_amount,
        result,
        multiplier,
        detail,
        payout_amount_override=payout_override,
        charge_bet=charge_bet,
    )


def run_baccarat_round(
    db: Session,
    current_user: models.User,
    setting_dict: dict,
    bet_amount: int,
    bet_choice: str,
    charge_bet: bool = True,
) -> schemas.GameResponse:
    base_result, multiplier, detail = play_baccarat_logic(bet_choice, setting_dict, None)
    setting_obj = (
        db.query(models.GameSetting)
        .filter(models.GameSetting.game_id == "baccarat")
        .first()
    )
    rules = parse_bias_rules(setting_obj) if setting_obj else []
    bias_ctx = build_bias_context(db, current_user, "baccarat", bet_amount, bet_choice)
    result, multiplier, applied_rule = apply_bias("baccarat", bet_amount, base_result, multiplier, rules, bias_ctx)
    if applied_rule and result != base_result:
        target_outcome = None
        if result == "lose":
            if bet_choice == "player":
                target_outcome = "banker"
            elif bet_choice == "banker":
                target_outcome = "player"
            else:
                target_outcome = "player"
        elif result == "win":
            target_outcome = bet_choice
        if target_outcome:
            result, multiplier, detail = play_baccarat_logic(
                bet_choice, setting_dict, target_outcome
            )
    detail["bet_choice"] = bet_choice
    if applied_rule:
        detail["bias_rule"] = applied_rule
    return process_game_result(
        db,
        current_user,
        "baccarat",
        bet_amount,
        result,
        multiplier,
        detail,
        bet_choice=bet_choice,
        charge_bet=charge_bet,
    )


def apply_bias(
    game_id: str,
    bet_amount: int,
    result: str,
    multiplier: float,
    rules: list[dict],
    context: dict,
) -> tuple[str, float, dict]:
    applied_rule = None
    now_ts = time.time()
    sorted_rules = sorted(rules, key=lambda r: r.get("priority", 0), reverse=True)
    for rule in sorted_rules:
        if not rule.get("enabled", True):
            continue
        games = rule.get("games")
        if games and game_id not in games:
            continue
        bet_min = rule.get("bet_min", 0)
        bet_max = rule.get("bet_max", 10**12)
        if bet_amount < bet_min or bet_amount > bet_max:
            continue
        choice_in = rule.get("bet_choices")
        if choice_in and context.get("bet_choice") not in choice_in:
            continue
        streak_win = rule.get("streak_win_at_least", 0)
        streak_lose = rule.get("streak_lose_at_least", 0)
        if streak_win and context.get("win_streak", 0) < streak_win:
            continue
        if streak_lose and context.get("lose_streak", 0) < streak_lose:
            continue
        target_rtp = rule.get("target_rtp")
        rtp_recent = context.get("rtp_recent")
        direction = rule.get("direction")
        if direction not in ("house", "player"):
            continue
        if target_rtp is not None and rtp_recent is not None:
            if direction == "house" and rtp_recent <= target_rtp:
                continue
            if direction == "player" and rtp_recent >= target_rtp:
                continue
        cooldown = rule.get("cooldown_sec", 0)
        rule_id = str(rule.get("id") or rule.get("name") or hash(json.dumps(rule, sort_keys=True)))
        last_applied = BIAS_COOLDOWN_STATE.get(rule_id, 0)
        if cooldown and now_ts - last_applied < cooldown:
            continue
        prob = float(rule.get("probability", rule.get("weight", 0)))
        if prob <= 0:
            continue
        if random.random() >= prob:
            continue
        applied_rule = rule | {"rule_id": rule_id}
        if direction == "house" and result == "win":
            result = "lose"
            multiplier = 0.0
        elif direction == "player" and result == "lose":
            result = "win"
            multiplier = rule.get("win_multiplier", max(multiplier, 1.0))
        BIAS_COOLDOWN_STATE[rule_id] = now_ts
        break
    return result, multiplier, applied_rule or {}


def baccarat_draw_card(deck: List[dict]) -> dict:
    if not deck:
        raise RuntimeError("Deck exhausted")
    return deck.pop()


def play_baccarat_logic(
    bet_choice: str, setting: dict, target_outcome: str | None = None
) -> tuple[str, float, dict]:
    suits = ["♠", "♥", "♦", "♣"]
    ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
    val = {
        "A": 1,
        "2": 2,
        "3": 3,
        "4": 4,
        "5": 5,
        "6": 6,
        "7": 7,
        "8": 8,
        "9": 9,
        "10": 0,
        "J": 0,
        "Q": 0,
        "K": 0,
    }

    def run_round():
        deck = []
        for _ in range(2):
            for suit in suits:
                for rank in ranks:
                    deck.append({"suit": suit, "rank": rank, "value": val[rank]})
        random.shuffle(deck)

        def hand_value(hand):
            return sum(c["value"] for c in hand) % 10

        player_hand = [baccarat_draw_card(deck), baccarat_draw_card(deck)]
        banker_hand = [baccarat_draw_card(deck), baccarat_draw_card(deck)]

        player_value = hand_value(player_hand)
        banker_value = hand_value(banker_hand)
        player_third = None
        banker_third = None

        if not (player_value >= 8 or banker_value >= 8):
            if player_value <= 5:
                player_third = baccarat_draw_card(deck)
                player_hand.append(player_third)
                player_value = hand_value(player_hand)
            player_third_value = player_third["value"] if player_third else None
            if player_third is None:
                if banker_value <= 5:
                    banker_third = baccarat_draw_card(deck)
                    banker_hand.append(banker_third)
                    banker_value = hand_value(banker_hand)
            else:
                draw = False
                if banker_value <= 2:
                    draw = True
                elif banker_value == 3 and player_third_value != 8:
                    draw = True
                elif banker_value == 4 and player_third_value in [2, 3, 4, 5, 6, 7]:
                    draw = True
                elif banker_value == 5 and player_third_value in [4, 5, 6, 7]:
                    draw = True
                elif banker_value == 6 and player_third_value in [6, 7]:
                    draw = True
                if draw:
                    banker_third = baccarat_draw_card(deck)
                    banker_hand.append(banker_third)
                    banker_value = hand_value(banker_hand)

        if player_value > banker_value:
            outcome = "player"
        elif banker_value > player_value:
            outcome = "banker"
        else:
            outcome = "tie"

        return outcome, player_hand, banker_hand, player_value, banker_value

    outcome = None
    player_hand = banker_hand = []
    player_value = banker_value = 0
    for _ in range(200):
        outcome, player_hand, banker_hand, player_value, banker_value = run_round()
        if target_outcome is None or outcome == target_outcome:
            break

    payout_player = setting.get("baccarat_payout_player", 2.0)
    payout_banker = setting.get("baccarat_payout_banker", 1.95)
    payout_tie = setting.get("baccarat_payout_tie", 8.0)

    multiplier = 0.0
    result = "lose"
    if bet_choice == "tie":
        if outcome == "tie":
            multiplier = payout_tie
            result = "win"
        else:
            result = "lose"
    elif bet_choice == "player":
        if outcome == "player":
            multiplier = payout_player
            result = "win"
        else:
            result = "lose"
    else:  # banker bet
        if outcome == "banker":
            multiplier = payout_banker
            result = "win"
        else:
            result = "lose"

    detail = {
        "player_hand": [f"{c['suit']}{c['rank']}" for c in player_hand],
        "banker_hand": [f"{c['suit']}{c['rank']}" for c in banker_hand],
        "player_value": player_value,
        "banker_value": banker_value,
        "outcome": outcome,
    }
    return result, multiplier, detail


@app.get("/game_settings", response_model=List[schemas.GameSettingItem])
def get_game_settings(db: Session = Depends(get_db), admin=Depends(require_admin)):
    settings = (
        db.query(models.GameSetting).order_by(models.GameSetting.game_id.asc()).all()
    )
    for s in settings:
        if isinstance(s.bias_rules, str):
            try:
                s.bias_rules = json.loads(s.bias_rules)
            except Exception:
                s.bias_rules = []
    return settings


@app.post("/game_settings", response_model=List[schemas.GameSettingItem])
def update_game_settings(
    payload: schemas.GameSettingsUpdate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    updated_items: List[models.GameSetting] = []
    for item in payload.settings:
        setting = (
            db.query(models.GameSetting)
            .filter(models.GameSetting.game_id == item.game_id)
            .first()
        )
        if setting is None:
            setting = models.GameSetting(game_id=item.game_id)
            db.add(setting)
        setting.risk_enabled = item.risk_enabled
        setting.risk_threshold = item.risk_threshold
        setting.casino_advantage_percent = item.casino_advantage_percent
        setting.assist_enabled = item.assist_enabled
        setting.assist_max_bet = item.assist_max_bet
        setting.player_advantage_percent = item.player_advantage_percent
        setting.min_bet = item.min_bet
        setting.max_bet = item.max_bet
        setting.maintenance_mode = item.maintenance_mode
        setting.slot_payout_triple_seven = item.slot_payout_triple_seven
        setting.slot_payout_triple_same = item.slot_payout_triple_same
        setting.slot_payout_double_same = item.slot_payout_double_same
        setting.baccarat_payout_player = item.baccarat_payout_player
        setting.baccarat_payout_banker = item.baccarat_payout_banker
        setting.baccarat_payout_tie = item.baccarat_payout_tie
        setting.jackpot_enabled = item.jackpot_enabled
        setting.jackpot_contrib_percent = item.jackpot_contrib_percent
        setting.jackpot_trigger_percent = item.jackpot_trigger_percent
        setting.jackpot_pool = item.jackpot_pool
        setting.updown_payout1 = item.updown_payout1
        setting.updown_payout2 = item.updown_payout2
        setting.updown_payout3 = item.updown_payout3
        setting.updown_payout4 = item.updown_payout4
        setting.updown_payout5 = item.updown_payout5
        setting.updown_payout6 = item.updown_payout6
        setting.updown_payout7 = item.updown_payout7
        setting.updown_payout8 = item.updown_payout8
        setting.updown_payout9 = item.updown_payout9
        setting.updown_payout10 = item.updown_payout10
        setting.slot_anim_step_ms = item.slot_anim_step_ms
        setting.slot_anim_steps1 = item.slot_anim_steps1
        setting.slot_anim_steps2 = item.slot_anim_steps2
        setting.slot_anim_steps3 = item.slot_anim_steps3
        setting.slot_anim_stagger_ms = item.slot_anim_stagger_ms
        setting.slot_anim_extra_prob = item.slot_anim_extra_prob
        setting.slot_anim_extra_pct_min = item.slot_anim_extra_pct_min
        setting.slot_anim_extra_pct_max = item.slot_anim_extra_pct_max
        setting.slot_anim_smooth_strength = item.slot_anim_smooth_strength
        setting.slot_anim_match_prob = item.slot_anim_match_prob
        setting.slot_anim_match_min_pct = item.slot_anim_match_min_pct
        setting.slot_anim_match_max_pct = item.slot_anim_match_max_pct
        setting.slot_anim_match7_min_pct = item.slot_anim_match7_min_pct
        setting.slot_anim_match7_max_pct = item.slot_anim_match7_max_pct
        setting.slot_anim_extra25_prob = item.slot_anim_extra25_prob
        setting.slot_anim_extra25_pct = item.slot_anim_extra25_pct
        setting.slot_anim_smooth_threshold = item.slot_anim_smooth_threshold
        setting.bias_rules = json.dumps(item.bias_rules or [], ensure_ascii=False) if isinstance(item.bias_rules, list) else str(item.bias_rules or "[]")
        setting.updated_at = datetime.utcnow()
        updated_items.append(setting)
    db.commit()
    # 응답 직렬화를 위해 문자열로 저장된 bias_rules를 리스트로 변환
    for s in updated_items:
        if isinstance(s.bias_rules, str):
            try:
                s.bias_rules = json.loads(s.bias_rules)
            except Exception:
                s.bias_rules = []
    return updated_items


@app.get("/global_settings", response_model=schemas.GlobalSettingItem)
def get_global_settings(db: Session = Depends(get_db), admin=Depends(require_admin)):
    gs = db.query(models.GlobalSetting).filter(models.GlobalSetting.id == 1).first()
    if not gs:
        gs = models.GlobalSetting(id=1, min_bet=1, max_bet=10000)
        db.add(gs)
        db.commit()
        db.refresh(gs)
    return gs


@app.post("/global_settings", response_model=schemas.GlobalSettingItem)
def update_global_settings(
    payload: schemas.GlobalSettingItem,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    gs = db.query(models.GlobalSetting).filter(models.GlobalSetting.id == 1).first()
    if not gs:
        gs = models.GlobalSetting(id=1)
        db.add(gs)
    gs.min_bet = payload.min_bet
    gs.max_bet = payload.max_bet
    gs.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(gs)
    return gs
