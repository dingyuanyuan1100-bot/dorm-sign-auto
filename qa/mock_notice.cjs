// 2.0.11-beta3 视觉验收 mock：单任务 + 可控成功/失败的最近日志
// 用法：node qa/mock_notice.cjs 8807   切换：curl "http://127.0.0.1:8807/api/__ok?fail=1"
const http = require("http");

const PORT = Number(process.argv[2] || 8807);
const STATE = { fail: false };
const TOKEN = "qa-token";
const LOC = { id: 2, name: "晚寝任务位置", lat: "31.67381", lng: "118.555756", address: "3 号公寓 · 502", is_default: true };
const TASK = { id: 37, sign_time: "21:35", mode: "daily", sign_date: null, remark: "", location_id: 2, enabled: true, status: "waiting" };

const ok = (data = null, msg = "ok") => ({ success: true, msg, data });

const routes = {
  "POST /api/auth/login": () => ok({ token: TOKEN, username: "123456" }),
  "GET /api/auth/me": () => ok({ username: "123456", has_dorm_account: true, student_id: "259104552" }),
  "POST /api/auth/logout": () => ok(),
  "GET /api/dorm-account": () => ok({ student_id: "259104552", nickname: "123456" }),
  "GET /api/locations": () => ok([LOC]),
  "GET /api/schedules": () => ok([TASK, { ...TASK, id: 38, sign_time: "22:10", mode: "once", enabled: false }]),
  "POST /api/schedules/37/run": () => ok({ success: true }, "已触发"),
  "GET /api/logs": () =>
    ok([
      {
        id: 9001,
        schedule_id: 37,
        run_at: "2026-11-05 21:35:09",
        success: !STATE.fail,
        detail: "scheduled",
        msg: STATE.fail ? "上游超时" : "签到成功",
      },
    ]),
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "*");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (req.method === "OPTIONS") return res.end("{}");
    if (url.pathname === "/api/__ok") {
      STATE.fail = url.searchParams.get("fail") === "1";
      return res.end(JSON.stringify(ok({ fail: STATE.fail })));
    }
    const fn = routes[`${req.method} ${url.pathname}`];
    res.statusCode = fn ? 200 : 404;
    res.end(JSON.stringify(fn ? fn() : { success: false, msg: "not found" }));
  })
  .listen(PORT, "127.0.0.1", () => console.log("mock on", PORT));
