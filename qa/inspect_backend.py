"""只读比对：服务器 dorm-sign-auto 与本地副本的关键文件。

DEPLOY_PASS=... python qa/inspect_backend.py
不写任何远端文件。
"""
import hashlib
import os
import warnings

import paramiko

warnings.filterwarnings("ignore")

HOST = "175.24.230.58"
USER = "root"
PORT = 22
PASS = os.environ.get("DEPLOY_PASS")
REMOTE = "/www/wwwroot/dorm-sign-auto"
LOCAL = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "dorm-sign-auto")

FILES = [
    "app/api/v1/auth.py",
    "app/schemas/auth.py",
    "app/crud/dorm_account.py",
    "app/core/security.py",
    "app/services/dorm_client.py",
    "app/crud/base.py",
    "app/crud/user.py",
    "app/deps.py",
]

if not PASS:
    raise SystemExit("DEPLOY_PASS not set")

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, PORT, USER, PASS, timeout=20, banner_timeout=30,
            auth_timeout=20, look_for_keys=False, allow_agent=False)


def run(cmd, timeout=60):
    _i, o, e = cli.exec_command(cmd, timeout=timeout)
    out = o.read().decode(errors="replace")
    err = e.read().decode(errors="replace")
    rc = o.channel.recv_exit_status()
    return rc, out, err


print("== 服务状态 ==")
for cmd in ("systemctl is-active dorm-sign-auto",
            "systemctl show dorm-sign-auto -p ExecStart --value",
            "python3 -V 2>&1 || true",
            "ls -la %s/data 2>/dev/null | head -5" % REMOTE):
    rc, out, err = run(cmd)
    print("  $ %s -> %s" % (cmd, (out or err).strip()[:300]))

print("\n== 文件比对（md5 前 8 位） ==")
print("  %-34s %-10s %-10s %s" % ("file", "remote", "local", "state"))
for rel in FILES:
    rp = "%s/%s" % (REMOTE, rel)
    rc, out, _ = run("md5sum %s 2>/dev/null | cut -c1-8" % rp)
    rmd5 = out.strip() or "-"
    lp = os.path.join(LOCAL, rel.replace("/", os.sep))
    if os.path.exists(lp):
        lmd5 = hashlib.md5(open(lp, "rb").read()).hexdigest()[:8]
    else:
        lmd5 = "-"
    state = "same" if rmd5 == lmd5 else "DIFF"
    print("  %-34s %-10s %-10s %s" % (rel, rmd5, lmd5, state))

print("\n== 远端关键签名 ==")
probe = r"""cd %s && grep -n "def create_token\|def verify_token" app/core/security.py; \
echo '-- dorm_client --'; grep -n "def login\|def _new_session\|class DormError" app/services/dorm_client.py; \
echo '-- crud list_by_student_id --'; grep -n "list_by_student_id" app/crud/dorm_account.py || echo '  (missing)'; \
echo '-- schemas recover --'; grep -n "RecoverVerifyRequest\|RecoverResetRequest" app/schemas/auth.py || echo '  (missing)'; \
echo '-- routes recover --'; grep -n "recover" app/api/v1/auth.py || echo '  (missing)'""" % REMOTE
rc, out, err = run(probe)
print(out or err)

cli.close()
