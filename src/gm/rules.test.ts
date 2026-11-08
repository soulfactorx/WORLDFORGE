import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { legacyCharacter } from '../engine/character/sheet';
import { validateWorld } from '../engine/package/validate';
import type { WorldPackage, WorldRule } from '../engine/schema';
import { applyEvent, replay, type GameState } from '../engine/state/state';
import type { GameEvent } from '../engine/state/events';
import type { LlmClient } from '../llm/types';
import { actionRuleList, actionRulesHit, fireRule, stateRuleEvents } from './rules';
import { scenarioEvents } from './scenario';
import { runTurn, startEvents } from './turn';
import { rulesFromDraft } from './worldgen/rules';
import { scanWorld } from './worldgen/audit';

const RULES: WorldRule[] = [
  { id: 'rule/oath', name: '맹세를 깨면', trigger: { kind: 'action', describe: '플레이어가 맹세·약속을 어긴다', keywords: ['맹세를 깨'] },
    effects: [{ var: 'suspicion', add: 40 }], outcome: '마을 사람들의 눈빛이 차가워진다',
    reactions: [{ npcId: 'present', text: '실망한 눈으로 본다', relationship: { trust: -5 } }], announce: '맹세를 깼다는 소문이 돈다' },
  { id: 'rule/watch', name: '의심이 쌓이면', trigger: { kind: 'state', condition: { var: 'suspicion', gte: 50 } }, effects: [{ setFlag: 'guards_alert' }], outcome: '경비가 늘었다' },
  { id: 'rule/chain', name: '경계령', trigger: { kind: 'state', condition: { flag: 'guards_alert' } }, effects: [{ moveNpc: 'npc/bran', to: 'loc/forest-clearing' }] },
  { id: 'rule/bribe', name: '뇌물', trigger: { kind: 'action', describe: '경비에게 돈을 건넨다' }, repeat: 3, effects: [{ money: -1 }] },
];

function world(): WorldPackage {
  const w = structuredClone(sampleWorld);
  w.vars = [...(w.vars ?? []), { id: 'suspicion', name: '의심', initial: 0, min: 0, max: 100 }];
  w.flags = [...(w.flags ?? []), { id: 'guards_alert', when: '(엔진) 의심이 쌓이면', requires: { not: { all: [] } } }];
  w.rules = structuredClone(RULES);
  return w;
}
const start = (w: WorldPackage): GameState => replay(startEvents(w, legacyCharacter('나'), 1).map((event, seq) => ({ saveId: 's', seq, turn: 0, event })));
const apply = (s: GameState, evs: GameEvent[]) => evs.reduce((x, e) => applyEvent(x, e, x.turn), s);

