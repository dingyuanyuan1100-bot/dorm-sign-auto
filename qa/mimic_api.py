# -*- coding: utf-8 -*-
"""本地复刻后端：FastAPI + uvicorn(默认 keep-alive 5s) + CORS *，
用来复现「写请求客户端报错但服务端其实写进去了」的现象。
启动：python qa/mimic_api.py 8806
"""
import sys
import time
import uuid
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DB = []
LOG = []


def stamp(tag, extra=""):
    line = f"[{time.strftime('%H:%M:%S')}.{int(time.time()*1000)%1000:03d}] {tag} {extra}"
    LOG.append(line)
    print(line, flush=True)


@app.get("/api/ping")
async def ping():
    stamp("GET /api/ping")
    return {"success": True, "msg": "ok", "data": {"t": time.time()}}


@app.get("/api/tasks")
async def list_tasks():
    stamp("GET /api/tasks", f"n={len(DB)}")
    return {"success": True, "msg": "ok", "data": list(DB)}


@app.post("/api/tasks")
async def create_task(request: Request):
    body = await request.json()
    stamp("POST /api/tasks recv", str(body))
    row = {"id": str(uuid.uuid4())[:8], "created": time.time(), **body}
    DB.append(row)
    stamp("POST /api/tasks stored", f"id={row['id']} n={len(DB)}")
    # 模拟同步做一点收尾工作（重算调度）
    await __import__("asyncio").sleep(0.02)
    return {"success": True, "msg": "创建成功", "data": {"id": row["id"]}}


@app.delete("/api/tasks/{tid}")
async def del_task(tid: str):
    stamp("DELETE recv", tid)
    global DB
    before = len(DB)
    DB = [r for r in DB if r["id"] != tid]
    if len(DB) == before:
        return {"success": False, "msg": "任务不存在或无权修改", "data": None}
    return {"success": True, "msg": "已删除", "data": None}


@app.get("/api/__log")
async def dump_log():
    return {"success": True, "msg": "ok", "data": LOG[-200:]}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(sys.argv[1]) if len(sys.argv) > 1 else 8806, log_level="warning")
