"""把 2.0.14-beta3 测试包挂到 /test/ 下载通道（不改 update/version.json、不动 current/）。

DEPLOY_PASS=... python qa/upload_test_apk.py
"""
import hashlib
import os
import sys
import warnings

import paramiko

warnings.filterwarnings("ignore")

HOST = "175.24.230.58"
USER = "root"
PASS = os.environ.get("DEPLOY_PASS")
TEST_DIR = "/www/wwwroot/dorm-app-web/test"
# 包名可传参：python qa/upload_test_apk.py dorm-sign-2.0.14-beta6-release.apk
NAME = sys.argv[1] if len(sys.argv) > 1 else "dorm-sign-2.0.14-beta6-release.apk"

HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL_APK = os.path.join(os.path.dirname(HERE), "dorm-app", "dist-apk", NAME)

if not PASS:
    sys.exit("DEPLOY_PASS not set")
if not os.path.exists(LOCAL_APK):
    sys.exit("missing: " + LOCAL_APK)

data = open(LOCAL_APK, "rb").read()
md5 = hashlib.md5(data).hexdigest()

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, 22, USER, PASS, timeout=20, banner_timeout=30,
            auth_timeout=20, look_for_keys=False, allow_agent=False)


def run(cmd, timeout=120):
    _i, o, e = cli.exec_command(cmd, timeout=timeout)
    return o.channel.recv_exit_status(), o.read().decode(errors="replace"), e.read().decode(errors="replace")


print("== 上传 ==", NAME, "%.2f MB" % (len(data) / 1e6), "md5", md5)
sftp = cli.open_sftp()
sftp.put(LOCAL_APK, "%s/%s" % (TEST_DIR, NAME))
sftp.close()

rc, out, err = run("md5sum %s/%s; ls -l %s/%s; chown nginx:nginx %s/%s"
                   % (TEST_DIR, NAME, TEST_DIR, NAME, TEST_DIR, NAME))
print("  " + out.strip().replace("\n", "\n  "))
if md5 not in out:
    sys.exit("远端 md5 不一致！")

rc, out, _ = run("curl -s -o /dev/null -w '%%{http_code} %%{size_download} %%{content_type}' "
                 "-r 0-1023 https://%s/test/%s --resolve %s:443:127.0.0.1 -k" % (HOST, NAME, HOST))
print("== 回环 Range 请求:", out.strip())

rc, out, _ = run("ls -l %s" % TEST_DIR)
print("== 目录现状 ==")
for line in out.strip().splitlines():
    print("  " + line)

cli.close()
print("\n完成。下载地址 https://%s/test/%s" % (HOST, NAME))
