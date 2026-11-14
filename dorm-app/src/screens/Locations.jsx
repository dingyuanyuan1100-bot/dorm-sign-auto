import { useState } from "react";
import { useApp } from "../state";
import { Sheet, Skeleton, EmptyState, ScreenScroll } from "../ui/Chrome";
import { CardPin, MapPin, Plus14 } from "../ui/Icons";
import { coordText } from "../format";

const CARD_TOP = 392;
const CARD_STEP = 106;

export default function Locations({ go }) {
  const { locations, defaultLocation, addLocation, removeLocation, setDefaultLocation, pullFromTask, pushToast, boot } =
    useApp();
  const [manage, setManage] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ name: "", lat: "", lng: "", address: "", asDefault: false });

  const current = defaultLocation;
  const addRowY = locations.length === 0 ? 392 : CARD_TOP + (locations.length - 1) * CARD_STEP + 108;

  const contentH = Math.max(844, addRowY + 54 + 150);

  const openCreate = () => {
    setDraft({ name: "", lat: "", lng: "", address: "", asDefault: locations.length === 0 });
    setCreating(true);
  };

  const handleAdd = async () => {
    const name = draft.name.trim() || "我的位置";
    const lat = draft.lat.trim();
    const lng = draft.lng.trim();
    if (!lat || !lng) return pushToast("请填写经纬度", "err");
    if (Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) return pushToast("经纬度需为数字", "err");
    if (Math.abs(Number(lat)) > 90) return pushToast("纬度范围 -90 ~ 90", "err");
    if (Math.abs(Number(lng)) > 180) return pushToast("经度范围 -180 ~ 180", "err");
    setBusy(true);
    try {
      await addLocation({
        name: name.slice(0, 32),
        lat,
        lng,
        address: draft.address.trim().slice(0, 64),
        is_default: draft.asDefault || locations.length === 0,
      });
      setCreating(false);
      pushToast("位置已添加");
    } catch (e) {
      if (e.status === 0) pushToast(e.message, "err", "重试", handleAdd, 5200);
      else pushToast(e.message || "添加失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const handleFromTask = async () => {
    setBusy(true);
    try {
      const d = await pullFromTask();
      if (!d) return pushToast("晚寝系统没有返回位置", "err");
      setDraft((v) => ({
        ...v,
        lat: String(d.lat ?? v.lat),
        lng: String(d.lng ?? v.lng),
        name: v.name || d.name || d.address || "晚寝任务位置",
        address: v.address || d.address || "",
      }));
      pushToast("已填入当前位置");
    } catch (e) {
      pushToast(e.message || "拉取失败，请先绑定晚寝账号", "err");
    } finally {
      setBusy(false);
    }
  };

  const handleCard = async (l) => {
    if (!manage) return;
    if (l.is_default) return;
    try {
      await setDefaultLocation(l.id);
      pushToast(`已将「${l.name}」设为默认`);
    } catch (e) {
      pushToast(e.message || "设置失败", "err");
    }
  };

  const handleRemove = async (l) => {
    try {
      await removeLocation(l.id);
      pushToast("位置已删除", "err");
    } catch (e) {
      pushToast(e.message || "删除失败", "err");
    }
  };

  return (
    <>
      <ScreenScroll height={contentH}>
      <h1 className="t dis page-title">位置库</h1>

      <div className="map">
        <i className="map__h" />
        <i className="map__v" />
        <i className="map__d" />
        {current && (
          <>
            <i className="map__pulse" />
            <div className="map__pin">
              <MapPin />
            </div>
          </>
        )}
        <div className="map__info">
          <span className="t cn map__name">{current ? current.name : "尚未添加位置"}</span>
          <span className="t num map__coord">{current ? coordText(current) : "—"}</span>
        </div>
      </div>

      <div className="sub-head">
        <h2 className="t dis sub-title">全部位置</h2>
        {locations.length > 0 && (
          <button className="sub-action" onClick={() => setManage((v) => !v)}>
            {manage ? "完成" : "管理"}
          </button>
        )}
      </div>

      {boot !== "ready" && <Skeleton rows={2} top={CARD_TOP} height={94} gap={12} />}

      {boot === "ready" && locations.length === 0 && (
        <EmptyState
          title="还没有位置"
          desc="记录宿舍与自习室坐标，签到时会带上"
          action="添加位置"
          onAction={openCreate}
        />
      )}

      {locations.map((l, i) => (
        <div
          key={l.id}
          className="loc"
          style={{ top: CARD_TOP + i * CARD_STEP }}
          role={manage ? "button" : undefined}
          onClick={() => handleCard(l)}
          data-manage={manage}
        >
          <span className="loc__badge-box" data-dark={l.is_default}>
            <CardPin color={l.is_default ? "#BEF22F" : "#1A1A1A"} />
          </span>
          <span className="t cn loc__name">{l.name}</span>
          <span className="t num loc__coord">{coordText(l)}</span>
          {l.is_default ? (
            <span className="loc__badge">默认</span>
          ) : manage ? (
            <button
              className="loc__del"
              onClick={(e) => {
                e.stopPropagation();
                handleRemove(l);
              }}
            >
              删除
            </button>
          ) : null}
        </div>
      ))}

      <button className="addrow" style={{ top: addRowY }} onClick={openCreate}>
        <span className="addrow__box">
          <Plus14 />
        </span>
        <span className="t cn addrow__txt">添加新位置</span>
      </button>
      </ScreenScroll>

      {creating && (
        <Sheet title="添加位置" onClose={() => setCreating(false)}>
          <button className="sheet__ghost" onClick={handleFromTask} data-busy={busy}>
            从晚寝系统获取当前位置
          </button>
          <div className="sheet__fields">
            <label className="sheet__field">
              <span>名称</span>
              <input
                value={draft.name}
                maxLength={32}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="如：3 号公寓 · 502"
                aria-label="位置名称"
              />
            </label>
            <label className="sheet__field">
              <span>纬度</span>
              <input
                className="num"
                value={draft.lat}
                onChange={(e) => setDraft({ ...draft, lat: e.target.value })}
                placeholder="31.7061"
                inputMode="decimal"
                aria-label="纬度"
              />
            </label>
            <label className="sheet__field">
              <span>经度</span>
              <input
                className="num"
                value={draft.lng}
                onChange={(e) => setDraft({ ...draft, lng: e.target.value })}
                placeholder="118.5070"
                inputMode="decimal"
                aria-label="经度"
              />
            </label>
            <label className="sheet__field">
              <span>地址</span>
              <input
                value={draft.address}
                maxLength={64}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                placeholder="选填"
                aria-label="地址"
              />
            </label>
          </div>

          <div
            className="sheet__row"
            data-active={draft.asDefault}
            onClick={() => setDraft({ ...draft, asDefault: !draft.asDefault })}
          >
            设为默认位置
            <small>{draft.asDefault ? "已开启" : "关闭"}</small>
          </div>

          <div className="sheet__actions">
            <button className="sheet__btn" onClick={() => setCreating(false)}>
              取消
            </button>
            <button className="sheet__btn sheet__btn--primary" onClick={handleAdd} disabled={busy}>
              {busy ? "保存中" : "保存"}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
