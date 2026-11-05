/**
 * 캐릭터 빌드 선택 — 하위 직업(3레벨)과 특성(능력치 향상 레벨). 설계 v3 8장.
 * 직업마다 하위 직업 2개: 하나는 SRD 5.2.1 (CC-BY-4.0)에 있는 것, 하나는 WORLDFORGE 자체 창작.
 * 플레이어는 레벨업 때 직접 고르고(고를 때까지 '선택 대기'), 동료는 자동으로 고른다.
 */
import { abilityModifier } from '../dice/dice';
import { ABILITY_NAMES, type Ability, CLASSES } from './rules';
import { type CharacterSheet, classResources, resourcesOf } from './sheet';

export interface SubclassDef {
  id: string;
  classId: string;
  name: string;
  blurb: string;
  /** SRD 5.2.1에 있는 하위 직업인가 (아니면 자체 창작) */
  srd: boolean;
  /** 레벨별로 얻는 카드 */
  cards?: Record<number, string[]>;
  /** 레벨별 새 능력 이름 */
  features: Record<number, string[]>;
}

const sub = (s: SubclassDef) => s;

export const SUBCLASSES: Record<string, SubclassDef> = Object.fromEntries([
  sub({ id: 'champion', classId: 'fighter', name: '챔피언', srd: true, blurb: '치명타가 19~20에서 터진다. 단순하고 강하다.', features: { 3: ['향상된 치명타 (19~20)'] } }),
  sub({ id: 'guardian', classId: 'fighter', name: '수호자', srd: false, blurb: '보너스 행동으로 같은 존의 아군을 감싸, 그 아군을 노리는 공격에 불리점을 준다.', cards: { 3: ['fighter/guard'] }, features: { 3: ['감싸기 (보너스 행동)'], 7: ['굳건한 방패 (AC +1)'] } }),
  sub({ id: 'thief', classId: 'rogue', name: '도둑', srd: true, blurb: '그림자처럼 움직인다. 숨기 판정에 이점.', features: { 3: ['은밀한 발걸음 (숨기 판정에 이점)'] } }),
  sub({ id: 'duelist', classId: 'rogue', name: '결투가', srd: false, blurb: '홀로 선 적과의 일대일. 대상이 그 존에 혼자 있으면 근접 암습을 넣는다.', features: { 3: ['일대일 (홀로 선 적에게 근접 암습)'] } }),
  sub({ id: 'life', classId: 'cleric', name: '생명 영역', srd: true, blurb: '치유의 사제. 회복 주문이 2 + 슬롯 레벨만큼 더 회복시킨다.', features: { 3: ['생명의 제자 (회복 주문 +2 + 슬롯 레벨)'] } }),
  sub({ id: 'war', classId: 'cleric', name: '전쟁 영역', srd: false, blurb: '싸우는 사제. 보너스 행동으로 무기 공격을 한 번 더 한다 (긴 휴식당 3회).', cards: { 3: ['cleric/war_strike'] }, features: { 3: ['전쟁 사제 (보너스 행동 무기 공격 3회)'] } }),
  sub({ id: 'evoker', classId: 'wizard', name: '방출술사', srd: true, blurb: '파괴 마법의 대가. 주문 피해에 지능 수정치를 더한다.', features: { 3: ['강력한 방출 (주문 피해 + 지능 수정치)'] } }),
  sub({ id: 'diviner', classId: 'wizard', name: '예지술사', srd: false, blurb: '앞날을 본다. 보너스 행동으로 적의 빈틈을 예견해 다음 공격이 이점 (긴 휴식당 2회).', cards: { 3: ['wizard/portent'] }, features: { 3: ['예견 (보너스 행동, 2회)'] } }),
  sub({ id: 'lore', classId: 'bard', name: '전승 학파', srd: true, blurb: '말로 싸운다. 음유 영감을 써서 적의 방어를 흔든다 — 그 적에 대한 다음 공격이 이점.', cards: { 3: ['bard/cutting_words'] }, features: { 3: ['날카로운 말 (음유 영감 소모)'] } }),
  sub({ id: 'valor', classId: 'bard', name: '용맹 학파', srd: false, blurb: '노래하는 전사. AC +1, 6레벨에 추가 공격.', features: { 3: ['전투 훈련 (AC +1)'], 6: ['추가 공격 (무기 공격 2회)'] } }),
  sub({ id: 'hunter', classId: 'ranger', name: '사냥꾼', srd: true, blurb: '큰 사냥감 전문. 다친 적을 무기로 맞히면 카드 한 장당 한 번 1d8을 더한다.', features: { 3: ['거인 사냥꾼 (다친 적 +1d8)'] } }),
  sub({ id: 'tracker', classId: 'ranger', name: '추적자', srd: false, blurb: '먼저 본 쪽이 이긴다. 우선권에 지혜 수정치를 더한다.', features: { 3: ['먼저 본다 (우선권 + 지혜 수정치)'] } }),
  sub({ id: 'devotion', classId: 'paladin', name: '헌신의 맹세', srd: true, blurb: '빛의 기사. 신성 변환으로 무기를 축복해 다음 공격이 이점.', cards: { 3: ['paladin/sacred_weapon'] }, features: { 3: ['신성 변환: 성스러운 무기'] } }),
  sub({ id: 'vengeance', classId: 'paladin', name: '복수의 맹세', srd: false, blurb: '원수를 쫓는 기사. 신성 변환으로 적 하나에게 맹세 — 그 적에 대한 다음 공격이 이점.', cards: { 3: ['paladin/vow'] }, features: { 3: ['신성 변환: 적의 맹세'] } }),
  sub({ id: 'fiend', classId: 'warlock', name: '마족 후원자', srd: true, blurb: '지옥과의 계약. 타오르는 손길(3)과 화염구(5)를 배운다.', cards: { 3: ['spell/burning_hands'], 5: ['spell/fireball'] }, features: { 3: ['확장 주문: 타오르는 손길'], 5: ['확장 주문: 화염구'] } }),
  sub({ id: 'archfey', classId: 'warlock', name: '요정 후원자', srd: false, blurb: '요정 군주와의 계약. 내 존의 적에게 요정의 위압(지혜 내성, 1라운드 공포), 짧은 휴식에 회복.', cards: { 3: ['warlock/fey_presence'] }, features: { 3: ['요정의 위압 (짧은 휴식당 1회)'] } }),
].map((s) => [s.id, s]));

