# -*- coding: utf-8 -*-
"""crud/user.py — 用户数据访问"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.base import CRUDBase
from app.models.user import User


class CRUDUser(CRUDBase[User, object, object]):
    async def get_by_username(self, db: AsyncSession, username: str) -> User | None:
        result = await db.execute(select(User).where(User.username == username))
        return result.scalar_one_or_none()

    async def create_user(self, db: AsyncSession, username: str, password_hash: str) -> User:
        user = User(username=username, password_hash=password_hash)
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user


user_crud = CRUDUser(User)
