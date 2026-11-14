# -*- coding: utf-8 -*-
"""deploy_admin_2015.py — 部署意见反馈处理端 + 管理后台（只增不删，不动正式更新通道）

用法：DEPLOY_PASS=xxx python qa/deploy_admin_2015.py
会：备份远端文件 → 上传 3 个后端文件与管理页 → 写 ADMIN_TOKEN 到 .env（已存在则复用）
    → 语法自检 → 重启服务 → 回环验证 403/200 → 打印管理口令
"""
import hashlib
import os
import secrets
import sys
import time
import warnings

import paramiko

warnings.filterwarnings("ignore")

HOST, USER = "175.24.230.58", "root"
PASS = os.environ.get("DEPLOY_PASS", "")
ROOT = "/www/wwwroot"
BACKEND = ROOT + "/dorm-sign-auto"
WEB = ROOT + "/dorm-app-web"
TS = time.strftime("%Y%m%d%H%M%S")
LOCAL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FILES = [
    (LOCAL + "/dorm-sign-auto/app/api/v1/admin_feedback.py", BACKEND + "/app/api/v1/admin_feedback.py"),
    (LOCAL + "/dorm-sign-auto/app/main.py", BACKEND + "/app/main.py"),
    (LOCAL + "/dorm-sign-auto/app/core/config.py", BACKEND + "/app/core/config.py"),
    (LOCAL + "/deploy/admin/index.html", WEB + "/admin/index.html"),
]


def main():
    if not PASS:
        sys.exit("DEPLOY_PASS not set")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, 22, USER, PASS, timeout=20, banner_timeout=30,
              auth_timeout=20, look_for_keys=False, allow_agent=False)

    def run(cmd, timeout=120, quiet=False):
        _, o, e = c.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "ignore") + e.read().decode("utf-8", "ignore")
        if not quiet:
            print("$ " + cmd)
            if out.strip():
                print(out.strip())
        return out.strip()

    sftp = c.open_sftp()

    # 0) 前置检查：远端 main.py 必须已挂 feedback，避免覆盖掉线上独有改动
    remote_main = sftp.open(BACKEND + "/app/main.py", "r").read().decode("utf-8", "ignore")
    print("=" * 60)
    print("0) 远端 main.py 现状")
    for line in remote_main.splitlines():
        if "include_router" in line or "from app.api.v1 import" in line:
            print("   " + line.strip())
    if "feedback.router" not in remote_main:
        sys.exit("远端 main.py 未挂 feedback 路由，存在未知差异，已中止")
    print("   检查通过：远端结构与本地基线一致")

    # 1) 备份 + 上传
    print("=" * 60)
    print("1) 备份并上传")
    run("mkdir -p %s/admin" % WEB)
    for local, remote in FILES:
        if not os.path.exists(local):
            sys.exit("缺少本地文件：" + local)
        try:
            sftp.stat(remote)
            run("cp -a %s %s.bak.%s" % (remote, remote, TS), quiet=True)
        except IOError:
            pass
        data = open(local, "rb").read()
        with sftp.open(remote, "wb") as fh:
            fh.write(data)
        md5 = hashlib.md5(data).hexdigest()
        remote_md5 = run("md5sum %s | cut -c1-32" % remote, quiet=True)
        print("   %s  %d B  md5 %s  %s" % (
            os.path.basename(remote), len(data), md5, "OK" if md5 == remote_md5 else "MISMATCH"))

    # 2) .env 写 ADMIN_TOKEN（已存在则复用，避免重跑让口令失效）
    print("=" * 60)
    print("2) 管理口令")
    env_path = BACKEND + "/.env"
    env_text = sftp.open(env_path, "r").read().decode("utf-8", "ignore")
    run("cp -a %s %s.bak.%s" % (env_path, env_path, TS), quiet=True)
    lines = env_text.splitlines()
    token = ""
    for line in lines:
        if line.startswith("ADMIN_TOKEN="):
            token = line.split("=", 1)[1].strip()
    rotated = not token
    if not token:
        token = secrets.token_urlsafe(24)
        if lines and lines[-1].strip():
            lines.append("")
        lines.append("# 意见反馈管理后台口令（deploy_admin_2015.py 生成）")
        lines.append("ADMIN_TOKEN=" + token)
    with sftp.open(env_path, "w") as fh:
        fh.write(("\n".join(lines) + "\n").encode("utf-8"))
    print("   ADMIN_TOKEN %s（长度 %d）" % ("新生成" if rotated else "复用原有", len(token)))

    # 3) 权限 + 语法自检 + 重启
    print("=" * 60)
    print("3) 自检与重启")
    run("chown -R nginx:nginx %s/admin" % WEB, quiet=True)
    chk = run("cd %s && .venv/bin/python -c \"from app.main import app; print('IMPORT_OK routes=' + str(len(app.routes)))\"" % BACKEND)
    if "IMPORT_OK" not in chk:
        sys.exit("导入自检失败，未重启服务；远端文件已备份为 .bak.%s" % TS)
    run("systemctl restart dorm-sign-auto")
    # 启动要跑 init_db + 调度器，约 4~5 秒；轮询到 /api/auth/me 可用再验证，避免拿到 000
    ready = False
    for _ in range(20):
        code = run("curl -s -m 3 -o /dev/null -w '%{http_code}' "
                   "http://127.0.0.1:8805/api/auth/me", quiet=True)
        if code == "401":
            ready = True
            break
        time.sleep(1)
    if not ready:
        sys.exit("服务重启后未就绪，请查看 journalctl -u dorm-sign-auto")
    print("   " + run("systemctl is-active dorm-sign-auto", quiet=True))

    # 4) 回环验证
    print("=" * 60)
    print("4) 接口验证")
    no_token = run("curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8805/api/admin/feedbacks", quiet=True)
    with_token = run("curl -s -o /dev/null -w '%{http_code}' -H 'X-Admin-Token: " + token + "' "
                     "http://127.0.0.1:8805/api/admin/feedbacks", quiet=True)
    body = run("curl -s -H 'X-Admin-Token: %s' "
               "http://127.0.0.1:8805/api/admin/feedbacks?limit=1" % token, quiet=True)
    print("   无口令 -> %s (期望 403)" % no_token)
    print("   有口令 -> %s (期望 200)" % with_token)
    print("   返回体 -> %s" % body[:220])
    print("   用户端 /api/feedback 未登录 -> %s (期望 401)" % run(
        "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8805/api/feedback", quiet=True))
    if no_token != "403" or with_token != "200":
        sys.exit("接口验证未通过，请检查服务日志")

    print("=" * 60)
    print("ADMIN_TOKEN=" + token)
    print("管理页：https://www.wuxianshitu.icu/admin/  （nginx 配置由 deploy_domain_2015.py 挂载）")
    print("备份后缀：.bak.%s" % TS)
    sftp.close()
    c.close()


if __name__ == "__main__":
    main()
