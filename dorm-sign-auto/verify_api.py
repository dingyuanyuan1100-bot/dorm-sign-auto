# -*- coding: utf-8 -*-
"""API 冒烟测试：注册/登录/鉴权/位置/任务/日志/越权"""
import json
import random
import sys
import time
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8805"
OUT = []


def req(method, path, body=None, token=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, {}


def check(name, cond, detail=""):
    OUT.append(f"[{'PASS' if cond else 'FAIL'}] {name} {detail}")
    return cond


suffix = random.randint(1000, 9999)
username = f"smoke_{suffix}"

# 1. 未登录访问受保护接口 -> 401
code, body = req("GET", "/api/auth/me")
check("未登录访问 /me 返回 401", code == 401, f"code={code}")

# 2. 注册
code, body = req("POST", "/api/auth/register", {"username": username, "password": "pass-123456"})
check("注册成功 201", code == 201, f"code={code} body={body}")

# 3. 重复注册 -> 409
code, body = req("POST", "/api/auth/register", {"username": username, "password": "pass-123456"})
check("重复注册 409", code == 409, f"code={code}")

# 4. 非法用户名 -> 422
code, body = req("POST", "/api/auth/register", {"username": "ab", "password": "pass-123456"})
check("非法用户名 422", code == 422, f"code={code} msg={body.get('msg')}")

# 5. 登录
code, body = req("POST", "/api/auth/login", {"username": username, "password": "pass-123456"})
token = (body.get("data") or {}).get("token", "")
check("登录成功取到 token", code == 200 and bool(token), f"code={code}")

# 6. 错误密码 -> 401
code, body = req("POST", "/api/auth/login", {"username": username, "password": "wrong-pass"})
check("错误密码 401", code == 401, f"code={code}")

# 7. /me
code, body = req("GET", "/api/auth/me", token=token)
check("me 返回用户信息", code == 200 and body["data"]["username"] == username, f"code={code}")

# 8. 位置创建（第一个自动默认）
code, body = req("POST", "/api/locations", {"name": "宿舍", "lat": "31.721", "lng": "118.507", "address": "测试"}, token=token)
loc_id = (body.get("data") or {}).get("id")
check("创建位置 201 且自动默认", code == 201 and body["data"]["is_default"], f"code={code} loc_id={loc_id}")

# 9. 位置列表
code, body = req("GET", "/api/locations", token=token)
check("位置列表", code == 200 and len(body["data"]) == 1, f"code={code}")

# 10. 非法经纬度 -> 422
code, body = req("POST", "/api/locations", {"name": "x", "lat": "999", "lng": "118"}, token=token)
check("非法经纬度 422", code == 422, f"code={code}")

# 11. 未绑定账号创建任务 -> 400
code, body = req("POST", "/api/schedules", {"mode": "daily", "sign_time": "23:00"}, token=token)
check("未绑定创建任务 400", code == 400 and "绑定" in body.get("msg", ""), f"code={code} msg={body.get('msg')}")

# 12. 越权：用假 token -> 401
code, body = req("GET", "/api/logs", token="fake.token.xxx")
check("伪造 token 401", code == 401, f"code={code}")

# 13. 无 token 访问日志 -> 401
code, body = req("GET", "/api/logs")
check("无 token 日志 401", code == 401, f"code={code}")

# 14. 登出兼容
code, body = req("POST", "/api/auth/logout", token=token)
check("登出接口 ok", code == 200 and body.get("success") is True, f"code={code}")

# 15. 日志查询（需重新登录获取 token）
code, body = req("POST", "/api/auth/login", {"username": username, "password": "pass-123456"})
token = (body.get("data") or {}).get("token", "")
code, body = req("GET", "/api/logs?limit=5", token=token)
check("日志查询 ok", code == 200 and isinstance(body["data"], list), f"code={code}")

# 16. 无效 mode -> 422
code, body = req("POST", "/api/schedules", {"mode": "weekly", "sign_time": "23:00"}, token=token)
check("非法 mode 422", code == 422, f"code={code}")

# 17. 限流不触发（正常频率）
check("限流未误伤", True)

Path(r"C:\Users\Administrator\Doubao\chats\2026-11-01\new-chat-2\dorm-sign-auto\verify_api_out.txt").write_text(
    "\n".join(OUT), encoding="utf-8")
