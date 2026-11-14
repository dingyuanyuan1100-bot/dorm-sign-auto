# -*- coding: utf-8 -*-
"""api/v1/admin_feedback.py — 意见反馈处理端（管理后台专用，独立于用户端 /api/feedback）"""
import json
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.common import fail, ok
from app.core.config import settings
from app.db.session import get_db
from app.models.feedback import Feedback
from app.models.user import User

router = APIRouter(prefix="/api/admin/feedbacks", tags=["意见反馈·管理"])


def _require_admin(x_admin_token: str = Header(default="")) -> None:
    # 未配置口令时一律拒绝，避免误部署把管理接口暴露出去
    expected = (settings.ADMIN_TOKEN or "").strip()
    supplied = (x_admin_token or "").strip()
    if not expected or not supplied or not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=403, detail="管理口令不正确")


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _safe_images(row: Feedback) -> list[str]:
    if not row.images:
        return []
    try:
        data = json.loads(row.images)
    except (ValueError, TypeError):
        return []
    if not isinstance(data, list):
        return []
    return [v for v in data if isinstance(v, str) and v.startswith("data:image/")][:3]


def _out(row: Feedback, username: str, with_images: bool = False) -> dict:
    data = {
        "id": row.id,
        "code": row.code,
        "type": row.type,
        "content": row.content,
        "image_count": len(_safe_images(row)),
        "status": row.status,
        "reply": row.reply,
        "created_at": row.created_at,
        "replied_at": row.replied_at,
        "user_id": row.user_id,
        "username": username,
    }
    if with_images:
        data["images"] = _safe_images(row)
    return data


def _with_user():
    return select(Feedback, User.username).join(User, Feedback.user_id == User.id)


@router.get("", summary="全部反馈", dependencies=[Depends(_require_admin)])
async def list_all(
    status: str = "",
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    q = _with_user()
    if status in ("pending", "replied"):
        q = q.where(Feedback.status == status)
    rows = (await db.execute(q.order_by(Feedback.id.desc()).limit(limit).offset(offset))).all()
    counts = (await db.execute(
        select(Feedback.status, func.count()).group_by(Feedback.status)
    )).all()
    by_status = {r[0]: int(r[1]) for r in counts}
    total = sum(by_status.values())
    return ok({
        "total": total,
        "pending": by_status.get("pending", 0),
        "replied": by_status.get("replied", 0),
        "items": [_out(r[0], r[1]) for r in rows],
    })


@router.get("/{feedback_id}", summary="反馈详情（含截图）", dependencies=[Depends(_require_admin)])
async def detail(feedback_id: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(_with_user().where(Feedback.id == feedback_id))).first()
    if not row:
        return fail("反馈不存在", status_code=404)
    return ok(_out(row[0], row[1], with_images=True))


class ReplyBody(BaseModel):
    reply: str = Field(min_length=1, max_length=2000)


@router.post("/{feedback_id}/reply", summary="回复反馈", dependencies=[Depends(_require_admin)])
async def reply(feedback_id: int, body: ReplyBody, db: AsyncSession = Depends(get_db)):
    text = body.reply.strip()
    if not text:
        return fail("回复内容不能为空")
    row = await db.get(Feedback, feedback_id)
    if row is None:
        return fail("反馈不存在", status_code=404)
    row.reply = text
    row.status = "replied"
    row.replied_at = _now()
    await db.commit()
    await db.refresh(row)
    return ok({"id": row.id, "status": row.status, "reply": row.reply, "replied_at": row.replied_at})
