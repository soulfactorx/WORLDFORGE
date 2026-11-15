/** 이어서 만들기 (v0.126): 홈에서 저장하지 않은 세계관 편집 초안과 마법사 초안을 보여 준다 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { EditorDraft } from '../storage/db';
import { db } from '../storage/db';
import { deleteEditorDraft, loadWizard, storeWizard, wizardHasContent } from '../storage/drafts';

const ago = (t?: number) => {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : new Date(t).toLocaleDateString();
};

export function DraftBanner({ onEditor, onWizard }: { onEditor: (d: EditorDraft) => void; onWizard: () => void }) {
  const drafts = useLiveQuery(() => db.drafts.orderBy('savedAt').reverse().toArray().catch(() => [] as EditorDraft[]), []) ?? [];
  const [wiz, setWiz] = useState(loadWizard);
  const hasWiz = !!wiz && wizardHasContent(wiz.draft);
  if (!drafts.length && !hasWiz) return null;
  return (
    <section className="panel draft-list" aria-label="이어서 만들기">
      <h3>✎ 이어서 만들기</h3>
      <p className="small muted">저장하지 않고 나간 세계관입니다. 앱이 꺼졌거나 뒤로 가기를 눌렀어도 여기 남아 있습니다.</p>
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
        {drafts.map((d) => (
          <li key={d.id}>
            <div className="draft-info"><b>✎ {d.name}</b><span className="small muted">편집기 · 저장 안 됨 · {ago(d.savedAt)}</span></div>
            <div className="row">
              <button type="button" className="primary" onClick={() => onEditor(d)}>이어서 편집</button>
              <button type="button" aria-label={`${d.name} 초안 버리기`} onClick={() => { if (confirm(`「${d.name}」의 저장하지 않은 내용을 버릴까요? 되돌릴 수 없습니다.`)) void deleteEditorDraft(d.id); }}>🗑</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
