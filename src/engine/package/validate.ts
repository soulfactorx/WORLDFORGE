/**
 * 세계관 패키지 검사기 (설계서 PART 5.2-8 Package Builder, 설계 리뷰 5.2절 패키지 린터).
 * 오류(error)가 하나라도 있으면 플레이할 수 없다. 경고(warning)는 제작자에게 알리기만 한다.
 */
import { CLASSES, SKILL_IDS } from '../character/rules';
import { STD_ITEMS } from '../../data/items';
import { QUEST_TYPES, RARITIES, type Rewards } from '../schema';
import { ALL_CARDS } from '../combat/combat';
import { STAGES } from '../relationship';
import { encounterDifficulty, MONSTERS, monsterTable } from '../combat/monsters';
import type { Condition, WorldPackage } from '../schema';
import { GENRES } from '../../data/genres';
import { MAX_LEVEL } from '../character/progression';

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
  const factIds = new Set(facts.map((f) => f?.id));
  const claimIds = new Set(claims.map((c) => c?.id));
  const encIds = new Set(encounters.map((e) => e?.id));
  const questIds = new Set(quests.map((q) => q?.id));
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

  // ---- 인물
  characters.forEach((c, i) => {
    const p = `characters[${i}]`;
    for (const k of ['name', 'appearance', 'personality', 'speech'] as const) text(c[k], `${p}.${k}`);
    if (!locIds.has(c.locationId)) err(`${p}.locationId`, `없는 장소 "${c.locationId}"`);
    if (!IMPROV.includes(c.improvisation)) err(`${p}.improvisation`, 'none / minor / free 중 하나입니다.');
    if (c.companion) {
      if (!CLASSES[c.companion.classId]) err(`${p}.companion.classId`, `알 수 없는 직업 "${c.companion.classId}" (${Object.keys(CLASSES).join(', ')})`);
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
    if ('level' in cond) { if (typeof cond.level !== 'number') err(path, 'level은 숫자입니다.'); return; }
    err(path, `알 수 없는 조건 (${keys.join(', ') || '빈 객체'}). all·any·not·knows·at·cleared·inParty·relationship·stage·reputation·chapter·arcDone·clock·choice·day·hasItem·money·defeated·npcAlive·npcAt·questFailed·flag·questDone·level 중 하나를 쓰세요.`);
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
  quests.forEach((q, i) => {
    const p = `quests[${i}]`;
    text(q.name, `${p}.name`);
    if (q.kind !== 'main' && q.kind !== 'side') err(`${p}.kind`, 'main 또는 side입니다.');
    checkCond(q.start, `${p}.start`);
    if (!Array.isArray(q.stages) || !q.stages.length) err(`${p}.stages`, '단계가 하나 이상 필요합니다.');
    else q.stages.forEach((st, j) => { text(st.objective, `${p}.stages[${j}].objective`); text(st.hint, `${p}.stages[${j}].hint`, false); checkCond(st.complete, `${p}.stages[${j}].complete`); if (st.fail) checkCond(st.fail, `${p}.stages[${j}].fail`); });
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
    if (b.resolveFlag && !flagIds.has(b.resolveFlag)) err(`${p}.resolveFlag`, `선언되지 않은 플래그 "${b.resolveFlag}" — 플래그 목록에 추가하세요 (GM이 세울 수 있어야 사건이 닫힙니다).`);
  });
  // ---- 칭호 (설계 v4 E4)
  arr<NonNullable<WorldPackage['titles']>[number]>('titles', false).forEach((t, i) => {
    const p = `titles[${i}]`;
    text(t.name, `${p}.name`);
    if (!t.id || typeof t.id !== 'string') err(`${p}.id`, 'ID가 필요합니다.');
    if (t.renown !== undefined && (typeof t.renown !== 'number' || t.renown < 0 || t.renown > 50)) err(`${p}.renown`, '명성은 0~50입니다.');
    checkCond(t.condition, `${p}.condition`);
  });
  // ---- 이야기 엔진 (설계 v3 5장)
  const checkEffects = (list: unknown, path: string) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) { err(path, '효과는 목록이어야 합니다.'); return; }
    list.forEach((fx, j) => {
      const p = `${path}[${j}]`;
      if (!isObj(fx)) { err(p, '효과는 객체입니다.'); return; }
      if ('setFlag' in fx) { if (!flagIds.has(fx.setFlag as string)) err(p, `선언되지 않은 플래그 "${String(fx.setFlag)}"`); return; }
      if ('moveNpc' in fx) { if (!charIds.has(fx.moveNpc as string)) err(p, `없는 인물 "${String(fx.moveNpc)}"`); if (!locIds.has(fx.to as string)) err(p, `없는 장소 "${String(fx.to)}"`); return; }
      if ('killNpc' in fx) { if (!charIds.has(fx.killNpc as string)) err(p, `없는 인물 "${String(fx.killNpc)}"`); return; }
      if ('reveal' in fx) { if (!claimIds.has(fx.reveal as string)) err(p, `없는 명제 "${String(fx.reveal)}"`); return; }
      if ('relationship' in fx) { if (!charIds.has(fx.relationship as string)) err(p, `없는 인물 "${String(fx.relationship)}"`); if (!isObj(fx.delta)) err(p, 'delta가 필요합니다 (예: { "trust": 5 }).'); return; }
      if ('reputation' in fx) { if (!factionIds.has(fx.reputation as string)) err(p, `없는 세력 "${String(fx.reputation)}"`); return; }
      if ('clock' in fx) { if (!clockIds.has(fx.clock as string)) err(p, `없는 시계 "${String(fx.clock)}"`); return; }
      if ('giveItem' in fx) { if (!itemIds.has(fx.giveItem as string)) err(p, `없는 아이템 "${String(fx.giveItem)}"`); return; }
      if ('takeItem' in fx) { if (!itemIds.has(fx.takeItem as string)) err(p, `없는 아이템 "${String(fx.takeItem)}"`); return; }
      if ('money' in fx) { if (typeof fx.money !== 'number') err(p, 'money는 숫자입니다.'); return; }
      err(p, '알 수 없는 효과입니다. setFlag·moveNpc·killNpc·reveal·relationship·reputation·clock·giveItem·takeItem·money 중 하나를 쓰세요.');
    });
  };
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
      if (isObj(ch.complete) && 'all' in ch.complete && Array.isArray(ch.complete.all) && !ch.complete.all.length) warn(`${q}.complete`, '완료 조건이 비어 바로 끝납니다.');
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
      else if (!isObj(t) || !('every' in t) || !['day', 'hour'].includes(t.every as string)) err(`${p}.tick[${j}]`, '{ "every": "day"|"hour", "by": n } 또는 { "on": 조건, "by": n } 입니다.');
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
      if (!GENRES.some((x) => x.id === g.id)) warn('genre.id', `알 수 없는 장르 "${g.id}" — 하이 판타지로 다룹니다.`);
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
