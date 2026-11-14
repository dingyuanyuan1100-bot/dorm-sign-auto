# -*- coding: utf-8 -*-
"""api/v1/dorm_account.py — 晚寝账号绑定（绑定前实时校验，密码 AES 加密存储）"""
import asyncio

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.common import fail, ok
from app.core.security import encrypt_password, mask_student_id
from app.crud.dorm_account import dorm_account_crud
from app.db.session import get_db
from app.deps import get_current_user
from app.models.user import User
from app.schemas.dorm_account import DormAccountBind
from app.services.dorm_client import DormClient, DormError

router = APIRouter(prefix="/api/dorm-account", tags=["晚寝账号"])


@router.put("", summary="绑定晚寝账号")
async def bind_account(body: DormAccountBind,
                       user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    client = DormClient()
    # 绑定前先验证晚寝账号可用（登录一次）
    try:
        await asyncio.to_thread(
            client.login, client._new_session(), body.student_id, body.password)
    except DormError as e:
        return fail(f"晚寝账号验证失败：{e}", 400)
    except Exception as e:
        return fail(f"晚寝账号验证失败：{e}", 400)
    enc = encrypt_password(body.password)
    acc = await dorm_account_crud.upsert(
        db, user.id, body.student_id, enc, body.nickname)
    return ok({"id": acc.id, "student_id": mask_student_id(body.student_id)})


@router.get("", summary="查看绑定信息")
async def get_account(user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    acc = await dorm_account_crud.get_by_user(db, user.id)
    if acc is None:
        return ok(None)
    return ok({
        "id": acc.id,
        "student_id": mask_student_id(acc.student_id),
        "nickname": acc.nickname,
        "created_at": acc.created_at,
    })


@router.delete("", summary="解绑晚寝账号")
async def unbind_account(user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    await dorm_account_crud.delete_by_user(db, user.id)
    return ok()
