# -*- coding: utf-8 -*-
"""api/v1/schedule.py — 签到任务（CRUD + 立即签到）"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.common import fail, ok
from app.core.security import mask_student_id
from app.crud.dorm_account import dorm_account_crud
from app.crud.location import location_crud
from app.crud.schedule import schedule_crud
from app.db.session import get_db
from app.deps import get_current_user
from app.models.user import User
from app.schemas.schedule import ScheduleCreate, ScheduleUpdate
from app.services.scheduler import get_scheduler

router = APIRouter(prefix="/api/schedules", tags=["签到任务"])


async def _owned_location(db: AsyncSession, loc_id: int, user_id: int) -> bool:
    return await location_crud.get_owned(db, loc_id, user_id) is not None


@router.post("", summary="创建签到任务")
async def create_schedule(body: ScheduleCreate,
                          user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    acc = await dorm_account_crud.get_by_user(db, user.id)
    if acc is None:
        return fail("请先绑定晚寝账号")
    if body.location_id not in (None, 0):
        if not await _owned_location(db, body.location_id, user.id):
            return fail("所选位置不存在或无权使用")
        location_id = body.location_id
    else:
        location_id = None
    s = await schedule_crud.create_schedule(
        db, user.id, acc.id, body.mode, body.sign_time,
        body.sign_date or None, body.remark, location_id)
    await get_scheduler().recompute(s.id)
    return ok({"id": s.id}, "创建成功", 201)


@router.get("", summary="任务列表")
async def list_schedules(user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    rows = await schedule_crud.list_by_user(db, user.id)
    result = []
    for r in rows:
        acc = await dorm_account_crud.get(db, r.dorm_account_id)
        student_id = acc.student_id if acc else ""
        loc = None
        if r.location_id is not None:
            loc_obj = await location_crud.get(db, r.location_id)
            loc = ({
                "id": r.location_id,
                "name": loc_obj.name if loc_obj else None,
                "lat": loc_obj.lat if loc_obj else None,
                "lng": loc_obj.lng if loc_obj else None,
                "address": loc_obj.address if loc_obj else None,
            } if loc_obj else {"id": r.location_id, "name": None, "lat": None,
                               "lng": None, "address": None})
        result.append({
            "id": r.id,
            "mode": r.mode,
            "sign_time": r.sign_time,
            "sign_date": r.sign_date,
            "enabled": bool(r.enabled),
            "remark": r.remark,
            "student_id": mask_student_id(student_id),
            "last_run_at": r.last_run_at,
            "last_status": r.last_status,
            "last_msg": r.last_msg,
            "next_run_at": r.next_run_at,
            "created_at": r.created_at,
            "location": loc,
        })
    return ok(result)


@router.put("/{sid}", summary="更新任务")
async def update_schedule(sid: int, body: ScheduleUpdate,
                          user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    if not await schedule_crud.get_owned(db, sid, user.id):
        return fail("任务不存在或无权修改", 404)
    fields = {}
    if body.mode is not None:
        fields["mode"] = body.mode
    if body.sign_time is not None:
        fields["sign_time"] = body.sign_time
    if "sign_date" in body.model_fields_set:
        fields["sign_date"] = body.sign_date
    if body.enabled is not None:
        fields["enabled"] = 1 if body.enabled else 0
    if body.remark is not None:
        fields["remark"] = body.remark.strip()
    if "location_id" in body.model_fields_set:
        loc_id = body.location_id
        if loc_id in (None, 0):
            fields["location_id"] = None
        else:
            if not await _owned_location(db, loc_id, user.id):
                return fail("所选位置不存在或无权使用")
            fields["location_id"] = loc_id
    if not fields:
        return fail("没有可更新的字段")
    if not await schedule_crud.update_owned(db, sid, user.id, **fields):
        return fail("任务不存在或无权修改", 404)
    await get_scheduler().recompute(sid)
    return ok()


@router.delete("/{sid}", summary="删除任务")
async def delete_schedule(sid: int, user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    if not await schedule_crud.delete_owned(db, sid, user.id):
        return fail("任务不存在或无权删除", 404)
    return ok()


@router.post("/{sid}/run", summary="立即签到")
async def run_schedule(sid: int, user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    s = await schedule_crud.get_owned(db, sid, user.id)
    if s is None:
        return fail("任务不存在或无权操作", 404)
    return ok(await get_scheduler().run_now(sid, user.id))
