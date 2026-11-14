<div align="center">

<img src="docs/preview.png" width="100%" alt="晚寝签到 · 界面总览" />

<h1>晚寝签到 · Dorm Sign</h1>

<p>归寝时间提醒与记录工具<br/>React 18 · Capacitor 7 · FastAPI · SQLAlchemy 2</p>

<p>
  <img src="https://img.shields.io/badge/version-2.0.14-1a1a1a?style=flat-square" alt="version" />
  <img src="https://img.shields.io/badge/platform-Android-bef22f?style=flat-square&labelColor=1a1a1a" alt="platform" />
  <img src="https://img.shields.io/badge/backend-FastAPI-0f6e56?style=flat-square" alt="backend" />
  <img src="https://img.shields.io/badge/license-unlicensed-8a8a93?style=flat-square" alt="license" />
</p>

</div>

> [!IMPORTANT]
> 本项目只做**时间提醒与记录归档**，不提供、也不应被用于代替本人完成签到或考勤。
> 到点提醒后仍需本人自行操作；服务端调度器默认关闭（`SCHEDULER_ENABLED = False`）。

一个面向高校住宿生的归寝时间管理客户端：设定提醒时间、到点提醒、记录归档、月度统计。移动端为 React + Capacitor 打包的原生 Android 应用，服务端为 FastAPI 异步实现。

## 功能

| 模块 | 能力 |
|---|---|
| 登录 / 注册 | 学号 + 密码登录、记住本设备、忘记密码（学号 + 晚寝密码验证身份后重置） |
| 首页 | 问候语、当前任务卡与「立即签到」、今日进度（已签 / 总数、最佳时间）、月历记录（已签勾 / 漏签叉） |
| 签到任务 | 每天 / 一次两种模式、时间滚轮、位置绑定、启用开关、立即执行、增删改 |
| 位置库 | 位置增删改、设为默认、从上游系统拉取当前位置 |
| 意见反馈 | 文字 + 最多 3 张图片、类型标签、记录列表与详情、官方回复展示 |
| 我的 | 晚寝账号绑定 / 解绑、关于、检查更新 |
| 更新 | 版本清单比对、公告弹窗、APK 下载（支持断点续传与稍后提醒） |

## 技术栈

| 层 | 选型 |
|---|---|
| 客户端 | React 18.3、Vite 5.4、Capacitor 7（Android） |
| 状态管理 | 自研 Context Store（`src/state.jsx`），未引入第三方状态库 |
| 样式 | 单文件 CSS + CSS 变量驱动（`src/styles.css`），无 UI 框架 |
| 服务端 | FastAPI 0.115、Pydantic 2.10、SQLAlchemy 2.0（async）、aiosqlite |
| 鉴权 | JWT（python-jose）、argon2 密码哈希 |
| 加密 | AES-256-GCM 加密上游凭证（cryptography） |
| 数据库 | SQLite + Alembic 迁移 |
| 部署 | nginx 反向代理 + 静态托管，systemd 常驻 |

## 设计规范

色板、字体与动效曲线统一收敛在 `src/styles.css` 的 `:root`，客户端全部样式只引用变量，不写字面色值。

| Token | 值 | 用途 |
|---|---|---|
| `--lime` | `#bef22f` | 主色、主按钮、强调块 |
| `--lime-active` | `#b2e526` | 按压态 |
| `--ink` | `#1a1a1a` | 主文字 |
| `--bg` | `#f5f5f7` | 页面底色 |
| `--t1` / `--t2` / `--t3` / `--t4` | `#8a8a93` / `#a8a8b0` / `#b4b4bc` / `#c4c4cc` | 四级次要文字 |
| `--chip` | `#f0f0f3` | 标签底色 |
| `--chip-text` | `#5a5a63` | 标签文字 |
| `--danger` | `#e5484d` | 删除、异常、漏签 |
| `--danger-soft` | `#fdecec` | 危险态浅底 |

