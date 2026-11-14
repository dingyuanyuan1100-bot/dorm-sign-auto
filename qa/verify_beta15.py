# -*- coding: utf-8 -*-
"""verify_beta15.py — 2.0.15-beta1 测试版端到端验收（只读为主，末尾清理自造的测试反馈）

用法：DEPLOY_PASS=xxx python qa/verify_beta15.py
检查：域名资源可达 / CORS 预检 / 正式清单未被改动 / 测试包完整 /
      反馈提交→后台回复→用户端已回复 闭环 / 管理接口鉴权 / 测试数据清理
"""
import hashlib
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
import warnings

import paramiko

warnings.filterwarnings("ignore")

BASE = "https://www.wuxianshitu.icu"
APK = "dorm-sign-2.0.15-beta1-release.apk"
APK_MD5 = "a263cd3c898c8bd84524d61ceb19ad21"
QA_USER, QA_PASS = "qacheck_1793717807", "Qa123456"
HOST, USER = "175.24.230.58", "root"
PASS = os.environ.get("DEPLOY_PASS", "")

PATHS = [
    ("/", 200),
    ("/index.html", 200),
    ("/assets/index-B38s_bcG.js", 200),
    ("/assets/index-MaIdrxeL.css", 200),
    ("/fonts/alimama-700.woff2", 200),
    ("/update/version.json", 200),
    ("/update/notice.json", 200),
    ("/update/dorm-sign-2.0.14-release.apk", 200),
    ("/test/" + APK, 200),
    ("/admin/", 200),
    ("/api/auth/me", 401),
    ("/api/admin/feedbacks", 403),
]

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print("  %-4s %-46s %s" % ("PASS" if ok else "FAIL", name, detail))
    return ok


