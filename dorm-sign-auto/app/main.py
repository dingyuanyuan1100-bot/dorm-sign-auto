import logging
from contextlib import asynccontextmanager
import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
from app.api.common import register_exception_handlers
from app.api.v1 import admin_feedback, auth, dorm_account, feedback, location, log, schedule
from app.core.config import BASE_DIR, settings
from app.db.base import Base
from app.db.session import engine, init_db
from app.services import scheduler as scheduler_service

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("app.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动阶段
    await init_db(Base)
    logger.info("数据库就绪：%s", settings.DATABASE_URL)
    if settings.SCHEDULER_ENABLED:
        sched = scheduler_service.init_scheduler()
        await sched.start()
        logger.info("调度器已启动")
    else:
        logger.info("调度器停用")
    yield
    # 关闭阶段
    if settings.SCHEDULER_ENABLED and scheduler_service.scheduler is not None:
        await scheduler_service.scheduler.stop()
    await engine.dispose()
    logger.info("服务已关闭")


app = FastAPI(
    title="晚寝签到服务",
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

if settings.CORS_ORIGINS.strip():
    origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
    # 通配 * 时不能带凭证（浏览器规范）；API 使用 Bearer Token，无需 cookie 凭证
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins if origins != ["*"] else ["*"],
        allow_credentials=(origins != ["*"]),
        allow_methods=["*"],
        allow_headers=["*"],
    )

# 统一错误响应格式
register_exception_handlers(app)

# 路由（前缀已在各 router 中声明，与旧前端路径一致）
app.include_router(auth.router)
app.include_router(dorm_account.router)
app.include_router(location.router)
app.include_router(schedule.router)
app.include_router(log.router)
app.include_router(feedback.router)
app.include_router(admin_feedback.router)

# 首页路由
app.mount("/", StaticFiles(directory=BASE_DIR / "app" / "static", html=True), name="static")


if __name__ == "__main__":
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, workers=1)
