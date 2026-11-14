// 模拟「连接被服务端回收后仍被复用」：第 1 个写请求直接被掐断（服务端根本没收到），
// 之后的写请求正常放行。用来复现「点创建提示连不上，再点一次就成功」。
// node qa/stale_proxy.cjs <listenPort> <targetPort> [failCount=1]
const net = require("net");

const LISTEN = Number(process.argv[2] || 8808);
const TARGET = Number(process.argv[3] || 8806);
const FAIL_N = Number(process.argv[4] || 1);

const hits = { conn: 0, write: 0, killed: 0 };

net
  .createServer((client) => {
    hits.conn++;
    const up = net.connect(TARGET, "127.0.0.1");
    let killed = false;

    client.on("data", (buf) => {
      const head = buf.toString("latin1", 0, Math.min(buf.length, 200));
      if (!killed && /^(POST|PUT|DELETE) /.test(head)) {
        hits.write++;
        if (hits.write <= FAIL_N) {
          // 服务端没收到这个请求，客户端看到的是连接被对端关闭
          hits.killed++;
          killed = true;
          console.log(`[stale] 第 ${hits.write} 个写请求被掐断（服务端未收到）`);
          try { client.destroy(); } catch {}
          try { up.destroy(); } catch {}
          return;
        }
      }
      up.write(buf);
    });

    up.on("data", (buf) => client.write(buf));
    const bye = () => { try { client.destroy(); } catch {} try { up.destroy(); } catch {} };
    client.on("error", bye);
    up.on("error", bye);
    client.on("close", bye);
    up.on("close", bye);
  })
  .listen(LISTEN, "127.0.0.1", () => console.log(`stale proxy 127.0.0.1:${LISTEN} -> 127.0.0.1:${TARGET}, 前 ${FAIL_N} 个写请求掐断`));

process.on("SIGINT", () => { console.log(JSON.stringify(hits)); process.exit(0); });
