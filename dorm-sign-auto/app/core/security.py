# -*- coding: utf-8 -*-
"""
core/security.py — 安全工具（参考 market_system/app/core/security.py）

1. 密码哈希：新用户使用 Argon2id（抗 GPU 爆破的现代算法）；
   旧用户哈希为 werkzeug pbkdf2:sha256，验证时自动兼容（不要求旧用户重置密码）。
2. 登录态：JWT（HS256，payload sub=用户 id），无状态、标准可校验。
3. 晚寝密码加密：AES-256-GCM（密文带随机 nonce + 认证 tag），密钥来自配置。
"""
import asyncio
import base64
import hashlib
import os
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError as Argon2VerificationError
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from jose import JWTError, jwt
from werkzeug.security import check_password_hash as _werkzeug_check

from app.core.config import settings

# ---------- 时区与时间 ----------

TZ = ZoneInfo(settings.TIMEZONE)


def now_str() -> str:
    """本地时区时间字符串，与旧库格式（YYYY-MM-DD HH:MM:SS）保持一致。"""
    return datetime.now(TZ).strftime("%Y-%m-%d %H:%M:%S")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ---------- 密码哈希（Argon2id + 旧哈希兼容） ----------

_pwd_hasher = PasswordHasher()

_ALGON2_PREFIXES = ("$argon2id$", "$argon2i$", "$argon2d$")


async def hash_password(password: str) -> str:
    """新密码统一使用 Argon2id。"""
    return await asyncio.to_thread(_pwd_hasher.hash, password)


async def verify_password(plain: str, hashed: str) -> bool:
    """验证密码：Argon2 优先；旧库的 werkzeug pbkdf2 哈希自动兼容。"""
    if not hashed:
        return False

    def _verify() -> bool:
        if hashed.startswith(_ALGON2_PREFIXES):
            try:
                return _pwd_hasher.verify(hashed, plain)
            except Argon2VerificationError:
                return False
            except Exception:
                return False
        # 旧格式（werkzeug generate_password_hash 默认 pbkdf2:sha256）
        try:
            return _werkzeug_check(hashed, plain)
        except Exception:
            return False

    return await asyncio.to_thread(_verify)


# ---------- JWT ----------

def create_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """签发 JWT：payload 内放入 sub=用户 id，默认 TTL 由配置决定。"""
    to_encode = data.copy()
    expire = now_utc() + (expires_delta or timedelta(days=settings.TOKEN_TTL_DAYS))
    to_encode.update({"exp": expire, "iat": now_utc()})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm="HS256")


def verify_token(token: str) -> Optional[dict]:
    """校验 JWT；非法/过期返回 None。"""
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
    except JWTError:
        return None


def extract_user_id(token: str) -> Optional[int]:
    payload = verify_token(token)
    if not payload:
        return None
    sub = payload.get("sub")
    try:
        return int(sub) if sub is not None else None
    except (TypeError, ValueError):
        return None


# ---------- AES-256-GCM（晚寝密码加密存储） ----------

AES_PREFIX = "v1:"  # 密文版本头，便于将来轮换算法


def _derive_key(key_material: str) -> bytes:
    """任意长度密钥材料 -> SHA-256 派生 32 字节。"""
    return hashlib.sha256(key_material.encode("utf-8")).digest()


def encrypt_password(plaintext: str) -> str:
    """加密：base64(v1 + nonce + tag + ciphertext)。密钥取配置值。"""
    key = _derive_key(settings.DORM_PASSWORD_ENCRYPT_KEY)
    nonce = os.urandom(12)
    ct = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), None)
    return AES_PREFIX + base64.b64encode(nonce + ct).decode("ascii")


def decrypt_password(token: str) -> str:
    """解密；密文非法或密钥错误时抛异常。"""
    if not token:
        raise ValueError("密文为空")
    raw = base64.b64decode(token[len(AES_PREFIX):] if token.startswith(AES_PREFIX) else token)
    nonce, ct = raw[:12], raw[12:]
    key = _derive_key(settings.DORM_PASSWORD_ENCRYPT_KEY)
    return AESGCM(key).decrypt(nonce, ct, None).decode("utf-8")


# ---------- 脱敏 ----------

def mask_student_id(sid: str) -> str:
    """学号脱敏：<=6 位保留前 2 位，否则保留前 3 后 2。"""
    sid = str(sid or "")
    if len(sid) <= 6:
        return sid[:2] + "****"
    return sid[:3] + "****" + sid[-2:]
