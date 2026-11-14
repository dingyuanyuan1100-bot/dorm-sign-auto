import { useCallback, useEffect, useRef, useState } from "react";




export function usePullRefresh(scrollRef, onRefresh, enabled = true) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | pull | ready | loading
  const busy = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !enabled) return;

    let dragging = false;
    let y0 = 0;
    let dist = 0;

    const point = (e) => (e.touches ? e.touches[0]?.clientY ?? 0 : e.clientY);

    const down = (e) => {
      if (busy.current || el.scrollTop > 0) return;
      dragging = true;
      y0 = point(e);
      dist = 0;
    };

    const move = (e) => {
      if (!dragging) return;
      const d = point(e) - y0;
      if (d <= 0) {
        if (dist > 0) {
          dist = 0;
          setPull(0);
          setPhase("idle");
        }
        return;
      }

      const eased = Math.min(104, Math.pow(d, 0.86) * 1.15);
      dist = eased;
      setPull(eased);
      setPhase(eased >= 62 ? "ready" : "pull");
      if (eased > 12 && e.cancelable) e.preventDefault();
    };

    const up = async () => {
      if (!dragging) return;
      dragging = false;
      if (dist >= 62 && !busy.current) {
        busy.current = true;
        setPhase("loading");
        setPull(62);
        setRefreshing(true);
        try {
          await onRefresh?.();
        } finally {
          setRefreshing(false);
          busy.current = false;
          setPhase("idle");
          setPull(0);
        }
      } else {
        setPhase("idle");
        setPull(0);
      }
      dist = 0;
    };

    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", up);
    el.addEventListener("touchcancel", up);
    el.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);

    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", up);
      el.removeEventListener("touchcancel", up);
      el.removeEventListener("mousedown", down);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [scrollRef, onRefresh, enabled]);

  return { pull, phase, refreshing };
}

export function PullHint({ pull, phase }) {
  const visible = pull > 2;
  const h = pull;
  return (
    <div
      className="pull"
      data-phase={phase}
      style={{
        height: h,
        opacity: visible ? Math.min(1, pull / 34) : 0,
      }}
      aria-hidden={!visible}
    >
      <div className="pull__ring" style={{ transform: `rotate(${pull * 3.4}deg)` }}>
        <svg viewBox="0 0 24 24" width="18" height="18">
          <circle cx="12" cy="12" r="9" fill="none" stroke="#DCDCE2" strokeWidth="2.4" />
          <circle
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke="#BEF22F"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeDasharray={`${Math.min(56, pull * 0.92)} 56`}
          />
        </svg>
      </div>
      <span className="pull__text">
        {phase === "loading" ? "刷新中…" : phase === "ready" ? "松开刷新" : "下拉刷新"}
      </span>
    </div>
  );
}


export function useSwipeX(limit = 76, onOpenChange) {
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const st = useRef({ active: false, x0: 0, y0: 0, base: 0, lock: null });

  const bind = {
    onTouchStart: (e) => {
      const t = e.touches[0];
      st.current = { active: true, x0: t.clientX, y0: t.clientY, base: open ? -limit : 0, lock: null };
    },
    onTouchMove: (e) => {
      const s = st.current;
      if (!s.active) return;
      const t = e.touches[0];
      const mx = t.clientX - s.x0;
      const my = t.clientY - s.y0;
      if (s.lock === null) {
        if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
        s.lock = Math.abs(mx) > Math.abs(my) ? "x" : "y";
      }
      if (s.lock !== "x") return;
      const v = Math.max(-limit - 16, Math.min(0, s.base + mx));
      setDx(v);
    },
    onTouchEnd: () => {
      const s = st.current;
      if (!s.active) return;
      s.active = false;
      if (s.lock !== "x") return;
      const next = dx < -limit * 0.55;
      setOpen(next);
      setDx(next ? -limit : 0);
      onOpenChange?.(next);
    },
  };

  const reset = useCallback(() => {
    setOpen(false);
    setDx(0);
  }, []);

  return { dx, open, bind, reset, setDx };
}


export function useSkeleton(ms = 380) {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return loading;
}

export function SkeletonRows({ rows = 4, className = "" }) {
  return (
    <div className={`sk ${className}`} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div className="sk__row" key={i} style={{ animationDelay: `${i * 60}ms` }}>
          <i className="sk__dot" />
          <div className="sk__lines">
            <i className="sk__line" style={{ width: `${58 + ((i * 17) % 30)}%` }} />
            <i className="sk__line sk__line--sm" style={{ width: `${34 + ((i * 11) % 22)}%` }} />
          </div>
          <i className="sk__pill" />
        </div>
      ))}
    </div>
  );
}


export function useRipple() {
  useEffect(() => {
    const onDown = (e) => {
      const el = e.target.closest?.("button, .rippleable");
      if (!el || el.disabled) return;
      const r = el.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 1.15;
      const span = document.createElement("i");
      span.className = "ripple";
      span.style.width = span.style.height = `${size}px`;
      span.style.left = `${e.clientX - r.left - size / 2}px`;
      span.style.top = `${e.clientY - r.top - size / 2}px`;
      if (getComputedStyle(el).position === "static") el.style.position = "relative";
      el.classList.add("has-ripple");
      el.appendChild(span);
      setTimeout(() => span.remove(), 560);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
}


export function useScrolledAt(ref, threshold = 6) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > threshold);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [ref, threshold]);
  return scrolled;
}
