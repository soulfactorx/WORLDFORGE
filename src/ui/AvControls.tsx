import { useState } from 'react';
import { type AvSettings, loadAv, playSfx, saveAv, stopSpeaking } from './audio';

/** 소리·음성 설정 (플레이 화면 위) */
export function AvControls({ onChange }: { onChange: () => void }) {
  const [open, setOpen] = useState(false);
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
    <span className="av">
      <button type="button" onClick={() => setOpen((o) => !o)} title="효과음·배경 음악·음성">{on ? '🔊' : '🔇'} 소리</button>
      {open && (
        <div className="av-pop">
          <label className="check small"><input type="checkbox" checked={av.sfx} onChange={(e) => set({ sfx: e.target.checked })} /> 효과음 (전투·주사위·보상·징조)</label>
          <label className="check small"><input type="checkbox" checked={av.music} onChange={(e) => set({ music: e.target.checked })} /> 배경 음악 (장르·전투에 맞춰)</label>
          <label className="check small"><input type="checkbox" checked={av.voice} disabled={!hasVoice} onChange={(e) => set({ voice: e.target.checked })} /> 서술 읽어 주기{hasVoice ? '' : ' (이 브라우저는 지원하지 않음)'}</label>
          <label className="small">음량 <input type="range" min={0} max={1} step={0.05} value={av.volume} onChange={(e) => set({ volume: Number(e.target.value) })} /></label>
          <p className="small muted">소리는 이 기기에서 바로 만들어 냅니다 (파일·인터넷 필요 없음). 음성은 브라우저에 설치된 한국어 목소리를 씁니다.</p>
        </div>
      )}
    </span>
  );
}