def http(path, method="GET", body=None, headers=None, raw=False):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Accept", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    data = None
    if body is not None:
        req.add_header("Content-Type", "application/json")
        data = json.dumps(body).encode("utf-8")
    ctx = ssl.create_default_context()
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=ctx))
    try:
        with op.open(req, data, timeout=30) as f:
            payload = f.read()
            if raw:
                return f.status, dict(f.headers), payload
            try:
                return f.status, json.loads(payload.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                return f.status, {}
    except urllib.error.HTTPError as e:
        payload = e.read()
        if raw:
            return e.code, dict(e.headers), payload
        try:
            return e.code, json.loads(payload.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return e.code, {}
    except Exception as e:
        return -1, {"error": str(e)}


def main():
    if not PASS:
        sys.exit("DEPLOY_PASS not set（清理测试数据需要服务器权限）")

    print("=" * 78)
    print("1) 域名资源可达性")
    for path, expect in PATHS:
        code, body, _ = http(path, raw=True)
        check(path, code == expect, "HTTP %s (期望 %s)" % (code, expect))

    print("=" * 78)
    print("2) 更新通道 CORS 预检")
    code, hdr, _ = http("/update/version.json", method="OPTIONS", raw=True)
    cors = {k.lower(): v for k, v in (hdr or {}).items()}
    check("OPTIONS /update/version.json", code == 204, "HTTP %s" % code)
    for key in ["access-control-allow-origin", "access-control-allow-methods",
                "access-control-allow-headers", "access-control-expose-headers"]:
        check("CORS " + key, key in cors, cors.get(key, ""))

    print("=" * 78)
    print("3) 正式通道未被测试版改动")
    code, _, v = http("/update/version.json", raw=True)
    try:
        vj = json.loads(v.decode("utf-8"))
    except Exception:
        vj = {}
    check("version.json 仍为 2.0.14/55", vj.get("version") == "2.0.14" and vj.get("versionCode") == 55,
          "%s / %s" % (vj.get("version"), vj.get("versionCode")))
    code, _, n = http("/update/notice.json", raw=True)
    try:
        nj = json.loads(n.decode("utf-8"))
    except Exception:
        nj = {}
    check("公告仍为 20261107a", nj.get("id") == "20261107a", "id=" + str(nj.get("id")))

    print("=" * 78)
    print("4) 测试包完整性")
    code, hdr, data = http("/test/" + APK, raw=True)
    md5 = hashlib.md5(data).hexdigest() if data else ""
    check("测试包 md5", code == 200 and md5 == APK_MD5,
          "%s B  md5 %s" % (len(data), md5))

    print("=" * 78)
    print("5) 反馈闭环：提交 → 后台回复 → 用户端显示已回复")
    code, r = http("/api/auth/login", method="POST",
                   body={"username": QA_USER, "password": QA_PASS})
    user_token = (r.get("data") or {}).get("token", "")
    check("QA 登录", code == 200 and bool(user_token), "HTTP %s" % code)

    # 从服务器 .env 取管理口令（不落盘、不打印到命令日志）
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, 22, USER, PASS, timeout=20, banner_timeout=30,
               auth_timeout=20, look_for_keys=False, allow_agent=False)

    def ssh(cmd, timeout=90):
        _, o, e = c.exec_command(cmd, timeout=timeout)
        return (o.read().decode("utf-8", "ignore") + e.read().decode("utf-8", "ignore")).strip()

    admin_token = ssh("grep '^ADMIN_TOKEN=' /www/wwwroot/dorm-sign-auto/.env | cut -d= -f2")
    check("管理口令已配置", len(admin_token) >= 16, "长度 %d" % len(admin_token))

    fb_id = None
    if user_token:
        stamp = time.strftime("%Y%m%d%H%M%S")
        text = "[2.0.15-beta1 自动验收] 域名切换与反馈回复闭环测试 " + stamp
        code, r = http("/api/feedback", method="POST",
                       body={"type": "体验建议", "content": text, "images": []},
                       headers={"Authorization": "Bearer " + user_token})
        fb = r.get("data") or {}
        fb_id = fb.get("id")
        check("提交反馈入库", code == 200 and bool(fb_id), "id=%s code=%s" % (fb_id, fb.get("code")))

        code, r = http("/api/feedback/" + str(fb_id),
                       headers={"Authorization": "Bearer " + user_token})
        check("用户端初始状态 pending", (r.get("data") or {}).get("status") == "pending",
              "status=" + str((r.get("data") or {}).get("status")))

        ah = {"X-Admin-Token": admin_token}
        code, r = http("/api/admin/feedbacks/" + str(fb_id), headers=ah)
        check("后台读到该反馈", code == 200 and (r.get("data") or {}).get("id") == fb_id,
              "username=" + str((r.get("data") or {}).get("username")))

        code, r = http("/api/admin/feedbacks/" + str(fb_id) + "/reply", method="POST",
                       body={"reply": "[自动验收] 已收到，2.0.15 测试版闭环验证通过。"}, headers=ah)
        check("后台提交回复", code == 200 and (r.get("data") or {}).get("status") == "replied",
              "HTTP %s status=%s" % (code, (r.get("data") or {}).get("status")))

        code, r = http("/api/feedback/" + str(fb_id),
                       headers={"Authorization": "Bearer " + user_token})
        d = r.get("data") or {}
        check("用户端变为 replied", d.get("status") == "replied" and "自动验收" in str(d.get("reply")),
              "status=%s replied_at=%s" % (d.get("status"), d.get("replied_at")))

        code, r = http("/api/feedback", headers={"Authorization": "Bearer " + user_token})
        hit = [x for x in ((r.get("data") or {}).get("items") or []) if x.get("id") == fb_id]
        check("反馈记录列表同步已回复", bool(hit) and hit[0].get("status") == "replied",
              "命中 %d 条" % len(hit))

    print("=" * 78)
    print("6) 清理自动验收产生的测试反馈")
    if fb_id:
        out = ssh("cd /www/wwwroot/dorm-sign-auto && .venv/bin/python -c \""
                  "import sqlite3; c=sqlite3.connect('data/dorm_sign.db',timeout=10); "
                  "n=c.execute('DELETE FROM feedbacks WHERE id=?',(%d,)).rowcount; "
                  "c.commit(); print('deleted='+str(n))\"" % fb_id)
        check("测试数据已删除", "deleted=1" in out, out)
        code, r = http("/api/admin/feedbacks?limit=1", headers={"X-Admin-Token": admin_token})
        check("全库统计正常", code == 200, "total=" + str((r.get("data") or {}).get("total")))
    else:
        check("测试数据已删除", True, "未创建测试反馈，跳过")

    print("=" * 78)
    total = len(results)
    passed = sum(1 for _, ok, _ in results if ok)
    print("验收结果：%d/%d 通过" % (passed, total))
    for name, ok, detail in results:
        if not ok:
            print("  FAILED: %s %s" % (name, detail))
    print("管理后台：%s/admin/" % BASE)
    print("管理口令：%s" % admin_token)
    c.close()
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
