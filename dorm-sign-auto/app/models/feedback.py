# -*- coding: utf-8 -*-
"""models/feedback.py — 意见反馈（对应新表 feedbacks）"""
from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import BaseModel


class Feedback(BaseModel):
    __tablename__ = "feedbacks"

    user_id: Mapped[int] = mapped_column(nullable=False, index=True, comment="提交人")
    code: Mapped[str] = mapped_column(
        String(32), nullable=False, unique=True, index=True, comment="反馈编号 FB-YYYYMMDD-NNNN"
    )
    type: Mapped[str] = mapped_column(String(16), nullable=False, comment="功能异常 / 体验建议")
    content: Mapped[str] = mapped_column(Text, nullable=False, comment="问题描述")
    images: Mapped[str | None] = mapped_column(
        Text, nullable=True, comment="截图 dataURL 的 JSON 数组，最多 3 张"
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", comment="pending 处理中 / replied 已回复"
    )
    reply: Mapped[str | None] = mapped_column(Text, nullable=True, comment="官方回复")
    replied_at: Mapped[str | None] = mapped_column(String(19), nullable=True)
