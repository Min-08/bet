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
}
SECRET_KEY = os.environ.get("TOKEN_SECRET", "dev-secret")
ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "adminpass")
UPDOWN_STATE: Dict[int, dict] = {}
TOKEN_PREFIX = "Bearer "


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
        if "user_id" not in existing_cols:
            try:
                conn.exec_driver_sql(
                    "ALTER TABLE game_results ADD COLUMN user_id INTEGER"
                )
            except Exception:
                pass
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
):
    payout_amount = bet_amount * multiplier
    if abs(multiplier - 1.5) < 1e-9:
        payout_amount = math.ceil(payout_amount)
    delta = int(round(payout_amount - bet_amount))
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
        payout_amount=bet_amount * multiplier,
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
    log_game_event(
        db,
        current_user,
        "updown",
        "auto_play",
        {"bet_amount": payload.bet_amount, "guesses": payload.guesses[:5]},
        commit=False,
    )
    result, multiplier, detail = play_updown_logic(payload.guesses)
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
    target = random.randint(1, 100)
    UPDOWN_STATE[current_user.id] = {
        "target": target,
        "attempts": 0,
        "guesses": [],
        "bet_amount": bet_amount,
    }
    log_game_event(
        db,
        current_user,
        "updown",
        "start",
        {"bet_amount": bet_amount, "target": target},
    )
    return {"message": "게임 시작", "remaining": 5}


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
        return process_game_result(
            db,
            current_user,
            "updown",
            result_data["bet_amount"],
            result_data["result"],
            result_data["multiplier"],
            detail,
        )
    return schemas.GameResponse(
        result="pending",
        payout_multiplier=0,
        payout_amount=0,
        delta=0,
        balance=current_user.balance,
        detail=result_data["detail"],
    )


@app.post("/api/game/slot", response_model=schemas.GameResponse)
def api_game_slot(
    payload: schemas.SlotRequest, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if current_user.balance < payload.bet_amount:
        raise HTTPException(status_code=400, detail="잔액이 부족합니다.")
    log_game_event(
        db,
        current_user,
        "slot",
        "play",
        {"bet_amount": payload.bet_amount},
        commit=False,
    )
    result, multiplier, detail = play_slot_logic()
    return process_game_result(
        db,
        current_user,
        "slot",
        payload.bet_amount,
        result,
        multiplier,
        detail,
    )


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
    setting_dict = {
        "risk_enabled": bool(setting.risk_enabled) if setting else False,
        "risk_threshold": setting.risk_threshold if setting else 0,
        "casino_advantage_percent": setting.casino_advantage_percent if setting else 0,
        "assist_enabled": bool(setting.assist_enabled) if setting else False,
        "assist_max_bet": setting.assist_max_bet if setting else 0,
        "player_advantage_percent": setting.player_advantage_percent if setting else 0,
    }
    target_outcome = None
    casino_active = (
        setting_dict["risk_enabled"]
        and payload.bet_amount >= setting_dict["risk_threshold"]
        and random.random() < (setting_dict["casino_advantage_percent"] / 100.0)
    )
    player_active = (
        setting_dict["assist_enabled"]
        and payload.bet_amount <= setting_dict["assist_max_bet"]
        and random.random() < (setting_dict["player_advantage_percent"] / 100.0)
    )

    log_game_event(
        db,
        current_user,
        "baccarat",
        "play",
        {"bet_amount": payload.bet_amount, "bet_choice": payload.bet_choice},
        commit=False,
    )

    if casino_active:
        if payload.bet_choice == "player":
            target_outcome = "banker"
        elif payload.bet_choice == "banker":
            target_outcome = "player"
        else:
            target_outcome = "banker"
    elif player_active:
        target_outcome = payload.bet_choice

    result, multiplier, detail = play_baccarat_logic(
        payload.bet_choice, setting_dict, target_outcome
    )
    detail["bet_choice"] = payload.bet_choice
    return process_game_result(
        db,
        current_user,
        "baccarat",
        payload.bet_amount,
        result,
        multiplier,
        detail,
        bet_choice=payload.bet_choice,
    )


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


def play_updown_logic(guesses: List[int]) -> tuple[str, float, dict]:
    target = random.randint(1, 100)
    detail = {"target": target, "guesses": guesses}
    multiplier = 0.0
    result = "lose"
    for idx, guess in enumerate(guesses[:5]):
        attempt = idx + 1
        if guess == target:
            result = "win"
            if attempt == 1:
                multiplier = 7
            elif attempt == 2:
                multiplier = 5
            elif attempt == 3:
                multiplier = 4
            elif attempt == 4:
                multiplier = 3
            elif attempt == 5:
                multiplier = 2
            break
    detail["attempts"] = len(guesses[:5])
    return result, multiplier, detail


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
    hint = "UP" if guess < target else "DOWN" if guess > target else "CORRECT"
    if guess == target:
        finished = True
        result = "win"
        if attempts == 1:
            multiplier = 7
        elif attempts == 2:
            multiplier = 5
        elif attempts == 3:
            multiplier = 4
        elif attempts == 4:
            multiplier = 3
        elif attempts == 5:
            multiplier = 2
    elif attempts >= 5:
        finished = True
        result = "lose"
        multiplier = 0.0
    detail = {
        "target": target,
        "guesses": list(state["guesses"]),
        "attempts": attempts,
        "hint": hint,
    }
    return {
        "result": result,
        "multiplier": multiplier,
        "detail": detail,
        "bet_amount": state["bet_amount"],
        "finished": finished,
    }, finished


def play_slot_logic() -> tuple[str, float, dict]:
    symbols = [random.choice(["A", "B", "C", "D", "7"]) for _ in range(3)]
    if symbols.count("7") == 3:
        multiplier = 10
    elif len(set(symbols)) == 1:
        multiplier = 5
    elif len(set(symbols)) == 2:
        multiplier = 1.5
    else:
        multiplier = 0
    result = "win" if multiplier > 0 else "lose"
    return result, float(multiplier), {"symbols": symbols}


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

    multiplier = 0.0
    result = "lose"
    if bet_choice == "tie":
        if outcome == "tie":
            multiplier = 8.0
            result = "win"
        else:
            result = "lose"
    elif bet_choice == "player":
        if outcome == "player":
            multiplier = 2.0
            result = "win"
        else:
            result = "lose"
    else:  # banker bet
        if outcome == "banker":
            multiplier = 1.95
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
def get_game_settings(db: Session = Depends(get_db)):
    settings = (
        db.query(models.GameSetting).order_by(models.GameSetting.game_id.asc()).all()
    )
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
        setting.updated_at = datetime.utcnow()
        updated_items.append(setting)
    db.commit()
    return updated_items
