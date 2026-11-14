# -*- coding: utf-8 -*-
"""models/user.py — 服务自身账号（对应旧表 users，字段与旧库逐列一致）"""
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, now_str


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, comment="用户名")
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False, comment="密码哈希(Argon2/旧pbkdf2)")
    created_at: Mapped[str] = mapped_column(
        String(19), nullable=False, default=now_str, comment="创建时间"
    )
