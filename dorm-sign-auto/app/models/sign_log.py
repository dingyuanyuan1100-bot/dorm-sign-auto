# -*- coding: utf-8 -*-
"""models/sign_log.py — 签到执行日志（对应旧表 sign_logs）"""
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SignLog(Base):
    __tablename__ = "sign_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(nullable=False, index=True, comment="所属用户")
    schedule_id: Mapped[int | None] = mapped_column(nullable=True)
    run_at: Mapped[str] = mapped_column(String(19), nullable=False, comment="执行时间")
    success: Mapped[int] = mapped_column(nullable=False, default=0, comment="1成功 0失败")
    msg: Mapped[str | None] = mapped_column(String(255), nullable=True)
    detail: Mapped[str | None] = mapped_column(String(255), nullable=True)
