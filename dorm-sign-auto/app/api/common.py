# -*- coding: utf-8 -*-
"""
api/common.py — 统一响应格式与异常处理器

保持旧版前端约定：所有响应体为 {success, msg, data}，
成功默认 200，创建类返回 201，错误带对应 HTTP 状态码。
"""
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


def ok(data: Any = None, msg: str = "ok", status_code: int = 200) -> JSONResponse:
    return JSONResponse(status_code=status_code,
                        content={"success": True, "msg": msg, "data": data})


def fail(msg: str, status_code: int = 400, data: Any = None) -> JSONResponse:
    return JSONResponse(status_code=status_code,
                        content={"success": False, "msg": msg, "data": data})


def register_exception_handlers(app: FastAPI) -> None:
    """把 Pydantic 校验错误与通用 HTTPException 统一为 {success,msg} 格式。"""

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(request: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        msg = first.get("msg", "参数校验失败")
        # pydantic 的错误信息形如 "Value error, 用户名需为 3-32 位..."，去掉前缀
        if msg.startswith("Value error, "):
            msg = msg[len("Value error, "):]
        return JSONResponse(status_code=422,
                            content={"success": False, "msg": msg, "data": None})

    @app.exception_handler(StarletteHTTPException)
    async def _http_handler(request: Request, exc: StarletteHTTPException):
        return JSONResponse(status_code=exc.status_code,
                            content={"success": False, "msg": str(exc.detail), "data": None})
