/**
 * 세계 비교·합치기 (v0.131): 저장하지 않은 초안과 저장본이 갈라졌을 때, 초안의 것을 골라 저장본에 합친다.
 * - ID가 있는 목록(장소·인물·임무…): 항목마다 — 초안에만 있음(추가) · 둘 다 있는데 다름(바뀜)
 * - 그 밖의 칸(개요·시작 장면·장르…): 칸마다 — 다름(바뀜)
 * 저장본에만 있는 것은 건드리지 않는다 (초안을 만든 뒤에 저장본에 더한 것일 수 있다).
 */
import type { WorldPackage } from '../engine/schema';

export interface DiffItem {
  /** 고르기 열쇠: "field" 또는 "field|id" */
  key: string;
  field: string;
  id?: string;
  label: string;
  /** added: 초안에서 새로 만듦 · changed: 초안에서만 고침 · conflict: 저장본과 초안이 둘 다 고침 (시작점을 모르면 늘 conflict) */
  kind: 'added' | 'changed' | 'conflict';
  /** 어느 묶음인지 (화면 표시) */
  group: string;
}

const FIELD_LABEL: Record<string, string> = {
  locations: '장소', characters: '인물', facts: '진실', claims: '명제·소문', beliefs: '누가 무엇을 아는가', encounters: '조우', quests: '임무', flags: '플래그', endings: '결말',
  factions: '세력', relations: '인물 관계', relationBeats: '관계 사건', rules: '세계 규칙', vars: '세계 수치', phases: '국면', storylets: '갈래 카드', scenes: '장면·함정·퍼즐',
  randomEvents: '돌발 사건', titles: '칭호', arcs: '이야기 줄기', choices: '결정적 선택', clocks: '진행 시계', events: '연표 사건', items: '아이템', monsters: '적', starts: '시작 방식',
  classes: '직업', traits: '성향 축', assets: '이미지', start: '시작 장소·첫 장면', overview: '세계 개요', gmNotes: 'GM 메모', style: '서술 문체', genre: '장르', calendar: '달력',
  gmStyle: 'GM 스타일', time: '시간 규칙', playerProfile: '주인공 정보 양식', improv: 'GM 즉흥 등장', simulation: '시뮬레이션', playModels: '추천 AI 모델', autoPhases: '기본 국면', flowLayout: '흐름도 상자 위치',
};
/** 비교하지 않는 칸 (manifest는 이름만 따로 본다) */
const SKIP = new Set(['manifest']);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const hasIds = (v: unknown): v is { id: string }[] => Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string');
const nameOf = (x: unknown) => { const r = x as { name?: unknown; statement?: unknown; text?: unknown; id: string }; return String((typeof r.name === 'string' && r.name) || (typeof r.statement === 'string' && r.statement.slice(0, 40)) || (typeof r.text === 'string' && r.text.slice(0, 40)) || r.id); };

/**
 * origin: 초안을 만들기 시작한 때의 세계 (있으면 세 갈래로 비교한다).
 * 초안이 시작점에서 바꾸지 않은 것은 내놓지 않는다 — 저장본에서 그 뒤에 고친 것을 되돌리지 않게.
 */
export function diffWorlds(base: WorldPackage, draft: WorldPackage, origin?: WorldPackage): DiffItem[] {
  const out: DiffItem[] = [];
  const o = origin as unknown as Record<string, unknown> | undefined;
  /** 초안이 이 값을 시작점에서 바꿨나 · 저장본도 바꿨나 */
  const kindOf = (dv: unknown, bv: unknown, ov: unknown, exists: boolean): DiffItem['kind'] | null => {
    if (!origin) return exists ? 'conflict' : 'added';
    if (same(dv, ov)) return null; // 초안이 손대지 않았다 — 저장본 쪽이 새것
    if (!exists) return ov === undefined ? 'added' : 'conflict'; // 시작점엔 있었는데 저장본에서 지운 것을 초안이 고쳤다
    return same(bv, ov) ? 'changed' : 'conflict';
  };
  if (draft.manifest.name !== base.manifest.name) {
    const k = kindOf(draft.manifest.name, base.manifest.name, origin?.manifest.name, true);
    if (k) out.push({ key: 'manifest.name', field: 'manifest.name', label: `세계 이름: 「${draft.manifest.name}」 (저장본: 「${base.manifest.name}」)`, kind: k, group: '기본' });
  }
  const b = base as unknown as Record<string, unknown>, d = draft as unknown as Record<string, unknown>;
  for (const field of Object.keys(d)) {
    if (SKIP.has(field)) continue;
    const dv = d[field], bv = b[field];
    if (dv === undefined || same(dv, bv)) continue;
    const group = FIELD_LABEL[field] ?? field;
    if (hasIds(dv) && (bv === undefined || hasIds(bv) || (Array.isArray(bv) && !bv.length))) {
      const bl = (bv as { id: string }[] | undefined) ?? [];
      const ol = (o?.[field] as { id: string }[] | undefined) ?? [];
      for (const item of dv) {
        const old = bl.find((x) => x.id === item.id);
        if (old && same(old, item)) continue;
        const k = kindOf(item, old, ol.find((x) => x.id === item.id), !!old);
        if (k) out.push({ key: `${field}|${item.id}`, field, id: item.id, label: nameOf(item), kind: k, group });
      }
      continue;
    }
    const k = kindOf(dv, bv, o?.[field], bv !== undefined);
    if (k) out.push({ key: field, field, label: group, kind: k, group: '기본' });
  }
  return out;
}

/** 고른 것만 초안에서 가져와 저장본에 합친다 */
export function mergeWorlds(base: WorldPackage, draft: WorldPackage, picks: Set<string>, origin?: WorldPackage): WorldPackage {
  const out = structuredClone(base) as unknown as Record<string, unknown>;
  const d = draft as unknown as Record<string, unknown>;
  if (picks.has('manifest.name')) (out.manifest as { name: string }).name = draft.manifest.name;
  for (const item of diffWorlds(base, draft, origin)) {
    if (!picks.has(item.key) || item.field === 'manifest.name') continue;
    if (!item.id) { out[item.field] = structuredClone(d[item.field]); continue; }
    const from = (d[item.field] as { id: string }[]).find((x) => x.id === item.id)!;
    const list = [...((out[item.field] as { id: string }[] | undefined) ?? [])];
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = structuredClone(from); else list.push(structuredClone(from));
    out[item.field] = list;
  }
  return out as unknown as WorldPackage;
}

/** 기본으로 고를 것: 초안에서만 만들거나 고친 것 (겹침 없음). 둘 다 고친 것은 저장본을 그대로 두는 쪽이 기본 */
export const defaultPicks = (items: DiffItem[]) => new Set(items.filter((i) => i.kind !== 'conflict').map((i) => i.key));