字体：数字 `Poppins`，正文 `Noto Sans SC`，展示标题 `Alimama ShuHeiTi`（本地 woff2，不依赖外网 CDN）。
动效：`--ease-out` 与 `--ease-spring`（`cubic-bezier(0.34, 1.18, 0.64, 1)`）两条曲线覆盖全站过渡。

## 目录结构

```
.
├── dorm-app/                    # 客户端
│   ├── src/
│   │   ├── screens/             # 8 个页面：Login / Recover / Home / Tasks / Locations / Logs / Feedback / Me
│   │   ├── ui/                  # 通用组件：Chrome / TimeWheel / DormBind / Notice / UpdateSheet / Icons / Motion
│   │   ├── api.js               # 网络层与接口封装
│   │   ├── state.jsx            # 全局状态与业务编排
│   │   ├── update.js            # 版本检查与下载
│   │   ├── version.js           # 版本号常量（与 Android 侧保持一致）
│   │   └── styles.css           # 全站样式
│   ├── android/                 # Capacitor Android 工程
│   └── dist-apk/                # 构建产物归档
├── dorm-sign-auto/              # 服务端
│   ├── app/api/v1/              # 7 个路由模块
│   ├── app/services/            # 上游协议客户端、调度器
│   ├── app/models/              # SQLAlchemy 模型
│   ├── app/core/                # 配置、安全、日志
│   └── alembic/                 # 数据库迁移
├── deploy/                      # 版本清单、公告、反馈管理后台
├── qa/                          # CDP 端到端验收脚本
└── docs/                        # 文档与截图
```

## 快速开始

**客户端**（需 Node 18+）：

```bash
cd dorm-app
npm install
npm run dev          # http://127.0.0.1:5273
npm run build        # 产出 dist/
```

**服务端**（需 Python 3.11+）：

```bash
cd dorm-sign-auto
python -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env          # 按下方表格填写
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8805

# 或用一键脚本：创建 venv、安装依赖并启动
bash start.sh
```

首次启动会自动建库建表并补齐缺失的密钥；接口文档在 `/docs`（Swagger）与 `/redoc`。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DATABASE_URL` | `sqlite+aiosqlite:///data/dorm_sign.db` | 数据库连接串 |
| `SECRET_KEY` | 空 | JWT 签名密钥。留空时首次启动自动生成并回写 `.env`；生产环境请显式固定，多实例不一致会导致已签发 token 全部失效 |
| `DORM_PASSWORD_ENCRYPT_KEY` | 空 | 上游凭证 AES-256-GCM 密钥。同上；**更换后已存凭证无法解密**，务必先备份 |
| `ADMIN_TOKEN` | 空 | 反馈管理后台口令；为空时管理接口一律 403 |
| `TOKEN_TTL_DAYS` | `30` | 登录态有效期（天） |
| `MAX_LOGIN_PER_MINUTE` | `30` | 登录/注册限流阈值 |
| `DORM_BASE_URL` | 上游地址 | 学校晚寝系统接口根地址 |
| `SCHEDULER_ENABLED` | `False` | 调度器开关，**默认关闭** |
| `SCHEDULER_SCAN_INTERVAL_SECONDS` | `20` | 扫描间隔 |
| `SCHEDULER_MAX_CONCURRENT` | `5` | 并发上限 |
| `SCHEDULER_JITTER_SECONDS` | `90` | 错峰抖动窗口，避免整点集中打上游 |
| `CORS_ORIGINS` | 空 | 跨域白名单（逗号分隔）；留空仅同源，填 `*` 表示允许任意来源（此时不携带凭证） |

## 接口概览

| 分组 | 前缀 | 主要端点 |
|---|---|---|
| 认证 | `/api/auth` | `register` · `login` · `logout` · `me` · `recover/verify` · `recover/reset` |
| 晚寝账号 | `/api/dorm-account` | 绑定（PUT） · 查看（GET） · 解绑（DELETE） |
| 位置 | `/api/locations` | 列表 / 新增 / 更新 / 删除 / 设为默认 / `from-task` |
| 签到任务 | `/api/schedules` | 创建 / 列表 / 更新 / 删除 / `{id}/run` |
| 执行日志 | `/api/logs` | 执行流水查询 |
| 意见反馈 | `/api/feedback` | 提交 / 我的列表 / 详情（含截图） |
| 反馈管理 | `/api/admin/feedbacks` | 全部列表 / 详情 / `{id}/reply`（`X-Admin-Token` 鉴权） |

