import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import { AppProvider, useApp } from "./state";
import { BottomNav, HomeIndicator, StatusBar, Toast } from "./ui/Chrome";
import { DormBindPrompt } from "./ui/DormBind";
import { UpdateSheet } from "./ui/UpdateSheet";
import { LoginBlob } from "./ui/Icons";
import { useRipple } from "./ui/Motion";
import { runBackHandler } from "./ui/back";
import Login from "./screens/Login";
import Home from "./screens/Home";
import Tasks from "./screens/Tasks";
import Locations from "./screens/Locations";
import Logs from "./screens/Logs";
import Me from "./screens/Me";
import Feedback from "./screens/Feedback";
import "./styles.css";

const W = 390;
const H = 844;
const ROUTES = ["home", "tasks", "locations", "logs", "me"];

const readHashRoute = () => {
  if (typeof window === "undefined") return "home";
  const h = window.location.hash.replace("#", "").trim();
  return ROUTES.includes(h) ? h : "home";
};

const isFlat = () =>
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("flat");

const isMobileWeb = () => {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPod|Mobile|HarmonyOS|MicroMessenger|MiuiBrowser/i.test(ua)) return true;

  return (navigator.maxTouchPoints || 0) > 1 && Math.min(window.innerWidth, window.innerHeight) <= 900;
};

const isNative = () =>
  typeof window !== "undefined" &&
  ((!!window.Capacitor &&
    (window.Capacitor.isNativePlatform ? window.Capacitor.isNativePlatform() : true)) ||
    new URLSearchParams(window.location.search).has("native") ||
    isMobileWeb());

function useStageMetrics(flat, native) {
  const calc = () => {
    if (typeof window === "undefined") return { s: 1, h: H, x: 0 };
    const vw = window.innerWidth || W;
    const vh = window.innerHeight || H;
    if (flat) return { s: 1, h: H, x: 0 };
    const pad = native ? 0 : 24;
    const cap = native ? 1.35 : 1;
    const s = Math.max(0.42, Math.min(cap, (vw - pad) / W, (vh - pad) / H));

    const h = Math.max(H, vh / s);

    const x = native ? Math.max(0, (vw - W * s) / 2) : 0;
    return { s, h, x };
  };

  const [m, setM] = useState(calc);
  useEffect(() => {
    let frozen = false;
    const isField = (el) => !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || "");
    const update = () => {
      if (frozen || isField(document.activeElement)) return;
      setM(calc());
    };
    const onFocusIn = (e) => {
      if (isField(e.target)) frozen = true;
    };
    const onFocusOut = () => {
      frozen = false;

      setTimeout(update, 280);
    };
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [flat, native]);
  return m;
}

const SPLASH_MIN_MS = 1150;

const EASE_EMPHASIZED = "cubic-bezier(0.2, 0, 0, 1)";

const SPLASH_FLY_MS = 500;

const INTRO_LEAD_MS = 70;

// 冷启动时首页内容在启动页遮罩后面就先跑完入场，Logo 起飞时页面已经静止。
// 300ms 动画 + 6 段 48ms 错峰 = 588ms，取 620ms 留一点余量。
const INTRO_SETTLE_MS = 620;
// 公告落位最多等这么久，超时就不再等（弱网时也不能把启动页拖住）
const NOTICE_WAIT_CAP = 420;

const SWAP_OUT_MS = 100;
const SWAP_SHRINK_MS = SPLASH_FLY_MS - SWAP_OUT_MS;

const INTRO_TOTAL_MS = 1000;

function effOpacity(el, fromParent) {
  let a = 1;
  for (let n = fromParent ? el && el.parentElement : el; n && n.nodeType === 1; n = n.parentElement) {
    const o = parseFloat(getComputedStyle(n).opacity);
    if (Number.isFinite(o)) a *= o;
    if (a < 0.995) return a;
  }
  return a;
}

function textBox(el) {
  if (!el) return null;
  const inner = el.firstElementChild;
  if (inner && inner.tagName === "SPAN") {
    const b = inner.getBoundingClientRect();
    if (b.width > 0) return b;
  }
  try {
    const r = document.createRange();
    r.selectNodeContents(el);
    const b = r.getBoundingClientRect();
    if (b && b.width > 0 && b.height > 0) return b;
  } catch (e) {

  }
  return el.getBoundingClientRect();
}

