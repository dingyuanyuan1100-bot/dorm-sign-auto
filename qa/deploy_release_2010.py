"""推 2.0.10 正式版：Web 前端 + 更新 APK + 清单。DEPLOY_PASS=... python qa/deploy_release_2010.py"""
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
STAMP = "20261104l"

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
DIST = os.path.join(PROJ, "dorm-app", "dist")
APK_LOCAL = os.path.join(PROJ, "dorm-app", "dist-apk", "dorm-sign-2.0.10-release.apk")
APK_NAME = "dorm-sign-2.0.10-release.apk"
VERSION = "2.0.10"
VERSION_CODE = 34

NOTES = [
    "启动与登录转场统一为同一套动效，Logo 与背景落位更精准",
    "修复启动进入首页后页面组件出现过慢的问题",
    "登录页背景收拢全程保持圆角，过渡更顺滑",
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
    "publishedAt": "2026-11-04",
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
    put_bytes("/tmp/dorm-web-2010.tar.gz", web)
    print(run("""
set -e
cd {root}
rm -rf prev.release_2010
cp -a current prev.release_2010
rm -rf staging_2010 && mkdir staging_2010
tar -xzf /tmp/dorm-web-2010.tar.gz -C staging_2010
cp -a staging_2010/. current/
rm -rf staging_2010 /tmp/dorm-web-2010.tar.gz
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
    put_bytes("/tmp/version-2010.json", manifest_bytes)
    print(run("""
set -e
cd {root}/update
cp -a version.json version.json.bak.{stamp}
mv /tmp/version-2010.json version.json
chown nginx:nginx version.json
chmod a+r version.json
cat version.json
""".format(root=ROOT, stamp=STAMP)))

    print("== 4) 远端自检 ==")
    print(run("""
set -e
echo '--- update/ ---'
ls -lah {root}/update/ | tail -12
echo '--- 备份 ---'
ls -ld {root}/prev.release_2010 {root}/update/version.json.bak.{stamp}
echo '--- nginx ---'
nginx -t 2>&1 | tail -2
""".format(root=ROOT, stamp=STAMP)))

    print("LOCAL_APK_MD5", apk_md5, "SIZE", apk_size, "LABEL", size_label)
    print("DEPLOY_OK")
finally:
    cli.close()
