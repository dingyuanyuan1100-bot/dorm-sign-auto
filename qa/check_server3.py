"""第三轮：证书续期、当前 JS 是否还有应用内下载代码、后端接口、公告、冗余占用。"""
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


sec("H) 证书续期机制", r"""
echo '--- timer ---'
systemctl list-timers --all 2>/dev/null | grep -iE 'certbot|snap' || echo '(无 timer)'
echo '--- timer 详情 ---'
systemctl is-enabled certbot-renew.timer 2>/dev/null; systemctl is-active certbot-renew.timer 2>/dev/null
echo '--- 最近续期日志 ---'
journalctl -u certbot-renew.service -n 12 --no-pager 2>/dev/null | tail -14 || ls -t /var/log/letsencrypt/*.log 2>/dev/null | head -3
echo '--- 剩余天数 ---'
openssl x509 -in /etc/letsencrypt/live/ip-175.24.230.58/fullchain.pem -noout -enddate
python3 -c "
import datetime,subprocess
s=subprocess.check_output(['openssl','x509','-in','/etc/letsencrypt/live/ip-175.24.230.58/fullchain.pem','-noout','-enddate']).decode().split('=',1)[1].strip()
d=datetime.datetime.strptime(s,'%b %d %H:%M:%S %Y %Z')
print('剩余 %.1f 天' % ((d-datetime.datetime.utcnow()).total_seconds()/86400))
"
""")
sec("I) 当前生效 JS 是否残留应用内下载代码", r"""
js=$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' {root}/current/index.html | head -1)
echo "入口: $js"
f="{root}/current/$js"
echo "--- 命中 ApkInstall / downloadApk / canInstall ---"
grep -c 'ApkInstall' "$f" 2>/dev/null || echo 0
grep -o 'downloadApk\|canInstall\|REQUEST_INSTALL_PACKAGES\|_system' "$f" 2>/dev/null | sort | uniq -c
echo "--- 是否含浏览器下载提示文案 ---"
grep -o '将打开浏览器下载安装包' "$f" 2>/dev/null | head -1 || echo '(未命中)'
""".format(root=ROOT))
sec("J) assets 残留统计", r"""
cd {root}/current/assets
echo "文件数: $(ls | wc -l)"
echo "被 index.html 引用的:"
grep -o 'assets/[A-Za-z0-9_.-]*' {root}/current/index.html | sort -u
echo "--- 未引用的旧 js 数量 ---"
echo $(ls *.js 2>/dev/null | wc -l) 个 js
""".format(root=ROOT))
sec("K) 后端接口与公告", r"""
echo '--- healthz（经 nginx）---'
curl -s -k -w '\n[%{http_code}]\n' https://HOSTX/healthz
echo '--- 公告 notice.json ---'
cat ROOTX/update/notice.json
echo '--- 公告外网可达 ---'
curl -s -k -o /dev/null -w 'notice.json -> %{http_code} %{size_download}B\n' https://HOSTX/update/notice.json
echo '--- 正式包外网可达 ---'
curl -s -k -o /dev/null -w 'apk -> %{http_code} %{size_download}B %{time_total}s\n' https://HOSTX/update/dorm-sign-2.0.13-release.apk
""".replace("HOSTX", HOST).replace("ROOTX", ROOT))
sec("L) 磁盘占用明细", r"""
du -sh {root}/update {root}/test {root}/current 2>/dev/null
echo '--- 站点根各项 ---'
du -sh {root}/* 2>/dev/null | sort -h | tail -12
echo '--- 全站合计 ---'
du -sh {root}
""".format(root=ROOT))

cli.close()
