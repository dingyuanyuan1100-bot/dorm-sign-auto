import { useEffect, useRef, useState } from "react";

const ITEM = 44; // 每格高度，与 CSS .tw__item 一致
const pad = (n) => String(n).padStart(2, "0");

/** 晚寝签到只在 21:35–23:25 之间有效，滚轮也不许选到窗口外 */
export const SIGN_WINDOW = { from: "21:35", to: "23:25" };

const toMinutes = (v, fallback) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || "").trim());
  if (!m) return fallback;
  return Math.max(0, Math.min(1439, Number(m[1]) * 60 + Number(m[2])));
};

function Column({ items, value, onPick, colRef, label }) {
  return (
    <div className="tw__col" ref={colRef} onScroll={onPick} role="listbox" aria-label={label}>
      {/* 用空白占位撑出首尾留白：以前是容器 padding，
          配合 scroll-snap 在部分 WebView 上会把可滚范围夹到两三格 */}
      <i className="tw__spacer" aria-hidden />
      {items.map((v) => (
        <div className="tw__item" key={v} data-on={v === value} role="option" aria-selected={v === value}>
          {pad(v)}
        </div>
      ))}
      <i className="tw__spacer" aria-hidden />
    </div>
  );
}

export default function TimeWheel({ value, onChange, from = SIGN_WINDOW.from, to = SIGN_WINDOW.to }) {
  const lo = toMinutes(from, 0);
  const hi = toMinutes(to, 1439);
  const clampDay = (v) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : hi));

  // 小时列只保留窗口覆盖到的小时，分钟列再按当前小时切一次
  const hours = [];
  for (let h = 0; h < 24; h++) if (h * 60 <= hi && h * 60 + 59 >= lo) hours.push(h);

  const minsOf = (h) => {
    const out = [];
    for (let m = 0; m < 60; m++) {
      const t = h * 60 + m;
      if (t >= lo && t <= hi) out.push(m);
    }
    return out;
  };

  const [cur, setCur] = useState(() => clampDay(toMinutes(value, hi)));
  const selH = Math.floor(cur / 60);
  const selM = cur % 60;
  const mins = minsOf(selH);

  const hRef = useRef(null);
  const mRef = useRef(null);
  const timer = useRef(null);
  const lastValue = useRef(value);

  /** list 里离 v 最近的下标（窗口边界会把越界值夹回来） */
  const nearestIndex = (list, v) => {
    let best = 0;
    let bd = Infinity;
    list.forEach((x, i) => {
      const d = Math.abs(x - v);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };

  const alignCol = (el, index) => {
    if (!el) return;
    const target = index * ITEM;
    if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
  };

  // 外面传进来的时间变了（每次打开面板都会重置成默认值）→ 重新夹进窗口
  useEffect(() => {
    if (value === lastValue.current) return;
    lastValue.current = value;
    setCur(clampDay(toMinutes(value, hi)));
  }, [value]);

  // 换了小时，分钟列的可选值跟着变，把它滚到允许范围内最接近的位置
  useEffect(() => {
    alignCol(hRef.current, Math.max(0, hours.indexOf(selH)));
    alignCol(mRef.current, nearestIndex(mins, selM));
  }, [selH, mins.length]);

  const handleScroll = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const hEl = hRef.current;
      const mEl = mRef.current;
      const hIdx = Math.max(0, Math.min(hours.length - 1, Math.round((hEl?.scrollTop || 0) / ITEM)));
      const h = hours[hIdx];
      // 分钟列的 DOM 还停在上一个小时的可选值上，先按旧列表取值，再映射进新小时的集合
      const oldList = minsOf(selH);
      const oldIdx = Math.max(0, Math.min(oldList.length - 1, Math.round((mEl?.scrollTop || 0) / ITEM)));
      const nextList = minsOf(h);
      const m = nextList[nearestIndex(nextList, oldList[oldIdx])];

      const next = clampDay(h * 60 + m);
      const nh = Math.floor(next / 60);
      alignCol(hEl, Math.max(0, hours.indexOf(nh)));
      alignCol(mEl, nearestIndex(minsOf(nh), next % 60));
      setCur(next);

      const text = `${pad(nh)}:${pad(next % 60)}`;
      if (text !== value) onChange?.(text);
    }, 140);
  };

  return (
    <div className="tw" role="group" aria-label={`选择签到时间，${from} 至 ${to}`}>
      <div className="tw__band" aria-hidden />
      <Column items={hours} value={selH} onPick={handleScroll} colRef={hRef} label="小时" />
      <div className="tw__colon" aria-hidden>
        :
      </div>
      <Column items={mins} value={selM} onPick={handleScroll} colRef={mRef} label="分钟" />
      <i className="tw__fade tw__fade--top" aria-hidden />
      <i className="tw__fade tw__fade--bottom" aria-hidden />
    </div>
  );
}
