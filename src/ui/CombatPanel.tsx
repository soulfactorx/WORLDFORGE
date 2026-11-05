import { useRs } from './reskin';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { MONSTERS } from '../engine/combat/monsters';
import { type CardDef, CONDITION_DESC, CONDITION_LABEL } from '../engine/combat/cards';
import {
  conditionsOf,
  alive, type CombatState, currentActorId, DEFAULT_ORDER, handOf, type PartyOrder, type Target, unusableReason, validTargets, ZONE_NAMES,
} from '../engine/combat/combat';

const ORDER_LABEL: Record<PartyOrder['mode'], string> = { free: '자율', focus: '집중 공격', guard: '나를 지켜라', hold_back: '후방 유지' };

const COST_LABEL = { action: '행동', bonus: '보너스', move: '이동', free: '자유' } as const;
const SLOT_LABEL = (r: Record<string, { cur: number; max: number }>) =>
  Object.entries(r).filter(([k]) => k.startsWith('slot')).map(([k, v]) => `${k.slice(4)}레벨 ${v.cur}/${v.max}`).join(' · ');

/** 적 역할별 표식 (초상화가 없을 때) */
const ROLE_GLYPH: Record<string, string> = { minion: '🗡', brute: '🪓', skirmisher: '🏹', artillery: '🎯', controller: '🌀', leader: '🚩', boss: '👑' };

