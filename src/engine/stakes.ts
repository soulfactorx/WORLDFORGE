/**
 * 걸린 것 (stake) — 선택지가 "맛"이 아니라 "방향"으로 다르게 (v0.114, 설계 v6 M4 3.3절).
 * 선택지마다 엔진이 정의한 목록에서 걸린 것 하나를 고르고, 고르면 엔진이 그 결과를 적용한다.
 * 한 번에 보이는 선택지들은 서로 다른 걸린 것을 가진다 — 어느 것을 골라도 같은 데로 가는 일이 없게.
 *
 * 모양: "escalate" · "defuse" · "side:세력ID" · "bond:인물ID" · "betray:인물ID" · "expose:명제ID" · "theme:수치ID:+" · "theme:수치ID:-" · "thread:갈래ID"
 */
import { displayName } from './names';
import { josa } from './text/josa';
import { phasesOf } from './phase';
import type { WorldPackage } from './schema';
import type { GameState } from './state/state';
import { worldVars } from './vars';

export type StakeKind = 'escalate' | 'defuse' | 'side' | 'bond' | 'betray' | 'expose' | 'theme' | 'thread';
export interface Stake { kind: StakeKind; ref?: string; dir?: 1 | -1 }

export function parseStake(id: string | undefined): Stake | null {
  if (!id) return null;
  const [kind, ref, dir] = id.split(':') as [string, string | undefined, string | undefined];
  if (kind === 'escalate' || kind === 'defuse') return { kind };
  if ((kind === 'side' || kind === 'bond' || kind === 'betray' || kind === 'expose' || kind === 'thread') && ref) return { kind, ref };
  if (kind === 'theme' && ref && (dir === '+' || dir === '-')) return { kind, ref, dir: dir === '+' ? 1 : -1 };
  return null;
}

export const STAKE_ICON: Record<StakeKind, string> = { escalate: '🔥', defuse: '🕊', side: '⚖', bond: '🤝', betray: '🗡', expose: '🗝', theme: '🧭', thread: '🧵' };

/** 화면에 보이는 짧은 이름 (예: "⚖ 루미나 왕국 쪽") */
export function stakeLabel(world: WorldPackage, s: GameState, id: string): string {
  const st = parseStake(id);
  if (!st) return '';
  const npc = () => { const c = world.characters.find((x) => x.id === st.ref); return c ? displayName(s, c) : st.ref; };
  const icon = STAKE_ICON[st.kind];
  switch (st.kind) {
    case 'escalate': return `${icon} 판을 키운다`;
    case 'defuse': return `${icon} 가라앉힌다`;
    case 'side': return `${icon} ${world.factions?.find((f) => f.id === st.ref)?.name ?? st.ref} 쪽`;
    case 'bond': return `${icon} ${josa(npc() ?? '', '과/와')} 가까워진다`;
    case 'betray': return `${icon} ${josa(npc() ?? '', '을/를')} 저버린다`;
    case 'expose': return `${icon} 비밀을 드러낸다`;
    case 'theme': { const v = worldVars(world).find((x) => x.id === st.ref); return `${icon} ${v?.poles?.[st.dir === 1 ? 1 : 0] ?? v?.name ?? st.ref} 쪽`; }
    case 'thread': return `${icon} ${world.storylets?.find((x) => x.id === st.ref)?.title ?? '다른 길'}`;
  }
}

/** 지금 걸 수 있는 것 — 선택지를 만드는 AI에게 주는 목록 (플레이어가 아는 것만) */
export function stakeOptions(world: WorldPackage, s: GameState, present: { id: string }[]): { id: string; label: string; note: string }[] {
  const out: { id: string; label: string; note: string }[] = [];
  const add = (id: string, note: string) => out.push({ id, label: stakeLabel(world, s, id), note });
  add('escalate', '판을 키우는 행동 — 도발·위협·폭력·무모한 시도. 긴장이 크게 오르고 일이 번진다');
  add('defuse', '가라앉히는 행동 — 달래기·물러서기·타협·쉬기. 긴장이 내린다');
  for (const c of present.slice(0, 4)) {
    if (s.deadNpcs.includes(c.id)) continue;
    add(`bond:${c.id}`, '이 인물 편에 서거나 마음을 여는 행동 — 관계가 크게 움직인다');
    add(`betray:${c.id}`, '이 인물을 속이거나 버리거나 등지는 행동 — 원한이 남고 앙갚음이 돌아온다');
  }
  const facs = world.factions ?? [];
  const nearFacs = new Set(present.map((c) => world.characters.find((x) => x.id === c.id)?.faction).filter(Boolean));
  for (const f of [...facs.filter((f) => nearFacs.has(f.id)), ...facs.filter((f) => !nearFacs.has(f.id))].slice(0, 4)) {
    add(`side:${f.id}`, `${f.name}의 편에 서는 행동 — 그 세력의 평판이 오르고 맞선 세력이 알아챈다`);
  }
  // 플레이어가 아는 비밀 (어느 인물이 비밀로 쥐고 있는 명제)
  const secrets = new Set(world.beliefs.filter((b) => b.state === 'secret').map((b) => b.claim));
  for (const b of s.beliefs.filter((b) => b.holder === 'player' && secrets.has(b.claim)).slice(-3)) {
    const c = world.claims.find((x) => x.id === b.claim);
    if (c) add(`expose:${c.id}`, `알고 있는 비밀을 드러내는 행동: "${c.statement.slice(0, 40)}" — 파장이 돌아온다`);
  }
  for (const v of worldVars(world).filter((x) => x.poles)) {
    add(`theme:${v.id}:-`, `세계의 방향을 "${v.poles![0]}" 쪽으로 미는 행동`);
    add(`theme:${v.id}:+`, `세계의 방향을 "${v.poles![1]}" 쪽으로 미는 행동`);
  }
  return out;
}

/** 걸린 것이 지금 유효한가 (없는 인물·세력·명제를 가리키지 않는가) */
export function stakeValid(world: WorldPackage, s: GameState, id: string): boolean {
  const st = parseStake(id);
  if (!st) return false;
  switch (st.kind) {
    case 'escalate': case 'defuse': return true;
    case 'side': return !!world.factions?.some((f) => f.id === st.ref);
    case 'bond': case 'betray': return world.characters.some((c) => c.id === st.ref) && !s.deadNpcs.includes(st.ref!);
    case 'expose': return s.beliefs.some((b) => b.holder === 'player' && b.claim === st.ref);
    case 'theme': return worldVars(world).some((v) => v.id === st.ref && v.poles);
    case 'thread': return !!world.storylets?.some((x) => x.id === st.ref);
  }
}

/** 국면 이름 (원장 표시용) */
export const phaseName = (world: WorldPackage, id?: string) => (id ? phasesOf(world).find((p) => p.id === id)?.name ?? id : '');
