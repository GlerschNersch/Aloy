import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import os from 'os';

let authToken = '';
try {
  const tokenPath = path.join(os.homedir(), '.aloy-server', 'auth-token.txt');
  if (fs.existsSync(tokenPath)) {
    authToken = fs.readFileSync(tokenPath, 'utf-8').trim();
  }
} catch (e) {
  // Ignore
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:7890',
        changeOrigin: true,
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
      }
      // REMOVED: the '/ha-proxy' dev proxy. The renderer no longer talks to
      // Home Assistant directly — it goes through /api/ha-proxy on this app's
      // own server, which holds the HA token. That also retires this entry's
      // `secure: false`, which disabled TLS certificate verification on the
      // exact path the long-lived admin token used to travel.
    }
  },
  preview: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:7890',
        changeOrigin: true,
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
      }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    exclude: ['e2e/**', 'node_modules/**', '.staging/**', 'dist/**']
  }
});
