import { useState } from 'react';
import type { LlmSettings } from '../llm/types';
import { loadSettings } from '../storage/settings';
import { PlayScreen } from './PlayScreen';
import { SaveList } from './SaveList';
import { SettingsPanel } from './SettingsPanel';
import { WorldEditor } from './WorldEditor';
import type { WorldPackage } from '../engine/schema';

type View = { name: 'saves' } | { name: 'settings' } | { name: 'play'; saveId: string } | { name: 'editor'; world: WorldPackage | null };

export function App() {
  const [settings, setSettings] = useState<LlmSettings | null>(loadSettings);
  const [view, setView] = useState<View>(settings ? { name: 'saves' } : { name: 'settings' });

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setView({ name: 'saves' })}>WORLDFORGE</button>
        <span className="muted small">{__BUILD_TARGET__ === 'single' ? '로컬 단일 파일' : '웹'} · v{__APP_VERSION__}</span>
        {__BUILD_TARGET__ === 'web' && <a className="small" href="./worldforge-offline.html" download>오프라인 HTML 받기</a>}
        <button onClick={() => setView({ name: 'settings' })}>AI 설정</button>
      </header>
      <main>
        {view.name === 'settings' && (
          <SettingsPanel initial={settings} onSaved={(s) => { setSettings(s); setView({ name: 'saves' }); }} />
        )}
        {view.name === 'saves' && <SaveList onOpen={(saveId) => setView({ name: 'play', saveId })} onEdit={(world) => setView({ name: 'editor', world })} />}
        {view.name === 'editor' && <WorldEditor initial={view.world} onDone={() => setView({ name: 'saves' })} />}
        {view.name === 'play' && (
          settings
            ? <PlayScreen saveId={view.saveId} settings={settings} onExit={() => setView({ name: 'saves' })} />
            : <p>먼저 AI 설정을 해 주세요.</p>
        )}
      </main>
    </div>
  );
}
