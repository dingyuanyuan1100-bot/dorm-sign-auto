

const TOKEN_KEY = "dorm.token";


export const API_ORIGIN = "https://www.wuxianshitu.icu";


const SAME_ORIGIN =
  typeof location !== "undefined" && location.origin === API_ORIGIN;


const env = (import.meta.env || {});
export const API_BASE =
  env.VITE_API_BASE !== undefined && env.VITE_API_BASE !== ""
    ? env.VITE_API_BASE
    : env.DEV || SAME_ORIGIN
      ? ""
      : API_ORIGIN;

export class ApiError extends Error {
  constructor(msg, status) {
    super(msg);
    this.name = "ApiError";
    this.status = status;

    this.unknownOutcome = false;
  }
}

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch {
      return "";
    }
  },
  set: (t) => {
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {
      
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      
    }
  },
};

let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


function emitNet(ok, msg) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("dorm:net", { detail: { ok, msg } }));
  } catch {
    
  }
}


function targetLabel(url) {
  if (/^https?:/.test(url)) return url.replace(/\/api\/.*$/, "");
  if (typeof location !== "undefined") return `${location.origin}（经开发服务器代理）`;
  return url;
}

const IDEMPOTENT = new Set(["GET", "HEAD", "OPTIONS"]);


function connFailMessage(url, timeoutHit) {
  try {
    console.warn(`[dorm] 请求失败：${timeoutHit ? "超时" : "网络不可达"} · ${targetLabel(url)}`);
  } catch {
    
  }
  return "网络问题，请稍后重试";
}


function cleanServerMsg(payload) {
  const raw = String(payload?.msg || "").trim();
  if (!raw || raw.length > 30) return "";
  if (/[A-Za-z]{8,}|\/|\\|HTTP|\b[45]\d{2}\b|\{|\}/.test(raw)) return "";
  return raw;
}


let lastOkAt = 0;
export const linkIdle = () => (lastOkAt ? Date.now() - lastOkAt : Infinity);


export async function warmLink() {
  if (!tokenStore.get()) return false;
  if (Date.now() - lastOkAt < 4000) return true;
  try {
    await request("/api/auth/me", { silent: true, retries: 2 });
    return true;
  } catch {
    return false;
  }
}

async function request(path, { method = "GET", body, auth = true, timeout = 30000, retries, silent = false } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = tokenStore.get();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const url = `${API_BASE}${path}`;
  const isWrite = !IDEMPOTENT.has(method.toUpperCase());

  const maxAttempts = retries ?? (isWrite ? 1 : 3);

  let res;
  for (let attempt = 1; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
        cache: "no-store",
      });
      clearTimeout(timer);
      break;
    } catch (e) {
      clearTimeout(timer);
      const timeoutHit = e.name === "AbortError";

      if (!timeoutHit && attempt < maxAttempts) {
        await sleep(300 * attempt);
        continue;
      }
      const err = timeoutHit
        ? new ApiError(connFailMessage(url, true), 0)
        : new ApiError(connFailMessage(url, false), 0);

      err.unknownOutcome = isWrite;

      if (!isWrite && !silent) emitNet(false, err.message);
      throw err;
    }
  }
  lastOkAt = Date.now();
  emitNet(true);

  let payload = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError(
        res.status >= 500 ? "服务暂时不可用，请稍后重试" : "操作失败，请稍后重试",
        res.status,
      );
    }
  }

  if (res.status === 401) {
    tokenStore.clear();
    onUnauthorized?.();

    const credential = /\/(login|register)$/.test(path);
    throw new ApiError(credential ? "账号或密码错误" : "登录已过期，请重新登录", 401);
  }

  if (!res.ok || payload?.success === false) {
    const fallback =
      res.status === 429
        ? "尝试次数过多，请稍后再试"
        : res.status >= 500
          ? "服务暂时不可用，请稍后重试"
          : "操作失败，请稍后重试";
    const err = new ApiError(res.status === 429 ? fallback : cleanServerMsg(payload) || fallback, res.status);

    if (isWrite && res.status >= 500) err.unknownOutcome = true;
    throw err;
  }

  return payload?.data;
}


export const authApi = {
  login: (username, password) =>
    request("/api/auth/login", { method: "POST", body: { username, password }, auth: false }),
  register: (username, password) =>
    request("/api/auth/register", { method: "POST", body: { username, password }, auth: false }),
  me: () => request("/api/auth/me"),
  logout: () => request("/api/auth/logout", { method: "POST" }).catch(() => null),
};


// 忘记密码：学号 + 晚寝密码验证身份 → 选账号 → 重置
export const recoverApi = {
  verify: (student_id, password) =>
    request("/api/auth/recover/verify", {
      method: "POST",
      body: { student_id, password },
      auth: false,
      timeout: 45000,
    }),
  reset: (ticket, user_id, password) =>
    request("/api/auth/recover/reset", {
      method: "POST",
      body: { ticket, user_id, password },
      auth: false,
    }),
};


export const dormApi = {
  get: () => request("/api/dorm-account"),
  bind: (student_id, password, nickname = "") =>
    request("/api/dorm-account", { method: "PUT", body: { student_id, password, nickname }, timeout: 45000 }),
  unbind: () => request("/api/dorm-account", { method: "DELETE" }),
};


export const locationApi = {
  list: () => request("/api/locations"),
  create: (payload) => request("/api/locations", { method: "POST", body: payload, timeout: 15000 }),
  update: (id, payload) => request(`/api/locations/${id}`, { method: "PUT", body: payload, timeout: 15000 }),
  remove: (id) => request(`/api/locations/${id}`, { method: "DELETE", timeout: 15000 }),
  setDefault: (id) => request(`/api/locations/${id}/default`, { method: "POST", timeout: 15000 }),
  fromTask: () => request("/api/locations/from-task", { timeout: 45000 }),
};


export const scheduleApi = {
  list: () => request("/api/schedules"),
  create: (payload) => request("/api/schedules", { method: "POST", body: payload, timeout: 15000 }),
  update: (id, payload) => request(`/api/schedules/${id}`, { method: "PUT", body: payload, timeout: 15000 }),
  remove: (id) => request(`/api/schedules/${id}`, { method: "DELETE", timeout: 15000 }),
  run: (id) => request(`/api/schedules/${id}/run`, { method: "POST", timeout: 60000 }),
};


export const logApi = {
  list: (limit = 50) => request(`/api/logs?limit=${limit}`),
};

export const feedbackApi = {
  submit: ({ type, content, images }) =>
    request("/api/feedback", {
      method: "POST",
      body: { type, content, images },
      timeout: 45000,
    }),
  list: () => request("/api/feedback"),
  detail: (id) => request(`/api/feedback/${id}`),
};
