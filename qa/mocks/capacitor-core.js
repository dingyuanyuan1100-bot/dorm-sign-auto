// QA 用：把原生插件换成可控的假实现，让「下载 → 权限 → 安装」整条状态机能在浏览器里跑
const qa = {
  declared: true,
  allowed: false,
  downloadCalls: 0,
  installCalls: 0,
  listeners: [],
  ticks: 6,
};
if (typeof window !== "undefined") window.__qaPlugin = qa;

export const Capacitor = {
  isNativePlatform: () => true,
  getPlatform: () => "android",
  Plugins: {},
  convertFileSrc: (s) => s,
};

const apk = {
  canInstall: async () => ({ declared: qa.declared, allowed: qa.allowed }),
  download: async ({ name }) => {
    qa.downloadCalls += 1;
    for (let i = 1; i <= qa.ticks; i++) {
      qa.listeners.slice().forEach((cb) => cb({ ratio: i / qa.ticks, loaded: i * 1000 }));
      await new Promise((r) => setTimeout(r, 90));
    }
    return { path: `update/${name || "update.apk"}`, size: 3377691 };
  },
  install: async () => {
    qa.installCalls += 1;
    await new Promise((r) => setTimeout(r, 80));
    if (!qa.allowed) {
      const err = new Error("请允许本应用安装应用后再试");
      err.code = "NEED_PERMISSION";
      throw err;
    }
    return { started: true };
  },
  addListener: async (event, cb) => {
    qa.listeners.push(cb);
    return { remove: async () => { qa.listeners = qa.listeners.filter((x) => x !== cb); } };
  },
  removeAllListeners: async () => {},
};

const generic = () => ({ addListener: async () => ({ remove() {} }), removeAllListeners: async () => {}, exitApp: async () => {} });

export const registerPlugin = (name) => (name === "ApkInstall" ? apk : generic());
export const WebPlugin = class {};
export const CapacitorException = class extends Error {};
export const ExceptionCode = { Unimplemented: "UNIMPLEMENTED", Unavailable: "UNAVAILABLE" };
