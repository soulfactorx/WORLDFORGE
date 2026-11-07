import { Lightbox } from './Lightbox';
import { DebugPanel, DebugToggle, useDebugOn } from './DebugPanel';
import { useState } from 'react';
import type { LlmSettings } from '../llm/types';
import { loadSettings } from '../storage/settings';
import { PlayScreen } from './PlayScreen';
import { SaveList } from './SaveList';
import { SettingsPanel } from './SettingsPanel';
import { QualityPanel } from './QualityPanel';
import { WorldEditor } from './WorldEditor';
import { WorldGenPanel } from './WorldGenPanel';
import { CardWorldPanel } from './CardWorldPanel';
import { InstallButton } from './InstallButton';
import { UserArtManager } from './UserArtManager';
import type { WorldPackage } from '../engine/schema';
import { blankWorld } from '../storage/packages';

type View = { name: 'saves' } | { name: 'settings' } | { name: 'play'; saveId: string } | { name: 'editor'; world: WorldPackage | null; notes?: string[]; card?: File; saved?: boolean; library?: boolean } | { name: 'worldgen' } | { name: 'cardworld'; file: File; extras?: File[] } | { name: 'userart' };

export function App() {
  const [settings, setSettings] = useState<LlmSettings | null>(loadSettings);
  const [view, setView] = useState<View>(settings ? { name: 'saves' } : { name: 'settings' });
  const debug = useDebugOn();
  const [showDebug, setShowDebug] = useState(false);

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setView({ name: 'saves' })}>WORLDFORGE</button>
        <span className="muted small nowrap" title={__BUILD_TARGET__ === 'single' ? '로컬 단일 파일' : '웹'}><span className="wide-only">{__BUILD_TARGET__ === 'single' ? '로컬 단일 파일' : '웹'} · </span>v{__APP_VERSION__}</span>
        <span className="topbar-links">
          {__BUILD_TARGET__ === 'web' && <a className="small nowrap" href="./worldforge-offline.html" download title="오프라인 HTML 받기">오프라인<span className="wide-only"> HTML 받기</span></a>}
          <InstallButton />
          <a className="small nowrap" href="https://github.com/soulfactorx/WORLDFORGE" target="_blank" rel="noreferrer" title="GPL-3.0-or-later — 소스 코드">소스<span className="wide-only"> (GPL)</span></a>
        </span>
        {debug && view.name !== 'play' && <button className="small" onClick={() => setShowDebug(true)} title="디버그 기록: 세계 만들기 등 모든 AI 호출">🐞</button>}
        <button className="topbar-settings" onClick={() => setView({ name: 'settings' })}>AI 설정</button>
      </header>
      <main>
        {view.name === 'settings' && (
          <>
            <SettingsPanel initial={settings} onSaved={(s) => { setSettings(s); setView({ name: 'saves' }); }} />
            <QualityPanel settings={settings} />
            <section className="panel"><h2>디버그</h2><DebugToggle /><p className="small muted">켜면 플레이 화면의 <b>🐞 디버그</b>에서 턴마다 AI에게 보낸 프롬프트·파라미터·실제 요청 본문·응답 원문, 엔진이 만든 이벤트·거부한 제안·상태 변화, 현재 상태·세계 데이터·이벤트 로그 전체를 볼 수 있습니다. 세계 만들기 같은 플레이 밖 AI 호출은 위쪽 🐞 버튼에서 봅니다.</p></section>
          </>
        )}
        {view.name === 'saves' && <SaveList onOpen={(saveId) => setView({ name: 'play', saveId })} onEdit={(world, library) => setView({ name: 'editor', world, ...(library ? { library: true } : {}) })} onGenerate={() => setView({ name: 'worldgen' })} onUserArt={() => setView({ name: 'userart' })}
          onCard={(file, extras) => setView({ name: 'cardworld', file, ...(extras?.length ? { extras } : {}) })} />}
        {view.name === 'userart' && <UserArtManager onClose={() => setView({ name: 'saves' })} />}
        {view.name === 'cardworld' && <CardWorldPanel file={view.file} {...(view.extras ? { extraFiles: view.extras } : {})} settings={settings} onCancel={() => setView({ name: 'saves' })}
          onDone={(world, notes) => setView({ name: 'editor', world, notes, saved: true })}
          onCharactersOnly={(card) => setView({ name: 'editor', world: { ...blankWorld(), manifest: { ...blankWorld().manifest, id: `card.${Date.now().toString(36)}` } }, card })} />}
        {view.name === 'editor' && <WorldEditor key={view.world?.manifest.id ?? 'new'} initial={view.world} draftNotes={view.notes} alreadySaved={view.saved} initialCard={view.card} openLibrary={view.library} settings={settings} onDone={() => setView({ name: 'saves' })} />}
        {view.name === 'worldgen' && <WorldGenPanel settings={settings} onCancel={() => setView({ name: 'saves' })} onDraft={(world, notes) => setView({ name: 'editor', world, notes })} />}
        {view.name === 'play' && (
          settings
            ? <PlayScreen saveId={view.saveId} settings={settings} onExit={() => setView({ name: 'saves' })} />
            : <p>먼저 AI 설정을 해 주세요.</p>
        )}
      </main>
      {showDebug && <DebugPanel onClose={() => setShowDebug(false)} />}
      <Lightbox />
    </div>
  );
}
