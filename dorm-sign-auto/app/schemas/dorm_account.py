# -*- coding: utf-8 -*-
"""schemas/dorm_account.py — 晚寝账号绑定模型"""
import re

from pydantic import BaseModel, Field, field_validator

STUDENT_ID_RE = re.compile(r"^[A-Za-z0-9]{4,32}$")


class DormAccountBind(BaseModel):
    student_id: str = Field(..., description="学号")
    password: str = Field(..., min_length=6, max_length=64, description="晚寝密码")
    nickname: str = Field(default="", max_length=32, description="昵称")

    @field_validator("student_id")
    @classmethod
    def _check_student_id(cls, v: str) -> str:
        v = v.strip()
        if not STUDENT_ID_RE.fullmatch(v):
            raise ValueError("学号格式不正确（4-32 位字母数字）")
        return v


class DormAccountResponse(BaseModel):
    id: int
    student_id: str
    nickname: str
    created_at: str
