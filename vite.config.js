import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.API_TARGET || `http://127.0.0.1:${process.env.PORT || 3000}`;
const basePath = normalizeBasePath(process.env.BASE_PATH || '/');
const apiProxyPrefix = basePath === '/' ? '/api' : `${basePath.replace(/\/$/, '')}/api`;

function normalizeBasePath(value) {
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

export default defineConfig({
  base: basePath,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      [apiProxyPrefix]: {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (urlPath) => urlPath.replace(apiProxyPrefix, '/api')
      }
    }
  }
});