import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import pkg from './package.json' with { type: 'json' };

// `vite build`               → dist/        (GitHub Pages, 상대 경로)
// `vite build --mode single` → dist-single/ (모든 JS/CSS를 index.html 하나에 내장, file:// 실행용)
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: [react(), ...(single ? [viteSingleFile()] : [])],
    define: { __BUILD_TARGET__: JSON.stringify(single ? 'single' : 'web'), __APP_VERSION__: JSON.stringify(pkg.version) },
    build: { outDir: single ? 'dist-single' : 'dist', chunkSizeWarningLimit: 1500 },
    test: { environment: 'node' },
  };
});
