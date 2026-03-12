import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      proxy: {
        '/start': 'http://localhost:3000',
        '/api': 'http://localhost:3000',
        '/human': 'http://localhost:3000',
        '/threads': 'http://localhost:3000',
        '/thread': 'http://localhost:3000',
        '/save': 'http://localhost:3000',
        '/stream': {
          target: 'http://localhost:3000',
          // SSE needs special handling
          configure: (proxy) => {
            proxy.on('proxyRes', (proxyRes) => {
              proxyRes.headers['cache-control'] = 'no-cache';
              proxyRes.headers['x-accel-buffering'] = 'no';
            });
          },
        },
      },
    },
  };
});
