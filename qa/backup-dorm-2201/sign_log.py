# -*- coding: utf-8 -*-
"""crud/sign_log.py — 执行日志数据访问"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_str
from app.crud.base import CRUDBase
from app.models.sign_log import SignLog


class CRUDSignLog(CRUDBase[SignLog, object, object]):
    async def list_by_user(self, db: AsyncSession, user_id: int, limit: int = 50) -> list[SignLog]:
        result = await db.execute(
            select(SignLog).where(SignLog.user_id == user_id)
            .order_by(SignLog.run_at.desc()).limit(max(1, min(limit, 200)))
        )
        return list(result.scalars().all())

    async def add(self, db: AsyncSession, user_id: int, schedule_id: int | None,
                  success: bool, msg: str, detail: str = "") -> SignLog:
        log = SignLog(user_id=user_id, schedule_id=schedule_id, run_at=now_str(),
                      success=1 if success else 0, msg=msg, detail=detail)
        db.add(log)
        await db.commit()
        await db.refresh(log)
        return log


sign_log_crud = CRUDSignLog(SignLog)
