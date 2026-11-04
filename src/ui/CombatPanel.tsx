import { useState } from 'react';
import type { CardDef } from '../engine/combat/cards';
import {
  type CombatState, currentActorId, handOf, type Target, unusableReason, validTargets, ZONE_NAMES,
} from '../engine/combat/combat';

const COST_LABEL = { action: '행동', bonus: '보너스', move: '이동' } as const;

export function CombatPanel({ cs, busy, onAct, onEndTurn }: {
  cs: CombatState;
  busy: boolean;
  onAct: (cardId: string, target: Target) => void;
  onEndTurn: () => void;
}) {
  const [selected, setSelected] = useState<CardDef | null>(null);
  const me = cs.combatants.player!;
  const myTurn = currentActorId(cs) === 'player' && !cs.outcome;
  const targets = selected ? validTargets(cs, 'player', selected) : [];

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
    <section className="combat">
      <div className="row">
        <b>⚔ {cs.round}라운드</b>
        <span className="muted small">{myTurn ? '당신의 차례' : `${cs.combatants[currentActorId(cs)]?.name}의 차례`}</span>
        <span className="spacer" />
        <span className="small">
          행동 {cs.economy.action ? '●' : '○'} · 보너스 {cs.economy.bonus ? '●' : '○'} · 이동 {cs.economy.move ? '●' : '○'}
        </span>
      </div>

      <div className="zones">
        {ZONE_NAMES.map((name, z) => {
          const zoneTarget = selected?.target === 'zone' && targets.includes(z);
          return (
            <div key={z} className={`zone ${z < 2 ? 'party' : 'enemy'} ${zoneTarget ? 'targetable' : ''}`} onClick={() => zoneTarget && pick(z)}>
              <div className="zone-name small">{name}</div>
              {Object.values(cs.combatants).filter((c) => c.zone === z).map((c) => {
                const targetable = selected?.target === 'enemy' && targets.includes(c.id);
                return (
                  <button key={c.id} type="button" disabled={!targetable && !!selected}
                    className={`chip ${c.side} ${c.hp <= 0 ? 'down' : ''} ${targetable ? 'targetable' : ''} ${currentActorId(cs) === c.id ? 'active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); if (targetable) pick(c.id); }}>
                    <span className="chip-name">{c.isPlayer ? '당신' : c.name}</span>
                    <span className="hpbar"><span style={{ width: `${(100 * c.hp) / c.maxHp}%` }} /></span>
                    <span className="small">HP {c.hp}/{c.maxHp} · AC {c.ac}{c.dodging ? ' · 회피' : ''}{c.hidden ? ' · 숨음' : ''}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {selected && (
        <p className="small status">
          <b>{selected.name}</b>: {selected.target === 'zone' ? '이동할 존을 고르세요.' : '대상을 고르세요.'}{' '}
          <button type="button" onClick={() => setSelected(null)}>취소</button>
        </p>
      )}

      <div className="hand">
        {handOf(me).map((card) => {
          const reason = unusableReason(cs, 'player', card);
          const res = card.resource ? me.resources[card.resource] : undefined;
          return (
            <button key={card.id} type="button" className={`card ${selected?.id === card.id ? 'selected' : ''}`}
              disabled={busy || !!reason} title={reason ?? card.desc} onClick={() => choose(card)}>
              <span className="card-head"><b>{card.name}</b><span className={`cost ${card.cost}`}>{COST_LABEL[card.cost]}</span></span>
              <span className="small muted card-desc">{card.desc}</span>
              {res && <span className="small">남은 횟수 {res.cur}/{res.max}</span>}
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
