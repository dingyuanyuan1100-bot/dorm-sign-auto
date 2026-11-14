import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../state";
import { LoginBlob, LogoMark, CheckTick } from "../ui/Icons";
import Recover from "./Recover";
import dogUrl from "../assets/dog.webp";

// 找回流程退场时长：与 .recover[data-leaving] / .login__fg 的过渡保持一致
const LEAVE_MS = 200;

export default function Login({ onLogin }) {
  const { login, register, pushToast } = useApp();
  const [screen, setScreen] = useState("form"); // form | recover
  const [leaving, setLeaving] = useState(false); // 找回流程正在退场
  const [mode, setMode] = useState("login"); // login | register
  const [username, setUsername] = useState("");
  const [pwd, setPwd] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [hint, setHint] = useState("");

  const leaveTimer = useRef(null);

  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  const fail = (msg) => {
    setHint(msg);
    setShake(true);
    setTimeout(() => setShake(false), 460);
    pushToast(msg, "err");
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    const u = username.trim();
    if (!/^[A-Za-z0-9_]{3,32}$/.test(u)) return fail("账号需为 3-32 位字母、数字或下划线");
    if (pwd.length < 6) return fail("密码至少 6 位");
    setHint("");
    setBusy(true);
    try {
      if (mode === "register") {
        await register(u, pwd);
        pushToast("注册成功，已自动登录");
      } else {
        await login(u, pwd);
        pushToast("登录成功，欢迎回来");
      }
      onLogin?.();
    } catch (err) {
      fail(err.message || "登录失败");
    } finally {
      setBusy(false);
    }
  };

  const openRecover = () => {
    if (screen === "recover") return;
    setHint("");
    setScreen("recover");
  };

  /** 先让找回流程淡出、登录内容同步淡入，再卸载 —— 两边同一段过渡，不跳帧 */
  const closeRecover = useCallback((after) => {
    clearTimeout(leaveTimer.current);
    setLeaving(true);
    after?.();
    leaveTimer.current = setTimeout(() => {
      setLeaving(false);
      setScreen("form");
    }, LEAVE_MS);
  }, []);

  const isLogin = mode === "login";
  const inRecover = screen === "recover";
  const fgHidden = inRecover && !leaving;

  return (
    <div className="login">
      <i className="login__blob">
        <LoginBlob />
      </i>

      {/* 登录内容常驻：进找回流程时只淡出不下树，回来时原位淡入，避免硬切 */}
      <div className="login__fg" data-hidden={fgHidden} aria-hidden={inRecover}>
        <div className="login__status" aria-hidden="true" />

        <i className="login__indicator" />

        <div className="login__logo">
          <LogoMark />
        </div>

        <h1 className="t dis login__title">
          <span>晚寝签到</span>
        </h1>

        <form className="login__card" data-shake={shake} onSubmit={submit}>
          <label className="t cn login__label" style={{ top: 24 }} htmlFor="lg-user">
            账号
          </label>
          <div className="login__field" style={{ top: 44 }}>
            <input
              id="lg-user"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="3-32 位字母 / 数字"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              aria-label="账号"
            />
          </div>

          <label className="t cn login__label" style={{ top: 102 }} htmlFor="lg-pwd">
            密码
          </label>
          <div className="login__field" style={{ top: 122 }}>
            <input
              id="lg-pwd"
              className="login__mask"
              type="text"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              placeholder="至少 6 位"
              autoComplete={isLogin ? "current-password" : "new-password"}
              aria-label="密码"
            />
          </div>

          <button
            type="button"
            className="login__check"
            data-on={remember}
            onClick={() => setRemember((v) => !v)}
            aria-label="记住此设备"
            aria-pressed={remember}
          >
            {remember && <CheckTick />}
          </button>
          <span className="t cn login__remember">
            {isLogin ? "记住此设备" : "注册后自动登录"}
          </span>

          {isLogin && (
            <button
              type="button"
              className="t cn r login__forgot"
              onClick={openRecover}
            >
              忘记密码？
            </button>
          )}

          <button className="login__submit" type="submit" data-busy={busy}>
            {busy ? <span className="spinner" /> : isLogin ? "登录" : "注册"}
          </button>

          <button
            type="button"
            className="login__alt"
            onClick={() => {
              setMode(isLogin ? "register" : "login");
              setHint("");
            }}
          >
            {isLogin ? "立即注册" : "已有账号？去登录"}
          </button>
        </form>

        {hint && <div className="login__hint">{hint}</div>}

        {/* 设计稿右上角的小狗：压在表单卡顶边上，纯装饰 */}
        <img className="login__dog" src={dogUrl} alt="" aria-hidden="true" draggable="false" />
      </div>

      {inRecover && (
        <Recover
          leaving={leaving}
          onBack={() => closeRecover()}
          onDone={() =>
            closeRecover(() => {
              setMode("login");
              setHint("");
              setPwd("");
            })
          }
        />
      )}
    </div>
  );
}
