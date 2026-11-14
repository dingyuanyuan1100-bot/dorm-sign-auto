import { API_BASE } from "./api";

const SEEN_KEY = "dorm.notice.seen";
// 公告正文全部由后端下发，前端只保留最近一次成功拉取的副本用来离线兜底
const CACHE_KEY = "dorm.notice.cache";

// dev 走 vite 代理（同源 /update/...），打包后走 API_BASE（线上就是 API_ORIGIN）
export const NOTICE_URL = `${API_BASE}/update/notice.json`;

const clean = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || raw.date || "").trim();
  const title = String(raw.title || "").trim();
  if (!id || !title) return null;
  const items = Array.isArray(raw.items)
    ? raw.items.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 8)
    : [];
  return {
    id,
    date: String(raw.date || ""),
    title,
    items,
    note: String(raw.note || "").trim(),
    tip: String(raw.tip || "").trim(),
  };
};

export function seenId() {
  try {
    return localStorage.getItem(SEEN_KEY) || "";
  } catch {
    return "";
  }
}

export function markSeen(id) {
  try {
    localStorage.setItem(SEEN_KEY, String(id || ""));
  } catch {

  }
}

export function clearSeen() {
  try {
    localStorage.removeItem(SEEN_KEY);
    localStorage.removeItem(CACHE_KEY);
  } catch {

  }
}

function readCache() {
  try {
    return clean(JSON.parse(localStorage.getItem(CACHE_KEY) || "null"));
  } catch {
    return null;
  }
}

function writeCache(n) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(n));
  } catch {

  }
}

/**
 * 拉取后端公告；网络异常/404 时退回本地最近一次成功拉取的副本。
 * 两处都没有内容时返回 null（首页不显示公告条）。
 */
export async function loadNotice({ timeout = 5000 } = {}) {
  const cached = readCache();
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
  try {
    const res = await fetch(`${NOTICE_URL}?t=${Date.now()}`, {
      cache: "no-store",
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!res.ok) return cached;
    const remote = clean(await res.json());
    if (!remote) return cached;
    writeCache(remote);
    return remote;
  } catch {
    return cached;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
