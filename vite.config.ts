import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Two pages: the public website at "/" (index.html) and the Financial Management System at "/app/" (app/index.html).
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        website: fileURLToPath(new URL('./index.html', import.meta.url)),
        app: fileURLToPath(new URL('./app/index.html', import.meta.url)),
      },
    },
  },
});
