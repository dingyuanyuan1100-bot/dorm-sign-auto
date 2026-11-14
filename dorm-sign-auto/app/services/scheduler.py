# -*- coding: utf-8 -*-
"""
services/scheduler.py — 签到调度器（asyncio 版，参考旧版语义重写）

模式语义：
  once  : 指定日期 sign_date 的 sign_time 执行一次，自动执行后停用
  daily : 每天 sign_time 到点执行一次；手动触发不占用当天名额

到点后先查当日签到状态：已签直接记成功，限流等几秒重查，未签才提交签到。
自动执行的日志文案固定为「签到成功 / 签到失败」，上游原话只写 logger。

并发控制：
  - 每个 dorm_account 一把 asyncio.Lock：同一账号任务串行，避免重复签到
  - 全局 asyncio.Semaphore 限制打上游的并发数
  - 上游为同步 requests，通过 asyncio.to_thread 执行，不阻塞事件循环
  - 每次执行使用独立数据库会话，避免会话跨任务共享

调度默认关闭（SCHEDULER_ENABLED=false，延续"签到已停止使用"的决定）。
"""
import asyncio
import logging
import zlib
from datetime import datetime, timedelta

from sqlalchemy import select

from app.core.config import settings
from app.core.security import TZ, decrypt_password
from app.crud.schedule import schedule_crud
from app.crud.sign_log import sign_log_crud
from app.db.session import async_session
from app.models.schedule import Schedule
from app.services.dorm_client import DormClient, is_already_signed_msg, is_rate_limited

logger = logging.getLogger("app.scheduler")

# 自动签到遇到限流 / 上游未开窗时的重试间隔（秒）：首次 + 3 次
AUTO_RETRY_DELAYS = (0, 3, 6, 10)
NOT_OPEN_HINTS = ("未到", "未开始", "还没到")


