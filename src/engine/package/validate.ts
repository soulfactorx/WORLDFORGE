/**
 * 세계관 패키지 검사기 (설계서 PART 5.2-8 Package Builder, 설계 리뷰 5.2절 패키지 린터).
 * 오류(error)가 하나라도 있으면 플레이할 수 없다. 경고(warning)는 제작자에게 알리기만 한다.
 */
import { TENSION } from '../vars';
import { defaultPhases } from '../phase';
import { isPlaceholderText } from '../names';
import { gmStyleById } from '../../data/gmStyles';
import { CLASSES, SKILL_IDS } from '../character/rules';
import { STD_ITEMS } from '../../data/items';
import { QUEST_TYPES, RARITIES, type Rewards } from '../schema';
import { ALL_CARDS } from '../combat/combat';
import { STAGES } from '../relationship';
import { encounterDifficulty, MONSTERS, monsterTable } from '../combat/monsters';
import type { Condition, WorldPackage } from '../schema';
import { CUSTOM_GENRE_ID, GENRES } from '../../data/genres';
import { stockDataUrl } from '../../data/stockart';
import { MAX_LEVEL } from '../character/progression';
import { classesFor } from '../classes';
import { traitsFor } from '../traits';
import { subclassesOf } from '../character/build';
import { isAlwaysTrue, isUnset } from '../scenario';

export interface Issue {
  level: 'error' | 'warning';
  path: string;
  message: string;
}

const KNOWLEDGE_STATES = ['rumor', 'partial', 'confirmed', 'mistaken', 'secret'];
const IMPROV = ['none', 'minor', 'free'];
const AXES = ['affinity', 'trust', 'respect', 'fear', 'intimacy', 'grudge'];
const STAGE_NAMES: readonly string[] = STAGES;
const CARD_IDS = new Set(Object.keys(ALL_CARDS));
const RELATION_KINDS = ['family', 'ally', 'rival', 'lover', 'master', 'enemy'];
/** 패키지 텍스트에 숨은 AI 지시(프롬프트 인젝션) 의심 패턴 */
const INJECTION = [
  /ignore (all |the )?(previous|above) (instructions|prompts?)/i,
  /(system|developer)\s*(prompt|message)\s*:/i,
  /이전\s*(지시|명령|프롬프트)(를|은)?\s*(무시|잊)/,
  /(시스템|관리자)\s*(프롬프트|지시)\s*:/,
  /you are (now )?(chatgpt|an? ai|a language model)/i,
  /https?:\/\//i,
];

