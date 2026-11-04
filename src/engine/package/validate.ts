/**
 * 세계관 패키지 검사기 (설계서 PART 5.2-8 Package Builder, 설계 리뷰 5.2절 패키지 린터).
 * 오류(error)가 하나라도 있으면 플레이할 수 없다. 경고(warning)는 제작자에게 알리기만 한다.
 */
import { CLASSES, SKILL_IDS } from '../character/rules';
import { MONSTERS } from '../combat/monsters';
import type { Condition, WorldPackage } from '../schema';

export interface Issue {
  level: 'error' | 'warning';
  path: string;
  message: string;
}

const KNOWLEDGE_STATES = ['rumor', 'partial', 'confirmed', 'mistaken', 'secret'];
const IMPROV = ['none', 'minor', 'free'];
const AXES = ['affinity', 'trust', 'respect', 'fear'];
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
  const characters = arr<WorldPackage['characters'][number]>('characters', true);
  const facts = arr<WorldPackage['facts'][number]>('facts', true);
  const claims = arr<WorldPackage['claims'][number]>('claims', true);
  const beliefs = arr<WorldPackage['beliefs'][number]>('beliefs', true);
  const encounters = arr<NonNullable<WorldPackage['encounters']>[number]>('encounters', false);
  const quests = arr<NonNullable<WorldPackage['quests']>[number]>('quests', false);
  const flags = arr<NonNullable<WorldPackage['flags']>[number]>('flags', false);
  const endings = arr<NonNullable<WorldPackage['endings']>[number]>('endings', false);

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
      if (!AXES.includes(k) || typeof v !== 'number' || v < -100 || v > 100) err(`${p}.relationship.${k}`, '관계 축은 affinity/trust/respect/fear, 값은 -100~100입니다.');
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
      if (!MONSTERS[en.monsterId]) err(`${p}.enemies[${j}].monsterId`, `알 수 없는 몬스터 "${en.monsterId}" (${Object.keys(MONSTERS).join(', ')})`);
      if (en.zone !== 2 && en.zone !== 3) err(`${p}.enemies[${j}].zone`, 'zone은 2(적 전열) 또는 3(적 후열)입니다.');
    });
    text(e.trigger, `${p}.trigger`);
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
    if ('at' in cond) { if (!locIds.has(cond.at)) err(path, `없는 장소 "${cond.at}"`); return; }
    if ('cleared' in cond) { if (!encIds.has(cond.cleared)) err(path, `없는 조우 "${cond.cleared}"`); return; }
    if ('inParty' in cond) { if (!charIds.has(cond.inParty)) err(path, `없는 인물 "${cond.inParty}"`); return; }
    if ('relationship' in cond) { if (!charIds.has(cond.relationship)) err(path, `없는 인물 "${cond.relationship}"`); if (!AXES.includes(cond.axis)) err(path, `알 수 없는 관계 축 "${cond.axis}"`); return; }
    if ('flag' in cond) { if (!flagIds.has(cond.flag)) err(path, `선언되지 않은 플래그 "${cond.flag}"`); return; }
    if ('questDone' in cond) { if (!questIds.has(cond.questDone)) err(path, `없는 임무 "${cond.questDone}"`); return; }
    if ('level' in cond) { if (typeof cond.level !== 'number') err(path, 'level은 숫자입니다.'); return; }
    err(path, `알 수 없는 조건 (${keys.join(', ') || '빈 객체'}). all·any·not·knows·at·cleared·inParty·relationship·flag·questDone·level 중 하나를 쓰세요.`);
  };
  quests.forEach((q, i) => {
    const p = `quests[${i}]`;
    text(q.name, `${p}.name`);
    if (q.kind !== 'main' && q.kind !== 'side') err(`${p}.kind`, 'main 또는 side입니다.');
    checkCond(q.start, `${p}.start`);
    if (!Array.isArray(q.stages) || !q.stages.length) err(`${p}.stages`, '단계가 하나 이상 필요합니다.');
    else q.stages.forEach((st, j) => { text(st.objective, `${p}.stages[${j}].objective`); text(st.hint, `${p}.stages[${j}].hint`, false); checkCond(st.complete, `${p}.stages[${j}].complete`); });
    (q.rewards?.relationship ?? []).forEach((r, j) => { if (!charIds.has(r.npcId)) err(`${p}.rewards.relationship[${j}]`, `없는 인물 "${r.npcId}"`); });
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
  if (w.style !== undefined) {
    if (!isStr(w.style)) err('style', '문체는 글이어야 합니다.');
    else { text(w.style, 'style'); if (w.style.length > 1500) warn('style', '문체 지침이 깁니다 (1500자까지만 씁니다).'); }
  }
  const assets = arr<NonNullable<WorldPackage['assets']>[number]>('assets', false);
  if (assets.length > 50_000) err('assets', '이미지가 너무 많습니다 (최대 50,000장).');
  const assetIds = new Set<string>();
  const charIdSet = new Set(characters.map((c) => c?.id));
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i]!, p = `assets[${i}]`;
    if (!isObj(a) || !isStr(a.id) || !/^[\w.-]{1,64}$/.test(a.id)) { err(p, '이미지 ID가 올바르지 않습니다.'); continue; }
    if (assetIds.has(a.id)) err(p, `이미지 ID "${a.id}"가 중복됩니다.`);
    assetIds.add(a.id);
    if (!['character', 'scene', 'map', 'cover', 'other'].includes(a.kind)) err(`${p}.kind`, '알 수 없는 이미지 종류');
    if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(a.mime)) err(`${p}.mime`, '지원하지 않는 이미지 형식');
    if (a.characterId && !charIdSet.has(a.characterId)) warn(`${p}.characterId`, `없는 인물 "${a.characterId}" — 이 이미지는 쓰이지 않습니다.`);
    if (a.locationId && !locIds.has(a.locationId)) warn(`${p}.locationId`, `없는 장소 "${a.locationId}"`);
    if (!Array.isArray(a.tags)) err(`${p}.tags`, '태그는 목록이어야 합니다.');
  }
  return issues;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.level === 'error');
