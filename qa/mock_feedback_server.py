# -*- coding: utf-8 -*-
"""意见反馈界面验收用的 mock 后端（覆盖登录后会用到的接口 + 反馈读写）。"""
import json
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

USER = {"id": 1, "username": "ahjk13", "student_id": "2023****21", "nickname": "李同学"}

RECORDS = [
    {
        "id": 3, "code": "FB-20261107-0326", "type": "功能异常",
        "content": "签到定位一直显示未定位", "image_count": 1, "status": "replied",
        "reply": "已收到，Android 12 需手动开启后台定位，下个版本会补引导。",
        "created_at": "2026-11-07 17:20", "replied_at": "2026-11-07 18:02",
    },
    {
        "id": 2, "code": "FB-20261105-0288", "type": "体验建议",
        "content": "希望支持批量导入签到任务", "image_count": 0, "status": "pending",
        "reply": None, "created_at": "2026-11-05 09:12", "replied_at": None,
    },
    {
        "id": 1, "code": "FB-20261030-0211", "type": "功能异常",
        "content": "验证码一直收不到", "image_count": 0, "status": "replied",
        "reply": "已排查为运营商短信延迟，建议改用语音验证码重试。",
        "created_at": "2026-10-30 21:40", "replied_at": "2026-10-31 10:05",
    },
]


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")

    def do_OPTIONS(self):
        # 带 Authorization 的跨源请求会先发预检，不回 204 浏览器会直接拦掉
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _ok(self, data, msg="ok"):
        return self._send(200, {"success": True, "msg": msg, "data": data})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            data = json.loads(raw or b"{}")
        except ValueError:
            data = {}

        if self.path == "/api/feedback":
            text = (data.get("content") or "").strip()
            if len(text) < 5:
                return self._send(400, {"success": False, "msg": "描述太短，至少 5 个字", "data": None})
            row = {
                "id": 100 + len(RECORDS),
                "code": "FB-%s-0001" % datetime.now().strftime("%Y%m%d"),
                "type": data.get("type") or "功能异常",
                "content": text,
                "image_count": len(data.get("images") or []),
                "status": "pending",
                "reply": None,
                "created_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
                "replied_at": None,
            }
            RECORDS.insert(0, row)
            return self._ok(row)

        if self.path in ("/api/auth/login", "/api/auth/register"):
            return self._ok({"token": "mock-token", "username": USER["username"]})

        return self._send(404, {"success": False, "msg": "not found", "data": None})

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/api/auth/me":
            return self._ok(USER)
        if p == "/api/dorm-account":
            return self._ok({"student_id": "2023****21", "nickname": "李同学", "bound": True})
        if p == "/api/schedules":
            return self._ok([])
        if p == "/api/locations":
            return self._ok([])
        if p == "/api/logs":
            return self._ok([])
        if p == "/api/feedback":
            pending = sum(1 for r in RECORDS if r["status"] == "pending")
            return self._ok({"total": len(RECORDS), "pending": pending, "items": RECORDS})
        if p.startswith("/api/feedback/"):
            fid = int(p.rsplit("/", 1)[-1])
            for r in RECORDS:
                if r["id"] == fid:
                    return self._ok(dict(r, images=[]))
            return self._send(404, {"success": False, "msg": "反馈不存在", "data": None})
        if p == "/update/version.json" or p == "/api/update":
            return self._ok({"version": "2.0.14", "code": 48, "url": ""})
        return self._send(404, {"success": False, "msg": "not found", "data": None})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8808), H).serve_forever()
