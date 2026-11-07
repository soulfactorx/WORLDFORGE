/**
 * 주인공 성향 (v0.69): 세계마다 축을 정하고(예: 자비 ↔ 냉혹), 시작할 때 기울기를 고르고,
 * 플레이 중 행동에 따라 GM 판단 AI가 움직이며(한 턴 ±10까지), 임무·줄기·선택·결말의 조건이 읽는다.
 */
import type { CharacterSheet } from './character/sheet';
import type { TraitAxis, WorldPackage } from './schema';

export const TRAIT_PRESETS: Record<string, TraitAxis[]> = {
  high_fantasy: [{ id: 'good', name: '선악', low: '악', high: '선' }, { id: 'law', name: '질서', low: '혼돈', high: '질서' }],
  wuxia: [{ id: 'justice', name: '정사', low: '사파', high: '정파' }, { id: 'loyalty', name: '의리', low: '실리', high: '의리' }],
  romance: [{ id: 'warmth', name: '온기', low: '냉정', high: '다정' }, { id: 'boldness', name: '대담함', low: '신중', high: '대담' }],
  fighting: [{ id: 'honor', name: '정정당당', low: '비열', high: '정정당당' }, { id: 'drive', name: '투지', low: '냉철', high: '투지' }],
};
export const MAX_SHIFT = 10;

/** 이 세계의 성향 축 (세계 정의 → 장르 기본) */
export function traitsFor(world: Pick<WorldPackage, 'traits' | 'genre'>): TraitAxis[] {
  if (world.traits) return world.traits;
  return TRAIT_PRESETS[world.genre?.id ?? 'high_fantasy'] ?? TRAIT_PRESETS.high_fantasy!;
}
export const clampTrait = (v: number) => Math.max(-100, Math.min(100, Math.round(v)));
/** 지금 값 */
export function traitValue(world: Pick<WorldPackage, 'traits' | 'genre'>, sheet: Pick<CharacterSheet, 'traits'>, id: string): number {
  return sheet.traits?.[id] ?? traitsFor(world).find((t) => t.id === id)?.initial ?? 0;
}
/** 말로 (예: "다정 쪽", "매우 냉정") */
export function traitLabel(t: TraitAxis, v: number): string {
  if (v <= -60) return `매우 ${t.low}`;
  if (v <= -20) return `${t.low} 쪽`;
  if (v < 20) return '중간';
  if (v < 60) return `${t.high} 쪽`;
  return `매우 ${t.high}`;
}
/** 시작할 때 고르는 기울기 */
export const TRAIT_START: [number, string][] = [[-40, 'low'], [0, 'mid'], [40, 'high']];

/** AI용 줄 (전부) */
export function traitLines(world: Pick<WorldPackage, 'traits' | 'genre'>, sheet: Pick<CharacterSheet, 'traits'>): string[] {
  return traitsFor(world).map((t) => { const v = traitValue(world, sheet, t.id); return `- ${t.name} [${t.id}]: ${v > 0 ? '+' : ''}${v} — ${traitLabel(t, v)} (${t.low} -100 ↔ +100 ${t.high})`; });
}
/** 남들이 받는 인상 (뚜렷한 것만) */
export function traitImpression(world: Pick<WorldPackage, 'traits' | 'genre'>, sheet: Pick<CharacterSheet, 'traits'>): string {
  return traitsFor(world).map((t) => ({ t, v: traitValue(world, sheet, t.id) })).filter(({ v }) => Math.abs(v) >= 20).map(({ t, v }) => traitLabel(t, v)).join(', ');
}
