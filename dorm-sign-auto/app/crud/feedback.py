# -*- coding: utf-8 -*-
"""crud/feedback.py — 意见反馈读写"""
import json
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feedback import Feedback


def _today() -> str:
    return datetime.now().strftime("%Y%m%d")


class FeedbackCRUD:
    async def next_code(self, db: AsyncSession) -> str:
        """编号 FB-YYYYMMDD-NNNN，当天自增。当天并发撞号时由唯一索引兜底，调用方重试一次。"""
        day = _today()
        prefix = f"FB-{day}-"
        res = await db.execute(
            select(func.count()).select_from(Feedback).where(Feedback.code.like(prefix + "%"))
        )
        seq = int(res.scalar() or 0) + 1
        return f"{prefix}{seq:04d}"

    async def create(
        self,
        db: AsyncSession,
        *,
        user_id: int,
        type: str,
        content: str,
        images: list[str] | None = None,
    ) -> Feedback:
        images = images or []
        row = Feedback(
            user_id=user_id,
            code=await self.next_code(db),
            type=type,
            content=content,
            images=json.dumps(images, ensure_ascii=False) if images else None,
            status="pending",
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        return row

    async def list_by_user(
        self, db: AsyncSession, user_id: int, limit: int = 50
    ) -> list[Feedback]:
        res = await db.execute(
            select(Feedback)
            .where(Feedback.user_id == user_id)
            .order_by(Feedback.id.desc())
            .limit(limit)
        )
        return list(res.scalars().all())

    async def get_owned(
        self, db: AsyncSession, feedback_id: int, user_id: int
    ) -> Feedback | None:
        res = await db.execute(
            select(Feedback).where(
                Feedback.id == feedback_id, Feedback.user_id == user_id
            )
        )
        return res.scalar_one_or_none()

    async def stats(self, db: AsyncSession, user_id: int) -> tuple[int, int]:
        total = await db.scalar(
            select(func.count()).select_from(Feedback).where(Feedback.user_id == user_id)
        )
        pending = await db.scalar(
            select(func.count())
            .select_from(Feedback)
            .where(Feedback.user_id == user_id, Feedback.status == "pending")
        )
        return int(total or 0), int(pending or 0)


feedback_crud = FeedbackCRUD()


def image_count_of(row: Feedback) -> int:
    if not row.images:
        return 0
    try:
        data = json.loads(row.images)
        return len(data) if isinstance(data, list) else 0
    except (ValueError, TypeError):
        return 0
