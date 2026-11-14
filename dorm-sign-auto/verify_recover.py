# -*- coding: utf-8 -*-
"""找回密码流程冒烟测试：验证身份 → 选择账号 → 重置密码 → 用新密码登录

上游晚寝系统用 mock 顶替（真实登录需要学生学号，无法在本地跑），
其余链路（凭证签发、归属校验、哈希写库、登录）全部走真实代码。
"""
import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./data/verify_recover.db"
os.environ["MAX_LOGIN_PER_MINUTE"] = "9999"

Path("data").mkdir(exist_ok=True)
DB = Path("data/verify_recover.db")
for p in (DB, Path(str(DB) + "-wal"), Path(str(DB) + "-shm")):
    if p.exists():
        p.unlink()

sys.path.insert(0, str(Path(__file__).parent))

import httpx  # noqa: E402

from app.core.security import encrypt_password, hash_password  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import async_session, engine, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.dorm_account import DormAccount  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.dorm_client import DormError  # noqa: E402

OUT = []


def check(name, cond, detail=""):
    OUT.append((bool(cond), name, detail))
    print(("[PASS] " if cond else "[FAIL] ") + name + (f" | {detail}" if detail else ""))


SID = "20230101"


async def seed():
    """三个 App 账号：a/b 绑同一学号，c 绑另一个学号（越权用例）。"""
    ids = {}
    async with async_session() as db:
        for key, uname, pwd, nick, sid in [
            ("a", "recover_a", "oldpass_a", "灰灰", SID),
            ("b", "recover_b", "oldpass_b", "13ahjk", SID),
            ("c", "recover_c", "oldpass_c", "越权号", "20239999"),
        ]:
            u = User(username=uname, password_hash=await hash_password(pwd))
            db.add(u)
            await db.commit()
            await db.refresh(u)
            db.add(DormAccount(user_id=u.id, student_id=sid,
                               enc_password=encrypt_password("dorm123456"),
                               nickname=nick))
            await db.commit()
            ids[key] = u.id
    return ids


async def main():
    await init_db(Base)
    ids = await seed()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        with patch("app.api.v1.auth.DormClient") as MockClient:
            MockClient.return_value.login.return_value = "fake-upstream-token"

            # ---- 1. 验证身份 ----
            r = await c.post("/api/auth/recover/verify",
                             json={"student_id": SID, "password": "dorm123456"})
            body = r.json()
            data = body.get("data") or {}
            accounts = data.get("accounts") or []
            ticket = data.get("ticket")
            check("验证身份 200", r.status_code == 200, f"code={r.status_code} msg={body.get('msg')}")
            check("返回该学号下 2 个账号", len(accounts) == 2,
                  str([a.get("username") for a in accounts]))
            check("账号含昵称/脱敏学号",
                  all(a.get("nickname") and a.get("student_id") for a in accounts),
                  str(accounts[0] if accounts else None))
            check("学号已脱敏", accounts and accounts[0].get("student_id") != SID,
                  str(accounts[0].get("student_id") if accounts else None))
            check("签发临时凭证", bool(ticket))

            # ---- 2. 重置 b 的密码 ----
            r = await c.post("/api/auth/recover/reset",
                             json={"ticket": ticket, "user_id": ids["b"], "password": "newpass_b1"})
            check("重置密码 200", r.status_code == 200, f"code={r.status_code} msg={r.json().get('msg')}")

            r = await c.post("/api/auth/login",
                             json={"username": "recover_b", "password": "newpass_b1"})
            check("新密码可登录", r.status_code == 200, f"code={r.status_code}")

            r = await c.post("/api/auth/login",
                             json={"username": "recover_a", "password": "oldpass_a"})
            check("同组另一账号密码未被改动", r.status_code == 200, f"code={r.status_code}")

            # ---- 3. 同密码拒绝 ----
            r = await c.post("/api/auth/recover/reset",
                             json={"ticket": ticket, "user_id": ids["a"], "password": "newpass_a1"})
            check("重置 a 密码 200", r.status_code == 200, f"code={r.status_code}")

            r = await c.post("/api/auth/recover/reset",
                             json={"ticket": ticket, "user_id": ids["a"], "password": "newpass_a1"})
            check("新密码与原密码相同被拒 400", r.status_code == 400, f"code={r.status_code} msg={r.json().get('msg')}")

            # ---- 4. 越权：用 SID 的凭证改别的学号账号 ----
            r = await c.post("/api/auth/recover/reset",
                             json={"ticket": ticket, "user_id": ids["c"], "password": "hacked123"})
            check("跨学号重置被拒 400", r.status_code == 400, f"code={r.status_code} msg={r.json().get('msg')}")

            r = await c.post("/api/auth/login",
                             json={"username": "recover_c", "password": "oldpass_c"})
            check("越权目标密码未被改", r.status_code == 200, f"code={r.status_code}")

            # ---- 5. 伪造凭证 ----
            r = await c.post("/api/auth/recover/reset",
                             json={"ticket": "not-a-real-ticket", "user_id": ids["c"], "password": "hacked123"})
            check("伪造凭证被拒 400", r.status_code == 400, f"code={r.status_code} msg={r.json().get('msg')}")

            # ---- 6. 上游密码错 ----
            MockClient.return_value.login.side_effect = DormError("bad credentials")
            r = await c.post("/api/auth/recover/verify",
                             json={"student_id": SID, "password": "wrongpass"})
            check("晚寝密码错 400", r.status_code == 400, f"code={r.status_code} msg={r.json().get('msg')}")

            # ---- 7. 学号未绑定过账号 ----
            MockClient.return_value.login.side_effect = None
            r = await c.post("/api/auth/recover/verify",
                             json={"student_id": "20990000", "password": "dorm123456"})
            check("学号无绑定账号 404", r.status_code == 404, f"code={r.status_code} msg={r.json().get('msg')}")

            # ---- 8. 学号格式校验 ----
            r = await c.post("/api/auth/recover/verify",
                             json={"student_id": "a", "password": "dorm123456"})
            check("学号格式不合法 422", r.status_code == 422, f"code={r.status_code}")

    await engine.dispose()

    ok_n = sum(1 for p, _, _ in OUT if p)
    print(f"\n===== {ok_n}/{len(OUT)} 通过 =====")
    return all(p for p, _, _ in OUT)


if __name__ == "__main__":
    sys.exit(0 if asyncio.run(main()) else 1)
