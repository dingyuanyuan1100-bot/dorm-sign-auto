# -*- coding: utf-8 -*-
"""schemas/sign_log.py — 执行日志模型"""
from pydantic import BaseModel


class SignLogResponse(BaseModel):
    id: int
    schedule_id: int | None
    run_at: str
    success: bool
    msg: str | None
    detail: str | None
