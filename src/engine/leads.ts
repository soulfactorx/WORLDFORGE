/**
 * 실마리 (v0.89) — 세계가 플레이어에게 먼저 다가온다. 순수 함수.
 *
 * 지금까지는 플레이어가 정확히 캐묻거나 조사해야만 무언가를 알 수 있었고, 인물은 묻는 말에만 답했다.
 * 그래서 세계를 모르는 플레이어는 무엇을 물어야 할지도 몰랐다.
 * 이제 매 턴 엔진이 d20을 굴려, 인물이 아는 것을 먼저 꺼내거나(말문), 감추던 것의 낌새를 흘리거나(낌새),
 * 장소의 수상한 점이 눈에 걸리게(눈썰미) 한다. 무엇이 흘러나오는지는 엔진이 확정하고, AI는 그것을 연기·서술한다.
 *
 *  - 말문 (DC 10): 말하는 인물이 플레이어가 모르는 "비밀이 아닌" 지식 하나를 먼저 꺼낸다 → 플레이어가 알게 된다
 *  - 낌새 (DC 14): 인물이 감추는 비밀의 "주제"(보호 주제 이름표)가 드러난다 — 내용은 드러나지 않는다. 인물·주제마다 한 번
 *  - 눈썰미 (DC 12): 이 장소에서 찾을 수 있는 것 하나가 눈에 걸린다. 판정이 필요 없는 것은 바로 알게 되고,
 *    판정이 필요한 것은 "살펴볼 만하다"는 낌새만 준다. 장소·대상마다 한 번
 *  - 다가옴 (DC 12, 조용할수록 쉬워진다): 아무도 말하지 않는 턴에 그 자리의 인물이 먼저 말을 건다
 *
 * 수정치: 플레이어의 설득·통찰 중 높은 쪽(말문·낌새), 지각·조사 중 높은 쪽(눈썰미) + 그 인물과의 사이(신뢰·호감).
 * 지금 목표와 이어지는 지식이 먼저 나온다.
 */
import { playerStateFromNpc, shareableBelief } from './canon';
import { checkModifier } from './character/sheet';
import { SKILLS, type SkillId } from './character/rules';
import { type D20Test, d20Test } from './dice/dice';
import type { Rng } from './dice/rng';
import { relationshipOf } from './relationship';
import { withDcMod } from './difficulty';
import { pendingDiscoveries, playerKnows } from './scenario';
import type { Character, EntityId, KnowledgeState, WorldPackage } from './schema';
import type { GameState } from './state/state';

export const LEAD_DC = { tell: 10, hint: 14, notice: 12, approach: 12 } as const;

export interface Lead {
  kind: 'tell' | 'hint' | 'notice' | 'found';
  /** 다시 나오지 않게 기억할 열쇠 (말문·발견은 지식이 남으므로 없다) */
  key?: string;
  npcId?: EntityId;
  claimId?: EntityId;
  /** 말문·발견: 플레이어가 갖게 되는 지식 상태 */
  state?: KnowledgeState;
  /** 명제 글 (말문·발견) / 보호 주제 (낌새) / GM 힌트 (눈썰미) */
  detail: string;
  /** 기록에 보이는 한 줄 */
  text: string;
}

export interface LeadRoll { leads: Lead[]; /** 아무도 말하지 않는 턴에 먼저 말을 거는 인물 */ approach?: EntityId }

const RANK: Record<KnowledgeState, number> = { mistaken: 0, rumor: 1, partial: 2, confirmed: 3, secret: 3 };
const skill = (state: GameState, ids: SkillId[]) => ids.map((id) => ({ id, total: checkModifier(state.player.sheet, { kind: 'skill', skill: id }).total })).sort((a, b) => b.total - a.total)[0]!;
const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const rollText = (label: string, t: D20Test) => `${label} d20(${t.kept}) ${fmt(t.modifier)} = ${t.total} vs ${t.dc}`;

/** 그 인물과의 사이가 주는 보정 (−2 ~ +4) */
function rapport(world: WorldPackage, state: GameState, npc: Character): number {
  const r = relationshipOf(world, state.relationships, npc.id);
  return Math.max(-2, Math.min(4, Math.floor(r.trust / 15) + Math.floor(r.affinity / 25) + (state.party[npc.id] ? 1 : 0)));
}

/** 이 인물이 아는 것 중 플레이어가 아직 (그만큼) 모르는 것 */
function untold(world: WorldPackage, state: GameState, npc: Character) {
  const ids = [...new Set([...world.beliefs, ...state.beliefs].filter((b) => b.holder === npc.id).map((b) => b.claim))];
  return ids.flatMap((id) => {
    const b = shareableBelief(world, state.beliefs, npc.id, id);
    const claim = world.claims.find((c) => c.id === id);
    if (!b || !claim) return [];
    const mine = state.beliefs.find((x) => x.holder === 'player' && x.claim === id);
    const give = playerStateFromNpc(b.state);
    if (b.state !== 'secret' && mine && RANK[mine.state] >= RANK[give]) return [];
    if (b.state === 'secret' && mine) return [];
    return [{ claim, npcState: b.state, give }];
  });
}

