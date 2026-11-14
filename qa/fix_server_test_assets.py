"""收尾两处小问题（可回滚）：
1) /test/ 关闭 autoindex —— 只关目录列表，直链下载不受影响
2) current/assets 清走 6 个上一代无人引用的文件（移到资产备份目录，不删除）

DEPLOY_PASS=... python qa/fix_server_test_assets.py
"""
import os
import sys
import warnings

import paramiko

warnings.filterwarnings("ignore")

HOST, USER = "175.24.230.58", "root"
PASS = os.environ.get("DEPLOY_PASS")
ROOT = "/www/wwwroot/dorm-app-web"
CONF = "/etc/nginx/conf.d/01-ip-https.conf"
STAMP = "20261107a"
ASSET_BAK = "%s/asset_bak_%s" % (ROOT, STAMP)

# 保留：入口 js、入口 css、动态 import 的 web chunk、6 个字体
KEEP = [
    "index-Dc8Av5nP.js",
    "index-CIn59Fa8.css",
    "web-C2L7ddMz.js",
    "noto-sc-400-DJFk_Aih.woff2",
    "noto-sc-500-i__fUN1T.woff2",
    "noto-sc-700-avrJ7gs3.woff2",
    "poppins-400-cpxAROuN.woff2",
    "poppins-500-C8OXljZJ.woff2",
    "poppins-700-Qrb0O0WB.woff2",
]
DROP = [
    "index-C9cd1K1i.js",
    "index-rCZ6NDFc.js",
    "index-rhKfRPDi.js",
    "index-D4UPPvX8.css",
    "index-zH_1xyZI.css",
    "web-B8Zo5VNP.js",
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
    return (out.strip() + ("\n[stderr] " + err.strip() if err.strip() else ""))


try:
    print("== 0) 改动前状态 ==")
    print(run("grep -n 'autoindex' %s; echo '---'; ls -1 %s/current/assets | wc -l" % (CONF, ROOT)))

    print("\n== 1) 备份 nginx 配置并关闭 /test/ 目录列表 ==")
    print(run(r"""
set -e
cp -a CONFXPATH CONFXPATH.bak.STAMPX
# 只改 /test/ 这个 location 块内的 autoindex，/update/ 的 autoindex off 不动
sed -i '/location \/test\/ {/,/}/ s/autoindex on;/autoindex off;/' CONFXPATH
echo '--- 改后 ---'
grep -n 'autoindex' CONFXPATH
echo '--- 语法 ---'
nginx -t 2>&1 | tail -2
""".replace("CONFXPATH", CONF).replace("STAMPX", STAMP)))

    print("\n== 2) 移走无人引用的旧 assets（保留 9 个在用的）==")
    print(run(r"""
set -e
cd {root}/current/assets
mkdir -p {bak}
for f in {drop}; do
  [ -f "$f" ] && mv -v "$f" {bak}/ || true
done
echo '--- 现存 ---'
ls -1
echo '--- 备份 ---'
ls -1 {bak}
""".format(root=ROOT, bak=ASSET_BAK, drop=" ".join(DROP))))

    print("\n== 3) reload nginx ==")
    print(run("nginx -t 2>&1 | tail -1 && nginx -s reload && echo RELOADED && sleep 1 && echo ok"))

    print("\n== 4) 线上验证 ==")
    print(run(r"""
echo '--- 静态资源全部 200？ ---'
for p in / /index.html /assets/index-Dc8Av5nP.js /assets/index-CIn59Fa8.css /assets/web-C2L7ddMz.js \
         /assets/noto-sc-400-DJFk_Aih.woff2 /assets/poppins-700-Qrb0O0WB.woff2 /fonts/alimama-700.woff2; do
  printf '%-45s %s\n' "$p" "$(curl -s -k -o /dev/null -w '%{http_code} %{size_download}B' https://HOST$p)"
done
echo '--- 已移走的旧资源应为 404 ---'
for p in /assets/index-C9cd1K1i.js /assets/web-B8Zo5VNP.js; do
  printf '%-45s %s\n' "$p" "$(curl -s -k -o /dev/null -w '%{http_code}' https://HOST$p)"
done
echo '--- /test/ 目录列表应 403，直链应 200 ---'
printf '/test/                    %s\n' "$(curl -s -k -o /dev/null -w '%{http_code}' https://HOST/test/)"
printf '/test/apk                 %s\n' "$(curl -s -k -o /dev/null -w '%{http_code} %{size_download}B' https://HOST/test/dorm-sign-2.0.13-release.apk)"
echo '--- 版本清单未受影响 ---'
curl -s -k https://HOST/update/version.json | head -3
""".replace("HOST", HOST)))

    print("\n== 5) 回滚说明 ==")
    print("配置回滚: cp -a %s.bak.%s %s && nginx -s reload" % (CONF, STAMP, CONF))
    print("资源回滚: mv %s/* %s/current/assets/" % (ASSET_BAK, ROOT))
    print("DONE")
finally:
    cli.close()
