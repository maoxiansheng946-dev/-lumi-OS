import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      allowedHosts: ['lumiai.asia', '.lumiai.asia'],
      watch: {
        ignored: ['**/gpt-sovits-src/**', '**/data/voice_training/**', '**/*.db', '**/db.json', '**/.keys.json', '**/data/**'],
      },
    },
    optimizeDeps: {
      exclude: ['gpt-sovits-src'],
      entries: ['./src/**/*.{tsx,ts}'],
    },
  };
});
