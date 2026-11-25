from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .. import auth
from ..config import get_settings
from ..db import get_db
from ..models import ApiToken, SessionToken, User
from ..schemas import LoginIn, PasswordIn, TokenIn
from ..services import iso

router = APIRouter()


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "?"


@router.get("/auth/me")
def me(user: User = Depends(auth.require_user)):
    return {"username": user.username}


@router.post("/auth/login")
def login(data: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    key = f"{_client_ip(request)}|{data.username.lower()}"
    if auth.rate_limiter.blocked(key):
        raise HTTPException(429, "Zu viele Fehlversuche. Bitte in ein paar Minuten erneut versuchen.")
    user = auth.authenticate(db, data.username, data.password)
    if user is None:
        auth.rate_limiter.fail(key)
        raise HTTPException(401, "Benutzername oder Passwort falsch.")
    auth.rate_limiter.reset(key)
    token, expires = auth.create_session(db, user, data.remember, request.headers.get("user-agent"))
    settings = get_settings()
    response.set_cookie(
        auth.COOKIE_NAME, token, httponly=True, secure=settings.secure_cookies, samesite="lax", path="/",
        max_age=int((expires - auth.now()).total_seconds()) if data.remember else None,
    )
    return {"username": user.username}


@router.post("/auth/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    cookie = request.cookies.get(auth.COOKIE_NAME)
    if cookie:
        auth.delete_session(db, cookie)
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    return {"ok": True}


@router.post("/auth/password")
def change_password(data: PasswordIn, request: Request, db: Session = Depends(get_db),
                    user: User = Depends(auth.require_user)):
    if not auth.verify_password(user.password_hash, data.current):
        raise HTTPException(400, "Aktuelles Passwort ist falsch.")
    user.password_hash = auth.hash_password(data.new)
    # Alle anderen Sitzungen beenden
    current = request.cookies.get(auth.COOKIE_NAME)
    keep = auth._sha256(current) if current else ""
    db.execute(delete(SessionToken).where(SessionToken.user_id == user.id, SessionToken.token_hash != keep))
    db.commit()
    return {"ok": True}


@router.get("/api/v2/tokens")
def list_tokens(db: Session = Depends(get_db), user: User = Depends(auth.require_user)):
    rows = db.scalars(select(ApiToken).where(ApiToken.user_id == user.id).order_by(ApiToken.created_at.desc()))
    return [{"id": t.id, "name": t.name, "created_at": iso(t.created_at), "last_used_at": iso(t.last_used_at)}
            for t in rows]


@router.post("/api/v2/tokens", status_code=201)
def create_token(data: TokenIn, db: Session = Depends(get_db), user: User = Depends(auth.require_user)):
    row, token = auth.create_api_token(db, user, data.name.strip())
    return {"id": row.id, "name": row.name, "token": token, "created_at": iso(row.created_at)}


@router.delete("/api/v2/tokens/{token_id}")
def delete_token(token_id: int, db: Session = Depends(get_db), user: User = Depends(auth.require_user)):
    row = db.get(ApiToken, token_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(404, "Token nicht gefunden.")
    db.delete(row)
    db.commit()
    return {"ok": True}
