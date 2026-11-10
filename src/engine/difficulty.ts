/**
 * 게임 난이도 (v0.90): 모든 판정의 난이도(DC)에 더하는 보정. 세이브마다 기억하고, 플레이 중에 바꿀 수 있다.
 * 적용: 행동 판정(GM이 고른 난이도 등급) · 장면의 행동 판정 · 실마리 굴림(말문·낌새·눈썰미·다가옴).
 * 전투의 명중·방어도·피해에는 적용하지 않는다 (전투 쪽은 "적응 난이도"가 따로 있다).
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
