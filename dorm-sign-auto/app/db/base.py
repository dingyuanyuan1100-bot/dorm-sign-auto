# -*- coding: utf-8 -*-
"""
db/base.py — SQLAlchemy 声明式基类（参考 market_system/app/db/base.py）

BaseModel 提供 id / created_at / updated_at 通用字段；
所有字段类型与旧 SQLite 表结构严格一致，保证旧库无缝可读。
"""
from sqlalchemy import String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.security import now_str


class Base(DeclarativeBase):
    pass


class BaseModel(Base):
    """通用模型基类（抽象）：主键 + 创建/更新时间（文本格式，兼容旧库）。"""
    __abstract__ = True

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    created_at: Mapped[str] = mapped_column(
        String(19), nullable=False, default=now_str, comment="创建时间"
    )
    updated_at: Mapped[str | None] = mapped_column(
        String(19), nullable=True, default=None, onupdate=now_str, comment="更新时间"
    )