用户侧资源全部按 `user_id` 做归属校验，读取他人记录返回 404 而非 403，避免暴露资源存在性。

## 关键实现

- **提醒时间窗**：`21:35–23:25`（`SIGN_WINDOW`），滚轮小时列只出现窗口内的小时，分钟列按小时动态切分（21 时 → 35~59，22 时 → 00~59，23 时 → 00~25）；切换小时自动把分钟夹进新范围，前端拦截 + 提交兜底双重校验。
- **凭证加密**：上游密码用 AES-256-GCM 加密落库，密钥仅存于环境变量，接口任何响应都不回传明文。
- **反馈图片压缩**：客户端在上传前压到长边 1600px、质量 0.86，并设 3.6M 字符软预算，超出自动降档到 1200px / 0.78，避免大图拖垮移动网络。
- **长文本截断**：列表卡片里标题、编号、回复预览统一 `overflow: hidden + text-overflow: ellipsis`，防止单行文本横向溢出卡片（曾因漏加导致文字画出屏幕一倍宽）。
- **入场动画**：统一由 `[data-intro]` 隐藏清单与 `[data-intro="run"]` 动画清单驱动，`prefers-reduced-motion` 下三处同步关闭。
- **更新通道**：`version.json` 比对 `versionCode`（严格单调递增才提示），`notice.json` 单独承载公告，APK 走独立路径并支持 Range 续传。

## 构建 Android

```bash
cd dorm-app
npm run build
npx cap copy android

# macOS / Linux
cd android && ./gradlew assembleRelease
# Windows
cd android && .\gradlew.bat assembleRelease --offline
```

产物在 `android/app/build/outputs/apk/release/app-release.apk`。签名配置放在 `android/key.properties`（不入库）。

版本号需要三处同步，缺一处就会出现「升级提示不弹」或「装了新版仍提示更新」：

1. `dorm-app/package.json` → `version`
2. `dorm-app/src/version.js` → `APP_VERSION` / `VERSION_CODE`
3. `dorm-app/android/app/build.gradle` → `versionName` / `versionCode`

## 更新与分发

```
/update/version.json        # 正式通道清单
/update/notice.json         # 公告
/update/dorm-sign-x.y.z-release.apk
/test/dorm-sign-x.y.z-betaN-release.apk   # 测试通道，独立目录互不影响
```

发测试包时只动 `/test/`，不要碰 `version.json`，否则已装用户会被引导升级到未验证版本。网页端静态资源按「只加不删」同步，保留旧 hash 文件以兼容缓存。

## 验收

`qa/` 下是一套基于 Chrome DevTools Protocol 的端到端脚本：headless Chrome、390×844、DPR 2、mock 接口拦截，覆盖登录注册、任务增删、时间滚轮边界、反馈提交与详情、更新流程等场景。运行方式：

```bash
node qa/<脚本名>.cjs
```

脚本会输出逐条断言结果并落一张截图，便于人工复核视觉。

## 已知限制

- 调度器默认关闭，历史任务不会自动执行，任务列表仅为提醒计划。
- 数据库为 SQLite 单文件，适合单机小规模；并发写入高时需要换 PostgreSQL。
- 反馈管理后台目前是单口令门禁，多人协作建议换成账号体系或叠加 IP 白名单。
- 反馈回复只在详情页可见，暂无站内推送能力。
- 仅支持 Android，iOS 侧未做工程配置。

## 版本

当前正式版 `2.0.14`（versionCode 55），测试版 `2.0.15-beta3`（versionCode 58）。
变更记录见 `dorm-app/dist-apk/VERSION_HISTORY.md`。

## 许可

本仓库未指定开源许可证，默认保留所有权利。如需引用或二次分发，请先联系作者。

使用本项目时请遵守所在学校的住宿与考勤管理规定；因误用产生的后果由使用者自行承担。
