import { useState } from "react";
import { useApp } from "../state";
import { Sheet } from "../ui/Chrome";
import { BindForm } from "../ui/DormBind";
import { PinAvatarLg } from "../ui/Icons";
import { APP_VERSION } from "../version";

// 几何取自设计稿 26:281 列表卡：行 22 / 86 / 153 / 220 / 283，分割线 66 / 132 / 195 / 264。
// 设计稿把「意见反馈」插在第 2 行（70:322 行 5 @86），并在 264 留了第四条分割线、
// 卡高 342——那个位置正好是第 5 行，说明「关于」只是被临时删掉，几何还留着，所以照原样补齐。
const ROWS = [
  { key: "dorm", label: "晚寝账号", top: 22, valueTop: 24 },
  { key: "feedback", label: "意见反馈", top: 86, valueTop: 86 },
  { key: "security", label: "安全与隐私", top: 153, valueTop: 153 },
  { key: "logs", label: "日志", top: 220, valueTop: 224 },
  { key: "about", label: "关于", top: 283, valueTop: 285 },
];

const DIVIDERS = [66, 132, 195, 264];

export default function Me({ go, onLogout, onFeedback }) {
  const { session, dorm, bindDorm, unbindDorm, pushToast, refresh, checkUpdate, checkingUpdate } = useApp();
  const [sheet, setSheet] = useState(null);
  const [bind, setBind] = useState({ sid: session?.studentId || "", pwd: "", nick: "" });
  const [busy, setBusy] = useState(false);

  const bound = !!dorm;
  const sid = dorm?.student_id || "未绑定";

  const nick = (dorm?.nickname || "").trim();
  const displayName = nick || session?.username || "未登录";

  const values = {
    dorm: bound ? `${sid} ›` : "去绑定 ›",
    security: "›",
    logs: "›",
    feedback: "›",
    about: `v${APP_VERSION} ›`,
  };

  const handleBind = async () => {
    const s = bind.sid.trim();
    if (!/^[A-Za-z0-9]{4,32}$/.test(s)) return pushToast("学号需为 4-32 位字母数字", "err");
    if (bind.pwd.length < 6) return pushToast("晚寝密码至少 6 位", "err");
    setBusy(true);
    try {
      await bindDorm(s, bind.pwd, bind.nick.trim());
      setSheet(null);
      setBind({ sid: s, pwd: "", nick: "" });
      pushToast("晚寝账号已绑定");
    } catch (e) {
      pushToast(e.message || "绑定失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const handleUnbind = async () => {
    setBusy(true);
    try {
      await unbindDorm();
      setSheet(null);
      pushToast("已解绑晚寝账号", "err");
    } catch (e) {
      pushToast(e.message || "解绑失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const onRow = (key) => {
    if (key === "logs") return go("logs");
    if (key === "feedback") return onFeedback?.();
    setSheet(key);
  };

  return (
    <>
      <h1 className="t dis page-title">我的</h1>

      <div className="account">
        <span className="account__avatar">
          <PinAvatarLg />
        </span>
        <span className={`t account__name ${nick ? "cn" : "num"}`}>{displayName}</span>
        <span className="t num account__sid">{sid}</span>
        <span className="account__badge" data-on={bound}>
          {bound ? "已绑定" : "未绑定"}
        </span>
      </div>

      <div className="listcard" data-rows={ROWS.length}>
        {ROWS.map((r) => (
          <div key={r.key} className="listrow" data-key={r.key}>
            <span className="t cn listrow__label" style={{ top: r.top }}>
              {r.label}
            </span>
            <button className="t cn r listrow__value" style={{ top: r.valueTop }} onClick={() => onRow(r.key)}>
              {values[r.key]}
            </button>
          </div>
        ))}
        {DIVIDERS.map((t) => (
          <i key={t} className="listcard__div" style={{ top: t }} />
        ))}
      </div>

      <button className="logout" onClick={() => setSheet("logout")}>
        退出登录
      </button>

      {sheet === "logout" && (
        <Sheet title="退出登录" desc="退出后需重新输入账号密码" onClose={() => setSheet(null)}>
          <div className="sheet__hint">
            退出后本机不再保留登录态，已创建的签到任务仍会在服务端按计划执行。
          </div>
          <div className="sheet__actions">
            <button className="sheet__btn" onClick={() => setSheet(null)}>
              取消
            </button>
            <button
              className="sheet__btn sheet__btn--danger"
              onClick={async () => {
                setSheet(null);
                await onLogout?.();
              }}
            >
              确认退出
            </button>
          </div>
        </Sheet>
      )}

      {sheet === "dorm" && (
        <Sheet
          title={bound ? "晚寝账号已绑定" : "绑定晚寝账号"}
          onClose={() => setSheet(null)}
        >
          {bound ? (
            <>
              <div className="detail">
                <div className="detail__row">
                  <span>学号</span>
                  <b>{dorm?.student_id}</b>
                </div>
                <div className="detail__row">
                  <span>昵称</span>
                  <b>{dorm?.nickname || "未设置"}</b>
                </div>
                <div className="detail__row">
                  <span>绑定时间</span>
                  <b>{dorm?.created_at || "—"}</b>
                </div>
              </div>
              <div className="sheet__actions">
                <button className="sheet__btn sheet__btn--danger" onClick={handleUnbind} disabled={busy}>
                  解绑
                </button>
                <button
                  className="sheet__btn sheet__btn--primary"
                  onClick={() => {
                    setBind({ sid: session?.studentId || "", pwd: "", nick: "" });
                    setSheet("dormRebind");
                  }}
                >
                  重新绑定
                </button>
              </div>
            </>
          ) : (
            <BindForm bind={bind} setBind={setBind} busy={busy} onSubmit={handleBind} onCancel={() => setSheet(null)} />
          )}
        </Sheet>
      )}

      {sheet === "dormRebind" && (
        <Sheet title="重新绑定晚寝账号" onClose={() => setSheet(null)}>
          <BindForm bind={bind} setBind={setBind} busy={busy} onSubmit={handleBind} onCancel={() => setSheet(null)} />
        </Sheet>
      )}

      {sheet === "security" && (
        <Sheet title="安全与隐私" desc="本地与服务端的凭据处理方式" onClose={() => setSheet(null)}>
          <div className="detail">
            <div className="detail__row">
              <span>登录态</span>
              <b>JWT，30 天有效</b>
            </div>
            <div className="detail__row">
              <span>密码存储</span>
              <b>Argon2id 哈希</b>
            </div>
            <div className="detail__row">
              <span>晚寝密码</span>
              <b>AES-256-GCM 加密</b>
            </div>
          </div>
          <div className="sheet__actions">
            <button className="sheet__btn" onClick={() => setSheet(null)}>
              关闭
            </button>
            <button
              className="sheet__btn sheet__btn--primary"
              onClick={() => {
                refresh("all");
                pushToast("已重新同步");
              }}
            >
              重新同步数据
            </button>
          </div>
        </Sheet>
      )}

      {sheet === "about" && (
        <Sheet title="关于" desc="晚寝自动签到 · 客户端" onClose={() => setSheet(null)}>
          <div className="detail">
            <div className="detail__row">
              <span>版本</span>
              <b>v{APP_VERSION}</b>
            </div>
            <div className="detail__row">
              <span>调度器</span>
              <b>由服务端按秒扫描执行</b>
            </div>
            <div className="detail__row">
              <span>提示</span>
              <b>签到结果以学校系统为准</b>
            </div>
          </div>
          <div className="sheet__actions">
            <button
              className="sheet__btn"
              disabled={checkingUpdate}
              onClick={async () => {

                const latest = await checkUpdate({ auto: false });
                if (latest) setSheet(null);
              }}
            >
              {checkingUpdate ? "检查中…" : "检查更新"}
            </button>
            <button className="sheet__btn sheet__btn--primary" onClick={() => setSheet(null)}>
              知道了
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
