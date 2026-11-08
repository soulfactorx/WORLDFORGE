/**
 * 🩺 AI 점검·마무리 (v0.78): 규칙 점검 → AI 채우기 제안 → 골라서 적용 (저장은 편집기에서).
 * 수동으로 만들다 만 세계, 카드로 AI가 만든 뒤 고치다 놓친 설정 모두 같은 흐름.
 */
import { useMemo, useRef, useState } from 'react';
import { aiFill, applyPatches, scanWorld, type Gap, type Patch } from '../gm/worldgen/audit';
import { createLlmClient } from '../llm';
import { classesFor } from '../engine/classes';
import type { WorldPackage } from '../engine/schema';
import type { LlmSettings } from '../llm/types';

const LEVEL: Record<Gap['level'], string> = { error: '⛔ 오류', warning: '⚠ 고칠 것', suggest: '💡 채우면 좋은 것' };
const AREA: Record<Gap['area'], string> = { world: '세계', character: '인물', location: '장소', faction: '세력', structure: '구조', check: '검사기' };
const ACTION_LABEL = { scenario: '임무·플래그·결말 탭에서 AI로 추가', encounters: '✦ AI로 조우 만들기', scenes: '장면 탭에서 AI로 추가', rules: '✦ AI로 세계 규칙 만들기', images: '이미지 탭에서 자동 배정', goto: '해당 칸으로 가기' } as const;

