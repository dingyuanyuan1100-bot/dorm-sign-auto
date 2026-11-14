# -*- coding: utf-8 -*-
"""复验：legacy 配置迁移一致性"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, r"C:\Users\Administrator\Doubao\chats\2026-11-01\new-chat-2\dorm-sign-auto")

out = []
legacy = json.loads(
    Path(r"C:\Users\Administrator\Doubao\chats\2026-11-01\new-chat-2\dorm-sign-auto\legacy\config.json")
    .read_text(encoding="utf-8"))
from app.core.config import settings
out.append(f"SECRET_KEY 已配置: {bool(settings.SECRET_KEY)}")
out.append(f"ENCRYPT_KEY 已配置: {bool(settings.DORM_PASSWORD_ENCRYPT_KEY)}")
out.append(f"TASK_ID: {settings.DORM_TASK_ID or '(空)'}")
out.append(f"SCHEDULER_ENABLED: {settings.SCHEDULER_ENABLED}")
out.append(f"MIGRATE_SECRET_MATCH: {settings.SECRET_KEY == legacy['security']['secret_key']}")
out.append(f"MIGRATE_ENCRYPT_MATCH: {settings.DORM_PASSWORD_ENCRYPT_KEY == legacy['security']['dorm_password_encrypt_key']}")
out.append(f".env 已生成: {Path(r'C:\Users\Administrator\Doubao\chats\2026-11-01\new-chat-2\dorm-sign-auto\.env').exists()}")

Path(r"C:\Users\Administrator\Doubao\chats\2026-11-01\new-chat-2\dorm-sign-auto\verify_config_out.txt").write_text(
    "\n".join(out), encoding="utf-8")