function splashTarget(boot) {
  if (boot === "ready") return '.pane[data-active="true"] .home__avatar svg';
  if (boot === "anon") return ".login__logo svg";
  return null;
}

function splashTextTarget(boot) {
  return boot === "anon" ? ".login__title" : null;
}

const SWAP_FLY_MS = 500;

function flyLoginLogo(stage, ms, delay) {
  const src = stage.querySelector(".login__logo svg");
  const dst = stage.querySelector('.pane[data-active="true"] .home__avatar svg');
  if (!src || !dst) return null;

  const reduce =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return null;

  const a = src.getBoundingClientRect();
  const b = dst.getBoundingClientRect();
  if (!a.width || !a.height || !b.width || !b.height) return null;

  const fly = document.createElement("div");
  fly.id = "swap-fly";
  fly.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:9000;pointer-events:none";

  const ghost = src.cloneNode(true);
  ghost.setAttribute("aria-hidden", "true");
  ghost.style.cssText = [
    "position:fixed",
    `left:${a.left}px`,
    `top:${a.top}px`,
    `width:${a.width}px`,
    `height:${a.height}px`,
    "transform-origin:0 0",
    "pointer-events:none",
    "will-change:transform",
  ].join(";");
  fly.appendChild(ghost);
  document.body.appendChild(fly);

  src.style.visibility = "hidden";
  dst.style.visibility = "hidden";

  ghost.style.transition = "none";
  void ghost.getBoundingClientRect();
  ghost.style.transition = `transform ${ms}ms ${EASE_EMPHASIZED} ${delay}ms`;

  ghost.style.transform = `translate(${b.left - a.left}px, ${
    b.top - a.top
  }px) scale(${b.width / a.width}, ${b.height / a.height})`;

  return () => {
    dst.style.removeProperty("visibility");
    src.style.removeProperty("visibility");
    fly.remove();
  };
}

function shrinkPlate(plate, chip, ms, delay, fromRadius) {
  if (!plate || !chip) return null;

  const reduce =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduce) return null;

  plate.style.transformOrigin = "0 0";
  plate.style.willChange = "transform, border-radius";
  plate.style.transition = "none";
  plate.style.removeProperty("transform");
  plate.style.removeProperty("border-radius");
  void plate.getBoundingClientRect();

  if (fromRadius) plate.style.borderRadius = `${fromRadius}px`;

  const a = plate.getBoundingClientRect();
  const b = chip.getBoundingClientRect();
  const w = plate.offsetWidth;
  const h = plate.offsetHeight;

  const host = plate.closest(".stage");
  const k = host && host.offsetWidth ? host.getBoundingClientRect().width / host.offsetWidth : 1;
  if (!w || !h || !a.width || !a.height || !b.width || !b.height) return null;

  const sx = b.width / (w * k);
  const sy = b.height / (h * k);

  const r = parseFloat(getComputedStyle(chip).borderTopLeftRadius) || 0;
  const rx = r / sx;
  const ry = r / sy;

  const wait = Math.max(0, delay || 0);
  plate.style.transition =
    `transform ${ms}ms ${EASE_EMPHASIZED} ${wait}ms, ` +
    `border-radius ${ms}ms ${EASE_EMPHASIZED} ${wait}ms`;
  plate.style.transform = `translate(${(b.left - a.left) / k}px, ${
    (b.top - a.top) / k
  }px) scale(${sx}, ${sy})`;
  plate.style.borderRadius = `${rx}px / ${ry}px`;

  return { sx, sy, rx, ry, target: b, ms, delay: wait };
}

function shrinkLoginBg(stage, ms, delay) {
  const plate = stage.querySelector(".login-layer");
  const chip = stage.querySelector('.pane[data-active="true"] .home__avatar');
  if (!plate) return null;

  const stop = () => {

    window.__plateLand = plate.getBoundingClientRect();
    window.__plateRadius = getComputedStyle(plate).borderTopLeftRadius;
    window.__plateScale = getComputedStyle(plate).transform;
    plate.style.transition = "none";
    plate.style.opacity = "0";
    plate.style.transform = "none";
    plate.style.borderRadius = "0";

    void plate.getBoundingClientRect();
    delete stage.dataset.swap;

    setTimeout(() => {
      plate.removeAttribute("style");
    }, 260);
  };

  const bleed = document.querySelector(".loginbleed");
  if (bleed) {
    bleed.style.transition = `opacity ${ms}ms ${EASE_EMPHASIZED}`;
    bleed.style.opacity = "0";
  }

  plate.style.overflow = "hidden";
  const inner = plate.querySelector(".login");
  const r0 = inner ? parseFloat(getComputedStyle(inner).borderTopLeftRadius) || 0 : 0;
  const t = shrinkPlate(plate, chip, ms, delay, r0);
  return { shrinks: !!t, stop, endAt: ms + Math.max(0, delay || 0) };
}

