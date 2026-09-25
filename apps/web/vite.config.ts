/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.API_URL ?? 'http://127.0.0.1:3001';
const proxy = { '/api': { target: apiTarget, changeOrigin: true } };
// Bind IPv4 explicitly: `localhost` resolves to ::1 first on some hosts (e.g. GitHub runners),
// which breaks tools that probe 127.0.0.1 (Playwright webServer, review:serve).
const host = '127.0.0.1';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host, port: Number(process.env.WEB_PORT ?? 5173), strictPort: true, proxy },
  preview: { host, port: Number(process.env.WEB_PORT ?? 4173), strictPort: true, proxy },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
