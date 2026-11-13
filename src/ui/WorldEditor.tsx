import { useEffect, useMemo, useRef, useState } from 'react';
import { Area, ItemList, JsonField, LabLink, Num, Select, Text } from './form';
import { SPEC, StructField } from './Struct';
import { AutoPlayPanel, LabPanel } from './WorldLab';
import { SKILL_IDS } from '../engine/character/rules';
import { SceneForms } from './SceneForms';
import { PortraitPicker } from './PortraitPicker';
import { deleteAssets, storeAssets } from '../storage/assets';
import { addSource, removeSource, sourcesOf } from '../engine/sources';
import { EndingForms, FlagForms, QuestForms } from './StoryForms';
import { Simulator, StoryBoard, WorldMap } from './StoryTools';
import { PackExport, PackImport } from './PackDialog';
import { EncounterForms } from './EncounterForms';
import { ArcForms, BoardForms, ChoiceForms, ClockForms, EventForms, ItemForms, MonsterForms } from './WorldForms';
import { DIFFICULTY_LABEL, encounterDifficulty, monsterTable, monstersOfWorld } from '../engine/combat/monsters';
import { CLASSES } from '../engine/character/rules';
import { ClassEditor } from './ClassEditor';
import { ProfileEditor } from './ProfileEditor';
import { WorldLibrary } from './WorldLibrary';
import { TimeFieldset } from './TimeFieldset';
import { questDraftCards } from '../engine/storylets';
import { classesFor } from '../engine/classes';
import { hasErrors, validateWorld } from '../engine/package/validate';
import { type Belief, type Character, type Claim, type Fact, type Faction, type Location, type NpcRelationKind, QUEST_TYPES, type WorldPackage } from '../engine/schema';
import { QUEST_TYPE_LABEL } from '../engine/scenario';
import { RELATION_KIND_LABEL, STAGES } from '../engine/relationship';
import { STD_ITEMS } from '../data/items';
import { blankWorld, exportWpk, PRIVATE_NOTE, savePackage } from '../storage/packages';
import { MATURE_NOTE, shareBlocked } from '../engine/rating';
import { confirmAdult } from './adult';
import { AssetGallery } from './AssetGallery';
import { ZoomImg } from './Lightbox';
import { fillOrphanKnowledge } from '../gm/worldgen/fromCard';
import { imageNeeds } from '../gm/worldgen/imageNeeds';
import { genreOf } from '../data/genres';
import { MAX_LEVEL } from '../engine/character/progression';
import { IssueList } from './IssueList';
import { CardImportDialog } from './CardImportDialog';
import { josa } from '../engine/text/josa';
import { generateScenario } from '../gm/worldgen/generate';
import { generateScenes } from '../gm/worldgen/scenes';
import { generateRules } from '../gm/worldgen/rules';
import { RuleForms } from './RuleForms';
import { createLlmClient } from '../llm';
import { setUsageScope } from '../llm/usage';
import { WorldAudit } from './WorldAudit';
import { Toast } from './Toast';
import { GenrePicker } from './GenrePicker';
import { GmStylePicker } from './GmStylePicker';
import { epithetOf } from '../engine/names';
import { GenProgress, useGenProgress } from './GenProgress';
import { NpcStatsEditor } from './NpcStatsEditor';
import type { LlmSettings } from '../llm/types';

/**
 * 세계관 제작 도구 1단계 (설계서 PART 5): 폼 편집 + 고급 항목 JSON 편집 + 실시간 검사.
 * 프로그래밍 없이 장소·인물·지식을 만들고, 조우·임무 같은 구조는 JSON으로 편집한다.
 */

type Tab = 'basic' | 'rules' | 'lab' | 'autoplay' | 'player' | 'classes' | 'tools' | 'locations' | 'characters' | 'relations' | 'knowledge' | 'items' | 'encounters' | 'scenes' | 'quests' | 'story' | 'images' | 'json';
const TABS: [Tab, string][] = [
  ['basic', '기본'], ['rules', '⚖ 세계 규칙'], ['player', '주인공'], ['classes', '직업'], ['tools', '보드·지도·시뮬레이터'], ['lab', '상태 시험대'], ['autoplay', '자동 플레이·전체 점검'], ['locations', '장소'], ['characters', '인물'], ['relations', '관계·세력'], ['knowledge', '지식'], ['items', '아이템·상점'],
  ['encounters', '조우'], ['scenes', '장면'], ['quests', '임무·플래그·결말'], ['story', '이야기 흐름'], ['images', '이미지'], ['json', 'JSON 전체'],
];
/** 탭 묶음 (v0.82) */
const TAB_GROUPS: { id: string; label: string; tabs: Tab[] }[] = [
  { id: 'world', label: '🌍 세계', tabs: ['basic', 'rules', 'locations', 'knowledge', 'relations'] },
  { id: 'people', label: '👥 인물', tabs: ['characters', 'player', 'classes'] },
  { id: 'story', label: '📜 이야기', tabs: ['quests', 'story', 'scenes', 'encounters', 'items'] },
  { id: 'test', label: '🧪 시험', tabs: ['lab', 'autoplay', 'tools'] },
  { id: 'data', label: '🗂 자료', tabs: ['images', 'json'] },
];
const IMPROV = [['none', '지어내기 금지'], ['minor', '작은 세부사항만'], ['free', '자유']] as const;
const STATES = [['rumor', '소문'], ['partial', '들은 이야기'], ['confirmed', '확인됨'], ['mistaken', '잘못 앎'], ['secret', '비밀']] as const;

function tabForPath(path: string): Tab {
  // 세부 경로가 먼저 (장소·인물 안의 상점·의뢰판·건넬 것)
  if (/^locations\[\d+\]\.(shop|pickups)/.test(path) || /^characters\[\d+\]\.gives/.test(path) || path.startsWith('start.items')) return 'items';
  if (/^locations\[\d+\]\.board/.test(path)) return 'quests';
  if (path.startsWith('time')) return 'basic';
  if (path.startsWith('manifest') || path.startsWith('start') || path.startsWith('style') || path.startsWith('overview') || path.startsWith('gmNotes')) return 'basic';
  if (path.startsWith('rules')) return 'rules';
  if (path.startsWith('classes')) return 'classes';
  if (path.startsWith('playerProfile') || path.startsWith('traits')) return 'player';
  if (path.startsWith('assets')) return 'images';
  if (path.startsWith('locations')) return 'locations';
  if (path.startsWith('characters')) return 'characters';
  if (path.startsWith('facts') || path.startsWith('claims') || path.startsWith('beliefs')) return 'knowledge';
  if (path.startsWith('factions') || path.startsWith('relations') || path.startsWith('relationBeats')) return 'relations';
  if (path.startsWith('items')) return 'items';
  if (path.startsWith('encounters') || path.startsWith('monsters')) return 'encounters';
  if (path.startsWith('scenes')) return 'scenes';
  if (path.startsWith('arcs') || path.startsWith('vars') || path.startsWith('choices') || path.startsWith('clocks') || path.startsWith('events')) return 'story';
  if (path.startsWith('quests') || path.startsWith('flags') || path.startsWith('endings')) return 'quests';
  return 'json';
}

// ---------------------------------------------------------------- 편집기

