import asyncio
from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.common import fail, ok
from app.core.security import (
    create_token,
    hash_password,
    mask_student_id,
    verify_password,
    verify_token,
)
from app.crud.dorm_account import dorm_account_crud
from app.crud.user import user_crud
from app.db.session import get_db
from app.deps import get_current_user, login_limiter
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    RecoverResetRequest,
    RecoverVerifyRequest,
    RegisterRequest,
)
from app.services.dorm_client import DormClient, DormError

router = APIRouter(prefix="/api/auth", tags=["认证"])

# 找回密码凭证：只用于改密，不能当登录令牌用（get_current_user 取不到 int 型 sub）
RECOVER_SCOPE = "recover"
RECOVER_TICKET_TTL = timedelta(minutes=10)


@router.post("/register", summary="注册")
async def register(
        body    : RegisterRequest,
        request : Request,
        db      : AsyncSession = Depends(get_db)
):
    if not await login_limiter.allow(request.client.host or "?"):
        return fail("请求过于频繁", 429)
    if await user_crud.get_by_username(db, body.username):
        return fail("用户名已存在", 409)

    password_hash = await hash_password(body.password)
    user = await user_crud.create_user(db, body.username, password_hash)
    return ok({
        "id": user.id,
        "username": user.username
    },
        "注册成功",
        201
    )


@router.post("/login", summary="登录")
async def login(
        body    : LoginRequest,
        request : Request,
        db      : AsyncSession = Depends(get_db)):
    if not await login_limiter.allow(request.client.host or "?"):
        return fail("请求过于频繁", 429)
    user = await user_crud.get_by_username(db, body.username.strip())
    if user is None or not await verify_password(body.password, user.password_hash):
        return fail("用户名或密码错误", 401)
    token = create_token({"sub": str(user.id)})
    return ok({"token": token, "username": user.username})


@router.post("/logout", summary="登出")
async def logout():
    return ok()


@router.get("/me", summary="当前用户")
async def me(
        user: User         = Depends(get_current_user),
        db  : AsyncSession = Depends(get_db)):
    acc = await dorm_account_crud.get_by_user(db, user.id)
    return ok({
        "id": user.id,
        "username": user.username,
        "has_dorm_account": acc is not None,
        "student_id": mask_student_id(acc.student_id) if acc else None,
    })


# ---------- 忘记密码 ----------
# 流程：学号 + 晚寝密码验证身份 → 选出该学号下绑定的账号 → 设置新密码
# 验证不在本地比对密码，而是直接登录一次学校晚寝系统，因此能覆盖"忘记 App 密码"的场景。

@router.post("/recover/verify", summary="忘记密码 · 验证身份")
async def recover_verify(
        body    : RecoverVerifyRequest,
        request : Request,
        db      : AsyncSession = Depends(get_db)):
    if not await login_limiter.allow(request.client.host or "?"):
        return fail("请求过于频繁", 429)

    client = DormClient()
    try:
        await asyncio.to_thread(
            client.login, client._new_session(), body.student_id, body.password)
    except DormError:
        return fail("学号或晚寝密码不正确", 400)
    except Exception:
        return fail("学校签到系统暂时不可用", 502)

    accounts = await dorm_account_crud.list_by_student_id(db, body.student_id)
    items = []
    for acc in accounts:
        user = await user_crud.get(db, acc.user_id)
        if user is None:
            continue
        items.append({
            "id": user.id,
            "username": user.username,
            "nickname": acc.nickname or user.username,
            "student_id": mask_student_id(acc.student_id),
        })
    if not items:
        return fail("该学号还没有绑定过账号", 404)

    ticket = create_token(
        {"scope": RECOVER_SCOPE, "sid": body.student_id},
        RECOVER_TICKET_TTL,
    )
    return ok({"ticket": ticket, "accounts": items})


@router.post("/recover/reset", summary="忘记密码 · 重置密码")
async def recover_reset(
        body : RecoverResetRequest,
        db   : AsyncSession = Depends(get_db)):
    payload = verify_token(body.ticket)
    if not payload or payload.get("scope") != RECOVER_SCOPE:
        return fail("验证已过期，请重新验证", 400)

    # 二次校验：目标账号必须确实绑定了凭证里的学号，避免拿凭证改别人的密码
    user = await user_crud.get(db, body.user_id)
    acc = await dorm_account_crud.get_by_user(db, body.user_id)
    if user is None or acc is None or acc.student_id != payload.get("sid"):
        return fail("账号信息不匹配，请重新验证", 400)

    if await verify_password(body.password, user.password_hash):
        return fail("新密码不能与原密码相同", 400)

    user.password_hash = await hash_password(body.password)
    await db.commit()
    return ok({"username": user.username}, "密码已重置")