export function WorldAudit({ w, settings, onApply, onGoto, onAction, onClose }: {
  w: WorldPackage; settings?: LlmSettings | null;
  onApply: (next: WorldPackage, summary: string) => void;
  onGoto: (path: string) => void;
  onAction: (a: 'scenario' | 'encounters' | 'scenes' | 'rules' | 'images') => void;
  onClose: () => void;
}) {
  const gaps = useMemo(() => scanWorld(w), [w]);
  const fillable = gaps.filter((g) => g.fill);
  const [pick, setPick] = useState<Set<string>>(() => new Set(fillable.map((g) => g.key)));
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [patches, setPatches] = useState<Patch[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const abort = useRef<AbortController | null>(null);

  async function run() {
    if (!settings) return;
    setError(''); setPatches(null); setNotes([]);
    abort.current = new AbortController();
    setStage('AI가 세계를 읽고 있습니다…');
    try {
      const r = await aiFill(createLlmClient(settings), w, gaps.filter((g) => !g.fill || pick.has(g.key)), (d, t) => setStage(`AI가 채울 내용을 쓰는 중… (${d}/${t})`), abort.current.signal);
      setPatches(r.patches); setNotes(r.notes); setChosen(new Set(r.patches.map((p) => p.key)));
    } catch (e) { setError(abort.current.signal.aborted ? '중단했습니다.' : (e as Error).message); }
    finally { setStage(''); }
  }
  function apply() {
    const sel = (patches ?? []).filter((p) => chosen.has(p.key));
    onApply(applyPatches(w, sel), `🩺 AI 점검: ${sel.length}칸을 채웠습니다. 저장을 눌러야 반영됩니다.`);
    setPatches((ps) => (ps ?? []).filter((p) => !chosen.has(p.key)));
  }
  const edit = (key: string, value: string) => setPatches((ps) => (ps ?? []).map((p) => (p.key === key ? { ...p, value } : p)));
  const groups = (['error', 'warning', 'suggest'] as const).map((lv) => [lv, gaps.filter((g) => g.level === lv)] as const).filter(([, gs]) => gs.length);

  return (
    <section className="audit-panel" aria-label="AI 점검·마무리">
      <div className="row"><b>🩺 AI 점검·마무리</b><span className="spacer" /><button type="button" onClick={onClose}>닫기</button></div>
      <p className="small muted">빈칸·자리표시 글("원문에 없음" 등)·빠진 구조·검사기 문제를 찾습니다. 채울 수 있는 칸은 AI가 세계의 다른 설정에 맞춰 제안하고, 고른 것만 적용됩니다 (적용 후 <b>저장</b>해야 반영).</p>
      {gaps.length === 0 ? <p>✔ 찾은 문제가 없습니다.</p> : groups.map(([lv, gs]) => (
        <details key={lv} open={lv !== 'suggest'} className="audit-group">
          <summary><b>{LEVEL[lv]}</b> <span className="small muted">{gs.length}개</span></summary>
          <ul>
            {gs.map((g) => (
              <li key={g.key} className="audit-gap">
                {g.fill ? <label className="check"><input type="checkbox" checked={pick.has(g.key)} onChange={(e) => setPick((s) => { const n = new Set(s); if (e.target.checked) n.add(g.key); else n.delete(g.key); return n; })} />
                  <span><span className="tag">{AREA[g.area]}</span> {g.label} <span className="small muted">— {g.detail}</span></span></label>
                  : <span><span className="tag">{AREA[g.area]}</span> {g.label} <span className="small muted">— {g.detail}</span></span>}
                {g.action && g.action !== 'goto' && <button type="button" className="small" onClick={() => onAction(g.action as 'scenario' | 'encounters' | 'scenes' | 'rules' | 'images')}>{ACTION_LABEL[g.action]}</button>}
                {g.action === 'goto' && g.path && <button type="button" className="small" onClick={() => onGoto(g.path!)}>{ACTION_LABEL.goto}</button>}
              </li>
            ))}
          </ul>
        </details>
      ))}
      <div className="row">
        <button type="button" className="primary" disabled={!settings || !!stage} onClick={() => void run()}>{stage || `✦ AI로 채우기 제안 받기 (${[...pick].filter((k) => fillable.some((g) => g.key === k)).length}칸 + 설정 검토)`}</button>
        {stage && <button type="button" onClick={() => abort.current?.abort()}>중단</button>}
        {!settings && <span className="small muted">AI 설정이 필요합니다.</span>}
      </div>
      {error && <p className="status small">❌ {error}</p>}
      {notes.length > 0 && (
        <div className="audit-notes"><b>AI 검토 메모</b> <span className="small muted">— 자동으로 바꾸지 않습니다. 직접 확인하세요.</span>
          <ul className="small">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>
      )}
      {patches && (
        patches.length === 0 ? <p className="small muted">AI가 채울 내용을 제안하지 않았습니다.</p> : (
          <div className="audit-patches">
            <div className="row"><b>제안 {patches.length}개</b><span className="spacer" />
              <button type="button" className="small" onClick={() => setChosen(new Set(patches.map((p) => p.key)))}>모두 고르기</button>
              <button type="button" className="small" onClick={() => setChosen(new Set())}>모두 빼기</button></div>
            {patches.map((p) => (
              <div key={p.key} className="audit-patch">
                <label className="check"><input type="checkbox" checked={chosen.has(p.key)} onChange={(e) => setChosen((s) => { const n = new Set(s); if (e.target.checked) n.add(p.key); else n.delete(p.key); return n; })} /> <b>{p.label}</b></label>
                {p.before.trim() && <p className="small muted audit-before">지금: {p.before}</p>}
                {p.field === 'character.gender'
                  ? <select value={p.value} onChange={(e) => edit(p.key, e.target.value)}><option value="M">남성</option><option value="F">여성</option></select>
                  : p.field === 'character.class'
                  ? <select value={p.value} onChange={(e) => edit(p.key, e.target.value)}>{classesFor(w).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select>
                  : <textarea rows={Math.min(8, Math.max(2, Math.ceil(p.value.length / 60)))} value={p.value} onChange={(e) => edit(p.key, e.target.value)} />}
                {p.reason && <p className="small muted">근거: {p.reason}</p>}
              </div>
            ))}
            <button type="button" className="primary" disabled={!chosen.size} onClick={apply}>✔ 고른 {chosen.size}개 적용</button>
          </div>
        )
      )}
    </section>
  );
}
