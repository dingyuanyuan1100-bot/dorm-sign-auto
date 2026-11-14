# dorm-sign-auto（优化版 v2.0）

晚寝自动签到服务。**功能与旧版完全等价**，结构参考 `market_system`（FastAPI 分层）重构：
**规范分层、异步并发、安全加固**。

> 公告：该签到功能已停止使用。调度器默认关闭（`SCHEDULER_ENABLED=false`），
> 服务仍提供注册/登录/绑定/位置/任务管理/手动签到与日志查询，供历史数据查阅与应急手动签到。
> 前端公告横幅已内置（`app/static/index.html`）。

## 目录结构（参考 market_system）

```
dorm-sign-auto/
├── app/
│   ├── main.py                 # FastAPI 入口 + lifespan（DB 初始化 / 调度器启停）
│   ├── deps.py                 # 依赖注入：get_db / get_current_user / 登录限流
│   ├── core/
│   │   ├── config.py           # pydantic-settings 配置（.env，legacy/config.json 密钥迁移）
│   │   └── security.py         # Argon2 密码哈希 + JWT + AES-256-GCM + 学号脱敏
│   ├── db/
│   │   ├── base.py             # SQLAlchemy Base / BaseModel（id、时间字段）
│   │   └── session.py          # 异步引擎（aiosqlite + WAL + busy_timeout）+ get_db
│   ├── models/                 # ORM 模型（表结构与旧库完全一致）
│   ├── schemas/                # Pydantic v2 请求/响应模型（强校验）
│   ├── crud/                   # 泛型 CRUDBase + 各实体异步 CRUD（归属强制校验）
│   ├── services/
│   │   ├── dorm_client.py      # 晚寝上游协议客户端（签名/重试，逻辑与旧版一致）
│   │   └── scheduler.py        # asyncio 调度器（账号锁 + 信号量 + to_thread）
│   └── api/v1/                 # 路由：auth / dorm-account / locations / schedules / logs
├── alembic/                    # 数据库迁移（baseline 与旧库 schema 一致）
├── legacy/                     # 旧版源码归档（含 config.json，用于密钥迁移）
├── static/index.html -> app/static/index.html
├── .env.example                # 配置模板
└── start.sh
```

## 快速开始

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # 留空即可：启动时自动从 legacy/config.json 迁移密钥
uvicorn app.main:app --host 0.0.0.0 --port 8805
```

访问 `http://127.0.0.1:8805/`；接口文档 `http://127.0.0.1:8805/docs`。

Windows 本地验证：`python -m venv .venv; .\.venv\Scripts\activate; pip install -r requirements.txt; uvicorn app.main:app --port 8805`。

## 配置（.env）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | 8805 | 监听端口 |
| `DATABASE_URL` | sqlite+aiosqlite:///./data/dorm_sign.db | 数据库（默认项目内 data/） |
| `SECRET_KEY` | 自动 | JWT 签名密钥；空则从 legacy/config.json 迁移或生成 |
| `DORM_PASSWORD_ENCRYPT_KEY` | 自动 | 晚寝密码 AES 密钥；**必须与旧库一致才能解密旧数据** |
| `TOKEN_TTL_DAYS` | 30 | 登录有效期 |
| `MAX_LOGIN_PER_MINUTE` | 30 | 登录/注册按 IP 限流 |
| `DORM_BASE_URL` | https://xskq.ahut.edu.cn | 上游地址 |
| `DORM_TASK_ID` | 自动迁移 | 晚寝签到任务 ID |
| `SCHEDULER_ENABLED` | **false** | 自动调度开关（默认关闭） |
| `SCHEDULER_SCAN_INTERVAL_SECONDS` | 20 | 扫描间隔 |
| `SCHEDULER_MAX_CONCURRENT` | 5 | 打上游的最大并发 |

## 安全特性

- **Argon2id 密码哈希**：新注册用户；旧用户 werkzeug/pbkdf2 哈希自动兼容验证，无需重置密码。
- **JWT 无状态认证**：HS256 签名，payload 仅含用户 id，替代旧版随机 token + sessions 表。
- **AES-256-GCM 加密**晚寝密码（带随机 nonce + 认证 tag），数据库泄露不还原明文。
- **Pydantic v2 强校验**：用户名/密码/学号/时间/经纬度/日期全量校验，杜绝脏数据。
- **越权防护**：所有按 id 操作强制 `user_id` 归属条件（沿用旧版语义，越权返回 404）。
- **登录/注册限流**：内存滑动窗口 30 次/分钟/IP。
- **参数化查询**：全程 ORM 参数绑定，无 SQL 注入面。
- **日志脱敏**：学号脱敏展示，不落盘明文密码。

