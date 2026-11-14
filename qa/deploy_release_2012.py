"""推 2.0.12 正式版：修「下载完提示没有安装权限」（应用内安装权限流程）。

DEPLOY_PASS=... python qa/deploy_release_2012.py
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
STAMP = "20261106c"

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
DIST = os.path.join(PROJ, "dorm-app", "dist")
APK_NAME = "dorm-sign-2.0.12-release.apk"
APK_LOCAL = os.path.join(PROJ, "dorm-app", "dist-apk", APK_NAME)
VERSION = "2.0.12"
VERSION_CODE = 45

NOTES = [
    "修复下载完成后提示「没有安装权限」：自动打开「允许安装未知应用」开关页，开启后返回即继续安装",
    "已允许安装权限时不再重复下载安装包",
    "当前版本不支持应用内安装时，直接转为网页下载",
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
    put_bytes("/tmp/dorm-web-2012.tar.gz", web)
    print(run("""
set -e
cd {root}
rm -rf prev.release_2012
cp -a current prev.release_2012
rm -rf staging_2012 && mkdir staging_2012
tar -xzf /tmp/dorm-web-2012.tar.gz -C staging_2012
cp -a staging_2012/. current/
rm -rf staging_2012 /tmp/dorm-web-2012.tar.gz
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
    put_bytes("/tmp/version-2012.json", manifest_bytes)
    print(run("""
set -e
cd {root}/update
cp -a version.json version.json.bak.{stamp}
mv /tmp/version-2012.json version.json
chown nginx:nginx version.json
chmod a+r version.json
cat version.json
""".format(root=ROOT, stamp=STAMP)))

    print("== 4) 测试通道同步（/test/ 只留正式包） ==")
    print(run("""
set -e
cd {root}/test
rm -f dorm-sign-2.0.11-beta*.apk dorm-sign-2.0.11-release.apk
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
ls -ld {root}/prev.release_2012 {root}/update/version.json.bak.{stamp}
echo '--- nginx ---'
nginx -t 2>&1 | tail -2
""".format(root=ROOT, stamp=STAMP)))

    print("LOCAL_APK_MD5", apk_md5, "SIZE", apk_size, "LABEL", size_label)
    print("DEPLOY_OK")
finally:
    cli.close()
