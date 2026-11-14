// 故障注入代理：把目标端口包一层，遇到 POST 时「服务端已处理但回包丢失」
// node qa/flaky_proxy.cjs <listenPort> <targetPort> [dropAfter=N]
// 机制：客户端连接上看到 POST 请求 → 记标记；服务器一旦回包，直接掐断客户端连接（不回包）
const net = require("net");

const LISTEN = Number(process.argv[2] || 8807);
const TARGET = Number(process.argv[3] || 8806);

const hits = { conn: 0, post: 0, dropped: 0 };

net
  .createServer((client) => {
    hits.conn++;
    const up = net.connect(TARGET, "127.0.0.1");
    let isPost = false;
    let killed = false;

    client.on("data", (buf) => {
      if (!isPost && /^(POST|PUT|DELETE) /m.test(buf.toString("latin1", 0, Math.min(buf.length, 200)))) isPost = true;
      up.write(buf);
    });

    up.on("data", (buf) => {
      if (isPost && !killed) {
        // 服务端已经把这次写请求处理完了，这里故意不回包，模拟「连不上」
        killed = true;
        hits.post++;
        hits.dropped++;
        console.log(`[drop] 写请求回包被丢弃（服务端已处理）`);
        try { client.destroy(); } catch {}
        try { up.destroy(); } catch {}
        return;
      }
      client.write(buf);
    });

    const bye = () => { try { client.destroy(); } catch {} try { up.destroy(); } catch {} };
    client.on("error", bye);
    up.on("error", bye);
    client.on("close", bye);
    up.on("close", bye);
  })
  .listen(LISTEN, "127.0.0.1", () => console.log(`flaky proxy 127.0.0.1:${LISTEN} -> 127.0.0.1:${TARGET}`));

process.on("SIGINT", () => { console.log(JSON.stringify(hits)); process.exit(0); });
