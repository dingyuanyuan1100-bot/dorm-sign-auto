import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  authApi,
  dormApi,
  locationApi,
  logApi,
  recoverApi,
  scheduleApi,
  setUnauthorizedHandler,
  tokenStore,
  warmLink,
} from "./api";
import { clearSnooze, currentVersion, fetchLatest, isSnoozed, snooze } from "./update";

const AppCtx = createContext(null);

export const useApp = () => useContext(AppCtx);

const EMPTY = { locations: [], schedules: [], logs: [] };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function AppProvider({ children }) {
  const [boot, setBoot] = useState("loading"); // loading | anon | ready
  const [session, setSession] = useState(null); // { username, hasDormAccount, studentId }
  const [dorm, setDorm] = useState(null);

  const [dormChecked, setDormChecked] = useState(false);
  const [locations, setLocations] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [logs, setLogs] = useState([]);
  const [busy, setBusy] = useState({}); // { [key]: true }
  const [connError, setConnError] = useState("");

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const toastAction = useRef(null);
  const alive = useRef(true);
  useEffect(() => {

    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const pushToast = useCallback((text, tone = "ok", action = null, onAction = null, ms = 2400) => {
    toastAction.current = onAction;
    setToast({ text, tone, action, key: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      toastAction.current = null;
      setToast(null);
    }, ms);
  }, []);

  const runToastAction = useCallback(() => {
    const fn = toastAction.current;
    toastAction.current = null;
    clearTimeout(toastTimer.current);
    setToast(null);
    fn?.();
  }, []);

  const [update, setUpdate] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const checkingRef = useRef(false);
  const updateRef = useRef(null);
  const lastAutoAt = useRef(0);
  const checkRef = useRef(null);

  const checkUpdate = useCallback(
    async ({ auto = false } = {}) => {
      if (checkingRef.current) return null;

      if (auto && updateRef.current) return null;
      checkingRef.current = true;
      if (auto) lastAutoAt.current = Date.now();
      if (!auto) {

        clearSnooze();
        setCheckingUpdate(true);
      }
      try {
        const cur = await currentVersion();
        const latest = await fetchLatest();
        if (!alive.current) return null;
        if (!latest) {

          if (!auto) pushToast("检查更新失败，请稍后重试", "err");
          return null;
        }
        if (latest.versionCode > cur.versionCode) {

          if (auto && !latest.force && isSnoozed(latest.versionCode)) return null;
          setUpdate({ latest, current: cur });
          return latest;
        }
        if (!auto) pushToast(`已是最新版本 v${cur.version}`, "ok");
        return null;
      } finally {
        checkingRef.current = false;
        if (alive.current) setCheckingUpdate(false);
      }
    },
    [pushToast],
  );

  const dismissUpdate = useCallback(() => {
    setUpdate((u) => {
      if (u?.latest && !u.latest.force) snooze(u.latest.versionCode);
      return null;
    });
  }, []);

  useEffect(() => {
    updateRef.current = update;
  }, [update]);

  useEffect(() => {
    checkRef.current = checkUpdate;
  }, [checkUpdate]);

  useEffect(() => {
    let on = true;
    const fire = () => {
      if (!on) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      checkRef.current?.({ auto: true });
    };
    const timers = [setTimeout(fire, 2600), setTimeout(fire, 12000), setTimeout(fire, 40000)];
    const onVisible = () => {
      if (!on || document.visibilityState !== "visible") return;
      if (updateRef.current) return;
      if (Date.now() - lastAutoAt.current < 6 * 3600e3) return;
      fire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      on = false;
      timers.forEach(clearTimeout);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const mark = useCallback((key, v) => setBusy((b) => ({ ...b, [key]: v })), []);

  const schedulesRef = useRef([]);
  const locationsRef = useRef([]);
  schedulesRef.current = schedules;
  locationsRef.current = locations;

  const sameSchedule = (row, p) =>
    row.sign_time === p.sign_time &&
    row.mode === p.mode &&
    String(row.location_id ?? "") === String(p.location_id ?? "") &&
    (p.mode !== "once" || String(row.sign_date ?? "") === String(p.sign_date ?? ""));

  const taskKey = (r) => [r.sign_time, r.mode, r.location_id ?? "", r.sign_date ?? "", (r.remark ?? "").trim()].join("|");

  const runWrite = useCallback(async (doWrite, peek) => {
    let lastErr = null;
    let netDown = 0;
    for (let round = 0; round < 3; round++) {
      await warmLink();
      try {
        return await doWrite();
      } catch (e) {

        if (e?.status && !e.unknownOutcome) throw e; // 业务错误（400/401/404…）不重试
        lastErr = e;
        let seen = false;
        try {
          seen = (await peek?.()) || false;
          netDown = 0;
        } catch {

          netDown += 1;
          if (netDown >= 2) throw lastErr;
        }
        if (seen) return seen === true ? { reconciled: true } : seen;
        await sleep(400 * (round + 1));
      }
    }
    throw lastErr;
  }, []);

  const dedupeSchedules = useCallback(async (knownIds, { silent = true } = {}) => {
    const rows = await scheduleApi.list().catch(() => null);
    if (!rows) return null;
    const seen = new Set();
    const extra = [];
    for (const r of [...rows].sort((a, b) => a.id - b.id)) {
      const k = taskKey(r);
      if (seen.has(k)) {
        if (!knownIds.has(r.id)) extra.push(r); // knownIds 里的老数据不动
      } else {
        seen.add(k);
      }
    }
    if (!extra.length) {
      if (alive.current) setSchedules(rows);
      return rows;
    }
    for (const r of extra) {
      try {
        await scheduleApi.remove(r.id);
      } catch {
        // 单条删失败不阻塞其余清理
      }
    }
    const after = (await scheduleApi.list().catch(() => null)) || rows.filter((r) => !extra.some((e) => e.id === r.id));
    if (alive.current) setSchedules(after);
    if (!silent) pushToast(`已清理 ${extra.length} 条重复任务`);
    return after;
  }, [pushToast]);

  const loadLogs = useCallback(async () => {
    const rows = await logApi.list(50);
    if (alive.current) setLogs(rows || []);
    return rows || [];
  }, []);

  const loadAll = useCallback(async () => {
    // 逐个发，不并发：四个请求一起打容易撞到后端限流
    const settle = async (fn) => {
      try {
        return { status: "fulfilled", value: await fn() };
      } catch (e) {
        return { status: "rejected", reason: e };
      }
    };
    const locs = await settle(() => locationApi.list());
    const sch = await settle(() => scheduleApi.list());
    const lg = await settle(() => logApi.list(50));
    const acc = await settle(() => dormApi.get());

    if (!alive.current) return;
    if (locs.status === "fulfilled") setLocations(locs.value || []);
    if (sch.status === "fulfilled") setSchedules(sch.value || []);
    if (lg.status === "fulfilled") setLogs(lg.value || []);

    if (acc.status === "fulfilled") {
      setDorm(acc.value || null);
      setDormChecked(true);
    } else if (acc.reason?.status === 200 || acc.reason?.status === 404) {
      setDorm(null);
      setDormChecked(true);
    }

    if (sch.status === "fulfilled" && (sch.value || []).length > 1) {
      dedupeSchedules(new Set(), { silent: false });
    }
  }, [dedupeSchedules]);

  const refresh = useCallback(
    async (which = "all") => {
      try {
        if (which === "all") {
          await loadAll();
        } else {
          if (which === "locations") setLocations((await locationApi.list()) || []);
          if (which === "schedules") setSchedules((await scheduleApi.list()) || []);
          if (which === "logs") await loadLogs();
          if (which === "dorm") {
            try {
              setDorm((await dormApi.get()) || null);
            } catch (e) {
              if (e.status !== 200 && e.status !== 404) throw e;
              setDorm(null); // 服务端明确答复「未绑定」
            }
            setDormChecked(true);
          }
        }
        setConnError("");
      } catch (e) {
        if (e.status !== 401) setConnError(e.message);
      }
    },
    [loadAll, loadLogs],
  );

  const clearSession = useCallback(() => {
    tokenStore.clear();
    setSession(null);
    setDorm(null);
    setDormChecked(false);
    setLocations(EMPTY.locations);
    setSchedules(EMPTY.schedules);
    setLogs(EMPTY.logs);
    setBoot("anon");
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession();
    });
  }, [clearSession]);

  useEffect(() => {
    const onNet = (e) => {
      const d = e.detail || {};
      setConnError(d.ok ? "" : d.msg || "网络异常");
    };
    window.addEventListener("dorm:net", onNet);
    return () => window.removeEventListener("dorm:net", onNet);
  }, []);

  const applyMe = useCallback((me, username) => {
    const s = {
      username: me?.username || username || "",
      hasDormAccount: !!me?.has_dorm_account,
      studentId: me?.student_id || "",
    };
    setSession(s);
    return s;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = tokenStore.get();
      if (!token) {
        if (!cancelled) setBoot("anon");
        return;
      }
      try {
        const me = await authApi.me();
        if (cancelled) return;
        applyMe(me);
        await loadAll();
        if (!cancelled) setBoot("ready");
      } catch (e) {
        if (cancelled) return;
        if (e.status === 401) {
          setBoot("anon");
        } else {
          setConnError(e.message);
          setBoot("anon");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyMe, loadAll]);

  const login = useCallback(
    async (username, password) => {
      mark("login", true);
      try {
        const data = await authApi.login(username, password);
        tokenStore.set(data.token);
        const me = await authApi.me();
        applyMe(me, data.username || username);
        await loadAll();
        setBoot("ready");
        setConnError("");
        return true;
      } finally {
        mark("login", false);
      }
    },
    [applyMe, loadAll, mark],
  );

  const register = useCallback(
    async (username, password) => {
      mark("login", true);
      try {
        await authApi.register(username, password);
        const data = await authApi.login(username, password);
        tokenStore.set(data.token);
        const me = await authApi.me();
        applyMe(me, data.username || username);
        await loadAll();
        setBoot("ready");
        return true;
      } finally {
        mark("login", false);
      }
    },
    [applyMe, loadAll, mark],
  );

  // 忘记密码：第一步用学号 + 晚寝密码验证身份，拿到账号列表与临时凭证
  const recoverVerify = useCallback(
    async (studentId, password) => recoverApi.verify(String(studentId).trim(), password),
    [],
  );

  // 第三步：带着凭证重置指定账号的 App 密码
  const recoverReset = useCallback(
    async (ticket, userId, password) => recoverApi.reset(ticket, userId, password),
    [],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();    } finally {
      clearSession();
    }
  }, [clearSession]);

  const bindDorm = useCallback(
    async (studentId, password, nickname) => {
      mark("dorm", true);
      try {
        await dormApi.bind(studentId, password, nickname);
        const me = await authApi.me();
        applyMe(me, session?.username);
        setDorm((await dormApi.get()) || null);
        setDormChecked(true);
        await refresh("schedules");
        return true;
      } finally {
        mark("dorm", false);
      }
    },
    [applyMe, mark, refresh, session?.username],
  );

  const unbindDorm = useCallback(async () => {
    mark("dorm", true);
    try {
      await dormApi.unbind();
      const me = await authApi.me();
      applyMe(me, session?.username);
      setDorm(null);
      setDormChecked(true);
      await refresh("schedules");
    } finally {
      mark("dorm", false);
    }
  }, [applyMe, mark, refresh, session?.username]);

  const addLocation = useCallback(async (payload) => {
    mark("location", true);
    const known = new Set((locationsRef.current || []).map((l) => l.id));
    const same = (r) =>
      String(r.name ?? "") === String(payload.name ?? "") &&
      String(r.lat ?? "") === String(payload.lat ?? "") &&
      String(r.lng ?? "") === String(payload.lng ?? "");
    try {
      return await runWrite(
        async () => {
          const loc = await locationApi.create(payload);
          setLocations((prev) => [...prev, loc].sort((a, b) => a.id - b.id));
          return loc;
        },
        async () => {
          const rows = await locationApi.list();
          if (alive.current) setLocations(rows || []);
          return (rows || []).filter((r) => !known.has(r.id) && same(r)).pop() || false;
        },
      );
    } finally {
      mark("location", false);
    }
  }, [mark, runWrite]);

  const removeLocation = useCallback(async (id) => {
    const drop = () =>
      setLocations((prev) => {
        const next = prev.filter((l) => l.id !== id);
        if (next.length && !next.some((l) => l.is_default)) next[0] = { ...next[0], is_default: true };
        return next;
      });
    const before = locationsRef.current;
    drop();
    try {
      await runWrite(
        () => locationApi.remove(id),
        async () => {
          const rows = await locationApi.list();
          if (!rows) return false;
          if (!alive.current) return false;
          setLocations(rows);
          return !rows.some((l) => l.id === id);
        },
      );
    } catch (e) {
      if (alive.current) setLocations(before);
      throw e;
    }
    await refresh("schedules");
  }, [refresh, runWrite]);

  const setDefaultLocation = useCallback(async (id) => {
    const before = locationsRef.current;
    setLocations((prev) => prev.map((l) => ({ ...l, is_default: l.id === id })));
    try {
      await runWrite(
        () => locationApi.setDefault(id),
        async () => {
          const rows = await locationApi.list();
          if (!rows) return false;
          if (alive.current) setLocations(rows);
          return !!rows.find((l) => l.id === id)?.is_default;
        },
      );
    } catch (e) {
      if (alive.current) setLocations(before);
      throw e;
    }
  }, [runWrite]);

  const pullFromTask = useCallback(async () => {
    const data = await locationApi.fromTask();
    return data;
  }, []);

  const addSchedule = useCallback(async (payload) => {
    mark("schedule", true);
    const known = new Set((schedulesRef.current || []).map((s) => s.id));
    try {
      return await runWrite(
        async () => {
          const r = await scheduleApi.create(payload);
          await dedupeSchedules(known);
          return r;
        },
        async () => {

          const rows = await dedupeSchedules(known);
          if (!rows) return false;
          const hit = rows.filter((r) => !known.has(r.id) && sameSchedule(r, payload)).pop();
          return hit ? { id: hit.id, reconciled: true } : false;
        },
      );
    } finally {
      mark("schedule", false);
    }
  }, [mark, dedupeSchedules, runWrite]);

  const updateSchedule = useCallback(
    async (id, patch) => {
      const before = schedulesRef.current;
      const same = (a, b) => (typeof b === "boolean" ? !!a === b : String(a) === String(b));

      setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
      try {
        await runWrite(
          async () => {
            const r = await scheduleApi.update(id, patch);
            scheduleApi
              .list()
              .then((rows) => alive.current && setSchedules(rows || []))
              .catch(() => {});
            return r;
          },
          async () => {

            const rows = await scheduleApi.list();
            if (!rows) return false;
            if (alive.current) setSchedules(rows);
            const row = rows.find((r) => r.id === id);
            return !!(row && Object.entries(patch).every(([k, v]) => same(row[k], v)));
          },
        );
      } catch (e) {
        if (alive.current) setSchedules(before);
        throw e;
      }
    },
    [runWrite],
  );

  const removeSchedule = useCallback(async (id) => {
    const before = schedulesRef.current;
    setSchedules((prev) => prev.filter((s) => s.id !== id));
    try {
      await runWrite(
        () => scheduleApi.remove(id),
        async () => {

          const rows = await scheduleApi.list();
          if (!rows) return false;
          if (alive.current) setSchedules(rows);
          return !rows.some((r) => r.id === id);
        },
      );
    } catch (e) {
      if (alive.current) setSchedules(before);
      throw e;
    }
  }, [runWrite]);

  const runSchedule = useCallback(
    async (id) => {
      const knownLogs = new Set((logs || []).map((l) => l.id));
      const triggerOnce = () => scheduleApi.run(id);

      const reconcile = async () => {
        await sleep(3000);
        const rows = await logApi.list(20).catch(() => null);
        if (rows && rows.some((l) => l.schedule_id === id && !knownLogs.has(l.id))) {
          if (alive.current) setLogs(rows);
          return { success: true, reconciled: true };
        }
        return null;
      };
      let res = null;
      await warmLink();
      try {
        res = await triggerOnce();
      } catch (e) {
        if (e?.status && e.status >= 400 && e.status < 500) throw e; // 业务错误直接抛
        const ok = await reconcile(e);
        if (ok) {
          res = ok;
        } else if (!e?.status || e.status === 0) {

          try {
            res = await triggerOnce();
          } catch (e2) {
            const ok2 = await reconcile(e2);
            if (ok2) res = ok2;
            else throw e2;
          }
        } else {
          throw e; // 5xx 且日志里没有新记录：保守报失败，由用户重试
        }
      }
      if (res && res.success === false) throw new ApiError(res.msg || "触发失败", 400);
      let tries = 0;
      const poll = async () => {
        tries += 1;
        await refresh("logs");
        await refresh("schedules");
        if (tries < 5) setTimeout(() => alive.current && poll(), 1500);
      };
      setTimeout(() => alive.current && poll(), 900);
      return res;
    },
    [logs, refresh],
  );

  const defaultLocation = useMemo(
    () => locations.find((l) => l.is_default) ?? locations[0] ?? null,
    [locations],
  );

  const stats = useMemo(() => {
    const ok = logs.filter((l) => l.success).length;
    return { ok, fail: logs.length - ok, total: logs.length };
  }, [logs]);

  const value = useMemo(
    () => ({
      boot,
      session,
      dorm,
      dormChecked,
      locations,
      schedules,
      logs,
      stats,
      defaultLocation,
      busy,
      connError,
      toast,
      pushToast,
      runToastAction,
      update,
      checkingUpdate,
      checkUpdate,
      dismissUpdate,
      login,
      register,
      recoverVerify,
      recoverReset,
      logout,
      bindDorm,
      unbindDorm,
      addLocation,
      removeLocation,
      setDefaultLocation,
      pullFromTask,
      addSchedule,
      updateSchedule,
      removeSchedule,
      runSchedule,
      refresh,
    }),
    [
      boot,
      session,
      dorm,
      dormChecked,
      locations,
      schedules,
      logs,
      stats,
      defaultLocation,
      busy,
      connError,
      toast,
      pushToast,
      runToastAction,
      update,
      checkingUpdate,
      checkUpdate,
      dismissUpdate,
      login,
      register,
      recoverVerify,
      recoverReset,
      logout,
      bindDorm,
      unbindDorm,
      addLocation,
      removeLocation,
      setDefaultLocation,
      pullFromTask,
      addSchedule,
      updateSchedule,
      removeSchedule,
      runSchedule,
      refresh,
    ],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
