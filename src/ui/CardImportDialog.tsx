import { useEffect, useState } from 'react';
import type { WorldPackage } from '../engine/schema';
import { parseCardFile, type NormalizedCard } from '../importers/charx';
import { portraitDataUrl } from '../importers/portrait';
import { refineCard } from '../importers/refine';
import { cardFields, cardToEntities, defaultLoreChoices, LORE_CHOICES, type LoreChoice } from '../importers/toWorld';
import { type AnalyzedEntry, analyzeEntries, type EntryChoice, findImage, isWorldCard, worldCardToEntities } from '../importers/worldcard';
import { createLlmClient } from '../llm';
import type { LlmSettings } from '../llm/types';
import { db } from '../storage/db';

export interface ImportedEntities {
  /** 가져온 카드의 이름 (빈 세계를 카드로 만들 때 세계 이름으로) */
  cardName?: string;
  characters: import('../engine/schema').Character[];
  facts: import('../engine/schema').Fact[];
  claims: import('../engine/schema').Claim[];
  beliefs: import('../engine/schema').Belief[];
}

const ENTRY_CHOICES: [EntryChoice, string][] = [['character', '인물로'], ['world', '세계 지식으로'], ['skip', '가져오지 않음']];
const KIND_LABEL = { character: '인물', world: '설정', instruction: 'AI 지시문' } as const;

