import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { gameApiPlugin } from './server/vite-plugin.js';

export default defineConfig(({ mode }) => ({
  plugins:[gameApiPlugin(fileURLToPath(new URL('.', import.meta.url)), loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_'))],
  server: {
    host: '127.0.0.1',
    port: 5178,
    strictPort: true,
    allowedHosts: ['.trycloudflare.com'],
    hmr: false,
    fs: { strict: true, allow: [fileURLToPath(new URL('.', import.meta.url))], deny:['.env','**/.env*','**/*.{crt,pem}','**/.data/**','**/server/**','**/.runtime.json'] },
  },
  preview: { host: '127.0.0.1', port: 5179, strictPort: true, allowedHosts: ['.trycloudflare.com'] },
}));
