"""只读巡检线上服务器（不改动任何文件）。

DEPLOY_PASS=... python qa/check_server.py
"""
import os
import sys
import warnings

import paramiko

warnings.filterwarnings("ignore")

HOST = "175.24.230.58"
USER = "root"
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
    txt = out.strip()
    if err.strip():
        txt += "\n[stderr] " + err.strip()
    return txt


SECTIONS = [
    ("1) 主机 / 时间 / 负载", r"""
hostname; date '+%Y-%m-%d %H:%M:%S %Z'; uptime | sed 's/^ *//'
echo '--- 磁盘 ---'; df -h / | tail -1
echo '--- 内存 ---'; free -m | sed -n '2p'
"""),
    ("2) 更新清单 version.json", "cat %s/update/version.json" % ROOT),
    ("3) 站点当前产物", r"""
cd {root}
echo '--- current -> '; ls -ld current
echo '--- index.html 引用的 JS ---'; grep -o 'assets/index-[A-Za-z0-9_-]*\.js' current/index.html | head -1
echo '--- 关键文件 mtime ---'; ls -l --time-style=long-iso current/index.html current/version.json 2>/dev/null
echo '--- 前端目录大小 ---'; du -sh current 2>/dev/null
echo '--- prev 备份 ---'; ls -d prev* 2>/dev/null
""".format(root=ROOT)),
    ("4) update/ 目录（正式包）", r"""
ls -lah {root}/update/ | tail -15
echo '--- 各 APK md5 ---'
md5sum {root}/update/*.apk 2>/dev/null
""".format(root=ROOT)),
    ("5) test/ 目录（测试通道）", r"""
ls -lah {root}/test/ 2>/dev/null | tail -12
echo '--- test/version.json ---'
cat {root}/test/version.json 2>/dev/null || echo '(无)'
""".format(root=ROOT)),
    ("6) nginx 配置摘要", r"""
nginx -t 2>&1 | tail -2
echo '--- root / server_name ---'
grep -rnE 'server_name|root |listen ' /www/server/panel/vhost/nginx/*dorm* 2>/dev/null | head -20
"""),
    ("7) 证书有效期", r"""
for f in $(grep -rl 'ssl_certificate ' /www/server/panel/vhost/nginx/*dorm* 2>/dev/null); do
  cert=$(grep -oE 'ssl_certificate +[^;]+' $f | head -1 | awk '{print $2}')
  [ -f "$cert" ] && echo "$cert" && openssl x509 -in "$cert" -noout -subject -dates
done
"""),
    ("8) HTTPS 可用性（本机自测）", r"""
for u in https://HOSTX/ https://HOSTX/update/version.json https://HOSTX/test/; do
  code=$(curl -s -o /dev/null -w '%{http_code} %{size_download}B %{time_total}s' -k "$u")
  echo "$code  $u"
done
""".replace("HOSTX", HOST)),
    ("9) 运行进程 / 端口", r"""
ps -eo pid,etime,cmd --sort=-%cpu | grep -E 'nginx|node|python|java' | grep -v grep | head -8
echo '--- 监听端口 ---'
(ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null) | grep -E ':(80|443|3000|8080|8000) ' | head -8
"""),
]

try:
    for title, cmd in SECTIONS:
        print("=" * 60)
        print(title)
        print("-" * 60)
        try:
            print(run(cmd))
        except Exception as ex:  # noqa: BLE001
            print("[ERROR] %s" % ex)
        print()
finally:
    cli.close()