describe('세계 규칙 (v0.83)', () => {
  it('검사를 통과하고, 잘못된 참조는 잡는다', () => {
    const w = world();
    expect(validateWorld(w).filter((i) => i.level === 'error' && i.path.startsWith('rules'))).toEqual([]);
    w.rules!.push({ id: 'rule/bad', name: '나쁜', trigger: { kind: 'state', condition: { flag: 'nope' } }, reactions: [{ npcId: 'npc/ghost', text: 'x' }], repeat: 0 });
    const errs = validateWorld(w).filter((i) => i.path.startsWith('rules[4]')).map((i) => i.path);
    expect(errs).toEqual(expect.arrayContaining(['rules[4].reactions[0].npcId', 'rules[4].repeat']));
  });

  it('행동 규칙: 낱말 또는 GM이 고른 ID로 발동, 한 번만 / 쿨다운', () => {
    const w = world();
    let s = start(w);
    expect(actionRulesHit(w, s, '나는 맹세를 깨고 떠난다').map((r) => r.id)).toEqual(['rule/oath']);
    expect(actionRulesHit(w, s, '그냥 걷는다', ['rule/bribe']).map((r) => r.id)).toEqual(['rule/bribe']);
    expect(actionRuleList(w, s)).toContain('rule/bribe: 경비에게 돈을 건넨다');
    s = apply(s, fireRule(w, s, w.rules![0]!, 'action').events);
    expect(actionRulesHit(w, s, '맹세를 깨')).toEqual([]); // once
    s = apply(s, fireRule(w, s, w.rules![3]!, 'action').events);
    expect(actionRulesHit(w, s, '', ['rule/bribe'])).toEqual([]); // 3턴 쿨다운
    s = { ...s, turn: s.turn + 3 };
    expect(actionRulesHit(w, s, '', ['rule/bribe']).length).toBe(1);
  });

  it('반응: 그 자리 인물마다 관계 변화 + 메모, 알림은 기록에', () => {
    const w = world();
    let s = start(w);
    s = apply(s, [{ type: 'moved', to: 'loc/village-gate' }]);
    const f = fireRule(w, s, w.rules![0]!, 'action');
    expect(f.note.reactions.map((r) => r.npcId)).toContain('npc/bran');
    expect(f.events.some((e) => e.type === 'relationship_changed' && e.npcId === 'npc/bran')).toBe(true);
    s = apply(s, f.events);
    expect(s.vars?.suspicion).toBe(40);
    expect(s.log.some((l) => l.text.includes('맹세를 깼다는 소문'))).toBe(true);
  });

  it('상태 규칙: 막 참이 될 때 한 번, 연쇄는 같은 턴에 이어진다', () => {
    const w = world();
    let s = start(w);
    s = apply(s, [{ type: 'var_changed', varId: 'suspicion', value: 60, name: '의심' }]);
    const r = stateRuleEvents(w, s);
    expect(r.notes.map((n) => n.ruleId)).toEqual(['rule/watch', 'rule/chain']);
    s = apply(s, r.events);
    expect(s.flags).toContain('guards_alert');
    expect(stateRuleEvents(w, s).events).toEqual([]); // 참인 동안 다시 발동하지 않는다
  });

  it('scenarioEvents에 들어 있어 장면·전투·턴 어디서든 이어진다', () => {
    const w = world();
    let s = start(w);
    s = apply(s, [{ type: 'var_changed', varId: 'suspicion', value: 80, name: '의심' }]);
    const evs = scenarioEvents(w, s).events;
    expect(evs.filter((e) => e.type === 'rule_fired').map((e) => (e as { ruleId: string }).ruleId)).toEqual(['rule/watch', 'rule/chain']);
  });

  it('턴: GM 판단에 규칙 목록, 발동한 규칙은 서술·NPC에게 확정 결과로', async () => {
    const w = world();
    let s = start(w);
    s = apply(s, [{ type: 'moved', to: 'loc/village-gate' }]);
    const seen: Record<string, string> = {};
    const llm: LlmClient = {
      stream: async (r, on) => { seen.narr = r.user; on('서술'); return '서술'; },
      json: async <T,>(r: { system: string; user: string }) => {
        if (r.system.includes('판단 모듈')) { seen.dir = r.user; return { action_summary: '맹세를 어긴다', check_kind: 'none', check_skill: '', check_ability: 'wis', check_dc_tier: 'easy', check_mode: 'normal', check_reason: '', move_to: '', speakers: [], start_encounter: '', rest: 'none', discover: [], set_flags: [], scene_image: '', time_spent: 'moment', rules: ['rule/oath'] } as T; }
        if (r.system.includes('한 명의 NPC')) { seen.actor = r.user; return { action: '', dialogue: '…', shared_claims: [], party_decision: 'none', relationship_change: { affinity: 0, trust: 0, respect: 0, fear: 0, intimacy: 0, grudge: 0, reason: '' } } as T; }
        if (r.system.includes('안내자')) return { summary: 's', suggestion: '', choices: [{ text: 'a', skill: '', kind: 'advance' }] } as T;
        return { facts: [] } as T;
      } };
    const out = await runTurn(llm, w, s, '약속 따위 잊었다', () => {});
    expect(seen.dir).toContain('## 세계 규칙');
    expect(seen.dir).toContain('rule/oath: 플레이어가 맹세·약속을 어긴다');
    expect(seen.narr).toContain('## 이번 턴에 발동한 세계 규칙');
    expect(seen.narr).toContain('맹세를 깨면: 마을 사람들의 눈빛이 차가워진다');
    expect(seen.actor).toContain('## 세계 규칙에 따른 너의 반응');
    expect(out.state.rules?.['rule/oath']?.count).toBe(1);
  });

  it('AI 초안 → 규칙: 참조를 고치고, 새 플래그·수치를 만들고, 이을 수 없는 것은 버린다', () => {
    const w = structuredClone(sampleWorld);
    const C = (type: string, ref = '', value = 0) => ({ type, ref, axis: '', op: 'gte', value }) as never;
    const r = rulesFromDraft(w, {
      new_vars: [{ key: 'heat', name: '수배', initial: 0, min: 0, max: 100 }],
      rules: [
        { key: 'b', name: '읽는 쪽', trigger: 'state', describe: '', keywords: [], when: C('flag', 'wanted'), requires: C('none'), effects: [{ type: 'relationship', ref: 'bran', axis: 'fear', value: 5, to: '' }], outcome: '', reactions: [], announce: '', repeat: 'once', cooldown: 0 },
        { key: 'a', name: '훔치기', trigger: 'action', describe: '물건을 훔친다', keywords: ['훔'], when: C('none'), requires: C('none'), effects: [{ type: 'var', ref: 'heat', axis: '', value: 30, to: '' }, { type: 'set_flag', ref: 'wanted', axis: '', value: 0, to: '' }], outcome: '들켰다', reactions: [{ npc: 'present', text: '소리친다', axis: 'grudge', value: 5 }], announce: '', repeat: 'cooldown', cooldown: 4 },
        { key: 'c', name: '엉뚱', trigger: 'state', describe: '', keywords: [], when: C('quest_done', 'nope'), requires: C('none'), effects: [], outcome: 'x', reactions: [], announce: '', repeat: 'once', cooldown: 0 },
      ],
    });
    expect(r.rules.map((x) => x.name)).toEqual(['읽는 쪽', '훔치기']);
    expect(r.rules[0]!.trigger).toEqual({ kind: 'state', condition: { flag: 'wanted' } });
    expect(r.rules[0]!.effects).toEqual([{ relationship: 'npc/bran', delta: { fear: 5 } }]);
    expect(r.rules[1]!.repeat).toBe(4);
    expect(r.flags.map((f) => f.id)).toEqual(['wanted']);
    expect(r.vars.map((v) => v.id)).toEqual(['heat']);
    const next = { ...w, flags: [...(w.flags ?? []), ...r.flags], vars: [...(w.vars ?? []), ...r.vars], rules: r.rules };
    expect(validateWorld(next).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('AI 점검: 규칙이 없으면 제안', () => {
    expect(scanWorld(structuredClone(sampleWorld)).some((g) => g.key === 'structure.rules')).toBe(true);
    expect(scanWorld(world()).some((g) => g.key === 'structure.rules')).toBe(false);
  });
});
