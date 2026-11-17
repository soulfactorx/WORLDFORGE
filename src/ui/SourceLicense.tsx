/**
 * 출처 카드 라이선스 표시 (v0.157): 개인용(라이선스 모름) ↔ 제작자가 허락한 라이선스.
 * 표시는 기록일 뿐 권리를 만들지 않는다 — 허락을 확인했다는 체크를 받아야 표시한다.
 */
import { useState } from 'react';
import { LICENSES } from '../engine/licensing';
import type { SourceCard } from '../engine/schema';

export function SourceLicense({ src, onChange }: { src: SourceCard; onChange: (l: SourceCard['license'] | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const [spdx, setSpdx] = useState(src.license?.spdx ?? LICENSES[0]![0]);
  const [attr, setAttr] = useState(src.license?.attribution ?? `${src.name}${src.creator ? ` — ${src.creator}` : ''}`);
  const [ok, setOk] = useState(false);
  if (src.license) return (
    <span className="source-license">
      <span className="small">✅ {LICENSES.find(([v]) => v === src.license!.spdx)?.[1] ?? src.license.spdx}{src.license.attribution ? ` · 출처 표시: ${src.license.attribution}` : ''}</span>
      <button type="button" className="small" onClick={() => { if (confirm('개인용(라이선스 모름)으로 되돌릴까요? 이 카드에서 온 것은 다시 내보내기에서 빠집니다.')) onChange(undefined); }}>개인용으로 되돌리기</button>
    </span>
  );
  return (
    <span className="source-license">
      <span className="small">🔒 개인용 (라이선스 모름)</span>
      <button type="button" className="small" aria-expanded={open} onClick={() => setOpen((v) => !v)}>라이선스 표시…</button>
      {open && (
        <span className="source-license-form">
          <label>라이선스<select value={spdx} onChange={(e) => setSpdx(e.target.value)}>{LICENSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label>출처 표시 (내보낸 세계에 함께 간다)<input value={attr} onChange={(e) => setAttr(e.target.value)} /></label>
          <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> 카드 제작자가 이 조건으로 허락한 것을 확인했습니다 (카드 속 그림의 권리 포함)</label>
          <button type="button" className="small" disabled={!ok || !attr.trim()} onClick={() => { onChange({ spdx, attribution: attr.trim(), confirmedAt: new Date().toISOString() }); setOpen(false); setOk(false); }}>표시하기</button>
        </span>
      )}
    </span>
  );
}
