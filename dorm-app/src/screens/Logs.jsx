import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state";
import { Sheet, Skeleton, EmptyState } from "../ui/Chrome";
import { Filter, StatusRing } from "../ui/Icons";
import { dayLabel, hhmm, parseTs, triggerLabel } from "../format";

// 列表滚动区从 228 起（标题与统计卡固定在版面，不随列表滚动）
const SCROLL_TOP = 228;
const VIEW_H = 844 - SCROLL_TOP;
// 滚动内容内的坐标：与设计稿 240 / 264 对齐
const FIRST_LABEL_Y = 240 - SCROLL_TOP;
const ROW_H = 76;
const ROW_STEP = 86;
const LABEL_H = 16;
const GAP_AFTER_GROUP = 18;
// 列表底部留白，保证最后一条能滚到导航条上方
const BOTTOM_PAD = 112;

const FILTERS = ["全部", "成功", "失败"];

export default function Logs({ go }) {
  const { logs, schedules, stats, boot, refresh, pushToast } = useApp();
  const [filter, setFilter] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const [detail, setDetail] = useState(null);

  const scheduleById = useMemo(() => {
    const m = new Map();
    schedules.forEach((s) => m.set(s.id, s));
    return m;
  }, [schedules]);

  const rows = useMemo(() => {
    const filtered = logs.filter((l) => (filter === 0 ? true : filter === 1 ? l.success : !l.success));
    const groups = new Map();
    filtered.forEach((l) => {
      const key = dayLabel(l.run_at);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(l);
    });
    let y = FIRST_LABEL_Y;
    return [...groups.entries()].map(([name, items]) => {
      const labelY = y;
      const firstY = labelY + LABEL_H + 8;
      y = firstY + (items.length - 1) * ROW_STEP + ROW_H + GAP_AFTER_GROUP;
      return { name, items, labelY, firstY };
    });
  }, [logs, filter]);

  const placeOf = (l) => scheduleById.get(l.schedule_id)?.location?.name || "任务位置未知";


  const contentH = useMemo(() => {
    if (!rows.length) return VIEW_H;
    const last = rows[rows.length - 1];
    const bottom = last.firstY + (last.items.length - 1) * ROW_STEP + ROW_H;
    return Math.max(VIEW_H, bottom + BOTTOM_PAD);
  }, [rows]);

  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [filter]);

  return (
    <>
      <h1 className="t dis page-title">执行日志</h1>
      <button className="head-btn" onClick={() => setFilterOpen(true)} aria-label="筛选日志">
        <Filter />
      </button>

      <div className="stat stat--log stat--ok" role="group" aria-label="成功次数">
        <i className="stat__dot" />
        <span className="stat__label">成功</span>
        <span className="stat__value">{stats.ok}</span>
      </div>
      <div className="stat stat--log stat--fail" role="group" aria-label="失败次数">
        <i className="stat__dot" />
        <span className="stat__label">失败</span>
        <span className="stat__value">{stats.fail}</span>
      </div>

      <div className="logs__scroll" ref={scrollRef}>
        <div className="logs__body" style={{ height: contentH }}>
          {boot !== "ready" && (
            <Skeleton rows={3} top={FIRST_LABEL_Y + LABEL_H + 8} height={ROW_H} gap={10} radius={20} />
          )}

          {boot === "ready" && rows.length === 0 && (
            <EmptyState
              top={FIRST_LABEL_Y}
              title={filter === 0 ? "还没有执行记录" : `没有${FILTERS[filter]}记录`}
              desc="签到任务执行后会在这里留下日志"
              action="刷新"
              onAction={() => refresh("logs")}
            />
          )}

          {rows.map((g) => (
            <div key={g.name}>
              <div className="group-label" style={{ top: g.labelY }}>
                {g.name}
              </div>
              {g.items.map((l, i) => (
                <button
                  key={l.id}
                  className="logrow"
                  style={{ top: g.firstY + i * ROW_STEP }}
                  data-fail={!l.success}
                  aria-label={`${hhmm(l.run_at)} ${placeOf(l)} ${l.success ? "成功" : "失败"}`}
                  onClick={() => setDetail(l)}
                >
                  <i className="logrow__dot" />
                  <span className="t cn logrow__main">
                    {hhmm(l.run_at)} · {placeOf(l)}
                  </span>
                  <span className="t cn logrow__sub">
                    {triggerLabel(l.detail)} · {l.msg || "—"}
                  </span>
                  <span className="logrow__ring">
                    <StatusRing fail={!l.success} />
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="logs__fade" aria-hidden />

      {filterOpen && (
        <Sheet title="筛选日志" desc="按执行结果过滤" onClose={() => setFilterOpen(false)}>
          {FILTERS.map((f, i) => (
            <div
              key={f}
              className="sheet__row"
              data-active={filter === i}
              onClick={() => {
                setFilter(i);
                setFilterOpen(false);
              }}
            >
              {f}
              <small>{i === 0 ? `${logs.length} 条` : `${i === 1 ? stats.ok : stats.fail} 条`}</small>
            </div>
          ))}
        </Sheet>
      )}

      {detail && (
        <Sheet
          title={detail.success ? "签到成功" : "签到失败"}
          desc={`${dayLabel(detail.run_at)} ${hhmm(detail.run_at)}`}
          onClose={() => setDetail(null)}
        >
          <div className="detail">
            <div className="detail__row">
              <span>位置</span>
              <b>{placeOf(detail)}</b>
            </div>
            <div className="detail__row">
              <span>触发方式</span>
              <b>{triggerLabel(detail.detail)}</b>
            </div>
            <div className="detail__row">
              <span>结果</span>
              <b data-fail={!detail.success}>{detail.success ? "成功" : "失败"}</b>
            </div>
            <div className="detail__msg">{detail.msg || "上游未返回说明"}</div>
          </div>
          <div className="sheet__actions">
            <button className="sheet__btn" onClick={() => setDetail(null)}>
              关闭
            </button>
            <button
              className="sheet__btn sheet__btn--primary"
              onClick={async () => {
                await refresh("logs");
                pushToast("已刷新");
                setDetail(null);
              }}
            >
              刷新
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
