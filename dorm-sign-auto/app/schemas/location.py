# -*- coding: utf-8 -*-
"""schemas/location.py — 位置模型"""
from pydantic import BaseModel, Field, field_validator


def _check_lat_lng(lat: str, lng: str) -> None:
    try:
        la, ln = float(lat), float(lng)
    except (TypeError, ValueError):
        raise ValueError("经纬度格式不正确")
    if not (-90 <= la <= 90 and -180 <= ln <= 180):
        raise ValueError("经纬度范围不正确（纬度 -90~90，经度 -180~180）")


class LocationCreate(BaseModel):
    name: str = Field(default="位置", max_length=32)
    lat: str = Field(..., description="纬度")
    lng: str = Field(..., description="经度")
    address: str = Field(default="", max_length=64)
    is_default: bool | None = None

    @field_validator("lat", "lng")
    @classmethod
    def _check_coord(cls, v: str) -> str:
        return v.strip()

    @field_validator("lat")
    @classmethod
    def _check_lat(cls, v: str) -> str:
        try:
            la = float(v)
        except ValueError:
            raise ValueError("经纬度格式不正确")
        if not -90 <= la <= 90:
            raise ValueError("纬度范围应为 -90~90")
        return v

    @field_validator("lng")
    @classmethod
    def _check_lng(cls, v: str) -> str:
        try:
            ln = float(v)
        except ValueError:
            raise ValueError("经纬度格式不正确")
        if not -180 <= ln <= 180:
            raise ValueError("经度范围应为 -180~180")
        return v


class LocationUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=32)
    lat: str | None = None
    lng: str | None = None
    address: str | None = Field(default=None, max_length=64)

    @field_validator("lat")
    @classmethod
    def _check_lat(cls, v):
        if v is None:
            return v
        try:
            la = float(v)
        except ValueError:
            raise ValueError("经纬度格式不正确")
        if not -90 <= la <= 90:
            raise ValueError("纬度范围应为 -90~90")
        return v.strip()

    @field_validator("lng")
    @classmethod
    def _check_lng(cls, v):
        if v is None:
            return v
        try:
            ln = float(v)
        except ValueError:
            raise ValueError("经纬度格式不正确")
        if not -180 <= ln <= 180:
            raise ValueError("经度范围应为 -180~180")
        return v.strip()


class LocationResponse(BaseModel):
    id: int
    name: str
    lat: str
    lng: str
    address: str
    is_default: bool
    created_at: str