export interface LeadOptions {
  /** 이번 턴에 말하는 인물 */
  speakers: EntityId[];
  /** 이 자리에 있는 인물 (죽지 않은) */
  present: Character[];
  /** 별일 없이 지난 턴 수 */
  quiet: number;
  /** 지금 목표와 이어지는 명제 (먼저 꺼낸다) */
  focusClaims?: EntityId[];
  /** 지금 목표와 이어지는 인물 (먼저 다가온다) */
  focusNpcs?: EntityId[];
}

export function rollLeads(world: WorldPackage, state: GameState, rng: Rng, o: LeadOptions): LeadRoll {
  const leads: Lead[] = [];
  const given = new Set(state.leadKeys ?? []);
  const focus = new Set(o.focusClaims ?? []);
  const talk = skill(state, ['persuasion', 'insight']);
  const eye = skill(state, ['perception', 'investigation']);
  const mode = o.quiet >= 3 ? 'advantage' as const : 'normal' as const; // 이야기가 정체되면 세계가 더 적극적으로 다가온다

  // 다가옴: 아무도 말하지 않는 턴
  let approach: EntityId | undefined;
  let speakers = o.speakers;
  if (!speakers.length && o.present.length) {
    const who = [...o.present].sort((a, b) => Number(o.focusNpcs?.includes(b.id) ?? false) - Number(o.focusNpcs?.includes(a.id) ?? false) || rapport(world, state, b) - rapport(world, state, a))[0]!;
    const cha = checkModifier(state.player.sheet, { kind: 'ability', ability: 'cha' }).total;
    const t = d20Test(rng, cha + rapport(world, state, who), withDcMod(Math.max(6, LEAD_DC.approach - o.quiet * 2), state.dcMod), mode);
    if (t.success) { approach = who.id; speakers = [who.id]; }
  }

  // 말문 · 낌새: 말하는 인물마다 굴리되, 한 턴에 하나씩만
  let told = false, hinted = false;
  for (const id of speakers) {
    const npc = o.present.find((c) => c.id === id);
    if (!npc) continue;
    const list = untold(world, state, npc);
    const open = list.filter((x) => x.npcState !== 'secret').sort((a, b) => Number(focus.has(b.claim.id)) - Number(focus.has(a.claim.id)));
    if (!told && open.length) {
      const pick = open[0]!;
      const t = d20Test(rng, talk.total + rapport(world, state, npc) + (focus.has(pick.claim.id) ? 2 : 0), withDcMod(LEAD_DC.tell, state.dcMod), mode);
      if (t.success) {
        told = true;
        leads.push({ kind: 'tell', npcId: npc.id, claimId: pick.claim.id, state: pick.give, detail: pick.claim.statement,
          text: `🎲 말문 — ${rollText(SKILLS[talk.id].name, t)}: 이야기가 먼저 흘러나온다` });
      }
    }
    if (!hinted) {
      const secret = list.filter((x) => x.npcState === 'secret').flatMap((x) => {
        const f = world.facts.find((y) => y.id === x.claim.relatesTo);
        return f?.protectedTopic && !given.has(`hint:${npc.id}:${f.id}`) ? [{ factId: f.id, topic: f.protectedTopic }] : [];
      })[0];
      if (secret) {
        const t = d20Test(rng, talk.total + rapport(world, state, npc), withDcMod(LEAD_DC.hint, state.dcMod), mode);
        if (t.success) {
          hinted = true;
          leads.push({ kind: 'hint', key: `hint:${npc.id}:${secret.factId}`, npcId: npc.id, detail: secret.topic,
            text: `🎲 낌새 — ${rollText(SKILLS[talk.id].name, t)}: 무언가를 감추는 기색이 스친다 (「${secret.topic}」)` });
        }
      }
    }
  }

  // 눈썰미: 이 장소에서 찾을 수 있는 것
  const loc = state.player.locationId;
  const disc = pendingDiscoveries(world, state).filter((d) => !given.has(`notice:${loc}:${d.claim}`))
    .sort((a, b) => Number(focus.has(b.claim)) - Number(focus.has(a.claim)))[0];
  if (disc) {
    const claim = world.claims.find((c) => c.id === disc.claim);
    const t = d20Test(rng, eye.total + (focus.has(disc.claim) ? 2 : 0), withDcMod(LEAD_DC.notice, state.dcMod), mode);
    if (t.success && claim) {
      // 판정이 필요 없는 것은 눈에 띄는 순간 알게 된다. 판정이 필요한 것은 "살펴볼 만하다"까지만
      if (!disc.check && !playerKnows(state, disc.claim, disc.state ?? 'confirmed')) {
        leads.push({ kind: 'found', claimId: claim.id, state: disc.state ?? 'confirmed', detail: claim.statement, text: `🎲 눈썰미 — ${rollText(SKILLS[eye.id].name, t)}: 눈에 들어온다` });
      } else {
        const need = disc.check && disc.check in SKILLS ? SKILLS[disc.check as SkillId].name : '';
        leads.push({ kind: 'notice', key: `notice:${loc}:${disc.claim}`, claimId: claim.id, detail: disc.hint,
          text: `🎲 눈썰미 — ${rollText(SKILLS[eye.id].name, t)}: 이곳에 눈에 걸리는 것이 있다${need ? ` — 자세히 살펴볼 만하다 (${need})` : ''}` });
      }
    }
  }
  return { leads, ...(approach ? { approach } : {}) };
}
