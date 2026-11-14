# -*- coding: utf-8 -*-
"""
db/session.py — 异步引擎与会话（参考 market_system/app/db/db_init.py）

- SQLite 异步引擎（aiosqlite）+ WAL 模式 + busy_timeout，读写并发友好；
- async_sessionmaker 生成请求级会话，get_db 依赖注入；
- init_db()：建表（兼容旧库：仅补缺失列，不破坏既有数据）。
"""
import logging

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

logger = logging.getLogger("app.db")

engine = create_async_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,   # 取连接前先探测，避免拿到失效连接
    echo=settings.DEBUG,
)


@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    """连接级 PRAGMA：外键 / WAL / 忙等待。"""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db():
    """FastAPI 依赖：请求级会话，自动关闭。"""
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()


# ---------- 建表与旧库兼容 ----------

async def init_db(base: DeclarativeBase) -> None:
    """初始化：建表 + 为旧库补齐缺失列。"""
    async with engine.begin() as conn:
        await conn.run_sync(base.metadata.create_all)
    await _ensure_columns()


async def _ensure_columns() -> None:
    """旧库兼容：schedules 缺 location_id 列时补上（老版本曾手动 ALTER）。"""
    async with async_session() as session:
        result = await session.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='schedules'")
        )
        if not result.first():
            return
        cols = await session.execute(text("PRAGMA table_info(schedules)"))
        names = {row.name for row in cols}
        if "location_id" not in names:
            await session.execute(text("ALTER TABLE schedules ADD COLUMN location_id INTEGER"))
            await session.commit()
            logger.info("旧库补齐 schedules.location_id 列")