const isStr = (v: unknown): v is string => typeof v === 'string';
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function validateWorld(input: unknown): Issue[] {
  const issues: Issue[] = [];
  const err = (path: string, message: string) => issues.push({ level: 'error', path, message });
  const warn = (path: string, message: string) => issues.push({ level: 'warning', path, message });

  if (!isObj(input)) return [{ level: 'error', path: '', message: '패키지가 JSON 객체가 아닙니다.' }];
  const w = input as unknown as WorldPackage;

  // ---- 매니페스트
  const m = w.manifest as unknown;
  if (!isObj(m)) err('manifest', '매니페스트가 없습니다.');
  else {
    if (!isStr(m.id) || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(m.id)) err('manifest.id', 'ID는 소문자·숫자·.-_ 3~64자여야 합니다 (예: author.my-world).');
    if (m.type !== 'world') err('manifest.type', 'type은 "world"여야 합니다.');
    if (!isStr(m.name) || !m.name.trim()) err('manifest.name', '이름이 필요합니다.');
    if (!isStr(m.version) || !/^\d+\.\d+\.\d+$/.test(m.version)) err('manifest.version', '버전은 1.0.0 형식이어야 합니다.');
    if (m.schemaVersion !== '0') err('manifest.schemaVersion', '지원하는 스키마 버전은 "0"입니다.');
    if (!isStr(m.license) || !m.license.trim()) warn('manifest.license', '라이선스를 적어 주세요 (예: CC-BY-4.0).');
    if (!['all', 'teen', 'mature'].includes(m.contentRating as string)) err('manifest.contentRating', '콘텐츠 등급은 all / teen / mature 중 하나입니다.');
  }

  const arr = <T>(key: keyof WorldPackage, required: boolean): T[] => {
    const v = (w as unknown as Record<string, unknown>)[key as string];
    if (v === undefined && !required) return [];
    if (!Array.isArray(v)) { err(String(key), '목록이어야 합니다.'); return []; }
    return v as T[];
  };
  const locations = arr<WorldPackage['locations'][number]>('locations', true);
  // ---- 세계만의 적 (기본 적 위에 더한다)
  const customMonsters = arr<NonNullable<WorldPackage['monsters']>[number]>('monsters', false);
  const MT: Record<string, unknown> = { ...MONSTERS };
  const DICE = /^\d{0,2}d\d{1,3}$/;
  const CONDS = ['poisoned', 'frightened', 'restrained', 'stunned', 'blinded'];
  const ABILS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const ROLES = ['minion', 'brute', 'skirmisher', 'artillery', 'controller', 'leader', 'boss'];
  for (const m of customMonsters) if (isObj(m) && isStr(m.id)) MT[m.id] = m;

  const characters = arr<WorldPackage['characters'][number]>('characters', true);
  const facts = arr<WorldPackage['facts'][number]>('facts', true);
  const claims = arr<WorldPackage['claims'][number]>('claims', true);
  const beliefs = arr<WorldPackage['beliefs'][number]>('beliefs', true);
  const encounters = arr<NonNullable<WorldPackage['encounters']>[number]>('encounters', false);
  const quests = arr<NonNullable<WorldPackage['quests']>[number]>('quests', false);
  const flags = arr<NonNullable<WorldPackage['flags']>[number]>('flags', false);
  const endings = arr<NonNullable<WorldPackage['endings']>[number]>('endings', false);
  const factions = arr<NonNullable<WorldPackage['factions']>[number]>('factions', false);
  const relations = arr<NonNullable<WorldPackage['relations']>[number]>('relations', false);
  const relationBeats = arr<NonNullable<WorldPackage['relationBeats']>[number]>('relationBeats', false);
  const arcs = arr<NonNullable<WorldPackage['arcs']>[number]>('arcs', false);
  const choices = arr<NonNullable<WorldPackage['choices']>[number]>('choices', false);
  const clocks = arr<NonNullable<WorldPackage['clocks']>[number]>('clocks', false);
  const worldEvents = arr<NonNullable<WorldPackage['events']>[number]>('events', false);

  // ---- ID 중복
  const ids = new Map<string, string>();
  const register = (id: unknown, path: string) => {
    if (!isStr(id) || !id.trim()) { err(path, 'ID가 필요합니다.'); return; }
    if (ids.has(id)) err(path, `ID "${id}"가 ${ids.get(id)}와 중복됩니다.`);
    else ids.set(id, path);
  };
  locations.forEach((l, i) => register(l?.id, `locations[${i}]`));
  characters.forEach((c, i) => register(c?.id, `characters[${i}]`));
  facts.forEach((f, i) => register(f?.id, `facts[${i}]`));
  claims.forEach((c, i) => register(c?.id, `claims[${i}]`));
  encounters.forEach((e, i) => register(e?.id, `encounters[${i}]`));
  quests.forEach((q, i) => register(q?.id, `quests[${i}]`));
  endings.forEach((e, i) => register(e?.id, `endings[${i}]`));
  factions.forEach((f, i) => register(f?.id, `factions[${i}]`));
  relationBeats.forEach((b, i) => register(b?.id, `relationBeats[${i}]`));
  arcs.forEach((a, i) => register(a?.id, `arcs[${i}]`));
  choices.forEach((c, i) => register(c?.id, `choices[${i}]`));
  clocks.forEach((c, i) => register(c?.id, `clocks[${i}]`));
  worldEvents.forEach((e, i) => register(e?.id, `events[${i}]`));
  const arcIds = new Set(arcs.map((a) => a?.id));
  const clockIds = new Set(clocks.map((c) => c?.id));
  const choiceIds = new Set(choices.map((c) => c?.id));
  const factionIds = new Set(factions.map((f) => f?.id));
  const ownItems = arr<NonNullable<WorldPackage['items']>[number]>('items', false);
  ownItems.forEach((it, i) => register(it?.id, `items[${i}]`));
  const itemIds = new Set([...ownItems.map((x) => x?.id), ...STD_ITEMS.map((x) => x.id)]);
  const ITEM_KINDS = ['consumable', 'weapon', 'armor', 'shield', 'trinket', 'scroll', 'key', 'treasure', 'misc'];

  const locIds = new Set(locations.map((l) => l?.id));
  const charIds = new Set(characters.map((c) => c?.id));
  // 인물도 적이 될 수 있다 (v0.79): "npc:인물ID" — 그 인물의 직업·레벨·능력치로 싸운다
  for (const c of characters) if (c?.id) MT[`npc:${c.id}`] = true;
  const factIds = new Set(facts.map((f) => f?.id));
  const claimIds = new Set(claims.map((c) => c?.id));
  const encIds = new Set(encounters.map((e) => e?.id));
  const questIds = new Set(quests.map((q) => q?.id));
  const goalIds = new Set(characters.flatMap((c) => (Array.isArray(c?.goals) ? c.goals.map((g) => g?.id) : [])));
  const worldVars = arr<NonNullable<WorldPackage['vars']>[number]>('vars', false);
  const varIds = new Set([...worldVars.map((v) => v?.id), TENSION]);
  const phaseList = arr<NonNullable<WorldPackage['phases']>[number]>('phases', false);
  const phaseIds = new Set((phaseList.length ? phaseList : (input as Record<string, unknown>).autoPhases === false ? [] : defaultPhases(input as unknown as WorldPackage)).map((x) => x?.id));
  const traitIds = new Set((Array.isArray((input as Record<string, unknown>).traits) || (input as Record<string, unknown>).traits === undefined ? traitsFor(input as unknown as WorldPackage) : []).map((t) => t?.id).filter(Boolean));
  const flagIds = new Set(flags.map((f) => f?.id));
  const entityIds = new Set([...locIds, ...charIds]);

  const text = (v: unknown, path: string, required = true) => {
    if (!isStr(v) || !v.trim()) { if (required) err(path, '내용이 필요합니다.'); return; }
    if (INJECTION.some((re) => re.test(v))) warn(path, 'AI에게 지시하는 문장이나 링크로 보이는 내용이 있습니다. 이 글은 AI 프롬프트에 들어가므로 확인해 주세요.');
  };

  // ---- 장소
  locations.forEach((l, i) => {
    const p = `locations[${i}]`;
    text(l.name, `${p}.name`);
    text(l.description, `${p}.description`);
    if (!Array.isArray(l.connections)) err(`${p}.connections`, '연결 목록이 필요합니다.');
    else l.connections.forEach((c, j) => {
      if (!locIds.has(c)) err(`${p}.connections[${j}]`, `없는 장소 "${c}"`);
      else if (!locations.find((x) => x.id === c)?.connections?.includes(l.id)) warn(`${p}.connections[${j}]`, `"${c}"에서 "${l.id}"로 돌아오는 연결이 없습니다 (일방통행).`);
    });
    if (l.improvisation && !IMPROV.includes(l.improvisation)) err(`${p}.improvisation`, 'none / minor / free 중 하나입니다.');
    (l.discoveries ?? []).forEach((d, j) => {
      if (!claimIds.has(d.claim)) err(`${p}.discoveries[${j}].claim`, `없는 명제 "${d.claim}"`);
      if (d.check && !SKILL_IDS.includes(d.check as never)) err(`${p}.discoveries[${j}].check`, `알 수 없는 기술 "${d.check}" (${SKILL_IDS.join(', ')})`);
      text(d.hint, `${p}.discoveries[${j}].hint`);
    });
  });

  // ---- GM 스타일 (v0.80)
  const gs = (w as { gmStyle?: { preset?: unknown; custom?: unknown } }).gmStyle;
  if (gs !== undefined) {
    if (gs.preset !== undefined && !gmStyleById(String(gs.preset))) warn('gmStyle.preset', `알 수 없는 GM 스타일 "${String(gs.preset)}" — 기본으로 연출합니다.`);
    if (gs.custom !== undefined && typeof gs.custom !== 'string') err('gmStyle.custom', '글이어야 합니다.');
  }

  // ---- 인물
  characters.forEach((c, i) => {
    const p = `characters[${i}]`;
    for (const k of ['name', 'appearance', 'personality', 'speech'] as const) text(c[k], `${p}.${k}`);
    for (const k of ['appearance', 'personality', 'speech'] as const) {
      if (typeof c[k] === 'string' && c[k].trim() && isPlaceholderText(c[k])) warn(`${p}.${k}`, `"${c[k].trim()}" — 내용이 아니라 '없음'을 뜻하는 글입니다. ${k === 'appearance' ? '이름을 모를 때 이 인물은 외형으로 불리므로, 짧게라도 생김새를 적어 주세요 (지금은 "낯선 인물"로 불립니다).' : '짧게라도 채워 주세요.'}`);
    }
    if (!locIds.has(c.locationId)) err(`${p}.locationId`, `없는 장소 "${c.locationId}"`);
    if (!IMPROV.includes(c.improvisation)) err(`${p}.improvisation`, 'none / minor / free 중 하나입니다.');
    if (c.stats) {
      const st = c.stats;
      if (st.role !== undefined && !classesFor(input as unknown as WorldPackage).some((k) => k.id === st.role)) warn(`${p}.stats.role`, `이 세계의 직업 목록에 없는 직업 "${st.role}" — 기본 전사로 계산됩니다.`);
      if (st.classId !== undefined && !CLASSES[st.classId]) err(`${p}.stats.classId`, `알 수 없는 규칙 직업 "${st.classId}"`);
      if (st.level !== undefined && !(Number.isInteger(st.level) && st.level >= 1 && st.level <= 10)) err(`${p}.stats.level`, '레벨은 1~10입니다.');
      if (st.growth !== undefined && !['follow', 'time', 'fixed'].includes(st.growth)) err(`${p}.stats.growth`, 'follow / time / fixed 중 하나입니다.');
      if (st.abilities) for (const a of ABILS) { const v = (st.abilities as Record<string, number>)[a]; if (!(typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 30)) err(`${p}.stats.abilities.${a}`, '능력치는 1~30 정수입니다.'); }
    }
    if (c.companion) {
      if (!CLASSES[c.companion.classId]) err(`${p}.companion.classId`, `알 수 없는 직업 "${c.companion.classId}" (${Object.keys(CLASSES).join(', ')})`);
      if (c.companion.role !== undefined) {
        const wc = classesFor(input as unknown as WorldPackage).find((k) => k.id === c.companion!.role);
        if (!wc) warn(`${p}.companion.role`, `이 세계의 직업 목록에 없는 직업 "${c.companion.role}" — 규칙 직업(${c.companion.classId})의 이름으로 보입니다.`);
        else if (wc.base !== c.companion.classId) warn(`${p}.companion.classId`, `직업 "${wc.name}"의 규칙 직업은 ${wc.base}입니다 — 영입하면 ${wc.base} 규칙을 따릅니다.`);
      }
      const ab = c.companion.abilities as unknown;
      if (!isObj(ab) || ['str', 'dex', 'con', 'int', 'wis', 'cha'].some((k) => typeof ab[k] !== 'number' || (ab[k] as number) < 1 || (ab[k] as number) > 20)) {
        err(`${p}.companion.abilities`, '능력치 6개(str dex con int wis cha)가 1~20 숫자여야 합니다.');
      }
      text(c.companion.joinCondition, `${p}.companion.joinCondition`);
    }
    text(c.background, `${p}.background`, false);
    text(c.greeting, `${p}.greeting`, false);
    if (c.portrait !== undefined) {
      if (!isStr(c.portrait) || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(c.portrait)) err(`${p}.portrait`, '초상화는 png·jpeg·webp data URL이어야 합니다.');
      else if (c.portrait.length > 400_000) err(`${p}.portrait`, '초상화가 너무 큽니다 (최대 약 300KB).');
    }
    if (c.relationship) for (const [k, v] of Object.entries(c.relationship)) {
      if (!AXES.includes(k) || typeof v !== 'number' || v < -100 || v > 100) err(`${p}.relationship.${k}`, '관계 축은 affinity/trust/respect/fear/intimacy/grudge, 값은 -100~100입니다.');
    }
  });

  // ---- 지식
  facts.forEach((f, i) => {
    const p = `facts[${i}]`;
    text(f.statement, `${p}.statement`);
    if (![0, 1, 2, 3, 4, 5].includes(f.secrecy)) err(`${p}.secrecy`, '비밀 등급은 0~5입니다.');
    (f.subjects ?? []).forEach((s, j) => { if (!entityIds.has(s)) err(`${p}.subjects[${j}]`, `없는 장소·인물 "${s}"`); });
    if (f.protectedTopic && !(f.subjects ?? []).length) warn(`${p}.protectedTopic`, '보호 주제는 subjects(관련 장소·인물)가 있어야 적용됩니다.');
    if (f.protectedTopic && f.statement && f.protectedTopic.length > 10 && f.statement.includes(f.protectedTopic)) warn(`${p}.protectedTopic`, '보호 주제 이름표가 비밀 내용을 그대로 드러냅니다.');
  });
  claims.forEach((c, i) => {
    const p = `claims[${i}]`;
    text(c.statement, `${p}.statement`);
    if (!['true', 'false', 'partial'].includes(c.truth)) err(`${p}.truth`, 'true / false / partial 중 하나입니다.');
    if (c.relatesTo && !factIds.has(c.relatesTo)) err(`${p}.relatesTo`, `없는 사실 "${c.relatesTo}"`);
  });
  beliefs.forEach((b, i) => {
    const p = `beliefs[${i}]`;
    if (b.holder !== 'player' && !b.holder?.startsWith('group:') && !charIds.has(b.holder)) err(`${p}.holder`, `없는 인물 "${b.holder}"`);
    if (b.holder === 'player') warn(`${p}.holder`, '플레이어는 아무것도 모른 채 시작하는 것이 원칙입니다.');
    if (!claimIds.has(b.claim)) err(`${p}.claim`, `없는 명제 "${b.claim}"`);
    if (!KNOWLEDGE_STATES.includes(b.state)) err(`${p}.state`, `지식 상태는 ${KNOWLEDGE_STATES.join(' / ')} 중 하나입니다.`);
  });
  claims.forEach((c, i) => {
    const known = beliefs.some((b) => b.claim === c.id);
    const found = locations.some((l) => l.discoveries?.some((d) => d.claim === c.id));
    const atStart = Array.isArray(w.starts) && w.starts.some((st) => st?.knows?.includes(c.id));
    if (!known && !found && !atStart) warn(`claims[${i}]`, `"${c.id}"는 아무도 모르고 발견할 수도 없어, 플레이어가 알 방법이 없습니다.`);
  });

  // ---- 조우
  encounters.forEach((e, i) => {
    const p = `encounters[${i}]`;
    if (!locIds.has(e.locationId)) err(`${p}.locationId`, `없는 장소 "${e.locationId}"`);
    if (!Array.isArray(e.enemies) || !e.enemies.length) err(`${p}.enemies`, '적이 한 명 이상 필요합니다.');
    else e.enemies.forEach((en, j) => {
      if (!MT[en.monsterId]) err(`${p}.enemies[${j}].monsterId`, `알 수 없는 적 "${en.monsterId}" (기본 적 또는 이 세계의 적 ID)`);
      if (en.zone !== 2 && en.zone !== 3) err(`${p}.enemies[${j}].zone`, 'zone은 2(적 전열) 또는 3(적 후열)입니다.');
    });
    text(e.trigger, `${p}.trigger`);
    // 난이도: 1레벨 혼자 기준으로 치명적이면 알린다 (동료가 있거나 레벨이 오르면 괜찮을 수 있다)
    const ids = (e.enemies ?? []).map((x) => x.monsterId).filter((id) => MT[id]);
    if (ids.length) {
      const d = encounterDifficulty(ids, [1, 1], monsterTable(w as WorldPackage));
      if (d.difficulty === 'deadly') warn(p, `"${e.name}"은(는) 1레벨 2인 일행에게 치명적인 조우입니다 (적 경험치 ${d.xp} > 예산 ${d.budget[2]}). 레벨이 오른 뒤에 일어나도록 조건을 걸거나 적을 줄이세요.`);
    }
  });

  // ---- 조건식 참조 검사
  const checkCond = (c: unknown, path: string, depth = 0): void => {
    if (depth > 12) { err(path, '조건이 너무 깊게 중첩되어 있습니다.'); return; }
    if (!isObj(c)) { err(path, '조건은 객체여야 합니다.'); return; }
    const cond = c as Condition;
    const keys = Object.keys(c);
    if ('all' in cond || 'any' in cond) {
      const list = 'all' in cond ? cond.all : cond.any;
      if (!Array.isArray(list)) err(path, 'all/any는 목록이어야 합니다.');
      else list.forEach((x, j) => checkCond(x, `${path}.${'all' in cond ? 'all' : 'any'}[${j}]`, depth + 1));
      return;
    }
    if ('not' in cond) return checkCond(cond.not, `${path}.not`, depth + 1);
    if ('knows' in cond) { if (!claimIds.has(cond.knows)) err(path, `없는 명제 "${cond.knows}"`); if (cond.min && !KNOWLEDGE_STATES.includes(cond.min)) err(path, `알 수 없는 지식 상태 "${cond.min}"`); return; }
    if ('npcAt' in cond) { if (!charIds.has(cond.npcAt)) err(path, `없는 인물 "${cond.npcAt}"`); if (!locIds.has(cond.at)) err(path, `없는 장소 "${cond.at}"`); return; }
    if ('npcAlive' in cond) { if (!charIds.has(cond.npcAlive)) err(path, `없는 인물 "${cond.npcAlive}"`); return; }
    if ('defeated' in cond) { if (!MT[cond.defeated]) err(path, `없는 적 "${cond.defeated}"`); return; }
    if ('questFailed' in cond) { if (!questIds.has(cond.questFailed)) err(path, `없는 임무 "${cond.questFailed}"`); return; }
    if ('at' in cond) { if (!locIds.has(cond.at)) err(path, `없는 장소 "${cond.at}"`); return; }
    if ('cleared' in cond) { if (!encIds.has(cond.cleared)) err(path, `없는 조우 "${cond.cleared}"`); return; }
    if ('inParty' in cond) { if (!charIds.has(cond.inParty)) err(path, `없는 인물 "${cond.inParty}"`); return; }
    if ('relationship' in cond) { if (!charIds.has(cond.relationship)) err(path, `없는 인물 "${cond.relationship}"`); if (!AXES.includes(cond.axis)) err(path, `알 수 없는 관계 축 "${cond.axis}"`); return; }
    if ('stage' in cond) { if (!charIds.has(cond.stage)) err(path, `없는 인물 "${cond.stage}"`); if (!Array.isArray(cond.in) || !cond.in.length || cond.in.some((x) => !STAGE_NAMES.includes(x))) err(path, `관계 단계는 ${STAGES.join('·')} 중에서 고릅니다.`); return; }
    if ('reputation' in cond) { if (!factionIds.has(cond.reputation)) err(path, `없는 세력 "${cond.reputation}"`); return; }
    if ('chapter' in cond) { if (!arcIds.has(cond.chapter)) err(path, `없는 줄기 "${cond.chapter}"`); if (typeof cond.gte !== 'number') err(path, 'chapter에는 gte(끝낸 장 수)가 필요합니다.'); return; }
    if ('arcDone' in cond) { if (!arcIds.has(cond.arcDone)) err(path, `없는 줄기 "${cond.arcDone}"`); return; }
    if ('clock' in cond) { if (!clockIds.has(cond.clock)) err(path, `없는 시계 "${cond.clock}"`); return; }
    if ('choice' in cond) {
      if (!choiceIds.has(cond.choice)) err(path, `없는 결정적 선택 "${cond.choice}"`);
      else if (cond.is !== undefined && !choices.find((c) => c.id === cond.choice)!.options?.some((o) => o.id === cond.is)) err(path, `선택 "${cond.choice}"에 없는 선택지 "${cond.is}"`);
      return;
    }
    if ('hasItem' in cond) { if (!itemIds.has(cond.hasItem)) err(path, `없는 아이템 "${cond.hasItem}"`); return; }
    if ('money' in cond) { if (typeof cond.money !== 'number') err(path, 'money는 숫자입니다.'); return; }
    if ('day' in cond) { if (typeof cond.day !== 'number' || cond.day < 0) err(path, 'day는 0 이상의 숫자입니다.'); return; }
    if ('flag' in cond) { if (!flagIds.has(cond.flag)) err(path, `선언되지 않은 플래그 "${cond.flag}"`); return; }
    if ('questDone' in cond) { if (!questIds.has(cond.questDone)) err(path, `없는 임무 "${cond.questDone}"`); return; }
    if ('trait' in cond) { if (!traitIds.has(cond.trait)) err(path, `없는 성향 축 "${cond.trait}" (${[...traitIds].join(', ')})`); return; }
    if ('phase' in cond) { if (!phaseIds.has(cond.phase)) err(path, `없는 국면 "${cond.phase}" (${[...phaseIds].join(', ')})`); return; }
    if ('var' in cond) { if (!varIds.has(cond.var)) err(path, `선언되지 않은 세계 수치 "${cond.var}"`); return; }
    if ('encounter' in cond) {
      if (!encIds.has(cond.encounter)) err(path, `없는 조우 "${cond.encounter}"`);
      if (cond.is !== undefined && !['victory', 'defeat', 'fled'].includes(cond.is)) err(path, 'is는 victory/defeat/fled입니다.');
      return;
    }
    if ('sceneEnd' in cond) {
      const sd = ((input as unknown as WorldPackage).scenes ?? []).find((x) => x?.id === cond.sceneEnd);
      if (!sd) err(path, `없는 장면 "${cond.sceneEnd}"`);
      else if (cond.is !== undefined && !(sd.ends ?? []).some((e) => e.id === cond.is)) err(path, `장면 "${sd.name}"에 없는 끝 "${cond.is}"`);
      if (cond.outcome !== undefined && !['success', 'failure', 'neutral'].includes(cond.outcome)) err(path, 'outcome은 success/failure/neutral입니다.');
      return;
    }
    if ('npcGoal' in cond) { if (!goalIds.has(cond.npcGoal)) err(path, `없는 인물 목표 "${cond.npcGoal}"`); if (cond.is !== undefined && !['active', 'done', 'stopped'].includes(cond.is)) err(path, 'is는 active/done/stopped입니다.'); return; }
    if ('questOutcome' in cond) {
      const q = quests.find((x) => x.id === cond.questOutcome);
      if (!q) err(path, `없는 임무 "${cond.questOutcome}"`);
      else if (cond.is !== undefined && !(q.outcomes ?? []).some((o) => o.id === cond.is)) err(path, `임무 "${cond.questOutcome}"에 없는 결과 "${cond.is}"`);
      return;
    }
    if ('level' in cond) { if (typeof cond.level !== 'number') err(path, 'level은 숫자입니다.'); return; }
    err(path, `알 수 없는 조건 (${keys.join(', ') || '빈 객체'}). all·any·not·knows·at·cleared·inParty·relationship·stage·reputation·chapter·arcDone·clock·choice·day·hasItem·money·defeated·npcAlive·npcAt·encounter·questFailed·flag·questDone·level·var·questOutcome·npcGoal 중 하나를 쓰세요.`);
  };
  const checkRewards = (r: Rewards | undefined, p: string) => {
    if (!r) return;
    (r.relationship ?? []).forEach((x, j) => { if (!charIds.has(x.npcId)) err(`${p}.relationship[${j}]`, `없는 인물 "${x.npcId}"`); });
    (r.reputation ?? []).forEach((x, j) => { if (!factionIds.has(x.factionId)) err(`${p}.reputation[${j}]`, `없는 세력 "${x.factionId}"`); });
    (r.cards ?? []).forEach((x, j) => {
      if (!CARD_IDS.has(x.cardId)) err(`${p}.cards[${j}]`, `없는 카드 "${x.cardId}"`);
      if (x.who !== 'player' && !charIds.has(x.who)) err(`${p}.cards[${j}].who`, `"player" 또는 인물 ID입니다 ("${x.who}")`);
    });
  };
  const deferredEffects: [unknown, string][] = [];
  quests.forEach((q, i) => {
    const p = `quests[${i}]`;
    text(q.name, `${p}.name`);
    if (q.kind !== 'main' && q.kind !== 'side') err(`${p}.kind`, 'main 또는 side입니다.');
    checkCond(q.start, `${p}.start`);
    if (q.truth && !claimIds.has(q.truth)) err(`${p}.truth`, `없는 명제 "${q.truth}"`);
    (q.clues ?? []).forEach((c, j) => { if (!claimIds.has(c)) err(`${p}.clues[${j}]`, `없는 명제 "${c}"`); });
    (q.approaches ?? []).forEach((a, j) => { text(a.hint, `${p}.approaches[${j}].hint`); });
    const ocIds = new Set<string>();
    (q.outcomes ?? []).forEach((o, j) => {
      const op = `${p}.outcomes[${j}]`;
      if (!o.id) err(`${op}.id`, 'ID가 필요합니다.'); else if (ocIds.has(o.id)) err(`${op}.id`, `겹치는 결과 ID "${o.id}"`); else ocIds.add(o.id);
      text(o.name, `${op}.name`);
      checkCond(o.when, `${op}.when`);
      if (o.effects) deferredEffects.push([o.effects, `${op}.effects`]);
      checkRewards(o.rewards, `${op}.rewards`);
    });
    if (!Array.isArray(q.stages) || !q.stages.length) err(`${p}.stages`, '단계가 하나 이상 필요합니다.');
    else q.stages.forEach((st, j) => {
      text(st.objective, `${p}.stages[${j}].objective`); text(st.hint, `${p}.stages[${j}].hint`, false); checkCond(st.complete, `${p}.stages[${j}].complete`); if (st.fail) checkCond(st.fail, `${p}.stages[${j}].fail`);
      if (isAlwaysTrue(st.complete)) warn(`${p}.stages[${j}].complete`, `완료 조건이 비어 있어 이 단계가 ${j === 0 ? '임무를 받자마자' : '앞 단계 직후'} 끝납니다. 조건을 정하세요.`);
      if (isUnset(st.complete)) warn(`${p}.stages[${j}].complete`, '완료 조건을 아직 정하지 않아 이 단계는 끝나지 않습니다.');
    });
    if (q.type && !(QUEST_TYPES as readonly string[]).includes(q.type)) err(`${p}.type`, `유형은 ${QUEST_TYPES.join('/')} 중 하나입니다.`);
    if (q.giver && !charIds.has(q.giver)) err(`${p}.giver`, `없는 인물 "${q.giver}"`);
    if (q.target && !charIds.has(q.target)) err(`${p}.target`, `없는 인물 "${q.target}"`);
    if (q.fail) checkCond(q.fail, `${p}.fail`);
    if (q.timeLimit && (typeof q.timeLimit.days !== 'number' || q.timeLimit.days <= 0)) err(`${p}.timeLimit`, '기한은 { "days": 1 이상 }입니다.');
    checkRewards(q.rewards, `${p}.rewards`);
  });
  // ---- 세력·NPC 관계·관계 사건 (설계 v3 4.2~4.4)
  factions.forEach((f, i) => {
    text(f.name, `factions[${i}].name`);
    if (f.reputation !== undefined && (typeof f.reputation !== 'number' || f.reputation < -100 || f.reputation > 100)) err(`factions[${i}].reputation`, '평판은 -100~100입니다.');
  });
  characters.forEach((c, i) => { if (c.faction && !factionIds.has(c.faction)) err(`characters[${i}].faction`, `없는 세력 "${c.faction}"`); });
  // ---- NPC 목표 (설계 v4 E7)
  const seenGoals = new Set<string>();
  characters.forEach((c, i) => (Array.isArray(c.goals) ? c.goals : []).forEach((g, j) => {
    const p = `characters[${i}].goals[${j}]`;
    if (!g?.id || typeof g.id !== 'string') err(`${p}.id`, 'ID가 필요합니다.'); else if (seenGoals.has(g.id)) err(`${p}.id`, `겹치는 목표 ID "${g.id}"`); else seenGoals.add(g.id);
    text(g?.text, `${p}.text`);
    if (typeof g?.days !== 'number' || g.days < 0) err(`${p}.days`, '날 수(0 이상)가 필요합니다.');
    if (g?.start) checkCond(g.start, `${p}.start`);
    if (g?.stop) checkCond(g.stop, `${p}.stop`);
    if (g?.effects) deferredEffects.push([g.effects, `${p}.effects`]);
  }));
  relations.forEach((r, i) => {
    const p = `relations[${i}]`;
    if (!charIds.has(r.a)) err(`${p}.a`, `없는 인물 "${r.a}"`);
    if (!charIds.has(r.b)) err(`${p}.b`, `없는 인물 "${r.b}"`);
    if (r.a === r.b) err(p, '자기 자신과의 관계입니다.');
    if (!RELATION_KINDS.includes(r.kind)) err(`${p}.kind`, `관계 종류는 ${RELATION_KINDS.join('/')} 중 하나입니다.`);
  });
  relationBeats.forEach((b, i) => {
    const p = `relationBeats[${i}]`;
    if (!charIds.has(b.npcId)) err(`${p}.npcId`, `없는 인물 "${b.npcId}"`);
    text(b.name, `${p}.name`); text(b.hint, `${p}.hint`);
    checkCond(b.condition, `${p}.condition`);
    if (isObj(b.condition) && 'all' in b.condition && Array.isArray(b.condition.all) && !b.condition.all.length) warn(`${p}.condition`, '조건이 비어 게임 시작과 함께 열립니다.');
    if (b.approach !== undefined && !['visit', 'message', 'none'].includes(b.approach)) err(`${p}.approach`, 'approach는 visit/message/none입니다.');
    text(b.message, `${p}.message`, false);
    if (b.resolveFlag && !flagIds.has(b.resolveFlag)) err(`${p}.resolveFlag`, `선언되지 않은 플래그 "${b.resolveFlag}" — 플래그 목록에 추가하세요 (GM이 세울 수 있어야 사건이 닫힙니다).`);
  });
  // ---- 세계 개요·GM 메모 (v0.54)
  for (const k of ['overview', 'gmNotes'] as const) {
    const v = (input as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (typeof v !== 'string') err(k, '글이어야 합니다.');
    else if (v.length > 2500) warn(k, `${v.length}자 — 2500자까지만 AI에게 전달됩니다.`);
  }
  // ---- 시간 흐름 (v0.58)
  {
    const t = (input as Record<string, unknown>).time as Record<string, unknown> | undefined;
    if (t !== undefined) {
      if (!t || typeof t !== 'object') err('time', '객체여야 합니다.');
      else {
        if (t.pace !== undefined && !['slow', 'normal', 'fast'].includes(t.pace as string)) err('time.pace', 'slow · normal · fast 중 하나입니다.');
        const old = ['mode', 'perTurn', 'move', 'maxPerTurn', 'steps'].filter((k) => t[k] !== undefined);
        if (old.length) warn('time', `v0.112부터 쓰지 않는 시간 설정이 있습니다 (${old.join(', ')}) — 한 턴의 길이는 GM 판단 AI가 비트(대화 한 판·장면 하나·몽타주)로 고르고, 세계는 시간 속도(pace)만 정합니다.`);
      }
    }
  }
  // ---- 주인공 성향 축 (v0.69)
  {
    const tr = (input as Record<string, unknown>).traits;
    if (tr !== undefined) {
      if (!Array.isArray(tr)) err('traits', '성향 축 목록이어야 합니다.');
      else {
        const seen = new Set<string>();
        tr.forEach((t0, i) => {
          const t = t0 as Record<string, unknown>;
          const p = `traits[${i}]`;
          if (typeof t?.id !== 'string' || !/^[a-z0-9_]+$/.test(t.id)) err(`${p}.id`, 'ID는 영문 소문자·숫자·_ 입니다.');
          else if (seen.has(t.id)) err(`${p}.id`, `ID "${t.id}"가 겹칩니다.`);
          else seen.add(t.id);
          for (const k of ['name', 'low', 'high'] as const) if (typeof t?.[k] !== 'string' || !(t[k] as string).trim()) err(`${p}.${k}`, '이름이 필요합니다.');
          if (t?.initial !== undefined && !(typeof t.initial === 'number' && t.initial >= -100 && t.initial <= 100)) err(`${p}.initial`, '-100 ~ 100 숫자입니다.');
        });
      }
    }
  }
  // ---- 주인공 정보 양식 (v0.68)
  {
    const pp = (input as Record<string, unknown>).playerProfile as Record<string, unknown> | undefined;
    if (pp !== undefined) {
      if (!pp || typeof pp !== 'object') err('playerProfile', '객체여야 합니다.');
      else {
        if (pp.genders !== undefined && !(Array.isArray(pp.genders) && pp.genders.every((g) => typeof g === 'string'))) err('playerProfile.genders', '글 목록이어야 합니다.');
        const ids = new Set<string>();
        ((pp.fields as unknown[] | undefined) ?? []).forEach((f0, i) => {
          const f = f0 as Record<string, unknown>;
          const p = `playerProfile.fields[${i}]`;
          if (!f || typeof f !== 'object') { err(p, '객체여야 합니다.'); return; }
          if (typeof f.id !== 'string' || !/^[a-z0-9_]+$/.test(f.id)) err(`${p}.id`, 'ID는 영문 소문자·숫자·_ 입니다.');
          else if (ids.has(f.id)) err(`${p}.id`, `ID "${f.id}"가 겹칩니다.`);
          else ids.add(f.id);
          if (typeof f.label !== 'string' || !f.label.trim()) err(`${p}.label`, '항목 이름이 필요합니다.');
          if (!['text', 'long', 'select'].includes(f.kind as string)) err(`${p}.kind`, 'text·long·select 중 하나입니다.');
          if (f.kind === 'select' && !(Array.isArray(f.options) && f.options.length)) err(`${p}.options`, '고르기 항목에는 선택지가 필요합니다.');
        });
      }
    }
  }
  // ---- 직업 (v0.56)
  const classIds = new Set<string>();
  arr<NonNullable<WorldPackage['classes']>[number]>('classes', false).forEach((c, i) => {
    const p = `classes[${i}]`;
    if (!c || typeof c !== 'object') { err(p, '직업은 객체여야 합니다.'); return; }
    if (!c.id || typeof c.id !== 'string') err(`${p}.id`, 'ID가 필요합니다.');
    else if (classIds.has(c.id)) err(`${p}.id`, `직업 ID "${c.id}"가 겹칩니다.`);
    else classIds.add(c.id);
    if (!c.name || typeof c.name !== 'string' || !c.name.trim()) err(`${p}.name`, '이름이 필요합니다.');
    const base = CLASSES[c.base];
    if (!base) { err(`${p}.base`, `알 수 없는 규칙 직업 "${c.base}" (${Object.keys(CLASSES).join(', ')})`); return; }
    for (const k of ['skills', 'skillOptions'] as const) {
      const v = c[k];
      if (v === undefined) continue;
      if (!Array.isArray(v)) { err(`${p}.${k}`, '기술 ID 목록이어야 합니다.'); continue; }
      v.forEach((sk, j) => { if (!SKILL_IDS.includes(sk as never)) err(`${p}.${k}[${j}]`, `알 수 없는 기술 "${sk}"`); });
    }
    if (c.skillOptions?.length && c.skillOptions.length < base.skillChoices) warn(`${p}.skillOptions`, `기술 후보가 ${base.skillChoices}개보다 적어 규칙 직업의 기본 후보를 씁니다.`);
    const opts = c.skillOptions?.length && c.skillOptions.length >= base.skillChoices ? c.skillOptions : base.skillOptions;
    if (c.skills?.some((sk) => !opts.includes(sk as never))) warn(`${p}.skills`, '추천 기술 중 후보에 없는 것은 무시됩니다.');
    if ((c.skills?.length ?? 0) > base.skillChoices) warn(`${p}.skills`, `추천 기술은 ${base.skillChoices}개까지만 미리 골라집니다.`);
    if (c.subclasses !== undefined) {
      if (!Array.isArray(c.subclasses)) err(`${p}.subclasses`, '하위 직업 목록이어야 합니다.');
      else {
        const allowed = subclassesOf(c.base).map((x) => x.id);
        c.subclasses.forEach((sc, j) => {
          if (!allowed.includes(sc?.base)) err(`${p}.subclasses[${j}].base`, `규칙 직업 ${c.base}의 하위 직업이 아닙니다 (${allowed.join(', ')})`);
          if (typeof sc?.name !== 'string') err(`${p}.subclasses[${j}].name`, '이름이 필요합니다.');
        });
        if (allowed.length && allowed.every((id) => c.subclasses!.some((sc) => sc.base === id && sc.hidden))) warn(`${p}.subclasses`, '하위 직업을 모두 숨기면 기본 목록을 보여 줍니다.');
      }
    }
  });
  // ---- 장면 (v0.47)
  const sceneIds = new Set<string>();
  arr<NonNullable<WorldPackage['scenes']>[number]>('scenes', false).forEach((sc, i) => {
    const p = `scenes[${i}]`;
    if (!sc.id || typeof sc.id !== 'string') err(`${p}.id`, 'ID가 필요합니다.'); else if (sceneIds.has(sc.id)) err(`${p}.id`, `겹치는 장면 ID "${sc.id}"`); else sceneIds.add(sc.id);
    text(sc.name, `${p}.name`); text(sc.description, `${p}.description`);
    if (sc.npcId && !charIds.has(sc.npcId)) err(`${p}.npcId`, `없는 인물 "${sc.npcId}"`);
    if (sc.locationId && !locIds.has(sc.locationId)) err(`${p}.locationId`, `없는 장소 "${sc.locationId}"`);
    if (sc.start) checkCond(sc.start, `${p}.start`);
    const gauges = new Set<string>(); const states = new Set<string>(); const phases = new Set<string>();
    if (!Array.isArray(sc.gauges) || !sc.gauges.length) err(`${p}.gauges`, '수치가 하나 이상 필요합니다.');
    (Array.isArray(sc.gauges) ? sc.gauges : []).forEach((g, j) => {
      if (!g?.id) err(`${p}.gauges[${j}].id`, 'ID가 필요합니다.'); else gauges.add(g.id);
      text(g?.name, `${p}.gauges[${j}].name`);
      if (typeof g?.start !== 'number') err(`${p}.gauges[${j}].start`, '시작값(숫자)이 필요합니다.');
      if ((g?.min ?? 0) >= (g?.max ?? 100)) err(`${p}.gauges[${j}]`, 'min은 max보다 작아야 합니다.');
    });
    (sc.states ?? []).forEach((st, j) => { if (!st?.id) err(`${p}.states[${j}].id`, 'ID가 필요합니다.'); else states.add(st.id); text(st?.name, `${p}.states[${j}].name`); });
    (sc.phases ?? []).forEach((ph, j) => { if (!ph?.id) err(`${p}.phases[${j}].id`, 'ID가 필요합니다.'); else phases.add(ph.id); text(ph?.name, `${p}.phases[${j}].name`); });
    const sCond = (c: unknown, path: string): void => {
      if (!isObj(c)) { err(path, '장면 조건은 객체입니다.'); return; }
      if ('all' in c || 'any' in c) { const l = (c as { all?: unknown; any?: unknown }).all ?? (c as { any?: unknown }).any; if (!Array.isArray(l)) err(path, '목록이어야 합니다.'); else l.forEach((x, k) => sCond(x, `${path}[${k}]`)); return; }
      if ('not' in c) { sCond(c.not, `${path}.not`); return; }
      if ('gauge' in c) { if (!gauges.has(c.gauge as string)) err(path, `없는 수치 "${String(c.gauge)}"`); return; }
      if ('state' in c) { if (!states.has(c.state as string)) err(path, `없는 상태 "${String(c.state)}"`); return; }
      if ('phase' in c) { if (!phases.has(c.phase as string)) err(path, `없는 단계 "${String(c.phase)}"`); return; }
      if ('round' in c) { if (typeof c.round !== 'number') err(path, 'round는 숫자입니다.'); return; }
      err(path, '알 수 없는 장면 조건입니다. gauge·state·phase·round·all·any·not 중 하나를 쓰세요.');
    };
    const sDelta = (d: unknown, path: string) => {
      if (d === undefined) return;
      if (!isObj(d)) { err(path, '객체여야 합니다.'); return; }
      for (const k of Object.keys((d.gauges as object) ?? {})) if (!gauges.has(k)) err(`${path}.gauges`, `없는 수치 "${k}"`);
      for (const k of [...((d.addStates as string[]) ?? []), ...((d.removeStates as string[]) ?? [])]) if (!states.has(k)) err(path, `없는 상태 "${k}"`);
      if (d.phase !== undefined && !phases.has(d.phase as string)) err(`${path}.phase`, `없는 단계 "${String(d.phase)}"`);
    };
    const actIds = new Set<string>();
    if (!Array.isArray(sc.actions) || !sc.actions.length) err(`${p}.actions`, '행동이 하나 이상 필요합니다.');
    (Array.isArray(sc.actions) ? sc.actions : []).forEach((a, j) => {
      const ap = `${p}.actions[${j}]`;
      if (!a?.id) err(`${ap}.id`, 'ID가 필요합니다.'); else if (actIds.has(a.id)) err(`${ap}.id`, `겹치는 행동 ID "${a.id}"`); else actIds.add(a.id);
      text(a?.name, `${ap}.name`);
      if (a?.check) { const [k, id] = a.check.split(':'); if (!((k === 'skill' && SKILL_IDS.includes(id as never)) || (k === 'ability' && ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(id ?? '')))) err(`${ap}.check`, '판정은 "skill:기술ID" 또는 "ability:str|dex|con|int|wis|cha"입니다.'); }
      if (a?.dc !== undefined && (typeof a.dc !== 'number' || a.dc < 1 || a.dc > 30)) err(`${ap}.dc`, 'DC는 1~30입니다.');
      (a?.phases ?? []).forEach((ph) => { if (!phases.has(ph)) err(`${ap}.phases`, `없는 단계 "${ph}"`); });
      if (a?.requires) sCond(a.requires, `${ap}.requires`);
      sDelta(a?.success, `${ap}.success`); sDelta(a?.failure, `${ap}.failure`); sDelta(a?.great, `${ap}.great`);
      (a?.mods ?? []).forEach((m, k) => { if (!gauges.has(m?.gauge)) err(`${ap}.mods[${k}]`, `없는 수치 "${String(m?.gauge)}"`); if (typeof m?.per !== 'number') err(`${ap}.mods[${k}].per`, 'per(수치 1당 더할 값)는 숫자입니다.'); });
    });
    const endIds = new Set<string>();
    if (!Array.isArray(sc.ends) || !sc.ends.length) err(`${p}.ends`, '끝이 하나 이상 필요합니다.');
    (Array.isArray(sc.ends) ? sc.ends : []).forEach((e, j) => {
      const ep = `${p}.ends[${j}]`;
      if (!e?.id) err(`${ep}.id`, 'ID가 필요합니다.'); else if (endIds.has(e.id)) err(`${ep}.id`, `겹치는 끝 ID "${e.id}"`); else endIds.add(e.id);
      text(e?.name, `${ep}.name`);
      if (!['success', 'failure', 'neutral'].includes(e?.outcome)) err(`${ep}.outcome`, 'outcome은 success/failure/neutral입니다.');
      sCond(e?.when, `${ep}.when`);
      if (e?.effects) deferredEffects.push([e.effects, `${ep}.effects`]);
      checkRewards(e?.rewards, `${ep}.rewards`);
    });
    (sc.reactions ?? []).forEach((re, j) => {
      if (re?.when) sCond(re.when, `${p}.reactions[${j}].when`);
      if (re?.chance !== undefined && (typeof re.chance !== 'number' || re.chance <= 0 || re.chance > 1)) err(`${p}.reactions[${j}].chance`, '확률은 0보다 크고 1 이하입니다.');
      sDelta(re?.delta, `${p}.reactions[${j}].delta`);
    });
    // 그림 참조 (v0.50): 내장 그림은 있어야 하고, 세계 이미지는 등록돼 있어야 한다 (내 기본 이미지 user.…는 기기마다 달라 확인하지 않음)
    const assetIds = new Set(((input as unknown as WorldPackage).assets ?? []).map((a) => a?.id));
    const img = (id: unknown, path: string) => {
      if (id === undefined) return;
      if (typeof id !== 'string' || !id) { err(path, '그림은 에셋 ID 글자입니다.'); return; }
      if (id.startsWith('stock.')) { if (!stockDataUrl(id)) err(path, `없는 내장 그림 "${id}"`); return; }
      if (!id.startsWith('user.') && !assetIds.has(id)) warn(path, `세계 이미지에 없는 그림 "${id}" — 이미지 탭에서 올리거나 내장 장면 그림(stock.fx-…)을 고르세요.`);
    };
    img(sc.image, `${p}.image`);
    (sc.phases ?? []).forEach((ph, j) => img(ph?.image, `${p}.phases[${j}].image`));
    (Array.isArray(sc.actions) ? sc.actions : []).forEach((a, j) => { img(a?.image, `${p}.actions[${j}].image`); img(a?.success?.image, `${p}.actions[${j}].success.image`); img(a?.great?.image, `${p}.actions[${j}].great.image`); img(a?.failure?.image, `${p}.actions[${j}].failure.image`); });
    (sc.reactions ?? []).forEach((re, j) => img(re?.delta?.image, `${p}.reactions[${j}].delta.image`));
    (Array.isArray(sc.ends) ? sc.ends : []).forEach((e, j) => img(e?.image, `${p}.ends[${j}].image`));
    if (sc.narration !== undefined && !['fixed', 'end', 'ai'].includes(sc.narration)) err(`${p}.narration`, 'narration은 fixed·end·ai 중 하나입니다.');
    if (sc.timeoutEnd && !endIds.has(sc.timeoutEnd)) err(`${p}.timeoutEnd`, `없는 끝 "${sc.timeoutEnd}"`);
    if (!sc.maxRounds && !(sc.ends ?? []).some((e) => e?.outcome === 'failure')) warn(`${p}`, '실패로 끝나는 길도, 차례 한도(maxRounds)도 없습니다 — 장면이 끝나지 않을 수 있습니다.');
  });
  // ---- 세계 수치 (설계 v4 E6)
  const seenVars = new Set<string>();
  worldVars.forEach((v, i) => {
    const p = `vars[${i}]`;
    if (!v.id) err(`${p}.id`, 'ID가 필요합니다.'); else if (seenVars.has(v.id)) err(`${p}.id`, `겹치는 ID "${v.id}"`); else seenVars.add(v.id);
    text(v.name, `${p}.name`);
    if (typeof v.initial !== 'number') err(`${p}.initial`, '처음 값은 숫자입니다.');
    if ((v.labels ?? []).some((l) => !Array.isArray(l) || typeof l[0] !== 'number' || typeof l[1] !== 'string')) err(`${p}.labels`, '단계는 [값, "이름"] 목록입니다.');
    if (v.poles !== undefined && !(Array.isArray(v.poles) && v.poles.length === 2 && v.poles.every((x) => typeof x === 'string' && x.trim()))) err(`${p}.poles`, '양 끝의 이름 두 개 ["…", "…"]입니다.');
  });
  // ---- 국면 (v0.113)
  const seenPhases = new Set<string>();
  phaseList.forEach((ph, i) => {
    const p = `phases[${i}]`;
    if (!ph.id) err(`${p}.id`, 'ID가 필요합니다.'); else if (seenPhases.has(ph.id)) err(`${p}.id`, `겹치는 ID "${ph.id}"`); else seenPhases.add(ph.id);
    text(ph.name, `${p}.name`);
    text(ph.tone, `${p}.tone`);
    checkCond(ph.enter, `${p}.enter`);
    for (const f of ph.from ?? []) if (!phaseIds.has(f)) err(`${p}.from`, `없는 국면 "${f}"`);
    for (const l of ph.closed ?? []) if (!locIds.has(l)) err(`${p}.closed`, `없는 장소 "${l}"`);
    for (const c of Object.keys(ph.attitudes ?? {})) if (!charIds.has(c)) err(`${p}.attitudes`, `없는 인물 "${c}"`);
    if (ph.tint !== undefined && !['calm', 'warm', 'tense', 'dark', 'bright'].includes(ph.tint)) err(`${p}.tint`, 'calm · warm · tense · dark · bright 중 하나입니다.');
    if (ph.music !== undefined && !['calm', 'tense', 'dark', 'combat'].includes(ph.music)) err(`${p}.music`, 'calm · tense · dark · combat 중 하나입니다.');
    if (ph.effects !== undefined) deferredEffects.push([ph.effects, `${p}.effects`]);
  });
  if (phaseList.length && !phaseList.some((ph) => !ph.from?.length)) warn('phases', '어디서든 들어올 수 있는 국면(from 없음)이 하나도 없습니다 — 첫 국면은 맨 위의 것이 됩니다.');
  // ---- 칭호 (설계 v4 E4)
  arr<NonNullable<WorldPackage['titles']>[number]>('titles', false).forEach((t, i) => {
    const p = `titles[${i}]`;
    text(t.name, `${p}.name`);
    if (!t.id || typeof t.id !== 'string') err(`${p}.id`, 'ID가 필요합니다.');
    if (t.renown !== undefined && (typeof t.renown !== 'number' || t.renown < 0 || t.renown > 50)) err(`${p}.renown`, '명성은 0~50입니다.');
    checkCond(t.condition, `${p}.condition`);
  });
  // ---- 이야기 엔진 (설계 v3 5장)
  const allSceneIds = new Set(((input as unknown as WorldPackage).scenes ?? []).map((x) => x?.id));
  const checkEffects = (list: unknown, path: string) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) { err(path, '효과는 목록이어야 합니다.'); return; }
    list.forEach((fx, j) => {
      const p = `${path}[${j}]`;
      if (!isObj(fx)) { err(p, '효과는 객체입니다.'); return; }
      if ('setFlag' in fx) { if (!flagIds.has(fx.setFlag as string)) err(p, `선언되지 않은 플래그 "${String(fx.setFlag)}"`); return; }
      if ('npcRelation' in fx) {
        if (!charIds.has(fx.npcRelation as string)) err(p, `없는 인물 "${String(fx.npcRelation)}"`);
        if (!charIds.has(fx.with as string)) err(p, `없는 인물 "${String(fx.with)}"`);
        if (fx.kind !== 'none' && !RELATION_KINDS.includes(fx.kind as never)) err(p, `관계 종류는 ${RELATION_KINDS.join('/')}/none 중 하나입니다.`);
        return;
      }
      if ('moveNpc' in fx) { if (!charIds.has(fx.moveNpc as string)) err(p, `없는 인물 "${String(fx.moveNpc)}"`); if (!locIds.has(fx.to as string)) err(p, `없는 장소 "${String(fx.to)}"`); return; }
      if ('killNpc' in fx) { if (!charIds.has(fx.killNpc as string)) err(p, `없는 인물 "${String(fx.killNpc)}"`); return; }
      if ('reveal' in fx) { if (!claimIds.has(fx.reveal as string)) err(p, `없는 명제 "${String(fx.reveal)}"`); return; }
      if ('relationship' in fx) { if (!charIds.has(fx.relationship as string)) err(p, `없는 인물 "${String(fx.relationship)}"`); if (!isObj(fx.delta)) err(p, 'delta가 필요합니다 (예: { "trust": 5 }).'); return; }
      if ('reputation' in fx) { if (!factionIds.has(fx.reputation as string)) err(p, `없는 세력 "${String(fx.reputation)}"`); return; }
      if ('clock' in fx) { if (!clockIds.has(fx.clock as string)) err(p, `없는 시계 "${String(fx.clock)}"`); return; }
      if ('giveItem' in fx) { if (!itemIds.has(fx.giveItem as string)) err(p, `없는 아이템 "${String(fx.giveItem)}"`); return; }
      if ('takeItem' in fx) { if (!itemIds.has(fx.takeItem as string)) err(p, `없는 아이템 "${String(fx.takeItem)}"`); return; }
      if ('money' in fx) { if (typeof fx.money !== 'number') err(p, 'money는 숫자입니다.'); return; }
      if ('trait' in fx) { if (!traitIds.has(fx.trait as string)) err(p, `없는 성향 축 "${String(fx.trait)}"`); if (typeof fx.add !== 'number') err(p, 'add 숫자가 필요합니다.'); return; }
      if ('var' in fx) { if (!varIds.has(fx.var as string)) err(p, `선언되지 않은 세계 수치 "${String(fx.var)}"`); if (typeof (fx.add ?? fx.set) !== 'number') err(p, 'add 또는 set 숫자가 필요합니다.'); return; }
      if ('startScene' in fx) { if (!allSceneIds.has(fx.startScene as string)) err(p, `없는 장면 "${String(fx.startScene)}"`); return; }
      if ('startEncounter' in fx) { if (!encIds.has(fx.startEncounter as string)) err(p, `없는 조우 "${String(fx.startEncounter)}"`); return; }
      if ('moveTo' in fx) { if (!locIds.has(fx.moveTo as string)) err(p, `없는 장소 "${String(fx.moveTo)}"`); return; }
      err(p, '알 수 없는 효과입니다. setFlag·moveNpc·killNpc·reveal·relationship·reputation·clock·giveItem·takeItem·money·var·trait·npcRelation·startScene·startEncounter·moveTo 중 하나를 쓰세요.');
    });
  };
  deferredEffects.forEach(([l, p]) => checkEffects(l, p));
  // ---- 연결 (v0.85): 조우의 조건·결과, 임무 단계의 고비, 장면 진입, 관계 사건의 장면
  encounters.forEach((e, i) => {
    const p = `encounters[${i}]`;
    if (e.when) checkCond(e.when, `${p}.when`);
    if (e.force) checkCond(e.force, `${p}.force`);
    checkEffects(e.onVictory, `${p}.onVictory`); checkEffects(e.onDefeat, `${p}.onDefeat`); checkEffects(e.onFlee, `${p}.onFlee`);
    if (e.retry !== undefined && e.retry !== 'gone' && (typeof e.retry !== 'number' || e.retry < 0 || e.retry > 99)) err(`${p}.retry`, 'retry는 0~99의 턴 수 또는 "gone"입니다.');
  });
  quests.forEach((q, i) => (Array.isArray(q.stages) ? q.stages : []).forEach((st, j) => {
    const p = `quests[${i}].stages[${j}].via`;
    if (st?.via?.encounter && !encIds.has(st.via.encounter)) err(`${p}.encounter`, `없는 조우 "${st.via.encounter}"`);
    if (st?.via?.scene && !allSceneIds.has(st.via.scene)) err(`${p}.scene`, `없는 장면 "${st.via.scene}"`);
  }));
  ((input as unknown as WorldPackage).scenes ?? []).forEach((sc, i) => {
    if (!sc?.entry) return;
    if (!['button', 'offer', 'auto'].includes(sc.entry.mode)) err(`scenes[${i}].entry.mode`, 'button/offer/auto 중 하나입니다.');
    if (sc.entry.mode === 'offer' && !sc.entry.trigger?.trim()) warn(`scenes[${i}].entry.trigger`, `"${sc.name}": GM이 여는 장면인데 계기(trigger)가 비어 있습니다 — 장면 설명만으로 판단합니다.`);
  });
  relationBeats.forEach((b, i) => { if (b?.scene && !allSceneIds.has(b.scene)) err(`relationBeats[${i}].scene`, `없는 장면 "${b.scene}"`); });
  // ---- 세계 규칙 (v0.83)
  const worldRules = arr<NonNullable<WorldPackage['rules']>[number]>('rules', false);
  worldRules.forEach((r, i) => {
    const p = `rules[${i}]`;
    if (!isObj(r)) { err(p, '규칙은 객체입니다.'); return; }
    register(r.id, p);
    text(r.name, `${p}.name`);
    const tr = r.trigger as unknown;
    if (!isObj(tr) || (tr.kind !== 'action' && tr.kind !== 'state')) err(`${p}.trigger`, '발동 방식은 action(플레이어 행동) 또는 state(세계 상태)입니다.');
    else if (tr.kind === 'action') {
      const kws = Array.isArray(tr.keywords) ? tr.keywords : [];
      if (!(isStr(tr.describe) && tr.describe.trim()) && !kws.some((k) => isStr(k) && k.trim())) err(`${p}.trigger`, '어떤 행동인지 묘사하거나 낱말을 하나 이상 적으세요.');
      if (tr.keywords !== undefined && !Array.isArray(tr.keywords)) err(`${p}.trigger.keywords`, '낱말은 목록입니다.');
    } else checkCond(tr.condition, `${p}.trigger.condition`);
    if (r.requires) checkCond(r.requires, `${p}.requires`);
    checkEffects(r.effects, `${p}.effects`);
    if (r.reactions !== undefined && !Array.isArray(r.reactions)) err(`${p}.reactions`, '반응은 목록입니다.');
    (Array.isArray(r.reactions) ? r.reactions : []).forEach((re, j) => {
      const q = `${p}.reactions[${j}]`;
      if (!isObj(re)) { err(q, '반응은 객체입니다.'); return; }
      if (re.npcId !== 'present' && !charIds.has(re.npcId)) err(`${q}.npcId`, `없는 인물 "${String(re.npcId)}"`);
      text(re.text, `${q}.text`);
    });
    const rep = r.repeat;
    if (rep !== undefined && rep !== 'once' && rep !== 'always' && !(typeof rep === 'number' && rep >= 1 && rep <= 1000)) err(`${p}.repeat`, '반복은 once/always 또는 1 이상의 턴 수입니다.');
    if (!(r.effects ?? []).length && !(r.reactions ?? []).length && !r.outcome?.trim() && !r.announce?.trim()) warn(p, '결과(효과·반응·결과 지시)가 없어 발동해도 아무 일이 없습니다.');
  });
  // ---- 세계만의 적
  customMonsters.forEach((m, i) => {
    const p = `monsters[${i}]`;
    if (!isObj(m)) { err(p, '적 정의는 객체입니다.'); return; }
    if (!isStr(m.id) || !/^mon\/[a-z0-9_-]+$/.test(m.id)) err(`${p}.id`, '적 ID는 "mon/소문자-이름" 형식입니다.');
    else if (customMonsters.findIndex((x) => x?.id === m.id) !== i) err(`${p}.id`, `ID "${m.id}"가 중복됩니다.`);
    text(m.name, `${p}.name`); text(m.look, `${p}.look`, false);
    if (!ROLES.includes(m.role)) err(`${p}.role`, `역할은 ${ROLES.join('/')} 중 하나입니다.`);
    for (const k of ['xp', 'ac', 'hp'] as const) if (typeof m[k] !== 'number' || m[k] < (k === 'xp' ? 0 : 1) || m[k] > (k === 'xp' ? 50000 : k === 'ac' ? 30 : 1000)) err(`${p}.${k}`, `${k}가 올바른 숫자가 아닙니다.`);
    if (!isObj(m.abilities) || !ABILS.every((a) => typeof (m.abilities as Record<string, unknown>)[a] === 'number')) err(`${p}.abilities`, '능력치 6개(str dex con int wis cha)가 필요합니다.');
    const checkAtk = (a: unknown, q: string) => {
      if (!isObj(a)) { err(q, '공격은 객체입니다.'); return; }
      text(a.name as string, `${q}.name`);
      if (a.kind !== 'melee' && a.kind !== 'ranged') err(`${q}.kind`, 'melee 또는 ranged입니다.');
      if (!isStr(a.damage) || !DICE.test(a.damage)) err(`${q}.damage`, '피해는 주사위 식입니다 (예: 1d8).');
      if (typeof a.toHit !== 'number' || typeof a.bonus !== 'number') err(q, 'toHit·bonus는 숫자입니다.');
      if (isObj(a.inflict) && (!CONDS.includes(a.inflict.condition as string) || !ABILS.includes(a.inflict.save as string))) err(`${q}.inflict`, `상태 이상(${CONDS.join('/')})과 내성 능력치를 정하세요.`);
    };
    const checkSp = (sp: unknown, q: string) => {
      if (!isObj(sp)) { err(q, '기술은 객체입니다.'); return; }
      text(sp.name as string, `${q}.name`);
      if (sp.kind !== 'save' && sp.kind !== 'area') err(`${q}.kind`, 'save(한 명) 또는 area(한 존)입니다.');
      if (!ABILS.includes(sp.save as string)) err(`${q}.save`, '내성 능력치가 필요합니다.');
      if (!isStr(sp.damage) || !DICE.test(sp.damage)) err(`${q}.damage`, '피해는 주사위 식입니다 (예: 2d6).');
      if (isObj(sp.inflict) && !CONDS.includes(sp.inflict.condition as string)) err(`${q}.inflict`, `상태 이상은 ${CONDS.join('/')} 중 하나입니다.`);
    };
    if (!Array.isArray(m.attacks) || !m.attacks.length) err(`${p}.attacks`, '공격이 하나 이상 필요합니다.');
    else m.attacks.forEach((a, j) => checkAtk(a, `${p}.attacks[${j}]`));
    (Array.isArray(m.specials) ? m.specials : []).forEach((sp, j) => checkSp(sp, `${p}.specials[${j}]`));
    (Array.isArray(m.phases) ? m.phases : []).forEach((ph, j) => {
      if (typeof ph.below !== 'number' || ph.below <= 0 || ph.below >= 1) err(`${p}.phases[${j}].below`, '0~1 사이 비율입니다 (예: 0.5).');
      text(ph.line, `${p}.phases[${j}].line`);
      (ph.attacks ?? []).forEach((a, k) => checkAtk(a, `${p}.phases[${j}].attacks[${k}]`));
      (ph.specials ?? []).forEach((sp, k) => checkSp(sp, `${p}.phases[${j}].specials[${k}]`));
    });
  });
  // ---- 아이템·상점·전리품 (설계 v3 6.4)
  const checkStacks = (list: unknown, path: string) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) { err(path, '목록이어야 합니다.'); return; }
    list.forEach((st, j) => { if (!isObj(st) || !itemIds.has(st.itemId as string)) err(`${path}[${j}]`, `없는 아이템 "${isObj(st) ? String(st.itemId) : ''}"`); });
  };
  ownItems.forEach((it, i) => {
    const p = `items[${i}]`;
    text(it.name, `${p}.name`);
    if (!ITEM_KINDS.includes(it.kind)) err(`${p}.kind`, `종류는 ${ITEM_KINDS.join('/')} 중 하나입니다.`);
    if (it.price !== undefined && (typeof it.price !== 'number' || it.price < 0)) err(`${p}.price`, '가격은 0 이상의 숫자입니다.');
    if (it.heal && !/^\d*d\d+([+-]\d+)?$/.test(it.heal)) err(`${p}.heal`, '회복은 주사위 식입니다 (예: 2d4+2).');
    if (it.card && !CARD_IDS.has(it.card)) err(`${p}.card`, `없는 카드 "${it.card}"`);
    if (it.kind === 'armor' && !it.armor) warn(`${p}.armor`, '갑옷이면 armor: { base, dexMax }를 정하세요.');
    if (it.rarity !== undefined && !RARITIES.includes(it.rarity)) err(`${p}.rarity`, `등급은 ${RARITIES.join('/')} 중 하나입니다.`);
    for (const [k, v] of Object.entries(it.bonus ?? {})) if (typeof v !== 'number' || Math.abs(v) > 5) err(`${p}.bonus.${k}`, '보너스는 -5~5 사이 숫자입니다.');
    (it.cards ?? []).forEach((c, j) => { if (!CARD_IDS.has(c)) err(`${p}.cards[${j}]`, `없는 카드 "${c}"`); });
    if (it.teaches && !CARD_IDS.has(it.teaches)) err(`${p}.teaches`, `없는 카드 "${it.teaches}"`);
    if (it.kind === 'scroll' && !it.teaches) warn(`${p}.teaches`, '비급·주문서는 익힐 카드(teaches)를 정하세요.');
    (it.awaken ?? []).forEach((a, j) => {
      text(a.name, `${p}.awaken[${j}].name`);
      checkCond(a.condition, `${p}.awaken[${j}].condition`);
      (a.cards ?? []).forEach((c, k) => { if (!CARD_IDS.has(c)) err(`${p}.awaken[${j}].cards[${k}]`, `없는 카드 "${c}"`); });
    });
  });
  locations.forEach((l, i) => {
    checkStacks(l.pickups, `locations[${i}].pickups`);
    if (l.shop) {
      text(l.shop.name, `locations[${i}].shop.name`);
      (l.shop.items ?? []).forEach((id, j) => { if (!itemIds.has(id)) err(`locations[${i}].shop.items[${j}]`, `없는 아이템 "${id}"`); });
      if (l.shop.factionId && !factionIds.has(l.shop.factionId)) err(`locations[${i}].shop.factionId`, `없는 세력 "${l.shop.factionId}"`);
    }
  });
  characters.forEach((c, i) => {
    checkStacks(c.gives, `characters[${i}].gives`);
    (c.gives ?? []).forEach((g, j) => { if (g.condition) checkCond(g.condition, `characters[${i}].gives[${j}].condition`); });
  });
  encounters.forEach((e, i) => checkStacks(e.loot?.items, `encounters[${i}].loot.items`));
  quests.forEach((q, i) => checkStacks(q.rewards?.items, `quests[${i}].rewards.items`));
  // ---- 의뢰판 (설계 v3 6.3)
  const jobIds = new Set<string>();
  locations.forEach((l, i) => {
    if (!l.board) return;
    const bp = `locations[${i}].board`;
    text(l.board.name, `${bp}.name`);
    (Array.isArray(l.board.jobs) ? l.board.jobs : []).forEach((job, j) => {
      const p = `${bp}.jobs[${j}]`;
      if (!isStr(job.id) || !job.id.startsWith('job/')) err(`${p}.id`, '의뢰 ID는 "job/"로 시작합니다.');
      else if (jobIds.has(job.id) || ids.has(job.id)) err(`${p}.id`, `ID "${job.id}"가 중복됩니다.`);
      jobIds.add(job.id);
      text(job.name, `${p}.name`); text(job.description, `${p}.description`);
      if (!(QUEST_TYPES as readonly string[]).includes(job.type)) err(`${p}.type`, `유형은 ${QUEST_TYPES.join('/')} 중 하나입니다.`);
      if (!locIds.has(job.locationId)) err(`${p}.locationId`, `없는 장소 "${job.locationId}"`);
      if (job.enemies?.length) job.enemies.forEach((e, k) => { if (!MT[e.monsterId]) err(`${p}.enemies[${k}]`, `없는 적 "${e.monsterId}"`); });
      else if (!job.complete) err(p, '토벌 적(enemies)이나 완료 조건(complete) 중 하나가 필요합니다.');
      if (job.complete) checkCond(job.complete, `${p}.complete`);
      if (job.requires) checkCond(job.requires, `${p}.requires`);
      checkRewards(job.rewards, `${p}.rewards`);
      checkStacks(job.rewards?.items, `${p}.rewards.items`);
    });
  });
  if (isObj(w.start)) checkStacks(w.start.items, 'start.items');

  // ---- 지속되는 세계 (설계 v3 7장)
  characters.forEach((c, i) => (c.schedule ?? []).forEach((sc, j) => {
    const p = `characters[${i}].schedule[${j}]`;
    if (!locIds.has(sc.locationId)) err(`${p}.locationId`, `없는 장소 "${sc.locationId}"`);
    if (![sc.from, sc.to].every((h) => Number.isInteger(h) && h >= 0 && h <= 24) || sc.from === sc.to) err(p, '시각은 0~24 사이 정수이고 from과 to가 달라야 합니다 (예: 20~6 = 밤).');
  }));
  factions.forEach((f, i) => (f.actions ?? []).forEach((a, j) => {
    const p = `factions[${i}].actions[${j}]`;
    text(a.name, `${p}.name`);
    if (!Number.isInteger(a.every) || a.every < 1) err(`${p}.every`, '며칠마다(1 이상 정수)입니다.');
    if (a.condition) checkCond(a.condition, `${p}.condition`);
    checkEffects(a.effects, `${p}.effects`);
  }));

  // ---- 돌발 사건 표 (설계 v4 E5)
  arr<NonNullable<WorldPackage['randomEvents']>[number]>('randomEvents', false).forEach((e, i) => {
    const p = `randomEvents[${i}]`;
    text(e.name, `${p}.name`); text(e.text, `${p}.text`);
    if (!['ambush', 'meeting', 'news', 'opportunity'].includes(e.kind)) err(`${p}.kind`, '종류는 ambush/meeting/news/opportunity 중 하나입니다.');
    (e.where ?? []).forEach((id, j) => { if (!locIds.has(id)) err(`${p}.where[${j}]`, `없는 장소 "${id}"`); });
    if (e.weight !== undefined && !(typeof e.weight === 'number' && e.weight > 0)) err(`${p}.weight`, '가중치는 0보다 큰 숫자입니다.');
    if (e.cooldownDays !== undefined && !(Number.isInteger(e.cooldownDays) && e.cooldownDays >= 0)) err(`${p}.cooldownDays`, '0 이상의 정수(일)입니다.');
    if (e.condition) checkCond(e.condition, `${p}.condition`);
    if (e.effects) checkEffects(e.effects, `${p}.effects`);
    (e.enemies ?? []).forEach((x, j) => { if (!MT[x.monsterId]) err(`${p}.enemies[${j}]`, `없는 적 "${x.monsterId}"`); });
  });

  arcs.forEach((a, i) => {
    const p = `arcs[${i}]`;
    text(a.name, `${p}.name`);
    if (!['main', 'faction', 'character'].includes(a.kind)) err(`${p}.kind`, 'main·faction·character 중 하나입니다.');
    checkCond(a.start, `${p}.start`);
    if (!Array.isArray(a.chapters) || !a.chapters.length) err(`${p}.chapters`, '장이 하나 이상 필요합니다.');
    else a.chapters.forEach((ch, j) => {
      const q = `${p}.chapters[${j}]`;
      text(ch.name, `${q}.name`); text(ch.goal, `${q}.goal`, false);
      checkCond(ch.complete, `${q}.complete`);
      if (isAlwaysTrue(ch.complete)) warn(`${q}.complete`, `끝나는 조건이 비어 있어 ${j === 0 ? '줄기가 시작되자마자' : '앞 장이 끝나자마자'} 이 장이 끝납니다 (장 보상 경험치도 바로 받음). 조건을 정하세요.`);
      if (isUnset(ch.complete)) warn(`${q}.complete`, '끝나는 조건을 아직 정하지 않아 이 장은 끝나지 않습니다.');
      if (ch.xp !== undefined && !(typeof ch.xp === 'number' ? ch.xp >= 0 : ['minor', 'major', 'chapter'].includes(ch.xp))) err(`${q}.xp`, '경험치는 0 이상 숫자 또는 minor·major·chapter입니다.');
      if (ch.fail) checkCond(ch.fail, `${q}.fail`);
      checkEffects(ch.effects, `${q}.effects`);
    });
  });
  choices.forEach((c, i) => {
    const p = `choices[${i}]`;
    text(c.name, `${p}.name`); text(c.prompt, `${p}.prompt`);
    checkCond(c.when, `${p}.when`);
    if (c.locationId && !locIds.has(c.locationId)) err(`${p}.locationId`, `없는 장소 "${c.locationId}"`);
    if (!Array.isArray(c.options) || c.options.length < 2) err(`${p}.options`, '선택지가 둘 이상 필요합니다.');
    else c.options.forEach((o, j) => { text(o.text, `${p}.options[${j}].text`); if (!isStr(o.id) || !o.id) err(`${p}.options[${j}].id`, '선택지 ID가 필요합니다.'); checkEffects(o.effects, `${p}.options[${j}].effects`); });
  });
  clocks.forEach((c, i) => {
    const p = `clocks[${i}]`;
    text(c.name, `${p}.name`);
    if (typeof c.segments !== 'number' || c.segments < 1 || c.segments > 20) err(`${p}.segments`, '칸 수는 1~20입니다.');
    (Array.isArray(c.tick) ? c.tick : []).forEach((t, j) => {
      if (isObj(t) && 'on' in t) checkCond(t.on, `${p}.tick[${j}].on`);
      else if (!isObj(t) || !('every' in t) || !['day', 'hour', 'beat'].includes(t.every as string)) err(`${p}.tick[${j}]`, '{ "every": "beat"|"day"|"hour", "by": n } 또는 { "on": 조건, "by": n } 입니다.');
    });
    (Array.isArray(c.at) ? c.at : []).forEach((a, j) => {
      if (typeof a.segment !== 'number' || a.segment < 1 || a.segment > c.segments) err(`${p}.at[${j}].segment`, `1~${c.segments} 사이 칸이어야 합니다.`);
      checkEffects(a.effects, `${p}.at[${j}].effects`);
    });
  });
  worldEvents.forEach((e, i) => {
    const p = `events[${i}]`;
    text(e.name, `${p}.name`);
    if (!isObj(e.when) || (e.when.day === undefined && !e.when.date && !e.when.condition)) err(`${p}.when`, 'day·date·condition 중 하나 이상이 필요합니다.');
    else {
      if (e.when.date && !w.calendar) warn(`${p}.when.date`, '달력이 없는 세계에서는 날짜 사건이 일어나지 않습니다 (기본 탭에서 달력을 정하거나 day를 쓰세요).');
      if (e.when.condition) checkCond(e.when.condition, `${p}.when.condition`);
    }
    if (e.unless) checkCond(e.unless, `${p}.unless`);
    checkEffects(e.effects, `${p}.effects`);
  });
  flags.forEach((f, i) => {
    const p = `flags[${i}]`;
    if (!isStr(f.id) || !/^[a-z0-9_]+$/.test(f.id)) err(`${p}.id`, '플래그 ID는 소문자·숫자·_ 입니다.');
    text(f.when, `${p}.when`);
    if (f.locationId && !locIds.has(f.locationId)) err(`${p}.locationId`, `없는 장소 "${f.locationId}"`);
    if (f.requires) checkCond(f.requires, `${p}.requires`);
  });
  endings.forEach((e, i) => { text(e.name, `endings[${i}].name`); text(e.epilogue, `endings[${i}].epilogue`); checkCond(e.condition, `endings[${i}].condition`); });

  // ---- 시작
  if (!isObj(w.start)) err('start', '시작 설정이 필요합니다.');
  else {
    if (!locIds.has(w.start.locationId)) err('start.locationId', `없는 장소 "${w.start.locationId}"`);
    text(w.start.openingScene, 'start.openingScene');
    // 도달 가능성
    const seen = new Set<string>([w.start.locationId]);
    const queue = [w.start.locationId];
    while (queue.length) {
      const id = queue.shift();
      const cur = locations.find((l) => l.id === id);
      for (const n of cur?.connections ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
    locations.forEach((l, i) => { if (!seen.has(l.id)) warn(`locations[${i}]`, `시작 장소에서 "${l.id}"로 갈 길이 없습니다.`); });
  }
  if (!locations.length) err('locations', '장소가 하나 이상 필요합니다.');

  // ---- 시작 방식 · 문체 · 이미지 (v0.13)
  const starts = arr<NonNullable<WorldPackage['starts']>[number]>('starts', false);
  const startIds = new Set<string>();
  starts.forEach((st, i) => {
    const p = `starts[${i}]`;
    if (!isObj(st)) { err(p, '시작 방식이 객체가 아닙니다.'); return; }
    if (!isStr(st.id) || !st.id) err(`${p}.id`, 'ID가 필요합니다.');
    else if (startIds.has(st.id)) err(`${p}.id`, `시작 방식 ID "${st.id}"가 중복됩니다.`);
    else startIds.add(st.id);
    if (!isStr(st.name) || !st.name.trim()) err(`${p}.name`, '이름이 필요합니다.');
    if (!locIds.has(st.locationId)) err(`${p}.locationId`, `없는 장소 "${st.locationId}"`);
    text(st.openingScene, `${p}.openingScene`);
    (st.knows ?? []).forEach((c, j) => { if (!claims.some((x) => x.id === c)) err(`${p}.knows[${j}]`, `없는 명제 "${c}"`); });
  });
  if (w.genre !== undefined) {
    const g = w.genre as unknown;
    if (!isObj(g) || !isStr(g.id)) err('genre', '장르 ID가 필요합니다.');
    else {
      if (g.id === CUSTOM_GENRE_ID) {
        const c = isObj(g.custom) ? g.custom : undefined;
        if (!c || !isStr(c.tone) || !c.tone.trim()) err('genre.custom.tone', '사용자 정의 장르는 분위기 지침(tone)이 필요합니다.');
        if (c && (!isStr(c.label) || !c.label.trim())) warn('genre.custom.label', '사용자 정의 장르의 이름이 비어 있습니다.');
        if (c && c.base !== undefined && !['high_fantasy', 'wuxia', 'romance', 'fighting'].includes(String(c.base))) err('genre.custom.base', '바탕 장르는 high_fantasy / wuxia / romance / fighting 중 하나입니다.');
      } else if (!GENRES.some((x) => x.id === g.id)) warn('genre.id', `알 수 없는 장르 "${g.id}" — 하이 판타지로 다룹니다.`);
      if (g.levelCap !== undefined && (!Number.isInteger(g.levelCap) || (g.levelCap as number) < 1 || (g.levelCap as number) > MAX_LEVEL)) err('genre.levelCap', `최대 레벨은 1~${MAX_LEVEL}입니다.`);
    }
  }
  if (w.calendar !== undefined) {
    const c = w.calendar as unknown;
    const okDate = (x: unknown) => isObj(x) && Number.isInteger(x.year) && Number.isInteger(x.month) && (x.month as number) >= 1 && (x.month as number) <= 12 && Number.isInteger(x.day) && (x.day as number) >= 1 && (x.day as number) <= 31;
    if (!okDate(c)) err('calendar', '달력의 연·월·일이 올바르지 않습니다 (월 1~12, 일 1~31).');
    else if ((c as { countdown?: unknown }).countdown !== undefined && !okDate((c as { countdown?: unknown }).countdown)) err('calendar.countdown', '카운트다운 날짜가 올바르지 않습니다.');
  }
  if (w.style !== undefined) {
    if (!isStr(w.style)) err('style', '문체는 글이어야 합니다.');
    else { text(w.style, 'style'); if (w.style.length > 1500) warn('style', '문체 지침이 깁니다 (1500자까지만 씁니다).'); }
  }
  const assets = arr<NonNullable<WorldPackage['assets']>[number]>('assets', false);
  if (assets.length > 50_000) err('assets', '이미지가 너무 많습니다 (최대 50,000장).');
  if (assets.some((a) => isObj(a) && isStr(a.id) && a.id.startsWith('user.'))) warn('assets', '"내 기본 이미지"는 이 브라우저에만 있어, 패키지를 내보내면 다른 사람에게는 빈 칸으로 보입니다.');
  const assetIds = new Set<string>();
  const charIdSet = new Set(characters.map((c) => c?.id));
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i]!, p = `assets[${i}]`;
    if (!isObj(a) || !isStr(a.id) || !/^[\w.-]{1,64}$/.test(a.id)) { err(p, '이미지 ID가 올바르지 않습니다.'); continue; }
    if (assetIds.has(a.id)) err(p, `이미지 ID "${a.id}"가 중복됩니다.`);
    assetIds.add(a.id);
    if (!['character', 'scene', 'map', 'cover', 'other'].includes(a.kind)) err(`${p}.kind`, '알 수 없는 이미지 종류');
    if (!/^image\/(png|jpeg|webp|gif|avif|svg\+xml)$/.test(a.mime)) err(`${p}.mime`, '지원하지 않는 이미지 형식');
    if (a.characterId && !charIdSet.has(a.characterId)) warn(`${p}.characterId`, `없는 인물 "${a.characterId}" — 이 이미지는 쓰이지 않습니다.`);
    if (a.locationId && !locIds.has(a.locationId)) warn(`${p}.locationId`, `없는 장소 "${a.locationId}"`);
    if (!Array.isArray(a.tags)) err(`${p}.tags`, '태그는 목록이어야 합니다.');
  }
  return issues;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.level === 'error');
