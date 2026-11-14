# -*- coding: utf-8 -*-
"""models/schedule.py — 签到任务（对应旧表 schedules）"""
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, BaseModel


class Schedule(BaseModel):
    __tablename__ = "schedules"

    user_id: Mapped[int] = mapped_column(nullable=False, index=True, comment="所属用户")
    dorm_account_id: Mapped[int] = mapped_column(nullable=False, comment="绑定账号")
    mode: Mapped[str] = mapped_column(String(8), nullable=False, comment="once/daily")
    sign_time: Mapped[str] = mapped_column(String(5), nullable=False, comment="HH:MM")
    sign_date: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="once 日期")
    enabled: Mapped[int] = mapped_column(nullable=False, default=1, comment="1启用 0停用")
    remark: Mapped[str] = mapped_column(String(64), nullable=False, default="", comment="备注")
    last_run_at: Mapped[str | None] = mapped_column(String(19), nullable=True)
    last_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    last_msg: Mapped[str | None] = mapped_column(String(255), nullable=True)
    next_run_at: Mapped[str | None] = mapped_column(String(19), nullable=True)
    location_id: Mapped[int | None] = mapped_column(nullable=True, comment="绑定提前记录的位置")