export const subclassesOf = (classId: string) => Object.values(SUBCLASSES).filter((s) => s.classId === classId);

/** 이 레벨까지 하위 직업으로 얻은 카드 */
export function subclassCards(subclass: string | undefined, level: number): string[] {
  const s = subclass ? SUBCLASSES[subclass] : undefined;
  return Object.entries(s?.cards ?? {}).filter(([lv]) => Number(lv) <= level).flatMap(([, ids]) => ids);
}

export const subclassFeatures = (subclass: string | undefined, level: number) => (subclass ? SUBCLASSES[subclass]?.features[level] ?? [] : []);

export interface FeatDef {
  id: string;
  name: string;
  desc: string;
}

/** 특성 (SRD 5.2.1 기반, 존 전투에 맞게 단순화) */
export const FEATS: Record<string, FeatDef> = Object.fromEntries([
  { id: 'alert', name: '경계', desc: '우선권에 숙련 보너스를 더한다.' },
  { id: 'tough', name: '강인함', desc: '최대 HP가 레벨당 2 오른다 (앞으로 오르는 레벨도).' },
  { id: 'sharpshooter', name: '저격수', desc: '같은 존에 적이 있어도 원거리 공격에 불리점이 없다.' },
  { id: 'war_caster', name: '전쟁 시전자', desc: '건강 내성에 이점.' },
  { id: 'resilient', name: '회복력', desc: '건강 +1, 건강 내성 숙련 (이미 있으면 지혜, 그다음 민첩).' },
  { id: 'defense', name: '방어 전문가', desc: 'AC +1.' },
].map((f) => [f.id, f]));

/** 3레벨 이상인데 하위 직업을 아직 고르지 않았다 */
export const needsSubclass = (sheet: CharacterSheet) => sheet.level >= 3 && !sheet.subclass && subclassesOf(sheet.classId).length > 0;
/** 남은 능력치 향상·특성 선택 수 */
export const pendingAsi = (sheet: CharacterSheet) => (sheet.pending ?? []).length;
export const pendingChoices = (sheet: CharacterSheet) => (needsSubclass(sheet) ? 1 : 0) + pendingAsi(sheet);

