// 2.0.11-beta5 验收 mock：日志页多日多行 + 公告
// 用法：node qa/mock_logs.cjs 8807
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.argv[2] || 8807);
const STATE = { notice: true };
// NOTICE_FROM=prod 时，/update/notice.json 直接转发线上服务器，
// 用来验证「前端 + 真实后端公告」这条链路，而不是本地 notice.json。
const FROM_PROD = process.env.NOTICE_FROM === "prod";

function prodNotice() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      "https://175.24.230.58/update/notice.json",
      { rejectUnauthorized: false, headers: { Origin: "https://localhost" }, timeout: 8000 },
      (r) => {
        let buf = "";
        r.setEncoding("utf8");
        r.on("data", (d) => (buf += d));
        r.on("end", () => (r.statusCode === 200 ? resolve(buf) : reject(new Error("HTTP " + r.statusCode))));
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}
const TOKEN = "qa-token";
const LOC = { id: 2, name: "晚寝任务位置", lat: "31.67381", lng: "118.555756", address: "3 号公寓 · 502", is_default: true };
const TASK = { id: 37, sign_time: "21:35", mode: "daily", sign_date: null, remark: "", location_id: 2, location: LOC, enabled: true, status: "waiting" };

const ok = (data = null, msg = "ok") => ({ success: true, msg, data });

const mk = (id, at, success, detail, msg) => ({ id, schedule_id: 37, run_at: at, success, detail, msg });

const LOGS = [
  mk(9006, "2026-11-05 22:00:12", false, "manual", "您今天已完成签到，请勿重复点击！"),
  mk(9005, "2026-11-05 21:35:02", true, "scheduled", "auto · 签到成功"),
  mk(9004, "2026-11-05 13:43:41", false, "manual", "未到签到时间！"),
  mk(9003, "2026-11-04 21:47:09", false, "manual", "您今天已完成签到，请勿重复点击！"),
  mk(9002, "2026-11-04 21:35:01", true, "scheduled", "auto · 签到成功"),
  mk(9001, "2026-11-02 21:59:33", true, "manual", "操作成功！"),
];

const routes = {
  "POST /api/auth/login": () => ok({ token: TOKEN, username: "123456" }),
  "GET /api/auth/me": () => ok({ username: "123456", has_dorm_account: true, student_id: "259104552" }),
  "POST /api/auth/logout": () => ok(),
  "GET /api/dorm-account": () => ok({ student_id: "259104552", nickname: "123456" }),
  "GET /api/locations": () => ok([LOC]),
  "GET /api/schedules": () => ok([TASK, { ...TASK, id: 38, sign_time: "22:10", mode: "once", enabled: false }]),
  "POST /api/schedules/37/run": () => ok({ success: true }, "已触发"),
  "GET /api/logs": () => ok(LOGS),
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "*");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (req.method === "OPTIONS") return res.end("{}");
    if (url.pathname === "/api/__notice") {
      STATE.notice = url.searchParams.get("on") !== "0";
      return res.end(JSON.stringify(ok({ notice: STATE.notice })));
    }
    // 假安装包：固定 3.2MB，限速分块吐出，用来观察下载进度
    if (url.pathname === "/qa/update.apk") {
      const total = 3200000;
      res.setHeader("Content-Type", "application/vnd.android.package-archive");
      res.setHeader("Content-Length", String(total));
      res.setHeader("Access-Control-Allow-Origin", "*");
      const chunk = Buffer.alloc(65536, 7);
      let sent = 0;
      const tick = () => {
        if (sent >= total) return res.end();
        const n = Math.min(chunk.length, total - sent);
        res.write(n === chunk.length ? chunk : chunk.subarray(0, n));
        sent += n;
        setTimeout(tick, 12);
      };
      return tick();
    }
    if (url.pathname === "/update/version.json") {
      const code = Number(process.env.UPDATE_CODE || 0);
      if (!code) {
        res.statusCode = 404;
        return res.end("{}");
      }
      return res.end(
        JSON.stringify({
          version: "9.9.9-qa",
          versionCode: code,
          url: process.env.UPDATE_URL || "/test/dorm-sign-2.0.11-beta8.apk",
          size: "3.2 MB",
          notes: ["应用内直接下载安装", "日志页只有列表滚动，顶部固定"],
        })
      );
    }
    if (url.pathname === "/update/notice.json") {
      if (FROM_PROD) {
        return prodNotice().then(
          (body) => {
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(body);
          },
          (err) => {
            res.statusCode = 502;
            res.end(JSON.stringify({ success: false, msg: String(err.message || err) }));
          }
        );
      }
      if (!STATE.notice) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ success: false, msg: "not found" }));
      }
      const body = fs.readFileSync(path.join(__dirname, "notice.json"));
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(body);
    }
    const fn = routes[`${req.method} ${url.pathname}`];
    res.statusCode = fn ? 200 : 404;
    res.end(JSON.stringify(fn ? fn() : { success: false, msg: "not found" }));
  })
  .listen(PORT, "127.0.0.1", () => console.log("mock on", PORT));
