import { useState } from 'react';
import type { LlmSettings } from '../llm/types';
import { loadSettings } from '../storage/settings';
import { PlayScreen } from './PlayScreen';
import { SaveList } from './SaveList';
import { SettingsPanel } from './SettingsPanel';
import { WorldEditor } from './WorldEditor';
import { WorldGenPanel } from './WorldGenPanel';
import { CardWorldPanel } from './CardWorldPanel';
import { InstallButton } from './InstallButton';
import type { WorldPackage } from '../engine/schema';
import { blankWorld } from '../storage/packages';

type View = { name: 'saves' } | { name: 'settings' } | { name: 'play'; saveId: string } | { name: 'editor'; world: WorldPackage | null; notes?: string[]; card?: File; saved?: boolean } | { name: 'worldgen' } | { name: 'cardworld'; file: File };

export function App() {
  const [settings, setSettings] = useState<LlmSettings | null>(loadSettings);
  const [view, setView] = useState<View>(settings ? { name: 'saves' } : { name: 'settings' });

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setView({ name: 'saves' })}>WORLDFORGE</button>
        <span className="muted small">{__BUILD_TARGET__ === 'single' ? '로컬 단일 파일' : '웹'} · v{__APP_VERSION__}</span>
        {__BUILD_TARGET__ === 'web' && <a className="small" href="./worldforge-offline.html" download>오프라인 HTML 받기</a>}
        <InstallButton />
        <a className="small" href="https://github.com/soulfactorx/WORLDFORGE" target="_blank" rel="noreferrer" title="GPL-3.0-or-later — 소스 코드">소스 (GPL)</a>
        <button onClick={() => setView({ name: 'settings' })}>AI 설정</button>
      </header>
      <main>
        {view.name === 'settings' && (
          <SettingsPanel initial={settings} onSaved={(s) => { setSettings(s); setView({ name: 'saves' }); }} />
        )}
        {view.name === 'saves' && <SaveList onOpen={(saveId) => setView({ name: 'play', saveId })} onEdit={(world) => setView({ name: 'editor', world })} onGenerate={() => setView({ name: 'worldgen' })}
          onCard={(file) => setView({ name: 'cardworld', file })} />}
        {view.name === 'cardworld' && <CardWorldPanel file={view.file} settings={settings} onCancel={() => setView({ name: 'saves' })}
          onDone={(world, notes) => setView({ name: 'editor', world, notes, saved: true })}
          onCharactersOnly={(card) => setView({ name: 'editor', world: { ...blankWorld(), manifest: { ...blankWorld().manifest, id: `card.${Date.now().toString(36)}` } }, card })} />}
        {view.name === 'editor' && <WorldEditor key={view.world?.manifest.id ?? 'new'} initial={view.world} draftNotes={view.notes} alreadySaved={view.saved} initialCard={view.card} settings={settings} onDone={() => setView({ name: 'saves' })} />}
        {view.name === 'worldgen' && <WorldGenPanel settings={settings} onCancel={() => setView({ name: 'saves' })} onDraft={(world, notes) => setView({ name: 'editor', world, notes })} />}
        {view.name === 'play' && (
          settings
            ? <PlayScreen saveId={view.saveId} settings={settings} onExit={() => setView({ name: 'saves' })} />
            : <p>먼저 AI 설정을 해 주세요.</p>
        )}
      </main>
    </div>
  );
}
