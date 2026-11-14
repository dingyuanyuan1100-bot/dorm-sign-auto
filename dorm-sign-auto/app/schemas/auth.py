# -*- coding: utf-8 -*-
"""schemas/auth.py — 认证相关请求/响应模型"""
import re

from pydantic import BaseModel, Field, field_validator

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,32}$")
STUDENT_ID_RE = re.compile(r"^[A-Za-z0-9]{4,32}$")


class RegisterRequest(BaseModel):
    username: str = Field(..., description="用户名")
    password: str = Field(..., min_length=6, max_length=64, description="密码 6-64 位")

    @field_validator("username")
    @classmethod
    def _check_username(cls, v: str) -> str:
        v = v.strip()
        if not USERNAME_RE.fullmatch(v):
            raise ValueError("用户名需为 3-32 位字母/数字/下划线")
        return v


class LoginRequest(BaseModel):
    username: str = Field(..., description="用户名")
    password: str = Field(..., description="密码")


class RecoverVerifyRequest(BaseModel):
    """找回密码第一步：用晚寝签到的学号 + 密码验证身份归属。"""
    student_id: str = Field(..., description="学号（与晚寝签到一致）")
    password: str = Field(..., min_length=6, max_length=64, description="晚寝签到密码")

    @field_validator("student_id")
    @classmethod
    def _check_student_id(cls, v: str) -> str:
        v = v.strip()
        if not STUDENT_ID_RE.fullmatch(v):
            raise ValueError("学号需为 4-32 位字母/数字")
        return v


class RecoverResetRequest(BaseModel):
    """找回密码第三步：凭证 + 目标账号 + 新密码。"""
    ticket: str = Field(..., description="验证身份后签发的临时凭证")
    user_id: int = Field(..., description="要重置的账号 ID")
    password: str = Field(..., min_length=6, max_length=64, description="新密码 6-64 位")


class TokenResponse(BaseModel):
    token: str
    username: str


class UserMeResponse(BaseModel):
    id: int
    username: str
    has_dorm_account: bool
    student_id: str | None = None
