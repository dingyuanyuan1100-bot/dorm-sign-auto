import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state";
import { useBackClose } from "../ui/back";
import { CheckTick } from "../ui/Icons";
import { tap, step as hapticStep, err as hapticErr, ok as hapticOk } from "../haptic";
import resetDogUrl from "../assets/reset-dog.webp";

const TITLES = ["验证身份", "选择账号", "设置新密码", "重置成功"];
const STEPS = [
  "步骤 1 / 3 · 验证账号归属",
  "步骤 2 / 3 · 选择要重置的账号",
  "步骤 3 / 3 · 设置新密码",
];
const LEVELS = ["太短", "偏弱", "中等", "较强"];

function EyeIcon({ open }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="10" cy="10" r="2.2" fill="currentColor" />
      {!open && (
        <path d="M4 4l12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      )}
    </svg>
  );
}

function strengthOf(pwd) {
  if (!pwd) return 0;
  let lv = 1;
  if (pwd.length >= 8) lv += 1;
  if (/[A-Za-z]/.test(pwd) && /[0-9]/.test(pwd)) lv += 1;
  return Math.min(3, lv);
}

export default function Recover({ onBack, onDone, leaving = false }) {
  const { recoverVerify, recoverReset } = useApp();

  const [stepNo, setStepNo] = useState(1);
  const [dir, setDir] = useState(1); // 1 前进 / -1 后退，决定转场方向
  // 步骤切换计数：只有真的换步骤才 +1。
  // 不能在渲染时读 mounted ref 决定是否播步入场 —— 那样任何一次无关的
  // re-render（比如后台自动检查更新改了 state）都会把 data-first 从 true 翻成 false，
  // 让入场动画重新播一遍，页面就会「闪一下」。
  const [stepSeq, setStepSeq] = useState(0);
  const [sid, setSid] = useState("");
  const [dormPwd, setDormPwd] = useState("");
  const [showDorm, setShowDorm] = useState(false);

  const [accounts, setAccounts] = useState([]);
  const [pickedId, setPickedId] = useState(null);
  const [ticket, setTicket] = useState("");

  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showNew, setShowNew] = useState(false);

  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");
  const [hintSeq, setHintSeq] = useState(0);
  const [errField, setErrField] = useState(null);
  const [shake, setShake] = useState(false);
  const [doneName, setDoneName] = useState("");

  const shakeTimer = useRef(null);
  const sidRef = useRef(null);
  const dormRef = useRef(null);
  const pwdRef = useRef(null);
  const confirmRef = useRef(null);

  useEffect(() => () => clearTimeout(shakeTimer.current), []);

  const lv = useMemo(() => strengthOf(newPwd), [newPwd]);
  const rule1 = newPwd.length >= 8;
  const rule2 = /[A-Za-z]/.test(newPwd) && /[0-9]/.test(newPwd);
  const rule3 = newPwd.length > 0 && newPwd !== dormPwd;
  const picked = accounts.find((a) => a.id === pickedId) || null;
  const allRulesOk = rule1 && rule2 && rule3;

  /** 统一报错：提示文案 + 字段标红 + 卡片抖动 + 触感，四件事绑在一起 */
  const fail = (msg, field = null) => {
    setHint(msg);
    setHintSeq((n) => n + 1);
    setErrField(field);
    setShake(true);
    clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => setShake(false), 460);
    hapticErr();
  };

  const go = (nextStep) => {
    setDir(nextStep > stepNo ? 1 : -1);
    setStepSeq((n) => n + 1);
    setStepNo(nextStep);
  };

  const back = () => {
    if (busy) return;
    setHint("");
    setErrField(null);
    if (stepNo === 1 || stepNo === 4) return onBack?.();
    setDir(-1);
    setStepSeq((n) => n + 1);
    setStepNo(stepNo - 1);
  };

  // 安卓返回键 / 返回手势：先退到上一步，第 1 步才退回登录。
  // 之前这里没挂号，系统返回被 App 当成「离开找回流程」，三屏全都直接弹回登录页。
  useBackClose(true, back);

  /** 用户一开始改，就把上一次的错误收掉 —— 不做「红着不走」的死状态 */
  const touch = (field = null) => {
    if (hint) setHint("");
    if (field ? errField === field : errField) setErrField(null);
  };

  const submitVerify = async () => {
    if (busy) return;
    const s = sid.trim();
    if (!/^[A-Za-z0-9]{4,32}$/.test(s)) return fail("学号需为 4-32 位字母或数字", "sid");
    if (dormPwd.length < 6) return fail("请输入晚寝签到密码", "dorm");
    setHint("");
    setErrField(null);
    setBusy(true);
    try {
      const data = await recoverVerify(s, dormPwd);
      const list = data?.accounts ?? [];
      if (!list.length) return fail("该学号下没有可重置的账号");
      setAccounts(list);
      setTicket(data?.ticket ?? "");
      setPickedId(list[0].id);
      hapticStep();
      go(2);
    } catch (e) {
      fail(e?.message || "验证失败，请稍后重试", "both");
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async () => {
    if (busy) return;
    if (newPwd.length < 6) return fail("新密码至少 6 位", "pwd");
    if (newPwd !== confirm) return fail("两次输入的新密码不一致", "confirm");
    if (newPwd === dormPwd) return fail("新密码不能与晚寝密码相同", "pwd");
    setHint("");
    setErrField(null);
    setBusy(true);
    try {
      await recoverReset(ticket, pickedId, newPwd);
      setDoneName(picked?.username ?? "");
      hapticOk();
      go(4);
    } catch (e) {
      fail(e?.message || "重置失败，请稍后重试", "pwd");
    } finally {
      setBusy(false);
    }
  };

  const enter = (fn) => (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    fn();
  };

  return (
    <div className="recover" data-leaving={leaving} data-step={stepNo}>
      <button className="recover__back" type="button" onClick={back} aria-label="返回">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M14.5 5.5 8 12l6.5 6.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <h2 className="recover__title" key={`t-${stepNo}`}>
        {TITLES[stepNo - 1]}
      </h2>

      {/* 重置成功：设计稿 73:65 是一整屏绿底 + 两只光斑 + 竖大拇指的小狗，
          没有返回键也不写标题，所以这一屏单独铺一层背景 */}
      {stepNo === 4 && (
        <div className="reset" aria-hidden="true">
          <span className="reset__blob reset__blob--a" />
          <span className="reset__blob reset__blob--b" />
        </div>
      )}

      <section className="recover__card" data-step={stepNo} data-shake={shake}>
        {/* 首屏由整页转场负责，避免与整屏位移叠成斜向移动 */}
        <div
          className="recover__body"
          key={`s-${stepNo}`}
          data-dir={dir}
          data-first={stepSeq === 0}
        >
          {stepNo < 4 && (
            <>
              <div className="recover__track" aria-hidden="true">
                {[1, 2, 3].map((i) => (
                  <i key={i} data-on={stepNo >= i} />
                ))}
              </div>
              <p className="recover__steptext">{STEPS[stepNo - 1]}</p>
            </>
          )}

          {stepNo === 1 && (
            <>
              <label className="recover__label" htmlFor="rc-sid">
                学号
              </label>
              <div className="recover__field" data-err={errField === "sid" || errField === "both"}>
                <input
                  id="rc-sid"
                  ref={sidRef}
                  value={sid}
                  onChange={(e) => {
                    touch("sid");
                    setSid(e.target.value.replace(/[^A-Za-z0-9]/g, ""));
                  }}
                  onKeyDown={enter(() => dormRef.current?.focus())}
                  placeholder="与晚寝签到一致的学号"
                  autoComplete="username"
                  autoCapitalize="none"
                  enterKeyHint="next"
                  inputMode="text"
                  spellCheck={false}
                  aria-label="学号"
                  aria-invalid={errField === "sid" || errField === "both"}
                />
              </div>

              <label className="recover__label" htmlFor="rc-dpwd">
                晚寝签到密码
              </label>
              <div className="recover__field" data-err={errField === "dorm" || errField === "both"}>
                <input
                  id="rc-dpwd"
                  ref={dormRef}
                  type={showDorm ? "text" : "password"}
                  value={dormPwd}
                  onChange={(e) => {
                    touch("dorm");
                    setDormPwd(e.target.value);
                  }}
                  onKeyDown={enter(submitVerify)}
                  placeholder="晚寝系统的登录密码"
                  autoComplete="current-password"
                  enterKeyHint="done"
                  aria-label="晚寝签到密码"
                  aria-invalid={errField === "dorm" || errField === "both"}
                />
                <button
                  type="button"
                  className="recover__eye"
                  onClick={() => setShowDorm((v) => !v)}
                  aria-label={showDorm ? "隐藏密码" : "显示密码"}
                  aria-pressed={showDorm}
                >
                  <EyeIcon key={showDorm ? "on" : "off"} open={showDorm} />
                </button>
              </div>

              <button
                className="recover__submit"
                type="button"
                onClick={submitVerify}
                data-busy={busy}
                disabled={busy}
                aria-busy={busy}
              >
                {busy ? (
                  <>
                    <span className="spinner" aria-hidden />
                    <span>验证中…</span>
                  </>
                ) : (
                  "下一步"
                )}
              </button>
            </>
          )}

          {stepNo === 2 && (
            <>
              <div className="recover__accounts" role="radiogroup" aria-label="选择账号">
                {accounts.map((a, i) => (
                  <button
                    key={a.id}
                    type="button"
                    className="recover__acc"
                    data-on={pickedId === a.id}
                    onClick={() => {
                      if (pickedId === a.id) return;
                      touch();
                      setPickedId(a.id);
                      tap();
                    }}
                    role="radio"
                    aria-checked={pickedId === a.id}
                  >
                    <span className="recover__acc-no">{i + 1}</span>
                    <span className="recover__acc-main">
                      <em>{a.nickname || a.username}</em>
                      <i>{a.username}</i>
                    </span>
                    <span className="recover__acc-tick" aria-hidden="true">
                      {pickedId === a.id && <CheckTick />}
                    </span>
                  </button>
                ))}
              </div>

              <button
                className="recover__submit"
                type="button"
                onClick={() => {
                  if (!picked) return fail("请先选择一个账号");
                  setHint("");
                  setErrField(null);
                  hapticStep();
                  go(3);
                }}
              >
                下一步
              </button>
            </>
          )}

          {stepNo === 3 && (
            <>
              <label className="recover__label" htmlFor="rc-pwd">
                新密码
              </label>
              <div className="recover__field" data-err={errField === "pwd"}>
                <input
                  id="rc-pwd"
                  ref={pwdRef}
                  type={showNew ? "text" : "password"}
                  value={newPwd}
                  onChange={(e) => {
                    touch("pwd");
                    setNewPwd(e.target.value);
                  }}
                  onKeyDown={enter(() => confirmRef.current?.focus())}
                  placeholder="至少 8 位，含字母与数字"
                  autoComplete="new-password"
                  enterKeyHint="next"
                  aria-label="新密码"
                  aria-invalid={errField === "pwd"}
                />
                <button
                  type="button"
                  className="recover__eye"
                  onClick={() => setShowNew((v) => !v)}
                  aria-label={showNew ? "隐藏密码" : "显示密码"}
                  aria-pressed={showNew}
                >
                  <EyeIcon key={showNew ? "on" : "off"} open={showNew} />
                </button>
              </div>

              <label className="recover__label" htmlFor="rc-pwd2">
                确认新密码
              </label>
              <div className="recover__field" data-err={errField === "confirm"}>
                <input
                  id="rc-pwd2"
                  ref={confirmRef}
                  type={showNew ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => {
                    touch("confirm");
                    setConfirm(e.target.value);
                  }}
                  onKeyDown={enter(submitReset)}
                  placeholder="再输入一次"
                  autoComplete="new-password"
                  enterKeyHint="done"
                  aria-label="确认新密码"
                  aria-invalid={errField === "confirm"}
                />
              </div>

              <div className="recover__meter" data-lv={lv} aria-hidden="true">
                {[1, 2, 3].map((i) => (
                  <i key={i} data-on={lv >= i} />
                ))}
              </div>
              <p className="recover__strength">
                密码强度：
                <b key={lv} data-lv={lv}>
                  {newPwd ? LEVELS[lv] : "—"}
                </b>
              </p>

              <ul className="recover__rules">
                <li data-ok={rule1}>至少 8 位字符</li>
                <li data-ok={rule2}>同时包含字母与数字</li>
                <li data-ok={rule3}>不能与晚寝密码相同</li>
              </ul>

              <button
                className="recover__submit"
                type="button"
                onClick={submitReset}
                data-busy={busy}
                data-ready={allRulesOk}
                disabled={busy}
                aria-busy={busy}
              >
                {busy ? (
                  <>
                    <span className="spinner" aria-hidden />
                    <span>重置中…</span>
                  </>
                ) : (
                  "完成重置"
                )}
              </button>
            </>
          )}

          {stepNo === 4 && (
            <>
              <h3 className="reset__title">密码已重置</h3>
              <button className="reset__submit" type="button" onClick={onDone}>
                去登录
              </button>
            </>
          )}

          {hint && stepNo < 4 && (
            <p className="recover__hint" role="alert" aria-live="assertive" key={hintSeq}>
              {hint}
            </p>
          )}
        </div>
      </section>

      {/* 小狗压在卡片上沿：必须排在卡片之后，否则会被白卡盖住下半身 */}
      {stepNo === 4 && (
        <img className="reset__dog" src={resetDogUrl} alt="" draggable="false" aria-hidden="true" />
      )}
    </div>
  );
}
