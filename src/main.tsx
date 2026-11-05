import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';
import { applyOrientation, isStandalone, loadOrientation } from './ui/orientation';

// 웹 버전: 설치형 웹앱용 서비스 워커 (https 또는 localhost에서만)
if (__BUILD_TARGET__ === 'web' && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}

// 설치한 앱: 사용자가 세로·가로 고정을 골랐으면 적용 (기본은 시스템 설정 따름)
if (isStandalone() && loadOrientation() !== 'system') void applyOrientation(loadOrientation());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
