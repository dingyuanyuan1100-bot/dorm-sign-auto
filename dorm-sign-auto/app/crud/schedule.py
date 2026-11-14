# -*- coding: utf-8 -*-
"""crud/schedule.py — 签到任务数据访问（归属强制校验）"""
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.base import CRUDBase
from app.models.dorm_account import DormAccount
from app.models.location import Location
from app.models.schedule import Schedule


class CRUDSchedule(CRUDBase[Schedule, object, object]):
    # 允许更新的字段白名单
    _ALLOWED = {"mode", "sign_time", "sign_date", "enabled", "remark", "location_id"}

    async def list_by_user(self, db: AsyncSession, user_id: int) -> list[Schedule]:
        result = await db.execute(
            select(Schedule).where(Schedule.user_id == user_id)
            .order_by(Schedule.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_owned(self, db: AsyncSession, sid: int, user_id: int) -> Schedule | None:
        result = await db.execute(
            select(Schedule).where(Schedule.id == sid, Schedule.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def get_full(self, db: AsyncSession, sid: int) -> dict | None:
        """调度器/手动触发用：任务 + 账号凭证 + 位置，一次查询。"""
        result = await db.execute(
            select(Schedule, DormAccount.student_id, DormAccount.enc_password,
                   Location.lat, Location.lng)
            .join(DormAccount, DormAccount.id == Schedule.dorm_account_id)
            .outerjoin(Location, Location.id == Schedule.location_id)
            .where(Schedule.id == sid)
        )
        row = result.first()
        if row is None:
            return None
        s, student_id, enc_password, loc_lat, loc_lng = row
        return {
            **{c.name: getattr(s, c.name) for c in s.__table__.columns},
            "student_id": student_id,
            "enc_password": enc_password,
            "loc_lat": loc_lat,
            "loc_lng": loc_lng,
        }

    async def list_enabled_full(self, db: AsyncSession) -> list[dict]:
        """调度器拉取所有启用任务（跨用户），含账号凭证与位置。"""
        result = await db.execute(
            select(Schedule, DormAccount.student_id, DormAccount.enc_password,
                   Location.lat, Location.lng)
            .join(DormAccount, DormAccount.id == Schedule.dorm_account_id)
            .outerjoin(Location, Location.id == Schedule.location_id)
            .where(Schedule.enabled == 1)
        )
        out = []
        for s, student_id, enc_password, loc_lat, loc_lng in result.all():
            out.append({
                **{c.name: getattr(s, c.name) for c in s.__table__.columns},
                "student_id": student_id,
                "enc_password": enc_password,
                "loc_lat": loc_lat,
                "loc_lng": loc_lng,
            })
        return out

    async def create_schedule(
        self, db: AsyncSession, user_id: int, dorm_account_id: int, mode: str,
        sign_time: str, sign_date: str | None, remark: str = "",
        location_id: int | None = None,
    ) -> Schedule:
        s = Schedule(user_id=user_id, dorm_account_id=dorm_account_id, mode=mode,
                     sign_time=sign_time, sign_date=sign_date, enabled=1,
                     remark=remark, location_id=location_id)
        db.add(s)
        await db.commit()
        await db.refresh(s)
        return s

    async def update_owned(self, db: AsyncSession, sid: int, user_id: int, **fields) -> bool:
        updates = {k: v for k, v in fields.items() if k in self._ALLOWED}
        if not updates:
            return False
        result = await db.execute(
            update(Schedule)
            .where(Schedule.id == sid, Schedule.user_id == user_id)
            .values(**updates)
        )
        await db.commit()
        return result.rowcount > 0

    async def delete_owned(self, db: AsyncSession, sid: int, user_id: int) -> bool:
        s = await self.get_owned(db, sid, user_id)
        if s is None:
            return False
        await db.delete(s)
        await db.commit()
        return True

    async def set_result(self, db: AsyncSession, sid: int, status: str, msg: str,
                         next_run_at: str | None) -> None:
        await db.execute(
            update(Schedule).where(Schedule.id == sid)
            .values(last_run_at=now_str(), last_status=status, last_msg=msg,
                    next_run_at=next_run_at)
        )
        await db.commit()

    async def set_enabled(self, db: AsyncSession, sid: int, enabled: int) -> None:
        await db.execute(
            update(Schedule).where(Schedule.id == sid).values(enabled=enabled)
        )
        await db.commit()

    async def set_next_run(self, db: AsyncSession, sid: int, next_run_at: str | None) -> None:
        await db.execute(
            update(Schedule).where(Schedule.id == sid).values(next_run_at=next_run_at)
        )
        await db.commit()


schedule_crud = CRUDSchedule(Schedule)

# 避免循环依赖：从 security 导入 now_str 用于 set_result
from app.core.security import now_str  # noqa: E402
