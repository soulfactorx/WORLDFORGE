import { classLabel, subclassLabel, subclassOptions } from '../engine/classes';
import { useRs } from './reskin';
import type { WorldPackage } from '../engine/schema';
import type { GameState } from '../engine/state/state';
import { allTitles, rankOf, renownOf, renownTier } from '../engine/renown';
import { ABILITIES, ABILITY_NAMES, CLASSES, SKILL_IDS, SKILLS, proficiencyBonus } from '../engine/character/rules';
import { type CharacterSheet, checkModifier } from '../engine/character/sheet';
import { abilityModifier } from '../engine/dice/dice';
import { MAX_LEVEL, XP_FOR_LEVEL } from '../engine/character/progression';
import { CLASS_KITS } from '../engine/combat/cards';
import { resourcesOf } from '../engine/character/sheet';
import { type BuildChoiceKind, FEATS, needsSubclass, SUBCLASSES, subclassesOf } from '../engine/character/build';

const RESOURCE_LABEL: Record<string, string> = {
  slot1: '1레벨 슬롯', slot2: '2레벨 슬롯', slot3: '3레벨 슬롯', slot4: '4레벨 슬롯', slot5: '5레벨 슬롯', bardic_inspiration: '음유 영감', lay_on_hands: '안수', second_wind: '재기의 바람', action_surge: '행동 연쇄',
  channel_divinity: '신성 변환', arcane_recovery: '비전 회복', war_priest: '전쟁 사제', portent: '예견', fey_presence: '요정의 위압',
};

function XpBar({ sheet }: { sheet: CharacterSheet }) {
  const xp = sheet.xp ?? 0;
  if (sheet.level >= MAX_LEVEL) return <span className="small muted">경험치 {xp} (최고 레벨)</span>;
  const from = XP_FOR_LEVEL[sheet.level]!, to = XP_FOR_LEVEL[sheet.level + 1]!;
  return (
    <span className="xp small">
      <span className="muted">경험치 {xp} / {to}</span>
      <span className="hpbar"><span style={{ width: `${Math.min(100, (100 * (xp - from)) / (to - from))}%`, background: 'var(--accent)' }} /></span>
    </span>
  );
}
const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** 명성·등급·칭호 (설계 v4 E4) */
function FameBox({ world, state }: { world: WorldPackage; state: GameState }) {
  const rs = useRs();
  const rank = rankOf(world, state);
  const renown = renownOf(world, state);
  const defs = new Map(allTitles(world).map((t) => [t.id, t]));
  const mine = (state.titles ?? []).map((id) => defs.get(id)).filter((t) => !!t);
  return (
    <div className="fame">
      <div className="row small">
        <b>♛ {rs(rank.label)} {rs(rank.name)}</b>
        {rank.next && <span className="hpbar fame-bar" title={`다음: ${rank.next}`}><span style={{ width: `${Math.round(rank.progress * 100)}%`, background: 'var(--accent)' }} /></span>}
        {rank.next && <span className="muted">다음 {rs(rank.next)}</span>}
        <span className="spacer" />
        <span className="muted">명성 {renown} · {renownTier(renown)}</span>
      </div>
      {mine.length > 0 && <p className="small titles">{mine.map((t) => <span key={t!.id} className="tag" title={t!.desc}>🏅 {rs(t!.name)}</span>)}</p>}
    </div>
  );
}

/** 하위 직업·능력치 향상/특성 고르기 (플레이어 레벨업 뒤, 고를 때까지 대기) */
function BuildChoices({ sheet, onChoose, disabled, world }: { sheet: CharacterSheet; onChoose: (kind: BuildChoiceKind, value: string) => void; disabled?: boolean; world?: WorldPackage }) {
  const rs = useRs();
  const asi = sheet.pending?.[0];
  if (!needsSubclass(sheet) && asi === undefined) return null;
  return (
    <div className="build-choices">
      {needsSubclass(sheet) && (
        <fieldset>
          <legend>★ 하위 직업 고르기 (3레벨)</legend>
          {subclassOptions(world, sheet, rs).map((s) => (
            <button key={s.id} className="build-option" disabled={disabled} onClick={() => onChoose('subclass', s.id)}>
              <b>{s.name}</b> {s.blurb && <span className="small">{s.blurb} </span>}<span className="small muted">{s.blurb ? `규칙: ${s.ruleBlurb}` : s.ruleBlurb}</span>
            </button>
          ))}
        </fieldset>
      )}
      {asi !== undefined && (
        <fieldset>
          <legend>★ 능력치 향상 또는 특성 ({asi}레벨){(sheet.pending?.length ?? 0) > 1 ? ` · ${sheet.pending!.length}개 남음` : ''}</legend>
          <button className="build-option" disabled={disabled} onClick={() => onChoose('asi', '')}>
            <b>능력치 향상</b> <span className="small muted">{(CLASSES[sheet.classId]?.priority ?? []).slice(0, 1).map((a) => ABILITY_NAMES[a]).join('')} +2 (20을 넘으면 다음 능력치로)</span>
          </button>
          {Object.values(FEATS).filter((f) => !sheet.feats?.includes(f.id)).map((f) => (
            <button key={f.id} className="build-option" disabled={disabled} onClick={() => onChoose('feat', f.id)}>
              <b>{f.name}</b> <span className="small muted">{f.desc}</span>
            </button>
          ))}
        </fieldset>
      )}
    </div>
  );
}

