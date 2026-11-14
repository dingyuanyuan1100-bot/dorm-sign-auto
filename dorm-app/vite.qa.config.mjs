import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 仅用于 QA：把 @capacitor/core 换成本地假实现，便于在浏览器里跑更新状态机
const dir = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = process.env.DORM_API || "https://www.wuxianshitu.icu";
const proxy = {
  "/api": { target: BACKEND, changeOrigin: true, secure: false },
  "/update": { target: BACKEND, changeOrigin: true, secure: false },
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: /^@capacitor\/core$/, replacement: path.resolve(dir, "../qa/mocks/capacitor-core.js") }],
  },
  server: { host: "127.0.0.1", port: 5294, proxy },
});
