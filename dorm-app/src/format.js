

export function parseTs(ts) {
  if (!ts) return null;
  const m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
}

export const pad2 = (n) => String(n).padStart(2, "0");

export function hhmm(ts) {
  const d = parseTs(ts);
  if (!d) return "--:--";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function dayLabel(ts) {
  const d = parseTs(ts);
  if (!d) return "未知日期";
  const diff = Math.round((dayStart(new Date()) - dayStart(d)) / 86400000);
  const md = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  if (diff === 0) return `今天 · ${md}`;
  if (diff === 1) return `昨天 · ${md}`;
  if (diff === 2) return `前天 · ${md}`;
  return md;
}

export function nextLabel(nextRunAt) {
  const d = parseTs(nextRunAt);
  if (!d) return "";
  const diff = Math.round((dayStart(d) - dayStart(new Date())) / 86400000);
  const md = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const day = diff === 0 ? "今天" : diff === 1 ? "明天" : md;
  return `下次执行 · ${day} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export const modeLabel = (mode) => (mode === "daily" ? "每天" : "一次");
export const modeValue = (label) => (label === "每天" ? "daily" : "once");

export function coordText(loc) {
  if (!loc || loc.lat == null || loc.lng == null) return "—";
  const f = (v) => (typeof v === "string" ? v : String(v));
  return `${f(loc.lat)}, ${f(loc.lng)}`;
}

export const sidText = (sid) => sid || "未绑定";

export function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function triggerLabel(detail) {
  const s = String(detail || "");
  if (s === "manual") return "手动触发";
  if (s === "scheduled") return "定时任务";
  return s || "系统触发";
}
