# -*- coding: utf-8 -*-
"""schemas/schedule.py — 签到任务模型"""
import re
from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator

TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class ScheduleCreate(BaseModel):
    mode: str = Field(..., description="once/daily")
    sign_time: str = Field(..., description="HH:MM")
    sign_date: str | None = Field(default=None, description="once 日期 YYYY-MM-DD")
    remark: str = Field(default="", max_length=64)
    location_id: int | None = None

    @field_validator("mode")
    @classmethod
    def _check_mode(cls, v: str) -> str:
        if v not in ("once", "daily"):
            raise ValueError("mode 只能是 once(一次) 或 daily(每天)")
        return v

    @field_validator("sign_time")
    @classmethod
    def _check_time(cls, v: str) -> str:
        if not TIME_RE.fullmatch(v or ""):
            raise ValueError("签到时间格式应为 HH:MM（24 小时制）")
        return v

    @field_validator("sign_date")
    @classmethod
    def _check_date(cls, v):
        if v in (None, ""):
            return v
        try:
            d = datetime.strptime(v, "%Y-%m-%d").date()
        except ValueError:
            raise ValueError("日期格式应为 YYYY-MM-DD")
        if d < date.today():
            raise ValueError("一次性签到的日期不能早于今天")
        return v


class ScheduleUpdate(BaseModel):
    mode: str | None = None
    sign_time: str | None = None
    sign_date: str | None = None
    enabled: bool | None = None
    remark: str | None = Field(default=None, max_length=64)
    location_id: int | None = None

    @field_validator("mode")
    @classmethod
    def _check_mode(cls, v):
        if v is not None and v not in ("once", "daily"):
            raise ValueError("mode 只能是 once 或 daily")
        return v

    @field_validator("sign_time")
    @classmethod
    def _check_time(cls, v):
        if v is not None and not TIME_RE.fullmatch(v or ""):
            raise ValueError("签到时间格式应为 HH:MM")
        return v

    @field_validator("sign_date")
    @classmethod
    def _check_date(cls, v):
        if v in (None, ""):
            return None if v is None else v
        try:
            d = datetime.strptime(v, "%Y-%m-%d").date()
        except ValueError:
            raise ValueError("日期格式应为 YYYY-MM-DD")
        if d < date.today():
            raise ValueError("一次性签到的日期不能早于今天")
        return v


class ScheduleLocation(BaseModel):
    id: int | None
    name: str | None
    lat: str | None
    lng: str | None
    address: str | None


class ScheduleResponse(BaseModel):
    id: int
    mode: str
    sign_time: str
    sign_date: str | None
    enabled: bool
    remark: str
    student_id: str
    last_run_at: str | None
    last_status: str | None
    last_msg: str | None
    next_run_at: str | None
    created_at: str
    location: ScheduleLocation | None = None
