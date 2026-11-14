/**
 * 플레이 AI 모델 (v0.119~)
 *  - PlayModelsFieldset: 제작자가 세계의 플레이 기본 모델을 정한다 (편집기 기본 탭)
 *  - PlayModelPanel: 플레이어가 플레이 중에 언제든 제공자·모델을 바꾼다 (세이브마다, 이 브라우저에만) — 다음 턴부터 쓰인다
 */
import { ANTHROPIC_MODELS } from '../llm';
import { playSettings, type RouteOverrides, type SaveModelChoice, worldPlayRoutes, withRoutes } from '../llm/override';
import { modelsInUse, providerLabel, providersOf, resolveRoute } from '../llm/providers';
import { ROLE_GROUP_LABEL, type LlmSettings } from '../llm/types';
import type { WorldPackage } from '../engine/schema';
import { ONE_CALL_GROUP } from '../gm/turnOne';
import { ModelPicker } from './ModelPicker';
import { loadPlayPrefs } from './playPrefs';

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
      <p className="small muted">이 세계를 플레이할 때 먼저 쓸 모델입니다. 비우면 플레이어의 AI 설정을 따릅니다. 플레이어의 설정에 등록된 제공자로 이 이름의 모델을 요청하므로, 제공자마다 다른 이름(예: OpenRouter는 <code>anthropic/…</code>)에 주의하세요. 플레이어는 플레이 중에 언제든 제공자와 모델을 바꿀 수 있습니다.</p>
      {ROLES.map(([k, label]) => (
        <label key={k}>{label}
          <input value={pm[k] ?? ''} list="play-model-list" placeholder={settings ? `(비움: 플레이어 설정 — 지금 내 설정은 ${resolveRoute(settings, k).model})` : '(비움: 플레이어 설정)'} onChange={(e) => up(k, e.target.value)} />
        </label>
      ))}
      <datalist id="play-model-list">{known.map((m) => <option key={m} value={m} />)}</datalist>
    </fieldset>
  );
}

/** 지금 이 세이브에서 매 턴 쓰는 AI 한 줄 (🤖 버튼 · 패널) */
export function turnAiLine(settings: LlmSettings, world: WorldPackage, choice: SaveModelChoice): { provider: string; model: string; source: string } {
  const now = playSettings(settings, world.playModels, choice);
  const g = loadPlayPrefs().turnMode === 'precise' ? 'narrator' : ONE_CALL_GROUP;
  const r = resolveRoute(now, g);
  const source = choice.mode === 'custom' && (choice.routes?.[g]?.provider || choice.routes?.[g]?.model) ? '이 세이브에서 고름'
    : choice.mode !== 'mine' && world.playModels?.[g] ? '세계가 추천'
    : `AI 설정의 「${ROLE_GROUP_LABEL[g].split(' (')[0]}」 묶음`;
  return { provider: r.provider.name || providerLabel(r.provider), model: r.model, source };
}

export function PlayModelPanel({ world, settings, choice, onChange }: { world: WorldPackage; settings: LlmSettings; choice: SaveModelChoice; onChange: (c: SaveModelChoice) => void }) {
  const hasWorld = Object.keys(worldPlayRoutes(world.playModels)).length > 0;
  const precise = loadPlayPrefs().turnMode === 'precise';
  const base = choice.mode === 'mine' ? settings : withRoutes(settings, worldPlayRoutes(world.playModels));
  const routes: RouteOverrides = choice.mode === 'custom' ? choice.routes ?? {} : {};
  const g = ONE_CALL_GROUP;
  const def = resolveRoute(base, g);
  const r = routes[g] ?? {};
  const list = providersOf(settings);
  const p = list.find((x) => x.id === r.provider) ?? def.provider;
  const name = (x: (typeof list)[number]) => x.name || providerLabel(x);
  const line = turnAiLine(settings, world, choice);
  const known = [...new Set([...ANTHROPIC_MODELS, ...modelsInUse(settings), ...(world.playModels?.narrator ? [world.playModels.narrator] : [])])];
  const setMain = (x: { provider?: string; model?: string }) => onChange({ mode: 'custom', routes: { ...routes, [g]: { ...r, ...x } } });
  return (
    <div className="play-model-panel">
      <div className="turn-ai">
        <b>매 턴 쓰는 AI {precise ? '(정확 모드: 이 AI는 서술, 판단·인물 연기는 아래)' : '(빠른 턴: 한 번 호출로 판단·대사·서술·선택지 전부)'}</b>
        <p className="small"><b>{line.provider}</b> · <code>{line.model}</code> <span className="muted">— {line.source}</span></p>
      </div>
      <div className="role-pick">
        <label>제공자
          <select value={list.some((x) => x.id === r.provider) ? r.provider : ''} onChange={(e) => setMain({ provider: e.target.value || undefined, model: '' })}>
            <option value="">(기본: {name(def.provider)})</option>
            {list.map((x) => <option key={x.id} value={x.id}>{name(x)}</option>)}
          </select>
        </label>
        <label>모델
          {p.provider === 'anthropic' ? (
            <select value={r.model ?? ''} onChange={(e) => setMain({ model: e.target.value })}>
              <option value="">(기본: {r.provider ? p.model : def.model})</option>
              {ANTHROPIC_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <>
              <input value={r.model ?? ''} list="play-turn-models" placeholder={`(기본: ${r.provider ? p.model : def.model})`} onChange={(e) => setMain({ model: e.target.value })} />
              <datalist id="play-turn-models">{known.map((m) => <option key={m} value={m} />)}</datalist>
            </>
          )}
        </label>
      </div>
      <div className="row model-modes">
        {hasWorld && <button type="button" className={choice.mode === 'world' ? 'primary' : ''} onClick={() => onChange({ mode: 'world' })}>세계 추천으로 ({world.playModels?.narrator ?? '—'})</button>}
        <button type="button" className={choice.mode === 'mine' ? 'primary' : ''} onClick={() => onChange({ mode: 'mine' })}>내 AI 설정대로</button>
      </div>
      <ModelPicker settings={settings} base={base} groups={['judge', 'actor']} value={routes} onChange={(v) => onChange({ mode: 'custom', routes: { ...routes, judge: v.judge ?? {}, actor: v.actor ?? {} } })}
        title="그 밖의 역할" note={`GM 판단·기록: 정확 모드에서 매 턴, 빠른 턴에서는 8턴마다 이야기 요약 · 인물 연기: 정확 모드에서만.${precise ? '' : ' 지금은 빠른 턴이라 거의 쓰이지 않습니다.'}`} />
      <p className="small muted">다음 턴부터 쓰입니다. 이 세이브에만, 이 브라우저에만 기억합니다. 턴 방식(빠르게·정확하게)은 소리·화면 설정에서 바꿉니다.</p>
    </div>
  );
}
