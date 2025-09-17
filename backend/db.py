# backend/db.py
import os
from datetime import datetime, timedelta
from contextlib import contextmanager

from sqlalchemy import create_engine, String, DateTime, ForeignKey, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

DATA_DIR = os.getenv("DATA_DIR", "/usr/src/data")  # in Docker; in locale puoi sovrascrivere con env
os.makedirs(DATA_DIR, exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{os.path.join(DATA_DIR, 'app.db')}")

# Engine
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True)  # es. "web-xxxx"
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Device(Base):
    __tablename__ = "devices"
    id: Mapped[str] = mapped_column(String, primary_key=True)  # deviceId TV
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    secret_key: Mapped[str | None] = mapped_column(String, nullable=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class PairingCode(Base):
    __tablename__ = "pairing_codes"
    code: Mapped[str] = mapped_column(String(6), primary_key=True)
    device_id: Mapped[str] = mapped_column(String, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class Inbox(Base):
    """
    Un solo messaggio 'corrente' per device (chiave = device_id).
    Se vuoi storico, aggiungi un id autoincrementale invece di usare device_id come PK.
    """
    __tablename__ = "inbox"
    device_id: Mapped[str] = mapped_column(String, primary_key=True)
    action: Mapped[str] = mapped_column(String, nullable=False)     # "acestream" | "playUrl" ...
    cid: Mapped[str | None] = mapped_column(String, nullable=True)
    url: Mapped[str | None] = mapped_column(String, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


def init_db():
    Base.metadata.create_all(engine)
    # ottimizzazioni SQLite
    if DATABASE_URL.startswith("sqlite"):
        with engine.begin() as conn:
            conn.exec_driver_sql("PRAGMA journal_mode=WAL;")
            conn.exec_driver_sql("PRAGMA synchronous=NORMAL;")
            conn.exec_driver_sql("PRAGMA busy_timeout=5000;")


@contextmanager
def db_session():
    s = SessionLocal()
    try:
        yield s
        s.commit()
    except:
        s.rollback()
        raise
    finally:
        s.close()


# ---------- Helpers dominio ----------

def save_pairing_code(session, code: str, device_id: str, ttl_seconds: int = 300):
    session.merge(PairingCode(
        code=code,
        device_id=device_id,
        expires_at=datetime.utcnow() + timedelta(seconds=ttl_seconds)
    ))

def consume_pairing_code(session, code: str) -> str | None:
    pc = session.get(PairingCode, code)
    if not pc:
        return None
    if pc.expires_at < datetime.utcnow():
        session.delete(pc)
        return None
    device_id = pc.device_id
    session.delete(pc)
    return device_id

def ensure_device(session, device_id: str, secret_key: str | None = None):
    d = session.get(Device, device_id)
    if not d:
        d = Device(id=device_id, secret_key=secret_key)
        session.add(d)
    else:
        if secret_key and d.secret_key != secret_key:
            d.secret_key = secret_key
    d.last_seen = datetime.utcnow()
    return d

def upsert_user_and_device(session, user_id: str, device_id: str):
    if not session.get(User, user_id):
        session.add(User(id=user_id))
    d = ensure_device(session, device_id)
    d.user_id = user_id
    d.last_seen = datetime.utcnow()

def put_inbox(session, device_id: str, action: str, cid: str | None, url: str | None, ttl_seconds: int = 300):
    session.merge(Inbox(
        device_id=device_id,
        action=action,
        cid=cid,
        url=url,
        expires_at=datetime.utcnow() + timedelta(seconds=ttl_seconds)
    ))

def pop_inbox(session, device_id: str):
    rec = session.get(Inbox, device_id)
    if not rec:
        return None
    from datetime import datetime as _dt
    if rec.expires_at < _dt.utcnow():
        session.delete(rec)
        return None
    # consumiamo
    payload = {"action": rec.action, "cid": rec.cid, "url": rec.url}
    session.delete(rec)
    return payload
