import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);


if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("probe")) {
  const SEL = [
    ".statusbar__time",
    ".statusbar__icons",
    ".page-title",
    ".head-btn",
    ".home__hi",
    ".home__avatar",
    ".hero",
    ".hero__label",
    ".hero__time",
    ".hero__pill",
    ".hero__place",
    ".hero__cta",
    ".stat",
    ".stat__label",
    ".stat__value",
    ".stat__check",
    ".section-head",
    ".section-title",
    ".section-link",
    ".taskrow",
    ".taskrow__time",
    ".taskrow__chip",
    ".taskrow__place",
    ".taskrow__status",
    ".seg",
    ".seg__pill",
    ".taskcard",
    ".taskcard__switch",
    ".taskcard__btn",
    ".addrow",
    ".map",
    ".map__pulse",
    ".map__pin",
    ".map__info",
    ".loc",
    ".loc__badge",
    ".group-label",
    ".logrow",
    ".logrow__ring",
    ".account",
    ".listcard",
    ".logout",
    ".nav",
    ".nav__icon",
    ".login__logo",
    ".login__title",
    ".login__card",
    ".login__submit",
    ".home-indicator",
  ];
  const dump = () => {
    const lines = SEL.map((s) => {
      const el = document.querySelector(s);
      if (!el) return `${s}: none`;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return `${s}: x=${r.x.toFixed(1)} y=${r.y.toFixed(1)} w=${r.width.toFixed(1)} h=${r.height.toFixed(1)} fs=${cs.fontSize} fw=${cs.fontWeight} lh=${cs.lineHeight}`;
    });
    const box = document.createElement("pre");
    box.id = "probe";
    box.textContent =
      lines.join("\n") +
      `\nwin=${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`;
    document.body.appendChild(box);
  };
  setTimeout(dump, 1200);
}
