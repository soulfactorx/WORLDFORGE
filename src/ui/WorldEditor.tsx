import { useMemo, useState } from 'react';
import { Area, ItemList, JsonField, Num, Select, Text } from './form';
import { EndingForms, FlagForms, QuestForms } from './StoryForms';
import { Simulator, StoryBoard, WorldMap } from './StoryTools';
import { PackExport, PackImport } from './PackDialog';
import { DIFFICULTY_LABEL, encounterDifficulty, monsterTable, monstersOfWorld } from '../engine/combat/monsters';
import { CLASSES } from '../engine/character/rules';
import { hasErrors, validateWorld } from '../engine/package/validate';
import { type Belief, type Character, type Claim, type Fact, type Faction, type Location, type NpcRelationKind, QUEST_TYPES, type WorldPackage } from '../engine/schema';
import { QUEST_TYPE_LABEL } from '../engine/scenario';
import { RELATION_KIND_LABEL, STAGES } from '../engine/relationship';
import { STD_ITEMS } from '../data/items';
import { blankWorld, exportWpk, PRIVATE_NOTE, savePackage } from '../storage/packages';
import { MATURE_NOTE, shareBlocked } from '../engine/rating';
import { confirmAdult } from './adult';
import { AssetGallery } from './AssetGallery';
import { fillOrphanKnowledge } from '../gm/worldgen/fromCard';
import { imageNeeds } from '../gm/worldgen/imageNeeds';
import { GENRES, genreOf } from '../data/genres';
import { MAX_LEVEL } from '../engine/character/progression';
import { IssueList } from './IssueList';
import { CardImportDialog } from './CardImportDialog';
import { josa } from '../engine/text/josa';
import { generateScenario } from '../gm/worldgen/generate';
import { createLlmClient } from '../llm';
import type { LlmSettings } from '../llm/types';

/**
 * 세계관 제작 도구 1단계 (설계서 PART 5): 폼 편집 + 고급 항목 JSON 편집 + 실시간 검사.
 * 프로그래밍 없이 장소·인물·지식을 만들고, 조우·임무 같은 구조는 JSON으로 편집한다.
 */

type Tab = 'basic' | 'tools' | 'locations' | 'characters' | 'relations' | 'knowledge' | 'items' | 'encounters' | 'quests' | 'story' | 'images' | 'json';
const TABS: [Tab, string][] = [
  ['basic', '기본'], ['tools', '보드·지도·시뮬레이터'], ['locations', '장소'], ['characters', '인물'], ['relations', '관계·세력'], ['knowledge', '지식'], ['items', '아이템·상점'],
  ['encounters', '조우'], ['quests', '임무·플래그·결말'], ['story', '이야기 흐름'], ['images', '이미지'], ['json', 'JSON 전체'],
];
const IMPROV = [['none', '지어내기 금지'], ['minor', '작은 세부사항만'], ['free', '자유']] as const;
const STATES = [['rumor', '소문'], ['partial', '들은 이야기'], ['confirmed', '확인됨'], ['mistaken', '잘못 앎'], ['secret', '비밀']] as const;

function tabForPath(path: string): Tab {
  // 세부 경로가 먼저 (장소·인물 안의 상점·의뢰판·건넬 것)
  if (/^locations\[\d+\]\.(shop|pickups)/.test(path) || /^characters\[\d+\]\.gives/.test(path) || path.startsWith('start.items')) return 'items';
  if (/^locations\[\d+\]\.board/.test(path)) return 'quests';
  if (path.startsWith('manifest') || path.startsWith('start') || path.startsWith('style')) return 'basic';
  if (path.startsWith('assets')) return 'images';
  if (path.startsWith('locations')) return 'locations';
  if (path.startsWith('characters')) return 'characters';
  if (path.startsWith('facts') || path.startsWith('claims') || path.startsWith('beliefs')) return 'knowledge';
  if (path.startsWith('factions') || path.startsWith('relations') || path.startsWith('relationBeats')) return 'relations';
  if (path.startsWith('items')) return 'items';
  if (path.startsWith('encounters') || path.startsWith('monsters')) return 'encounters';
  if (path.startsWith('arcs') || path.startsWith('choices') || path.startsWith('clocks') || path.startsWith('events')) return 'story';
  if (path.startsWith('quests') || path.startsWith('flags') || path.startsWith('endings')) return 'quests';
  return 'json';
}

// ---------------------------------------------------------------- 편집기

