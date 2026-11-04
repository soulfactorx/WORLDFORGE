import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build`               → dist/        (GitHub Pages, 상대 경로)
// `vite build --mode single` → dist-single/ (모든 JS/CSS를 index.html 하나에 내장, file:// 실행용)
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: [react(), ...(single ? [viteSingleFile()] : [])],
    define: { __BUILD_TARGET__: JSON.stringify(single ? 'single' : 'web') },
    build: { outDir: single ? 'dist-single' : 'dist', chunkSizeWarningLimit: 1500 },
    test: { environment: 'node' },
  };
});
