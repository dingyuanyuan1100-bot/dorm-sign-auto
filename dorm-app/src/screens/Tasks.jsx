import { useRef, useState } from "react";
import { useApp } from "../state";
import { Sheet, Skeleton } from "../ui/Chrome";
import { Plus14, Plus30 } from "../ui/Icons";
import TimeWheel, { SIGN_WINDOW } from "../ui/TimeWheel";
import { modeLabel, modeValue, nextLabel, todayISO } from "../format";

const FILTERS = ["全部", "每天", "一次"];
const SEG_X = [4, 118, 232];
const SEG_W = [112, 114, 114];

const inWindow = (t) => {
  const m = /^(\d{2}):(\d{2})$/.exec(t || "");
  if (!m) return false;
  const v = Number(m[1]) * 60 + Number(m[2]);
  const cut = (x) => Number(x.split(":")[0]) * 60 + Number(x.split(":")[1]);
  return v >= cut(SIGN_WINDOW.from) && v <= cut(SIGN_WINDOW.to);
};

const CARD_TOP = 204;
const CARD_STEP = 122;

export default function Tasks({ go }) {
  const { schedules, locations, defaultLocation, updateSchedule, removeSchedule, runSchedule, addSchedule, pushToast, boot, busy } =
    useApp();
  const [filter, setFilter] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    time: SIGN_WINDOW.to,
    mode: "每天",
    date: todayISO(),
    locId: null,
    remark: "",
  });
  const pressTimer = useRef(null);

  const list = filter === 0 ? schedules : schedules.filter((t) => modeLabel(t.mode) === FILTERS[filter]);
  const addRowY = CARD_TOP + (list.length === 0 ? 0 : (list.length - 1) * CARD_STEP) + 124;

  const startPress = (t) => {
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => setConfirm(t), 480);
  };
  const endPress = () => clearTimeout(pressTimer.current);

  const handleCheckIn = async (t) => {
    if (busyId) return;
    setBusyId(t.id);
    try {
      await runSchedule(t.id);
      pushToast(`${t.sign_time} 已触发签到`);
    } catch (e) {
      if (e.status === 0) pushToast(e.message, "err", "重试", () => handleCheckIn(t), 5200);
      else pushToast(e.message || "触发失败", "err");
    } finally {
      setBusyId(null);
    }
  };

  const toggle = async (t) => {
    try {
      await updateSchedule(t.id, { enabled: !t.enabled });
      pushToast(t.enabled ? `已停用 ${t.sign_time}` : `已启用 ${t.sign_time}`);
    } catch (e) {
      pushToast(e.message || "操作失败", "err");
    }
  };

  const handleDelete = async (t) => {
    try {
      await removeSchedule(t.id);
      pushToast("任务已删除");
    } catch (e) {
      pushToast(e.message || "删除失败", "err");
    }
  };

  const handleCreate = async () => {
    if (busy?.schedule) return; // 防连点：一次点击只发一次写请求
    const time = draft.time.trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      pushToast("时间格式应为 HH:MM", "err");
      return;
    }
    if (!inWindow(time)) {
      pushToast(`签到时间要在 ${SIGN_WINDOW.from}–${SIGN_WINDOW.to} 之间`, "err");
      return;
    }
    const locId = draft.locId ?? defaultLocation?.id ?? locations[0]?.id ?? null;
    const payload = {
      mode: modeValue(draft.mode),
      sign_time: time,
      remark: draft.remark.trim(),
      location_id: locId,
    };
    if (draft.mode === "一次") payload.sign_date = draft.date;
    try {
      await addSchedule(payload);
      setCreating(false);
      setDraft({ ...draft, remark: "" });
      pushToast(`已新建 ${time} 的签到任务`);
    } catch (e) {
      if (e.status === 0) pushToast(e.message, "err", "重试", handleCreate, 5200);
      else pushToast(e.message || "创建失败", "err");
    }
  };

  const openCreate = () => {
    setDraft({ time: SIGN_WINDOW.to, mode: "每天", date: todayISO(), locId: defaultLocation?.id ?? null, remark: "" });
    setCreating(true);
  };

  return (
    <>
      <h1 className="t dis page-title">签到任务</h1>
      <button className="head-btn" onClick={() => go("locations")} aria-label="新建任务">
        <Plus30 />
      </button>

      <div className="seg" role="tablist">
        <i className="seg__pill" style={{ transform: `translateX(${filter * 114}px)` }} />
        {FILTERS.map((f, i) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === i}
            className="seg__txt t cn c"
            data-on={filter === i}
            style={{ left: SEG_X[i], width: SEG_W[i] }}
            onClick={() => setFilter(i)}
          >
            {f}
          </button>
        ))}
      </div>

      {boot !== "ready" && <Skeleton rows={3} top={CARD_TOP} height={110} gap={12} />}

      {boot === "ready" && list.length === 0 && (
        <div className="task-empty">
          <div className="task-empty__title">{filter === 0 ? "还没有签到任务" : `没有${FILTERS[filter]}任务`}</div>
          <div className="task-empty__desc">新建任务后由调度器在指定时间自动签到</div>
        </div>
      )}

      {list.map((t, i) => (
        <div
          key={t.id}
          className="taskcard"
          data-off={!t.enabled}
          style={{ top: CARD_TOP + i * CARD_STEP }}
          onPointerDown={() => startPress(t)}
          onPointerUp={endPress}
          onPointerLeave={endPress}
        >
          <span className="t num taskcard__time">{t.sign_time}</span>
          <div className="taskcard__chip">
            <span className="t cn c">{modeLabel(t.mode)}</span>
          </div>

          <button
            className="taskcard__switch"
            data-on={t.enabled}
            onClick={() => toggle(t)}
            aria-label={t.enabled ? "停用任务" : "启用任务"}
            aria-pressed={t.enabled}
          >
            <i className="taskcard__knob" />
          </button>

          <span className="t cn taskcard__place">{t.remark || "晚寝任务签到"}</span>

          {t.enabled ? (
            <>
              <span className="t cn taskcard__next">
                {nextLabel(t.next_run_at) || (t.last_msg ? t.last_msg : "等待调度")}
              </span>
              <button
                className="taskcard__btn"
                style={{ left: 253 }}
                onClick={() => handleCheckIn(t)}
                data-busy={busyId === t.id}
              >
                {busyId === t.id ? <span className="spinner" /> : "立即签到"}
              </button>
            </>
          ) : (
            <button
              className="taskcard__btn taskcard__btn--del"
              style={{ left: 256, top: 69 }}
              onClick={() => handleDelete(t)}
            >
              删除
            </button>
          )}
        </div>
      ))}

      <button className="addrow" style={{ top: addRowY }} onClick={openCreate}>
        <span className="addrow__box">
          <Plus14 />
        </span>
        <span className="t cn addrow__txt">新建签到任务</span>
      </button>

      {confirm && (
        <Sheet title={`删除 ${confirm.sign_time} 的任务？`} desc="删除后不会再自动执行" onClose={() => setConfirm(null)}>
          <div className="sheet__actions">
            <button className="sheet__btn" onClick={() => setConfirm(null)}>
              取消
            </button>
            <button
              className="sheet__btn sheet__btn--danger"
              onClick={() => {
                handleDelete(confirm);
                setConfirm(null);
              }}
            >
              删除
            </button>
          </div>
        </Sheet>
      )}

      {creating && (
        <Sheet title="新建签到任务" onClose={() => setCreating(false)}>
          <div className="sheet__label">签到时间</div>
          <TimeWheel value={draft.time} onChange={(v) => setDraft({ ...draft, time: v })} />
          <div className="sheet__fields">
            {draft.mode === "一次" && (
              <label className="sheet__field">
                <span>签到日期</span>
                <input
                  className="num"
                  type="date"
                  value={draft.date}
                  min={todayISO()}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                  aria-label="签到日期"
                />
              </label>
            )}
            <label className="sheet__field">
              <span>备注</span>
              <input
                value={draft.remark}
                maxLength={64}
                onChange={(e) => setDraft({ ...draft, remark: e.target.value })}
                placeholder="选填，如：周五晚自习"
                aria-label="备注"
              />
            </label>
          </div>

          <div className="sheet__seg">
            {["每天", "一次"].map((m) => (
              <button
                key={m}
                className="sheet__segbtn"
                data-on={draft.mode === m}
                onClick={() => setDraft({ ...draft, mode: m })}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="sheet__label">签到位置</div>
          {locations.length === 0 && (
            <div className="sheet__hint">
              还没有位置，去「位置库」添加后再创建任务
              <button className="sheet__link" onClick={() => { setCreating(false); go("locations"); }}>
                去添加 ›
              </button>
            </div>
          )}
          {locations.map((l) => (
            <div
              key={l.id}
              className="sheet__row"
              data-active={(draft.locId ?? defaultLocation?.id) === l.id}
              onClick={() => setDraft({ ...draft, locId: l.id })}
            >
              {l.name}
              <small>{l.is_default ? "默认" : `${l.lat}, ${l.lng}`}</small>
            </div>
          ))}

          <div className="sheet__actions">
            <button className="sheet__btn" onClick={() => setCreating(false)}>
              取消
            </button>
            <button
              className="sheet__btn sheet__btn--primary"
              data-busy={busy?.schedule ? "true" : undefined}
              onClick={handleCreate}
            >
              创建
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
