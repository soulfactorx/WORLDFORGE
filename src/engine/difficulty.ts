/**
 * 게임 난이도 (v0.90): 모든 판정의 난이도(DC)에 더하는 보정. 세이브마다 기억하고, 플레이 중에 바꿀 수 있다.
 * 적용: 행동 판정(GM이 고른 난이도 등급) · 장면의 행동 판정 · 실마리 굴림(말문·낌새·눈썰미·다가옴).
 * 전투 (v0.91): 적의 방어도(내 공격이 넘어야 하는 값)와 체력에 적용한다 — combatScale. 예전의 "적응 난이도"는 없앴다.
 */
export interface Difficulty { id: string; label: string; dc: number; desc: string }
export const DIFFICULTIES: Difficulty[] = [
  { id: 'story', label: '이야기', dc: -4, desc: '판정이 대부분 통한다. 이야기를 따라가고 싶을 때' },
  { id: 'easy', label: '쉬움', dc: -2, desc: '조금 너그럽게' },
  { id: 'normal', label: '보통', dc: 0, desc: '규칙 그대로' },
  { id: 'hard', label: '어려움', dc: 2, desc: '실패가 잦고 대가가 따른다' },
  { id: 'brutal', label: '가혹', dc: 4, desc: '준비와 강점 없이는 통하지 않는다' },
];
export const DC_MOD_RANGE = [-6, 6] as const;
export const clampDcMod = (n: unknown) => Math.max(DC_MOD_RANGE[0], Math.min(DC_MOD_RANGE[1], Math.round(Number(n) || 0)));
export const difficultyLabel = (dcMod: number) => { const d = DIFFICULTIES.find((x) => x.dc === dcMod); const s = dcMod > 0 ? `+${dcMod}` : `${dcMod}`; return d ? `${d.label}${dcMod ? ` (DC ${s})` : ''}` : `사용자 정의 (DC ${s})`; };
/** 보정을 더한 난이도 (2 아래로는 내려가지 않는다) */
export const withDcMod = (dc: number, dcMod: number | undefined) => Math.max(2, dc + (dcMod ?? 0));

/**
 * 전투에 주는 영향 (v0.91): DC 보정 2마다 적의 방어도 ±1, 보정 1마다 적의 체력 ±6.25% (−4 → 방어도 −2 · 체력 75%, +4 → 방어도 +2 · 체력 125%).
 * 방어도는 "내 공격이 넘어야 하는 난이도"이므로 DC 보정과 같은 뜻이고, 체력은 싸움의 길이를 맞춘다.
 */
export function combatScale(dcMod: number | undefined): { ac: number; hp: number } {
  const m = clampDcMod(dcMod);
  return { ac: Math.trunc(m / 2), hp: Math.max(0.6, Math.min(1.4, 1 + m * 0.0625)) };
}
/** 전투 시작 기록에 붙는 한 줄 (보통이면 '') */
export function combatScaleNote(dcMod: number | undefined): string {
  const m = clampDcMod(dcMod);
  if (!m) return '';
  const s = combatScale(m);
  const pct = Math.round((s.hp - 1) * 100);
  return `난이도 ${difficultyLabel(m)}: 적의 방어도 ${s.ac > 0 ? '+' : ''}${s.ac} · 체력 ${pct > 0 ? '+' : ''}${pct}%`;
}
