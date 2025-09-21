# backend/db.py
import logging
import os
from contextlib import contextmanager
from datetime import datetime, timedelta

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
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")


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
    fcm_token: Mapped[str | None] = mapped_column(String, nullable=True)
    fcm_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PairingCode(Base):
    __tablename__ = "pairing_codes"
    code: Mapped[str] = mapped_column(String(6), primary_key=True)
    device_id: Mapped[str] = mapped_column(String, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class DeviceUser(Base):
    __tablename__ = "device_users"
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)


def init_db():
    Base.metadata.create_all(engine)
    if DATABASE_URL.startswith("sqlite"):
        with engine.begin() as conn:
            conn.exec_driver_sql("PRAGMA journal_mode=WAL;")
            conn.exec_driver_sql("PRAGMA synchronous=NORMAL;")
            conn.exec_driver_sql("PRAGMA busy_timeout=5000;")
            # 👇 mini-migration idempotente per colonne nuove
            # cols = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(devices);")]
            # if "fcm_token" not in cols:
            #    conn.exec_driver_sql("ALTER TABLE devices ADD COLUMN fcm_token TEXT;")
            # if "fcm_updated_at" not in cols:
            #    conn.exec_driver_sql("ALTER TABLE devices ADD COLUMN fcm_updated_at DATETIME;")


def set_fcm_token(session, device_id: str, token: str):
    d = ensure_device(session, device_id)
    d.fcm_token = token
    d.fcm_updated_at = datetime.utcnow()
    return d


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


def link_user_device(session, user_id: str, device_id: str):
    # idempotente: crea utente, device e legame se mancano
    if not session.get(User, user_id):
        session.add(User(id=user_id))
    ensure_device(session, device_id)
    session.merge(DeviceUser(device_id=device_id, user_id=user_id))


def user_has_access(session, user_id: str, device_id: str) -> bool:
    return session.get(DeviceUser, {"device_id": device_id, "user_id": user_id})

def list_users_for_device(session, device_id: str) -> list[str]:
    from sqlalchemy import select
    from db import DeviceUser  # o import diretto se nello stesso file
    rows = session.execute(
        select(DeviceUser.user_id).where(DeviceUser.device_id == device_id)
    ).scalars().all()
    return rows

def unlink_user_device(session, user_id: str, device_id: str) -> bool:
    from db import DeviceUser
    du = session.get(DeviceUser, {"device_id": device_id, "user_id": user_id})
    if not du:
        return False
    session.delete(du)
    return True
