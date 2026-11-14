# -*- coding: utf-8 -*-
"""首页 / 重置成功 一比一验收用的 mock（端口 8809）。

数据刻意对齐画布 17:12：两条任务（一条停用）、最近一次执行成功、没有公告。
"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

USER = {"id": 1, "username": "samsad", "student_id": "2023****21", "nickname": "李同学"}

SCHEDULES = [
    {
        "id": 1, "sign_time": "23:30", "mode": "daily", "enabled": True,
        "location": {"id": 1, "name": "3 号公寓 · 502", "lat": 31.2, "lng": 121.4},
    },
    {
        "id": 2, "sign_time": "23:45", "mode": "daily", "enabled": False,
        "location": {"id": 1, "name": "3 号公寓 · 502", "lat": 31.2, "lng": 121.4},
    },
]

LOGS = [
    {
        "id": 9, "schedule_id": 1, "success": True, "run_at": "2026-11-07 23:30:06",
        "message": "签到成功",
    }
]


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")

    def do_OPTIONS(self):
        # 跨源带 Authorization 会先发预检，不回 204 的话浏览器直接拦掉
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
        p = self.path.split("?")[0]

        if p in ("/api/auth/login", "/api/auth/register"):
            return self._ok({"token": "mock-token", "username": USER["username"]})
        if p == "/api/auth/logout":
            return self._ok(None)
        if p == "/api/auth/recover/verify":
            return self._ok({
                "ticket": "mock-ticket",
                "accounts": [
                    {"id": 1, "username": "ahjk13", "nickname": "李同学", "student_id": "2023****21"},
                ],
            })
        if p == "/api/auth/recover/reset":
            return self._ok({"ok": True})
        if p == "/api/feedback":
            return self._ok({"id": 1, "code": "FB-20261107-0001", "type": data.get("type"),
                             "content": data.get("content"), "image_count": 0,
                             "status": "pending", "reply": None,
                             "created_at": "2026-11-07 20:00", "replied_at": None})
        return self._send(404, {"success": False, "msg": "not found", "data": None})

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/api/auth/me":
            return self._ok(USER)
        if p == "/api/dorm-account":
            return self._ok({"student_id": "2023****21", "nickname": "李同学", "bound": True})
        if p == "/api/schedules":
            return self._ok(SCHEDULES)
        if p == "/api/locations":
            return self._ok([{"id": 1, "name": "3 号公寓 · 502", "lat": 31.2, "lng": 121.4}])
        if p == "/api/logs":
            return self._ok(LOGS)
        if p == "/api/feedback":
            return self._ok({"total": 0, "pending": 0, "items": []})
        # 公告：返回 404 → 首页不出现公告条，正好对上画布 17:12 的状态
        if p == "/update/notice.json":
            return self._send(404, {"success": False, "msg": "no notice", "data": None})
        if p in ("/update/version.json", "/api/update"):
            return self._ok({"version": "2.0.14", "code": 48, "url": ""})
        return self._send(404, {"success": False, "msg": "not found", "data": None})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8809), H).serve_forever()
