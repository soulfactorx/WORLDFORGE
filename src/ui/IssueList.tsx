import type { Issue } from '../engine/package/validate';

export function IssueList({ issues, onPick, limit = 50 }: { issues: Issue[]; onPick?: (path: string) => void; limit?: number }) {
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  return (
    <div className="issues">
      <p className="small"><b className="err">오류 {errors.length}</b> · <b className="warn">경고 {warnings.length}</b></p>
      <ul>
        {[...errors, ...warnings].slice(0, limit).map((i, n) => (
          <li key={n} className={`small ${i.level}`}>
            <span className="tag">{i.level === 'error' ? '오류' : '경고'}</span>{' '}
            {onPick ? <button type="button" className="link" onClick={() => onPick(i.path)}>{i.path || '(전체)'}</button> : <code>{i.path}</code>} — {i.message}
          </li>
        ))}
      </ul>
      {errors.length + warnings.length > limit && <p className="small muted">외 {errors.length + warnings.length - limit}개</p>}
    </div>
  );
}
