import { useEffect, useState } from 'react';

interface InstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** 웹앱 설치 버튼: 브라우저가 설치를 제안하면 버튼으로, iPhone·iPad는 "홈 화면에 추가" 안내 */
export function InstallButton() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(standalone);
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallPrompt); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);
  if (installed || __BUILD_TARGET__ !== 'web') return null;
  if (prompt) return <button onClick={async () => { await prompt.prompt(); await prompt.userChoice; setPrompt(null); }}>⤓ 앱 설치</button>;
  if (isIos()) return <button className="install-hint" onClick={() => alert('Safari에서 공유 버튼(□↑)을 누른 뒤 "홈 화면에 추가"를 고르면 앱처럼 설치됩니다.')}>⤓ 앱 설치 방법</button>;
  return null;
}
