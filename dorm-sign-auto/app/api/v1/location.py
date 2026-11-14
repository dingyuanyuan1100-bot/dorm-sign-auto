# -*- coding: utf-8 -*-
"""api/v1/location.py — 位置管理（提前记录，签到直接使用）"""
import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.common import fail, ok
from app.core.security import TZ, decrypt_password
from app.crud.dorm_account import dorm_account_crud
from app.crud.location import location_crud
from app.db.session import get_db
from app.deps import get_current_user
from app.models.location import Location
from app.models.user import User
from app.schemas.location import LocationCreate, LocationUpdate
from app.services.dorm_client import DormClient, DormError

router = APIRouter(prefix="/api/locations", tags=["位置"])


def _payload(loc: Location) -> dict:
    return {
        "id": loc.id,
        "name": loc.name,
        "lat": loc.lat,
        "lng": loc.lng,
        "address": loc.address,
        "is_default": bool(loc.is_default),
        "created_at": loc.created_at,
    }


@router.get("", summary="位置列表")
async def list_locations(user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    rows = await location_crud.list_by_user(db, user.id)
    return ok([_payload(r) for r in rows])


@router.post("", summary="新增位置")
async def create_location(body: LocationCreate,
                          user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    name = body.name.strip() or "位置"
    loc = await location_crud.add(db, user.id, name, body.lat, body.lng,
                                  body.address, body.is_default)
    return ok(_payload(loc), "位置已记录", 201)


@router.put("/{loc_id}", summary="更新位置")
async def update_location(loc_id: int, body: LocationUpdate,
                          user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    if not await location_crud.get_owned(db, loc_id, user.id):
        return fail("位置不存在或无权修改", 404)
    fields = {}
    if body.name is not None:
        fields["name"] = body.name.strip() or "位置"
    if body.lat is not None:
        fields["lat"] = body.lat.strip()
    if body.lng is not None:
        fields["lng"] = body.lng.strip()
    if body.address is not None:
        fields["address"] = body.address.strip()
    if not fields:
        return fail("没有可更新的字段")
    loc = await location_crud.get_owned(db, loc_id, user.id)
    for k, v in fields.items():
        setattr(loc, k, v)
    await db.commit()
    await db.refresh(loc)
    return ok(_payload(loc))


@router.delete("/{loc_id}", summary="删除位置")
async def delete_location(loc_id: int, user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    if not await location_crud.delete_owned(db, loc_id, user.id):
        return fail("位置不存在或无权删除", 404)
    return ok()


@router.post("/{loc_id}/default", summary="设为默认位置")
async def set_default(loc_id: int, user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    if not await location_crud.set_default(db, loc_id, user.id):
        return fail("位置不存在或无权操作", 404)
    return ok()


@router.get("/from-task", summary="从晚寝系统获取当前位置")
async def location_from_task(user: User = Depends(get_current_user),
                             db: AsyncSession = Depends(get_db)):
    acc = await dorm_account_crud.get_by_user(db, user.id)
    if acc is None:
        return fail("请先绑定晚寝账号")
    try:
        password = decrypt_password(acc.enc_password)
    except Exception as e:
        return fail(f"解密晚寝密码失败：{e}")
    client = DormClient()
    try:
        sess = client._new_session()
        token = await asyncio.to_thread(
            client.login, sess, acc.student_id, password)
        vo = await asyncio.to_thread(
            client.get_task_info, sess, token, datetime.now(TZ).strftime("%Y-%m-%d"),
            acc.student_id, password)
    except DormError as e:
        return fail(f"获取任务位置失败：{e}")
    except Exception as e:
        return fail(f"获取任务位置失败：{e}")
    return ok({
        "lat": str(vo.get("locationLat") or ""),
        "lng": str(vo.get("locationLng") or ""),
        "dormName": str(vo.get("dormName") or ""),
        "roomNo": str(vo.get("roomNo") or ""),
        "roomId": str(vo.get("roomId") or ""),
    })
