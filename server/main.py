import uuid
from datetime import timedelta, timezone
from pathlib import Path
from typing import List

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from . import models, schemas
from .database import Base, engine, get_db


BASE_DIR = Path(__file__).resolve().parent
WEBCLIENT_DIR = BASE_DIR.parent / "webclient"
KST = timezone(timedelta(hours=9))

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

    def _format_kst(dt):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(KST).strftime("%m-%d %H:%M")

    for session in sessions:
        session.created_kst = _format_kst(session.created_at)
    for result in results:
        result.timestamp_kst = _format_kst(result.timestamp)

    return templates.TemplateResponse(
        "admin.html",
        {
            "request": request,
            "sessions": sessions,
            "results": results,
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