let introTimer = 0;
// 冷启动时提前跑完入场的起点；0 表示还没跑过
let introPrimedAt = 0;

function stageIntro() {
  const stage = document.querySelector(".stage");
  if (!stage) return null;

  clearTimeout(introTimer);

  if (stage.dataset.intro === "run") {
    stage.dataset.intro = "";
    void stage.offsetWidth;
  }
  stage.dataset.intro = "pending";
  window.__tPend = Math.round(performance.now()); // 自动化探针
  return stage;
}

/**
 * 在启动页还盖着屏幕的时候就把首页入场跑掉。
 * 必须等首页 DOM 真正挂上再跑，否则动画跑完了元素才出现，会一直停在 opacity:0。
 * 返回开始时间，0 表示还没条件跑。
 */
function primeHomeIntro() {
  if (introPrimedAt) return introPrimedAt;
  const stage = document.querySelector(".stage");
  if (!stage) return 0;
  const target =
    stage.querySelector('.pane[data-active="true"] .hero') || stage.querySelector(".login__card");
  if (!target) return 0;
  stageIntro();
  runIntro(stage);
  introPrimedAt = performance.now();
  window.__tPrime = Math.round(introPrimedAt); // 自动化探针
  return introPrimedAt;
}

function runIntro(stage) {
  if (!stage || stage.dataset.intro !== "pending") return;
  stage.dataset.intro = "run";
  window.__tRun = Math.round(performance.now()); // 自动化探针
  clearTimeout(introTimer);
  introTimer = setTimeout(() => {
    delete stage.dataset.intro;
  }, INTRO_TOTAL_MS);
}

