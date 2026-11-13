import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// «Бланки расписания» — программа завуча. Тот же код школы (src/school), что и в приложении,
// но собирается в один HTML-файл: открывается двойным щелчком, без установки и интернета.
export default defineConfig({
  root: 'blanki',
  base: './',
  plugins: [react(), viteSingleFile()],
  build: { outDir: '../dist-blanki', emptyOutDir: true },
  server: { port: Number(process.env.PORT) || 1430, strictPort: true },
  clearScreen: false,
});
