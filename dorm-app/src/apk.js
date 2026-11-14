// 应用内下载安装（已搁置，暂不启用）。
// 更新流程现走 src/update.js 的 openDownload：交给系统浏览器下载。
// 原生实现保留在 android/app/src/main/java/top/domye/dorm/ApkInstallPlugin.java，恢复时接回 UpdateSheet 即可。
import { Capacitor, registerPlugin } from "@capacitor/core";

// 原生侧负责：下载到 cache、通知进度、拉起系统安装器
const ApkInstall = registerPlugin("ApkInstall");

export const canInstallInline = () => {
  try {
    return !!Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
};

/**
 * 安装条件：declared = 包内是否声明了安装权限；allowed = 系统里是否已放开「安装未知应用」。
 * 拿不到信息时按可用来处理，交给原生在实际安装时判断。
 */
export async function installState() {
  if (!canInstallInline()) return { declared: false, allowed: false };
  try {
    const s = await ApkInstall.canInstall();
    return { declared: s.declared !== false, allowed: s.allowed !== false };
  } catch {
    return { declared: true, allowed: true };
  }
}

/**
 * 下载到应用缓存。onProgress(ratio, loaded)——ratio 为 -1 表示拿不到总长度。
 * 返回 { path, size }，path 可直接交给 installApk。
 */
export async function downloadUpdate(url, { name, onProgress } = {}) {
  if (!canInstallInline()) throw new Error("非原生环境");

  const listener = onProgress
    ? await ApkInstall.addListener("progress", (d) => onProgress(d.ratio, d.loaded))
    : null;

  try {
    const file = await ApkInstall.download({ url, name });
    return { path: file.path, size: file.size };
  } finally {
    listener?.remove?.();
  }
}

/**
 * 拉起系统安装器。失败时抛出的错误带 code：
 * NEED_PERMISSION（系统未放开安装权限，原生已打开开关页）/ NO_PERMISSION_DECLARED（老包没声明权限）等。
 */
export async function installApk(path) {
  await ApkInstall.install({ path });
}

export async function installUpdate(url, opts = {}) {
  const file = await downloadUpdate(url, opts);
  await installApk(file.path);
  return file;
}
