# -*- coding: utf-8 -*-
"""找回密码界面验收用的最小 mock 后端（只覆盖登录前会用到的接口）。"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ACCOUNTS = [
    {"id": 1, "username": "xiaohui_2023", "nickname": "灰灰", "student_id": "202****01"},
    {"id": 2, "username": "ahjk13", "nickname": "13ahjk", "student_id": "202****01"},
]


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            data = json.loads(raw or b"{}")
        except ValueError:
            data = {}

        if self.path == "/api/auth/recover/verify":
            if data.get("password") == "badpass":
                return self._send(400, {"success": False, "msg": "学号或晚寝密码不正确", "data": None})
            return self._send(200, {
                "success": True, "msg": "ok",
                "data": {"ticket": "mock-ticket", "accounts": ACCOUNTS},
            })

        if self.path == "/api/auth/recover/reset":
            return self._send(200, {
                "success": True, "msg": "密码已重置",
                "data": {"username": "ahjk13"},
            })

        if self.path in ("/api/auth/login", "/api/auth/register"):
            return self._send(401, {"success": False, "msg": "账号或密码错误", "data": None})

        return self._send(404, {"success": False, "msg": "not found", "data": None})

    def do_GET(self):
        if self.path.startswith("/api/auth/me"):
            return self._send(401, {"success": False, "msg": "未登录", "data": None})
        return self._send(404, {"success": False, "msg": "not found", "data": None})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8806), H).serve_forever()
