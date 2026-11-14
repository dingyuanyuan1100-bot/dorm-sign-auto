import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavClock, NavGrid, NavPerson, StatusIcons } from "./Icons";
import { useBackClose } from "./back";

export function StatusBar({ time = "9:41", hidden = false }) {
  if (hidden) return <div className="statusbar" aria-hidden="true" />;
  return (
    <div className="statusbar">
      <div className="statusbar__time num">{time}</div>
      <div className="statusbar__icons">
        <StatusIcons />
      </div>
    </div>
  );
}

export function HomeIndicator() {
  return <div className="home-indicator" />;
}

const NAV = [
  { key: "home", x: 8, ix: 23, iy: 15, Icon: NavGrid, label: "总览" },
  { key: "tasks", x: 101, ix: 23, iy: 14, Icon: NavClock, label: "任务" },
  { key: "me", x: 188, ix: 26, iy: 14, Icon: NavPerson, label: "我的" },
];

export function BottomNav({ active, onChange }) {
  return (
    <nav className="nav" aria-label="主导航">
      {NAV.map(({ key, x, ix, iy, Icon, label }) => (
        <button
          key={key}
          className="nav__item"
          style={{ left: x }}
          data-active={active === key}
          onClick={() => onChange?.(key)}
          aria-label={label}
          aria-current={active === key ? "page" : undefined}
        >
          <span className="nav__icon" style={{ left: ix, top: iy }}>
            <Icon active={active === key} />
          </span>
        </button>
      ))}
    </nav>
  );
}

export function Sheet({ title, desc, onClose, children }) {
  const [dy, setDy] = useState(0);

  useBackClose(true, onClose);
  const drag = useRef({ on: false, y0: 0 });

  const [host] = useState(() =>
    typeof document === "undefined" ? null : document.getElementById("overlay-root"),
  );

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const start = (e) => {
    drag.current = { on: true, y0: e.touches ? e.touches[0].clientY : e.clientY };
  };
  const move = (e) => {
    if (!drag.current.on) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    setDy(Math.max(0, y - drag.current.y0));
  };
  const end = () => {
    if (!drag.current.on) return;
    drag.current.on = false;
    if (dy > 96) onClose?.();
    else setDy(0);
  };

  const ui = (
    <>
      <div className="scrim" onClick={onClose} style={{ opacity: Math.max(0, 1 - dy / 260) }} />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-dragging={dy > 0}
        style={dy ? { transform: `translateY(${dy}px)`, transition: drag.current.on ? "none" : undefined } : undefined}
      >
        <div
          className="sheet__handle"
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={end}
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={end}
          onMouseLeave={end}
        >
          <div className="sheet__grab" />
        </div>
        {(title || desc) && (
          <div className="sheet__head">
            {title && <div className="sheet__title">{title}</div>}
            {desc && <div className="sheet__desc">{desc}</div>}
          </div>
        )}
        {children}
      </div>
    </>
  );

  return host ? createPortal(ui, host) : ui;
}

export function Toast({ toast, onAction }) {
  if (!toast) return null;
  return (
    <div className="toast" data-tone={toast.tone} key={toast.key} role="status">
      <i className="toast__dot" />
      <span className="toast__text">{toast.text}</span>
      {toast.action && (
        <button className="toast__action" onClick={() => onAction?.(toast)}>
          {toast.action}
        </button>
      )}
    </div>
  );
}

export function ScreenScroll({ height = 844, children }) {
  return (
    <div className="screenscroll">
      <div className="screenscroll__body" style={{ height }}>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, desc, action, onAction, top = 496 }) {
  return (
    <div className="empty" style={{ top }}>
      {icon && <div className="empty__icon">{icon}</div>}
      <div className="empty__title">{title}</div>
      {desc && <div className="empty__desc">{desc}</div>}
      {action && (
        <button className="empty__btn" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

export function Skeleton({ rows = 3, top = 392, height = 94, gap = 12, radius = 22 }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="skel"
          style={{ top: top + i * (height + gap), height, borderRadius: radius }}
        />
      ))}
    </>
  );
}