/** CHARX · 캐릭터 카드 가져오기: 읽기 → 미리보기·분류 → 인물로 추가 */
export function CardImportDialog({ world, settings, onAdd, onClose, initialFile }: {
  world: WorldPackage; settings?: LlmSettings | null; onAdd: (e: ImportedEntities) => void; onClose: () => void;
  /** 홈 화면에서 넘겨받은 카드 파일 (바로 연다) */
  initialFile?: File;
}) {
  const [analyzed, setAnalyzed] = useState<AnalyzedEntry[]>([]);
  const [choices, setChoices] = useState<EntryChoice[]>([]);
  const [multi, setMulti] = useState(false);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [card, setCard] = useState<NormalizedCard | null>(null);
  const [fields, setFields] = useState<ReturnType<typeof cardFields> | null>(null);
  const [lore, setLore] = useState<LoreChoice[]>([]);
  const [portrait, setPortrait] = useState<string | undefined>();
  const [locationId, setLocationId] = useState(world.start.locationId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => { if (initialFile) void load(initialFile); }, [initialFile]);

  async function load(file: File) {
    setError('');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const r = parseCardFile(file.name, bytes);
    if (!r.card) { setError(r.error ?? '읽을 수 없습니다.'); return; }
    setCard(r.card);
    setFields(cardFields(r.card));
    setLore(defaultLoreChoices(r.card));
    const an = analyzeEntries(r.card);
    setAnalyzed(an);
    setChoices(an.map((a) => a.choice));
    setMulti(isWorldCard(r.card, an));
    // 미리보기 썸네일은 가벼운 object URL로
    const t: Record<number, string> = {};
    an.forEach((a, i) => { const img = a.kind === 'character' ? findImage(r.card!, a) : undefined; if (img) t[i] = URL.createObjectURL(new Blob([new Uint8Array(img.bytes)], { type: img.mime })); });
    setThumbs(t);
    setPortrait(r.card.portrait ? await portraitDataUrl(r.card.portrait.bytes, r.card.portrait.mime) : undefined);
    // 원본 파일은 이 브라우저에 그대로 보존한다
    try { await db.imports.put({ id: crypto.randomUUID(), fileName: file.name, format: r.card.format, bytes, importedAt: Date.now() }); } catch { /* 저장소가 없으면 생략 */ }
  }

  async function refine() {
    if (!card || !fields || !settings) return;
    setBusy('AI가 정리하는 중…');
    try {
      const r = await refineCard(createLlmClient(settings), card, fields.name);
      setFields({ ...fields, appearance: r.appearance, personality: r.personality, speech: r.speech, background: r.background });
      setLore(r.lore);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function addMulti() {
    if (!card) return;
    setBusy('초상화 변환 중…');
    const portraits: Record<number, string> = {};
    for (const [i, a] of analyzed.entries()) {
      if (choices[i] !== 'character') continue;
      const img = findImage(card, a);
      const url = img && (await portraitDataUrl(img.bytes, img.mime));
      if (url) portraits[i] = url;
    }
    setBusy('');
    onAdd({ ...worldCardToEntities(card, world, analyzed, { choices, locationId, mature: world.manifest.contentRating === 'mature', portraits }), cardName: card.name });
  }
  const nChars = choices.filter((c) => c === 'character').length;
  const nWorld = choices.filter((c) => c === 'world').length;

  const set = (k: keyof NonNullable<typeof fields>) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFields((f) => (f ? { ...f, [k]: e.target.value } : f));

  return (
    <div className="dialog">
      <div className="row">
        <b>캐릭터 카드 가져오기</b>
        <span className="muted small">RisuAI CHARX · Character Card V3/V2/V1 (.charx · .png · .json)</span>
        <span className="spacer" />
        <button type="button" onClick={onClose}>닫기</button>
      </div>
      <p className="muted small">
        카드의 성격·말투·배경·로어북을 이 세계의 인물과 지식으로 바꿉니다. 스크립트는 실행하지 않고, 시스템 프롬프트류는 AI에게 넘기지 않습니다.
        원본 파일은 이 브라우저에 보존됩니다. 원작자의 권리와 배포 조건을 확인해 주세요.
      </p>
      <label className="file">카드 파일 선택
        <input type="file" accept=".charx,.png,.json,application/json,image/png,application/zip" onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ''; }} />
      </label>
      {error && <p className="status">❌ {error}</p>}
      {card && fields && (
        <>
          <div className="row">
            {portrait && <img className="portrait" src={portrait} alt="" />}
            <span>
              <b>{card.name}</b> <span className="muted small">{card.format.toUpperCase()}{card.creator && ` · 제작 ${card.creator}`}{card.version && ` · v${card.version}`}</span>
              {card.unsupported.length > 0 && <span className="small warn"><br />가져오지 않는 기능: {card.unsupported.join(' · ')}</span>}
            </span>
          </div>
          {card.ignoredPrompts.length > 0 && (
            <details className="small">
              <summary>사용하지 않는 프롬프트 필드 {card.ignoredPrompts.length}개 (AI에게 넘기지 않음)</summary>
              {card.ignoredPrompts.map((p) => <p key={p.field}><code>{p.field}</code>: {p.text.slice(0, 300)}</p>)}
            </details>
          )}
          {analyzed.some((a) => a.kind === 'character') && (
            <label className="check">
              <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
              세계관 카드로 가져오기 — 로어북의 인물 항목을 각각 인물로, 설정 항목을 세계 지식으로 ({analyzed.filter((a) => a.kind === 'character').length}명 발견)
            </label>
          )}
          {multi ? (
            <>
              <p className="muted small">
                {world.manifest.contentRating !== 'mature' && '이 세계의 등급이 성인이 아니므로, 노골적인 성적 묘사로 표시된 줄은 빼고 가져옵니다. '}
                가져온 인물은 모두 아래 장소에 놓입니다. 편집기에서 위치·관계·동료 설정을 고치세요.
              </p>
              <label>인물을 둘 장소
                <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {world.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
              <div className="lore-list">
                {analyzed.map((a, i) => (
                  <div key={i} className="lore-item small">
                    <select value={choices[i]} onChange={(ev) => setChoices((c) => c.map((x, j) => (j === i ? ev.target.value as EntryChoice : x)))}>
                      {ENTRY_CHOICES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                    </select>
                    <span className="row">
                      {thumbs[i] && <img className="portrait small-portrait" src={thumbs[i]} alt="" />}
                      <span className={`tag ${a.kind === 'instruction' ? '' : 'confirmed'}`}>{KIND_LABEL[a.kind]}</span>
                      <b>{a.kind === 'character' ? `${a.title ? `${a.title} ` : ''}${a.displayName}${a.gender ? (a.gender === 'M' ? ' ♂' : ' ♀') : ''}` : card.lore[a.index]!.name}</b>
                      {a.note && <span className="muted">— {a.note}</span>}
                    </span>
                  </div>
                ))}
              </div>
              <div className="row">
                <span className="spacer" />
                <button type="button" className="primary" disabled={!!busy || (!nChars && !nWorld)} onClick={addMulti}>{busy || `인물 ${nChars}명 · 세계 지식 ${nWorld}항목 추가`}</button>
              </div>
            </>
          ) : (
          <>
          {settings && <div className="row"><button type="button" disabled={!!busy} onClick={refine}>{busy || '✦ AI로 정리 (외형·성격·말투 분리, 로어 분류)'}</button></div>}
          <div className="form-grid">
            <label>이름<input value={fields.name} onChange={set('name')} /></label>
            <label>있는 곳
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                {world.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label>외형<textarea rows={2} value={fields.appearance} onChange={set('appearance')} /></label>
            <label>성격<textarea rows={3} value={fields.personality} onChange={set('personality')} /></label>
            <label>말투<textarea rows={3} value={fields.speech} onChange={set('speech')} /></label>
            <label>배경 (이 인물만 아는 과거)<textarea rows={4} value={fields.background} onChange={set('background')} /></label>
            <label>첫 만남의 말<textarea rows={2} value={fields.greeting} onChange={set('greeting')} /></label>
          </div>
          {card.lore.length > 0 && (
            <fieldset>
              <legend>로어북 {card.lore.length}개 → 지식</legend>
              <div className="lore-list">
                {card.lore.map((e, i) => (
                  <div key={i} className="lore-item small">
                    <select value={lore[i]} onChange={(ev) => setLore((l) => l.map((x, j) => (j === i ? ev.target.value as LoreChoice : x)))}>
                      {LORE_CHOICES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                    </select>
                    <span><b>{e.name || `항목 ${i + 1}`}</b>{!e.enabled && <span className="muted"> (꺼짐)</span>} — {e.content.slice(0, 140)}{e.content.length > 140 ? '…' : ''}</span>
                  </div>
                ))}
              </div>
            </fieldset>
          )}
          <div className="row">
            <span className="spacer" />
            <button type="button" className="primary" onClick={() => { const r = cardToEntities(card, world, { locationId, loreChoices: lore, improvisation: 'minor', portrait, overrides: fields }); onAdd({ characters: [r.character], facts: r.facts, claims: r.claims, beliefs: r.beliefs, cardName: card.name }); }}>
              인물로 추가
            </button>
          </div>
          </>
          )}
        </>
      )}
    </div>
  );
}
