/** 편집기 공용 입력 컴포넌트 */
import { useState } from 'react';

// ---------------------------------------------------------------- 작은 입력 컴포넌트

export const Text = ({ label, value, onChange, placeholder }: { label: string; value: string | undefined; onChange: (v: string) => void; placeholder?: string }) => (
  <label>{label}<input value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></label>
);
export const Area = ({ label, value, onChange, rows = 3 }: { label: string; value: string | undefined; onChange: (v: string) => void; rows?: number }) => (
  <label>{label}<textarea rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} /></label>
);
export const Num = ({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void }) => (
  <label>{label}<input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} /></label>
);
export function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T | undefined; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <label>{label}
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value as T)}>
        {value === undefined && <option value="">(선택)</option>}
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

/** JSON으로 값 하나를 편집 (파싱 오류는 표시만 하고 반영하지 않는다) */
export function JsonField<T>({ label, value, onChange, rows = 10, help }: { label: string; value: T; onChange: (v: T) => void; rows?: number; help?: string }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
  const [error, setError] = useState('');
  const [last, setLast] = useState(value);
  if (value !== last) { setLast(value); setText(JSON.stringify(value ?? null, null, 2)); setError(''); }
  return (
    <label>{label}
      {help && <span className="muted small">{help}</span>}
      <textarea className="code" rows={rows} value={text} spellCheck={false} onChange={(e) => {
        setText(e.target.value);
        try { const v = JSON.parse(e.target.value) as T; setError(''); setLast(v); onChange(v); } catch (er) { setError((er as Error).message); }
      }} />
      {error && <span className="small err">JSON 오류: {error}</span>}
    </label>
  );
}

/** 목록 + 선택한 항목 편집 */
export function ItemList<T extends { id: string }>({ items, onChange, make, render, title }: {
  items: T[]; onChange: (items: T[]) => void; make: (n: number) => T; render: (item: T, set: (patch: Partial<T>) => void) => React.ReactNode; title: string;
}) {
  const [sel, setSel] = useState(0);
  const cur = items[sel];
  return (
    <div className="item-list">
      <div className="items">
        {items.map((it, i) => (
          <button key={i} type="button" className={i === sel ? 'primary' : ''} onClick={() => setSel(i)}>{it.id || '(ID 없음)'}</button>
        ))}
        <button type="button" onClick={() => { onChange([...items, make(items.length + 1)]); setSel(items.length); }}>＋ {title} 추가</button>
      </div>
      {cur && (
        <div className="item-form">
          {render(cur, (patch) => onChange(items.map((x, i) => (i === sel ? { ...x, ...patch } : x))))}
          <div className="row">
            <span className="spacer" />
            <button type="button" onClick={() => { if (confirm(`"${cur.id}"을(를) 삭제할까요?`)) { onChange(items.filter((_, i) => i !== sel)); setSel(Math.max(0, sel - 1)); } }}>삭제</button>
          </div>
        </div>
      )}
    </div>
  );
}

