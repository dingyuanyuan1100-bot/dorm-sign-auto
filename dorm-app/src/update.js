

import { API_ORIGIN } from "./api";
import {
  APP_VERSION,
  VERSION_CODE,
  UPDATE_MANIFEST,
  APK_FALLBACK_URL,
  SNOOZE_HOURS,
  SKIP_KEY,
} from "./version";

export const UPDATE_ORIGIN = API_ORIGIN;

const remote = (path) =>
  /^https?:/i.test(path) ? path : `${UPDATE_ORIGIN}${path.startsWith("/") ? "" : "/"}${path}`;

export const manifestUrl = (stamp = Date.now()) => `${remote(UPDATE_MANIFEST)}?t=${stamp}`;

const isNative = () =>
  typeof window !== "undefined" &&
  !!window.Capacitor &&
  (window.Capacitor.isNativePlatform ? window.Capacitor.isNativePlatform() : true);

export async function currentVersion() {
  if (isNative()) {
    try {
      const { App } = await import("@capacitor/app");
      const info = await App.getInfo();
      const code = parseInt(info.build, 10);
      return {
        version: info.version || APP_VERSION,
        versionCode: Number.isFinite(code) && code > 0 ? code : VERSION_CODE,
        native: true,
      };
    } catch {

    }
  }
  return { version: APP_VERSION, versionCode: VERSION_CODE, native: false };
}

export async function fetchLatest({ timeout = 9000 } = {}) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
  try {
    const res = await fetch(manifestUrl(), {
      cache: "no-store",
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!res.ok) return null;
    const j = await res.json();
    const code = Number(j.versionCode ?? j.version_code ?? 0);
    if (!Number.isFinite(code) || code <= 0) return null;
    return {
      version: String(j.version ?? j.versionName ?? ""),
      versionCode: code,
      url: String(j.url || APK_FALLBACK_URL),
      notes: Array.isArray(j.notes) ? j.notes.filter(Boolean).slice(0, 6) : [],
      force: !!j.force,
      publishedAt: j.publishedAt ? String(j.publishedAt) : "",
      size: j.size ? String(j.size) : "",
    };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function isSnoozed(versionCode) {
  try {
    const raw = JSON.parse(localStorage.getItem(SKIP_KEY) || "null");
    if (!raw || Number(raw.code) !== Number(versionCode)) return false;
    return Date.now() - Number(raw.at || 0) < SNOOZE_HOURS * 3600e3;
  } catch {
    return false;
  }
}

export function snooze(versionCode) {
  try {
    localStorage.setItem(SKIP_KEY, JSON.stringify({ code: versionCode, at: Date.now() }));
  } catch {

  }
}

export function clearSnooze() {
  try {
    localStorage.removeItem(SKIP_KEY);
  } catch {

  }
}

export function openDownload(url) {
  const href = remote(/^https?:/i.test(url) ? url : url.startsWith("/") ? url : `/${url}`);
  const a = document.createElement("a");
  a.href = href;
  a.target = "_system";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  return href;
}

export { APP_VERSION, VERSION_CODE };
