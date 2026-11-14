"""部署「忘记密码」后端：3 个文件 + 重启 + 验证。

DEPLOY_PASS=... python qa/deploy_recover.py
回滚：
  cp app/api/v1/auth.py.bak.20261107p app/api/v1/auth.py
  cp app/schemas/auth.py.bak.20261107p app/schemas/auth.py
  cp app/crud/dorm_account.py.bak.20261107p app/crud/dorm_account.py
  systemctl restart dorm-sign-auto
"""
import base64
import os
import sys
import time
import warnings

import paramiko

warnings.filterwarnings("ignore")

HOST = "175.24.230.58"
USER = "root"
PASS = os.environ.get("DEPLOY_PASS")
REMOTE = "/www/wwwroot/dorm-sign-auto"
STAMP = "20261107p"

HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL = os.path.join(os.path.dirname(HERE), "dorm-sign-auto")

FILES = [
    "app/api/v1/auth.py",
    "app/schemas/auth.py",
    "app/crud/dorm_account.py",
]

if not PASS:
    sys.exit("DEPLOY_PASS not set")

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, 22, USER, PASS, timeout=20, banner_timeout=30,
            auth_timeout=20, look_for_keys=False, allow_agent=False)


def run(cmd, timeout=180, check=True):
    _i, o, e = cli.exec_command(cmd, timeout=timeout)
    out = o.read().decode(errors="replace")
    err = e.read().decode(errors="replace")
    rc = o.channel.recv_exit_status()
    if check and rc != 0:
        raise RuntimeError("remote failed(%s): %s\n%s\n%s" % (rc, cmd, out, err))
    return rc, out, err


def put_bytes(remote, data, timeout=300):
    tmp = remote + ".b64"
    b64 = base64.b64encode(data).decode()
    _i, o, _e = cli.exec_command("cat > " + tmp, timeout=timeout)
    w = o.channel.makefile("wb")
    for k in range(0, len(b64), 262144):
        w.write(b64[k:k + 262144].encode())
    w.flush()
    w.channel.shutdown_write()
    rc = o.channel.recv_exit_status()
    if rc != 0:
        raise RuntimeError("upload base64 failed: " + remote)
    run("base64 -d %s > %s && rm -f %s" % (tmp, remote, tmp))


print("== 1) 备份 + 上传 ==")
for rel in FILES:
    lp = os.path.join(LOCAL, rel.replace("/", os.sep))
    rp = "%s/%s" % (REMOTE, rel)
    data = open(lp, "rb").read()
    run("cp %s %s.bak.%s" % (rp, rp, STAMP))
    put_bytes(rp, data)
    _rc, out, _e = run("md5sum %s | cut -c1-8" % rp)
    import hashlib
    print("  %-32s -> %s  (local %s)" % (rel, out.strip(), hashlib.md5(data).hexdigest()[:8]))

print("\n== 2) 语法与导入自检（不启动服务） ==")
_rc, out, err = run("cd %s && .venv/bin/python -c \"import app.main; print('import ok')\""
                    % REMOTE, timeout=120)
print("  " + (out or err).strip()[:600])

print("\n== 3) 重启服务 ==")
run("systemctl restart dorm-sign-auto")
time.sleep(4)
_rc, out, _e = run("systemctl is-active dorm-sign-auto")
print("  is-active:", out.strip())
_rc, out, _e = run("journalctl -u dorm-sign-auto -n 12 --no-pager | tail -12", check=False)
print("  --- 最近日志 ---")
for line in out.strip().splitlines():
    print("   ", line[:160])

print("\n== 4) 路由验证 ==")
_rc, out, _e = run("curl -s http://127.0.0.1:8805/openapi.json | "
                   ".venv/bin/python -c \"import sys,json;d=json.load(sys.stdin);"
                   "print([p for p in d['paths'] if 'auth' in p])\"", timeout=60)
print("  auth 路由:", out.strip())

_rc, out, _e = run("curl -s -o /dev/null -w '%{http_code}' -X POST "
                   "-H 'Content-Type: application/json' -d '{}' "
                   "http://127.0.0.1:8805/api/auth/recover/verify", timeout=60)
print("  POST recover/verify 空体状态码:", out.strip(), "(期望 422：路由已注册且被参数校验拦下，未触达学校系统)")

cli.close()
print("\n完成。")