export function CharacterPanel({ sheet, party = {}, onChoose, disabled, world, state }: { sheet: CharacterSheet; party?: Record<string, CharacterSheet>; onChoose?: (kind: BuildChoiceKind, value: string) => void; disabled?: boolean; world?: WorldPackage; state?: GameState }) {
  const rs = useRs();
  const subFeatures = sheet.subclass ? Object.entries(SUBCLASSES[sheet.subclass]?.features ?? {}).filter(([lv]) => Number(lv) <= sheet.level).flatMap(([, f]) => f) : [];
  return (
    <aside className="sheet">
      <div className="row">
        <b>{sheet.name}</b>
        <span className="muted small">{classLabel(world, sheet, rs)}{sheet.subclass ? ` (${subclassLabel(world, sheet, rs)})` : ''} {sheet.level}레벨 · 숙련 보너스 {sign(proficiencyBonus(sheet.level))}</span>
        <span className="spacer" />
        <span>HP {sheet.hp}/{sheet.maxHp}</span>
      </div>
      <div className="row small">
        <XpBar sheet={sheet} />
        <span className="spacer" />
        {Object.entries(resourcesOf(sheet)).map(([k, r]) => <span key={k} className="muted">{rs(RESOURCE_LABEL[k] ?? k)} {r.cur}/{r.max}</span>)}
      </div>
      {Object.entries(CLASS_KITS[sheet.classId]?.features ?? {}).some(([lv]) => Number(lv) <= sheet.level) && (
        <p className="small muted">능력: {Object.entries(CLASS_KITS[sheet.classId]!.features!).filter(([lv]) => Number(lv) <= sheet.level).flatMap(([, f]) => f).join(' · ')}</p>
      )}
      {subFeatures.length > 0 && <p className="small muted">{subclassLabel(world, sheet, rs)}: {subFeatures.map(rs).join(' · ')}</p>}
      {(sheet.feats?.length ?? 0) > 0 && <p className="small muted">특성: {sheet.feats!.map((f) => FEATS[f]?.name ?? f).join(' · ')}</p>}
      {onChoose && <BuildChoices sheet={sheet} onChoose={onChoose} disabled={disabled} {...(world ? { world } : {})} />}
      {world && state && <FameBox world={world} state={state} />}
      <div className="ability-grid">
        {ABILITIES.map((a) => (
          <div key={a} className="stat">
            <span className="muted small">{ABILITY_NAMES[a]}{sheet.saveProficiencies.includes(a) ? ' ●' : ''}</span>
            <b>{sign(abilityModifier(sheet.abilities[a]))}</b>
            <span className="muted small">{sheet.abilities[a]}</span>
          </div>
        ))}
      </div>
      <div className="skill-grid small">
        {SKILL_IDS.map((s) => (
          <span key={s} className={sheet.skillProficiencies.includes(s) ? 'prof' : 'muted'}>
            {sheet.skillProficiencies.includes(s) ? '●' : '○'} {SKILLS[s].name} {sign(checkModifier(sheet, { kind: 'skill', skill: s }).total)}
          </span>
        ))}
      </div>
      <p className="muted small">● 숙련 · 내성 굴림 숙련은 능력치 옆 ●</p>
      {Object.keys(party).length > 0 && (
        <div className="party">
          <b className="small">동료</b>
          {Object.entries(party).map(([id, c]) => (
            <div key={id} className="row small">
              <b>{c.name}</b>
              <span className="muted">{classLabel(world, c, rs)}{c.subclass ? ` (${subclassLabel(world, c, rs)})` : ''} {c.level}레벨</span>
              <span className="spacer" />
              {Object.entries(c.resources ?? {}).map(([k, r]) => <span key={k} className="muted">{rs(RESOURCE_LABEL[k] ?? k)} {r.cur}/{r.max}</span>)}
              <span>HP {c.hp}/{c.maxHp}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
