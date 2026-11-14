"""上传 beta3 测试包到 175.24.230.58，并确保 /beta3/ 的 nginx 路由可用。

用法（口令走环境变量，不落盘）：
    DEPLOY_PASS=xxx python qa/deploy_beta3.py
"""
import os
import sys
import hashlib
import tempfile
import paramiko

HOST = "175.24.230.58"
USER = "root"
PASS = os.environ.get("DEPLOY_PASS", "")

SLUG = "beta3"
NAME = "dorm-sign-2.0.10-beta3.apk"
LOCAL = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "dorm-app", "dist-apk", NAME,
)
REMOTE_DIR = "/www/wwwroot/dorm-app-web/" + SLUG
CONF = "/etc/nginx/conf.d/01-ip-https.conf"

BLOCK = """
    location /%(slug)s/ {
        alias %(dir)s/;
        autoindex off;
        add_header Cache-Control "no-store";
        add_header Access-Control-Allow-Origin "*" always;
        if ($request_method = OPTIONS) { return 204; }
        types { application/vnd.android.package-archive apk; }
    }
""" % {"slug": SLUG, "dir": REMOTE_DIR}


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASS, timeout=15,
              banner_timeout=20, auth_timeout=20)
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


def block_end(text, anchor):
    """返回 anchor 段右大括号之后的下标；找不到返回 -1。"""
    head = text.find("location " + anchor)
    if head < 0:
        return -1
    i = text.find("{", head)
    depth = 0
    j = i
    while j < len(text):
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                return j + 1
        j += 1
    return -1


def insert_block(text):
    target = "location /%s/" % SLUG
    if target in text:
        return text, False
    for anchor in ("/beta2/", "/beta/"):
        pos = block_end(text, anchor)
        if pos > 0:
            return text[:pos] + "\n" + BLOCK + text[pos:], True
    raise RuntimeError("找不到可插入的 betа 段")


def main():
    if not PASS:
        print("NO_PASS")
        return 2
    if not os.path.exists(LOCAL):
        print("NO_LOCAL_APK " + LOCAL)
        return 6
    md5 = hashlib.md5(open(LOCAL, "rb").read()).hexdigest()
    print("local:", os.path.basename(LOCAL), os.path.getsize(LOCAL), "md5", md5)

    c = connect()
    try:
        run(c, "mkdir -p %s && chmod 755 %s" % (REMOTE_DIR, REMOTE_DIR))

        sftp = c.open_sftp()
        with tempfile.NamedTemporaryFile("r", delete=False, encoding="utf-8") as fh:
            sftp.get(CONF, fh.name)
            local_conf = fh.name
        text = open(local_conf, encoding="utf-8").read()
        new_text, changed = insert_block(text)

        if changed:
            run(c, "cp %s %s.bak.%s" % (CONF, CONF, "20261104c"))
            tmp = "/tmp/01-ip-https.conf.new"
            with open(local_conf, "w", encoding="utf-8") as fh:
                fh.write(new_text)
            sftp.put(local_conf, tmp)
            o, e = run(c, "cp %s %s && nginx -t 2>&1 | tail -2" % (tmp, CONF))
            if "syntax is ok" not in (o + e):
                run(c, "cp %s.bak.%s %s" % (CONF, "20261104c", CONF))
                print("NGINX_TEST_FAILED_ROLLED_BACK")
                return 4
            run(c, "nginx -s reload 2>&1 | tail -2")
        else:
            print("config: /%s/ already present" % SLUG)
        sftp.close()

        sftp = c.open_sftp()
        sftp.put(LOCAL, REMOTE_DIR + "/" + NAME)
        sftp.close()
        o, _ = run(c, "ls -l %s/%s && md5sum %s/%s" % (REMOTE_DIR, NAME, REMOTE_DIR, NAME))
        if md5 not in o:
            print("REMOTE_MD5_MISMATCH")
            return 5

        run(c, 'curl -s -o /dev/null -w "local_code=%%{http_code} size=%%{size_download}\\n" -k https://127.0.0.1/%s/%s' % (SLUG, NAME))
        print("URL https://%s/%s/%s" % (HOST, SLUG, NAME))
    finally:
        c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
