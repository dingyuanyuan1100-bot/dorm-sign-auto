# -*- coding: utf-8 -*-
"""线上环境端到端验收：意见反馈三条接口。

    python qa/verify_feedback_prod.py

会在线上注册一个临时账号（qa_ 前缀 + 时间戳），只写自己的数据。
"""
import json
import ssl
import sys
import time
import urllib.error
import urllib.request

BASE = "https://175.24.230.58"
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

passed = 0
failed = 0


def call(method, path, body=None, token=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30, context=CTX) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"raw": raw[:200]}


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print("  PASS  %s" % name)
    else:
        failed += 1
        print("  FAIL  %s   %s" % (name, detail))


PNG_1PX = ("data:image/png;base64,"
           "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")

stamp = str(int(time.time()))[-8:]
USER = "qa_fb_" + stamp
PWD = "Qa" + stamp + "x"

print("=" * 64)
print("线上端到端验收  https://175.24.230.58  临时账号 %s" % USER)
print("=" * 64)

print("\n[0] 建账号")
code, r = call("POST", "/api/auth/register", {"username": USER, "password": PWD})
check("注册成功", code in (200, 201) and r.get("success"), "%s %s" % (code, r))
code, r = call("POST", "/api/auth/login", {"username": USER, "password": PWD})
token = (r.get("data") or {}).get("token") if r.get("success") else None
check("登录拿到 token", bool(token), "%s %s" % (code, r))
if not token:
    sys.exit(1)

print("\n[1] 提交反馈")
code, r = call("POST", "/api/feedback",
               {"type": "功能异常", "content": "线上联调：签到页偶发白屏，重进恢复", "images": []}, token)
d = r.get("data") or {}
check("POST 200/201", code in (200, 201), "%s %s" % (code, r))
check("返回编号 FB- 前缀", str(d.get("code", "")).startswith("FB-"), d.get("code"))
check("状态 pending", d.get("status") == "pending", d.get("status"))
fid = d.get("id")
check("返回自增 id", isinstance(fid, int) and fid > 0, fid)
check("图片数 0", d.get("image_count") == 0, d.get("image_count"))
code, r = call("POST", "/api/feedback",
               {"type": "体验建议", "content": "带一张截图：导航栏图标偏小", "images": [PNG_1PX]}, token)
check("带图提交成功", code in (200, 201) and (r.get("data") or {}).get("image_count") == 1, "%s %s" % (code, r))

print("\n[2] 参数校验（应被拦下）")
cases = [
    ("空描述", {"type": "功能异常", "content": "   ", "images": []}, "请填写"),
    ("描述 3 字", {"type": "功能异常", "content": "白屏了", "images": []}, "太短"),
    ("类型非法", {"type": "随便说说", "content": "这是一段足够长的描述", "images": []}, "类型"),
    ("4 张图", {"type": "功能异常", "content": "这是一段足够长的描述", "images": [PNG_1PX] * 4}, "3 张"),
    ("非 dataURL", {"type": "功能异常", "content": "这是一段足够长的描述", "images": ["http://x/y.png"]}, "格式"),
]
for name, body, kw in cases:
    code, r = call("POST", "/api/feedback", body, token)
    msg = str(r.get("msg", ""))
    # 4 张图由 schema 校验器拦，走 422；其余走路由里的 400
    ok_code = code in (400, 422)
    check("拦下：%s" % name, ok_code and not r.get("success") and kw in msg, "%s %s" % (code, msg))

print("\n[3] 列表 / 详情")
code, r = call("GET", "/api/feedback", None, token)
d = r.get("data") or {}
check("GET 列表 200", code == 200 and r.get("success"), code)
check("total == 2", d.get("total") == 2, d.get("total"))
check("pending == 2", d.get("pending") == 2, d.get("pending"))
check("items 2 条", len(d.get("items") or []) == 2, len(d.get("items") or []))
check("列表按时间倒序", (d.get("items") or [{}])[0].get("id", 0) > (d.get("items") or [{}, {}])[1].get("id", 0))

code, r = call("GET", "/api/feedback/%d" % fid, None, token)
d = r.get("data") or {}
check("GET 详情 200", code == 200 and r.get("success"), code)
check("详情带 images 数组", isinstance(d.get("images"), list), type(d.get("images")).__name__)
check("详情 content 一致", d.get("content") == "线上联调：签到页偶发白屏，重进恢复", d.get("content"))

print("\n[4] 鉴权与越权")
code, r = call("POST", "/api/feedback", {"type": "功能异常", "content": "未登录提交试试", "images": []})
check("未登录 401", code == 401, code)
code, r = call("GET", "/api/feedback")
check("未登录查列表 401", code == 401, code)
code, r = call("GET", "/api/feedback/999999", None, token)
check("查不存在的反馈 404", code == 404, code)

USER2 = USER + "b"
code, r = call("POST", "/api/auth/register", {"username": USER2, "password": PWD})
code, r = call("POST", "/api/auth/login", {"username": USER2, "password": PWD})
token2 = (r.get("data") or {}).get("token") if r.get("success") else None
code, r = call("GET", "/api/feedback/%d" % fid, None, token2)
check("他人查我的反馈 404", code == 404, code)
code, r = call("GET", "/api/feedback", None, token2)
check("他人列表为空", (r.get("data") or {}).get("total") == 0, r.get("data"))

print("\n[5] 编号当日自增")
code, r = call("POST", "/api/feedback", {"type": "体验建议", "content": "再提一条，验证编号自增", "images": []}, token)
c2 = (r.get("data") or {}).get("code", "")
check("两条反馈编号不同", c2 and c2 != d.get("code"), c2)

print("\n" + "=" * 64)
print("通过 %d / 失败 %d" % (passed, failed))
print("=" * 64)
sys.exit(0 if failed == 0 else 1)
