#!/usr/bin/env bash
# dorm-sign-auto 优化版启动脚本（服务器为 Alinux / bash）
# 用法：bash start.sh
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
    python3 -m venv .venv
fi
. .venv/bin/activate
pip install -r requirements.txt -q


exec uvicorn app.main:app --host "${HOST:-0.0.0.0}" --port "${PORT:-8805}" --workers 1