export function CombatPanel({ cs, busy, orders, onAct, onEndTurn, onOrder, portrait }: {
  cs: CombatState;
  /** 전투원 초상화 (동료·플레이어). 없으면 표식 */
  portrait?: (combatantId: string) => ReactNode;
  busy: boolean;
  orders: Record<string, PartyOrder>;
  onAct: (cardId: string, target: Target) => void;
  onEndTurn: () => void;
  onOrder: (npcId: string, order: PartyOrder) => void;
}) {
  const rs = useRs();
  const companions = Object.values(cs.combatants).filter((c) => c.side === 'party' && !c.isPlayer);
  const enemies = Object.values(cs.combatants).filter((c) => c.side === 'enemy' && alive(c));
  const [selected, setSelected] = useState<CardDef | null>(null);
  const me = cs.combatants.player!;
  const myTurn = currentActorId(cs) === 'player' && !cs.outcome;
  const targets = selected ? validTargets(cs, 'player', selected) : [];

  // 연출 (설계 v3 R10): HP가 바뀐 전투원 위로 숫자가 떠오르고, 맞은 토큰은 흔들린다
  const prevHp = useRef<Record<string, number> | null>(null);
  const [pops, setPops] = useState<{ key: number; id: string; text: string; cls: string }[]>([]);
  const popKey = useRef(0);
  useEffect(() => {
    const now = Object.fromEntries(Object.values(cs.combatants).map((c) => [c.id, c.hp]));
    const prev = prevHp.current;
    prevHp.current = now;
    if (!prev) return;
    const fresh = Object.entries(now).flatMap(([id, hp]) => {
      const d = hp - (prev[id] ?? hp);
      return d ? [{ key: ++popKey.current, id, text: d > 0 ? `+${d}` : `${d}`, cls: d > 0 ? 'heal' : 'dmg' }] : [];
    });
    if (!fresh.length) return;
    setPops((p) => [...p, ...fresh]);
    const keys = new Set(fresh.map((f) => f.key));
    const t = setTimeout(() => setPops((p) => p.filter((x) => !keys.has(x.key))), 1400);
    return () => clearTimeout(t);
  }, [cs]);

  function choose(card: CardDef) {
    if (busy || unusableReason(cs, 'player', card)) return;
    const ts = validTargets(cs, 'player', card);
    if (card.target === 'self' || ts.length === 1) { setSelected(null); onAct(card.id, ts[0]!); return; }
    setSelected(card);
  }
  function pick(t: Target) {
    if (!selected || !targets.includes(t)) return;
    const id = selected.id;
    setSelected(null);
    onAct(id, t);
  }

  return (
    <section className="combat-panel">
      <div className="row">
        <b>⚔ {cs.round}라운드</b>
        <span className="muted small">{myTurn ? '당신의 차례' : `${rs(cs.combatants[currentActorId(cs)]?.name ?? '')}의 차례`}</span>
        <span className="spacer" />
        <span className="small">
          행동 {cs.economy.action ? '●' : '○'} · 보너스 {cs.economy.bonus ? '●' : '○'} · 이동 {cs.economy.move ? '●' : '○'}
        </span>
      </div>

      <div className="zones">
        {ZONE_NAMES.map((name, z) => {
          const zoneTarget = (selected?.target === 'zone' || selected?.target === 'area') && targets.includes(z);
          return (
            <div key={z} className={`zone ${z < 2 ? 'party' : 'enemy'} ${zoneTarget ? 'targetable' : ''}`} onClick={() => zoneTarget && pick(z)}>
              <div className="zone-name small">{name}</div>
              {Object.values(cs.combatants).filter((c) => c.zone === z).map((c) => {
                const targetable = (selected?.target === 'enemy' || selected?.target === 'ally') && targets.includes(c.id);
                return (
                  <button key={c.id} type="button" disabled={!targetable && !!selected}
                    className={`chip ${c.side} ${c.hp <= 0 ? (c.side === 'party' && !c.dead ? 'downed' : 'down') : ''} ${targetable ? 'targetable' : ''} ${currentActorId(cs) === c.id ? 'active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); if (targetable) pick(c.id); }}>
                    <span className={`token ${c.side} ${pops.some((p) => p.id === c.id && p.cls === 'dmg') ? 'hurt' : ''}`}
                      style={{ ['--hp' as string]: `${Math.max(0, Math.round((100 * c.hp) / c.maxHp))}%` }}>
                      <span className="token-face">{portrait?.(c.id) ?? (c.side === 'enemy' ? ROLE_GLYPH[MONSTERS[c.monsterId ?? '']?.role ?? ''] ?? '⚔' : c.isPlayer ? '★' : '🛡')}</span>
                      {pops.filter((p) => p.id === c.id).map((p) => <span key={p.key} className={`pop ${p.cls}`}>{p.text}</span>)}
                    </span>
                    <span className="chip-name">{c.isPlayer ? '당신' : rs(c.name)}{c.side === 'party' && !c.isPlayer ? ' (동료)' : ''}{c.escaped ? ' (도망침)' : ''}</span>
                    <span className="hpbar"><span style={{ width: `${(100 * c.hp) / c.maxHp}%` }} /></span>
                    <span className="small">HP {c.hp}/{c.maxHp} · AC {c.ac}{c.dodging ? ' · 회피' : ''}{c.hidden ? ' · 숨음' : ''}{c.disengaged ? ' · 후퇴' : ''}</span>
                    {(c.prone || c.dead || c.stable || (c.hp <= 0 && c.side === 'party')) && (
                      <span className="small cond">
                        {c.dead ? '✝ 사망' : c.stable ? '안정 (의식 없음)' : c.hp <= 0 && c.side === 'party' ? `빈사 — 성공 ${c.deathSaves?.success ?? 0} · 실패 ${c.deathSaves?.fail ?? 0}` : ''}
                        {c.prone && !c.dead && c.hp > 0 ? '넘어짐' : ''}
                      </span>
                    )}
                    {c.hp > 0 && conditionsOf(c).length > 0 && (
                      <span className="small conds">
                        {conditionsOf(c).map(({ condition, rounds }) => (
                          <span key={condition} className={`cond-badge c-${condition}`} title={CONDITION_DESC[condition]}>{CONDITION_LABEL[condition]} {rounds}</span>
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {selected && (
        <p className="small status">
          <b>{rs(selected.name)}</b>: {selected.target === 'zone' ? '이동할 존을 고르세요.' : selected.target === 'area' ? '주문을 펼칠 존을 고르세요.' : '대상을 고르세요.'}{' '}
          <button type="button" onClick={() => setSelected(null)}>취소</button>
        </p>
      )}

      {companions.length > 0 && (
        <div className="orders">
          {companions.map((c) => {
            const o = orders[c.id] ?? DEFAULT_ORDER;
            const set = (patch: Partial<PartyOrder>) => onOrder(c.id, { ...o, ...patch });
            return (
              <div key={c.id} className="row small">
                <b>{rs(c.name)}</b>
                <select value={o.mode} disabled={busy || !alive(c)} onChange={(e) => {
                  const mode = e.target.value as PartyOrder['mode'];
                  set({ mode, focus: mode === 'focus' ? (o.focus && cs.combatants[o.focus] && alive(cs.combatants[o.focus]!) ? o.focus : enemies[0]?.id) : undefined });
                }}>
                  {Object.entries(ORDER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                {o.mode === 'focus' && (
                  <select value={o.focus ?? ''} disabled={busy} onChange={(e) => set({ focus: e.target.value })}>
                    {enemies.map((en) => <option key={en.id} value={en.id}>{rs(en.name)}</option>)}
                  </select>
                )}
                <label className="check"><input type="checkbox" checked={o.conserve} disabled={busy} onChange={(e) => set({ conserve: e.target.checked })} /> 자원 아끼기</label>
              </div>
            );
          })}
        </div>
      )}

      <div className="hand">
        {handOf(me).map((card) => {
          const reason = unusableReason(cs, 'player', card);
          const res = card.resource ? me.resources[card.resource] : undefined;
          return (
            <button key={card.id} type="button" className={`card ${selected?.id === card.id ? 'selected' : ''}`}
              disabled={busy || !!reason} title={rs(reason ?? card.desc)} onClick={() => choose(card)}>
              <span className="card-head"><b>{rs(card.name)}</b><span className={`cost ${card.cost}`}>{COST_LABEL[card.cost]}</span></span>
              <span className="small muted card-desc">{rs(card.desc)}</span>
              {res && <span className="small">남은 횟수 {res.cur}/{res.max}</span>}
              {card.spellLevel && <span className="small">슬롯 {SLOT_LABEL(me.resources)}</span>}
              {reason && myTurn && <span className="small reason">{reason}</span>}
            </button>
          );
        })}
      </div>
      <div className="row">
        <span className="spacer" />
        <button type="button" className="primary" disabled={busy || !myTurn} onClick={() => { setSelected(null); onEndTurn(); }}>턴 종료</button>
      </div>
    </section>
  );
}
