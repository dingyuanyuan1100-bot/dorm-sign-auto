import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state";
import { EmptyState } from "../ui/Chrome";
import { LogoMark, Plus14, StatusRing } from "../ui/Icons";
import { NoticeCard } from "../ui/Notice";
import { loadNotice, markSeen, seenId } from "../notice";
import { hhmm, parseTs } from "../format";
import pencilUrl from "../assets/pencil.webp";

const sameDay = (a, b) =>
  a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return "夜深了，";
  if (h < 11) return "早上好，";
  if (h < 14) return "中午好，";
  if (h < 18) return "下午好，";
  return "晚上好，";
}

/* 本月签到日历：设计稿 26:60 是 350×209 的渐变卡，10 列 20×20 的日格，
   已签亮绿打勾、漏签红、未到灰。日期与状态全部由 logs 推导，不做假数据。 */
function SignCalendar({ logs, onClick }) {
  const { month, cells, total } = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const okDays = new Set();
    logs.forEach((l) => {
      if (!l.success) return;
      const d = parseTs(l.run_at);
      if (d && d.getFullYear() === y && d.getMonth() === m) okDays.add(d.getDate());
    });
    const today = now.getDate();
    const list = [];
    for (let d = 1; d <= days; d++) {
      list.push({ d, ok: okDays.has(d), miss: d < today && !okDays.has(d) });
    }
    return { month: m + 1, cells: list, total: okDays.size };
  }, [logs]);

  // 30 天正好三行；31 天的月份要多一行，行距收一点，统计行跟着下移
  const rows = Math.ceil(cells.length / 10);
  const gapY = rows > 3 ? 5 : 6;
  const gridTop = rows > 3 ? 58 : 61;
  const statsTop = gridTop + rows * 20 + (rows - 1) * gapY + 13;

  return (
    <button className="signcal" type="button" onClick={onClick} aria-label={`${month} 月签到记录，累计签到 ${total} 次`}>
      <span className="t signcal__month">{month}月</span>

      <span className="signcal__grid" style={{ top: gridTop, gap: `${gapY}px 7px` }} aria-hidden="true">
        {cells.map((c) => (
          <i className="signcal__day" key={c.d} data-ok={c.ok} data-miss={c.miss}>
            {c.ok && (
              <svg width="13" height="9" viewBox="0 0 13 9" fill="none">
                <path d="M1.2 4.6 4.6 8 11.8 1" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {/* 设计稿 61:70「Vector 5」：漏签的红格上压一个墨色叉号，11.5×12.3、圆头 */}
            {c.miss && (
              <svg width="12" height="13" viewBox="0 0 12 13" fill="none">
                <path d="M1.2 1.4 10.8 11.6M10.8 1.4 1.2 11.6" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
          </i>
        ))}
      </span>

      <span className="signcal__stats" style={{ top: statsTop }}>
        <span className="signcal__statlabel">累计签到</span>
        <span className="signcal__statvalue">{total}</span>
        <span className="signcal__statunit">次</span>
      </span>

      <img className="signcal__art" src={pencilUrl} alt="" aria-hidden="true" draggable="false" />
    </button>
  );
}

export default function Home({ go }) {
  const { session, schedules, logs, defaultLocation, runSchedule, pushToast, boot } = useApp();
  const [busy, setBusy] = useState(false);
  const [burst, setBurst] = useState(null);
  const [notice, setNotice] = useState(null);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticeBodyH, setNoticeBodyH] = useState(0);
  // 启动页还盖着的时候拿到公告：直接当成终态画上去，不要高度/位移过渡，
  // 否则遮罩刚开始收就看见公告在长、页面在滑，跟 Logo 的起飞顺序对不上。
  const [noticeInstant, setNoticeInstant] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (boot !== "ready") return;
    let alive = true;
    loadNotice().then((n) => {
      if (!alive || !n) return;
      setNotice(n);
      // 公告常驻；只有第一次（未读）自动展开，之后默认收起
      const open = n.id !== seenId();
      setNoticeOpen(open);
      setNoticeInstant(!!document.getElementById("boot-splash"));
      // 启动时序探针：Logo 起飞前要等这一帧
      window.__noticeAt = Math.round(performance.now());
    });
    return () => {
      alive = false;
    };
  }, [boot]);

  // 遮罩还在就一直保持「终态无过渡」：字体晚到导致的文字回流也不要在起飞前/中滑动。
  // 启动页一被摘掉就恢复过渡，用户点开收起仍是弹簧。
  useEffect(() => {
    if (!noticeInstant) return undefined;
    let raf = 0;
    const tick = () => {
      if (!document.getElementById("boot-splash")) {
        setNoticeInstant(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [noticeInstant]);

  useEffect(() => {
    if (!notice || !noticeOpen) return undefined;
    const t = setTimeout(() => markSeen(notice.id), 700);
    return () => clearTimeout(t);
  }, [notice, noticeOpen]);

  const onNoticeMeasure = useCallback((h) => setNoticeBodyH(h), []);

  const toggleNotice = () => {
    if (noticeOpen && notice) markSeen(notice.id);
    if (noticeOpen) scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    setNoticeOpen(!noticeOpen);
  };

  const primary = schedules.find((s) => s.enabled) ?? schedules[0] ?? null;
  const enabled = schedules.filter((s) => s.enabled).length;
  const lastLog = logs[0] ?? null;

  const doneToday = useMemo(() => {
    if (!primary) return false;
    const now = new Date();
    return logs.some((l) => l.schedule_id === primary.id && l.success && sameDay(parseTs(l.run_at), now));
  }, [logs, primary]);

  const burstDots = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => {
        const angle = (Math.PI * 2 * i) / 8 - Math.PI / 2;
        return { id: i, dx: Math.cos(angle) * 64, dy: Math.sin(angle) * 48, delay: i * 16 };
      }),
    [],
  );

  const handleCheckIn = async () => {
    if (busy) return;
    if (!primary) {
      pushToast("还没有签到任务，先新建一个", "err");
      return;
    }
    setBusy(true);
    try {
      await runSchedule(primary.id);
      setBurst(Date.now());
      pushToast(`${primary.sign_time} 已触发签到，结果稍后见日志`);
      setTimeout(() => setBurst(null), 900);
    } catch (e) {
      pushToast(e.message || "签到失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const pillText = !primary ? "无任务" : !primary.enabled ? "已停用" : doneToday ? "已签到" : "待签到";
  const place = primary?.location?.name || (defaultLocation?.name ?? "尚未设置位置");

  const noticeOff = notice ? 56 + (noticeOpen ? noticeBodyH : 0) + 2 : 0;
  const rows = Math.min(schedules.length, 2);
  const bodyH = (rows ? 496 + (rows - 1) * 98 + 86 : 660) + 96;

  return (
    <>
      {notice && (
        <NoticeCard
          notice={notice}
          open={noticeOpen}
          onToggle={toggleNotice}
          onMeasure={onNoticeMeasure}
          instant={noticeInstant}
        />
      )}

      <h1 className="t dis home__hi">
        {greeting()}
        {session?.username || "同学"}
      </h1>
      <button className="home__avatar" onClick={() => go("me")} aria-label="进入我的">
        <LogoMark w={26} h={31} />
      </button>

      <div className="home__scroll" ref={scrollRef}>
      <div
        className="home__body"
        data-instant={noticeInstant ? "" : undefined}
        style={{ "--notice-off": `${noticeOff}px`, height: `${bodyH}px` }}
      >

      <div className="hero">
        <span className="t cn hero__label">今晚签到</span>
        <span className="t num hero__time">{primary ? primary.sign_time : "--:--"}</span>
        <div className="hero__pill" data-off={!primary?.enabled}>
          <span className="t cn c">{pillText}</span>
        </div>
        <span className="t cn hero__place">{place}</span>
        <button className="hero__cta" onClick={handleCheckIn} data-busy={busy}>
          {busy ? <span className="spinner" /> : "立即签到"}
        </button>

        {burst && (
          <div className="burst" key={burst}>
            {burstDots.map((d) => (
              <span
                key={d.id}
                style={{
                  left: 250,
                  top: 145,
                  animationDelay: `${d.delay}ms`,
                  ["--dx"]: `${d.dx}px`,
                  ["--dy"]: `${d.dy}px`,
                }}
              />
            ))}
          </div>
        )}
      </div>

      <button className="stat stat--a" onClick={() => go("tasks")}>
        <span className="stat__label">启用任务</span>
        <span className="stat__value">
          {enabled} <span style={{ color: "var(--ink)" }}>/</span> {schedules.length}
        </span>
      </button>

      <button className="stat stat--b" onClick={() => go("logs")}>
        <span className="stat__label">最近执行</span>
        <span className="stat__value">{lastLog ? hhmm(lastLog.run_at) : "—"}</span>
        <span className="stat__check" data-fail={!!lastLog && !lastLog.success} data-empty={!lastLog}>
          <StatusRing fail={!!lastLog && !lastLog.success} />
        </span>
      </button>

      <div className="section-head">
        <h2 className="t dis section-title">签到记录</h2>
        <button className="section-link" onClick={() => go("logs")}>
          全部 ›
        </button>
      </div>

      {schedules.length === 0 ? (
        <EmptyState
          icon={<Plus14 />}
          title="还没有签到任务"
          desc="新建任务后，这里会显示本月的签到记录"
          action="去新建"
          onAction={() => go("tasks")}
        />
      ) : (
        <SignCalendar logs={logs} onClick={() => go("logs")} />
      )}
      </div>
      </div>
    </>
  );
}