function dismissSplash(boot) {
  const el = document.getElementById("boot-splash");
  const fly = document.getElementById("bs-fly");
  if (!el || el.dataset.leaving) return;
  el.dataset.leaving = "1";

  // 已经提前跑过入场就不再重放（init 为 null 时 runIntro 直接返回）
  const intro = introPrimedAt ? null : stageIntro();

  const logo = document.getElementById("bs-logo");
  const word = document.querySelector("#bs-fly .bs-word");
  const node = boot ? document.querySelector(splashTarget(boot)) : null;
  const title = boot ? document.querySelector(splashTextTarget(boot)) : null;
  const from = logo ? logo.getBoundingClientRect() : null;
  const to = node ? node.getBoundingClientRect() : null;

  const reduce =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!from || !to || !to.width || !from.width || reduce) {
    el.style.transition = `opacity ${SPLASH_FLY_MS}ms ${EASE_EMPHASIZED}`;
    if (fly) fly.style.transition = `opacity ${SPLASH_FLY_MS}ms ${EASE_EMPHASIZED}`;
    el.style.opacity = "0";
    if (fly) fly.style.opacity = "0";
    runIntro(intro); // 没有落点也要把内容放出来，不能一直藏着
    setTimeout(() => {
      delete document.documentElement.dataset.handoff;
      el.remove();
      if (fly) fly.remove();
    }, SPLASH_FLY_MS + 80);
    return;
  }

  node.style.opacity = "0";
  if (title) title.style.opacity = "0";

  const chip =
    boot === "ready" ? document.querySelector('.pane[data-active="true"] .home__avatar') : null;
  const plate = chip ? shrinkPlate(el.querySelector(".bs-veil"), chip, SPLASH_FLY_MS) : null;
  if (plate) {
    chip.style.transition = "none";
    chip.style.opacity = "0";
  }

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const scale = to.width / from.width;

  logo.style.animation = "none";
  logo.style.transformOrigin = "50% 50%";
  logo.style.transition = `transform ${SPLASH_FLY_MS}ms ${EASE_EMPHASIZED}`;

  const wbox = textBox(word);
  let wordTarget = null;
  let wantLs = null;
  let padL = 0;
  if (word && wbox) {
    word.style.animation = "none";
    word.style.transformOrigin = "50% 50%";
    wordTarget = title ? textBox(title) : null;
    if (wordTarget) {

      const wb = word.getBoundingClientRect();
      padL = parseFloat(getComputedStyle(word).paddingLeft) || 0;
      const curLs = parseFloat(getComputedStyle(word).letterSpacing) || 0;
      const n = (word.textContent || "").trim().length || 1;
      const contentW = wb.width - padL - n * curLs;
      wantLs = (wordTarget.width - contentW) / n;
      if (!Number.isFinite(wantLs)) wantLs = 0;
      wantLs = Math.max(-2, Math.min(14, wantLs));

      word.style.transition = [
        `transform ${SPLASH_FLY_MS}ms ${EASE_EMPHASIZED}`,
        `letter-spacing ${SPLASH_FLY_MS}ms ${EASE_EMPHASIZED}`,
        `padding-left ${SPLASH_FLY_MS}ms ${EASE_EMPHASIZED}`,
      ].join(", ");
    } else {

      word.style.transition = [
        `transform ${SPLASH_FLY_MS}ms ${EASE_EMPHASIZED}`,
        `opacity ${Math.round(SPLASH_FLY_MS * 0.5)}ms ${EASE_EMPHASIZED} ${Math.round(
          SPLASH_FLY_MS * 0.45,
        )}ms`,
      ].join(", ");
      word.style.opacity = "0";
    }
  }

  if (!plate) el.classList.add("bs-out");
  if (fly) fly.classList.add("bs-out");

  let introAt = 0;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      logo.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;

      introAt = setTimeout(() => runIntro(intro), Math.max(0, SPLASH_FLY_MS - INTRO_LEAD_MS));

      if (word && wbox) {
        if (wordTarget) {

          const padBack = padL / 2;
          word.style.transform = `translate(${
            wordTarget.left + wordTarget.width / 2 - (wbox.left + wbox.width / 2) + padBack
          }px, ${
            wordTarget.top + wordTarget.height / 2 - (wbox.top + wbox.height / 2)
          }px)`;
          word.style.letterSpacing = `${wantLs}px`;
          word.style.paddingLeft = "0px";
        } else {

          word.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
        }
      }
    });
  });

  let landed = false;
  const land = () => {
    if (landed) return;
    landed = true;

    window.__splashLand = logo.getBoundingClientRect();
    window.__tLand = Math.round(performance.now());
    window.__wordLand = word ? textBox(word) : null;
    const veil = el.querySelector(".bs-veil");
    window.__veilAtLand = veil ? +(parseFloat(getComputedStyle(veil).opacity) || 0).toFixed(3) : null;

    node.style.removeProperty("opacity");
    node.style.removeProperty("transition");
    if (title) {
      title.style.removeProperty("opacity");
      title.style.removeProperty("transition");
    }
    logo.style.visibility = "hidden";
    if (word) word.style.visibility = "hidden";

    if (plate) {

      const veilEl = el.querySelector(".bs-veil");
      window.__plateLand = veilEl ? veilEl.getBoundingClientRect() : null;
      window.__plateRadius = veilEl ? getComputedStyle(veilEl).borderTopLeftRadius : null;
      window.__plateScale = veilEl ? getComputedStyle(veilEl).transform : null;
      chip.style.removeProperty("transition");
      chip.style.removeProperty("opacity");
    }

    delete document.documentElement.dataset.handoff;
    el.remove();
    if (fly) fly.remove();

    clearTimeout(introAt);
    runIntro(intro);
  };

  const waitOpaque = (t0) => {
    const ok = () => {

      const hiddenChip = plate && chip && chip.style.opacity === "0";
      const from = hiddenChip ? chip.parentElement : node.parentElement;
      const a = from ? effOpacity(from, false) : 1;
      const b = title ? effOpacity(title, true) : 1;
      return (a >= 0.995 && b >= 0.995) || performance.now() - t0 > 900;
    };
    if (ok()) land();
    else requestAnimationFrame(() => waitOpaque(t0));
  };

  const onEnd = (e) => {
    if (e.target !== logo || e.propertyName !== "transform") return;
    logo.removeEventListener("transitionend", onEnd);
    waitOpaque(performance.now());
  };
  logo.addEventListener("transitionend", onEnd);
  setTimeout(() => waitOpaque(performance.now()), SPLASH_FLY_MS + 120);
}

