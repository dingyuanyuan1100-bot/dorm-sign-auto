# -*- coding: utf-8 -*-
"""deploy_release.py — 把 2.0.14 正式包 / 公告 / 网页端一起推上线

用法：
  DEPLOY_PASS=xxx python qa/deploy_release.py <apk路径> <version.json路径> <notice.json路径>

做四件事：
  1. APK 传到 /www/wwwroot/dorm-app-web/update/
  2. version.json / notice.json 先备份再覆盖
  3. dist 里的 index.html + assets 覆盖到 current/（旧 hash 文件保留，避免缓存里的老页面 404）
  4. chown nginx:nginx 并回读校验
"""
import hashlib
import json
import os
import sys
import time
import warnings

import paramiko

warnings.filterwarnings("ignore")

HOST = "175.24.230.58"
USER = "root"
ROOT = "/www/wwwroot/dorm-app-web"
TS = time.strftime("%Y%m%d%H%M%S")


def main():
    apk = sys.argv[1]
    version_json = sys.argv[2]
    notice_json = sys.argv[3]
    dist = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dorm-app", "dist")
    dist = os.path.abspath(dist)

    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(HOST, 22, USER, os.environ["DEPLOY_PASS"], timeout=20, look_for_keys=False, allow_agent=False)
    sftp = cli.open_sftp()

    def run(cmd):
        _i, o, e = cli.exec_command(cmd, timeout=120)
        return (o.read().decode(errors="replace") + e.read().decode(errors="replace")).strip()

    # 1) APK
    apk_name = os.path.basename(apk)
    remote_apk = f"{ROOT}/update/{apk_name}"
    sftp.put(apk, remote_apk)
    local_md5 = hashlib.md5(open(apk, "rb").read()).hexdigest()
    remote_md5 = run(f"md5sum {remote_apk} | cut -c1-32")
    print(f"[APK] {apk_name} {os.path.getsize(apk)} B  md5 {local_md5}  remote {remote_md5}  {'OK' if local_md5 == remote_md5 else 'MISMATCH'}")

    # 2) 两个清单：备份后覆盖
    for local, name in ((version_json, "version.json"), (notice_json, "notice.json")):
        remote = f"{ROOT}/update/{name}"
        bak = f"{remote}.bak.{TS}"
        print("[backup]", run(f"cp -a {remote} {bak} && ls -l {bak} | awk '{{print $5, $9}}'"))
        sftp.put(local, remote)
        print(f"[{name}] 上传完成")
        body = run(f"cat {remote}")
        try:
            parsed = json.loads(body)
            print(f"[{name}] JSON 合法，keys={list(parsed.keys())}")
        except ValueError as exc:
            print(f"[{name}] JSON 解析失败：{exc}")

    # 3) 网页端：只加不删（老 hash 资源留着给缓存页面用）
    old_index = run(f"ls -l {ROOT}/current/index.html | awk '{{print $5}}'")
    run(f"cp -a {ROOT}/current/index.html {ROOT}/current/index.html.bak.{TS}")
    print(f"[web] 旧 index.html {old_index} B 已备份")
    sftp.put(os.path.join(dist, "index.html"), f"{ROOT}/current/index.html")
    uploaded = 0
    for fn in sorted(os.listdir(os.path.join(dist, "assets"))):
        sftp.put(os.path.join(dist, "assets", fn), f"{ROOT}/current/assets/{fn}")
        uploaded += 1
    print(f"[web] 上传 {uploaded} 个 assets 文件")

    # 4) 权限 + 回读
    print("[chown]", run(f"chown -R nginx:nginx {ROOT}/current {ROOT}/update && echo ok"))
    print("[index]", run(f"grep -o 'index-[A-Za-z0-9_-]*\\.\\(js\\|css\\)' {ROOT}/current/index.html | sort -u"))
    print("[update 目录]", run(f"ls -l {ROOT}/update | tail -6"))

    sftp.close()
    cli.close()


if __name__ == "__main__":
    main()