export function WorldEditor({ initial, onDone, settings, draftNotes, initialCard, alreadySaved, openLibrary }: {
  initial: WorldPackage | null; onDone: () => void; settings?: LlmSettings | null; draftNotes?: string[];
  /** 이미 라이브러리에 저장된 AI 결과 (카드로 만든 세계) */
  alreadySaved?: boolean;
  /** 이 카드 파일로 새 세계를 만든다 (인물 탭에서 가져오기 창을 바로 연다) */
  initialCard?: File;
  /** 자료실을 바로 연다 (v0.63: 여러 세계에서 골라 새 세계 만들기) */
  openLibrary?: boolean;
}) {
  const [w, setW] = useState<WorldPackage>(() => structuredClone(initial ?? blankWorld()));
  useEffect(() => { setUsageScope({ world: w.manifest.id, worldName: w.manifest.name, area: 'editor' }); }, [w.manifest.id, w.manifest.name]);
  const [questView, setQuestView] = useState<'form' | 'json'>('form');
  const [sceneView, setSceneView] = useState<'form' | 'json'>('form');
  const [pruneOnSave, setPruneOnSave] = useState<string[]>([]);
  const [sceneRequest, setSceneRequest] = useState('');
  const sceneGen = useGenProgress();
  async function genScenes() {
    if (!settings) return;
    try {
      const r = await sceneGen.run('장면 요청을 보내는 중…', (on, sig) => generateScenes(createLlmClient(settings), w, on, sig, sceneRequest));
      if (!r) { setStatus('장면 만들기를 중단했습니다.'); return; }
      setW(r.world);
      setStatus(r.notes.join(' '));
    } catch (e) { setStatus(`장면 생성 실패: ${(e as Error).message}`); }
  }
  const [ruleRequest, setRuleRequest] = useState('');
  const ruleGen = useGenProgress();
  async function genRules() {
    if (!settings) return;
    try {
      const r = await ruleGen.run('세계 요약을 보내는 중…', (on, sig) => generateRules(createLlmClient(settings), w, on, sig, ruleRequest));
      if (!r) { setStatus('규칙 만들기를 중단했습니다.'); return; }
      setW(r.world);
      setStatus(r.notes.join(' '));
    } catch (e) { setStatus(`규칙 생성 실패: ${(e as Error).message}`); }
  }
  // 성인·개인용 세계의 JSON 편집 (v0.83.2): manifest는 빼고 보여 주고, 고친 값에는 원래 manifest를 다시 붙인다
  const lockedRef = useRef<{ w: WorldPackage; rest: unknown } | null>(null);
  const lockedJson = useMemo(() => (lockedRef.current?.w === w ? lockedRef.current.rest : (({ manifest: _m, ...rest }) => rest)(w)), [w]);
  // 시험실 (v0.84): 각 탭의 🧪 버튼이 이 항목을 상태 시험대에서 연다
  const [labFocus, setLabFocus] = useState<{ kind: string; id: string; n: number } | null>(null);
  const openLab = (kind: string, id: string) => { setLabFocus((f) => ({ kind, id, n: (f?.n ?? 0) + 1 })); setTab('lab'); };
  const [tab, setTab] = useState<Tab>(initialCard ? 'characters' : 'basic');
  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState<string[] | undefined>(draftNotes);
  const [approved, setApproved] = useState(!draftNotes || !!alreadySaved);
  const [genRequest, setGenRequest] = useState('');
  const [importing, setImporting] = useState(!!initialCard);
  const [library, setLibrary] = useState(!!openLibrary);
  const [auditing, setAuditing] = useState(false);
  // 저장 안 된 변경 (v0.82): 처음 열었을 때 이후로 바뀌면 표시하고, 닫을 때 확인한다
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const firstW = useRef(true);
  useEffect(() => { if (firstW.current) { firstW.current = false; return; } setDirty(true); }, [w]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const close = () => { if (!dirty || confirm('저장하지 않은 변경이 있습니다. 저장하지 않고 닫을까요?')) onDone(); };
  const [packUi, setPackUi] = useState<null | 'import' | 'character' | 'rules'>(null);

  const scenarioGen = useGenProgress();
  async function aiScenario(focus: 'all' | 'encounters' = 'all') {
    if (!settings) return;
    try {
      const r = await scenarioGen.run('세계 요약을 보내는 중…', (on, sig) => generateScenario(createLlmClient(settings), w, on, sig, genRequest, focus));
      if (!r) { setStatus(focus === 'encounters' ? '조우 만들기를 중단했습니다.' : '임무·조우·결말 만들기를 중단했습니다.'); return; }
      setW({ ...r.world, manifest: { ...r.world.manifest, aiAssisted: true } });
      setNotes(r.notes);
      setApproved(false);
      setStatus(`${focus === 'encounters' ? 'AI가 조우를 덧붙였습니다' : 'AI가 임무·조우·결말 초안을 덧붙였습니다'} — ${r.notes.filter((n) => n.startsWith('추가됨') || n.startsWith('⚠')).join(' / ')}. 검토 후 저장하세요.`);
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`);
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
      // 뺀 출처 카드의 이미지 파일은 저장할 때 지운다 (저장하지 않고 닫으면 그대로)
      if (pruneOnSave.length) { await deleteAssets(w.manifest.id, pruneOnSave.filter((id) => !(w.assets ?? []).some((a) => a.id === id))); setPruneOnSave([]); }
      setApproved(true);
      setDirty(false);
      setSavedFlash(true); setTimeout(() => setSavedFlash(false), 2000);
      setStatus(`✔ 저장했습니다 (${w.manifest.id}@${w.manifest.version}).${hasErrors(issues) ? ' 오류를 고쳐야 플레이할 수 있습니다.' : ''}`);
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
    <LabLink.Provider value={openLab}>
    <section className="panel editor">
      {/* 편집기 상단 바 (v0.82): 닫기 · 제목·저장 상태 · 도구 · 저장 — 스크롤해도 붙어 있다 */}
      <div className="editor-bar">
        <button type="button" className="editor-close" onClick={close} title="닫기" aria-label="닫기">←</button>
        <div className="editor-title">
          <b title={w.manifest.name}>{w.manifest.name || '새 세계'}</b>
          <span className="small muted">세계관 제작{w.manifest.crossover?.length ? ` · 🌌 ${w.manifest.crossover.map((c) => c.name).join('·')}` : ''}{dirty ? <span className="editor-dirty"> · ● 저장 안 됨</span> : ''}</span>
        </div>
        <button type="button" className={`editor-tool${auditing ? ' on' : ''}`} onClick={() => setAuditing((v) => !v)} title="빈칸·잘못 채운 칸·빠진 설정을 찾고 AI로 채운다" aria-label="AI 점검·마무리">🩺<span className="tool-label"> AI 점검</span></button>
        <button type="button" className={`editor-tool${library ? ' on' : ''}`} onClick={() => setLibrary((v) => !v)} title="만들어 둔 다른 세계의 인물·장소·임무·이미지 등을 AI 없이 불러온다" aria-label="만계서고에서 불러오기">🌌<span className="tool-label"> 만계서고</span></button>
        {w.manifest.private ? <button type="button" className="editor-tool" disabled title={PRIVATE_NOTE} aria-label="개인용 — 내보내기 불가">🔒</button>
          : shareBlocked(w) ? <button type="button" className="editor-tool" disabled title={MATURE_NOTE} aria-label="성인 등급 — 내보내기 불가">🔞</button>
          : <button type="button" className="editor-tool" onClick={exportFile} title=".wpk 파일로 내보내기" aria-label=".wpk 내보내기">⤓<span className="tool-label"> 내보내기</span></button>}
        <button type="button" className={`primary editor-save${savedFlash ? ' saved' : ''}`} onClick={() => void save()}>{savedFlash ? '✔ 저장됨' : '저장'}</button>
      </div>
      {library && (
        <WorldLibrary target={w} onClose={() => setLibrary(false)} onApply={(nw, notes) => {
          setW(nw);
          setLibrary(false);
          setStatus(`🌌 만계서고에서 불러왔습니다 — ${notes.join(' / ')} · 저장을 눌러야 반영됩니다.`);
        }} />
      )}
      {auditing && (
        <WorldAudit w={w} settings={settings} onClose={() => setAuditing(false)}
          onApply={(nw, summary) => { setW(nw); setStatus(summary); }}
          onGoto={(p) => setTab(tabForPath(p))}
          onAction={(a) => { setTab(a === 'scenario' ? 'quests' : a === 'encounters' ? 'encounters' : a === 'scenes' ? 'scenes' : a === 'rules' ? 'rules' : 'images'); if (a === 'encounters') void aiScenario('encounters'); if (a === 'rules') void genRules(); }} />
      )}
      <Toast message={status} onClose={() => setStatus('')} ms={status.length > 80 ? 9000 : 5000} />
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
          <b>✦ AI가 카드로 만든 세계입니다.</b> 라이브러리에 저장되었습니다. 내용을 검토하고 고친 뒤 다시 <b>저장</b>하세요. <button type="button" className="small" onClick={() => setAuditing(true)}>🩺 AI로 빈칸·놓친 설정 점검</button>
          <details><summary>정리하면서 알게 된 것 {notes.length}건</summary><ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul></details>
        </div>
      )}
      {w.manifest.private && <div className="private-banner">🔒 {w.manifest.private.note}<br /><span className="muted">원작: {w.manifest.private.source}</span></div>}
      {tab === 'basic' && sourcesOf(w).length > 0 && (
        <fieldset className="sources-box">
          <legend>출처 카드 {sourcesOf(w).length}장 — 이 세계에 쓴 다른 사람의 카드 파일</legend>
          <p className="small muted">다른 기기로 옮길 때 받는 기기에서 <b>이 카드 파일이 모두</b> 있어야 열립니다. 인물 탭에서 가져온 카드는 그 카드에서 온 인물·지식·이미지를 한꺼번에 뺄 수 있습니다.</p>
          <ul className="sources-list">
            {sourcesOf(w).map((s) => (
              <li key={s.hash}>
                <span><b>{s.name}</b>{s.creator && <span className="muted"> · 제작 {s.creator}</span>}
                  <br /><span className="small muted">{s.fileName ?? '(파일 이름 기록 없음)'}{s.format ? ` · ${s.format.toUpperCase()}` : ''}{s.importedAt ? ` · ${new Date(s.importedAt).toLocaleDateString()}` : ''} · 지문 {s.hash.slice(0, 10)}…
                  {' · '}{s.via === 'world' ? '이 카드로 세계 전체를 만듦' : `인물 ${s.ids?.characters.length ?? 0} · 지식 ${s.ids?.claims.length ?? 0} · 이미지 ${s.ids?.assets.length ?? 0}`}</span></span>
                {s.via === 'import' && (
                  <button type="button" className="small" onClick={() => {
                    if (!confirm(`"${s.name}"에서 온 인물 ${s.ids?.characters.length ?? 0}명·지식 ${s.ids?.claims.length ?? 0}개·이미지 ${s.ids?.assets.length ?? 0}장을 이 세계에서 뺄까요? 이 인물을 쓰는 임무·장면 자리는 비워집니다. 저장해야 확정됩니다.`)) return;
                    try {
                      const r = removeSource(w, s.hash);
                      setW(r.world);
                      setPruneOnSave((p) => [...p, ...(s.ids?.assets ?? [])]);
                      setStatus(`"${s.name}"을(를) 뺐습니다 — 인물 ${r.removed.characters} · 지식 ${r.removed.claims} · 믿음 ${r.removed.beliefs} · 이미지 ${r.removed.assets}.${r.unlocked ? ' 남은 출처 카드가 없어 개인용 잠금을 풀었습니다.' : ''} 저장해야 확정되고, 이미지 파일도 그때 지워집니다.`);
                    } catch (e) { setStatus(`❌ ${(e as Error).message}`); }
                  }}>이 카드 빼기</button>
                )}
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      {/* 점검 알림 (v0.82): 한 줄로 접고, 오류가 있으면 펼쳐 둔다 */}
      {(() => {
        const errs = issues.filter((i) => i.level === 'error').length, warns = issues.length - errs;
        const nd = imageNeeds(w).length;
        if (!issues.length && !nd) return null;
        return (
          <details className="editor-alerts" open={errs > 0}>
            <summary>{errs ? <b className="err">⛔ 오류 {errs}</b> : <span>✔ 오류 없음</span>}{warns ? <span className="warn"> · ⚠ 경고 {warns}</span> : null}{nd ? <span className="muted"> · 🖼 이미지 없는 곳 {nd}</span> : null}<span className="small muted"> — 눌러서 {errs ? '접기' : '보기'}</span></summary>
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
          </details>
        );
      })()}
      {/* 탭 묶음 (v0.82): 세계 · 인물 · 이야기 · 자료 → 그 안의 탭 (가로로 넘기기) */}
      {(() => {
        const label = (id: Tab) => TABS.find(([t]) => t === id)?.[1] ?? id;
        const count = (ids: Tab[]) => issues.filter((i) => ids.includes(tabForPath(i.path))).reduce((n, i) => n + (i.level === 'error' ? 1 : 0), 0);
        const group = TAB_GROUPS.find((g) => g.tabs.includes(tab)) ?? TAB_GROUPS[0]!;
        return (
          <nav className="editor-nav" aria-label="편집 탭">
            <div className="editor-groups" role="tablist">
              {TAB_GROUPS.map((g) => { const n = count(g.tabs); return (
                <button key={g.id} type="button" role="tab" aria-selected={g === group} className={g === group ? 'on' : ''} onClick={() => setTab(g.tabs[0]!)}>
                  {g.label}{n ? <span className="tab-badge" title={`오류 ${n}`}>{n}</span> : null}
                </button>
              ); })}
            </div>
            <div className="editor-tabs" role="tablist">
              {group.tabs.map((id) => { const n = count([id]); return (
                <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'primary' : ''} onClick={() => setTab(id)}>
                  {label(id)}{n ? <span className="tab-badge">{n}</span> : null}
                </button>
              ); })}
            </div>
          </nav>
        );
      })()}

      {tab === 'basic' && (
        <div className="form-grid">
          {w.assets?.some((a) => !a.id.startsWith('stock.') && !a.id.startsWith('user.')) || w.manifest.private
            ? <p className="small muted">패키지 ID: <code>{w.manifest.id}</code> (이미지가 연결되어 있어 바꿀 수 없습니다)</p>
            : <Text label="패키지 ID (작가.세계 형식, 소문자)" value={w.manifest.id} onChange={(id) => set({ manifest: { ...w.manifest, id } })} />}
          <Text label="이름" value={w.manifest.name} onChange={(name) => set({ manifest: { ...w.manifest, name } })} />
          <GenrePicker value={w.genre} onChange={(genre) => set({ genre })} />
          <Num label={`최대 레벨 (1~${MAX_LEVEL}, 비우면 장르 기본 ${genreOf(w.genre?.id, w.genre?.custom).levelCap})`} value={w.genre?.levelCap} onChange={(levelCap) => set({ genre: { id: w.genre?.id ?? 'high_fantasy', ...w.genre, levelCap: levelCap ? Math.max(1, Math.min(MAX_LEVEL, levelCap)) : undefined } })} />
          <Text label={`화폐 이름 (비우면 ${genreOf(w.genre?.id, w.genre?.custom).currency})`} value={w.genre?.currency} onChange={(currency) => set({ genre: { id: w.genre?.id ?? 'high_fantasy', ...w.genre, currency: currency || undefined } })} />
          <Text label="버전" value={w.manifest.version} onChange={(version) => set({ manifest: { ...w.manifest, version } })} placeholder="0.1.0" />
          <Text label="제작자" value={w.manifest.author} onChange={(author) => set({ manifest: { ...w.manifest, author } })} />
          <Text label="라이선스" value={w.manifest.license} onChange={(license) => set({ manifest: { ...w.manifest, license } })} placeholder="CC-BY-4.0" />
          {w.manifest.contentRating === 'mature'
            ? <p className="small">콘텐츠 등급: <b>🔞 성인</b> <span className="muted">— 한 번 정하면 바꿀 수 없습니다 (공유 불가)</span></p>
            : <Select label="콘텐츠 등급" value={w.manifest.contentRating} options={[['all', '전체'], ['teen', '청소년'], ['mature', '성인 (공유 불가 · 이후 변경 불가)']] as const}
                onChange={(contentRating) => { if (contentRating !== 'mature' || (confirmAdult() && confirm('성인 등급은 한 번 정하면 다시 바꿀 수 없습니다. 이 세계를 성인 등급으로 정할까요?'))) set({ manifest: { ...w.manifest, contentRating } }); }} />}
          <Select label="시작 장소" value={w.start.locationId} options={locOptions} onChange={(locationId) => set({ start: { ...w.start, locationId } })} />
          <Area label="첫 장면 (플레이어가 깨어났을 때)" value={w.start.openingScene} onChange={(openingScene) => set({ start: { ...w.start, openingScene } })} />
          <TimeFieldset w={w} set={set} />
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
          <Area label="세계 개요 — 플레이어도 아는 배경·분위기·규칙 (모든 AI가 참고하고, 수첩 맨 위 '세계 소개'에 보인다 · 2500자까지)" value={w.overview} rows={6} onChange={(overview) => set({ overview: overview || undefined })} />
          <Area label="GM 메모 — 숨은 설정·연출 지침 (Director만 참고하고 플레이어에게 직접 말하지 않는다 · 2500자까지)" value={w.gmNotes} rows={4} onChange={(gmNotes) => set({ gmNotes: gmNotes || undefined })} />
          <GmStylePicker w={w} onChange={(gmStyle) => set({ gmStyle })} />
          <Area label="서술 문체 참고 (선택, 1500자까지)" value={w.style} rows={4} onChange={(style) => set({ style: style || undefined })} />
          <StructField w={w} spec={{ list: SPEC.starts }} label="시작 방식 선택지 (선택: [{ id, name, description, locationId, openingScene, knows }])" value={w.starts ?? []} rows={8} onChange={(starts) => set({ starts: starts.length ? starts : undefined })} />
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
              <StructField w={w} spec={{ list: SPEC.discoveries }} label="발견할 수 있는 것" value={l.discoveries ?? []} onChange={(discoveries) => up({ discoveries })} rows={6}
                help='[{ "claim": "claim/...", "check": "investigation", "hint": "Director용 힌트" }]' />
            </div>
          )} />
      )}

      {tab === 'characters' && (
        <div className="tool-row">
          <button type="button" className={`small${importing ? ' on' : ''}`} onClick={() => setImporting((v) => !v)}>⇩ 캐릭터 카드</button>
          <button type="button" className={`small${packUi === 'import' ? ' on' : ''}`} onClick={() => setPackUi((v) => (v === 'import' ? null : 'import'))} title="인물·규칙 패키지 (.chp·.rule) 넣기">⇩ 패키지 넣기</button>
          <button type="button" className={`small${packUi === 'character' ? ' on' : ''}`} onClick={() => setPackUi((v) => (v === 'character' ? null : 'character'))} title="인물 패키지 (.chp) 내보내기">⇧ 인물 패키지</button>
        </div>
      )}
      {(tab === 'characters' || tab === 'items') && packUi === 'import' && (
        <PackImport w={w} onClose={() => setPackUi(null)} onApply={(nw, notes) => { setW(nw); setPackUi(null); setStatus(`패키지를 넣었습니다. ${notes.join(' ')} 검토 후 저장하세요.`); }} />
      )}
      {tab === 'characters' && packUi === 'character' && <PackExport w={w} kind="character" onClose={() => setPackUi(null)} />}
      {tab === 'items' && packUi === 'rules' && <PackExport w={w} kind="rules" onClose={() => setPackUi(null)} />}
      {tab === 'characters' && importing && (
        <CardImportDialog world={w} settings={settings} initialFile={initialCard} onClose={() => setImporting(false)} onAdd={async (r, progress) => {
          // 카드 이미지 (v0.52): 이 세계의 이미지로 저장한다 — 진행률은 가져오기 창의 추가 버튼 위에 (v0.61)
          let stored = 0;
          if (r.images?.length) {
            progress(`이미지 저장 중… 0/${r.images.length.toLocaleString()}`);
            const res = await storeAssets(w.manifest.id, r.images, (d, t) => progress(`이미지 저장 중… ${d.toLocaleString()}/${t.toLocaleString()}`));
            stored = res.stored;
          }
          const newAssets = (r.assets ?? []).filter((a) => !(w.assets ?? []).some((x) => x.id === a.id));
          // 카드로 새로 만드는 세계라면 이름도 카드에서 가져온다
          const named = initialCard && w.manifest.name === '새 세계' && r.cardName ? { ...w.manifest, name: r.cardName } : w.manifest;
          // 다른 사람의 카드로 만든 인물이 들어간 세계는 개인용이 된다 (내보내기 불가)
          // 출처 카드 기록 (v0.53): 이 카드에서 온 인물·지식·이미지 — 나중에 이 카드만 뺄 수 있다
          const recorded = r.source ? addSource({ ...w, manifest: named }, { ...r.source, importedAt: new Date().toISOString(), via: 'import',
            ids: { characters: r.characters.map((c) => c.id), facts: r.facts.map((f) => f.id), claims: r.claims.map((c) => c.id), assets: newAssets.map((a) => a.id) } }).manifest : named;
          const names = sourcesOf({ ...w, manifest: recorded }).map((s) => s.name);
          const manifest = { ...recorded, private: { ...(named.private ?? { note: PRIVATE_NOTE }), source: names.join(' · ') || (r.cardName ?? '캐릭터 카드'), ...(named.private?.cardHash ? {} : r.source ? { cardHash: r.source.hash } : {}) } };
          set({ manifest, characters: [...w.characters, ...r.characters], facts: [...w.facts, ...r.facts], claims: [...w.claims, ...r.claims], beliefs: [...w.beliefs, ...r.beliefs], ...(newAssets.length ? { assets: [...(w.assets ?? []), ...newAssets] } : {}) });
          setImporting(false);
          const imgNote = stored ? ` · 이미지 ${stored.toLocaleString()}장 (인물에 붙은 것 ${newAssets.filter((a) => a.characterId).length}장)` : '';
          setStatus(r.characters.length === 1
            ? `${josa(r.characters[0]!.name, '을/를')} 추가했습니다 — 지식 ${r.claims.length}개${imgNote}. 인물 목록 맨 아래에서 확인하세요. 저장을 눌러야 반영됩니다.`
            : `인물 ${r.characters.length}명과 지식 ${r.claims.length}개를 추가했습니다${imgNote}. 인물 목록 맨 아래에서 확인하세요. 저장을 눌러야 반영됩니다.`);
        }} />
      )}
      {tab === 'characters' && (
        <ItemList<Character> title="인물" items={w.characters} onChange={(characters) => set({ characters })}
          make={(n) => ({ id: `npc/new-${n}`, name: '새 인물', appearance: '', personality: '', speech: '', locationId: w.start.locationId, improvisation: 'minor' })}
          render={(c, up) => (
            <div className="form-grid">
              <Text label="ID" value={c.id} onChange={(id) => up({ id })} />
              <Text label="이름" value={c.name} onChange={(name) => up({ name })} />
              <Text label={`이름을 모를 때 부르는 말 (비우면: "${epithetOf({ ...c, alias: undefined })}")`} value={c.alias ?? ''} onChange={(alias) => up({ alias: alias.trim() ? alias : undefined })} />
              <Area label="외형" value={c.appearance} onChange={(appearance) => up({ appearance })} rows={2} />
              <Area label="성격" value={c.personality} onChange={(personality) => up({ personality })} rows={2} />
              <Area label="말투" value={c.speech} onChange={(speech) => up({ speech })} rows={2} />
              <Select label="성별" value={c.gender ?? ''} options={[['', '정하지 않음'], ['F', '여성'], ['M', '남성']] as const} onChange={(g) => up({ gender: g || undefined })} />
              <NpcStatsEditor c={c} w={w} onChange={(stats) => up({ stats })} />
              <Area label="배경 (이 인물만 아는 과거)" value={c.background} onChange={(background) => up({ background: background || undefined })} rows={3} />
              <Area label="첫 만남의 말 (참고)" value={c.greeting} onChange={(greeting) => up({ greeting: greeting || undefined })} rows={2} />
              <PortraitPicker c={c} w={w} onChange={(portrait) => up({ portrait })} />
              {c.source && <p className="muted small">출처: {c.source.format.toUpperCase()} "{c.source.name}"{c.source.creator && ` · 제작 ${c.source.creator}`} · 가져온 날 {c.source.importedAt.slice(0, 10)}</p>}
              <Select label="있는 곳" value={c.locationId} options={locOptions} onChange={(locationId) => up({ locationId })} />
              <StructField w={w} spec={{ list: SPEC.goals }} label="목표 (이 인물이 스스로 이루려는 일 — 시작하면 날 수가 지나 이뤄지고, 막는 조건이면 꺾인다)" value={c.goals ?? []} onChange={(goals) => up({ goals: Array.isArray(goals) && goals.length ? goals : undefined })} rows={4}
                help='예: [{ "id": "goal/elder-ritual", "text": "제단 의식을 끝낸다", "days": 5, "start": { "day": 1 }, "stop": { "flag": "altar_broken" }, "effects": [{ "var": "var/safety", "add": -30 }, { "npcRelation": "npc/elder", "with": "npc/ilse", "kind": "enemy" }], "announce": "밤새 제단 쪽에서 붉은 빛이 번졌다.", "stopped": "장로의 의식이 무너졌다는 소문이 돈다." }] · 조건 { "npcGoal": "goal/…", "is": "done" }' />
              <StructField w={w} spec={{ list: SPEC.schedule }} label="일정 (시각에 따라 있는 곳 — 비우면 늘 위의 장소)" value={c.schedule ?? []} onChange={(schedule) => up({ schedule: Array.isArray(schedule) && schedule.length ? schedule : undefined })} rows={3}
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
                  {(() => {
                    // 이 세계의 직업 목록 (직업 탭에서 추가한 것 포함) + 목록에 없는 규칙 직업 (v0.57.1)
                    const wcs = classesFor(w);
                    const byRole = c.companion.role ? wcs.find((k) => k.id === c.companion!.role) : undefined;
                    // 직업을 정하지 않은 동료는 같은 규칙 직업의 첫 세계 직업으로 보인다 (플레이 화면과 같게)
                    const shownAs = byRole ?? wcs.find((k) => k.base === c.companion!.classId);
                    const cur = shownAs ? `role:${shownAs.id}` : `base:${c.companion.classId}`;
                    const opts = [
                      ...wcs.map((k) => [`role:${k.id}`, k.name === CLASSES[k.base]?.name ? k.name : `${k.name} (규칙: ${CLASSES[k.base]?.name ?? k.base})`] as const),
                      ...Object.values(CLASSES).filter((x) => cur === `base:${x.id}` || !wcs.some((k) => k.base === x.id)).map((x) => [`base:${x.id}`, `${x.name} (규칙 직업 그대로)`] as const),
                    ];
                    return <Select label="직업 (직업 탭의 목록)" value={cur} options={opts} onChange={(v) => {
                      const [kind, id] = v.split(':') as ['role' | 'base', string];
                      const wc = kind === 'role' ? wcs.find((k) => k.id === id) : undefined;
                      const { role: _drop, ...rest } = c.companion!;
                      up({ companion: wc ? { ...rest, classId: wc.base, role: wc.id } : { ...rest, classId: id } });
                    }} />;
                  })()}
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

      {tab === 'rules' && (
        <>
          <p className="muted small">
            이 세계의 인과 법칙입니다. <b>행동 규칙</b>은 플레이어의 행동·말이 묘사에 해당하거나 낱말이 들어 있으면 발동하고, <b>상태 규칙</b>은 조건(플래그·세계 수치·성향·관계·임무 결과…)이 참이 되는 순간 발동합니다.
            결과(효과)는 엔진이 확정해 임무·결말·장면·조우 조건으로 이어지고, 인물 반응은 NPC 연기와 서술에 들어갑니다. 효과로 세운 플래그·수치가 다른 규칙을 깨우면 연쇄 반응이 됩니다 (한 번에 4단계까지).
          </p>
          <div className="row">
            <input value={ruleRequest} placeholder="(선택) 예: 신전의 금기, 의심" disabled={ruleGen.busy} onChange={(e) => setRuleRequest(e.target.value)} />
            <button type="button" disabled={!settings || ruleGen.busy} onClick={() => void genRules()}>{ruleGen.busy ? '만드는 중…' : '✦ AI로 규칙 만들기'}</button>
          </div>
          {!settings && <p className="small muted">AI 설정을 하면 세계에 어울리는 규칙을 AI로 만들 수 있습니다.</p>}
          <GenProgress stage={ruleGen.stage} pct={ruleGen.pct} onCancel={ruleGen.cancel} steps={['세계 요약 보내기', 'AI가 규칙 쓰기', '정리·검사']} />
          <RuleForms w={w} set={set} />
        </>
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
                <StructField w={w} spec={{ list: SPEC.factionActions }} label="세력 행동 (며칠마다 일어나는 일 — 시간이 흐르면 세계가 움직인다)" value={f.actions ?? []} onChange={(actions) => up({ actions: Array.isArray(actions) && actions.length ? actions : undefined })} rows={6}
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
          <StructField w={w} spec={{ list: SPEC.relationBeats }} label="관계 사건 (조건이 맞으면 열리는 인물의 결정적 장면)" value={w.relationBeats ?? []} onChange={(relationBeats) => set({ relationBeats })} rows={10}
            help={`"scene": "scene/…" 을 넣으면 사건이 열려 있을 때 GM이 그 장면을 연다 · 예: { "id": "beat/…", "npcId": "npc/…", "name": "비밀 고백", "condition": { "stage": "npc/…", "in": ["친구", "절친", "연인"] }, "hint": "그가 과거를 털어놓는다", "resolveFlag": "…" } · 단계: ${STAGES.join(', ')} · resolveFlag는 임무 탭의 플래그에 선언해야 한다 (없으면 4턴 뒤 닫힘) · 그 인물이 다른 곳에 있으면 "approach": "visit"(기본 — 찾아온다) / "message"(전갈, "message": "…") / "none"(기다린다)`} />
          <StructField w={w} spec={{ list: SPEC.titles }} label="이 세계만의 칭호 (조건을 채우면 엔진이 준다 — 명성이 오르고 NPC가 소문으로 안다)" value={w.titles ?? []} onChange={(titles) => set({ titles: Array.isArray(titles) && titles.length ? titles : undefined })} rows={5}
            help='예: [{ "id": "title/mist-hero", "name": "안개 골짜기의 영웅", "desc": "마을을 구했다", "renown": 15, "condition": { "flag": "village_saved" } }] · 기본 칭호(첫 승리·해결사·좋은 벗·이야기의 주인공 등)는 엔진이 알아서 준다' />
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

      {tab === 'classes' && <ClassEditor world={w} onChange={(classes) => set({ classes })} />}
      {tab === 'player' && <ProfileEditor world={w} onChange={(playerProfile) => set({ playerProfile })} onTraits={(traits) => set({ traits })} />}
      {tab === 'scenes' && (
        <>
          <p className="muted small">
            <b>장면</b>은 전투처럼 차례와 판정으로 진행하는 비전투 상호작용입니다 — 협상·추격·의식·제작·심문·비무·데이트·경매 등. <b>수치·상태·단계·행동·끝을 직접 이름 붙여</b> 만듭니다.
            행동은 d20 + 기술 판정(엔진)으로 성공·실패를 가리고 수치를 바꿉니다. 상대의 성향(likes·dislikes 꼬리표)은 판정 이점·불리가 됩니다. 끝에 닿으면 이야기 효과·보상이 일어나고, 조건 <code>{'{ "sceneEnd": "scene/…", "outcome": "success" }'}</code>로 이어지는 임무를 열 수 있습니다.
            상대 인물이 그 자리에 있고 시작 조건이 맞으면 플레이 화면에 🎭 버튼이 뜹니다 (auto면 저절로 시작). 서술 수위는 세계의 콘텐츠 등급을 따릅니다.
          </p>
          <div className="row"><b>보기:</b>
            <button type="button" className={sceneView === 'form' ? 'primary' : ''} onClick={() => setSceneView('form')}>폼</button>
            <button type="button" className={sceneView === 'json' ? 'primary' : ''} onClick={() => setSceneView('json')}>JSON</button>
          </div>
          <div className="row">
            <input value={sceneRequest} placeholder="(선택) 원하는 장면 — 예: 라이벌과의 비무, 상인과의 흥정" disabled={sceneGen.busy} onChange={(e) => setSceneRequest(e.target.value)} />
            <button type="button" disabled={!settings || sceneGen.busy} onClick={genScenes}>{sceneGen.busy ? '만드는 중…' : '✦ AI로 장면 추가'}</button>
          </div>
          <GenProgress stage={sceneGen.stage} pct={sceneGen.pct} onCancel={sceneGen.cancel} steps={['장면 요청 보내기', 'AI가 장면 쓰기', '정리·검사']} />
          {sceneView === 'form' ? <SceneForms w={w} set={set} /> : <JsonField label="장면" value={w.scenes ?? []} onChange={(scenes) => set({ scenes: Array.isArray(scenes) && scenes.length ? scenes : undefined })} rows={20}
            help={`예: { "id": "scene/haggle", "name": "값 흥정", "description": "상인과 값을 두고 흥정한다 (GM용)", "npcId": "npc/…", "start": { "all": [] }, "gauges": [{ "id": "patience", "name": "인내심", "start": 5, "min": 0, "max": 5 }, { "id": "deal", "name": "합의", "start": 0, "max": 10 }], "states": [{ "id": "warm", "name": "호의", "edge": 1 }], "phases": [{ "id": "talk", "name": "탐색" }, { "id": "close", "name": "담판" }], "likes": ["칭찬"], "dislikes": ["위협"], "actions": [{ "id": "praise", "name": "물건 칭찬", "check": "skill:persuasion", "dc": 12, "tags": ["칭찬"], "success": { "gauges": { "deal": 3 }, "addStates": ["warm"] }, "failure": { "gauges": { "patience": -1 } } }, { "id": "final", "name": "마지막 제안", "phases": ["close"], "check": "skill:insight", "dc": 14, "success": { "gauges": { "deal": 5 } }, "failure": { "gauges": { "patience": -2 } } }], "ends": [{ "id": "deal", "name": "거래 성사", "when": { "gauge": "deal", "gte": 10 }, "outcome": "success", "effects": [{ "setFlag": "…" }], "rewards": { "money": 20 } }, { "id": "walk", "name": "결렬", "when": { "gauge": "patience", "lte": 0 }, "outcome": "failure" }], "maxRounds": 8, "timeoutEnd": "walk" } · 판정: skill:${SKILL_IDS.join('/')} 또는 ability:str/dex/con/int/wis/cha · 장면 조건: gauge(gte·lte)·state·phase·round·all·any · 수치 기본 범위 0~100`} />}
        </>
      )}
      {tab === 'encounters' && (
        <>
          <h4>이 세계만의 적 (기본 적에 더한다 — 규칙 패키지로 주고받을 수 있다)</h4>
          <div className="row"><b>보기:</b>
            <button type="button" className={questView === 'form' ? 'primary' : ''} onClick={() => setQuestView('form')}>폼</button>
            <button type="button" className={questView === 'json' ? 'primary' : ''} onClick={() => setQuestView('json')}>JSON</button>
          </div>
          {questView === 'form' ? <MonsterForms w={w} set={set} /> : (
        <JsonField label="이 세계만의 적 (기본 적에 더한다 — 규칙 패키지로 주고받을 수 있다)" value={w.monsters ?? []} onChange={(monsters) => set({ monsters: Array.isArray(monsters) && monsters.length ? monsters : undefined })} rows={14}
          help='예: { "id": "mon/sand-wraith", "name": "모래 망령", "look": "모래바람 속의 일그러진 형체", "role": "controller", "cr": "2", "xp": 450, "ac": 13, "hp": 40, "abilities": { "str": 10, "dex": 15, "con": 14, "int": 8, "wis": 12, "cha": 14 }, "immune": ["poisoned"], "fleeAt": 0, "attacks": [{ "name": "모래 손톱", "kind": "melee", "toHit": 5, "damage": "2d6", "bonus": 3, "type": "참격", "count": 2, "inflict": { "condition": "blinded", "save": "con", "dc": 12, "rounds": 1 } }], "specials": [{ "name": "모래 폭풍", "kind": "area", "save": "dex", "dc": 13, "damage": "3d6", "type": "참격", "range": 1, "uses": 1 }], "phases": [{ "below": 0.5, "line": "망령이 울부짖는다!", "ac": 1, "attacks": [{ "name": "흡혼", "kind": "melee", "toHit": 6, "damage": "3d8", "bonus": 2, "type": "사령" }] }] } · 역할: minion·brute·skirmisher·artillery·controller·leader·boss · 경험치는 SRD 도전 지수 기준(1/4=50, 1/2=100, 1=200, 2=450, 3=700, 5=1800)' />
          )}
        </>
      )}
      {tab === 'encounters' && settings && (
        <>
          <div className="row"><span className="small muted">조우 {(w.encounters ?? []).length}개</span><span className="spacer" />
            <button type="button" disabled={scenarioGen.busy} onClick={() => void aiScenario('encounters')}>{scenarioGen.busy ? '만드는 중…' : '✦ AI로 조우 만들기'}</button></div>
          <GenProgress stage={scenarioGen.stage} pct={scenarioGen.pct} onCancel={scenarioGen.cancel} steps={['세계 요약 보내기', 'AI가 조우 쓰기', '정리·검사']} />
        </>
      )}
      {tab === 'encounters' && questView === 'form' && (<><h4>조우</h4><EncounterForms w={w} set={set} /></>)}
      {tab === 'encounters' && questView !== 'form' && (
        <JsonField label="조우" value={w.encounters ?? []} onChange={(encounters) => set({ encounters })} rows={18}
          help={`이 세계의 적: ${monstersOfWorld(w).map((m) => `${m.id}(${m.name}·${m.xp}XP)`).join(', ')} · zone 2=적 전열, 3=적 후열 · trigger는 Director에게만 보이는 발동 조건 · when(엔진 조건)·force(바로 시작)·intro·onVictory/onDefeat/onFlee(효과)·retry(진 뒤 쉬는 턴 수, 기본 3 · "gone")`} />
      )}
      {tab === 'encounters' && (
        (w.randomEvents === undefined
          ? <div className="struct-field"><div className="struct-head"><span className="struct-label">돌발 사건 표 (이동·휴식 때 엔진이 굴린다)</span></div>
              <p className="small muted">지금은 기본 표를 씁니다: 기습 · 뜻밖의 발견 · 길손 · 수군거림.</p>
              <div className="row"><button type="button" className="small" onClick={() => set({ randomEvents: [] })}>이 세계만의 표를 직접 정하기</button></div></div>
          : <>
              <StructField w={w} spec={{ list: SPEC.randomEvents }} label="돌발 사건 표 (이동·휴식 때 엔진이 굴린다 — 목록이 비어 있으면 돌발 사건이 일어나지 않는다)" value={w.randomEvents} rows={6}
                onChange={(randomEvents) => set({ randomEvents: Array.isArray(randomEvents) ? randomEvents : undefined })} />
              <div className="row"><button type="button" className="small" onClick={() => { if (!w.randomEvents?.length || confirm('직접 정한 돌발 사건을 지우고 기본 표로 되돌릴까요?')) set({ randomEvents: undefined }); }}>기본 표로 되돌리기</button></div>
            </>)
      )}
      {tab === 'encounters' && (w.encounters ?? []).length > 0 && (
        <ul className="small">
          {(w.encounters ?? []).map((e) => { const d = encounterDifficulty(e.enemies.map((x) => x.monsterId), [1, 1], monsterTable(w)); const d3 = encounterDifficulty(e.enemies.map((x) => x.monsterId), [3, 3], monsterTable(w));
            return <li key={e.id}><b>{e.name}</b> — 적 경험치 {d.xp} · 1레벨 2인: <b>{DIFFICULTY_LABEL[d.difficulty]}</b> · 3레벨 2인: {DIFFICULTY_LABEL[d3.difficulty]} <button type="button" className="small" onClick={() => openLab('encounter', e.id)} title="상태 시험대에서 자동 전투로 승률을 본다">🧪 전투 시험</button></li>; })}
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
              <input value={genRequest} placeholder="(선택) 원하는 이야기 방향 — 예: 배신하는 동료가 있는 메인 임무" disabled={scenarioGen.busy} onChange={(e) => setGenRequest(e.target.value)} />
              <button type="button" disabled={scenarioGen.busy} onClick={() => void aiScenario()}>{scenarioGen.busy ? '만드는 중…' : '✦ AI로 임무·조우·결말 추가'}</button>
              <button type="button" disabled={scenarioGen.busy} onClick={() => void aiScenario('encounters')}>✦ 조우만 추가</button>
            </div>
          )}
          <GenProgress stage={scenarioGen.stage} pct={scenarioGen.pct} onCancel={scenarioGen.cancel} steps={['세계 요약 보내기', 'AI가 임무·조우·결말 쓰기', '정리·검사']} />
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
          <h4>의뢰판</h4>
          {questView === 'form' ? <BoardForms w={w} set={set} /> : (
          <JsonField label="의뢰판 (장소 ID → 의뢰판, 반복할 수 있는 의뢰)" value={Object.fromEntries(w.locations.flatMap((l) => (l.board ? [[l.id, l.board]] : [])))}
            onChange={(m: Record<string, Location['board']>) => m && typeof m === 'object' && set({ locations: w.locations.map((l) => { const { board: _b, ...rest } = l; return m[l.id] ? { ...rest, board: m[l.id] } : rest; }) })} rows={12}
            help='예: { "loc/guild": { "name": "길드 게시판", "jobs": [{ "id": "job/wolves", "name": "늑대 퇴치", "type": "hunt", "description": "…", "locationId": "loc/forest", "enemies": [{ "monsterId": "wolf", "zone": 2 }], "timeLimit": { "days": 3 } }, { "id": "job/herbs", "name": "약초 채집", "type": "gather", "description": "…", "locationId": "loc/forest", "complete": { "hasItem": "item/herb", "n": 3 }, "rewards": { "money": 30 }, "requires": { "reputation": "fac/…", "gte": 10 } }] } } · 토벌 의뢰는 받을 때마다 조우가 새로 생기고, 보상이 없으면 위협도로 돈이 정해진다' />
          )}
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
            <details className="help-fold">
              <summary className="small muted">표준 아이템 목록 ({STD_ITEMS.length}개 — 모든 세계에서 쓸 수 있음)</summary>
              <p className="muted small">{STD_ITEMS.map((i) => `${i.id}(${i.name}·${i.price ?? 0})`).join(', ')}.</p>
            </details>
            <p className="muted small">
              가격은 화폐 단위({w.genre?.currency ?? genreOf(w.genre?.id, w.genre?.custom).currency})로, 팔 때는 절반. 상점에 세력(factionId)을 달면 평판이 좋을수록 싸고 아주 나쁘면 거래를 거절한다.
              전리품은 조우 탭의 <code>{'"loot": { "money": 30, "items": [{ "itemId": "std/gem" }] }'}</code> (없으면 적 경험치에 비례한 돈). 임무 보상은 <code>{'"rewards": { "money": 50, "items": [...] }'}</code>.
            </p>
            <div className="form-grid">
              <Num label="처음 소지금 (비우면 15)" value={w.start.money} onChange={(money) => set({ start: { ...w.start, money } })} />
              <div className="row">
                <button type="button" onClick={() => setPackUi((v) => (v === 'import' ? null : 'import'))}>⇩ 패키지 넣기 (.chp·.rule)</button>
                <button type="button" onClick={() => setPackUi((v) => (v === 'rules' ? null : 'rules'))}>⇧ 규칙 패키지 내보내기</button>
              </div>
            </div>
            <StructField w={w} spec={{ list: SPEC.stacks }} label="처음 소지품 (비우면 치유 물약 1개)" value={w.start.items ?? null} onChange={(items) => set({ start: { ...w.start, items: Array.isArray(items) ? items : undefined } })} rows={3}
              help='예: [{ "itemId": "std/potion-healing", "n": 2 }, { "itemId": "std/rope" }]' />
            <h4>이 세계만의 아이템</h4>
            <div className="row"><b>보기:</b>
            <button type="button" className={questView === 'form' ? 'primary' : ''} onClick={() => setQuestView('form')}>폼</button>
            <button type="button" className={questView === 'json' ? 'primary' : ''} onClick={() => setQuestView('json')}>JSON</button>
          </div>
            {questView === 'form' ? <ItemForms w={w} set={set} /> : (
            <JsonField label="이 세계만의 아이템" value={w.items ?? []} onChange={(items) => set({ items })} rows={10}
              help='예: { "id": "item/silver-key", "name": "은 열쇠", "description": "…", "kind": "key" } · 종류: consumable(heal: "2d4+2", cures: ["poisoned"]) · weapon(card: "weapon/longsword") · armor(armor: { "base": 14, "dexMax": 2 }) · shield(acBonus: 2) · key · treasure · misc' />
            )}
            <StructField w={w} spec={{ map: SPEC.shops }} label="상점 (장소 ID → 상점)" value={byId(w.locations, (l: Location) => l.shop)} onChange={(m) => applyMap('locations', 'shop', m)} rows={8}
              help='예: { "loc/market": { "name": "잡화점", "items": ["std/potion-healing", "std/rope"], "factionId": "fac/…" } }' />
            <StructField w={w} spec={{ map: SPEC.pickups }} label="주울 수 있는 것 (장소 ID → 목록, hint는 GM에게만)" value={byId(w.locations, (l: Location) => l.pickups)} onChange={(m) => applyMap('locations', 'pickups', m)} rows={6}
              help='예: { "loc/cellar": [{ "itemId": "std/potion-healing", "hint": "선반 뒤에 먼지 쌓인 물약병" }] }' />
            <StructField w={w} spec={{ map: SPEC.gives }} label="인물이 건넬 수 있는 것 (인물 ID → 목록, 조건이 맞을 때 한 번씩)" value={byId(w.characters, (c: Character) => c.gives)} onChange={(m) => applyMap('characters', 'gives', m)} rows={6}
              help='예: { "npc/elder": [{ "itemId": "item/silver-key", "condition": { "relationship": "npc/elder", "axis": "trust", "gte": 30 } }] }' />
          </>
        );
      })()}

      {tab === 'basic' && (w.manifest.includes ?? []).length > 0 && (
        <p className="small muted">넣은 패키지: {(w.manifest.includes ?? []).map((x) => `${x.name} (${x.type === 'character' ? '인물' : '규칙'} · ${x.id}@${x.version})`).join(', ')}</p>
      )}
      {tab === 'lab' && <LabPanel w={w} focus={labFocus} />}
      {tab === 'autoplay' && <AutoPlayPanel w={w} />}
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
          <div className="row"><b>보기:</b>
            <button type="button" className={questView === 'form' ? 'primary' : ''} onClick={() => setQuestView('form')}>폼</button>
            <button type="button" className={questView === 'json' ? 'primary' : ''} onClick={() => setQuestView('json')}>JSON</button>
          </div>
          {questView === 'form' ? (
            <>
              <p className="muted small">세계가 스스로 움직이게 하는 장치들입니다. 조건은 조건 빌더로, 일어나는 일은 효과 목록으로 고릅니다.</p>
              <h4>갈래 카드 (이야기의 단위 — 조건이 맞는 카드 덱에서 다음 장면을 뽑는다)</h4>
              <p className="muted small">카드는 상황 하나와 갈림길 2~4개입니다. 갈림길마다 <b>다른 것을 건다</b>(판을 키움 · 가라앉힘 · 누구 편 · 가까워짐 · 배신 · 비밀 폭로 · 세계의 방향 · 다른 길). GM이 장면에 맞는 카드를 펼치고, 잔잔하면 엔진이 뽑습니다. 플레이어가 고른 길은 조건 「갈래 카드에서 고른 길」로 다른 카드를 엽니다.</p>
              {(() => { const drafts = questDraftCards(w); return drafts.length > 0 && (
                <div className="row"><button type="button" onClick={() => { if (confirm(`임무 단계 ${drafts.length}개를 갈래 카드 초안으로 만듭니다 (접근법이 갈림길, 성공하면 그 단계가 끝남). 만든 뒤 갈림길과 걸린 것을 다듬어 주세요.`)) set({ storylets: [...(w.storylets ?? []), ...drafts] }); }}>임무에서 카드 초안 만들기 ({drafts.length}장)</button></div>
              ); })()}
              <StructField w={w} spec={{ list: SPEC.storylets }} label="갈래 카드" value={w.storylets ?? []} rows={10} onChange={(storylets) => set({ storylets: Array.isArray(storylets) && storylets.length ? storylets : undefined })}
                help='예: { "id": "card/ambush", "title": "매복", "situation": "…", "phases": ["phase/stir"], "options": [{ "id": "a", "label": "정면으로", "stake": "escalate", "check": { "skill": "athletics", "dc": "medium" }, "success": [...] }, { "id": "b", "label": "물러선다", "stake": "defuse" }] }' />
              <h4>줄기 (1부·2부… 시작 조건으로 열리고, 장마다 목표·완료·실패)</h4><ArcForms w={w} set={set} />
              <h4>결정적 선택 (조건이 맞으면 플레이어 화면에 고정 선택지)</h4><ChoiceForms w={w} set={set} />
              <h4>진행 시계 (시간·사건으로 차오르고, 정해진 칸에서 일이 벌어진다)</h4><ClockForms w={w} set={set} />
              <h4>연표 사건 (날짜·날 수·조건에 일어나고, 막을 수 있다)</h4><EventForms w={w} set={set} />
              <h4>국면 (세계의 공기 — 바뀌면 문체·음악·화면 색·인물 태도·닫힌 장소가 함께 바뀐다)</h4>
              <p className="muted small">비워 두면 긴장(drama 0~10)으로 움직이는 기본 국면 셋(평온 · 술렁임 · 위기)을 씁니다. 긴장은 실패·전투·징조·사건으로 오르고 휴식·해결로 내립니다. 위의 국면부터 차례로 조건을 보고, 들어간 뒤 3턴은 머뭅니다.</p>
              <label className="check small"><input type="checkbox" checked={w.autoPhases !== false || !!w.phases?.length} disabled={!!w.phases?.length} onChange={(e) => set({ autoPhases: e.target.checked ? undefined : false })} /> 국면을 정하지 않으면 기본 국면을 쓴다</label>
              <StructField w={w} spec={{ list: SPEC.phases }} label="이 세계의 국면" value={w.phases ?? []} rows={8} onChange={(phases) => set({ phases: Array.isArray(phases) && phases.length ? phases : undefined })}
                help='예: { "id": "phase/rift", "name": "균열", "tone": "…", "enter": { "all": [{ "var": "drama", "gte": 4 }, { "var": "var/seal", "lte": -2 }] }, "from": ["phase/calm"], "tint": "dark" }' />
              <StructField w={w} spec={{ list: SPEC.vars }} label="세계 수치 (지역 치안·숲의 위험도 같은 숫자 — 효과로 바뀌고 조건으로 읽힌다)" value={w.vars ?? []} rows={6} onChange={(vars) => set({ vars: Array.isArray(vars) && vars.length ? vars : undefined })}
                help='예: { "id": "var/safety", "name": "마을 치안", "initial": 50, "min": 0, "max": 100, "labels": [[0, "무법"], [40, "불안"], [70, "평온"]], "visible": true }' />
            </>
          ) : (
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
          <JsonField label="갈래 카드 (상황 하나 + 갈림길 2~4개)" value={w.storylets ?? []} rows={12} onChange={(storylets) => set({ storylets: Array.isArray(storylets) && storylets.length ? storylets : undefined })}
            help='예: { "id": "card/…", "title": "…", "situation": "…", "when": { "phase": "phase/stir" }, "tags": ["main"], "options": [{ "id": "a", "label": "…", "stake": "betray:npc/…", "check": { "skill": "deception", "dc": "medium" }, "success": [{ "setFlag": "…" }], "fallout": [{ "inTurns": 2, "storylet": "card/…" }] }] } · 조건 { "storylet": "card/…", "is": "a" } · { "questStage": "quest/…", "is": 0 } · 효과 { "advanceQuest": "quest/…" } · { "openStorylet": "card/…" }' />
          <JsonField label="국면 (비우면 긴장으로 움직이는 기본 국면 셋)" value={w.phases ?? []} rows={8} onChange={(phases) => set({ phases: Array.isArray(phases) && phases.length ? phases : undefined })}
            help='예: { "id": "phase/rift", "name": "균열", "tone": "이 국면의 문체", "enter": { "var": "drama", "gte": 4 }, "from": ["phase/calm"], "announce": "…", "tint": "dark", "music": "dark", "attitudes": { "npc/…": "…" }, "closed": ["loc/…"] } · 조건 { "phase": "phase/rift" }' />
          <JsonField label="세계 수치 (지역 치안·숲의 위험도 같은 숫자 — 효과 var로 바뀌고 조건 var로 읽힌다)" value={w.vars ?? []} rows={6} onChange={(vars) => set({ vars: Array.isArray(vars) && vars.length ? vars : undefined })}
            help='예: { "id": "var/safety", "name": "마을 치안", "initial": 50, "min": 0, "max": 100, "labels": [[0, "무법"], [40, "불안"], [70, "평온"]], "visible": true } · 효과 { "var": "var/safety", "add": -10 } · 조건 { "var": "var/safety", "gte": 70 }' />
          <JsonField label="진행 시계 (시간·사건으로 차오르고, 정해진 칸에서 일이 벌어진다)" value={w.clocks ?? []} onChange={(clocks) => set({ clocks })} rows={12}
            help='예: { "id": "clock/raid", "name": "도적의 습격 준비", "segments": 6, "tick": [{ "every": "day", "by": 1 }, { "on": { "flag": "warned" }, "by": -2 }], "at": [{ "segment": 3, "omen": "플레이어에게 보이는 징조" }, { "segment": 6, "effects": [{ "setFlag": "raid" }] }] }' />
          <JsonField label="연표 사건 (날짜·날 수·조건에 일어난다. unless가 참이면 막힌다)" value={w.events ?? []} onChange={(events) => set({ events })} rows={12}
            help={`예: { "id": "event/coup", "name": "반역", "when": { "date": { "year": 429, "month": 9, "day": 21 } }, "unless": { "flag": "warned_guard" }, "effects": [{ "killNpc": "npc/…" }], "announce": "플레이어에게 보이는 소식" } · when.day = 시작 후 지난 날 수${w.calendar ? '' : ' · 날짜(date)를 쓰려면 기본 탭에서 달력을 정하세요'}`} />
            </>
          )}
        </>
      )}

      {tab === 'images' && <AssetGallery world={w} settings={settings} onChange={(assets) => set({ assets })} />}
      {tab === 'json' && !shareBlocked(w) && <JsonField label="패키지 전체 (world.json)" value={w} onChange={(v) => setW(v)} rows={30} />}
      {tab === 'json' && shareBlocked(w) && (
        <>
          <p className="muted small">
            {w.manifest.private ? '🔒 개인용' : '🔞 성인 등급'} 세계는 <b>manifest(ID·버전·등급·개인용 표시)를 뺀 나머지 전체</b>를 여기서 보고 고칠 수 있습니다.
            이름·설명은 기본 탭에서 바꿉니다. 등급·개인용 표시는 잠겨 있고, 내보내기·공유 제한은 그대로입니다.
          </p>
          <JsonField label="세계 데이터 전체 (manifest 제외)" value={lockedJson} rows={30}
            onChange={(v) => {
              const { manifest: _ignored, ...rest } = (v ?? {}) as Partial<WorldPackage>;
              const next = { ...(rest as Omit<WorldPackage, 'manifest'>), manifest: w.manifest } as WorldPackage;
              lockedRef.current = { w: next, rest: v };
              setW(next);
            }} />
        </>
      )}
    </section>
    </LabLink.Provider>
  );
}
