# -*- coding: utf-8 -*-
"""crud/location.py — 位置数据访问"""
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.base import CRUDBase
from app.models.location import Location


class CRUDLocation(CRUDBase[Location, object, object]):
    async def list_by_user(self, db: AsyncSession, user_id: int) -> list[Location]:
        result = await db.execute(
            select(Location).where(Location.user_id == user_id)
            .order_by(Location.is_default.desc(), Location.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_owned(self, db: AsyncSession, loc_id: int, user_id: int) -> Location | None:
        result = await db.execute(
            select(Location).where(Location.id == loc_id, Location.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def add(
        self, db: AsyncSession, user_id: int, name: str, lat: str, lng: str,
        address: str = "", make_default: bool | None = None,
    ) -> Location:
        if make_default is None:
            count = await self._count(db, user_id)
            make_default = count == 0  # 第一个位置自动设为默认
        if make_default:
            await db.execute(
                update(Location).where(Location.user_id == user_id).values(is_default=0)
            )
        loc = Location(user_id=user_id, name=name, lat=lat, lng=lng,
                       address=address, is_default=1 if make_default else 0)
        db.add(loc)
        await db.commit()
        await db.refresh(loc)
        return loc

    async def _count(self, db: AsyncSession, user_id: int) -> int:
        result = await db.execute(
            select(Location.id).where(Location.user_id == user_id)
        )
        return len(result.scalars().all())

    async def set_default(self, db: AsyncSession, loc_id: int, user_id: int) -> bool:
        loc = await self.get_owned(db, loc_id, user_id)
        if loc is None:
            return False
        await db.execute(
            update(Location).where(Location.user_id == user_id).values(is_default=0)
        )
        loc.is_default = 1
        await db.commit()
        return True

    async def delete_owned(self, db: AsyncSession, loc_id: int, user_id: int) -> bool:
        loc = await self.get_owned(db, loc_id, user_id)
        if loc is None:
            return False
        await db.delete(loc)
        await db.commit()
        return True


location_crud = CRUDLocation(Location)
