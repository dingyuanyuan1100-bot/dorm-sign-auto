import { useCallback, useEffect, useRef, useState } from "react";
import { feedbackApi } from "../api";
import { err as buzzErr, ok as buzzOk, tap as buzzTap } from "../haptic";
import { useApp } from "../state";
import { useBackClose } from "../ui/back";
import { CheckTick } from "../ui/Icons";
import ill01 from "../assets/ill01.webp";
import ill02 from "../assets/ill02.webp";
import ill03 from "../assets/ill03.webp";

const TYPES = ["功能异常", "体验建议"];
const MAX_SHOTS = 3;
// 之前压到 720px / q0.72，手机截图（1080×2400）缩成 324×720，
// 点开原图整屏看就是一坨糊的。现在留 1600 长边 / q0.86：
// 一张 1080×2400 截图约 200~300 KB，base64 后 3 张 ≈ 1.2 MB，
// 后端单次上限 4,000,000 字符、nginx 10m，都还有余量。
const MAX_EDGE = 1600;
const SHOT_QUALITY = 0.86;
const SHOT_BUDGET = 3_600_000; // 3 张 base64 字符数的软上限，超了自动降一档

/** 选图后压到 1600px 长边的 JPEG，既保住可读性又不把原图几 MB 塞进请求体 */
function compress(file, maxEdge = MAX_EDGE, quality = SHOT_QUALITY) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("图片无法解析"));
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const pad2 = (n) => String(n).padStart(2, "0");

/** 学号做遮挡：2023****21，设计稿 73:414 的写法 */
function maskId(v) {
  if (!v) return "—";
  if (v.length <= 6) return v;
  return `${v.slice(0, 4)}****${v.slice(-2)}`;
}

function fmtStamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso.replace(/-/g, "/"));
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (sameDay) return `今天 ${hm}`;
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${hm}`;
}

export default function Feedback({ onClose }) {
  const { pushToast, session } = useApp();
  const [step, setStep] = useState("form"); // form | done | records | detail
  const [dir, setDir] = useState(1);
  const [type, setType] = useState(TYPES[0]);
  const [content, setContent] = useState("");
  const [shots, setShots] = useState([]);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState({ field: null, msg: "" });
  const [result, setResult] = useState(null);
  const [records, setRecords] = useState(null);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [viewer, setViewer] = useState(null); // 点开原图
  const [tick, setTick] = useState(0); // 触发抖动动画的计数

  const fileRef = useRef(null);
  const areaRef = useRef(null);
  const shakeTimer = useRef(null);

  const go = useCallback((next, back = false) => {
    setDir(back ? -1 : 1);
    setStep(next);
  }, []);

  useBackClose(true, () => {
    if (step === "form") return onClose?.();
    if (step === "detail") return go("records", true);
    return go("form", true);
  });

  useEffect(() => () => clearTimeout(shakeTimer.current), []);

  // 表单内的校验只在卡片里说一次：红边 + 抖动 + 触感 + 卡片内提示，四条反馈通道已经够。
  // 原来这里还会再弹一次 Toast，而 Toast 固定在 bottom:112，正好压住提交按钮，
  // 等于在最需要重试的时候把主按钮盖住了，所以不再走全局 Toast。
  const fail = useCallback((field, msg) => {
    setHint({ field, msg });
    setTick((t) => t + 1);
    buzzErr();
    clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => setHint({ field: null, msg: "" }), 2600);
  }, []);

  const touch = () => hint.msg && setHint({ field: null, msg: "" });

  const pick = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    const room = MAX_SHOTS - shots.length;
    if (room <= 0) return fail("shots", `最多只能上传 ${MAX_SHOTS} 张`);
    const take = files.slice(0, room);
    try {
      let next = await Promise.all(take.map((f) => compress(f)));
      const merged = [...shots, ...next].slice(0, MAX_SHOTS);
      // 长截屏 / 折叠屏原图会更大，超预算就整体降一档，避免后端 4M 字符上限被打回
      if (merged.reduce((s, v) => s + v.length, 0) > SHOT_BUDGET) {
        next = await Promise.all(take.map((f) => compress(f, 1200, 0.78)));
      }
      setShots((prev) => [...prev, ...next].slice(0, MAX_SHOTS));
      touch();
      buzzTap();
      if (files.length > room) pushToast(`已选前 ${room} 张，最多 ${MAX_SHOTS} 张`, "err");
    } catch (err) {
      fail("shots", err.message || "图片处理失败");
    }
  };

  const submit = async () => {
    if (busy) return;
    const text = content.trim();
    if (text.length < 5) return fail("content", "描述太短，至少 5 个字");
    setBusy(true);
    try {
      const data = await feedbackApi.submit({ type, content: text, images: shots });
      setResult(data);
      buzzOk();
      go("done");
    } catch (e) {
      fail("content", e.message || "提交失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  const openRecords = async () => {
    go("records");
    setLoadingRecords(true);
    try {
      const data = await feedbackApi.list();
      setRecords(data);
    } catch (e) {
      pushToast(e.message || "记录加载失败", "err");
      setRecords({ total: 0, pending: 0, items: [] });
    } finally {
      setLoadingRecords(false);
    }
  };

  const openDetail = async (id) => {
    go("detail");
    setDetail(null);
    setLoadingDetail(true);
    try {
      const data = await feedbackApi.detail(id);
      setDetail(data);
    } catch (e) {
      pushToast(e.message || "详情加载失败", "err");
      go("records", true);
    } finally {
      setLoadingDetail(false);
    }
  };

  const areaShake = hint.field === "shots" ? tick : 0;
  const cardShake = hint.field === "content" ? tick : 0;

  /* ---------- 表单 ---------- */
  const form = (
    <>
      <h1 className="t dis fb__title">意见反馈</h1>
      <button className="t fb__record" type="button" onClick={openRecords}>
        记录 ›
      </button>
      <img className="fb__ill fb__ill--l" src={ill02} alt="" aria-hidden="true" draggable="false" />
      <img className="fb__ill fb__ill--r" src={ill03} alt="" aria-hidden="true" draggable="false" />

      <section className="fb__card" data-shake={cardShake}>
        <img className="fb__dog" src={ill01} alt="" aria-hidden="true" draggable="false" />

        <div className="fb__upload" ref={areaRef} data-shake={areaShake} data-err={hint.field === "shots"}>
          <span className="t fb__optional">选填</span>
          <div className="fb__shots">
            {shots.map((src, i) => (
              <span className="fb__shot" key={i}>
                <img src={src} alt={`截图 ${i + 1}`} />
                <button
                  type="button"
                  className="fb__shot-del"
                  aria-label={`移除第 ${i + 1} 张截图`}
                  onClick={() => {
                    setShots((prev) => prev.filter((_, k) => k !== i));
                    buzzTap();
                  }}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                    <path d="M1 1l6 6M7 1L1 7" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </span>
            ))}
            {shots.length < MAX_SHOTS && (
              <button
                type="button"
                className="fb__add"
                onClick={() => fileRef.current?.click()}
                aria-label="添加截图"
              >
                <span className="fb__plus" aria-hidden="true">
                  +
                </span>
                <span className="fb__addtext">添加</span>
              </button>
            )}
          </div>
          <p className="t fb__hint">最多 {MAX_SHOTS} 张，支持 JPG / PNG</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            onChange={pick}
          />
        </div>

        <p className="t fb__label" style={{ top: 183 }}>
          反馈类型
        </p>
        <div className="fb__types" role="radiogroup" aria-label="反馈类型">
          {TYPES.map((t, i) => (
            <button
              key={t}
              type="button"
              className="t fb__type"
              style={{ left: i === 0 ? 13 : 128 }}
              data-on={type === t}
              role="radio"
              aria-checked={type === t}
              onClick={() => {
                setType(t);
                buzzTap();
              }}
            >
              {t}
            </button>
          ))}
        </div>

        <p className="t fb__label" style={{ top: 263 }}>
          问题描述
        </p>
        <div className="fb__area" data-err={hint.field === "content"}>
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              touch();
            }}
            maxLength={2000}
            placeholder="请描述遇到的问题，或希望改进的地方…"
            aria-label="问题描述"
          />
          <span className="t fb__count">{content.length}/2000</span>
        </div>
        {hint.msg && (
          <p className="fb__err" role="alert" aria-live="polite">
            <i className="fb__err-dot" aria-hidden="true">
              !
            </i>
            {hint.msg}
          </p>
        )}
      </section>

      <button className="fb__submit" type="button" onClick={submit} data-busy={busy} disabled={busy} aria-busy={busy}>
        {busy ? (
          <>
            <span className="spinner fb__spinner" />
            提交中…
          </>
        ) : (
          "提交反馈"
        )}
      </button>
    </>
  );

  /* ---------- 提交成功 ---------- */
  const done = (
    <>
      <button className="t fb__close" type="button" onClick={onClose}>
        关闭
      </button>
      <div className="fb__badge" aria-hidden="true">
        <span className="fb__badge-inner">
          <CheckTick />
        </span>
      </div>
      <h1 className="t dis fb__done-title">反馈已提交</h1>
      <p className="t fb__done-desc">我们会在 1-2 个工作日内回复。</p>

      <section className="fb__receipt">
        <span className="t fb__rlabel" style={{ top: 22 }}>
          反馈编号
        </span>
        <span className="t fb__rvalue" style={{ top: 22, left: 118 }}>
          {result?.code || "—"}
        </span>
        <span className="t fb__rlabel" style={{ top: 57 }}>
          反馈类型
        </span>
        <span className="t fb__rvalue" style={{ top: 57, left: 98 }}>
          {result?.type || "—"}
          {result?.image_count ? ` · 含 ${result.image_count} 张截图` : ""}
        </span>
        <span className="t fb__rlabel" style={{ top: 92 }}>
          提交时间
        </span>
        <span className="t fb__rvalue" style={{ top: 92, left: 118 }}>
          {fmtStamp(result?.created_at)}
        </span>
      </section>

      <button className="fb__submit" type="button" style={{ top: 576 }} onClick={openRecords}>
        查看反馈记录
      </button>
      <button className="fb__ghost" type="button" onClick={onClose}>
        返回首页
      </button>
    </>
  );

  /* ---------- 反馈记录 ---------- */
  const items = records?.items || [];
  const recordsView = (
    <>
      <button className="fb__back" type="button" onClick={() => go("form", true)} aria-label="返回">
        <svg width="9" height="16" viewBox="0 0 9 16" fill="none" aria-hidden="true">
          <path d="M7 1L1 8l6 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <h1 className="t dis fb__title" style={{ top: 92 }}>
        反馈记录
      </h1>
      <p className="t fb__stat">
        {records ? `共 ${records.total} 条 · ${records.pending} 条处理中` : loadingRecords ? "加载中…" : "共 0 条"}
      </p>

      {!loadingRecords && records && items.length === 0 && (
        <p className="t fb__empty">还没有反馈记录，遇到问题随时告诉我们。</p>
      )}

      <div className="fb__recs">
        {items.map((it) => {
          const replied = it.status === "replied";
          return (
            <button
              type="button"
              className="fb__rec"
              key={it.id}
              style={{ height: replied ? 156 : 116 }}
              onClick={() => openDetail(it.id)}
              aria-label={`查看 ${it.code} 详情`}
            >
              <span className="t fb__tag">{it.type}</span>
              <span className="t fb__status" data-on={replied}>
                {replied ? "已回复" : "处理中"}
              </span>
              <h2 className="t fb__rtitle">{it.content.split("\n")[0].slice(0, 18)}</h2>
              <p className="t fb__rmeta">
                {it.code} · {fmtStamp(it.created_at)}
              </p>
              {replied ? (
                <>
                  <i className="fb__divider" />
                  <span className="t fb__rreply-label">官方回复</span>
                  <p className="t fb__rreply">{it.reply}</p>
                </>
              ) : (
                <p className="t fb__rwait">预计 1 个工作日内回复</p>
              )}
            </button>
          );
        })}
      </div>
    </>
  );

  /* ---------- 反馈详情（设计稿 73:394） ---------- */
  const dt = detail;
  const answered = dt?.status === "replied";
  const attach = dt?.images || [];
  // 后端没有单独的标题字段，第一行当标题、其余行当正文。
  // 只有一行时（用户一般就是一段话）不能再把同一句话贴两遍 —— 直接当正文渲染。
  const lines = dt ? dt.content.split("\n").map((s) => s.trim()).filter(Boolean) : [];
  const hasTitle = lines.length > 1;
  const headLine = hasTitle ? lines[0] : "";
  const bodyText = hasTitle ? lines.slice(1).join("\n") : lines[0] || "";
  const hm = (iso) => {
    const d = iso ? new Date(iso.replace(/-/g, "/")) : null;
    return d && !Number.isNaN(d.getTime()) ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : "";
  };

  const detailView = (
    <>
      <button
        className="fb__back"
        type="button"
        style={{ top: 64 }}
        onClick={() => go("records", true)}
        aria-label="返回反馈记录"
      >
        <svg width="9" height="16" viewBox="0 0 9 16" fill="none" aria-hidden="true">
          <path d="M7 1L1 8l6 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <h1 className="t fbd__title">反馈详情</h1>

      {!dt && <p className="t fbd__loading">{loadingDetail ? "加载中…" : "没有找到这条反馈"}</p>}

      {dt && (
        <>
          <p className="t fbd__code">{dt.code}</p>
          <span className="fbd__pill" data-on={answered}>
            {answered ? "已回复" : "待处理"}
          </span>

          <section className="fbd__card fbd__card--meta">
            <span className="t fbd__label" style={{ left: 18, top: 16 }}>
              提交人
            </span>
            <span className="t fbd__value" style={{ left: 18, top: 30 }}>
              {session?.username || "—"}
            </span>
            <span className="t fbd__label" style={{ left: 196, top: 16 }}>
              学号
            </span>
            <span className="t fbd__value" style={{ left: 196, top: 30 }}>
              {maskId(session?.studentId)}
            </span>
            <span className="t fbd__label" style={{ left: 18, top: 62 }}>
              提交方式
            </span>
            <span className="t fbd__value" style={{ left: 18, top: 76 }}>
              App 内提交
            </span>
            <span className="t fbd__label" style={{ left: 196, top: 62 }}>
              提交时间
            </span>
            <span className="t fbd__value" style={{ left: 196, top: 76 }}>
              {fmtStamp(dt.created_at)}
            </span>
          </section>

          <section className="fbd__card fbd__card--body">
            <span className="fbd__tag">{dt.type}</span>
            {hasTitle ? (
              <>
                <h2 className="t fbd__ctitle">{headLine}</h2>
                <p className="t fbd__ctext">{bodyText}</p>
              </>
            ) : (
              <p className="t fbd__ctext fbd__ctext--lead">{bodyText}</p>
            )}
            {attach.length > 0 && (
              <>
                {attach.slice(0, 3).map((src, i) => (
                  <button
                    className="fbd__shot"
                    key={i}
                    type="button"
                    style={{ left: 18 + i * 64 }}
                    onClick={() => setViewer(src)}
                    aria-label={`查看截图 ${i + 1}`}
                  >
                    <img src={src} alt="" />
                  </button>
                ))}
                <span className="t fbd__shotnote" data-many={attach.length > 2}>
                  {attach.length > 2 ? "点击看原图" : `共 ${attach.length} 张 · 点击看原图`}
                </span>
              </>
            )}
            {attach.length === 0 && (
              <span className="t fbd__shotnote" style={{ left: 18, top: 132 }}>
                本次反馈没有上传截图
              </span>
            )}
          </section>

          <section className="fbd__card fbd__card--steps">
            <span className="t fbd__caption">处理进度</span>
            <i className="fbd__node" style={{ left: 62, top: 28 }} data-on="true">
              <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                <path d="M1 4.2 3.6 6.8 9 1.2" stroke="#1a1a1a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </i>
            <i className="fbd__line" style={{ left: 80, top: 36 }} />
            <i className="fbd__node" style={{ left: 180, top: 28 }} data-on={answered}>
              {answered && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4.2 3.6 6.8 9 1.2" stroke="#1a1a1a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </i>
            <i className="fbd__line" style={{ left: 198, top: 36 }} />
            <i className="fbd__node" style={{ left: 298, top: 28 }} data-on={answered}>
              {answered && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4.2 3.6 6.8 9 1.2" stroke="#1a1a1a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </i>
            <span className="t fbd__step" style={{ left: 18, top: 54 }}>
              {`已入库 ${hm(dt.created_at)}`}
            </span>
            <span className="t fbd__step" data-on={answered} style={{ left: 136, top: 54 }}>
              {answered ? "已接手" : "待接手"}
            </span>
            <span className="t fbd__step" data-on={answered} style={{ left: 254, top: 54 }}>
              {answered ? "已回复" : "待回复"}
            </span>
          </section>

          <section className="fbd__card fbd__card--reply">
            <span className="t fbd__caption-2">官方回复</span>
            {answered ? (
              <p className="t fbd__replytext">{dt.reply}</p>
            ) : (
              <p className="t fbd__replywait">宿管还没回复，预计 1 个工作日内处理</p>
            )}
            <span className="t fbd__replyat">{answered ? `回复于 ${fmtStamp(dt.replied_at)}` : "回复后可在反馈记录里查看"}</span>
          </section>

          <footer className="fbd__foot">
            <i className="fbd__footline" />
            <button className="fbd__btn" type="button" onClick={() => go("records", true)}>
              返回反馈记录
            </button>
            <button className="t fbd__more" type="button" onClick={() => go("form", true)}>
              再提一条反馈
            </button>
          </footer>
        </>
      )}

      {viewer && (
        <div className="fbd__viewer" onClick={() => setViewer(null)} role="dialog" aria-label="查看原图">
          <img src={viewer} alt="" />
        </div>
      )}
    </>
  );

  const body = step === "form" ? form : step === "done" ? done : step === "detail" ? detailView : recordsView;

  return (
    <div className="fb" data-step={step}>
      <div className="fb__body" key={step} data-dir={dir}>
        {body}
      </div>
    </div>
  );
}
