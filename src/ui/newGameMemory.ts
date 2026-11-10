/**
 * 새 게임 입력 기억 (v0.90): 주인공 만들기에서 적은 값을 이 브라우저에 남겨 두고,
 * 다음에 새로 시작하거나 다른 세계관을 시작할 때 같은 항목을 미리 채운다.
 * 세계마다 양식이 다르므로 항목 ID가 같으면 그대로, 아니면 항목 이름(라벨)이 같은 것을 쓴다.
 */
import type { Abilities, AbilityMethod } from '../engine/character/sheet';

const KEY = 'worldforge.newgame';

export interface NewGameMemory {
  name?: string;
  gender?: string;
  /** 주인공 정보: 항목 ID → 값 */
  info?: Record<string, string>;
  /** 주인공 정보: 항목 이름(라벨) → 값 (다른 세계의 같은 이름 항목에 쓴다) */
  infoByLabel?: Record<string, string>;
  /** 성향 축 ID → 처음 기울기 */
  lean?: Record<string, number>;
  /** 세계 직업 ID · 그 직업의 규칙 직업 */
  roleId?: string;
  classId?: string;
  method?: AbilityMethod;
  abilities?: Abilities;
  skills?: string[];
  /** 게임 난이도 (DC 보정) */
  dcMod?: number;
}

export function loadNewGameMemory(): NewGameMemory {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return v && typeof v === 'object' ? (v as NewGameMemory) : {}; } catch { return {}; }
}
/** 이번에 적은 값을 더해 기억한다 (이번 양식에 없던 항목의 예전 값은 남긴다) */
export function saveNewGameMemory(m: NewGameMemory) {
  try {
    const old = loadNewGameMemory();
    localStorage.setItem(KEY, JSON.stringify({ ...old, ...m, info: { ...(old.info ?? {}), ...(m.info ?? {}) }, infoByLabel: { ...(old.infoByLabel ?? {}), ...(m.infoByLabel ?? {}) }, lean: { ...(old.lean ?? {}), ...(m.lean ?? {}) } }));
  } catch { /* 저장소가 없으면 기억하지 않는다 */ }
}
export function clearNewGameMemory() { try { localStorage.removeItem(KEY); } catch { /* 무시 */ } }