/** 능력치 향상: 직업 주능력치 +2 (최대 20, 넘치는 만큼 두 번째 능력치에). 건강이 오르면 HP 최대치도 소급. */
export function autoAsi(sheet: CharacterSheet): { sheet: CharacterSheet; details: string[] } {
  const cls = CLASSES[sheet.classId];
  if (!cls) return { sheet, details: [] };
  const abilities = { ...sheet.abilities };
  const details: string[] = [];
  let pts = 2;
  for (const a of cls.priority) {
    if (pts <= 0) break;
    const add = Math.min(pts, 20 - abilities[a]);
    if (add <= 0) continue;
    abilities[a] += add;
    pts -= add;
    details.push(`${ABILITY_NAMES[a]} +${add} (${abilities[a]})`);
  }
  return { sheet: withAbilities(sheet, abilities), details };
}

function withAbilities(sheet: CharacterSheet, abilities: CharacterSheet['abilities']): CharacterSheet {
  const conGain = (abilityModifier(abilities.con) - abilityModifier(sheet.abilities.con)) * sheet.level;
  return { ...sheet, abilities, maxHp: sheet.maxHp + conGain, hp: Math.max(0, sheet.hp + conGain) };
}

/** 하위 직업이 주는 새 자원은 가득 찬 채로 더한다 (이미 있는 자원은 그대로) */
function withSubclassResources(sheet: CharacterSheet): CharacterSheet {
  const cur = structuredClone(resourcesOf(sheet));
  for (const [k, v] of Object.entries(classResources(sheet.classId, sheet.level, sheet.subclass))) if (!cur[k]) cur[k] = { ...v };
  return { ...sheet, resources: cur };
}

export type BuildChoiceKind = 'subclass' | 'asi' | 'feat';

/** 빌드 선택 적용. 지금 고를 수 없는 선택이면 null (엔진이 검증한다). */
export function applyBuildChoice(sheet: CharacterSheet, kind: BuildChoiceKind, value: string): { sheet: CharacterSheet; text: string } | null {
  if (kind === 'subclass') {
    const s = SUBCLASSES[value];
    if (!needsSubclass(sheet) || !s || s.classId !== sheet.classId) return null;
    const next = withSubclassResources({ ...sheet, subclass: s.id });
    const feats = Object.entries(s.features).filter(([lv]) => Number(lv) <= sheet.level).flatMap(([, f]) => f);
    return { sheet: next, text: `하위 직업: ${s.name}${feats.length ? ` — ${feats.join(', ')}` : ''}` };
  }
  if (!pendingAsi(sheet)) return null;
  const rest = { ...sheet, pending: sheet.pending!.slice(1) };
  if (kind === 'asi') {
    const r = autoAsi(rest);
    return { sheet: r.sheet, text: `능력치 향상: ${r.details.join(', ') || '더 오를 능력치가 없다'}` };
  }
  const f = FEATS[value];
  if (!f || (sheet.feats ?? []).includes(f.id)) return null;
  let next: CharacterSheet = { ...rest, feats: [...(sheet.feats ?? []), f.id] };
  if (f.id === 'tough') next = { ...next, maxHp: next.maxHp + 2 * next.level, hp: next.hp + 2 * next.level };
  if (f.id === 'resilient') {
    next = withAbilities(next, { ...next.abilities, con: Math.min(20, next.abilities.con + 1) });
    const save = (['con', 'wis', 'dex'] as Ability[]).find((a) => !next.saveProficiencies.includes(a));
    if (save) next = { ...next, saveProficiencies: [...next.saveProficiencies, save] };
  }
  return { sheet: next, text: `특성: ${f.name} — ${f.desc}` };
}

/** 동료용 자동 선택: 첫 하위 직업, 능력치 향상 */
export function autoBuild(sheet: CharacterSheet): { sheet: CharacterSheet; texts: string[] } {
  const texts: string[] = [];
  let s = sheet;
  if (needsSubclass(s)) {
    const r = applyBuildChoice(s, 'subclass', subclassesOf(s.classId)[0]!.id);
    if (r) { s = r.sheet; texts.push(r.text); }
  }
  while (pendingAsi(s)) {
    const r = applyBuildChoice(s, 'asi', '')!;
    s = r.sheet;
    texts.push(r.text);
  }
  return { sheet: s, texts };
}