class SignScheduler:
    def __init__(
        self,
        client: DormClient,
        scan_interval: int = 20,
        max_concurrent: int = 5,
    ):
        self.client = client
        self.scan_interval = max(5, int(scan_interval))
        self.sem = asyncio.Semaphore(max(1, int(max_concurrent)))
        self._running: set[int] = set()
        self._running_lock = asyncio.Lock()
        self._account_locks: dict[int, asyncio.Lock] = {}
        self._acct_guard = asyncio.Lock()
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None

    # ---------- 生命周期 ----------

    async def start(self) -> None:
        await self.refresh_all_next_runs()
        self._task = asyncio.create_task(self._loop(), name="sign-scheduler")
        logger.info("签到调度器已启动，扫描间隔 %ss", self.scan_interval)

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()
            self._task = None
        logger.info("签到调度器已停止")

    # ---------- 主循环 ----------

    async def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                await asyncio.wait_for(self._scan(), timeout=self.scan_interval)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("调度扫描异常")
            # 等待下一轮（可被 stop 立即打断）
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self.scan_interval)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

    async def _scan(self) -> None:
        now = datetime.now(TZ)
        today = now.strftime("%Y-%m-%d")
        async with async_session() as db:
            schedules = await schedule_crud.list_enabled_full(db)
            done = await sign_log_crud.auto_done_today(db, today)
        for s in schedules:
            try:
                if await self._is_due(s=s, now=now, today=today, done=done):
                    sid = s["id"]
                    async with self._running_lock:
                        if sid in self._running:
                            continue
                        self._running.add(sid)
                    asyncio.create_task(self._execute_wrapper(s, "auto"))
            except Exception:
                logger.exception("扫描任务 %s 异常", s.get("id"))

    # ---------- 到期判定 ----------

    def _jitter(self, schedule_id: int, today: str) -> int:
        """同一任务当天固定的错峰偏移（秒），把整点扎堆的请求摊开。"""
        window = max(0, int(settings.SCHEDULER_JITTER_SECONDS))
        if not window:
            return 0
        return zlib.crc32(f"{schedule_id}:{today}".encode()) % (window + 1)

    async def _is_due(self, s: dict, now: datetime, today: str, done: set[int]) -> bool:
        try:
            hh, mm = (int(x) for x in str(s["sign_time"]).split(":"))
        except Exception:
            return False
        now_sec = now.hour * 3600 + now.minute * 60 + now.second
        target_sec = hh * 3600 + mm * 60
        # 到点后再错峰 0-90 秒；临近午夜收缩窗口，避免跨天丢掉这一次
        jitter = min(self._jitter(s["id"], today), max(0, 86399 - target_sec))

        # 只看时间：今天已由调度器跑过才停；手动触发不占用这个名额，
        # 否则手动点一次失败（比如未到时间）就会把当晚的自动签到吃掉。
        if s["id"] in done:
            return False
        if now_sec < target_sec + jitter:
            return False

        if s["mode"] == "daily":
            return True

        sd = str(s["sign_date"] or "")
        if not sd:
            return False
        if sd < today:
            await self._mark_expired(s)
            return False
        return sd == today

    async def _mark_expired(self, s: dict) -> None:
        """过期未执行的 once 任务：标记跳过并停用。"""
        async with async_session() as db:
            await schedule_crud.set_result(db, s["id"], "expired", "日期已过期，未执行", None)
            await schedule_crud.set_enabled(db, s["id"], 0)
            await sign_log_crud.add(db, s["user_id"], s["id"], False,
                                    "日期已过期，任务被停用", "auto")
        logger.info("任务 %s 日期已过期，自动停用", s["id"])

    # ---------- 执行 ----------

    async def _execute_wrapper(self, s: dict, trigger: str) -> None:
        try:
            async with self.sem:
                await self._execute(s, trigger)
        except Exception as e:
            logger.exception("任务 %s 执行异常", s.get("id"))
            await self._record(s, success=False, msg="签到失败", trigger=trigger,
                               reason=f"执行异常: {e}")
        finally:
            async with self._running_lock:
                self._running.discard(s["id"])

    async def _execute(self, s: dict, trigger: str) -> None:
        # 同一 dorm_account 串行
        async with await self._account_lock(s["dorm_account_id"]):
            try:
                password = decrypt_password(s["enc_password"])
            except Exception as e:
                await self._record(s, success=False, msg="签到失败", trigger=trigger,
                                   reason=f"解密晚寝密码失败: {e}")
                return
            location = None
            if s.get("loc_lat") and s.get("loc_lng"):
                location = {"lat": s["loc_lat"], "lng": s["loc_lng"]}

            if trigger == "auto":
                ok, msg, reason = await self._run_auto(s, password, location)
                await self._record(s, success=ok, msg=msg, trigger=trigger, reason=reason)
                return

            # 手动触发：先不查状态，原样返回上游消息（用户要知道真实原因）
            try:
                result = await asyncio.to_thread(
                    self.client.sign_once, s["student_id"], password, location, False
                )
                ok = bool(result["success"])
                msg = result["msg"] or ("签到成功" if ok else "签到失败")
            except Exception as e:
                ok, msg = False, str(e)
            await self._record(s, success=ok, msg=msg, trigger=trigger)

    async def _run_auto(self, s: dict, password: str, location: dict | None):
        """自动签到：先查当日状态，已签直接算成功；限流 / 未开窗等几秒重试。

        对外只给「签到成功 / 签到失败」两种文案，上游原话只进日志。
        """
        reason = ""
        for delay in AUTO_RETRY_DELAYS:
            if delay:
                await asyncio.sleep(delay)
            try:
                r = await asyncio.to_thread(
                    self.client.sign_once, s["student_id"], password, location, True
                )
            except Exception as e:
                reason = str(e)
                if is_rate_limited(reason):
                    continue
                break
            if r.get("success"):
                return True, "签到成功", reason or str(r.get("msg") or "")
            msg = str(r.get("msg") or "")
            reason = msg
            if is_rate_limited(msg):
                continue
            if is_already_signed_msg(msg):
                return True, "签到成功", msg
            if any(h in msg for h in NOT_OPEN_HINTS):
                continue
            break
        return False, "签到失败", reason

    async def run_now(self, schedule_id: int, user_id: int) -> dict:
        """手动触发（"立即签到"）。归属校验：只允许执行自己的任务。"""
        async with async_session() as db:
            s = await schedule_crud.get_owned(db, schedule_id, user_id)
            if s is None:
                return {"success": False, "msg": "任务不存在或无权操作"}
            async with self._running_lock:
                if s.id in self._running:
                    return {"success": False, "msg": "任务正在执行中，请稍候"}
                self._running.add(s.id)
            full = await schedule_crud.get_full(db, schedule_id)
        asyncio.create_task(self._execute_wrapper(full, "manual"))
        return {"success": True, "msg": "已触发执行，结果请稍后查看日志"}

    # ---------- 记录 ----------

    async def _record(self, s: dict, success: bool, msg: str, trigger: str,
                      reason: str = "") -> None:
        sid = s["id"]
        user_id = s["user_id"]
        status = "success" if success else "failed"
        next_run = self.compute_next_run(s)
        if trigger == "auto":
            msg = "签到成功" if success else "签到失败"
        if reason and reason != msg:
            logger.info("任务 %s 上游原话：%s", sid, reason)
        async with async_session() as db:
            # once：自动执行后停用；手动失败不停用，避免吃掉当晚的自动执行
            if s["mode"] == "once" and (trigger == "auto" or success):
                await schedule_crud.set_enabled(db, sid, 0)
            await schedule_crud.set_result(db, sid, status, msg, next_run)
            await sign_log_crud.add(db, user_id, sid, success, msg, detail=trigger)

    # ---------- 下次执行时间 ----------

    def compute_next_run(self, s: dict) -> str | None:
        """计算任务下一次执行时间（用于展示）。"""
        try:
            hh, mm = (int(x) for x in str(s["sign_time"]).split(":"))
        except Exception:
            return None
        now = datetime.now(TZ)
        if s["mode"] == "daily":
            cand = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
            if cand <= now:
                cand = cand + timedelta(days=1)
            return cand.strftime("%Y-%m-%d %H:%M:%S")
        sd = str(s["sign_date"] or "")
        if not sd:
            return None
        try:
            cand = datetime.strptime(f"{sd} {s['sign_time']}", "%Y-%m-%d %H:%M").replace(tzinfo=TZ)
        except Exception:
            return None
        if cand <= now:
            return None
        return cand.strftime("%Y-%m-%d %H:%M:%S")

    async def refresh_all_next_runs(self) -> None:
        async with async_session() as db:
            result = await db.execute(select(Schedule).where(Schedule.enabled == 1))
            for s in result.scalars().all():
                await schedule_crud.set_next_run(
                    db, s.id, self.compute_next_run(
                        {c.name: getattr(s, c.name) for c in s.__table__.columns}))

    async def recompute(self, schedule_id: int) -> None:
        async with async_session() as db:
            s = await db.get(Schedule, schedule_id)
            if s:
                await schedule_crud.set_next_run(
                    db, schedule_id, self.compute_next_run(
                        {c.name: getattr(s, c.name) for c in s.__table__.columns}))

    async def _account_lock(self, account_id: int) -> asyncio.Lock:
        async with self._acct_guard:
            if account_id not in self._account_locks:
                self._account_locks[account_id] = asyncio.Lock()
            return self._account_locks[account_id]


# 全局调度器实例（由 main lifespan 创建并注入）
scheduler: SignScheduler | None = None


def get_scheduler() -> SignScheduler:
    assert scheduler is not None, "调度器未初始化（lifespan 未执行）"
    return scheduler


def init_scheduler() -> SignScheduler:
    global scheduler
    scheduler = SignScheduler(
        client=DormClient(),
        scan_interval=settings.SCHEDULER_SCAN_INTERVAL_SECONDS,
        max_concurrent=settings.SCHEDULER_MAX_CONCURRENT,
    )
    return scheduler
