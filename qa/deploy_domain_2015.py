# -*- coding: utf-8 -*-
"""deploy_domain_2015.py — 让 wuxianshitu.icu 站点具备与 IP 站点一致的静态/更新/接口能力

做法：以线上 01-ip-https.conf 的 server 块为基线，替换 server_name、证书、
反代 Host，追加 /admin/，生成域名 conf。IP 站点原文件不动，正式通道保持原样。
流程：备份 → nginx -t → reload → 逐路径验证；校验失败自动恢复备份。

用法：DEPLOY_PASS=xxx python qa/deploy_domain_2015.py
"""
import os
import sys
import time
import warnings

import paramiko

warnings.filterwarnings("ignore")

HOST, USER = "175.24.230.58", "root"
PASS = os.environ.get("DEPLOY_PASS", "")
IP_CONF = "/etc/nginx/conf.d/01-ip-https.conf"
DOMAIN_CONF = "/etc/nginx/conf.d/wuxianshitu.icu.conf"
TS = time.strftime("%Y%m%d%H%M%S")
LOCAL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ADMIN_BLOCK = """    # ---------- 意见反馈管理后台 ----------
    location = /admin { return 301 /admin/; }
    location /admin/ {
        alias /www/wwwroot/dorm-app-web/admin/;
        index index.html;
        add_header Cache-Control "no-store";
    }

"""

CHECK_PATHS = [
    "/",
    "/index.html",
    "/update/version.json",
    "/update/notice.json",
    "/update/dorm-sign-2.0.14-release.apk",
    "/fonts/alimama-700.woff2",
    "/admin/",
    "/api/auth/me",
    "/test/dorm-sign-2.0.14-beta8-release.apk",
]


def main():
    if not PASS:
        sys.exit("DEPLOY_PASS not set")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, 22, USER, PASS, timeout=20, banner_timeout=30,
              auth_timeout=20, look_for_keys=False, allow_agent=False)

    def run(cmd, timeout=120, quiet=False):
        _, o, e = c.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "ignore") + e.read().decode("utf-8", "ignore")
        if not quiet:
            print("$ " + cmd)
            if out.strip():
                print(out.strip())
        return out.strip()

    sftp = c.open_sftp()
    ip_text = sftp.open(IP_CONF, "r").read().decode("utf-8", "ignore")
    old_domain = sftp.open(DOMAIN_CONF, "r").read().decode("utf-8", "ignore")

    # 以 IP 站点为基线生成域名站点
    text = ip_text
    text = text.replace("listen 443 ssl default_server;", "listen 443 ssl;")
    text = text.replace("server_name 175.24.230.58;",
                        "server_name wuxianshitu.icu www.wuxianshitu.icu;")
    text = text.replace("/etc/letsencrypt/live/ip-175.24.230.58/fullchain.pem",
                        "/etc/nginx/certs/wuxianshitu.icu_bundle.pem")
    text = text.replace("/etc/letsencrypt/live/ip-175.24.230.58/privkey.pem",
                        "/etc/nginx/certs/wuxianshitu.icu.key")
    # 余下的 IP 只应出现在注释和反代 Host 里；统一改用请求 Host
    text = text.replace("175.24.230.58", "$host")
    # 上一行会把刚替换好的 server_name 里的域名保留（已无 IP），证书注释里的 IP 也换成 $host，无害
    text = text.replace(
        "# IP 直连 HTTPS：Let's Encrypt IP 证书（160h，shortlived profile，certbot-renew.timer 自动续期）",
        "# 域名 HTTPS：TrustAsia DV 证书；结构与 IP 站点一致（由 deploy_domain_2015.py 生成）")
    anchor = "    # ---------- 静态资源 ----------"
    if anchor not in text:
        sys.exit("IP 站点配置里找不到静态资源锚点，已中止")
    if "location /admin/" not in text:
        text = text.replace(anchor, ADMIN_BLOCK + anchor, 1)

    header = ("# 域名站点 wuxianshitu.icu / www.wuxianshitu.icu\n"
              "# 生成时间 " + TS + " · 源基线 01-ip-https.conf · 证书 /etc/nginx/certs/\n")
    # 80 端口跳转保留，随后接新的 443 server
    redirect = ("server {\n"
                "    listen 80;\n"
                "    server_name wuxianshitu.icu www.wuxianshitu.icu;\n"
                "    return 301 https://$host$request_uri;\n"
                "}\n\n")
    new_conf = header + redirect + text.strip() + "\n"

    # 本地留档
    outdir = os.path.join(LOCAL, "deploy", "nginx")
    os.makedirs(outdir, exist_ok=True)
    with open(os.path.join(outdir, "wuxianshitu.icu.conf"), "w", encoding="utf-8") as fh:
        fh.write(new_conf)
    print("本地留档：deploy/nginx/wuxianshitu.icu.conf  %d B" % len(new_conf.encode("utf-8")))

    run("cp -a %s %s.bak.%s" % (DOMAIN_CONF, DOMAIN_CONF, TS))
    with sftp.open(DOMAIN_CONF, "w") as fh:
        fh.write(new_conf.encode("utf-8"))

    test = run("nginx -t 2>&1", quiet=True)
    print("nginx -t -> " + test.replace("\n", " | "))
    if "syntax is ok" not in test or "test is successful" not in test:
        with sftp.open(DOMAIN_CONF, "w") as fh:
            fh.write(old_domain.encode("utf-8"))
        sys.exit("配置校验失败，已恢复备份 .bak." + TS)

    run("systemctl reload nginx && echo RELOAD_OK")

    print("=" * 64)
    print("域名站点逐路径验证（服务器本机带 Host 回环）")
    base = ("curl -s -k -m 8 --resolve www.wuxianshitu.icu:443:127.0.0.1 "
            "-H 'Host: www.wuxianshitu.icu'")
    for p in CHECK_PATHS:
        cmd = base + " -o /dev/null -w '%{http_code} %{content_type} %{size_download}' https://www.wuxianshitu.icu" + p
        print("  %-52s %s" % (p, run(cmd, quiet=True)))
    opt = run(base + " -X OPTIONS -D - -o /dev/null "
              "https://www.wuxianshitu.icu/update/version.json 2>&1 | grep -iE 'HTTP/|access-control' | head -8",
              quiet=True)
    print("  OPTIONS /update/version.json:\n" + opt)

    print("=" * 64)
    print("IP 站点未改动，校验：" + run("md5sum " + IP_CONF + " | cut -c1-32", quiet=True))
    print("备份：%s.bak.%s" % (DOMAIN_CONF, TS))
    sftp.close()
    c.close()


if __name__ == "__main__":
    main()
