/**
 * 이어서 만들기 (v0.126 · v0.131): 홈에서 저장하지 않은 세계관 편집 초안과 마법사 초안을 보여 준다.
 * v0.131: 저장본이 있는 초안은 저장본과 비교한다 — 같으면 저절로 정리하고, 다르면 몇 곳이 다른지 보이고 골라서 합칠 수 있다.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import type { WorldPackage } from '../engine/schema';
import { diffWorlds } from '../gm/worldDiff';
import type { EditorDraft } from '../storage/db';
import { db } from '../storage/db';
import { deleteEditorDraft, loadWizard, storeWizard, wizardHasContent } from '../storage/drafts';
import { listPackages } from '../storage/packages';
import { DraftMerge } from './DraftMerge';

const ago = (t?: number) => {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : new Date(t).toLocaleDateString();
};

interface Saved { world: WorldPackage; at: number }

export function DraftBanner({ onEditor, onWizard }: { onEditor: (d: EditorDraft) => void; onWizard: () => void }) {
  const drafts = useLiveQuery(() => db.drafts.orderBy('savedAt').reverse().toArray().catch(() => [] as EditorDraft[]), []) ?? [];
  const [wiz, setWiz] = useState(loadWizard);
  const [saved, setSaved] = useState<Map<string, Saved>>(new Map());
  const [merge, setMerge] = useState<EditorDraft | null>(null);
  // 저장본 (같은 세계 ID의 가장 최근 것)
  useEffect(() => {
    void listPackages().then((ps) => {
      const m = new Map<string, Saved>();
      for (const p of ps) { if (p.builtin) continue; const at = p.stored?.updatedAt ?? 0; const cur = m.get(p.world.manifest.id); if (!cur || at > cur.at) m.set(p.world.manifest.id, { world: p.world, at }); }
      setSaved(m);
    }).catch(() => {});
  }, [drafts.length]);
  const diffOf = (d: EditorDraft) => { const s = saved.get(d.world.manifest.id); return s ? diffWorlds(s.world, d.world, d.origin).length : -1; };
  // 저장본과 다른 곳이 없는 초안은 잃을 것이 없으니 정리한다
  useEffect(() => { for (const d of drafts) if (saved.size && diffOf(d) === 0) void deleteEditorDraft(d.id); }, [drafts, saved]);
  const shown = drafts.filter((d) => diffOf(d) !== 0);
  const hasWiz = !!wiz && wizardHasContent(wiz.draft);
  if (!shown.length && !hasWiz) return null;
  return (
    <section className="panel draft-list" aria-label="이어서 만들기">
      <h3>✎ 이어서 만들기</h3>
      <p className="small muted">저장하지 않고 나간 세계관입니다. 앱이 꺼졌거나 뒤로 가기를 눌렀어도 여기 남아 있습니다. 같은 세계를 따로 고쳐 저장했다면, 초안에서 필요한 것만 <b>골라서 합칠</b> 수 있습니다.</p>
      <ul>
        {hasWiz && (
          <li>
            <div className="draft-info"><b>🧭 {wiz!.draft.name || '이름 없는 세계'}</b><span className="small muted">마법사 {wiz!.step + 1}단계 · {ago(wiz!.savedAt)}</span></div>
            <div className="row">
              <button type="button" className="primary" onClick={onWizard}>이어서 만들기</button>
              <button type="button" aria-label="마법사 초안 버리기" onClick={() => { if (confirm('마법사에서 만들던 내용을 버릴까요? 되돌릴 수 없습니다.')) { storeWizard(null); setWiz(null); } }}>🗑</button>
            </div>
          </li>
        )}
        {shown.map((d) => {
          const s = saved.get(d.world.manifest.id);
          const n = diffOf(d);
          const newer = !!s && s.at > d.savedAt;
          return (
            <li key={d.id}>
              <div className="draft-info">
                <b>✎ {d.name}</b>
                <span className="small muted">{s ? `저장본과 다른 곳 ${n}곳${newer ? ' · 초안 뒤에 저장본을 고쳤음' : ''}` : '새 세계 · 아직 저장한 적 없음'} · {ago(d.savedAt)}</span>
              </div>
              <div className="row">
                {s && <button type="button" className="primary" onClick={() => setMerge(d)} title="초안에서 가져올 것을 항목마다 고른다">🔀 골라서 합치기</button>}
                <button type="button" className={s ? '' : 'primary'} onClick={() => {
                  if (newer && !confirm('초안 그대로 열면, 저장할 때 그 뒤에 저장본에서 고친 것을 덮어씁니다. 필요한 것만 가져오려면 「골라서 합치기」를 쓰세요. 그래도 초안 그대로 열까요?')) return;
                  onEditor(d);
                }}>{s ? '초안 그대로 열기' : '이어서 편집'}</button>
                <button type="button" aria-label={`${d.name} 초안 버리기`} onClick={() => { if (confirm(`「${d.name}」의 저장하지 않은 내용을 버릴까요? 되돌릴 수 없습니다.`)) void deleteEditorDraft(d.id); }}>🗑</button>
              </div>
            </li>
          );
        })}
      </ul>
      {merge && saved.get(merge.world.manifest.id) && (
        <DraftMerge base={saved.get(merge.world.manifest.id)!.world} draft={merge.world} origin={merge.origin} draftAt={merge.savedAt} applyLabel="합쳐서 편집기에서 열기" onClose={() => setMerge(null)}
          onApply={(merged) => { const d = merge; const base = saved.get(d.world.manifest.id)!.world; setMerge(null); onEditor({ ...d, world: merged, origin: base }); }} />
      )}
    </section>
  );
}
