"""推 2.0.11 正式版：Web 前端 + 更新 APK + 清单 + 测试通道同步。

DEPLOY_PASS=... python qa/deploy_release_2011.py
"""
import base64
import hashlib
import io
import json
import os
import sys
import tarfile
import warnings

import paramiko

warnings.filterwarnings("ignore")

HOST = "175.24.230.58"
USER = "root"
PASS = os.environ.get("DEPLOY_PASS")
ROOT = "/www/wwwroot/dorm-app-web"
STAMP = "20261106b"

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
DIST = os.path.join(PROJ, "dorm-app", "dist")
APK_NAME = "dorm-sign-2.0.11-release.apk"
APK_LOCAL = os.path.join(PROJ, "dorm-app", "dist-apk", APK_NAME)
VERSION = "2.0.11"
VERSION_CODE = 44

NOTES = [
    "新增公告：正文由服务端下发，未读自动展开，之后常驻收起",
    "更新改为应用内下载安装，不再跳到浏览器",
    "执行日志页顶部固定，只有列表滚动",
    "启动转场：首页内容先在启动页后落位，Logo 随后归位",
    "页面切换与按压反馈统一为弹簧动效",
    "请求改为串行，避免触发接口限流",
]

if not PASS:
    sys.exit("DEPLOY_PASS not set")
for p in (DIST, APK_LOCAL):
    if not os.path.exists(p):
        sys.exit("missing: " + p)

apk = open(APK_LOCAL, "rb").read()
apk_md5 = hashlib.md5(apk).hexdigest()
apk_size = len(apk)
size_label = "%.1f MB" % (apk_size / 1_000_000)

buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode="w:gz") as tf:
    for root, _dirs, files in os.walk(DIST):
        for name in files:
            full = os.path.join(root, name)
            arc = os.path.relpath(full, DIST).replace(os.sep, "/")
            tf.add(full, arcname=arc)
web = buf.getvalue()

manifest = {
    "version": VERSION,
    "versionCode": VERSION_CODE,
    "url": "https://%s/update/%s" % (HOST, APK_NAME),
    "size": size_label,
    "force": False,
    "publishedAt": "2026-11-06",
    "notes": NOTES,
}
manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, 22, USER, PASS, timeout=20, banner_timeout=30,
            auth_timeout=20, look_for_keys=False, allow_agent=False)


def run(cmd, timeout=180):
    _i, o, e = cli.exec_command(cmd, timeout=timeout)
    out = o.read().decode(errors="replace")
    err = e.read().decode(errors="replace")
    rc = o.channel.recv_exit_status()
    if rc != 0:
        raise RuntimeError("remote failed(%s): %s\n%s\n%s" % (rc, cmd, out, err))
    return out


def put_bytes(remote, data, timeout=600):
    """分块 base64 上传，避免 sftp/大包单次写入被截断。"""
    tmp = remote + ".b64"
    b64 = base64.b64encode(data).decode()
    _i, o, _e = cli.exec_command("cat > " + tmp, timeout=timeout)
    w = o.channel.makefile("wb")
    for k in range(0, len(b64), 262144):
        w.write(b64[k:k + 262144].encode())
    w.flush()
    w.channel.shutdown_write()
    w.close()
    if o.channel.recv_exit_status() != 0:
        raise RuntimeError("upload failed: " + remote)
    run("base64 -d %s > %s && rm -f %s" % (tmp, remote, tmp), timeout=timeout)


try:
    print("== 0) 现状 ==")
    print(run("cat %s/update/version.json; echo ---; grep -o 'assets/index-[A-Za-z0-9_-]*\\.js' %s/current/index.html | head -1" % (ROOT, ROOT)))

    print("== 1) 上传 Web 前端 ==")
    put_bytes("/tmp/dorm-web-2011.tar.gz", web)
    print(run("""
set -e
cd {root}
rm -rf prev.release_2011
cp -a current prev.release_2011
rm -rf staging_2011 && mkdir staging_2011
tar -xzf /tmp/dorm-web-2011.tar.gz -C staging_2011
cp -a staging_2011/. current/
rm -rf staging_2011 /tmp/dorm-web-2011.tar.gz
chown -R nginx:nginx current
grep -o 'assets/index-[A-Za-z0-9_-]*\\.js' current/index.html | head -1
""".format(root=ROOT)))

    print("== 2) 上传正式 APK ==")
    put_bytes("/tmp/" + APK_NAME, apk)
    print(run("""
set -e
mv /tmp/{apk} {root}/update/{apk}
chown nginx:nginx {root}/update/{apk}
chmod a+r {root}/update/{apk}
md5sum {root}/update/{apk}
""".format(apk=APK_NAME, root=ROOT)))

    print("== 3) 写更新清单 ==")
    put_bytes("/tmp/version-2011.json", manifest_bytes)
    print(run("""
set -e
cd {root}/update
cp -a version.json version.json.bak.{stamp}
mv /tmp/version-2011.json version.json
chown nginx:nginx version.json
chmod a+r version.json
cat version.json
""".format(root=ROOT, stamp=STAMP)))

    print("== 4) 测试通道同步（/test/ 只留正式包） ==")
    print(run("""
set -e
cd {root}/test
rm -f dorm-sign-2.0.11-beta*.apk
cp -a {root}/update/{apk} ./{apk}
chown nginx:nginx {apk}
chmod a+r {apk}
ls -lh
""".format(root=ROOT, apk=APK_NAME)))

    print("== 5) 远端自检 ==")
    print(run("""
set -e
echo '--- update/ ---'
ls -lah {root}/update/ | tail -12
echo '--- 备份 ---'
ls -ld {root}/prev.release_2011 {root}/update/version.json.bak.{stamp}
echo '--- nginx ---'
nginx -t 2>&1 | tail -2
""".format(root=ROOT, stamp=STAMP)))

    print("LOCAL_APK_MD5", apk_md5, "SIZE", apk_size, "LABEL", size_label)
    print("DEPLOY_OK")
finally:
    cli.close()
