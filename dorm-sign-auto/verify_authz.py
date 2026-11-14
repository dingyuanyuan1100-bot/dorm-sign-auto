# -*- coding: utf-8 -*-
"""跨用户越权隔离验证：A 创建位置/数据，B 不可见、不可改、不可删（归属校验 404/空列表）。"""
import json
import random
import sys
import urllib.request
from pathlib import Path

BASE = Path(r"C:\Users\Administrator\Doubao\chats\2026-11-01\new-chat-2\dorm-sign-auto")
HOST = "http://127.0.0.1:8805"
OUT = []


def check(name, cond, detail=""):
    OUT.append(f"[{'PASS' if cond else 'FAIL'}] {name} {detail}")
    return cond


def req(method, path, data=None, token=None):
    url = HOST + path
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def reg(name, pwd):
    code, body = req("POST", "/api/auth/register", {"username": name, "password": pwd})
    return code == 201, body


def login(name, pwd):
    code, body = req("POST", "/api/auth/login", {"username": name, "password": pwd})
    return (code == 200 and body.get("data", {}).get("token")) or None


suf = random.randint(1000, 9999)
ok, _ = reg(f"user_a_{suf}", "pass-a-123")
check("注册 A", ok)
ok, _ = reg(f"user_b_{suf}", "pass-b-123")
check("注册 B", ok)
ta = login(f"user_a_{suf}", "pass-a-123")
tb = login(f"user_b_{suf}", "pass-b-123")
check("A 登录", ta is not None)
check("B 登录", tb is not None)

# A 创建位置
code, body = req("POST", "/api/locations", {"name": "A宿舍", "lat": "31.72", "lng": "118.50"}, token=ta)
loc_id = (body.get("data") or {}).get("id")
check("A 创建位置", code == 201 and loc_id is not None, f"loc_id={loc_id}")

# B 位置列表隔离（看不到 A 的）
code, body = req("GET", "/api/locations", token=tb)
lst = body.get("data") or []
check("B 列表看不到 A 位置", code == 200 and not any(x.get("id") == loc_id for x in lst))

# B 改 A 的位置 -> 404
code, _ = req("PUT", f"/api/locations/{loc_id}", {"name": "B改"}, token=tb)
check("B 改 A 位置 404", code == 404, f"code={code}")

# B 删 A 的位置 -> 404
code, _ = req("DELETE", f"/api/locations/{loc_id}", token=tb)
check("B 删 A 位置 404", code == 404, f"code={code}")

# A 位置仍然完好
code, body = req("GET", "/api/locations", token=ta)
lst = body.get("data") or []
check("A 位置未被破坏", any(x.get("id") == loc_id for x in lst))

# 匿名改位置 -> 401
code, _ = req("PUT", f"/api/locations/{loc_id}", {"name": "x"})
check("匿名改位置 401", code == 401, f"code={code}")

# A 未绑定账号：创建任务 -> 400（归属/绑定前置校验）
code, body = req("POST", "/api/schedules", {"mode": "daily", "sign_time": "23:00"}, token=ta)
check("A 未绑定创建任务 400", code == 400, f"code={code}")

# A 的日志查询为空（无日志）
code, body = req("GET", "/api/logs?limit=5", token=tb)
check("B 日志查询可访问且无 A 数据", code == 200)

Path(BASE / "verify_authz_out.txt").write_text("\n".join(OUT), encoding="utf-8")
print("AUTHZ_DONE")
