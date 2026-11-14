"""发布公告：把 notice.json 推到 Web 根的 /update/ 下，App 下次登录即拉取。
用法：DEPLOY_PASS=... python qa/publish_notice.py qa/notice.json
"""
import json
import os
import sys

import paramiko

HOST = "175.24.230.58"
USER = "root"
PASS = os.environ.get("DEPLOY_PASS")
ROOT = "/www/wwwroot/dorm-app-web"

if not PASS:
    sys.exit("DEPLOY_PASS not set")

src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "notice.json")
raw = open(src, "rb").read()
data = json.loads(raw)
if not data.get("id") or not data.get("title"):
    sys.exit("notice.json 需要 id 与 title")

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, 22, USER, PASS, timeout=20, banner_timeout=30, auth_timeout=20, look_for_keys=False, allow_agent=False)

try:
    sftp = cli.open_sftp()
    with sftp.file("/tmp/notice.json", "wb") as f:
        f.write(raw)
    sftp.close()
    cmd = (
        "set -e; cd {root}/update; "
        "test -f notice.json && cp -a notice.json notice.json.bak.$(date +%Y%m%d%H%M%S) || true; "
        "mv /tmp/notice.json notice.json; chown nginx:nginx notice.json; chmod a+r notice.json; "
        "echo '--- 线上内容 ---'; cat notice.json"
    ).format(root=ROOT)
    _i, o, e = cli.exec_command(cmd, timeout=60)
    out = o.read().decode(errors="replace")
    err = e.read().decode(errors="replace")
    if o.channel.recv_exit_status() != 0:
        sys.exit("remote failed: %s\n%s" % (out, err))
    print(out)
    print("PUBLISH_OK")
finally:
    cli.close()