function useLaunchSplash(boot) {
  const closed = useRef(false);
  const timer = useRef(0);
  const bootRef = useRef(boot);
  bootRef.current = boot;

  useEffect(() => {
    if (closed.current || boot === "loading") return;
    closed.current = true;
    const bootAt = performance.now();
    let stopped = false;

    // 依次满足三件事才让 Logo 起飞：
    // 1) 启动页已经显示够 SPLASH_MIN_MS；2) 首页入场已经在遮罩后跑完；
    // 3) 公告已经落位（最多等 NOTICE_WAIT_CAP，弱网不拖住启动）
    const tick = () => {
      if (stopped) return;
      const now = performance.now();
      const primed = introPrimedAt || primeHomeIntro();
      const introDone = !primed || now - primed >= INTRO_SETTLE_MS;
      // 只有首页有公告；登录页不用等
      const noticeDone =
        bootRef.current !== "ready" || !!window.__noticeAt || now - bootAt >= NOTICE_WAIT_CAP;
      if (now >= SPLASH_MIN_MS && introDone && noticeDone) {
        dismissSplash(bootRef.current);
        return;
      }
      timer.current = setTimeout(tick, 40);
    };

    timer.current = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer.current);
    };
  }, [boot]);

  useEffect(() => {
    const t = setTimeout(() => dismissSplash(bootRef.current), 6000);
    return () => {
      clearTimeout(t);
      clearTimeout(timer.current);
    };
  }, []);
}

