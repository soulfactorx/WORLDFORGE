/**
 * 플레이어가 아는 인물 이름 (v0.37.5).
 * 서술 AI는 이름을 모르는 인물을 외형으로만 불러야 하는데, 엔진이 그 구분을 주지 않으면 AI는 지킬 수 없다
 * (실제 모델 평가: 자기소개한 적 없는 경비병을 "브란"이라고 불렀다).
 * 그래서 이름을 모르는 인물은 서술·안내 프롬프트와 기록에 이름 대신 외형 별칭으로만 들어간다.
 *
 * 이름을 알게 되는 때: 시작 장면에 이름이 나옴, 확정된 대사에서 이름이 불림, 플레이어가 이름을 입력함, 동료가 됨.
 */
import type { Character, EntityId, WorldPackage } from './schema';
import type { GameState } from './state/state';

/** namesKnown이 없는 이전 세이브는 모두 아는 것으로 본다 (이전 동작 유지) */
export const knowsName = (s: GameState, id: EntityId) => !s.namesKnown || s.namesKnown.includes(id) || !!s.party[id];

/** 외형 첫 구절로 만든 별칭 (예: "턱수염이 희끗한 중년 경비병") */
export function epithetOf(c: Character): string {
  const first = (c.appearance ?? '').split(/[.。,，\n]/)[0]!.trim();
  return first ? (first.length > 24 ? `${first.slice(0, 23)}…` : first) : '낯선 인물';
}

export const displayName = (s: GameState, c: Character) => (knowsName(s, c.id) ? c.name : epithetOf(c));

/** 이름 표기: 전체 이름, 또는 여러 낱말 이름의 첫 낱말(2자 이상, 예: "운학 진인" → "운학") */
function nameForms(name: string): string[] {
  const forms = [name.trim()];
  const parts = name.trim().split(/\s+/);
  if (parts.length > 1 && parts[0]!.length >= 2) forms.push(parts[0]!);
  return forms.filter((f) => f.length >= 2);
}

/** 이 글에 이름이 나온 인물 */
export function namesIn(world: WorldPackage, text: string): EntityId[] {
  return world.characters.filter((c) => nameForms(c.name).some((f) => text.includes(f))).map((c) => c.id);
}
