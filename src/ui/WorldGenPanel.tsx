import { useEffect, useRef, useState } from 'react';
import { generateWorld, type Size } from '../gm/worldgen/generate';
import { createLlmClient } from '../llm';
import type { LlmSettings } from '../llm/types';
import type { WorldPackage } from '../engine/schema';
import { confirmAdult } from './adult';
import { GenrePicker } from './GenrePicker';

const EXAMPLE = '안개가 걷히지 않는 산골 수도원. 수도사들은 매일 밤 종을 치는데, 종소리가 멈추면 무언가가 깨어난다고 믿는다. 수도원장은 무언가를 숨기고 있고, 젊은 견습 수도사는 바깥세상을 동경한다.';

/** AI 세계관 생성: 설명 → 초안 → 편집기에서 검토·승인 */
export function WorldGenPanel({ settings, onDraft, onCancel }: {
  settings: LlmSettings | null;
  onDraft: (world: WorldPackage, notes: string[]) => void;
  onCancel: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<Size>('small');
  const [rating, setRating] = useState<WorldPackage['manifest']['contentRating']>('teen');
  const [withScenario, setWithScenario] = useState(true);
  const [withScenes, setWithScenes] = useState(true);
  const [withRules, setWithRules] = useState(true);
  const [genre, setGenre] = useState<NonNullable<WorldPackage['genre']>>({ id: 'high_fantasy' });
  const [stage, setStage] = useState('');
  // 진행률 (v0.46.3 — 카드 세계 만들기와 같은 방식): 긴 AI 호출 중에는 다음 단계 쪽으로 천천히 차오른다
  const [pct, setPct] = useState({ at: 0, next: 0, since: 0, start: 0 });
  const [, tick] = useState(0);
  useEffect(() => { if (!stage) return; const t = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(t); }, [stage !== '']);
  const onStage = (st: string, at?: number, next?: number) => {
    setStage(st);
    if (at !== undefined) setPct((p) => ({ at: Math.max(p.at, at), next: Math.max(next ?? at, at), since: Date.now(), start: p.start || Date.now() }));
  };
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  async function run() {
    if (!settings) return;
    setError('');
    abort.current = new AbortController();
    setPct({ at: 0, next: 2, since: Date.now(), start: Date.now() });
    try {
      const r = await generateWorld(createLlmClient(settings), { prompt, size, contentRating: rating, withScenario, withScenes, withRules, genre: genre.id, ...(genre.custom ? { genreCustom: genre.custom } : {}) }, onStage, abort.current.signal);
      onDraft(r.world, r.notes);
    } catch (e) {
      if (!abort.current.signal.aborted) setError((e as Error).message);
    } finally {
      setStage(''); setPct({ at: 0, next: 0, since: 0, start: 0 });
    }
  }

  const busy = stage !== '';
  return (
    <section className="panel">
      <h2>✦ AI로 세계관 만들기</h2>
      <p className="muted small">
        만들고 싶은 세계를 자유롭게 설명하세요. AI가 장소·인물·비밀·단서와 임무·결말까지 초안을 만들고, 검사기가 참조를 정리합니다.
        초안은 <b>편집기에서 검토하고 저장해야</b> 라이브러리에 등록됩니다. AI가 만든 내용은 그대로 쓰기 전에 꼭 읽어 보세요.
      </p>
      {!settings && <p className="status">❌ 먼저 AI 설정을 해 주세요.</p>}
      <label>세계 설명
        <textarea rows={6} value={prompt} placeholder={EXAMPLE} disabled={busy} onChange={(e) => setPrompt(e.target.value)} />
      </label>
      <div className="row">
        <fieldset className="genre-in-gen" disabled={busy}><GenrePicker value={genre} onChange={setGenre} compact /></fieldset>
        <label>규모
          <select value={size} disabled={busy} onChange={(e) => setSize(e.target.value as Size)}>
            <option value="small">작게 (장소 3~4, 인물 3~4)</option>
            <option value="medium">보통 (장소 5~7, 인물 5~7)</option>
          </select>
        </label>
        <label>콘텐츠 등급
          <select value={rating} disabled={busy} onChange={(e) => { const v = e.target.value as typeof rating; if (v !== 'mature' || confirmAdult()) setRating(v); }}>
            <option value="all">전체</option><option value="teen">청소년</option><option value="mature">성인 (공유 불가 · 이후 변경 불가)</option>
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={withScenario} disabled={busy} onChange={(e) => setWithScenario(e.target.checked)} /> 임무·결말까지 만들기</label>
        <label className="check"><input type="checkbox" checked={withScenes} disabled={busy} onChange={(e) => setWithScenes(e.target.checked)} /> 장면(협상·추격·대결·데이트…)까지 만들기</label>
        <label className="check"><input type="checkbox" checked={withRules} disabled={busy} onChange={(e) => setWithRules(e.target.checked)} /> 세계 규칙(행동 → 결과 · 연쇄 반응)까지 만들기</label>
      </div>
      <p className="muted small">AI 호출 {1 + (withScenario ? 1 : 0) + (withScenes ? 1 : 0) + (withRules ? 1 : 0)}회 · 설정한 모델과 API 키를 씁니다. 큰 응답이라 시간이 조금 걸립니다.</p>
      <div className="row">
        <button onClick={() => (busy ? abort.current?.abort() : onCancel())}>{busy ? '중단' : '취소'}</button>
        <button className="primary" disabled={!settings || busy || prompt.trim().length < 10} onClick={run}>{busy ? '만드는 중…' : '초안 만들기'}</button>
        {!busy && prompt.trim().length < 10 && <span className="small muted">설명을 10자 이상 적어 주세요.</span>}
      </div>
      {busy && (() => {
        const creep = pct.at + (pct.next - pct.at) * (1 - Math.exp(-(Date.now() - pct.since) / 45000)) * 0.9;
        const shown = Math.min(100, Math.round(creep));
        const sec = Math.floor((Date.now() - (pct.start || Date.now())) / 1000);
        return (
          <div className="gen-progress" role="status" aria-live="polite">
            <div className="row"><span className="spinner" /> <b>{shown}%</b> <span className="small">{stage}</span><span className="spacer" /><span className="small muted">{Math.floor(sec / 60)}분 {sec % 60}초</span></div>
            <div className="progress-bar"><span style={{ width: `${shown}%` }} /></div>
            <span className="small muted">{['세계', ...(withScenario || withScenes ? ['이야기 뼈대'] : []), ...(withScenes ? ['장면'] : []), ...(withScenario ? ['임무·결말'] : []), ...(withRules ? ['세계 규칙'] : []), '기본 이미지', '검사'].map((x, i) => `${i + 1}) ${x}`).join(' → ')} · 큰 응답이라 몇 분 걸릴 수 있습니다. 화면을 떠나지 마세요.</span>
          </div>
        );
      })()}
      {error && <p className="status">❌ {error}</p>}
    </section>
  );
}
