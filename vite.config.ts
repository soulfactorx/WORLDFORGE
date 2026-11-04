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
    plugins: [react(), ...(single ? [viteSingleFile()] : [{
      // 웹 버전만 설치형 웹앱(PWA): 매니페스트·아이콘 링크를 넣는다 (단일 HTML 파일은 file://로 열므로 넣지 않는다)
      name: 'worldforge-pwa',
      transformIndexHtml: (html: string) => html.replace('</head>', `    <link rel="manifest" href="./manifest.webmanifest" />
    <link rel="icon" href="./icon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="./apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="WORLDFORGE" />
  </head>`),
    }])],
    // 단일 HTML 파일에는 public/(아이콘·서비스 워커)을 복사하지 않는다
    publicDir: single ? false : 'public',
    define: { __BUILD_TARGET__: JSON.stringify(single ? 'single' : 'web'), __APP_VERSION__: JSON.stringify(pkg.version) },
    build: { outDir: single ? 'dist-single' : 'dist', chunkSizeWarningLimit: 1500 },
    test: { environment: 'node' },
  };
});
