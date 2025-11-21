import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Tuple

from fastapi import Depends, FastAPI, HTTPException, Request
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
}


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
        for sql in migrations:
            conn.exec_driver_sql(sql)


def ensure_default_game_settings(db: Session) -> None:
    defaults = {
        "updown": {
            "risk_enabled": True,
            "risk_threshold": 1000,
            "casino_advantage_percent": 15.0,
            "assist_enabled": False,
            "assist_max_bet": 50,
            "player_advantage_percent": 0.0,
        },
        "slot": {
            "risk_enabled": True,
            "risk_threshold": 1000,
            "casino_advantage_percent": 15.0,
            "assist_enabled": False,
            "assist_max_bet": 50,
            "player_advantage_percent": 0.0,
        },
        "baccarat": {
            "risk_enabled": True,
            "risk_threshold": 1000,
            "casino_advantage_percent": 20.0,
            "assist_enabled": False,
            "assist_max_bet": 50,
            "player_advantage_percent": 0.0,
        },
    }
    for game_id, cfg in defaults.items():
        existing = (
            db.query(models.GameSetting)
            .filter(models.GameSetting.game_id == game_id)
            .first()
        )
        if existing:
            continue
        setting = models.GameSetting(
            game_id=game_id,
            risk_enabled=cfg["risk_enabled"],
            risk_threshold=cfg["risk_threshold"],
            casino_advantage_percent=cfg["casino_advantage_percent"],
            assist_enabled=cfg["assist_enabled"],
            assist_max_bet=cfg["assist_max_bet"],
            player_advantage_percent=cfg["player_advantage_percent"],
        )
        db.add(setting)
    db.commit()

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


@app.get("/game", include_in_schema=False)
def game_client() -> FileResponse:
    game_page = WEBCLIENT_DIR / "index.html"
    if not game_page.exists():
        raise HTTPException(status_code=404, detail="Game client not found.")
    return FileResponse(game_page)


@app.post("/create_session", response_model=schemas.SessionResponse)
def create_session(
    payload: schemas.SessionCreate, db: Session = Depends(get_db)
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


@app.post("/adjustments", response_model=schemas.AdjustmentResponse)
def create_adjustment(
    payload: schemas.AdjustmentCreate, db: Session = Depends(get_db)
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
def delete_session(session_key: str, db: Session = Depends(get_db)):
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
def reset_database(db: Session = Depends(get_db)):
    deleted_results = db.query(models.GameResult).delete()
    deleted_sessions = db.query(models.Session).delete()
    db.commit()
    return {
        "message": "All session and result data removed.",
        "deleted_sessions": deleted_sessions,
        "deleted_results": deleted_results,
    }


@app.get("/game_settings", response_model=List[schemas.GameSettingItem])
def get_game_settings(db: Session = Depends(get_db)):
    settings = (
        db.query(models.GameSetting).order_by(models.GameSetting.game_id.asc()).all()
    )
    return settings


@app.post("/game_settings", response_model=List[schemas.GameSettingItem])
def update_game_settings(
    payload: schemas.GameSettingsUpdate, db: Session = Depends(get_db)
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
        setting.updated_at = datetime.utcnow()
        updated_items.append(setting)
    db.commit()
    return updated_items
