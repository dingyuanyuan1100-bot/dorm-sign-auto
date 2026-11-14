# -*- coding: utf-8 -*-
"""api/v1/feedback.py — 意见反馈：提交 / 我的列表 / 详情"""
import json

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.common import fail, ok
from app.crud.feedback import feedback_crud, image_count_of
from app.db.session import get_db
from app.deps import get_current_user
from app.models.feedback import Feedback
from app.models.user import User
from app.schemas.feedback import FeedbackCreate

router = APIRouter(prefix="/api/feedback", tags=["意见反馈"])

TYPES = {"功能异常", "体验建议"}
MAX_TOTAL_CHARS = 4_000_000  # 3 张压缩后的截图，留够余量


def _out(row: Feedback) -> dict:
    return {
        "id": row.id,
        "code": row.code,
        "type": row.type,
        "content": row.content,
        "image_count": image_count_of(row),
        "status": row.status,
        "reply": row.reply,
        "created_at": row.created_at,
        "replied_at": row.replied_at,
    }


@router.post("", summary="提交反馈")
async def create_feedback(
    body: FeedbackCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    text = (body.content or "").strip()
    if not text:
        return fail("请填写问题描述")
    if len(text) < 5:
        return fail("描述太短，至少 5 个字")
    if body.type not in TYPES:
        return fail("反馈类型不正确")
    if len(body.images) > 3:
        return fail("截图最多 3 张")

    for item in body.images:
        if not isinstance(item, str) or not item.startswith("data:image/"):
            return fail("截图格式不正确")
    if sum(len(i) for i in body.images) > MAX_TOTAL_CHARS:
        return fail("截图过大，请重新选择")

    row = await feedback_crud.create(
        db, user_id=user.id, type=body.type, content=text, images=body.images
    )
    return ok(_out(row))


@router.get("", summary="我的反馈列表")
async def list_feedback(
    limit: int = 50,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await feedback_crud.list_by_user(db, user.id, max(1, min(limit, 100)))
    total, pending = await feedback_crud.stats(db, user.id)
    return ok({"total": total, "pending": pending, "items": [_out(r) for r in rows]})


@router.get("/{feedback_id}", summary="反馈详情")
async def get_feedback(
    feedback_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await feedback_crud.get_owned(db, feedback_id, user.id)
    if not row:
        return fail("反馈不存在", status_code=404)
    data = _out(row)
    try:
        data["images"] = json.loads(row.images) if row.images else []
    except (ValueError, TypeError):
        data["images"] = []
    return ok(data)
