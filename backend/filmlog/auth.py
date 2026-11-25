import hashlib
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import ApiToken, SessionToken, User, now

COOKIE_NAME = "filmlog_session"
CSRF_HEADER = "x-filmlog"
API_TOKEN_PREFIX = "flt_"

_hasher = PasswordHasher()
# Dummy-Hash, damit unbekannte Benutzernamen gleich lange brauchen wie falsche Passwoerter.
_DUMMY_HASH = _hasher.hash("filmlog-dummy-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def _sha256(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def authenticate(db: Session, username: str, password: str) -> User | None:
    user = db.scalar(select(User).where(User.username == username))
    if user is None:
        verify_password(_DUMMY_HASH, password)
        return None
    if not verify_password(user.password_hash, password):
        return None
    if _hasher.check_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
        db.commit()
    return user


def create_session(db: Session, user: User, remember: bool, user_agent: str | None) -> tuple[str, datetime]:
    settings = get_settings()
    token = secrets.token_urlsafe(32)
    lifetime = timedelta(days=settings.session_days) if remember else timedelta(hours=settings.session_hours_short)
    expires = now() + lifetime
    db.execute(delete(SessionToken).where(SessionToken.expires_at < now()))
    db.add(SessionToken(token_hash=_sha256(token), user_id=user.id, expires_at=expires,
                        user_agent=(user_agent or "")[:255]))
    db.commit()
    return token, expires


def delete_session(db: Session, token: str) -> None:
    db.execute(delete(SessionToken).where(SessionToken.token_hash == _sha256(token)))
    db.commit()


def create_api_token(db: Session, user: User, name: str) -> tuple[ApiToken, str]:
    token = API_TOKEN_PREFIX + secrets.token_urlsafe(32)
    row = ApiToken(name=name, token_hash=_sha256(token), user_id=user.id)
    db.add(row)
    db.commit()
    return row, token


def ensure_admin(db: Session) -> None:
    """Legt beim ersten Start den Benutzer aus FILMLOG_ADMIN_USER/_PASSWORD an (nur wenn noch keiner existiert)."""
    settings = get_settings()
    if not settings.admin_user or not settings.admin_password:
        return
    if db.scalar(select(User).limit(1)) is not None:
        return
    db.add(User(username=settings.admin_user, password_hash=hash_password(settings.admin_password)))
    db.commit()


class LoginRateLimiter:
    def __init__(self) -> None:
        self._attempts: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, window: int) -> deque[float]:
        q = self._attempts[key]
        limit = time.monotonic() - window
        while q and q[0] < limit:
            q.popleft()
        return q

    def blocked(self, key: str) -> bool:
        s = get_settings()
        with self._lock:
            return len(self._prune(key, s.login_window_seconds)) >= s.login_max_attempts

    def fail(self, key: str) -> None:
        with self._lock:
            self._attempts[key].append(time.monotonic())

    def reset(self, key: str) -> None:
        with self._lock:
            self._attempts.pop(key, None)


rate_limiter = LoginRateLimiter()


def _user_from_request(request: Request, db: Session) -> tuple[User | None, str | None]:
    """-> (User, Art der Anmeldung: 'cookie' | 'token')"""
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        token = header[7:].strip()
        row = db.scalar(select(ApiToken).where(ApiToken.token_hash == _sha256(token)))
        if row is None:
            return None, None
        if row.last_used_at is None or (now() - row.last_used_at).total_seconds() > 60:
            row.last_used_at = now()
            db.commit()
        return db.get(User, row.user_id), "token"

    cookie = request.cookies.get(COOKIE_NAME)
    if cookie:
        row = db.scalar(select(SessionToken).where(SessionToken.token_hash == _sha256(cookie)))
        if row is not None and row.expires_at > now():
            return db.get(User, row.user_id), "cookie"
    return None, None


def require_user(request: Request, db: Session = Depends(get_db)) -> User:
    user, kind = _user_from_request(request, db)
    if user is None:
        raise HTTPException(401, "Nicht angemeldet.")
    if kind == "cookie" and request.method not in ("GET", "HEAD", "OPTIONS"):
        if request.headers.get(CSRF_HEADER) != "1":
            raise HTTPException(403, "CSRF-Header fehlt.")
    return user
