import { useCallback, useLayoutEffect, useRef, useState } from "react";

export function NoticeCard({ notice, open, onToggle, onMeasure, instant = false }) {
  const innerRef = useRef(null);
  const [h, setH] = useState(0);

  const measure = useCallback((v) => {
    setH(v);
    onMeasure(v);
  }, [onMeasure]);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measure(el.offsetHeight));
    ro.observe(el);
    measure(el.offsetHeight);
    return () => ro.disconnect();
  }, [measure, notice.id]);

  return (
    <div className="notice" data-open={open} data-instant={instant ? "" : undefined}>
      <button className="notice__head" onClick={onToggle} aria-expanded={open} aria-label={`公告：${notice.title}`}>
        <span className="notice__mark" aria-hidden>
          <i />
        </span>
        <span className="notice__tag">公告</span>
        <span className="notice__title">{notice.title}</span>
        <span className="notice__chev" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M3.4 5.4L7 9L10.6 5.4"
              stroke="#8A8A93"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      <div className="notice__body" style={{ height: open ? h : 0 }} aria-hidden={!open}>
        <div className="notice__inner" ref={innerRef}>
          {notice.date && <p className="notice__date">{notice.date}</p>}
          <ul className="notice__list">
            {notice.items.map((t, i) => (
              <li key={i} style={{ "--i": i }}>
                <i aria-hidden />
                <span>{t}</span>
              </li>
            ))}
          </ul>
          {(notice.note || notice.tip) && (
            <div className="notice__note" style={{ "--i": notice.items.length }}>
              {notice.note && <p>{notice.note}</p>}
              {notice.tip && (
                <p className="notice__tip">
                  <i aria-hidden />
                  <span>{notice.tip}</span>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
