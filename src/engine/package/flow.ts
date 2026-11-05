/**
 * 이야기 흐름 분석 (R8 이야기 보드): 플래그를 누가 세우고 누가 읽는지, 빠진 연결은 없는지.
 */
import type { Condition, StoryEffect, WorldPackage } from '../schema';

export interface FlagFlow {
  id: string;
  declared: boolean;
  /** GM(Director)이 세울 수 있는가 (선언됐고 막혀 있지 않음) */
  director: boolean;
  setBy: string[];
  readBy: string[];
}

function walk(c: Condition | undefined, visit: (c: Condition) => void) {
  if (!c) return;
  visit(c);
  if ('all' in c) c.all.forEach((x) => walk(x, visit));
  else if ('any' in c) c.any.forEach((x) => walk(x, visit));
  else if ('not' in c) walk(c.not, visit);
}

const flagsIn = (c: Condition | undefined) => { const out: string[] = []; walk(c, (x) => { if ('flag' in x) out.push(x.flag); }); return out; };
const flagsSet = (fx: StoryEffect[] | undefined) => (fx ?? []).flatMap((e) => ('setFlag' in e ? [e.setFlag] : []));
/** 엔진만 세우는 플래그: requires가 { not: { all: [] } } (항상 거짓) */
const engineOnly = (c: Condition | undefined) => !!c && 'not' in c && 'all' in c.not && c.not.all.length === 0;

/** 세계 안의 모든 조건 (어디서 쓰이는지 이름과 함께) */
export function allConditions(w: WorldPackage): { where: string; cond: Condition }[] {
  const out: { where: string; cond: Condition }[] = [];
  const add = (where: string, cond: Condition | undefined) => { if (cond) out.push({ where, cond }); };
  for (const q of w.quests ?? []) {
    add(`임무 "${q.name}" 시작`, q.start); add(`임무 "${q.name}" 실패`, q.fail);
    q.stages.forEach((s, i) => { add(`임무 "${q.name}" ${i + 1}단계`, s.complete); add(`임무 "${q.name}" ${i + 1}단계 실패`, s.fail); });
  }
  for (const e of w.endings ?? []) add(`결말 "${e.name}"`, e.condition);
  for (const f of w.flags ?? []) add(`플래그 ${f.id}의 조건`, f.requires);
  for (const a of w.arcs ?? []) {
    add(`줄기 "${a.name}" 시작`, a.start);
    a.chapters.forEach((c, i) => { add(`줄기 "${a.name}" ${i + 1}장`, c.complete); add(`줄기 "${a.name}" ${i + 1}장 실패`, c.fail); });
  }
  for (const c of w.choices ?? []) add(`결정 "${c.name}"`, c.when);
  for (const c of w.clocks ?? []) c.tick.forEach((t) => { if ('on' in t) add(`시계 "${c.name}" 눈금`, t.on); });
  for (const e of w.events ?? []) { add(`사건 "${e.name}"`, e.when.condition); add(`사건 "${e.name}" 막힘`, e.unless); }
  for (const b of w.relationBeats ?? []) add(`관계 사건 "${b.name}"`, b.condition);
  for (const f of w.factions ?? []) for (const a of f.actions ?? []) add(`세력 "${f.name}" ${a.name}`, a.condition);
  for (const c of w.characters) (c.gives ?? []).forEach((g) => add(`${c.name}이(가) 건넬 것`, g.condition));
  for (const l of w.locations) for (const j of l.board?.jobs ?? []) { add(`의뢰 "${j.name}" 완료`, j.complete); add(`의뢰 "${j.name}" 조건`, j.requires); }
  return out;
}

export function flagFlows(w: WorldPackage): FlagFlow[] {
  const map = new Map<string, FlagFlow>();
  const get = (id: string) => {
    if (!map.has(id)) map.set(id, { id, declared: false, director: false, setBy: [], readBy: [] });
    return map.get(id)!;
  };
  for (const f of w.flags ?? []) { const x = get(f.id); x.declared = true; x.director = !engineOnly(f.requires); if (x.director) x.setBy.push('GM (플레이어의 행동)'); }
  for (const c of w.choices ?? []) for (const o of c.options) for (const f of flagsSet(o.effects)) get(f).setBy.push(`결정 "${c.name}" → ${o.text}`);
  for (const c of w.clocks ?? []) for (const a of c.at) for (const f of flagsSet(a.effects)) get(f).setBy.push(`시계 "${c.name}" ${a.segment}칸`);
  for (const e of w.events ?? []) for (const f of flagsSet(e.effects)) get(f).setBy.push(`사건 "${e.name}"`);
  for (const a of w.arcs ?? []) a.chapters.forEach((ch, i) => flagsSet(ch.effects).forEach((f) => get(f).setBy.push(`줄기 "${a.name}" ${i + 1}장 끝`)));
  for (const f of w.factions ?? []) for (const a of f.actions ?? []) for (const fl of flagsSet(a.effects)) get(fl).setBy.push(`세력 "${f.name}" ${a.name}`);
  for (const { where, cond } of allConditions(w)) for (const f of flagsIn(cond)) get(f).readBy.push(where);
  for (const b of w.relationBeats ?? []) if (b.resolveFlag) get(b.resolveFlag).readBy.push(`관계 사건 "${b.name}" 닫힘`);
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** 이야기 보드 경고: 아무도 세우지 못하는 플래그, 아무도 읽지 않는 플래그 */
export function flowWarnings(w: WorldPackage): string[] {
  const out: string[] = [];
  for (const f of flagFlows(w)) {
    if (!f.setBy.length && f.readBy.length) out.push(`플래그 ${f.id}: 읽는 곳(${f.readBy[0]})은 있는데 세우는 곳이 없습니다 — 영영 참이 되지 않습니다.`);
    if (f.setBy.length && !f.readBy.length) out.push(`플래그 ${f.id}: 세울 수 있지만 아무 조건도 읽지 않습니다 (기록용이면 괜찮습니다).`);
  }
  return out;
}
