"""把当前测试包放到 /test/ 固定路径，供随时下载。

用法（口令走环境变量，不落盘）：
    DEPLOY_PASS=xxx python qa/deploy_test.py [本地 apk 路径]
"""
import hashlib
import os
import sys
import tempfile

import paramiko

HOST = "175.24.230.58"
USER = "root"
PASS = os.environ.get("DEPLOY_PASS", "")

SLUG = "test"
WEB_ROOT = "/www/wwwroot/dorm-app-web"
REMOTE_DIR = WEB_ROOT + "/" + SLUG
CONF = "/etc/nginx/conf.d/01-ip-https.conf"
ANCHOR = "    # ---------- 静态资源 ----------"

DEFAULT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "dorm-app", "dist-apk", "dorm-sign-2.0.11-beta5.apk",
)

BLOCK = """
    # 固定测试通道：永远指向最新一个 beta，文件名带完整版本号
    location /%(slug)s/ {
        alias %(dir)s/;
        autoindex on;
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
              banner_timeout=20, auth_timeout=20,
              look_for_keys=False, allow_agent=False)
    return c


def run(c, cmd, quiet=False):
    _, out, err = c.exec_command(cmd, timeout=120)
    o = out.read().decode("utf-8", "ignore").strip()
    e = err.read().decode("utf-8", "ignore").strip()
    if not quiet:
        print("$ " + cmd)
        if o:
            print(o)
        if e:
            print("[stderr] " + e)
        print("-" * 60)
    return o + e


def main():
    if not PASS:
        print("NO_PASS")
        return 2
    local = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    if not os.path.exists(local):
        print("NO_LOCAL_APK " + local)
        return 6
    name = os.path.basename(local)
    md5 = hashlib.md5(open(local, "rb").read()).hexdigest()
    print("local:", name, os.path.getsize(local), "md5", md5)

    c = connect()
    try:
        run(c, "mkdir -p %s && chmod 755 %s" % (REMOTE_DIR, REMOTE_DIR))

        sftp = c.open_sftp()
        with tempfile.NamedTemporaryFile("r", delete=False, encoding="utf-8") as fh:
            sftp.get(CONF, fh.name)
            conf_tmp = fh.name
        text = open(conf_tmp, encoding="utf-8").read()
        if "location /%s/" % SLUG in text:
            print("config: /%s/ already present" % SLUG)
        else:
            if ANCHOR not in text:
                print("ANCHOR_NOT_FOUND")
                return 4
            stamp = "20261105f"
            run(c, "cp %s %s.bak.%s" % (CONF, CONF, stamp))
            new_text = text.replace(ANCHOR, BLOCK + "\n" + ANCHOR, 1)
            with open(conf_tmp, "w", encoding="utf-8") as fh:
                fh.write(new_text)
            sftp.put(conf_tmp, "/tmp/01-ip-https.conf.new")
            res = run(c, "cp /tmp/01-ip-https.conf.new %s && nginx -t 2>&1 | tail -2" % CONF)
            if "syntax is ok" not in res:
                run(c, "cp %s.bak.%s %s" % (CONF, stamp, CONF))
                print("NGINX_TEST_FAILED_ROLLED_BACK")
                return 4
            run(c, "nginx -s reload 2>&1 | tail -2")
        sftp.close()

        sftp = c.open_sftp()
        sftp.put(local, "%s/%s" % (REMOTE_DIR, name))
        sftp.close()
        out = run(c, "ls -l %s/%s && md5sum %s/%s" % (REMOTE_DIR, name, REMOTE_DIR, name))
        if md5 not in out:
            print("REMOTE_MD5_MISMATCH")
            return 5

        run(c, 'curl -s -o /dev/null -w "local_code=%%{http_code} size=%%{size_download}\\n" -k https://127.0.0.1/%s/%s' % (SLUG, name))
        print("URL https://%s/%s/%s" % (HOST, SLUG, name))
    finally:
        c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
