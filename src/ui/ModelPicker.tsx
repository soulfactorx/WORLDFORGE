/**
 * AI 모델 고르기 (v0.119): 설정에 지정된 값을 보여 주고, 이 작업(세계 만들기·카드 변환·편집기·플레이)에서만 바꾼다.
 * 설정 자체는 바꾸지 않는다.
 */
import { ANTHROPIC_MODELS } from '../llm';
import { type RouteOverrides, withRoutes } from '../llm/override';
import { modelsInUse, providerLabel, providersOf, resolveRoute } from '../llm/providers';
import type { LlmSettings, RoleGroup, RoleRoute } from '../llm/types';

export const GROUP_SHORT: Record<RoleGroup, string> = { judge: 'GM 판단·기록', actor: '인물 연기', narrator: '서술 (플레이의 중심)', build: '세계 설계', extract: '인물 찾기', bulk: '번역·이미지 분류' };

export function ModelPicker({ settings, groups, value, onChange, title = '🤖 AI 모델', note, base }: {
  settings: LlmSettings; groups: RoleGroup[]; value: RouteOverrides; onChange: (v: RouteOverrides) => void;
  title?: string; note?: string;
  /** "기본"으로 보일 설정 (예: 세계 추천이 얹힌 설정). 비우면 settings */
  base?: LlmSettings;
}) {
  const from = base ?? settings;
  const now = withRoutes(from, value);
  const list = providersOf(settings);
  const name = (p: { name?: string; provider: LlmSettings['provider']; baseUrl?: string }) => p.name || providerLabel(p);
  const changed = groups.some((g) => value[g]?.provider || value[g]?.model?.trim());
  const set = (g: RoleGroup, r: RoleRoute) => onChange({ ...value, [g]: { ...value[g], ...r } });
  const known = [...new Set([...ANTHROPIC_MODELS, ...modelsInUse(settings)])];
  return (
    <details className="model-picker" open={changed}>
      <summary className="small"><b>{title}</b> — {groups.map((g) => { const r = resolveRoute(now, g); return `${GROUP_SHORT[g]}: ${r.model}`; }).join(' · ')}{changed ? ' (바꿈)' : ' (설정대로)'}</summary>
      {note && <p className="small muted">{note}</p>}
      {groups.map((g) => {
        const def = resolveRoute(from, g);
        const r = value[g] ?? {};
        const p = list.find((x) => x.id === r.provider) ?? def.provider;
        return (
          <div key={g} className="role-pick">
            <span className="struct-label">{GROUP_SHORT[g]}</span>
            <label>제공자
              <select value={list.some((x) => x.id === r.provider) ? r.provider : ''} onChange={(e) => set(g, { provider: e.target.value || undefined, model: '' })}>
                <option value="">(기본: {name(def.provider)})</option>
                {list.map((x) => <option key={x.id} value={x.id}>{name(x)}</option>)}
              </select>
            </label>
            <label>모델
              {p.provider === 'anthropic' ? (
                <select value={r.model ?? ''} onChange={(e) => set(g, { model: e.target.value })}>
                  <option value="">(기본: {r.provider ? p.model : def.model})</option>
                  {ANTHROPIC_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <>
                  <input value={r.model ?? ''} list={`models-${g}`} placeholder={`(기본: ${r.provider ? p.model : def.model})`} onChange={(e) => set(g, { model: e.target.value })} />
                  <datalist id={`models-${g}`}>{known.map((m) => <option key={m} value={m} />)}</datalist>
                </>
              )}
            </label>
          </div>
        );
      })}
      {changed && <div className="row"><button type="button" className="small" onClick={() => onChange({})}>기본으로 되돌리기</button></div>}
    </details>
  );
}
