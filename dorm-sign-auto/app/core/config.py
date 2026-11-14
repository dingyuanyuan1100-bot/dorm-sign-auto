# -*- coding: utf-8 -*-
"""
core/config.py — 应用配置（pydantic-settings，参考 market_system/app/core/confing.py）

配置优先级：环境变量 > .env > 默认值。
密钥兜底：.env 缺失时从 legacy/config.json 迁移（保证旧加密数据可解密），
          仍缺失则自动生成并回写 .env。
"""
import base64
import json
import logging
import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger("app.config")

# 项目根目录（app/core/config.py -> 项目根）
BASE_DIR = Path(__file__).resolve().parent.parent.parent


def _legacy_config() -> dict:
    """读取旧版 config.json（已归档在 legacy/ 下），用于密钥与任务 ID 迁移。"""
    path = BASE_DIR / "legacy" / "config.json"
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # 旧文件损坏不应阻断启动
        logger.warning("读取 legacy/config.json 失败：%s", e)
    return {}


def _generate_secret(length: int = 48) -> str:
    return base64.urlsafe_b64encode(os.urandom(length)).decode("ascii")


class Settings(BaseSettings):
    """应用配置。字段与旧 config.json 一一对应，命名统一为 SCREAMING_SNAKE。"""

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # 应用
    APP_NAME: str = "dorm-sign-auto"
    TIMEZONE: str = "Asia/Shanghai"
    DEBUG: bool = False
    HOST: str = "0.0.0.0"
    PORT: int = 8805

    # 数据库（SQLite 异步）
    DATABASE_URL: str = f"sqlite+aiosqlite:///{BASE_DIR / 'data' / 'dorm_sign.db'}"

    # 安全
    SECRET_KEY: str = ""                 # JWT 签名密钥
    DORM_PASSWORD_ENCRYPT_KEY: str = ""  # 晚寝密码 AES-256-GCM 加密密钥
    ADMIN_TOKEN: str = ""                 # 意见反馈管理后台口令；为空时管理接口一律拒绝
    TOKEN_TTL_DAYS: int = 30
    MAX_LOGIN_PER_MINUTE: int = 30

    # 晚寝上游
    DORM_BASE_URL: str = "https://xskq.ahut.edu.cn"
    DORM_TASK_ID: str = ""
    DORM_ENABLE_API_LOG: bool = True

    # 调度器（默认关闭，延续"签到已停止使用"的决定）
    SCHEDULER_ENABLED: bool = False
    SCHEDULER_SCAN_INTERVAL_SECONDS: int = 20
    SCHEDULER_MAX_CONCURRENT: int = 5
    # 到点后的错峰窗口（秒）：任务按 id+日期 取固定偏移，避免整点集中打上游
    SCHEDULER_JITTER_SECONDS: int = 90

    # CORS 白名单（逗号分隔；留空 = 仅同源）
    CORS_ORIGINS: str = ""


@lru_cache
def get_settings() -> Settings:
    """单例配置（lru_cache 保证只加载一次，参考 market_system 写法）。"""
    settings = Settings()
    legacy = _legacy_config()
    legacy_sec = legacy.get("security", {}) or {}
    legacy_dorm = legacy.get("dorm", {}) or {}

    changed = False
    if not settings.SECRET_KEY:
        settings.SECRET_KEY = legacy_sec.get("secret_key") or _generate_secret()
        changed = True
    if not settings.DORM_PASSWORD_ENCRYPT_KEY:
        settings.DORM_PASSWORD_ENCRYPT_KEY = (
            legacy_sec.get("dorm_password_encrypt_key") or _generate_secret()
        )
        changed = True
    if not settings.DORM_TASK_ID and legacy_dorm.get("task_id"):
        settings.DORM_TASK_ID = legacy_dorm["task_id"]
        changed = True

    if changed:
        _persist_env(settings)
        logger.info("已从 legacy/config.json 迁移或生成缺失的密钥/配置，回写到 .env")
    return settings


def _persist_env(settings: Settings) -> None:
    """把已补齐的关键配置写回 .env（追加/覆盖，保留其余键）。"""
    env_path = BASE_DIR / ".env"
    lines: list[str] = []
    if env_path.exists():
        lines = env_path.read_text(encoding="utf-8").splitlines()
    keys = {
        "SECRET_KEY": settings.SECRET_KEY,
        "DORM_PASSWORD_ENCRYPT_KEY": settings.DORM_PASSWORD_ENCRYPT_KEY,
        "DORM_TASK_ID": settings.DORM_TASK_ID,
    }
    existing = {line.split("=", 1)[0] for line in lines if "=" in line and not line.strip().startswith("#")}
    for k, v in keys.items():
        if k not in existing:
            lines.append(f"{k}={v}")
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


settings = get_settings()
