import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, '')
  const backend = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3000'

  return {
    plugins: [vue()],
    server: {
      strictPort: true,
      headers: {
        'Content-Security-Policy': "frame-ancestors 'none'",
      },
      proxy: {
        '/api': { target: backend },
        '/ws': { target: backend, ws: true },
        '/terminal': { target: backend, ws: true },
      },
    },
  }
})
