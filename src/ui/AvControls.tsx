import { GM_STYLES, setGmStyleOverride } from '../data/gmStyles';
import { DebugToggle } from './DebugPanel';
import { DIFFICULTIES, difficultyEffect, difficultyLabel } from '../engine/difficulty';
import { useEffect, useRef, useState } from 'react';
import { type BackgroundMode, type DisplayLevel, IMAGE_SIZES, type ImageSize, loadPlayPrefs, savePlayPrefs, SCENE_NARRATIONS, type SceneNarration } from './playPrefs';
import { isStandalone, loadOrientation, type OrientationPref, saveOrientation } from './orientation';
import { type AvSettings, loadAv, playSfx, saveAv, stopSpeaking } from './audio';

/** 소리·음성 설정 (플레이 화면 위) */
export function AvControls({ onChange, dcMod, onDcMod, dcBusy }: { onChange: () => void; /** 이 세이브의 난이도 (v0.90) — 주면 설정에 보인다 */ dcMod?: number; onDcMod?: (dcMod: number) => void; /** 턴 진행 중 — 난이도를 바꿀 수 없다 (v0.106) */ dcBusy?: boolean }) {
  const [open, setOpen] = useState(false);
  const [orient, setOrient] = useState<OrientationPref>(loadOrientation);
  const [orientNote, setOrientNote] = useState('');
  const [play, setPlay] = useState(loadPlayPrefs);
  const box = useRef<HTMLSpanElement>(null);
  // 바깥을 누르거나 Esc를 누르면 닫는다
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const [av, setAv] = useState<AvSettings>(loadAv);
  const set = (patch: Partial<AvSettings>) => {
    const next = { ...av, ...patch };
    setAv(next); saveAv(next); onChange();
    if (patch.voice === false) stopSpeaking();
    if (patch.sfx) playSfx('coin');
  };
  const on = av.sfx || av.music || av.voice;
  const hasVoice = typeof globalThis !== 'undefined' && 'speechSynthesis' in globalThis;
  return (
    <span className="av" ref={box}>
      <button type="button" onClick={() => setOpen((o) => !o)} title="효과음·배경 음악·음성" aria-expanded={open} className={open ? 'on' : undefined}>{on ? '🔊' : '🔇'} 소리·화면</button>
      {open && (
        <div className="av-pop" role="dialog" aria-label="설정">
          <div className="row"><b className="small">소리 · 화면 · 플레이</b><span className="spacer" /><button type="button" className="av-close" onClick={() => setOpen(false)} aria-label="닫기">✕</button></div>
          <label className="check small"><input type="checkbox" checked={av.sfx} onChange={(e) => set({ sfx: e.target.checked })} /> 효과음 (전투·주사위·보상·징조)</label>
          <label className="check small"><input type="checkbox" checked={av.music} onChange={(e) => set({ music: e.target.checked })} /> 배경 음악 (장르·전투에 맞춰)</label>
          <label className="check small"><input type="checkbox" checked={av.voice} disabled={!hasVoice} onChange={(e) => set({ voice: e.target.checked })} /> 서술 읽어 주기{hasVoice ? '' : ' (이 브라우저는 지원하지 않음)'}</label>
          <label className="small av-vol">음량 <input type="range" min={0} max={1} step={0.05} value={av.volume} onChange={(e) => set({ volume: Number(e.target.value) })} /></label>
          <label className="small av-vol">화면 방향
            <select value={orient} onChange={async (e) => {
              const v = e.target.value as OrientationPref;
              setOrient(v);
              const r = await saveOrientation(v);
              setOrientNote(r === 'ok' ? '' : isStandalone() ? '이 브라우저는 화면 방향 고정을 지원하지 않습니다.' : '설치한 앱(홈 화면 아이콘)으로 열었을 때 적용됩니다.');
            }}>
              <option value="system">휴대폰 설정 따름</option>
              <option value="portrait">세로 고정</option>
              <option value="landscape">가로 고정</option>
            </select>
          </label>
          {orientNote && <p className="small muted">{orientNote}</p>}
          <label className="small av-vol">이미지 크기
            <select value={play.images} onChange={(e) => { const p = { ...play, images: e.target.value as ImageSize }; setPlay(p); savePlayPrefs(p); onChange(); }}>
              {IMAGE_SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="small av-vol">배경 이미지
            <select value={play.background} onChange={(e) => { const p = { ...play, background: e.target.value as BackgroundMode }; setPlay(p); savePlayPrefs(p); onChange(); }}>
              <option value="every">매 턴 서술 맨 앞에</option>
              <option value="change">장소·장면이 바뀔 때만</option>
            </select>
          </label>
          <label className="small av-vol">장면 서술
            <select value={play.sceneNarration} onChange={(e) => { const p = { ...play, sceneNarration: e.target.value as SceneNarration }; setPlay(p); savePlayPrefs(p); onChange(); }}>
              {SCENE_NARRATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="small av-vol">GM 스타일
            <select value={play.gmStyle} onChange={(e) => { const p = { ...play, gmStyle: e.target.value }; setPlay(p); savePlayPrefs(p); setGmStyleOverride(p.gmStyle); onChange(); }}>
              <option value="world">세계관 설정 따름</option>
              {GM_STYLES.map((g) => <option key={g.id} value={g.id}>{g.emoji} {g.name}</option>)}
            </select>
          </label>
          <label className="small av-vol">표시 수준
            <select value={play.display} onChange={(e) => { const p = { ...play, display: e.target.value as DisplayLevel }; setPlay(p); savePlayPrefs(p); onChange(); }}>
              <option value="immersive">몰입형 (숫자·알림 최소 — 기록에만)</option>
              <option value="standard">기본</option>
              <option value="game">게임형 (경험치 막대까지)</option>
            </select>
          </label>
          {onDcMod && (
            <div className="av-difficulty">
              <label className="small" htmlFor="av-difficulty">난이도 <span className="muted">(이 세이브)</span></label>
              <select id="av-difficulty" value={String(dcMod ?? 0)} disabled={dcBusy} onChange={(e) => onDcMod(Number(e.target.value) || 0)}>
                {!DIFFICULTIES.some((d) => d.dc === (dcMod ?? 0)) && <option value={String(dcMod ?? 0)}>{difficultyLabel(dcMod ?? 0)}</option>}
                {DIFFICULTIES.map((d) => <option key={d.id} value={d.dc}>{difficultyLabel(d.dc)}</option>)}
              </select>
              <p className="small muted">{DIFFICULTIES.find((d) => d.dc === (dcMod ?? 0))?.desc ?? '직접 정한 보정값'}</p>
              <p className="small">{difficultyEffect(dcMod ?? 0)}</p>
              {dcBusy && <p className="small muted">턴이 진행되는 동안에는 바꿀 수 없습니다. 서술이 끝난 뒤 바꾸세요.</p>}
            </div>
          )}
          <DebugToggle />
          <p className="small muted">소리는 이 기기에서 바로 만들어 냅니다 (파일·인터넷 필요 없음). 음성은 브라우저에 설치된 한국어 목소리를 씁니다.</p>
        </div>
      )}
    </span>
  );
}
