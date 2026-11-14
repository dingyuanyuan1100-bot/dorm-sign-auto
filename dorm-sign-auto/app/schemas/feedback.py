# -*- coding: utf-8 -*-
"""schemas/feedback.py — 意见反馈入参与出参"""
from pydantic import BaseModel, Field, field_validator


class FeedbackCreate(BaseModel):
    type: str = Field(default="功能异常", max_length=16)
    content: str = Field(min_length=1, max_length=2000)
    images: list[str] = Field(default_factory=list)

    @field_validator("images")
    @classmethod
    def _max_three(cls, v: list[str]) -> list[str]:
        # 不用 Field(max_length=3)：那样会抛英文的
        # "List should have at most 3 items"，客户端会把这句原样弹给用户
        if len(v) > 3:
            raise ValueError("截图最多 3 张")
        return v


class FeedbackReplyIn(BaseModel):
    reply: str = Field(min_length=1, max_length=1000)


class FeedbackOut(BaseModel):
    id: int
    code: str
    type: str
    content: str
    image_count: int = 0
    status: str
    reply: str | None = None
    created_at: str
    replied_at: str | None = None