function useEdgeBack(onBack) {
  useEffect(() => {
    let sx = 0;
    let active = false;
    let axis = null;
    const down = (e) => {
      const t = e.touches ? e.touches[0] : e;
      if (t.clientX > 24) return;
      active = true;
      sx = t.clientX;
      axis = null;
    };
    const move = (e) => {
      if (!active) return;
      const t = e.touches ? e.touches[0] : e;
      const dx = t.clientX - sx;
      if (axis === null) {
        axis = Math.abs(dx) > 10 ? "x" : "y";
      }
      if (axis !== "x") return;
      if (dx > 8 && e.cancelable) e.preventDefault();
    };
    const up = (e) => {
      if (!active) return;
      active = false;
      if (axis !== "x") return;
      const t = e.changedTouches ? e.changedTouches[0] : e;
      const dx = t.clientX - sx;
      if (dx > 70) onBack?.();
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
    window.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("mousedown", down);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [onBack]);
}

function Shell() {
  const { boot, toast, runToastAction, logout, pushToast, connError, refresh, dorm, dormChecked, update, checkingUpdate, dismissUpdate } =
    useApp();
  const [flat] = useState(isFlat);
  const [native] = useState(isNative);
  const [route, setRoute] = useState(readHashRoute);
  const [fbOpen, setFbOpen] = useState(false);
  // 从意见反馈浮层里点导航：先切路由再撤浮层会出现「先闪一下我的」。
  // 置瞬时标记，让 pane 不走 0.2~0.46s 的淡入滑入，直接一步到位。
  const [navInstant, setNavInstant] = useState(false);
  const [bindPrompt, setBindPrompt] = useState(false);
  const bindAsked = useRef(false);
  const metrics = useStageMetrics(flat, native);
  useRipple();

  useEffect(() => {
    if (boot !== "ready") {
      bindAsked.current = false;
      return;
    }
    if (!dormChecked || dorm || bindAsked.current) return;
    bindAsked.current = true;
    const t = setTimeout(() => setBindPrompt(true), 620);
    return () => clearTimeout(t);
  }, [boot, dormChecked, dorm]);

  useEffect(() => {
    if (dorm) setBindPrompt(false);
  }, [dorm]);

  useLaunchSplash(boot);

  const prevBoot = useRef(boot);
  useLayoutEffect(() => {
    const was = prevBoot.current;
    prevBoot.current = boot;

    if (boot === "anon") {
      const layer = document.querySelector(".login-layer");
      const login = document.querySelector(".login");
      if (layer) {
        layer.style.removeProperty("opacity");
        layer.style.removeProperty("transition");
      }
      login?.removeAttribute("style");
    }

    if (was !== "anon" || boot !== "ready") return;

    const stage = stageIntro();
    if (!stage) return;

    stage.dataset.swap = "shrink";

    const endFly = flyLoginLogo(stage, SWAP_FLY_MS, 0);

    const plate = shrinkLoginBg(stage, SWAP_SHRINK_MS, SWAP_OUT_MS);

    let landed = false;
    let introAt = 0;
    const land = () => {
      if (landed) return;
      landed = true;
      clearTimeout(introAt);
      window.__tLand = Math.round(performance.now()); // 自动化探针

      plate?.stop();
      endFly?.();
      runIntro(stage);
    };

    const timers = [];
    const at = (ms, fn) => timers.push(setTimeout(fn, ms));

    introAt = at(Math.max(0, SWAP_FLY_MS - INTRO_LEAD_MS), () => runIntro(stage));

    if (!plate || !plate.shrinks) {

      delete stage.dataset.swap;
      const layer = stage.querySelector(".login-layer");
      if (layer) {
        layer.style.transition = `opacity 240ms ${EASE_EMPHASIZED}`;
        layer.style.opacity = "0";
      }
      at(260, land);
    } else {

      const layer = stage.querySelector(".login-layer");
      const onEnd = (e) => {
        if (e.target !== layer || e.propertyName !== "transform") return;
        layer.removeEventListener("transitionend", onEnd);
        land();
      };
      layer.addEventListener("transitionend", onEnd);

      at(plate.endAt + 140, land);
    }

    return () => {
      timers.forEach(clearTimeout);
      land();
    };
  }, [boot]);

  const stack = useRef([readHashRoute()]);

  const applyRoute = useCallback(
    (next) => {
      setRoute(next);
      if (!flat) window.history.replaceState(null, "", `#${next}`);
    },
    [flat],
  );

  const go = useCallback(
    (next) => {
      if (next === route) return;
      const st = stack.current;
      st.push(next);
      if (st.length > 24) st.splice(0, st.length - 24);
      applyRoute(next);
    },
    [route, applyRoute],
  );

  const handleBack = useCallback(() => {

    if (runBackHandler()) return true;

    const st = stack.current;
    if (st.length > 1) {
      st.pop();
      applyRoute(st[st.length - 1]);
      return true;
    }
    if (route !== "home") {
      applyRoute("home");
      return true;
    }
    return false;
  }, [route, applyRoute]);

  const lastBackAt = useRef(0);

  const backRef = useRef(null);
  backRef.current = handleBack;
  const onNativeBack = useCallback(() => {
    if (backRef.current?.()) return;
    const now = Date.now();
    if (now - lastBackAt.current < 2000) {
      lastBackAt.current = 0;
      CapApp.exitApp().catch(() => {});
      return;
    }
    lastBackAt.current = now;
    pushToast("再按一次退出应用");
  }, [pushToast]);

  useEffect(() => {
    if (!native) return;
    let sub = null;
    let dead = false;
    CapApp.addListener("backButton", onNativeBack)
      .then((h) => {
        if (dead) h?.remove();
        else sub = h;
      })
      .catch(() => {});
    return () => {
      dead = true;
      sub?.remove();
    };
  }, [native, onNativeBack]);

  useEffect(() => {
    window.__dormBack = onNativeBack;
    return () => {
      delete window.__dormBack;
    };
  }, [onNativeBack]);

  useEdgeBack(handleBack);

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.metaKey || e.ctrlKey || e.altKey) return;
      const i = Number(e.key);
      if (i >= 1 && i <= 5) {
        e.preventDefault();
        go(ROUTES[i - 1]);
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const cur = ROUTES.indexOf(route);
        if (cur < 0) return;
        const next = ROUTES[Math.min(4, Math.max(0, cur + (e.key === "ArrowRight" ? 1 : -1)))];
        if (next !== route) {
          e.preventDefault();
          go(next);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, route]);

  const handleLogout = useCallback(async () => {
    await logout();
    stack.current = ["home"];
    applyRoute("home");
    pushToast("已退出登录", "err");
  }, [logout, applyRoute, pushToast]);

  const authed = boot === "ready";
  const activeIdx = ROUTES.indexOf(route);

  const wasAuthed = useRef(false);
  useLayoutEffect(() => {
    const first = !wasAuthed.current;
    wasAuthed.current = authed;
    if (first || !authed) return;

    const pane = document.querySelector('.pane[data-active="true"]');
    if (!pane) return;
    pane.removeAttribute("data-enter");
    void pane.offsetWidth;
    pane.setAttribute("data-enter", "1");
    const t = setTimeout(() => pane.removeAttribute("data-enter"), 820);
    return () => clearTimeout(t);
  }, [route, authed]);

  const netbar =
    authed && connError ? (
      <div className="netbar" role="status">
        <span className="netbar__dot" />
        <span className="netbar__text">{connError}</span>
        <button className="netbar__btn" onClick={() => refresh("all")}>
          重试
        </button>
      </div>
    ) : null;

  const stageStyle = flat
    ? { width: W, height: metrics.h, borderRadius: 0, "--stage-h": `${metrics.h}px` }
    : native
      ? {
          width: W,
          height: metrics.h,
          "--stage-h": `${metrics.h}px`,
          transform: `translate3d(${metrics.x}px, 0, 0) scale(${metrics.s})`,
        }
      : { "--stage-h": `${H}px`, transform: `scale(${metrics.s})` };

  const stage = (
    <div className={`stage${native ? " stage--native" : ""}`} style={stageStyle}>
      <div className="screen">
        <div className="app" data-show={authed}>
          {ROUTES.map((key, i) => (
            <section
              key={key}
              className="pane"
              data-instant={navInstant ? "true" : undefined}
              data-active={route === key}
              data-rel={i < activeIdx ? "prev" : i > activeIdx ? "next" : "cur"}
              aria-hidden={route !== key}
            >
              {key === "home" ? (
                <Home go={go} />
              ) : key === "tasks" ? (
                <Tasks go={go} />
              ) : key === "locations" ? (
                <Locations go={go} />
              ) : key === "logs" ? (
                <Logs go={go} />
              ) : (
                <Me go={go} onLogout={handleLogout} onFeedback={() => setFbOpen(true)} />
              )}
            </section>
          ))}
        </div>

        {authed && fbOpen && <Feedback onClose={() => setFbOpen(false)} />}

        <div className="login-layer" data-show={!authed}>
          <Login />
        </div>
      </div>

      {authed && (
        <div className="chrome">
          <StatusBar hidden />
          <BottomNav
            active={route}
            onChange={(k) => {
              if (fbOpen) {
                // 浮层下的路由是「我的」，直接关掉会先露出我的再滑过去。
                // 这里让路由瞬时切换，再撤浮层，用户只会看到目标页。
                setNavInstant(true);
                setFbOpen(false);
                go(k);
                requestAnimationFrame(() => requestAnimationFrame(() => setNavInstant(false)));
                return;
              }
              go(k);
            }}
          />
          <HomeIndicator />
        </div>
      )}

      <div className="overlay" id="overlay-root" />
      {netbar}
      <Toast toast={toast} onAction={runToastAction} />
      <DormBindPrompt open={bindPrompt} onClose={() => setBindPrompt(false)} />
      <UpdateSheet update={update} checking={checkingUpdate} onClose={dismissUpdate} />
    </div>
  );

  if (flat) {
    return (
      <div className="viewport viewport--flat" style={{ width: W, height: metrics.h }}>
        {stage}
      </div>
    );
  }

  if (native) {

    const bleed = flat ? 0 : metrics.x / metrics.s;
    return (
      <div className="viewport viewport--native" data-screen={authed ? "app" : "login"}>
        {!authed && bleed > 0.5 && (
          <div
            className="loginbleed"
            aria-hidden
            style={{
              width: W + bleed * 2,
              height: metrics.h,
              transform: `translate3d(${metrics.x - bleed * metrics.s}px, 0, 0) scale(${metrics.s})`,
            }}
          >

            <div className="loginbleed__art" style={{ left: bleed }}>
              <LoginBlob />
            </div>
          </div>
        )}
        {stage}
      </div>
    );
  }

  return (
    <div className="viewport">
      <div className="device" style={{ width: W * metrics.s, height: H * metrics.s }}>
        {stage}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

