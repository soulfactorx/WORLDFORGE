import { useMemo, useState } from 'react';
import { MONSTERS } from '../engine/combat/monsters';
import { CLASSES } from '../engine/character/rules';
import { hasErrors, validateWorld } from '../engine/package/validate';
import type { Belief, Character, Claim, Fact, Location, WorldPackage } from '../engine/schema';
import { blankWorld, exportWpk, PRIVATE_NOTE, savePackage } from '../storage/packages';
import { AssetGallery } from './AssetGallery';
import { fillOrphanKnowledge } from '../gm/worldgen/fromCard';
import { imageNeeds } from '../gm/worldgen/imageNeeds';
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

type Tab = 'basic' | 'locations' | 'characters' | 'knowledge' | 'encounters' | 'quests' | 'images' | 'json';
const TABS: [Tab, string][] = [
  ['basic', '기본'], ['locations', '장소'], ['characters', '인물'], ['knowledge', '지식'],
  ['encounters', '조우'], ['quests', '임무·플래그·결말'], ['images', '이미지'], ['json', 'JSON 전체'],
];
const IMPROV = [['none', '지어내기 금지'], ['minor', '작은 세부사항만'], ['free', '자유']] as const;
const STATES = [['rumor', '소문'], ['partial', '들은 이야기'], ['confirmed', '확인됨'], ['mistaken', '잘못 앎'], ['secret', '비밀']] as const;

function tabForPath(path: string): Tab {
  if (path.startsWith('manifest') || path.startsWith('start') || path.startsWith('style')) return 'basic';
  if (path.startsWith('assets')) return 'images';
  if (path.startsWith('locations')) return 'locations';
  if (path.startsWith('characters')) return 'characters';
  if (path.startsWith('facts') || path.startsWith('claims') || path.startsWith('beliefs')) return 'knowledge';
  if (path.startsWith('encounters')) return 'encounters';
  if (path.startsWith('quests') || path.startsWith('flags') || path.startsWith('endings')) return 'quests';
  return 'json';
}

// ---------------------------------------------------------------- 작은 입력 컴포넌트

const Text = ({ label, value, onChange, placeholder }: { label: string; value: string | undefined; onChange: (v: string) => void; placeholder?: string }) => (
  <label>{label}<input value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></label>
);
const Area = ({ label, value, onChange, rows = 3 }: { label: string; value: string | undefined; onChange: (v: string) => void; rows?: number }) => (
  <label>{label}<textarea rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} /></label>
);
const Num = ({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void }) => (
  <label>{label}<input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} /></label>
);
function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T | undefined; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <label>{label}
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value as T)}>
        {value === undefined && <option value="">(선택)</option>}
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

/** JSON으로 값 하나를 편집 (파싱 오류는 표시만 하고 반영하지 않는다) */
function JsonField<T>({ label, value, onChange, rows = 10, help }: { label: string; value: T; onChange: (v: T) => void; rows?: number; help?: string }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
  const [error, setError] = useState('');
  const [last, setLast] = useState(value);
  if (value !== last) { setLast(value); setText(JSON.stringify(value ?? null, null, 2)); setError(''); }
  return (
    <label>{label}
      {help && <span className="muted small">{help}</span>}
      <textarea className="code" rows={rows} value={text} spellCheck={false} onChange={(e) => {
        setText(e.target.value);
        try { const v = JSON.parse(e.target.value) as T; setError(''); setLast(v); onChange(v); } catch (er) { setError((er as Error).message); }
      }} />
      {error && <span className="small err">JSON 오류: {error}</span>}
    </label>
  );
}

