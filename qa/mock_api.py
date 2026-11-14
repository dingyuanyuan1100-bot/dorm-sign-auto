# -*- coding: utf-8 -*-
"""本地 mock 后端：按 ./dorm-app 的接口契约返回，用于「写入回包丢失」的端到端验证。
启动：python qa/mock_api.py 8806
"""
import sys
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

TOKEN = "mock-token"
LOCS = [{"id": 2, "name": "晚寝任务位置", "lat": "31.67381", "lng": "118.555756", "address": "宿舍楼", "is_default": True}]
TASKS = []
LOGS = []
STATS = {"post": 0, "delete": 0, "put": 0}


def ok(data=None, msg="ok"):
    return {"success": True, "msg": msg, "data": data}


@app.get("/api/__stats")
async def stats():
    return ok({"stats": STATS, "tasks": TASKS, "n": len(TASKS)})


@app.post("/api/__reset")
async def reset():
    global TASKS, LOCS, LOGS
    TASKS = []
    LOGS = []
    LOCS = [{"id": 2, "name": "晚寝任务位置", "lat": "31.67381", "lng": "118.555756", "address": "宿舍楼", "is_default": True}]
    for k in STATS:
        STATS[k] = 0
    return ok(None, "reset")


@app.post("/api/auth/login")
async def login():
    return ok({"token": TOKEN, "username": "qa"})


@app.get("/api/auth/me")
async def me():
    return ok({"username": "qa", "has_dorm_account": True, "student_id": "20230001"})


@app.post("/api/auth/logout")
async def logout():
    return ok(None)


@app.get("/api/dorm-account")
async def dorm():
    return ok({"student_id": "20230001", "nickname": "qa"})


@app.get("/api/locations")
async def list_locations():
    return ok(LOCS)


@app.post("/api/locations")
async def create_location(req: Request):
    d = await req.json()
    row = {"id": len(LOCS) + 1, "name": d.get("name") or "位置", "lat": str(d.get("lat", "")), "lng": str(d.get("lng", "")), "address": d.get("address", ""), "is_default": False}
    LOCS.append(row)
    return ok(row, "位置已记录")


@app.delete("/api/locations/{lid}")
async def del_location(lid: int):
    global LOCS
    LOCS = [l for l in LOCS if l["id"] != lid]
    return ok(None)


@app.get("/api/schedules")
async def list_tasks():
    return ok(TASKS)


@app.post("/api/schedules")
async def create_task(req: Request):
    d = await req.json()
    STATS["post"] += 1
    row = {
        "id": int(time.time() * 1000) + len(TASKS),
        "sign_time": d.get("sign_time"),
        "mode": d.get("mode"),
        "sign_date": d.get("sign_date"),
        "remark": d.get("remark", ""),
        "location_id": d.get("location_id"),
        "enabled": True,
        "status": "waiting",
    }
    TASKS.append(row)
    return ok({"id": row["id"]}, "创建成功")


@app.put("/api/schedules/{tid}")
async def update_task(tid: int, req: Request):
    d = await req.json()
    STATS["put"] += 1
    for t in TASKS:
        if t["id"] == tid:
            t.update({k: v for k, v in d.items() if k in ("enabled", "sign_time", "remark", "mode", "sign_date")})
            return ok(None, "已更新")
    return ok(None, "已更新")


@app.delete("/api/schedules/{tid}")
async def del_task(tid: int):
    global TASKS
    STATS["delete"] += 1
    before = len(TASKS)
    TASKS = [t for t in TASKS if t["id"] != tid]
    if len(TASKS) == before:
        return {"success": False, "msg": "任务不存在或无权修改", "data": None}
    return ok(None, "任务已删除")


@app.post("/api/schedules/{tid}/run")
async def run_task(tid: int):
    return ok({"success": True}, "已触发")


@app.get("/api/logs")
async def logs():
    return ok(LOGS)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(sys.argv[1]) if len(sys.argv) > 1 else 8806, log_level="warning")
