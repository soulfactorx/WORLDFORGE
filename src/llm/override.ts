/**
 * 모델 덮어쓰기 (v0.119): 설정의 역할별 연결 위에, 화면(세계 만들기·편집기)·세계(플레이 기본)·세이브(플레이어 선택)가
 * 역할 묶음의 제공자·모델을 잠시 바꾼다. 설정 자체는 바꾸지 않는다.
 */
import { providersOf, resolveRoute, roleRouteOf } from './providers';
import { type LlmSettings, ROLE_GROUPS, type RoleGroup, type RoleRoute } from './types';

export type RouteOverrides = Partial<Record<RoleGroup, RoleRoute>>;

const clean = (r: RoleRoute | undefined): RoleRoute | undefined => {
  const provider = r?.provider?.trim() || undefined;
  const model = r?.model?.trim() || undefined;
  return provider || model ? { ...(provider ? { provider } : {}), ...(model ? { model } : {}) } : undefined;
};

/** 설정 + 덮어쓰기. 덮어쓰기의 제공자가 없으면 그 역할의 원래 제공자를 그대로 쓰고 모델만 바꾼다 */
export function withRoutes(s: LlmSettings, over: RouteOverrides | undefined): LlmSettings {
  if (!over || !Object.values(over).some((r) => clean(r))) return s;
  const ids = new Set(providersOf(s).map((p) => p.id));
  const roles: Partial<Record<RoleGroup, RoleRoute>> = {};
  for (const g of ROLE_GROUPS) {
    const o = clean(over[g]);
    const base = roleRouteOf(s, g);
    if (!o) { if (clean(base)) roles[g] = base; continue; }
    const provider = o.provider && ids.has(o.provider) ? o.provider : resolveRoute(s, g).provider.id;
    roles[g] = { provider, ...(o.model ? { model: o.model } : o.provider ? {} : base.model ? { model: base.model } : {}) };
  }
  return { ...s, roles };
}

/** 세계가 정한 플레이 기본 모델 → 덮어쓰기 (제공자는 플레이어의 설정 그대로) */
export function worldPlayRoutes(models: { narrator?: string; judge?: string; actor?: string } | undefined): RouteOverrides {
  const out: RouteOverrides = {};
  for (const g of ['narrator', 'judge', 'actor'] as const) { const m = models?.[g]?.trim(); if (m) out[g] = { model: m }; }
  return out;
}

// ---------------------------------------------------------------- 세이브마다 플레이어가 고른 모델 (이 브라우저에만)

export interface SaveModelChoice {
  /** world = 세계가 추천한 모델(없으면 내 설정) · mine = 내 설정 그대로 · custom = 직접 고른 것 */
  mode: 'world' | 'mine' | 'custom';
  routes?: RouteOverrides;
}
const key = (saveId: string) => `worldforge.saveModels.${saveId}`;
export function loadSaveModels(saveId: string): SaveModelChoice {
  try { const v = JSON.parse(localStorage.getItem(key(saveId)) ?? 'null') as SaveModelChoice | null; return v && (v.mode === 'world' || v.mode === 'mine' || v.mode === 'custom') ? v : { mode: 'world' }; } catch { return { mode: 'world' }; }
}
export function saveSaveModels(saveId: string, c: SaveModelChoice) { try { localStorage.setItem(key(saveId), JSON.stringify(c)); } catch { /* 무시 */ } }

/** 플레이에 쓸 설정: 내 설정 < 세계 추천 < 세이브에서 고른 것 */
export function playSettings(s: LlmSettings, worldModels: { narrator?: string; judge?: string; actor?: string } | undefined, choice: SaveModelChoice): LlmSettings {
  if (choice.mode === 'mine') return s;
  if (choice.mode === 'custom') return withRoutes(withRoutes(s, worldPlayRoutes(worldModels)), choice.routes);
  return withRoutes(s, worldPlayRoutes(worldModels));
}
