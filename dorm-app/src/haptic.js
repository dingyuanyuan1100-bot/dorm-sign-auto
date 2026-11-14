/**
 * 轻触感反馈。
 * Android WebView 走 navigator.vibrate（需 VIBRATE 权限）；iOS Safari / 桌面静默降级。
 * 原则：只在「状态真的变了」时震 —— 选中、步进、失败、成功。
 * 普通导航点击不震，避免整机变成按摩器。
 */

let muted = false;

function buzz(pattern) {
  if (muted) return;
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* 机型无马达或权限被拒：静默 */
  }
}

/** 选项被选中 */
export const tap = () => buzz(8);

/** 单步前进（验证通过 / 进入下一步） */
export const step = () => buzz([9, 26, 9]);

/** 校验失败 / 接口失败 */
export const err = () => buzz([24, 46, 24]);

/** 重置成功 */
export const ok = () => buzz([12, 40, 22]);

/** 全局静音开关（留给「我的」设置页） */
export const setHapticMuted = (v) => {
  muted = !!v;
};
