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
  for (const r of w.rules ?? []) { if (r.trigger.kind === 'state') add(`세계 규칙 "${r.name}"`, r.trigger.condition); add(`세계 규칙 "${r.name}" 추가 조건`, r.requires); }
  for (const f of w.factions ?? []) for (const a of f.actions ?? []) add(`세력 "${f.name}" ${a.name}`, a.condition);
  for (const c of w.characters) (c.gives ?? []).forEach((g) => add(`${c.name}이(가) 건넬 것`, g.condition));
  for (const l of w.locations) for (const j of l.board?.jobs ?? []) { add(`의뢰 "${j.name}" 완료`, j.complete); add(`의뢰 "${j.name}" 조건`, j.requires); }
  // v0.85: 빠져 있던 조건들 — 장면·임무 결과·칭호·인물 목표·조우
  for (const s of w.scenes ?? []) add(`장면 "${s.name}" 열림`, s.start);
  for (const q of w.quests ?? []) for (const o of q.outcomes ?? []) add(`임무 "${q.name}" 결과 "${o.name}"`, o.when);
  for (const t of w.titles ?? []) add(`칭호 "${t.name}"`, t.condition);
  for (const c of w.characters) for (const g of c.goals ?? []) { add(`${c.name}의 목표 시작`, g.start); add(`${c.name}의 목표 꺾임`, g.stop); }
  for (const e of w.encounters ?? []) { add(`조우 "${e.name}" 조건`, e.when); add(`조우 "${e.name}" 강제 시작`, e.force); }
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
  for (const r of w.rules ?? []) for (const f of flagsSet(r.effects)) get(f).setBy.push(`세계 규칙 "${r.name}"`);
  for (const f of w.factions ?? []) for (const a of f.actions ?? []) for (const fl of flagsSet(a.effects)) get(fl).setBy.push(`세력 "${f.name}" ${a.name}`);
  for (const s of w.scenes ?? []) for (const e of s.ends) for (const f of flagsSet(e.effects)) get(f).setBy.push(`장면 "${s.name}" 끝 "${e.name}"`);
  for (const q of w.quests ?? []) for (const o of q.outcomes ?? []) for (const f of flagsSet(o.effects)) get(f).setBy.push(`임무 "${q.name}" 결과 "${o.name}"`);
  for (const e of w.encounters ?? []) for (const [k, l] of [['onVictory', '승리'], ['onDefeat', '패배'], ['onFlee', '도주']] as const) for (const f of flagsSet(e[k])) get(f).setBy.push(`조우 "${e.name}" ${l}`);
  for (const c of w.characters) for (const g of c.goals ?? []) for (const f of flagsSet(g.effects)) get(f).setBy.push(`${c.name}의 목표`);
  for (const r of w.randomEvents ?? []) for (const f of flagsSet(r.effects)) get(f).setBy.push(`돌발 사건 "${r.name}"`);
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

/** 세계 안의 모든 이야기 효과 (어디서 일어나는지 이름과 함께) */
export function allEffects(w: WorldPackage): { where: string; effects: StoryEffect[] }[] {
  const out: { where: string; effects: StoryEffect[] }[] = [];
  const add = (where: string, effects: StoryEffect[] | undefined) => { if (effects?.length) out.push({ where, effects }); };
  for (const c of w.choices ?? []) for (const o of c.options) add(`결정 "${c.name}"`, o.effects);
  for (const c of w.clocks ?? []) for (const a of c.at) add(`시계 "${c.name}"`, a.effects);
  for (const e of w.events ?? []) add(`사건 "${e.name}"`, e.effects);
  for (const a of w.arcs ?? []) for (const ch of a.chapters) add(`줄기 "${a.name}"`, ch.effects);
  for (const r of w.rules ?? []) add(`세계 규칙 "${r.name}"`, r.effects);
  for (const s of w.scenes ?? []) for (const e of s.ends) add(`장면 "${s.name}"`, e.effects);
  for (const q of w.quests ?? []) for (const o of q.outcomes ?? []) add(`임무 "${q.name}"`, o.effects);
  for (const e of w.encounters ?? []) { add(`조우 "${e.name}"`, e.onVictory); add(`조우 "${e.name}"`, e.onDefeat); add(`조우 "${e.name}"`, e.onFlee); }
  for (const f of w.factions ?? []) for (const a of f.actions ?? []) add(`세력 "${f.name}"`, a.effects);
  for (const c of w.characters) for (const g of c.goals ?? []) add(`${c.name}의 목표`, g.effects);
  return out;
}

