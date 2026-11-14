# -*- coding: utf-8 -*-
"""models/dorm_account.py — 晚寝账号绑定（对应旧表 dorm_accounts，密码 AES 密文）"""
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, BaseModel


class DormAccount(BaseModel):
    __tablename__ = "dorm_accounts"

    user_id: Mapped[int] = mapped_column(nullable=False, unique=True, index=True, comment="所属用户")
    student_id: Mapped[str] = mapped_column(String(32), nullable=False, comment="学号")
    enc_password: Mapped[str] = mapped_column(String(512), nullable=False, comment="AES-GCM 加密后的晚寝密码")
    nickname: Mapped[str] = mapped_column(String(32), nullable=False, default="", comment="昵称")
