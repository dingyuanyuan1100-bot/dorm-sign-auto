import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 对外统一走备案域名（www.wuxianshitu.icu）；开发期仍走 /api 代理保持浏览器同源
const BACKEND = process.env.DORM_API || 'https://www.wuxianshitu.icu'
const proxy = {
  '/api': { target: BACKEND, changeOrigin: true, secure: false },
  // 公告与更新清单也走后端（/update/notice.json、/update/version.json）
  '/update': { target: BACKEND, changeOrigin: true, secure: false },
}

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5275, proxy },
  preview: { host: '127.0.0.1', port: 5275, proxy },
})
