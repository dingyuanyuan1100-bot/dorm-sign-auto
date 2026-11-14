"""上传 beta2 测试包到 175.24.230.58，并确保 /beta2/ 的 nginx 路由可用。

用法（口令走环境变量，不落盘）：
    DEPLOY_PASS=xxx python qa/deploy_beta2.py probe
    DEPLOY_PASS=xxx python qa/deploy_beta2.py deploy
"""
import os
import sys
import hashlib
import tempfile
import paramiko

HOST = "175.24.230.58"
USER = "root"
PASS = os.environ.get("DEPLOY_PASS", "")
LOCAL = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "dorm-app", "dist-apk", "dorm-sign-2.0.10-beta2.apk",
)
NAME = "dorm-sign-2.0.10-beta2.apk"
REMOTE_DIR = "/www/wwwroot/dorm-app-web/beta2"
CONF = "/etc/nginx/conf.d/01-ip-https.conf"

BLOCK = """
    location /beta2/ {
        alias /www/wwwroot/dorm-app-web/beta2/;
        autoindex off;
        add_header Cache-Control "no-store";
        add_header Access-Control-Allow-Origin "*" always;
        if ($request_method = OPTIONS) { return 204; }
        types { application/vnd.android.package-archive apk; }
    }
"""


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASS, timeout=15, banner_timeout=20, auth_timeout=20)
    return c


def run(c, cmd, quiet=False):
    _, out, err = c.exec_command(cmd, timeout=90)
    o = out.read().decode("utf-8", "ignore").strip()
    e = err.read().decode("utf-8", "ignore").strip()
    if not quiet:
        print("$ " + cmd)
        if o:
            print(o)
        if e:
            print("[stderr] " + e)
        print("-" * 60)
    return o, e


def insert_block(text):
    """把 /beta2/ 段插在 /beta/ 段之后（大括号配平后插入）。"""
    if "location /beta2/" in text:
        return text, False
    head = text.find("location /beta/")
    if head < 0:
        raise RuntimeError("找不到 location /beta/ 段")
    i = text.find("{", head)
    depth = 0
    j = i
    while j < len(text):
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    return text[: j + 1] + "\n" + BLOCK + text[j + 1 :], True


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "probe"
    if not PASS:
        print("NO_PASS")
        return 2
    md5 = hashlib.md5(open(LOCAL, "rb").read()).hexdigest()
    print("local:", os.path.basename(LOCAL), os.path.getsize(LOCAL), "md5", md5)

    c = connect()
    try:
        run(c, "mkdir -p %s && chmod 755 %s" % (REMOTE_DIR, REMOTE_DIR))

        # 1) 配置：确认 /beta2/ 段存在（缺则插入并 reload）
        sftp = c.open_sftp()
        with tempfile.NamedTemporaryFile("r", delete=False, encoding="utf-8") as fh:
            sftp.get(CONF, fh.name)
            local_conf = fh.name
        text = open(local_conf, encoding="utf-8").read()
        new_text, changed = insert_block(text)

        if changed:
            run(c, "cp %s %s.bak.%s" % (CONF, CONF, "20261104b"))
            tmp = "/tmp/01-ip-https.conf.new"
            with open(local_conf, "w", encoding="utf-8") as fh:
                fh.write(new_text)
            sftp.put(local_conf, tmp)
            o, e = run(c, "cp %s %s && nginx -t 2>&1 | tail -2" % (tmp, CONF))
            if "syntax is ok" not in (o + e):
                run(c, "cp %s.bak.%s %s" % (CONF, "20261104b", CONF))
                print("NGINX_TEST_FAILED_ROLLED_BACK")
                return 4
            run(c, "nginx -s reload 2>&1 | tail -2")
        else:
            print("config: /beta2/ already present")
        sftp.close()

        # 2) 上传 APK
        sftp = c.open_sftp()
        sftp.put(LOCAL, REMOTE_DIR + "/" + NAME)
        sftp.close()
        o, _ = run(c, "ls -l %s/%s && md5sum %s/%s" % (REMOTE_DIR, NAME, REMOTE_DIR, NAME))
        if md5 not in o:
            print("REMOTE_MD5_MISMATCH")
            return 5

        # 3) 本机回环验证（走 nginx，不依赖外网）
        run(c, 'curl -s -o /dev/null -w "local_code=%%{http_code} size=%%{size_download}\\n" -k https://127.0.0.1/beta2/%s' % NAME)
        print("URL https://%s/beta2/%s" % (HOST, NAME))
    finally:
        c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