export function WorldEditor({ initial, onDone, settings, draftNotes, initialCard, alreadySaved }: {
  initial: WorldPackage | null; onDone: () => void; settings?: LlmSettings | null; draftNotes?: string[];
  /** 이미 라이브러리에 저장된 AI 결과 (카드로 만든 세계) */
  alreadySaved?: boolean;
  /** 이 카드 파일로 새 세계를 만든다 (인물 탭에서 가져오기 창을 바로 연다) */
  initialCard?: File;
}) {
  const [w, setW] = useState<WorldPackage>(() => structuredClone(initial ?? blankWorld()));
  const [questView, setQuestView] = useState<'form' | 'json'>('form');
  const [tab, setTab] = useState<Tab>(initialCard ? 'characters' : 'basic');
  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState<string[] | undefined>(draftNotes);
  const [approved, setApproved] = useState(!draftNotes || !!alreadySaved);
  const [genStage, setGenStage] = useState('');
  const [genRequest, setGenRequest] = useState('');
  const [importing, setImporting] = useState(!!initialCard);
  const [packUi, setPackUi] = useState<null | 'import' | 'character' | 'rules'>(null);

  async function aiScenario() {
    if (!settings) return;
    try {
      const r = await generateScenario(createLlmClient(settings), w, setGenStage, undefined, genRequest);
      setW({ ...r.world, manifest: { ...r.world.manifest, aiAssisted: true } });
      setNotes(r.notes);
      setApproved(false);
      setStatus('AI가 임무·조우·결말 초안을 덧붙였습니다. 검토 후 저장하세요.');
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`);
    } finally {
      setGenStage('');
    }
  }
  const issues = useMemo(() => validateWorld(w), [w]);
  const set = (patch: Partial<WorldPackage>) => setW((p) => ({ ...p, ...patch }));
  const locOptions = w.locations.map((l) => [l.id, `${l.name} (${l.id})`] as const);
  const charOptions = w.characters.map((c) => [c.id, `${c.name} (${c.id})`] as const);
  const claimOptions = w.claims.map((c) => [c.id, `${c.id}: ${c.statement.slice(0, 30)}`] as const);

  async function save() {
    try {
      await savePackage(w, 'created');
      setApproved(true);
      setStatus(`저장했습니다 (${w.manifest.id}@${w.manifest.version}).${hasErrors(issues) ? ' 오류를 고쳐야 플레이할 수 있습니다.' : ''}`);
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`);
    }
  }
  function exportFile() {
    const url = URL.createObjectURL(exportWpk(w));
    Object.assign(document.createElement('a'), { href: url, download: `${w.manifest.id}-${w.manifest.version}.wpk` }).click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="panel editor">
      <div className="row">
        <h2>세계관 제작 — {w.manifest.name}</h2>
        <span className="spacer" />
        <button onClick={onDone}>닫기</button>
        {w.manifest.private ? <span className="small muted" title={PRIVATE_NOTE}>🔒 개인용 (내보내기 불가)</span>
          : shareBlocked(w) ? <span className="small muted" title={MATURE_NOTE}>🔞 성인 등급 (내보내기 불가)</span> : <button onClick={exportFile}>.wpk 내보내기</button>}
        <button className="primary" onClick={save}>저장</button>
      </div>
      {status && <p className="status small">{status}</p>}
      {!approved && (
        <div className="ai-draft small">
          <b>✦ AI가 만든 초안입니다.</b> 아직 라이브러리에 등록되지 않았습니다. 내용을 읽고 고친 뒤 <b>저장</b>하면 승인됩니다.
          {notes && notes.length > 0 && (
            <details>
              <summary>자동으로 고친 내용 {notes.length}건</summary>
              <ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </details>
          )}
        </div>
      )}
      {approved && alreadySaved && notes && notes.length > 0 && (
        <div className="ai-draft small">
          <b>✦ AI가 카드로 만든 세계입니다.</b> 라이브러리에 저장되었습니다. 내용을 검토하고 고친 뒤 다시 <b>저장</b>하세요.
          <details><summary>정리하면서 알게 된 것 {notes.length}건</summary><ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul></details>
        </div>
      )}
      {w.manifest.private && <div className="private-banner">🔒 {w.manifest.private.note}<br /><span className="muted">원작: {w.manifest.private.source}</span></div>}
      <IssueList issues={issues} onPick={(p) => setTab(tabForPath(p))} limit={8} />
      {(() => { const nd = imageNeeds(w); return nd.length > 0 && tab !== 'images' && (
        <p className="small">🖼 진짜 이미지가 없는 인물 {nd.filter((x) => x.kind === 'character').length}명 · 장소 {nd.filter((x) => x.kind === 'location').length}곳 (앱 내장 그림으로 대신하는 중)
          {' '}<button className="small" onClick={() => setTab('images')}>이미지 탭에서 보기·올리기</button></p>
      ); })()}
      {issues.some((i) => /아무도 모르고|보호 주제는 subjects/.test(i.message)) && (
        <p className="small">
          <button onClick={() => {
            const r = fillOrphanKnowledge(w);
            setW(r.world);
            setStatus(r.fixed ? `글에 이름이 나오는 인물에게 지식 ${r.fixed}건을 연결했습니다. 확인 후 저장하세요.` : '연결할 인물을 찾지 못했습니다. 지식 탭에서 직접 아는 사람을 정해 주세요.');
          }}>아무도 모르는 지식을 관련 인물에게 연결</button>
          <span className="muted"> — 경고는 플레이를 막지 않습니다. 아무도 모르는 연표는 NPC가 말해 줄 수 없을 뿐입니다.</span>
        </p>
      )}
      <div className="tabs">
        {TABS.filter(([id]) => !(id === 'json' && shareBlocked(w))).map(([id, label]) => <button key={id} type="button" className={tab === id ? 'primary' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>

      {tab === 'basic' && (
        <div className="form-grid">
          {w.assets?.some((a) => !a.id.startsWith('stock.') && !a.id.startsWith('user.')) || w.manifest.private
            ? <p className="small muted">패키지 ID: <code>{w.manifest.id}</code> (이미지가 연결되어 있어 바꿀 수 없습니다)</p>
            : <Text label="패키지 ID (작가.세계 형식, 소문자)" value={w.manifest.id} onChange={(id) => set({ manifest: { ...w.manifest, id } })} />}
          <Text label="이름" value={w.manifest.name} onChange={(name) => set({ manifest: { ...w.manifest, name } })} />
          <Select label="장르" value={w.genre?.id ?? 'high_fantasy'} options={GENRES.map((g) => [g.id, `${g.label} — ${g.description}`] as const)} onChange={(id) => set({ genre: { ...w.genre, id } })} />
          <Num label={`최대 레벨 (1~${MAX_LEVEL}, 비우면 장르 기본 ${genreOf(w.genre?.id).levelCap})`} value={w.genre?.levelCap} onChange={(levelCap) => set({ genre: { id: w.genre?.id ?? 'high_fantasy', ...w.genre, levelCap: levelCap ? Math.max(1, Math.min(MAX_LEVEL, levelCap)) : undefined } })} />
          <Text label={`화폐 이름 (비우면 ${genreOf(w.genre?.id).currency})`} value={w.genre?.currency} onChange={(currency) => set({ genre: { id: w.genre?.id ?? 'high_fantasy', ...w.genre, currency: currency || undefined } })} />
          <Text label="버전" value={w.manifest.version} onChange={(version) => set({ manifest: { ...w.manifest, version } })} placeholder="0.1.0" />
          <Text label="제작자" value={w.manifest.author} onChange={(author) => set({ manifest: { ...w.manifest, author } })} />
          <Text label="라이선스" value={w.manifest.license} onChange={(license) => set({ manifest: { ...w.manifest, license } })} placeholder="CC-BY-4.0" />
          {w.manifest.contentRating === 'mature'
            ? <p className="small">콘텐츠 등급: <b>🔞 성인</b> <span className="muted">— 한 번 정하면 바꿀 수 없습니다 (공유 불가)</span></p>
            : <Select label="콘텐츠 등급" value={w.manifest.contentRating} options={[['all', '전체'], ['teen', '청소년'], ['mature', '성인 (공유 불가 · 이후 변경 불가)']] as const}
                onChange={(contentRating) => { if (contentRating !== 'mature' || (confirmAdult() && confirm('성인 등급은 한 번 정하면 다시 바꿀 수 없습니다. 이 세계를 성인 등급으로 정할까요?'))) set({ manifest: { ...w.manifest, contentRating } }); }} />}
          <Select label="시작 장소" value={w.start.locationId} options={locOptions} onChange={(locationId) => set({ start: { ...w.start, locationId } })} />
          <Area label="첫 장면 (플레이어가 깨어났을 때)" value={w.start.openingScene} onChange={(openingScene) => set({ start: { ...w.start, openingScene } })} />
          <fieldset><legend>달력 (선택) — 게임 속 날짜와 카운트다운</legend>
            <div className="row">
              <Text label="연호" value={w.calendar?.era} placeholder="제국력" onChange={(era) => set({ calendar: { year: 1, month: 1, day: 1, ...w.calendar, era } })} />
              <Num label="시작 연도" value={w.calendar?.year} onChange={(year) => set({ calendar: year ? { era: '', month: 1, day: 1, ...w.calendar, year } : undefined })} />
              <Num label="월" value={w.calendar?.month} onChange={(month) => w.calendar && set({ calendar: { ...w.calendar, month: month ?? 1 } })} />
              <Num label="일" value={w.calendar?.day} onChange={(day) => w.calendar && set({ calendar: { ...w.calendar, day: day ?? 1 } })} />
            </div>
            {w.calendar && (
              <div className="row">
                <Text label="카운트다운 이름" value={w.calendar.countdown?.label} placeholder="파멸의 날" onChange={(label) => set({ calendar: { ...w.calendar!, countdown: label ? { year: w.calendar!.year, month: 12, day: 31, ...w.calendar!.countdown, label } : undefined } })} />
                {w.calendar.countdown && <>
                  <Num label="연도" value={w.calendar.countdown.year} onChange={(year) => set({ calendar: { ...w.calendar!, countdown: { ...w.calendar!.countdown!, year: year ?? 1 } } })} />
                  <Num label="월" value={w.calendar.countdown.month} onChange={(month) => set({ calendar: { ...w.calendar!, countdown: { ...w.calendar!.countdown!, month: month ?? 1 } } })} />
                  <Num label="일" value={w.calendar.countdown.day} onChange={(day) => set({ calendar: { ...w.calendar!, countdown: { ...w.calendar!.countdown!, day: day ?? 1 } } })} />
                </>}
              </div>
            )}
          </fieldset>
          <Area label="서술 문체 참고 (선택, 1500자까지)" value={w.style} rows={4} onChange={(style) => set({ style: style || undefined })} />
          <JsonField label="시작 방식 선택지 (선택: [{ id, name, description, locationId, openingScene, knows }])" value={w.starts ?? []} rows={8} onChange={(starts) => set({ starts: starts.length ? starts : undefined })} />
        </div>
      )}

      {tab === 'locations' && (
        <ItemList<Location> title="장소" items={w.locations} onChange={(locations) => set({ locations })}
          make={(n) => ({ id: `loc/new-${n}`, name: '새 장소', description: '', connections: [] })}
          render={(l, up) => (
            <div className="form-grid">
              <Text label="ID" value={l.id} onChange={(id) => up({ id })} />
              <Text label="이름" value={l.name} onChange={(name) => up({ name })} />
              <Area label="묘사 (플레이어가 감각으로 알 수 있는 것)" value={l.description} onChange={(description) => up({ description })} />
              <Select label="AI 즉흥 설정" value={l.improvisation ?? 'minor'} options={IMPROV} onChange={(improvisation) => up({ improvisation })} />
              <fieldset><legend>연결된 장소</legend>
                <div className="skill-grid">
                  {w.locations.filter((x) => x.id !== l.id).map((x) => (
                    <label key={x.id} className="check"><input type="checkbox" checked={l.connections.includes(x.id)}
                      onChange={(e) => up({ connections: e.target.checked ? [...l.connections, x.id] : l.connections.filter((c) => c !== x.id) })} /> {x.name}</label>
                  ))}
                </div>
              </fieldset>
              <JsonField label="발견할 수 있는 것" value={l.discoveries ?? []} onChange={(discoveries) => up({ discoveries })} rows={6}
                help='[{ "claim": "claim/...", "check": "investigation", "hint": "Director용 힌트" }]' />
            </div>
          )} />
      )}

      {tab === 'characters' && (
        <div className="row">
          <button type="button" onClick={() => setImporting((v) => !v)}>⇩ CHARX · 캐릭터 카드 가져오기</button>
          <button type="button" onClick={() => setPackUi((v) => (v === 'import' ? null : 'import'))}>⇩ 패키지 넣기 (.chp·.rule)</button>
          <button type="button" onClick={() => setPackUi((v) => (v === 'character' ? null : 'character'))}>⇧ 인물 패키지 내보내기</button>
        </div>
      )}
      {(tab === 'characters' || tab === 'items') && packUi === 'import' && (
        <PackImport w={w} onClose={() => setPackUi(null)} onApply={(nw, notes) => { setW(nw); setPackUi(null); setStatus(`패키지를 넣었습니다. ${notes.join(' ')} 검토 후 저장하세요.`); }} />
      )}
      {tab === 'characters' && packUi === 'character' && <PackExport w={w} kind="character" onClose={() => setPackUi(null)} />}
      {tab === 'items' && packUi === 'rules' && <PackExport w={w} kind="rules" onClose={() => setPackUi(null)} />}
      {tab === 'characters' && importing && (
        <CardImportDialog world={w} settings={settings} initialFile={initialCard} onClose={() => setImporting(false)} onAdd={(r) => {
          // 카드로 새로 만드는 세계라면 이름도 카드에서 가져온다
          const named = initialCard && w.manifest.name === '새 세계' && r.cardName ? { ...w.manifest, name: r.cardName } : w.manifest;
          // 다른 사람의 카드로 만든 인물이 들어간 세계는 개인용이 된다 (내보내기 불가)
          const manifest = { ...named, private: named.private ?? { source: r.cardName ?? '캐릭터 카드', note: PRIVATE_NOTE } };
          set({ manifest, characters: [...w.characters, ...r.characters], facts: [...w.facts, ...r.facts], claims: [...w.claims, ...r.claims], beliefs: [...w.beliefs, ...r.beliefs] });
          setImporting(false);
          setStatus(r.characters.length === 1
            ? `${josa(r.characters[0]!.name, '을/를')} 추가했습니다 — 지식 ${r.claims.length}개. 인물 목록 맨 아래에서 확인하세요.`
            : `인물 ${r.characters.length}명과 지식 ${r.claims.length}개를 추가했습니다. 인물 목록 맨 아래에서 확인하세요.`);
        }} />
      )}
      {tab === 'characters' && (
        <ItemList<Character> title="인물" items={w.characters} onChange={(characters) => set({ characters })}
          make={(n) => ({ id: `npc/new-${n}`, name: '새 인물', appearance: '', personality: '', speech: '', locationId: w.start.locationId, improvisation: 'minor' })}
          render={(c, up) => (
            <div className="form-grid">
              <Text label="ID" value={c.id} onChange={(id) => up({ id })} />
              <Text label="이름" value={c.name} onChange={(name) => up({ name })} />
              <Area label="외형" value={c.appearance} onChange={(appearance) => up({ appearance })} rows={2} />
              <Area label="성격" value={c.personality} onChange={(personality) => up({ personality })} rows={2} />
              <Area label="말투" value={c.speech} onChange={(speech) => up({ speech })} rows={2} />
              <Select label="성별 (이미지 고르기용)" value={c.gender ?? ''} options={[['', '정하지 않음'], ['F', '여성'], ['M', '남성']] as const} onChange={(g) => up({ gender: g || undefined })} />
              <Area label="배경 (이 인물만 아는 과거)" value={c.background} onChange={(background) => up({ background: background || undefined })} rows={3} />
              <Area label="첫 만남의 말 (참고)" value={c.greeting} onChange={(greeting) => up({ greeting: greeting || undefined })} rows={2} />
              {c.portrait && <div className="row"><img className="portrait" src={c.portrait} alt="" /><button type="button" onClick={() => up({ portrait: undefined })}>초상화 지우기</button></div>}
              {c.source && <p className="muted small">출처: {c.source.format.toUpperCase()} "{c.source.name}"{c.source.creator && ` · 제작 ${c.source.creator}`} · 가져온 날 {c.source.importedAt.slice(0, 10)}</p>}
              <Select label="있는 곳" value={c.locationId} options={locOptions} onChange={(locationId) => up({ locationId })} />
              <JsonField label="일정 (시각에 따라 있는 곳 — 비우면 늘 위의 장소)" value={c.schedule ?? []} onChange={(schedule) => up({ schedule: Array.isArray(schedule) && schedule.length ? schedule : undefined })} rows={3}
                help='예: [{ "from": 8, "to": 18, "locationId": "loc/market" }, { "from": 20, "to": 6, "locationId": "loc/inn" }] · 0~24시, from이 to보다 크면 자정을 넘긴다' />
              <Select label="AI 즉흥 설정" value={c.improvisation} options={IMPROV} onChange={(improvisation) => up({ improvisation })} />
              <Select label="소속 세력" value={c.faction ?? ''} options={[['', '없음'], ...(w.factions ?? []).map((f) => [f.id, f.name] as const)] as const} onChange={(faction) => up({ faction: faction || undefined })} />
              <label className="check"><input type="checkbox" checked={!!c.romanceable} onChange={(e) => up({ romanceable: e.target.checked || undefined })} /> 연인이 될 수 있는 인물 (친밀·호감이 쌓이면 "연인" 단계)</label>
              <fieldset><legend>플레이어에 대한 초기 관계 (-100~100)</legend>
                <div className="ability-grid">
                  {(['affinity', 'trust', 'respect', 'fear', 'intimacy', 'grudge'] as const).map((k) => (
                    <Num key={k} label={{ affinity: '호감', trust: '신뢰', respect: '존경', fear: '두려움', intimacy: '친밀', grudge: '원한' }[k]} value={c.relationship?.[k]}
                      onChange={(v) => up({ relationship: { ...c.relationship, [k]: v ?? 0 } })} />
                  ))}
                </div>
              </fieldset>
              <Num label="비밀을 털어놓는 신뢰 (기본 40)" value={c.secretTrust} onChange={(secretTrust) => up({ secretTrust })} />
              <Num label="겁먹으면 털어놓는 두려움 (비우면 없음)" value={c.secretFear} onChange={(secretFear) => up({ secretFear })} />
              <label className="check"><input type="checkbox" checked={!!c.companion} onChange={(e) => up({
                companion: e.target.checked ? { classId: 'fighter', abilities: { str: 14, dex: 12, con: 13, int: 10, wis: 11, cha: 10 }, joinCondition: '' } : undefined,
              })} /> 동료로 영입 가능</label>
              {c.companion && (
                <>
                  <Select label="직업" value={c.companion.classId} options={Object.values(CLASSES).map((x) => [x.id, x.name] as const)} onChange={(classId) => up({ companion: { ...c.companion!, classId } })} />
                  <Area label="동행 조건 (이 NPC가 스스로 판단하는 기준)" value={c.companion.joinCondition} onChange={(joinCondition) => up({ companion: { ...c.companion!, joinCondition } })} />
                  <div className="ability-grid">
                    {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((k) => (
                      <Num key={k} label={{ str: '근력', dex: '민첩', con: '건강', int: '지능', wis: '지혜', cha: '매력' }[k]} value={c.companion!.abilities[k]}
                        onChange={(v) => up({ companion: { ...c.companion!, abilities: { ...c.companion!.abilities, [k]: v ?? 10 } } })} />
                    ))}
                  </div>
                  <Num label="동행 최소 신뢰" value={c.companion.minTrust} onChange={(minTrust) => up({ companion: { ...c.companion!, minTrust } })} />
                  <Num label="동행 최소 호감" value={c.companion.minAffinity} onChange={(minAffinity) => up({ companion: { ...c.companion!, minAffinity } })} />
                </>
              )}
            </div>
          )} />
      )}

      {tab === 'relations' && (
        <>
          <p className="muted small">세력 평판은 -100~100. 소속 인물과 가까워지면 오르고, 원한을 사면 떨어진다. 인물의 소속은 인물 탭에서 고른다.</p>
          <ItemList<Faction> title="세력" items={w.factions ?? []} onChange={(factions) => set({ factions })}
            make={(n) => ({ id: `fac/new-${n}`, name: '새 세력', description: '' })}
            render={(f, up) => (
              <div className="form-grid">
                <Text label="ID" value={f.id} onChange={(id) => up({ id })} />
                <Text label="이름" value={f.name} onChange={(name) => up({ name })} />
                <Area label="설명 (소속 인물 연기에 쓰임)" value={f.description} onChange={(description) => up({ description })} rows={2} />
                <Num label="처음 평판 (-100~100, 기본 0)" value={f.reputation} onChange={(reputation) => up({ reputation })} />
                <JsonField label="세력 행동 (며칠마다 일어나는 일 — 시간이 흐르면 세계가 움직인다)" value={f.actions ?? []} onChange={(actions) => up({ actions: Array.isArray(actions) && actions.length ? actions : undefined })} rows={6}
                  help='예: [{ "name": "통행세 인상", "every": 3, "condition": { "not": { "flag": "guild_broken" } }, "effects": [{ "reputation": "fac/…", "delta": -2 }, { "clock": "clock/…", "by": 1 }], "news": "📜 상인 조합이 또 통행세를 올렸다는 소문" }] · 효과는 이야기 흐름 탭과 같다' />
              </div>
            )} />
          <b>인물 사이의 관계</b>
          <p className="muted small">플레이어가 한 사람과 가까워지면 그의 라이벌·원수는 원한이 쌓이고, 가족·동지·연인·스승은 호감이 오른다. 인물 연기에도 쓰인다.</p>
          <table className="rel-table small">
            <tbody>
              {(w.relations ?? []).map((r, i) => {
                const upd = (patch: Partial<typeof r>) => set({ relations: (w.relations ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                const chars = w.characters.map((c) => [c.id, c.name] as const);
                return (
                  <tr key={i}>
                    <td><Select label="" value={r.a} options={chars} onChange={(a) => upd({ a })} /></td>
                    <td><Select label="" value={r.kind} options={Object.entries(RELATION_KIND_LABEL) as [NpcRelationKind, string][]} onChange={(kind) => upd({ kind })} /></td>
                    <td><Select label="" value={r.b} options={chars} onChange={(b) => upd({ b })} /></td>
                    <td><Text label="" value={r.note} placeholder="한 줄 설명" onChange={(note) => upd({ note: note || undefined })} /></td>
                    <td><button type="button" onClick={() => set({ relations: (w.relations ?? []).filter((_, j) => j !== i) })}>삭제</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {w.characters.length >= 2 && <button type="button" onClick={() => set({ relations: [...(w.relations ?? []), { a: w.characters[0]!.id, b: w.characters[1]!.id, kind: 'ally' }] })}>＋ 관계 추가</button>}
          <JsonField label="관계 사건 (조건이 맞으면 열리는 인물의 결정적 장면)" value={w.relationBeats ?? []} onChange={(relationBeats) => set({ relationBeats })} rows={10}
            help={`예: { "id": "beat/…", "npcId": "npc/…", "name": "비밀 고백", "condition": { "stage": "npc/…", "in": ["친구", "절친", "연인"] }, "hint": "그가 과거를 털어놓는다", "resolveFlag": "…" } · 단계: ${STAGES.join(', ')} · resolveFlag는 임무 탭의 플래그에 선언해야 한다 (없으면 4턴 뒤 닫힘)`} />
        </>
      )}

      {tab === 'knowledge' && (
        <>
          <p className="muted small">
            <b>사실</b>은 세계의 진실(AI에게 직접 보이지 않음), <b>명제</b>는 누군가 믿을 수 있는 말(거짓일 수도 있음), <b>믿음</b>은 누가 어떤 명제를 어떤 상태로 아는지입니다.
          </p>
          <h3>사실</h3>
          <ItemList<Fact> title="사실" items={w.facts} onChange={(facts) => set({ facts })}
            make={(n) => ({ id: `fact/new-${n}`, statement: '', secrecy: 0 })}
            render={(f, up) => (
              <div className="form-grid">
                <Text label="ID" value={f.id} onChange={(id) => up({ id })} />
                <Area label="진실" value={f.statement} onChange={(statement) => up({ statement })} />
                <Select label="비밀 등급" value={String(f.secrecy) as '0'} options={['0', '1', '2', '3', '4', '5'].map((x) => [x, x === '0' ? '0 (상식)' : x === '5' ? '5 (극비)' : x] as const)} onChange={(v) => up({ secrecy: Number(v) as Fact['secrecy'] })} />
                <Text label="관련 장소·인물 ID (쉼표로 구분)" value={(f.subjects ?? []).join(', ')} onChange={(v) => up({ subjects: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
                <Text label="보호 주제 (내용을 드러내지 않는 이름표)" value={f.protectedTopic} onChange={(protectedTopic) => up({ protectedTopic: protectedTopic || undefined })} />
              </div>
            )} />
          <h3>명제</h3>
          <ItemList<Claim> title="명제" items={w.claims} onChange={(claims) => set({ claims })}
            make={(n) => ({ id: `claim/new-${n}`, statement: '', truth: 'true' })}
            render={(c, up) => (
              <div className="form-grid">
                <Text label="ID" value={c.id} onChange={(id) => up({ id })} />
                <Area label="내용" value={c.statement} onChange={(statement) => up({ statement })} />
                <Select label="진위" value={c.truth} options={[['true', '참'], ['false', '거짓'], ['partial', '일부만 참']] as const} onChange={(truth) => up({ truth })} />
                <Select label="관련 사실" value={c.relatesTo ?? ''} options={[['', '(없음)'], ...w.facts.map((f) => [f.id, f.id] as const)]} onChange={(v) => up({ relatesTo: v || undefined })} />
              </div>
            )} />
          <h3>믿음 (누가 무엇을 아는가)</h3>
          <table className="beliefs">
            <thead><tr><th>누가</th><th>명제</th><th>상태</th><th /></tr></thead>
            <tbody>
              {w.beliefs.map((b, i) => {
                const upd = (patch: Partial<Belief>) => set({ beliefs: w.beliefs.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <tr key={i}>
                    <td><select value={b.holder} onChange={(e) => upd({ holder: e.target.value })}>{charOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                    <td><select value={b.claim} onChange={(e) => upd({ claim: e.target.value })}>{claimOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                    <td><select value={b.state} onChange={(e) => upd({ state: e.target.value as Belief['state'] })}>{STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                    <td><button type="button" onClick={() => set({ beliefs: w.beliefs.filter((_, j) => j !== i) })}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="row">
            <button type="button" disabled={!w.characters.length || !w.claims.length}
              onClick={() => set({ beliefs: [...w.beliefs, { holder: w.characters[0]!.id, claim: w.claims[0]!.id, state: 'rumor' }] })}>＋ 믿음 추가</button>
          </div>
        </>
      )}

      {tab === 'encounters' && (
        <JsonField label="이 세계만의 적 (기본 적에 더한다 — 규칙 패키지로 주고받을 수 있다)" value={w.monsters ?? []} onChange={(monsters) => set({ monsters: Array.isArray(monsters) && monsters.length ? monsters : undefined })} rows={14}
          help='예: { "id": "mon/sand-wraith", "name": "모래 망령", "look": "모래바람 속의 일그러진 형체", "role": "controller", "cr": "2", "xp": 450, "ac": 13, "hp": 40, "abilities": { "str": 10, "dex": 15, "con": 14, "int": 8, "wis": 12, "cha": 14 }, "immune": ["poisoned"], "fleeAt": 0, "attacks": [{ "name": "모래 손톱", "kind": "melee", "toHit": 5, "damage": "2d6", "bonus": 3, "type": "참격", "count": 2, "inflict": { "condition": "blinded", "save": "con", "dc": 12, "rounds": 1 } }], "specials": [{ "name": "모래 폭풍", "kind": "area", "save": "dex", "dc": 13, "damage": "3d6", "type": "참격", "range": 1, "uses": 1 }], "phases": [{ "below": 0.5, "line": "망령이 울부짖는다!", "ac": 1, "attacks": [{ "name": "흡혼", "kind": "melee", "toHit": 6, "damage": "3d8", "bonus": 2, "type": "사령" }] }] } · 역할: minion·brute·skirmisher·artillery·controller·leader·boss · 경험치는 SRD 도전 지수 기준(1/4=50, 1/2=100, 1=200, 2=450, 3=700, 5=1800)' />
      )}
      {tab === 'encounters' && (
        <JsonField label="조우" value={w.encounters ?? []} onChange={(encounters) => set({ encounters })} rows={18}
          help={`이 세계의 적: ${monstersOfWorld(w).map((m) => `${m.id}(${m.name}·${m.xp}XP)`).join(', ')} · zone 2=적 전열, 3=적 후열 · trigger는 Director에게만 보이는 발동 조건`} />
      )}
      {tab === 'encounters' && (w.encounters ?? []).length > 0 && (
        <ul className="small">
          {(w.encounters ?? []).map((e) => { const d = encounterDifficulty(e.enemies.map((x) => x.monsterId), [1, 1], monsterTable(w)); const d3 = encounterDifficulty(e.enemies.map((x) => x.monsterId), [3, 3], monsterTable(w));
            return <li key={e.id}><b>{e.name}</b> — 적 경험치 {d.xp} · 1레벨 2인: <b>{DIFFICULTY_LABEL[d.difficulty]}</b> · 3레벨 2인: {DIFFICULTY_LABEL[d3.difficulty]}</li>; })}
        </ul>
      )}

      {tab === 'quests' && (
        <>
          {questView === 'json' && <p className="muted small">
            조건식: <code>{'{ "all": [...] }'}</code> <code>{'{ "any": [...] }'}</code> <code>{'{ "not": ... }'}</code> <code>{'{ "knows": "claim/…", "min": "partial" }'}</code>{' '}
            <code>{'{ "at": "loc/…" }'}</code> <code>{'{ "cleared": "enc/…" }'}</code> <code>{'{ "inParty": "npc/…" }'}</code>{' '}
            <code>{'{ "relationship": "npc/…", "axis": "trust", "gte": 20 }'}</code> (축: affinity·trust·respect·fear·intimacy·grudge){' '}
            <code>{'{ "stage": "npc/…", "in": ["친구", "연인"] }'}</code> <code>{'{ "reputation": "fac/…", "gte": 30 }'}</code> <code>{'{ "flag": "…" }'}</code> <code>{'{ "questDone": "quest/…" }'}</code> <code>{'{ "level": 2 }'}</code>
          </p>}
          {settings && (
            <div className="row">
              <input value={genRequest} placeholder="(선택) 원하는 이야기 방향 — 예: 배신하는 동료가 있는 메인 임무" onChange={(e) => setGenRequest(e.target.value)} />
              <button type="button" disabled={!!genStage} onClick={aiScenario}>{genStage || '✦ AI로 임무·조우·결말 추가'}</button>
            </div>
          )}
          <div className="row"><b>보기:</b>
            <button type="button" className={questView === 'form' ? 'primary' : ''} onClick={() => setQuestView('form')}>폼</button>
            <button type="button" className={questView === 'json' ? 'primary' : ''} onClick={() => setQuestView('json')}>JSON</button>
          </div>
          {questView === 'form' ? (
            <>
              <h4>임무</h4><QuestForms w={w} set={set} />
              <h4>이야기 플래그 (GM이 세울 수 있는 결정)</h4><FlagForms w={w} set={set} />
              <h4>결말</h4><EndingForms w={w} set={set} />
            </>
          ) : (
            <>
              <JsonField label="임무" value={w.quests ?? []} onChange={(quests) => set({ quests })} rows={16}
            help={`임무 2.0: "type"(${QUEST_TYPES.map((t) => `${t}=${QUEST_TYPE_LABEL[t]}`).join(', ')}) · "giver"(의뢰인 npc) · "target"(이 인물이 죽으면 실패) · "fail"(실패 조건, 단계마다도 가능) · "timeLimit": { "days": 3 } · "rewards": { "xp", "money", "items", "relationship", "reputation", "cards": [{ "who": "player" 또는 "npc/…", "cardId": "rogue/steady_aim" }] } · 조건 추가: { "defeated": "wolf", "n": 3 } { "npcAlive": "npc/…" } { "npcAt": "npc/…", "at": "loc/…" } { "questFailed": "quest/…" }`} />
              <JsonField label="이야기 플래그 (Director가 세울 수 있는 결정)" value={w.flags ?? []} onChange={(flags) => set({ flags })} rows={8} />
              <JsonField label="결말" value={w.endings ?? []} onChange={(endings) => set({ endings })} rows={8} />
            </>
          )}
          <JsonField label="의뢰판 (장소 ID → 의뢰판, 반복할 수 있는 의뢰)" value={Object.fromEntries(w.locations.flatMap((l) => (l.board ? [[l.id, l.board]] : [])))}
            onChange={(m: Record<string, Location['board']>) => m && typeof m === 'object' && set({ locations: w.locations.map((l) => { const { board: _b, ...rest } = l; return m[l.id] ? { ...rest, board: m[l.id] } : rest; }) })} rows={12}
            help='예: { "loc/guild": { "name": "길드 게시판", "jobs": [{ "id": "job/wolves", "name": "늑대 퇴치", "type": "hunt", "description": "…", "locationId": "loc/forest", "enemies": [{ "monsterId": "wolf", "zone": 2 }], "timeLimit": { "days": 3 } }, { "id": "job/herbs", "name": "약초 채집", "type": "gather", "description": "…", "locationId": "loc/forest", "complete": { "hasItem": "item/herb", "n": 3 }, "rewards": { "money": 30 }, "requires": { "reputation": "fac/…", "gte": 10 } }] } } · 토벌 의뢰는 받을 때마다 조우가 새로 생기고, 보상이 없으면 위협도로 돈이 정해진다' />
        </>
      )}

      {tab === 'items' && (() => {
        const byId = <T,>(list: { id: string }[], pick: (x: never) => T | undefined) => Object.fromEntries(list.flatMap((x) => { const v = pick(x as never); return v === undefined ? [] : [[x.id, v]]; }));
        const applyMap = <K extends 'shop' | 'pickups' | 'gives'>(list: 'locations' | 'characters', key: K, map: Record<string, unknown>) => {
          if (!map || typeof map !== 'object') return;
          set({ [list]: (w[list] as { id: string }[]).map((x) => { const { [key]: _old, ...rest } = x as Record<string, unknown>; return map[x.id] === undefined ? rest : { ...rest, [key]: map[x.id] }; }) } as Partial<WorldPackage>);
        };
        return (
          <>
            <p className="muted small">
              표준 아이템(모든 세계에서 쓸 수 있음): {STD_ITEMS.map((i) => `${i.id}(${i.name}·${i.price ?? 0})`).join(', ')}.
              가격은 화폐 단위({w.genre?.currency ?? genreOf(w.genre?.id).currency})로, 팔 때는 절반. 상점에 세력(factionId)을 달면 평판이 좋을수록 싸고 아주 나쁘면 거래를 거절한다.
              전리품은 조우 탭의 <code>{'"loot": { "money": 30, "items": [{ "itemId": "std/gem" }] }'}</code> (없으면 적 경험치에 비례한 돈). 임무 보상은 <code>{'"rewards": { "money": 50, "items": [...] }'}</code>.
            </p>
            <div className="form-grid">
              <Num label="처음 소지금 (비우면 15)" value={w.start.money} onChange={(money) => set({ start: { ...w.start, money } })} />
              <div className="row">
                <button type="button" onClick={() => setPackUi((v) => (v === 'import' ? null : 'import'))}>⇩ 패키지 넣기 (.chp·.rule)</button>
                <button type="button" onClick={() => setPackUi((v) => (v === 'rules' ? null : 'rules'))}>⇧ 규칙 패키지 내보내기</button>
              </div>
            </div>
            <JsonField label="처음 소지품 (비우면 치유 물약 1개)" value={w.start.items ?? null} onChange={(items) => set({ start: { ...w.start, items: Array.isArray(items) ? items : undefined } })} rows={3}
              help='예: [{ "itemId": "std/potion-healing", "n": 2 }, { "itemId": "std/rope" }]' />
            <JsonField label="이 세계만의 아이템" value={w.items ?? []} onChange={(items) => set({ items })} rows={10}
              help='예: { "id": "item/silver-key", "name": "은 열쇠", "description": "…", "kind": "key" } · 종류: consumable(heal: "2d4+2", cures: ["poisoned"]) · weapon(card: "weapon/longsword") · armor(armor: { "base": 14, "dexMax": 2 }) · shield(acBonus: 2) · key · treasure · misc' />
            <JsonField label="상점 (장소 ID → 상점)" value={byId(w.locations, (l: Location) => l.shop)} onChange={(m) => applyMap('locations', 'shop', m)} rows={8}
              help='예: { "loc/market": { "name": "잡화점", "items": ["std/potion-healing", "std/rope"], "factionId": "fac/…" } }' />
            <JsonField label="주울 수 있는 것 (장소 ID → 목록, hint는 GM에게만)" value={byId(w.locations, (l: Location) => l.pickups)} onChange={(m) => applyMap('locations', 'pickups', m)} rows={6}
              help='예: { "loc/cellar": [{ "itemId": "std/potion-healing", "hint": "선반 뒤에 먼지 쌓인 물약병" }] }' />
            <JsonField label="인물이 건넬 수 있는 것 (인물 ID → 목록, 조건이 맞을 때 한 번씩)" value={byId(w.characters, (c: Character) => c.gives)} onChange={(m) => applyMap('characters', 'gives', m)} rows={6}
              help='예: { "npc/elder": [{ "itemId": "item/silver-key", "condition": { "relationship": "npc/elder", "axis": "trust", "gte": 30 } }] }' />
          </>
        );
      })()}

      {tab === 'basic' && (w.manifest.includes ?? []).length > 0 && (
        <p className="small muted">넣은 패키지: {(w.manifest.includes ?? []).map((x) => `${x.name} (${x.type === 'character' ? '인물' : '규칙'} · ${x.id}@${x.version})`).join(', ')}</p>
      )}
      {tab === 'tools' && (
        <>
          <h4>지도</h4>
          <WorldMap w={w} onPick={() => setTab('locations')} />
          <h4>이야기 보드</h4>
          <StoryBoard w={w} />
          <h4>세계 시뮬레이터</h4>
          {hasErrors(issues) ? <p className="status">검사 오류를 먼저 고쳐야 시뮬레이션할 수 있습니다.</p> : <Simulator w={w} />}
        </>
      )}

      {tab === 'story' && (
        <>
          <p className="muted small">
            세계가 스스로 움직이게 하는 장치들입니다. 조건식은 임무 탭과 같고, 여기서는 <code>{'{ "chapter": "arc/…", "gte": 1 }'}</code> <code>{'{ "arcDone": "arc/…" }'}</code>{' '}
            <code>{'{ "clock": "clock/…", "gte": 4 }'}</code> <code>{'{ "choice": "choice/…", "is": "옵션id" }'}</code> <code>{'{ "day": 3 }'}</code>도 쓸 수 있습니다.
            효과: <code>{'{ "setFlag": "…" }'}</code> <code>{'{ "moveNpc": "npc/…", "to": "loc/…" }'}</code> <code>{'{ "killNpc": "npc/…" }'}</code> <code>{'{ "reveal": "claim/…", "state": "rumor" }'}</code>{' '}
            <code>{'{ "relationship": "npc/…", "delta": { "trust": 5 } }'}</code> <code>{'{ "reputation": "fac/…", "delta": -10 }'}</code> <code>{'{ "clock": "clock/…", "by": 2 }'}</code>
          </p>
          <JsonField label="줄기 (한 세계에 여러 개 — 시작 조건으로 열리고, 장마다 목표·완료·실패 조건)" value={w.arcs ?? []} onChange={(arcs) => set({ arcs })} rows={14}
            help='예: { "id": "arc/main", "name": "숲의 그림자", "kind": "main", "start": { "all": [] }, "chapters": [{ "name": "낯선 땅", "goal": "GM용 목표", "summary": "수첩에 보이는 한 줄", "complete": { "at": "loc/…" }, "fail": { "flag": "…" } }] } · 2부는 start에 { "arcDone": "arc/main" }' />
          <JsonField label="결정적 선택 (조건이 맞으면 플레이어 화면에 고정 선택지가 뜬다)" value={w.choices ?? []} onChange={(choices) => set({ choices })} rows={12}
            help='예: { "id": "choice/side", "name": "누구 편인가", "prompt": "누구의 말을 믿을 것인가?", "when": { "knows": "claim/…" }, "locationId": "loc/… (선택)", "options": [{ "id": "a", "text": "장로를 믿는다", "effects": [{ "setFlag": "…" }] }, { "id": "b", "text": "…", "effects": [] }] }' />
          <JsonField label="진행 시계 (시간·사건으로 차오르고, 정해진 칸에서 일이 벌어진다)" value={w.clocks ?? []} onChange={(clocks) => set({ clocks })} rows={12}
            help='예: { "id": "clock/raid", "name": "도적의 습격 준비", "segments": 6, "tick": [{ "every": "day", "by": 1 }, { "on": { "flag": "warned" }, "by": -2 }], "at": [{ "segment": 3, "omen": "플레이어에게 보이는 징조" }, { "segment": 6, "effects": [{ "setFlag": "raid" }] }] }' />
          <JsonField label="연표 사건 (날짜·날 수·조건에 일어난다. unless가 참이면 막힌다)" value={w.events ?? []} onChange={(events) => set({ events })} rows={12}
            help={`예: { "id": "event/coup", "name": "반역", "when": { "date": { "year": 429, "month": 9, "day": 21 } }, "unless": { "flag": "warned_guard" }, "effects": [{ "killNpc": "npc/…" }], "announce": "플레이어에게 보이는 소식" } · when.day = 시작 후 지난 날 수${w.calendar ? '' : ' · 날짜(date)를 쓰려면 기본 탭에서 달력을 정하세요'}`} />
        </>
      )}

      {tab === 'images' && <AssetGallery world={w} settings={settings} onChange={(assets) => set({ assets })} />}
      {tab === 'json' && !shareBlocked(w) && <JsonField label="패키지 전체 (world.json)" value={w} onChange={(v) => setW(v)} rows={30} />}
    </section>
  );
}
