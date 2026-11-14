"""深挖：update 目录全量、test 通道实际返回、nginx 站点配置、证书、与本地一致性。"""
import os
import sys
import warnings

import paramiko

warnings.filterwarnings("ignore")
HOST, USER = "175.24.230.58", "root"
PASS = os.environ.get("DEPLOY_PASS")
ROOT = "/www/wwwroot/dorm-app-web"
if not PASS:
    sys.exit("DEPLOY_PASS not set")

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, 22, USER, PASS, timeout=20, banner_timeout=30,
            auth_timeout=20, look_for_keys=False, allow_agent=False)


def run(cmd, timeout=120):
    _i, o, e = cli.exec_command(cmd, timeout=timeout)
    out = o.read().decode(errors="replace")
    err = e.read().decode(errors="replace")
    o.channel.recv_exit_status()
    t = out.strip()
    if err.strip():
        t += "\n[stderr] " + err.strip()
    return t


def sec(t, c):
    print("=" * 60)
    print(t)
    print("-" * 60)
    try:
        print(run(c))
    except Exception as ex:  # noqa: BLE001
        print("[ERR] %s" % ex)
    print()


sec("A) update/ 全量列表", "ls -1 %s/update/" % ROOT)
sec("B) /test/ 根返回什么", r"""
curl -s -k https://%s/test/ | head -20
echo '--- test 目录真实内容（含隐藏）---'
ls -la %s/test/
""" % (HOST, ROOT))
sec("C) 站点根目录结构", "ls -la %s; echo '--- current 内容 ---'; ls -la %s/current" % (ROOT, ROOT))
sec("D) nginx 实际生效配置", r"""
grep -rl 'dorm-app-web' /www/server/panel/vhost/nginx/ /etc/nginx/ 2>/dev/null
echo '--- 配置内容 ---'
f=$(grep -rl 'dorm-app-web' /www/server/panel/vhost/nginx/ /etc/nginx/ 2>/dev/null | head -1)
[ -n "$f" ] && cat "$f"
""")
sec("E) 证书", r"""
f=$(grep -rl 'dorm-app-web' /www/server/panel/vhost/nginx/ /etc/nginx/ 2>/dev/null | head -1)
grep -E 'ssl_certificate|ssl_certificate_key' "$f" 2>/dev/null
for c in $(grep -oE '/[^; ]+\.(pem|crt)' "$f" 2>/dev/null | head -2); do
  [ -f "$c" ] && echo "== $c" && openssl x509 -in "$c" -noout -subject -issuer -dates
done
""")
sec("F) 后端 API 健康", r"""
ps -eo pid,cmd | grep uvicorn | grep -v grep
echo '--- 本机探活 ---'
curl -s -o /dev/null -w 'localhost:8805 -> %{http_code} %{time_total}s\n' http://127.0.0.1:8805/docs
curl -s -k -o /dev/null -w 'https://HOST/api/  -> %{http_code}\n' https://HOST/api/
""".replace("HOST", HOST))

print("=" * 60)
print("G) 本地 dist 与线上 current 比对")
print("-" * 60)
HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(os.path.dirname(HERE), "dorm-app", "dist")
local_index = os.path.join(DIST, "index.html")
if os.path.exists(local_index):
    import hashlib
    lb = open(local_index, "rb").read()
    print("本地 dist/index.html  md5=%s size=%d" % (hashlib.md5(lb).hexdigest(), len(lb)))
    print("本地 dist 引用JS:", __import__("re").findall(r"assets/index-[A-Za-z0-9_-]*\.js", lb.decode(errors="replace"))[:1])
else:
    print("本地 dist 不存在:", DIST)
print("远端 current/index.html md5:", run("md5sum %s/current/index.html" % ROOT))
print("远端 current 引用JS:", run("grep -o 'assets/index-[A-Za-z0-9_-]*\\.js' %s/current/index.html | head -1" % ROOT))
print("远端 current 是否含 apk 插件痕迹:", run("grep -rl 'ApkInstall\\|downloadApk' %s/current/assets/ 2>/dev/null | head -3; echo done" % ROOT))

cli.close()
