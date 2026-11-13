/**
 * 걸린 것의 결과 · 파장 원장 · 후폭풍 (v0.114, 설계 v6 M4 3.3절).
 * 플레이어가 고른 선택의 무게를 엔진이 적용하고, 큰 선택은 몇 턴 뒤 돌아올 후폭풍을 예약한다.
 * 후폭풍은 그 턴의 서술 앞에서 확정된다 — GM과 서술자는 그것을 장면에 담는다.
 */
import { displayName } from '../engine/names';
import { TENSION } from '../engine/phase';
import { parseStake, stakeLabel } from '../engine/stakes';
import type { StoryEffect, WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import { applyEvent, type FalloutEntry, type GameState } from '../engine/state/state';
import { josa } from '../engine/text/josa';
import { effectEvents } from './story';

type Tier = 'success' | 'cost' | 'fail' | undefined;

/** 후폭풍이 돌아오기까지 (턴) */
const FALLOUT_TURNS: Record<string, number> = { betray: 2, expose: 2, side: 3, escalate: 2 };

/**
 * 고른 선택의 무게를 적용한다. tier: 이 턴 판정의 결과 (판정이 없으면 성공으로 본다).
 * line: 서술자·GM에게 주는 한 줄 (엔진 확정)
 */
export function stakeEvents(world: WorldPackage, state: GameState, id: string, tier: Tier, choice: string): { events: GameEvent[]; line: string } {
  const st = parseStake(id);
  if (!st) return { events: [], line: '' };
  const out: GameEvent[] = [];
  let s = state;
  const push = (e: GameEvent) => { out.push(e); s = applyEvent(s, e, state.turn); };
  const fx = (effects: StoryEffect[], why: string) => effectEvents(world, s, effects, why).forEach(push);
  const ok = tier !== 'fail';
  const label = stakeLabel(world, state, id);
  const npc = st.ref ? world.characters.find((c) => c.id === st.ref) : undefined;
  const npcName = npc ? displayName(state, npc) : '';
  let line = '';
  switch (st.kind) {
    case 'escalate':
      fx([{ var: TENSION, add: 2 }], '판을 키웠다');
      line = ok ? '판이 커졌다 — 상대와 주변이 그 기세에 반응하고, 일이 한 단계 번진다' : '판을 키우려다 틀어졌다 — 그래도 불씨는 붙었다';
      break;
    case 'defuse':
      if (ok) fx([{ var: TENSION, add: -2 }], '가라앉혔다');
      line = ok ? '긴장이 한풀 꺾였다 — 숨 돌릴 틈이 생긴다' : '가라앉히려 했지만 통하지 않았다';
      break;
    case 'side': {
      const f = world.factions?.find((x) => x.id === st.ref);
      if (!f) break;
      const rivals = (world.factions ?? []).filter((x) => x.id !== f.id).slice(0, 2);
      fx([{ reputation: f.id, delta: ok ? 6 : 2 }, ...(ok ? rivals.map((r) => ({ reputation: r.id, delta: -3 })) : [])], `${f.name} 편에 섰다`);
      line = `${josa(f.name, '이/가')} 당신을 자기 편으로 여기기 시작한다${ok && rivals.length ? ` — ${rivals.map((r) => r.name).join('·')}은(는) 그것을 달갑지 않게 본다` : ''}`;
      break;
    }
    case 'bond':
      if (!npc) break;
      fx([{ relationship: npc.id, delta: ok ? (tier === 'cost' ? { affinity: 2, trust: 2 } : { affinity: 4, trust: 4, intimacy: 2 }) : { trust: -2 } }], ok ? '마음을 열었다' : '다가가려다 어긋났다');
      line = ok ? `${josa(npcName, '과/와')}의 거리가 눈에 띄게 가까워진다` : `${npcName}에게 다가가려 했지만 어긋났다 — 서먹함이 남는다`;
      break;
    case 'betray':
      if (!npc) break;
      fx([{ relationship: npc.id, delta: { trust: -8, affinity: -5, grudge: 8 } }, { var: TENSION, add: 1 }], '저버렸다');
      line = `${josa(npcName, '을/를')} 저버렸다 — 그는 이 일을 잊지 않는다`;
      break;
    case 'expose': {
      const c = world.claims.find((x) => x.id === st.ref);
      if (!c) break;
      fx([{ var: TENSION, add: 2 }], '비밀을 드러냈다');
      line = `비밀이 드러났다: "${c.statement.slice(0, 60)}" — 듣는 이들의 얼굴이 굳는다`;
      break;
    }
    case 'theme': {
      if (!st.ref) break;
      fx([{ var: st.ref, add: (ok ? 2 : 1) * (st.dir ?? 1) }], label);
      line = `세계의 방향이 기운다 — ${label}`;
      break;
    }
    case 'thread':
      line = '다른 길로 들어섰다';
      break;
  }
  push({ type: 'stake_applied', stake: id, label, choice: choice.slice(0, 80), line });
  const due = FALLOUT_TURNS[st.kind];
  if (due && ok) push({ type: 'fallout_queued', id: `${id}@${state.turn}`, stake: id, due: state.turn + due, text: label });
  return { events: out, line };
}

/** 이 턴에 돌아오는 후폭풍 → 이벤트 + GM·서술자에게 주는 줄 */
export function falloutEvents(world: WorldPackage, state: GameState): { events: GameEvent[]; lines: string[] } {
  const due = (state.fallout ?? []).filter((f) => f.due <= state.turn);
  const out: GameEvent[] = [];
  const lines: string[] = [];
  let s = state;
  const push = (e: GameEvent) => { out.push(e); s = applyEvent(s, e, state.turn); };
  for (const f of due) {
    const r = fire(world, s, f);
    r.effects.length && effectEvents(world, s, r.effects, '후폭풍').forEach(push);
    push({ type: 'fallout_fired', id: f.id, text: r.text });
    lines.push(`${r.text} (엔진 확정 — ${state.turn - f.turn}턴 전의 선택이 돌아왔다. 이번 장면에 반드시 담는다: ${r.direction})`);
  }
  return { events: out, lines };
}

function fire(world: WorldPackage, s: GameState, f: FalloutEntry): { effects: StoryEffect[]; text: string; direction: string } {
  const st = parseStake(f.stake);
  const npc = st?.ref ? world.characters.find((c) => c.id === st.ref) : undefined;
  const name = npc ? displayName(s, npc) : '';
  switch (st?.kind) {
    case 'betray':
      return { effects: [{ var: TENSION, add: 2 }], text: `↩ ${josa(name, '이/가')} 당신의 배신을 잊지 않았다`,
        direction: `${name}의 앙갚음이 찾아온다 — 직접 나타나거나, 사람을 보내거나, 당신에 대한 나쁜 소문이 돈다${s.deadNpcs.includes(npc?.id ?? '') ? ' (그는 죽었지만 그를 따르던 이들이 기억한다)' : ''}` };
    case 'expose': {
      const holders = world.beliefs.filter((b) => b.claim === st.ref && b.state === 'secret').map((b) => world.characters.find((c) => c.id === b.holder)).filter((c): c is NonNullable<typeof c> => !!c && !s.deadNpcs.includes(c.id));
      return { effects: [{ var: TENSION, add: 1 }, ...holders.map((h) => ({ relationship: h.id, delta: { trust: -4, grudge: 4 } }))],
        text: `↩ 드러난 비밀이 번졌다`, direction: `그 비밀을 쥐고 있던 이들${holders.length ? `(${holders.map((h) => displayName(s, h)).join(', ')})` : ''}이 움직인다 — 해명을 요구하거나, 입을 막으려 하거나, 그 비밀로 이득을 보려는 자가 나타난다` };
    }
    case 'side': {
      const f2 = world.factions?.find((x) => x.id === st.ref);
      const rival = (world.factions ?? []).find((x) => x.id !== st.ref);
      return { effects: [{ var: TENSION, add: 1 }, ...(rival ? [{ reputation: rival.id, delta: -2 }] : [])],
        text: `↩ ${rival ? josa(rival.name, '이/가') : '맞선 쪽이'} 당신이 ${f2?.name ?? '그쪽'} 편에 선 것을 알았다`, direction: '맞선 쪽의 사람이 경고하러 오거나, 길이 막히거나, 값이 오른다' };
    }
    case 'escalate':
      return { effects: [{ var: TENSION, add: 1 }], text: '↩ 키운 불씨가 번졌다', direction: '그때 벌인 일이 더 커져서 돌아온다 — 추격·소문·보복·구경꾼들' };
    default:
      return { effects: [], text: `↩ ${f.text}`, direction: '지난 선택의 여파가 장면에 나타난다' };
  }
}
