"""把 feedback 模块推上线（dorm-sign-auto），只增不删。

    DEPLOY_PASS=xxx python qa/deploy_backend_feedback.py [--apply]

默认只做 diff 预演，加 --apply 才真正上传并重启。
"""
import os
import sys
import warnings

import paramiko

warnings.filterwarnings("ignore")

HOST, USER = "175.24.230.58", "root"
PASS = os.environ.get("DEPLOY_PASS", "")
REMOTE = "/www/wwwroot/dorm-sign-auto"
LOCAL_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dorm-sign-auto")
SERVICE = "dorm-sign-auto"

FILES = [
    ("app/models/feedback.py", "app/models/feedback.py"),
    ("app/schemas/feedback.py", "app/schemas/feedback.py"),
    ("app/crud/feedback.py", "app/crud/feedback.py"),
    ("app/api/v1/feedback.py", "app/api/v1/feedback.py"),
]


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, 22, USER, PASS, timeout=20, banner_timeout=30,
              auth_timeout=20, look_for_keys=False, allow_agent=False)
    return c


def run(c, cmd, quiet=False):
    _i, o, e = c.exec_command(cmd, timeout=180)
    out = o.read().decode("utf-8", "ignore").strip()
    err = e.read().decode("utf-8", "ignore").strip()
    o.channel.recv_exit_status()
    if not quiet:
        print("$ " + cmd)
        if out:
            print(out)
        if err:
            print("[stderr] " + err)
    return out + ("\n" + err if err else "")


def main():
    apply = "--apply" in sys.argv
    if not PASS:
        sys.exit("DEPLOY_PASS not set")
    c = connect()
    sftp = c.open_sftp()
    try:
        print("=" * 60)
        print("1) main.py 差异（远端 → 本地）")
        print("=" * 60)
        remote_main = sftp.open(REMOTE + "/app/main.py").read().decode("utf-8")
        local_main = open(os.path.join(LOCAL_ROOT, "app/main.py"), encoding="utf-8").read()
        rl = remote_main.splitlines()
        ll = local_main.splitlines()
        import difflib
        diff = list(difflib.unified_diff(rl, ll, "remote/main.py", "local/main.py", lineterm="", n=1))
        if not diff:
            print("完全一致")
        for line in diff:
            print(line)

        print()
        print("=" * 60)
        print("2) feedback 本地文件")
        print("=" * 60)
        for lp, _ in FILES:
            p = os.path.join(LOCAL_ROOT, lp)
            print("%-34s %6d B" % (lp, os.path.getsize(p)))

        print()
        print("=" * 60)
        print("3) 依赖检查：remote schemas 目录")
        print("=" * 60)
        run(c, "ls %s/app/schemas/ 2>&1" % REMOTE)

        if not apply:
            print("\n[预演] 未改动任何文件。加 --apply 执行。")
            return 0

        stamp = "20261107fb"
        print()
        print("=" * 60)
        print("4) 备份并上传")
        print("=" * 60)
        run(c, "mkdir -p %s/.bak.%s && cd %s && tar czf .bak.%s/app.tgz app --exclude='__pycache__' && ls -l .bak.%s/app.tgz"
            % (REMOTE, stamp, REMOTE, stamp, stamp))
        for lp, rp in FILES:
            dst = REMOTE + "/" + rp
            sftp.put(os.path.join(LOCAL_ROOT, lp), dst)
            print("↑ %s" % rp)
        sftp.put(os.path.join(LOCAL_ROOT, "app/main.py"), REMOTE + "/app/main.py")
        print("↑ app/main.py")
        run(c, "cd %s && chown -R root:root app && chmod 644 app/main.py app/models/feedback.py app/schemas/feedback.py app/crud/feedback.py app/api/v1/feedback.py" % REMOTE)

        print()
        print("=" * 60)
        print("5) 语法体检（不进服务进程）")
        print("=" * 60)
        run(c, "cd %s && .venv/bin/python -c \"import app.main; print('import ok', len(app.main.app.routes))\" 2>&1 | tail -5" % REMOTE)

        print()
        print("=" * 60)
        print("6) 重启服务")
        print("=" * 60)
        run(c, "systemctl restart %s && sleep 3 && systemctl is-active %s" % (SERVICE, SERVICE))
        run(c, "journalctl -u %s -n 12 --no-pager 2>&1 | tail -12" % SERVICE)

        print()
        print("=" * 60)
        print("7) 接口自检")
        print("=" * 60)
        run(c, "curl -s http://127.0.0.1:8805/openapi.json | python3 -c \"import sys,json;d=json.load(sys.stdin);ps=sorted(d['paths']);print(len(ps));print('\\n'.join(ps))\"")
        run(c, "curl -s -o /tmp/fb2.txt -w 'GET  /api/feedback -> %{http_code}\\n' http://127.0.0.1:8805/api/feedback; curl -s -o /tmp/fb3.txt -w 'POST /api/feedback -> %{http_code}\\n' -X POST http://127.0.0.1:8805/api/feedback -H 'Content-Type: application/json' -d '{}'; echo 'POST body:'; head -c 200 /tmp/fb3.txt")
    finally:
        sftp.close()
        c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
