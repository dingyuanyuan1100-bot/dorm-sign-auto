# -*- coding: utf-8 -*-
"""
app/deps.py — 公共依赖（参考 market_system/app/deps.py）

- get_db：请求级异步数据库会话
- get_current_user：Bearer JWT 鉴权，返回 User 模型
- login_limiter：登录/注册按 IP 限流（内存滑动窗口，asyncio 版）
"""
import asyncio
import time

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import extract_user_id
from app.crud.user import user_crud
from app.db.session import get_db

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="未登录或登录已过期",
        headers={"WWW-Authenticate": "Bearer"},
    )
    user_id = extract_user_id(token)
    if user_id is None:
        raise credentials_exception
    user = await user_crud.get(db, user_id)
    if user is None:
        raise credentials_exception
    return user


# ---------- 按 IP 限流（asyncio 内存滑动窗口） ----------

class RateLimiter:
    """滑动窗口限流器：limit 次 / window 秒，按 key（IP）计数。"""

    def __init__(self, limit: int, window: float = 60.0):
        self.limit = max(1, limit)
        self.window = window
        self._hits: dict[str, list[float]] = {}
        self._lock = asyncio.Lock()

    async def allow(self, key: str) -> bool:
        now = time.monotonic()
        async with self._lock:
            arr = [t for t in self._hits.get(key, []) if now - t < self.window]
            if len(arr) >= self.limit:
                self._hits[key] = arr
                return False
            arr.append(now)
            self._hits[key] = arr
            return True

    def clear(self) -> None:
        self._hits.clear()


login_limiter = RateLimiter(int(settings.MAX_LOGIN_PER_MINUTE))
