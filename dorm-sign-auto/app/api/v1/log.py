# -*- coding: utf-8 -*-
"""api/v1/log.py — 签到执行日志"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.common import ok
from app.crud.sign_log import sign_log_crud
from app.db.session import get_db
from app.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/api/logs", tags=["日志"])


@router.get("", summary="执行日志")
async def list_logs(limit: int = 50, user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    rows = await sign_log_crud.list_by_user(db, user.id, limit)
    return ok([{
        "id": r.id,
        "schedule_id": r.schedule_id,
        "run_at": r.run_at,
        "success": bool(r.success),
        "msg": r.msg,
        "detail": r.detail,
    } for r in rows])
