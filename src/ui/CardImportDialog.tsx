import { useState } from 'react';
import type { WorldPackage } from '../engine/schema';
import { parseCardFile, type NormalizedCard } from '../importers/charx';
import { portraitDataUrl } from '../importers/portrait';
import { refineCard } from '../importers/refine';
import { cardFields, cardToEntities, defaultLoreChoices, LORE_CHOICES, type LoreChoice } from '../importers/toWorld';
import { createLlmClient } from '../llm';
import type { LlmSettings } from '../llm/types';
import { db } from '../storage/db';

type Entities = ReturnType<typeof cardToEntities>;

/** CHARX · 캐릭터 카드 가져오기: 읽기 → 미리보기·분류 → 인물로 추가 */
export function CardImportDialog({ world, settings, onAdd, onClose }: {
  world: WorldPackage; settings?: LlmSettings | null; onAdd: (e: Entities) => void; onClose: () => void;
}) {
  const [card, setCard] = useState<NormalizedCard | null>(null);
  const [fields, setFields] = useState<ReturnType<typeof cardFields> | null>(null);
  const [lore, setLore] = useState<LoreChoice[]>([]);
  const [portrait, setPortrait] = useState<string | undefined>();
  const [locationId, setLocationId] = useState(world.start.locationId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  async function load(file: File) {
    setError('');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const r = parseCardFile(file.name, bytes);
    if (!r.card) { setError(r.error ?? '읽을 수 없습니다.'); return; }
    setCard(r.card);
    setFields(cardFields(r.card));
    setLore(defaultLoreChoices(r.card));
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
            <button type="button" className="primary" onClick={() => onAdd(cardToEntities(card, world, { locationId, loreChoices: lore, improvisation: 'minor', portrait, overrides: fields }))}>
              인물로 추가
            </button>
          </div>
        </>
      )}
    </div>
  );
}
