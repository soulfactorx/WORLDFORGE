import { useEffect } from 'react';
import type { CharacterSheet } from '../engine/character/sheet';
import { XP_FOR_LEVEL } from '../engine/character/progression';
import { CLASSES } from '../engine/character/rules';
import type { levelUpInfo, Recap, RewardLine } from '../engine/digest';
import { type ItemDef, RARITY_LABEL } from '../engine/schema';
import { rarityOf } from '../engine/items';
import { bonusLine, KIND_LABEL } from './InventoryPanel';

type Rs = (s: string) => string;

/** 이번 턴에 얻은 것 (설계 v4 E2) */
export function RewardBanner({ lines, onClose }: { lines: RewardLine[]; onClose: () => void }) {
  return (
    <div className="reward-banner" role="status" aria-live="polite">
      <span className="small muted">이번 턴</span>
      {lines.map((l, i) => <span key={i} className={`reward-chip${l.icon === '★' ? ' big' : ''}${l.rarity && l.rarity !== 'common' ? ` rarity-${l.rarity} rarity-chip` : ''}`}>{l.icon} {l.text}</span>)}
      <button type="button" className="reward-close" aria-label="닫기" onClick={onClose}>✕</button>
    </div>
  );
}

/** 레벨업 화면: 새 능력·새 카드, 고를 것이 있으면 캐릭터 창으로 */
export function LevelUpDialog({ info, sheet, rs, onClose, onSheet }: { info: ReturnType<typeof levelUpInfo>; sheet: CharacterSheet; rs: Rs; onClose: () => void; onSheet: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="levelup" role="dialog" aria-modal="true" aria-label="레벨업" onClick={(e) => e.stopPropagation()}>
        <p className="levelup-title">★ {sheet.level}레벨</p>
        <p className="small muted">{rs(CLASSES[sheet.classId]?.name ?? '')} · 최대 HP {sheet.maxHp} (+{info.hpGain})</p>
        {info.features.length > 0 && (
          <ul className="levelup-features">{info.features.map((f, i) => <li key={i}>{rs(f)}</li>)}</ul>
        )}
        {info.cards.length > 0 && (
          <div className="levelup-cards">
            {info.cards.map((c) => (
              <div key={c.id} className="levelup-card"><b>{rs(c.name)}</b><span className="small">{rs(c.desc)}</span></div>
            ))}
          </div>
        )}
        <div className="row">
          {info.pending > 0 && <button type="button" className="primary" onClick={onSheet}>★ 고를 것 {info.pending}개 — 캐릭터 창에서 고르기</button>}
          <button type="button" onClick={onClose}>계속</button>
        </div>
      </div>
    </div>
  );
}

/** 이어하기: 지난 이야기 */
export function RecapCard({ r, rs, onClose, onSheet }: { r: Recap; rs: Rs; onClose: () => void; onSheet: () => void }) {
  const todo = [r.todo.main && ['메인', r.todo.main], r.todo.side && ['사이드', r.todo.side], r.todo.bond && ['관계', r.todo.bond]].filter((x): x is string[] => !!x);
  return (
    <div className="recap">
      <div className="row"><b>📜 지난 이야기</b><span className="small muted">{rs(r.where)} · {r.when}</span><span className="spacer" /><button type="button" className="small" onClick={onClose} aria-label="닫기">✕</button></div>
      {r.last && <p className="small recap-last">{r.last}</p>}
      {todo.length > 0 && (
        <ul className="todo small">{todo.map(([k, v]) => <li key={k}><span className="tag">{k}</span> {rs(v!)}</li>)}</ul>
      )}
      {r.questions.length > 0 && (
        <p className="small"><b>궁금한 것</b> · {r.questions.map((q) => rs(q)).join(' · ')}</p>
      )}
      {r.pending > 0 && <button type="button" className="small has-pending" onClick={onSheet}>★ 레벨업 선택 {r.pending}개가 기다린다</button>}
    </div>
  );
}

/** 좋은 전리품 (희귀 이상) — 설명·보너스와 바로 장비하기 */
export function LootDialog({ item, rs, canEquip, onEquip, onClose }: { item: ItemDef & { stage?: number }; rs: Rs; canEquip: boolean; onEquip: () => void; onClose: () => void }) {
  const r = rarityOf(item);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`levelup loot rarity-border-${r}`} role="dialog" aria-modal="true" aria-label="전리품" onClick={(e) => e.stopPropagation()}>
        <p className="small muted" style={{ textAlign: 'center', margin: 0 }}>{RARITY_LABEL[r]} · {KIND_LABEL[item.kind]}</p>
        <p className={`levelup-title rarity-${r}`}>{rs(item.name)}</p>
        <p className="small">{rs(item.description)}</p>
        {bonusLine(item) && <p className="small item-bonus">{rs(bonusLine(item))}</p>}
        <div className="row">
          {canEquip && <button type="button" className="primary" onClick={onEquip}>바로 장비하기</button>}
          <button type="button" onClick={onClose}>계속</button>
        </div>
      </div>
    </div>
  );
}

/** 게임형 표시 (설계 v4 E8): 레벨과 다음 레벨까지의 경험치 막대 */
export function XpBar({ sheet }: { sheet: CharacterSheet }) {
  const cur = XP_FOR_LEVEL[sheet.level] ?? 0;
  const next = XP_FOR_LEVEL[sheet.level + 1];
  const pct = next ? Math.max(0, Math.min(100, Math.round((((sheet.xp ?? 0) - cur) / (next - cur)) * 100))) : 100;
  return (
    <span className="xp-bar small nowrap" title={next ? `경험치 ${sheet.xp ?? 0} / ${next}` : '최고 레벨'}>
      Lv {sheet.level} <span className="xp-track" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span> {next ? `${pct}%` : 'MAX'}
    </span>
  );
}