## 并发设计

- FastAPI + async/await 异步 IO，uvicorn 事件循环处理高并发读。
- SQLite：WAL 模式 + busy_timeout + 连接池（`pool_pre_ping`），读写并发友好。
- 上游请求为同步库（requests），通过 `asyncio.to_thread` 移出事件循环，不阻塞。
- 调度器（asyncio）：每个 dorm_account 互斥锁防重复签到；全局信号量限制上游并发；
  一次性任务执行后自动停用；daily 每天最多一次，错过补执行。

> 注意：调度器为进程内单例，**必须单 worker 运行**（start.sh 已固定 `--workers 1`）。
> 本服务无 Redis/消息队列需求（单机 SQLite 足够），故未引入。

## 数据兼容（旧库无缝升级）

- 表名/字段与旧版 `data/dorm_sign.db` 完全一致，**可直接指向旧库启动**（旧库缺
  `schedules.location_id` 时自动补列）。
- 旧 `sessions` 表不再使用（JWT 无状态），残留无影响。
- 关键：`DORM_PASSWORD_ENCRYPT_KEY` 必须沿用旧 `config.json` 的
  `security.dorm_password_encrypt_key`，否则旧绑定账号无法解密——启动时自动迁移。
- 新库建表：`alembic upgrade head`（baseline 与旧 schema 一致）。

## 验证记录（2026-11-01，本地 .venv）

- `verify_security.py` 全过：Argon2id 哈希前缀 `$argon2id$`、JWT 签发/校验、AES-256-GCM 加解密一致、学号/手机号脱敏、**旧 legacy crypto 密文 ↔ 新模块密文双向互解**。
- `verify_config.py` 全过：SECRET_KEY / DORM_PASSWORD_ENCRYPT_KEY 与 legacy/config.json 一致、DORM_TASK_ID 正确、**SCHEDULER_ENABLED=False**、.env 已生成。
- `verify_api.py` 17/17 过：鉴权 401、注册 201、重复注册 409、非法用户名 422、登录、错误密码 401、/me、位置创建（首个自动默认）/列表、非法经纬度 422、未绑定创建任务 400、伪造 token 401、登出、日志查询、非法 mode 422、限流未误伤。
- `verify_authz.py` 12/12 过：跨用户位置隔离（B 看不到 A 的位置、改/删 A 的位置 404、匿名改 401）、未绑定前置校验、日志隔离。
- `verify_compat.py` 13/13 过：**旧 schema 库 + 旧 pbkdf2 哈希 + 旧 AES 密文**经新 ORM 读取、登录、解密全部还原；调度器 compute_next_run / _is_due（daily 到点、当日已执行、once 过期/未来）/ _execute（mock 上游）/ run_now 越权拒绝。

未覆盖（依赖真实上游，部署后人工验证）：绑定晚寝账号（PUT /api/dorm-account，需 xskq.ahut.edu.cn 校验）、创建任务后的立即签到、登录限流打满 30 次/分钟。

## 生产部署建议

- 服务器：`bash start.sh`（或 systemd 托管 uvicorn，单 worker）。
- 建议 nginx 反向代理 + HTTPS（参考 creamery 的 nginx 配置）。
- 服务器无 git：用 SFTP 上传整个目录后替换旧目录即可；先停旧进程（pid 见部署时查询）。

## API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /api/auth/register | 注册 |
| POST | /api/auth/login | 登录（返回 JWT） |
| POST | /api/auth/logout | 登出（前端丢弃 token） |
| GET | /api/auth/me | 当前用户（学号脱敏） |
| PUT/GET/DELETE | /api/dorm-account | 绑定/查看/解绑晚寝账号 |
| GET/POST | /api/locations | 位置列表/新增 |
| PUT/DELETE | /api/locations/{id} | 修改/删除位置 |
| POST | /api/locations/{id}/default | 设默认位置 |
| GET | /api/locations/from-task | 从晚寝系统获取当前位置 |
| GET/POST | /api/schedules | 任务列表/创建 |
| PUT/DELETE | /api/schedules/{id} | 修改/删除任务 |
| POST | /api/schedules/{id}/run | 立即签到 |
| GET | /api/logs?limit= | 执行日志 |

统一响应：`{success, msg, data}`（与旧前端约定一致，错误带 HTTP 状态码）。

## 免责声明

本项目仅用于个人便利，请遵守学校规定，不要代签他人。旧版理念来自 campus-backend 的 `internal/dorm` 模块。
