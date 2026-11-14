# -*- coding: utf-8 -*-
"""意见反馈接口冒烟测试：提交 → 列表 → 详情 → 越权与非法入参反例"""
import asyncio
import os
import sys
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./data/verify_feedback.db"
os.environ["MAX_LOGIN_PER_MINUTE"] = "9999"

Path("data").mkdir(exist_ok=True)
DB = Path("data/verify_feedback.db")
for p in (DB, Path(str(DB) + "-wal"), Path(str(DB) + "-shm")):
    if p.exists():
        p.unlink()

sys.path.insert(0, str(Path(__file__).parent))

import httpx  # noqa: E402

from app.core.security import create_token, hash_password  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import async_session, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.user import User  # noqa: E402

OUT = []
PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


def check(name, cond, detail=""):
    OUT.append((bool(cond), name, detail))
    print(("[PASS] " if cond else "[FAIL] ") + name + (f" | {detail}" if detail else ""))


async def seed():
    ids = {}
    async with async_session() as db:
        for key, uname in [("a", "fb_user_a"), ("b", "fb_user_b")]:
            u = User(username=uname, password_hash=await hash_password("secret123"))
            db.add(u)
            await db.commit()
            await db.refresh(u)
            ids[key] = u.id
    return ids


async def main():
    await init_db(Base)
    ids = await seed()
    token_a = create_token({"sub": str(ids["a"])})
    token_b = create_token({"sub": str(ids["b"])})
    ha = {"Authorization": f"Bearer {token_a}"}
    hb = {"Authorization": f"Bearer {token_b}"}

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        # 1) 提交
        r = await c.post("/api/feedback", json={
            "type": "功能异常",
            "content": "签到定位一直显示未定位，重启也没用",
            "images": [PNG],
        }, headers=ha)
        check("提交反馈 200", r.status_code == 200, f"status={r.status_code} {r.text[:120]}")
        body = r.json()
        data = body.get("data") or {}
        code = data.get("code")
        fid = data.get("id")
        check("编号格式 FB-YYYYMMDD-NNNN", bool(code) and code.startswith("FB-") and len(code) == 16, str(code))
        check("状态为处理中", data.get("status") == "pending", str(data.get("status")))
        check("截图计数 1", data.get("image_count") == 1, str(data.get("image_count")))

        # 2) 同日第二条编号自增
        r2 = await c.post("/api/feedback", json={
            "type": "体验建议", "content": "希望支持批量导入签到任务", "images": [],
        }, headers=ha)
        d2 = r2.json().get("data") or {}
        check("同日第二条编号自增", d2.get("code", "")[-4:] == f"{int(code[-4:]) + 1:04d}",
              f'{code} → {d2.get("code")}')

        # 3) 列表
        r3 = await c.get("/api/feedback", headers=ha)
        d3 = r3.json().get("data") or {}
        check("列表返回 2 条 / 均处理中",
              d3.get("total") == 2 and d3.get("pending") == 2,
              f'total={d3.get("total")} pending={d3.get("pending")}')
        check("列表按时间倒序", (d3.get("items") or [{}])[0].get("id") == d2.get("id"),
              f'first={(d3.get("items") or [{}])[0].get("code")}')

        # 4) 详情
        r4 = await c.get(f"/api/feedback/{fid}", headers=ha)
        d4 = r4.json().get("data") or {}
        check("详情带回截图数组", len(d4.get("images") or []) == 1, f'images={len(d4.get("images") or [])}')

        # 5) 反例：他人无权查看
        r5 = await c.get(f"/api/feedback/{fid}", headers=hb)
        check("越权查看他人反馈 404", r5.status_code == 404, f"status={r5.status_code}")

        # 6) 反例：他人列表为空
        r6 = await c.get("/api/feedback", headers=hb)
        check("他人列表为空", (r6.json().get("data") or {}).get("total") == 0,
              f'total={(r6.json().get("data") or {}).get("total")}')

        # 7) 反例：空描述 / 太短 / 类型非法 / 截图超限
        for payload, label, want in [
            ({"type": "功能异常", "content": "   "}, "空描述", 400),
            ({"type": "功能异常", "content": "短"}, "描述过短", 400),
            ({"type": "乱写", "content": "这里是一段足够长的描述"}, "类型非法", 400),
            ({"type": "功能异常", "content": "这里是一段足够长的描述", "images": [PNG] * 4}, "截图超 3 张", 422),
            ({"type": "功能异常", "content": "这里是一段足够长的描述", "images": ["http://x/y.png"]}, "截图非 dataURL", 400),
        ]:
            rr = await c.post("/api/feedback", json=payload, headers=ha)
            check(f"反例：{label} 被拦", rr.status_code == want,
                  f"status={rr.status_code} want={want} msg={(rr.json() or {}).get('msg')}")

        # 8) 反例：未登录
        r8 = await c.get("/api/feedback")
        check("未登录 401", r8.status_code == 401, f"status={r8.status_code}")

    ok = sum(1 for p, _, _ in OUT if p)
    print(f"\n===== {ok}/{len(OUT)} passed =====")
    return 0 if ok == len(OUT) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
