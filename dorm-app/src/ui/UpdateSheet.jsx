import { useState } from "react";
import { Sheet } from "./Chrome";
import { openDownload } from "../update";

export function UpdateSheet({ update, checking, onClose }) {
  const [opening, setOpening] = useState(false);
  const latest = update?.latest;
  const current = update?.current;

  if (!latest) return null;

  const force = !!latest.force;

  const go = () => {
    if (opening) return;
    setOpening(true);
    // 交给系统浏览器下载，装完再回到应用
    openDownload(latest.url);
    setTimeout(() => {
      setOpening(false);
      if (!force) onClose?.();
    }, 700);
  };

  return (
    <Sheet
      title={force ? "需要更新后才能继续使用" : "发现新版本"}
      desc={force ? "该版本包含重要修复，请先完成更新" : "更新后无需重新登录，原有任务与位置都会保留"}
      onClose={force || opening ? undefined : onClose}
    >
      <div className="update">
        <div className="update__vers">
          <span className="update__v update__v--old">v{current?.version || "—"}</span>
          <span className="update__arrow" aria-hidden="true">
            →
          </span>
          <span className="update__v update__v--new">v{latest.version}</span>
          {latest.size && <span className="update__size">{latest.size}</span>}
        </div>

        {latest.notes.length > 0 && (
          <ul className="update__notes">
            {latest.notes.map((n) => (
              <li key={n}>
                <i />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="update__tip">将打开浏览器下载安装包，下载完成后按提示安装即可。</div>
      </div>

      <div className="sheet__actions">
        {!force && (
          <button className="sheet__btn" onClick={onClose} disabled={opening}>
            稍后再说
          </button>
        )}
        <button
          className="sheet__btn sheet__btn--primary"
          onClick={go}
          disabled={opening || checking}
        >
          {opening ? "正在打开…" : "立即更新"}
        </button>
      </div>
    </Sheet>
  );
}
