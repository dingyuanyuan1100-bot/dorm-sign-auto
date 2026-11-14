# -*- coding: utf-8 -*-
"""crud/dorm_account.py — 晚寝账号数据访问"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.base import CRUDBase
from app.models.dorm_account import DormAccount


class CRUDDormAccount(CRUDBase[DormAccount, object, object]):
    async def get_by_user(self, db: AsyncSession, user_id: int) -> DormAccount | None:
        result = await db.execute(select(DormAccount).where(DormAccount.user_id == user_id))
        return result.scalar_one_or_none()

    async def list_by_student_id(self, db: AsyncSession, student_id: str) -> list[DormAccount]:
        """按学号取所有绑定记录（同一学号可能绑过多个 App 账号）。"""
        result = await db.execute(
            select(DormAccount)
            .where(DormAccount.student_id == student_id)
            .order_by(DormAccount.id)
        )
        return list(result.scalars().all())

    async def upsert(
        self, db: AsyncSession, user_id: int, student_id: str,
        enc_password: str, nickname: str = "",
    ) -> DormAccount:
        acc = await self.get_by_user(db, user_id)
        if acc:
            acc.student_id = student_id
            acc.enc_password = enc_password
            acc.nickname = nickname
            await db.commit()
            await db.refresh(acc)
            return acc
        acc = DormAccount(user_id=user_id, student_id=student_id,
                          enc_password=enc_password, nickname=nickname)
        db.add(acc)
        await db.commit()
        await db.refresh(acc)
        return acc

    async def delete_by_user(self, db: AsyncSession, user_id: int) -> bool:
        acc = await self.get_by_user(db, user_id)
        if acc is None:
            return False
        await db.delete(acc)
        await db.commit()
        return True


dorm_account_crud = CRUDDormAccount(DormAccount)
