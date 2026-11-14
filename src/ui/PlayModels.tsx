/**
 * 플레이 AI 모델 (v0.119)
 *  - PlayModelsFieldset: 제작자가 세계의 플레이 기본 모델을 정한다 (편집기 기본 탭)
 *  - PlayModelPanel: 플레이어가 플레이 중에 언제든 바꾼다 (세이브마다, 이 브라우저에만) — 다음 턴부터 쓰인다
 */
import { ANTHROPIC_MODELS } from '../llm';
import { playSettings, type SaveModelChoice, worldPlayRoutes, withRoutes } from '../llm/override';
import { modelsInUse, resolveRoute } from '../llm/providers';
import type { LlmSettings } from '../llm/types';
import type { WorldPackage } from '../engine/schema';
import { GROUP_SHORT, ModelPicker } from './ModelPicker';

const ROLES = [['narrator', '서술 (빠른 턴 방식에서는 판단·대사·서술·선택지 전부)'], ['judge', 'GM 판단·기록 (정확 모드)'], ['actor', '인물 연기 (정확 모드)']] as const;

export function PlayModelsFieldset({ w, set, settings }: { w: WorldPackage; set: (p: Partial<WorldPackage>) => void; settings?: LlmSettings | null }) {
  const pm = w.playModels ?? {};
  const known = [...new Set([...ANTHROPIC_MODELS, ...(settings ? modelsInUse(settings) : [])])];
  const up = (k: 'narrator' | 'judge' | 'actor', v: string) => {
    const n = { ...pm, [k]: v.trim() || undefined };
    for (const x of Object.keys(n) as (keyof typeof n)[]) if (!n[x]) delete n[x];
    set({ playModels: Object.keys(n).length ? n : undefined });
  };
  return (
    <fieldset className="play-models"><legend>플레이 기본 AI 모델 (제작자 추천)</legend>
      <p className="small muted">이 세계를 플레이할 때 먼저 쓸 모델입니다. 비우면 플레이어의 AI 설정을 따릅니다. 플레이어의 설정에 등록된 제공자로 이 이름의 모델을 요청하므로, 제공자마다 다른 이름(예: OpenRouter는 <code>anthropic/…</code>)에 주의하세요. 플레이어는 플레이 중에 언제든 바꿀 수 있습니다.</p>
      {ROLES.map(([k, label]) => (
        <label key={k}>{label}
          <input value={pm[k] ?? ''} list="play-model-list" placeholder={settings ? `(비움: 플레이어 설정 — 지금 내 설정은 ${resolveRoute(settings, k).model})` : '(비움: 플레이어 설정)'} onChange={(e) => up(k, e.target.value)} />
        </label>
      ))}
      <datalist id="play-model-list">{known.map((m) => <option key={m} value={m} />)}</datalist>
    </fieldset>
  );
}

export function PlayModelPanel({ world, settings, choice, onChange }: { world: WorldPackage; settings: LlmSettings; choice: SaveModelChoice; onChange: (c: SaveModelChoice) => void }) {
  const hasWorld = Object.keys(worldPlayRoutes(world.playModels)).length > 0;
  const now = playSettings(settings, world.playModels, choice);
  return (
    <div className="play-model-panel">
      <p className="small">지금 쓰는 모델 — {(['narrator', 'judge', 'actor'] as const).map((g) => `${GROUP_SHORT[g]}: ${resolveRoute(now, g).model}`).join(' · ')}</p>
      <div className="row model-modes" role="radiogroup" aria-label="모델 고르기 방식">
        <label className="check"><input type="radio" checked={choice.mode === 'world'} onChange={() => onChange({ ...choice, mode: 'world' })} /> {hasWorld ? '세계가 추천한 모델' : '세계 추천 (없음 — 내 설정과 같음)'}</label>
        <label className="check"><input type="radio" checked={choice.mode === 'mine'} onChange={() => onChange({ ...choice, mode: 'mine' })} /> 내 AI 설정 그대로</label>
        <label className="check"><input type="radio" checked={choice.mode === 'custom'} onChange={() => onChange({ mode: 'custom', routes: choice.routes ?? {} })} /> 직접 고르기</label>
      </div>
      {choice.mode === 'custom' && (
        <ModelPicker settings={settings} base={withRoutes(settings, worldPlayRoutes(world.playModels))} groups={['narrator', 'judge', 'actor']} value={choice.routes ?? {}} onChange={(routes) => onChange({ mode: 'custom', routes })} title="이 세이브의 모델" />
      )}
      <p className="small muted">다음 턴부터 쓰입니다. 이 세이브에만, 이 브라우저에만 기억합니다.</p>
    </div>
  );
}
