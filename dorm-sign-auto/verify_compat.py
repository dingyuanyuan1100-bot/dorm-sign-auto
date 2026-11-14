# -*- coding: utf-8 -*-
"""兼容与调度器验证：
1) 旧库兼容：用旧版 SCHEMA + 旧 crypto/werkzeug 造库，新 ORM 读取并验证登录/解密
2) 调度器：compute_next_run / _is_due / _execute(mock 上游) / run_now 归属校验
"""
import asyncio
import json
import sqlite3
import sys
import tempfile
from datetime import datetime
from pathlib import Path

sys.path.insert(0, r"C:\Users\Administrator\Doubao\chats\2026-11-01\new-chat-2\dorm-sign-auto")
# 注意：不要把 legacy 目录加进 sys.path（legacy/app.py 会污染 app 包解析），
# 旧 crypto 用 importlib 按文件路径加载。

OUT = []
BASE = Path(r"C:\Users\Administrator\Doubao\chats\2026-11-01\new-chat-2\dorm-sign-auto")
LEGACY = BASE / "legacy"


def load_legacy_module(name: str, path: Path):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, str(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def check(name, cond, detail=""):
    OUT.append(f"[{'PASS' if cond else 'FAIL'}] {name} {detail}")
    return cond


# 旧 SCHEMA（与 legacy/db.py 一致）
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dorm_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL,
    enc_password TEXT NOT NULL,
    nickname TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT
);
CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dorm_account_id INTEGER NOT NULL REFERENCES dorm_accounts(id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK(mode IN ('once','daily')),
    sign_time TEXT NOT NULL,
    sign_date TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    remark TEXT NOT NULL DEFAULT '',
    last_run_at TEXT, last_status TEXT, last_msg TEXT, next_run_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT
);
CREATE TABLE IF NOT EXISTS sign_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, schedule_id INTEGER, run_at TEXT NOT NULL,
    success INTEGER NOT NULL DEFAULT 0, msg TEXT, detail TEXT
);
CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '默认位置',
    lat TEXT NOT NULL, lng TEXT NOT NULL, address TEXT NOT NULL DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT
);
"""

tmp_dir = tempfile.mkdtemp()
old_db = Path(tmp_dir) / "old_dorm.db"
conn = sqlite3.connect(str(old_db))
conn.executescript(SCHEMA)
# 模拟服务启动时的 ensure_compat（app/db/session.py）：旧库缺 location_id 自动补齐
conn.execute("ALTER TABLE schedules ADD COLUMN location_id INTEGER")
conn.commit()

# 旧数据：werkzeug pbkdf2 用户 + 旧 crypto AES 密文（文件级加载旧模块，避免 legacy/app.py 污染包名）
from werkzeug.security import generate_password_hash
old_crypto = load_legacy_module("legacy_crypto", LEGACY / "crypto.py")

from app.core.config import settings
enc_key = settings.DORM_PASSWORD_ENCRYPT_KEY
enc_pwd = old_crypto.encrypt(enc_key, "dorm-secret-999")

conn.execute("INSERT INTO users(username,password_hash) VALUES(?,?)",
             ("legacy_user", generate_password_hash("legacy-pwd-123")))
uid = conn.execute("SELECT id FROM users WHERE username='legacy_user'").fetchone()[0]
conn.execute("INSERT INTO dorm_accounts(user_id,student_id,enc_password,nickname) VALUES(?,?,?,?)",
             (uid, "20209999", enc_pwd, "旧用户"))
sid = conn.execute("SELECT id FROM dorm_accounts WHERE user_id=?", (uid,)).fetchone()[0]
conn.execute(
    "INSERT INTO schedules(user_id,dorm_account_id,mode,sign_time,sign_date,enabled,remark) VALUES(?,?,?,?,?,?,?)",
    (uid, sid, "daily", "23:30", None, 1, "旧任务"))
conn.commit()
conn.close()
check("旧库已构造", True)


async def compat_test():
    # 新 ORM 读取旧库
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    engine = create_async_engine(f"sqlite+aiosqlite:///{old_db}")
    Session = async_sessionmaker(engine, expire_on_commit=False)

    from app.models.user import User
    from app.models.dorm_account import DormAccount
    from app.models.schedule import Schedule
    from app.models.sign_log import SignLog
    from app.models.location import Location

    async with Session() as db:
        from sqlalchemy import select
        user = (await db.execute(select(User).where(User.username == "legacy_user"))).scalar_one_or_none()
        check("旧用户可读取", user is not None and user.id == uid)
        acc = (await db.execute(select(DormAccount).where(DormAccount.user_id == uid))).scalar_one_or_none()
        check("旧绑定账号可读取", acc is not None and acc.student_id == "20209999")
        sched = (await db.execute(select(Schedule).where(Schedule.user_id == uid))).scalar_one_or_none()
        check("旧任务可读取", sched is not None and sched.mode == "daily" and sched.sign_time == "23:30")

        # 旧哈希登录验证 + 旧密文解密
        from app.core.security import verify_password, decrypt_password
        check("旧 pbkdf2 登录验证", await verify_password("legacy-pwd-123", user.password_hash))
        check("旧密文解密还原", decrypt_password(acc.enc_password) == "dorm-secret-999")

        # 新 ORM 写日志（验证外键与写入）
        from app.crud.sign_log import sign_log_crud
        await sign_log_crud.add(db, uid, sched.id, True, "兼容测试", "manual")
    await engine.dispose()

    # ---------- 调度器单测 ----------
    from app.services.scheduler import SignScheduler
    from app.core.security import TZ

    class FakeClient:
        def __init__(self):
            self.calls = []
        def sign_once(self, student_id, password, location=None):
            self.calls.append((student_id, password, location))
            return {"code": 0, "success": True, "msg": "mock 签到成功"}

    fake = FakeClient()
    sched = SignScheduler(client=fake, scan_interval=20, max_concurrent=5)

    now = datetime.now(TZ)
    today = now.strftime("%Y-%m-%d")
    base = {
        "id": 1, "user_id": uid, "dorm_account_id": sid, "mode": "daily",
        "sign_time": "23:30", "sign_date": None, "enabled": 1, "remark": "",
        "last_run_at": None, "last_status": None, "last_msg": None,
        "next_run_at": None, "location_id": None,
        "student_id": "20209999", "enc_password": enc_pwd, "loc_lat": None, "loc_lng": None,
    }
    # compute_next_run: daily 今日已过时间 -> 明天
    nxt = sched.compute_next_run(base)
    check("daily 下次时间可计算", nxt is not None and nxt.startswith(today) or nxt is not None and nxt[:10] >= today,
          f"next={nxt}")
    # once 过期
    once = dict(base, mode="once", sign_date="2020-01-01")
    check("once 过期日期 not due", not await sched._is_due(once, now, today))
    # once 未到未来日期
    future = dict(base, mode="once", sign_date="2099-01-01")
    check("once 未来日期 not due", not await sched._is_due(future, now, today))
    # daily 当日已执行 -> not due
    done = dict(base, last_run_at=today + " 08:00:00")
    check("daily 当日已执行 not due", not await sched._is_due(done, now, today))
    # daily 到点未执行 -> due
    due = dict(base, sign_time=f"{now.hour:02d}:{now.minute:02d}")
    check("daily 到点 due", await sched._is_due(due, now, today))
    # _execute with mock
    await sched._execute(dict(base, sign_time=f"{now.hour:02d}:{now.minute:02d}"), "manual")
    check("mock 签到已调用", len(fake.calls) == 1 and fake.calls[0][0] == "20209999")

    # run_now 归属校验（用临时库会话，直接构造归属失败）
    from sqlalchemy import text
    async with Session() as db:
        res = await sched.run_now(999999, uid)
        check("run_now 越权任务拒绝", not res["success"])


asyncio.run(compat_test())

Path(BASE / "verify_compat_out.txt").write_text("\n".join(OUT), encoding="utf-8")
print("COMPAT_DONE")
