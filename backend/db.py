"""
Database engine and session setup (PostgreSQL via SQLAlchemy 2 + psycopg 3).

The pipeline writes progress from background threads (FastAPI runs sync
background tasks and `def` endpoints in its threadpool), so every unit of
work opens its own short-lived session via `session_scope()` rather than
sharing one.
"""
import os
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+psycopg://splitter:splitter@localhost:5432/splitter"
)

# pool_pre_ping: survive the DB container restarting underneath a long-lived
# backend without handing out dead connections.
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


@contextmanager
def session_scope():
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