/** 목록 + 선택한 항목 편집 */
function ItemList<T extends { id: string }>({ items, onChange, make, render, title }: {
  items: T[]; onChange: (items: T[]) => void; make: (n: number) => T; render: (item: T, set: (patch: Partial<T>) => void) => React.ReactNode; title: string;
}) {
  const [sel, setSel] = useState(0);
  const cur = items[sel];
  return (
    <div className="item-list">
      <div className="items">
        {items.map((it, i) => (
          <button key={i} type="button" className={i === sel ? 'primary' : ''} onClick={() => setSel(i)}>{it.id || '(ID 없음)'}</button>
        ))}
        <button type="button" onClick={() => { onChange([...items, make(items.length + 1)]); setSel(items.length); }}>＋ {title} 추가</button>
      </div>
      {cur && (
        <div className="item-form">
          {render(cur, (patch) => onChange(items.map((x, i) => (i === sel ? { ...x, ...patch } : x))))}
          <div className="row">
            <span className="spacer" />
            <button type="button" onClick={() => { if (confirm(`"${cur.id}"을(를) 삭제할까요?`)) { onChange(items.filter((_, i) => i !== sel)); setSel(Math.max(0, sel - 1)); } }}>삭제</button>
          </div>
        </div>
      )}
    </div>
  );
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
  const [tab, setTab] = useState<Tab>(initialCard ? 'characters' : 'basic');
  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState<string[] | undefined>(draftNotes);
  const [approved, setApproved] = useState(!draftNotes || !!alreadySaved);
  const [genStage, setGenStage] = useState('');
  const [genRequest, setGenRequest] = useState('');
  const [importing, setImporting] = useState(!!initialCard);

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
        {w.manifest.private ? <span className="small muted" title={PRIVATE_NOTE}>🔒 개인용 (내보내기 불가)</span> : <button onClick={exportFile}>.wpk 내보내기</button>}
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
        {TABS.filter(([id]) => !(id === 'json' && w.manifest.private)).map(([id, label]) => <button key={id} type="button" className={tab === id ? 'primary' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>

      {tab === 'basic' && (
        <div className="form-grid">
          {w.assets?.some((a) => !a.id.startsWith('stock.') && !a.id.startsWith('user.')) || w.manifest.private
            ? <p className="small muted">패키지 ID: <code>{w.manifest.id}</code> (이미지가 연결되어 있어 바꿀 수 없습니다)</p>
            : <Text label="패키지 ID (작가.세계 형식, 소문자)" value={w.manifest.id} onChange={(id) => set({ manifest: { ...w.manifest, id } })} />}
          <Text label="이름" value={w.manifest.name} onChange={(name) => set({ manifest: { ...w.manifest, name } })} />
          <Text label="버전" value={w.manifest.version} onChange={(version) => set({ manifest: { ...w.manifest, version } })} placeholder="0.1.0" />
          <Text label="제작자" value={w.manifest.author} onChange={(author) => set({ manifest: { ...w.manifest, author } })} />
          <Text label="라이선스" value={w.manifest.license} onChange={(license) => set({ manifest: { ...w.manifest, license } })} placeholder="CC-BY-4.0" />
          <Select label="콘텐츠 등급" value={w.manifest.contentRating} options={[['all', '전체'], ['teen', '청소년'], ['mature', '성인']] as const} onChange={(contentRating) => set({ manifest: { ...w.manifest, contentRating } })} />
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
        </div>
      )}
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
              <Select label="AI 즉흥 설정" value={c.improvisation} options={IMPROV} onChange={(improvisation) => up({ improvisation })} />
              <fieldset><legend>플레이어에 대한 초기 관계 (-100~100)</legend>
                <div className="ability-grid">
                  {(['affinity', 'trust', 'respect', 'fear'] as const).map((k) => (
                    <Num key={k} label={{ affinity: '호감', trust: '신뢰', respect: '존경', fear: '두려움' }[k]} value={c.relationship?.[k]}
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
        <JsonField label="조우" value={w.encounters ?? []} onChange={(encounters) => set({ encounters })} rows={18}
          help={`몬스터: ${Object.values(MONSTERS).map((m) => `${m.id}(${m.name})`).join(', ')} · zone 2=적 전열, 3=적 후열 · trigger는 Director에게만 보이는 발동 조건`} />
      )}

      {tab === 'quests' && (
        <>
          <p className="muted small">
            조건식: <code>{'{ "all": [...] }'}</code> <code>{'{ "any": [...] }'}</code> <code>{'{ "not": ... }'}</code> <code>{'{ "knows": "claim/…", "min": "partial" }'}</code>{' '}
            <code>{'{ "at": "loc/…" }'}</code> <code>{'{ "cleared": "enc/…" }'}</code> <code>{'{ "inParty": "npc/…" }'}</code>{' '}
            <code>{'{ "relationship": "npc/…", "axis": "trust", "gte": 20 }'}</code> <code>{'{ "flag": "…" }'}</code> <code>{'{ "questDone": "quest/…" }'}</code> <code>{'{ "level": 2 }'}</code>
          </p>
          {settings && (
            <div className="row">
              <input value={genRequest} placeholder="(선택) 원하는 이야기 방향 — 예: 배신하는 동료가 있는 메인 임무" onChange={(e) => setGenRequest(e.target.value)} />
              <button type="button" disabled={!!genStage} onClick={aiScenario}>{genStage || '✦ AI로 임무·조우·결말 추가'}</button>
            </div>
          )}
          <JsonField label="임무" value={w.quests ?? []} onChange={(quests) => set({ quests })} rows={16} />
          <JsonField label="이야기 플래그 (Director가 세울 수 있는 결정)" value={w.flags ?? []} onChange={(flags) => set({ flags })} rows={8} />
          <JsonField label="결말" value={w.endings ?? []} onChange={(endings) => set({ endings })} rows={8} />
        </>
      )}

      {tab === 'images' && <AssetGallery world={w} settings={settings} onChange={(assets) => set({ assets })} />}
      {tab === 'json' && !w.manifest.private && <JsonField label="패키지 전체 (world.json)" value={w} onChange={(v) => setW(v)} rows={30} />}
    </section>
  );
}