/**
 * 연결 검사 (v0.85): 임무·조우·장면이 서로 이어져 있는가. AI 없이 세계 데이터만 본다.
 *  - 곁가지: 어떤 조건·효과·임무 단계도 가리키지 않는 조우·장면
 *  - 막다른 고비: 임무 단계가 걸린 조우·장면에서 지거나 실패했을 때 이어지는 것이 없다
 *  - 닿지 않는 고비: 임무 단계에 걸린 장면의 상대·장소가 없거나, 걸린 조우가 다른 조건으로 막혀 있다
 *  - 만날 수 없는 의뢰인
 */
export function linkWarnings(w: WorldPackage): string[] {
  const out: string[] = [];
  const conds = allConditions(w);
  const effects = allEffects(w);
  const encRead = new Set<string>(); const sceneRead = new Set<string>();
  for (const { cond } of conds) walk(cond, (c) => { if ('cleared' in c) encRead.add(c.cleared); if ('encounter' in c) encRead.add(c.encounter); if ('sceneEnd' in c) sceneRead.add(c.sceneEnd); });
  for (const { effects: fx } of effects) for (const e of fx) { if ('startEncounter' in e) encRead.add(e.startEncounter); if ('startScene' in e) sceneRead.add(e.startScene); }
  for (const q of w.quests ?? []) for (const st of q.stages) { if (st.via?.encounter) encRead.add(st.via.encounter); if (st.via?.scene) sceneRead.add(st.via.scene); }
  for (const b of w.relationBeats ?? []) if (b.scene) sceneRead.add(b.scene);
  const hasLasting = (fx: StoryEffect[] | undefined) => (fx ?? []).length > 0;
  for (const e of w.encounters ?? []) {
    if (!encRead.has(e.id) && !hasLasting(e.onVictory) && !hasLasting(e.onDefeat)) out.push(`조우 "${e.name}": 어떤 임무·조건·효과와도 이어져 있지 않습니다 (곁가지). 임무 단계의 고비로 걸거나, 이겼을 때·졌을 때의 효과를 주면 이야기에 남습니다.`);
  }
  for (const s of w.scenes ?? []) {
    const lasting = s.ends.some((e) => hasLasting(e.effects) || !!e.rewards);
    if (!sceneRead.has(s.id) && !lasting) out.push(`장면 "${s.name}": 결과를 읽는 조건도, 끝의 효과·보상도 없습니다 (곁가지). 끝에 효과를 주거나 임무 단계의 고비로 거세요.`);
  }
  // 임무 단계의 고비
  const gates = (st: { complete: Condition; via?: { encounter?: string; scene?: string } }) => {
    const enc = new Set<string>(); const sc = new Set<string>();
    if (st.via?.encounter) enc.add(st.via.encounter);
    if (st.via?.scene) sc.add(st.via.scene);
    const pos = (c: Condition) => { if ('all' in c) c.all.forEach(pos); else if ('any' in c) c.any.forEach(pos); else if ('cleared' in c) enc.add(c.cleared); else if ('encounter' in c) enc.add(c.encounter); else if ('sceneEnd' in c) sc.add(c.sceneEnd); };
    pos(st.complete);
    return { enc: [...enc], sc: [...sc] };
  };
  for (const q of w.quests ?? []) {
    q.stages.forEach((st, i) => {
      const g = gates(st);
      const where = `임무 "${q.name}" ${i + 1}단계`;
      for (const id of g.sc) {
        const d = w.scenes?.find((x) => x.id === id);
        if (!d) continue;
        // 실패로 끝난 장면이 다시 열리지 않고, 단계가 성공만 받으면 막다른 길
        const needsSuccess = JSON.stringify(st.complete).includes(`"sceneEnd":"${id}","outcome":"success"`) || d.ends.some((e) => JSON.stringify(st.complete).includes(`"sceneEnd":"${id}","is":"${e.id}"`) && e.outcome === 'success');
        const failEnd = d.ends.filter((e) => e.outcome === 'failure');
        if (needsSuccess && !d.repeatable && failEnd.length && !failEnd.some((e) => hasLasting(e.effects)) && !q.fail && !st.fail && !(q.outcomes ?? []).length) {
          out.push(`${where}: 장면 "${d.name}"에서 실패하면 다시 할 수 없고 이어지는 것도 없습니다 (막다른 길). 장면을 "다시 할 수 있음"으로 하거나, 실패 끝에 효과(플래그·전투로 이어진다)를 주거나, 단계의 실패 조건을 정하세요.`);
        }
      }
    });
    const giver = q.giver ? w.characters.find((c) => c.id === q.giver) : undefined;
    if (q.giver && !giver) out.push(`임무 "${q.name}": 의뢰인 "${q.giver}"이(가) 없습니다.`);
  }
  // 강제 조우인데 조건이 항상 참
  for (const e of w.encounters ?? []) if (e.force && 'all' in e.force && e.force.all.length === 0) out.push(`조우 "${e.name}": 강제 시작 조건이 비어 있어, 그 장소에 들어서는 순간 늘 시작됩니다.`);
  return out;
}
