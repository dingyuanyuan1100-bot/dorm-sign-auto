import { useState } from "react";
import { useApp } from "../state";
import { Sheet } from "./Chrome";

export function BindForm({ bind, setBind, busy, onSubmit, onCancel }) {
  return (
    <>
      <div className="sheet__fields">
        <label className="sheet__field">
          <span>学号</span>
          <input
            className="num"
            value={bind.sid}
            maxLength={32}
            onChange={(e) => setBind({ ...bind, sid: e.target.value })}
            placeholder="4-32 位字母数字"
            inputMode="numeric"
            aria-label="学号"
          />
        </label>
        <label className="sheet__field">
          <span>晚寝密码</span>
          <input
            className="login__mask"
            type="text"
            value={bind.pwd}
            onChange={(e) => setBind({ ...bind, pwd: e.target.value })}
            placeholder="与学校系统一致"
            aria-label="晚寝密码"
          />
        </label>
        <label className="sheet__field">
          <span>昵称</span>
          <input
            value={bind.nick}
            maxLength={32}
            onChange={(e) => setBind({ ...bind, nick: e.target.value })}
            placeholder="选填"
            aria-label="昵称"
          />
        </label>
      </div>
      <div className="sheet__actions">
        <button className="sheet__btn" onClick={onCancel}>
          取消
        </button>
        <button className="sheet__btn sheet__btn--primary" onClick={onSubmit} disabled={busy}>
          {busy ? "校验中" : "绑定"}
        </button>
      </div>
    </>
  );
}

export function DormBindPrompt({ open, onClose }) {
  const { bindDorm, pushToast } = useApp();
  const [bind, setBind] = useState({ sid: "", pwd: "", nick: "" });
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async () => {
    const s = bind.sid.trim();
    if (!/^[A-Za-z0-9]{4,32}$/.test(s)) return pushToast("学号需为 4-32 位字母数字", "err");
    if (bind.pwd.length < 6) return pushToast("晚寝密码至少 6 位", "err");
    setBusy(true);
    try {
      await bindDorm(s, bind.pwd, bind.nick.trim());
      setBind({ sid: "", pwd: "", nick: "" });
      onClose?.();
      pushToast("晚寝账号已绑定，可以创建签到任务了");
    } catch (e) {
      pushToast(e.message || "绑定失败", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="绑定晚寝账号" onClose={onClose}>
      <BindForm
        bind={bind}
        setBind={setBind}
        busy={busy}
        onSubmit={submit}
        onCancel={onClose}
      />
    </Sheet>
  );
}
