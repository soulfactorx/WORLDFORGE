/**
 * 여러 제공자와 역할별 연결 (v0.101) — 순수 함수.
 * 제공자를 여러 개 등록하고, 역할 묶음(GM 판단 · NPC 연기 · 서술 · 만들기)마다 어느 제공자의 어느 모델을 쓸지 정한다.
 * 예전 설정(제공자 하나 + roleModels)은 그대로 읽힌다.
 */
import { type LlmProvider, type LlmSettings, ROLE_GROUPS, type RoleGroup, type RoleRoute } from './types';

export const LEGACY_ID = 'default';

/** 등록된 제공자 목록 (예전 설정이면 하나) */
export function providersOf(s: LlmSettings): LlmProvider[] {
  if (s.providers?.length) return s.providers;
  return [{ id: LEGACY_ID, name: providerLabel(s), provider: s.provider, apiKey: s.apiKey, model: s.model, ...(s.baseUrl ? { baseUrl: s.baseUrl } : {}) }];
}

/** 기본 제공자 */
export function defaultProviderOf(s: LlmSettings): LlmProvider {
  const list = providersOf(s);
  return list.find((p) => p.id === s.defaultProvider) ?? list[0]!;
}

/** 역할 묶음의 설정 (예전 roleModels 포함) */
export function roleRouteOf(s: LlmSettings, g: RoleGroup): RoleRoute {
  const r = s.roles?.[g];
  if (r) return r;
  const m = s.roleModels?.[g]?.trim();
  return m ? { model: m } : {};
}

/** 이 역할 묶음에 실제로 쓰이는 제공자와 모델. 지운 제공자를 가리키면 기본 제공자로 돌아간다 */
export function resolveRoute(s: LlmSettings, g: RoleGroup): { provider: LlmProvider; model: string } {
  const own = roleRouteOf(s, g);
  // 인물 찾기·번역·이미지는 따로 정하지 않으면 세계 설계의 설정을 따른다
  const r = (g === 'extract' || g === 'bulk') && !own.provider && !own.model?.trim() ? roleRouteOf(s, 'build') : own;
  const def = defaultProviderOf(s);
  const provider = (r.provider ? providersOf(s).find((p) => p.id === r.provider) : undefined) ?? def;
  return { provider, model: r.model?.trim() || provider.model };
}

/** 이름이 없을 때 보일 이름 */
export function providerLabel(p: Pick<LlmProvider, 'provider' | 'baseUrl'>): string {
  if (p.provider === 'anthropic') return 'Anthropic (Claude)';
  const host = (p.baseUrl ?? 'https://api.openai.com/v1').replace(/^https?:\/\//, '').split('/')[0] ?? '';
  if (/openrouter\.ai$/i.test(host)) return 'OpenRouter';
  if (/openai\.com$/i.test(host)) return 'OpenAI';
  if (/:11434$/.test(host)) return 'Ollama (로컬)';
  if (/:1234$/.test(host)) return 'LM Studio (로컬)';
  return host || 'OpenAI 호환';
}

/** 저장할 설정을 만든다: 맨 위 칸에는 기본 제공자의 사본을 둔다 (이 칸만 보는 코드가 그대로 돌게) */
export function buildSettings(providers: LlmProvider[], defaultProvider: string, roles: Partial<Record<RoleGroup, RoleRoute>>): LlmSettings {
  const def = providers.find((p) => p.id === defaultProvider) ?? providers[0]!;
  const ids = new Set(providers.map((p) => p.id));
  const clean: Partial<Record<RoleGroup, RoleRoute>> = {};
  for (const [g, r] of Object.entries(roles) as [RoleGroup, RoleRoute][]) {
    const provider = r.provider && ids.has(r.provider) && r.provider !== def.id ? r.provider : undefined;
    const model = r.model?.trim() || undefined;
    if (provider || model) clean[g] = { ...(provider ? { provider } : {}), ...(model ? { model } : {}) };
  }
  return {
    provider: def.provider, apiKey: def.apiKey, model: def.model, ...(def.baseUrl ? { baseUrl: def.baseUrl } : {}),
    providers, defaultProvider: def.id, ...(Object.keys(clean).length ? { roles: clean } : {}),
  };
}

/** 지금 설정에서 쓰이는 모든 모델 (단가 입력·기록 거르기용) */
export function modelsInUse(s: LlmSettings): string[] {
  return [...new Set([defaultProviderOf(s).model, ...ROLE_GROUPS.map((g) => resolveRoute(s, g).model)])].filter(Boolean);
}

/** 역할별로 다른 것을 쓰면 그 요약 (품질 점검 이름표) */
export function routeSummary(s: LlmSettings): string {
  const def = defaultProviderOf(s);
  const diff = ROLE_GROUPS.flatMap((g) => { const r = resolveRoute(s, g); return r.provider.id !== def.id || r.model !== def.model ? [`${g}:${r.provider.id !== def.id ? `${r.provider.name}/` : ''}${r.model}`] : []; });
  return diff.length ? `${def.model} (+${diff.join(', ')})` : def.model;
}
