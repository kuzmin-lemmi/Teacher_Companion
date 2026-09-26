import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 1420 ждёт `tauri dev` (devUrl); PORT — для предпросмотра в браузере на свободном порту.
  server: { port: Number(process.env.PORT) || 1420, strictPort: true },
  clearScreen: false,
});
