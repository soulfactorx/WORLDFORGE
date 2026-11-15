/**
 * 인물·장소 이미지 칸 (v0.127): 여러 장 붙이기(파일 · 만계서고 · 이 세계의 그림) + 상황 태그 + 시험해 보기.
 */
import { useMemo, useState } from 'react';
import type { AssetMeta, WorldPackage } from '../engine/schema';
import { attachImages, detachImage, type ImageTarget, imagesOf, newImageIds, presetsFor, previewPick, tagLabel, tagSummary, toggleTag, uploadedMeta } from '../gm/entityImages';
import { portraitFromBlob } from '../importers/portrait';
import { assetUrl, storeAssets } from '../storage/assets';
import { AssetImage } from './AssetImage';
import { ImageSearchGrid } from './ImagePicker';
import { LibraryImages } from './LibraryImages';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

export function EntityImages({ w, target, onChange, onPortrait }: {
  w: WorldPackage; target: ImageTarget;
  onChange: (assets: AssetMeta[]) => void;
  /** 인물만: 이 그림을 초상화로 */
  onPortrait?: (dataUrl: string) => void;
}) {
  const assets = w.assets ?? [];
  const list = imagesOf(assets, target);
  const [open, setOpen] = useState<'' | 'world' | 'library'>('');
  const [busy, setBusy] = useState('');
  const [tryTag, setTryTag] = useState('');
  const [salt, setSalt] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const word = target.kind === 'character' ? '인물' : '장소';
  const gender = target.kind === 'character' ? w.characters.find((c) => c.id === target.id)?.gender : undefined;

  async function addFiles(files: File[]) {
    if (!files.length) return;
    setBusy(`그림 저장 중… 0/${files.length}`);
    try {
      const ids = newImageIds(assets, files.length);
      const r = await storeAssets(w.manifest.id, files.map((f, i) => ({ id: ids[i]!, read: async () => f })), (d, t) => setBusy(`그림 저장 중… ${d}/${t}`));
      const bad = new Set(r.failed);
      const metas = uploadedMeta(files.map((f) => ({ name: f.name, mime: f.type, size: f.size })), target, assets, ids).filter((m) => !bad.has(m.id));
      onChange([...assets, ...metas]);
      setBusy(`${metas.length}장을 넣었습니다. 그림마다 태그를 붙여 언제 보일지 정하세요. 저장을 눌러야 반영됩니다.`);
    } catch (e) { setBusy(`❌ ${(e as Error).message}`); }
  }
  async function asPortrait(id: string) {
    if (!onPortrait) return;
    try {
      const url = await assetUrl(w.manifest.id, id);
      const p = url && await portraitFromBlob(await (await fetch(url)).blob());
      if (p) { onPortrait(p); setBusy('초상화로 정했습니다.'); } else setBusy('❌ 이 그림을 읽지 못했습니다.');
    } catch (e) { setBusy(`❌ ${(e as Error).message}`); }
  }

  const summary = tagSummary(list);
  const tryPick = useMemo(() => previewPick(w, target, tryTag, `try${salt}`), [w, target.id, tryTag, salt]);
  return (
    <fieldset className="entity-images">
      <legend>🖼 이미지 — 상황마다 다른 그림 ({list.length}장)</legend>
      <p className="small muted">한 {word}에 그림을 여러 장 붙이고, 그림마다 <b>태그</b>(예: {target.kind === 'character' ? '웃음·화남·밤' : '밤·비·싸움'})를 붙이세요. 플레이 중 AI가 장면에 맞는 태그를 골라 그 그림을 보여 줍니다. 같은 태그가 여러 장이면 돌아가며, 맞는 것이 없으면 <b>기본</b> 그림이 보입니다.</p>
      {summary.length > 0 && (
        <p className="small entity-tag-sum">{summary.map(([t, n]) => <span key={t} className="tag-pill">{tagLabel(target, t)} {n}</span>)}</p>
      )}

      {list.length > 0 && (
        <ul className="entity-img-grid">
          {list.map((a) => {
            const isDefault = !a.tags.length || a.tags.includes('default');
            return (
              <li key={a.id} className={`entity-img${isDefault ? ' is-default' : ''}${editing === a.id ? ' editing' : ''}`}>
                <AssetImage pkg={w.manifest.id} id={a.id} alt={a.name} zoom />
                <span className="entity-img-name" title={a.name}>{isDefault ? '★ ' : ''}{a.name}</span>
                {gender && a.gender && a.gender !== gender && <span className="small warn-text" title="이 인물의 성별과 같은 그림이 있으면 플레이 중에는 그쪽만 쓰입니다">⚠ 성별이 달라 쓰이지 않을 수 있음</span>}
                <span className="entity-img-tags">
                  {a.tags.length ? a.tags.map((t) => <button key={t} type="button" className="tag-pill" title="눌러서 빼기" onClick={() => onChange(toggleTag(assets, a.id, t))}>{tagLabel(target, t)} ✕</button>) : <span className="small muted">태그 없음 = 기본</span>}
                </span>
                <div className="row entity-img-actions">
                  <button type="button" className={`small${editing === a.id ? ' on' : ''}`} aria-expanded={editing === a.id} onClick={() => setEditing(editing === a.id ? null : a.id)}>🏷 태그</button>
                  {onPortrait && <button type="button" className="small" onClick={() => void asPortrait(a.id)} title="편집기·수첩·목록에 보이는 작은 얼굴로">초상화로</button>}
                  <button type="button" className="small" title={a.id.startsWith('stock.') || a.id.startsWith('user.') ? '목록에서 뺍니다' : '이 세계에는 남고 「분류 안 됨」이 됩니다 (자료 › 이미지에서 다시 붙일 수 있다)'} onClick={() => onChange(detachImage(assets, a.id))}>빼기</button>
                </div>
                {editing === a.id && (
                  <div className="entity-tag-edit">
                    <span className="small muted">이 그림을 언제 보일까 (여러 개 가능)</span>
                    <div className="entity-presets">
                      {presetsFor(target).map(([t, label]) => (
                        <button key={t} type="button" className={`tag-chip${a.tags.includes(t) ? ' on' : ''}`} aria-pressed={a.tags.includes(t)} onClick={() => onChange(toggleTag(assets, a.id, t))}>{label}</button>
                      ))}
                    </div>
                    <TagInput onAdd={(t) => onChange(toggleTag(assets, a.id, t))} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!list.length && <p className="small muted">아직 이 {word}의 그림이 없습니다. 플레이 중에는 앱의 기본 그림이 쓰일 수 있습니다.</p>}

      <div className="row entity-add">
        <label className="file">📁 파일에서 추가<input type="file" multiple accept={ACCEPT} onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; void addFiles(fs); }} /></label>
        <button type="button" className={open === 'library' ? 'on' : ''} aria-expanded={open === 'library'} onClick={() => setOpen(open === 'library' ? '' : 'library')}>🌌 만계서고에서 고르기</button>
        {assets.length > list.length && <button type="button" className={open === 'world' ? 'on' : ''} aria-expanded={open === 'world'} onClick={() => setOpen(open === 'world' ? '' : 'world')}>🔍 이 세계의 그림에서</button>}
      </div>
      <p className="small muted">파일 이름에 표정·상황 낱말(웃음·smile·밤…)이 있으면 그 태그가 저절로 붙습니다.</p>
      {busy && <p className="small status">{busy}</p>}
      {open === 'world' && (
        <ImageSearchGrid w={{ ...w, assets: assets.filter((a) => !list.includes(a)) }} fx={false} onPick={(id) => { onChange(attachImages(assets, [id], target)); setBusy('붙였습니다. 태그를 확인하세요.'); }} />
      )}
      {open === 'library' && (
        <LibraryImages target={w} kind={target.kind === 'character' ? 'character' : 'scene'} onClose={() => setOpen('')}
          onAdd={(metas) => { onChange([...assets, ...metas.map((m) => attachImages([m], [m.id], target)[0]!)]); setOpen(''); setBusy(`${metas.length}장을 넣었습니다. 태그를 확인하세요. 저장을 눌러야 반영됩니다.`); }} />
      )}

      {list.length > 1 && (
        <div className="entity-try">
          <label>🧪 시험: 플레이 중 이 태그를 원하면
            <input value={tryTag} list={`try-${target.id}`} placeholder={target.kind === 'character' ? '예: 웃음, angry, 밤' : '예: 밤, rain'} onChange={(e) => setTryTag(e.target.value)} />
            <datalist id={`try-${target.id}`}>{summary.map(([t]) => <option key={t} value={t} />)}</datalist>
          </label>
          <div className="row">
            {tryPick ? <AssetImage pkg={w.manifest.id} id={tryPick.id} alt={tryPick.name} className="entity-try-img" zoom /> : <span className="small muted">보일 그림 없음</span>}
            <span className="small">{tryPick ? <>→ <b>{tryPick.name}</b>{(() => {
              const want = tryTag.trim().toLowerCase();
              if (!want) return ' (태그를 고르지 않으면 기본 그림)';
              if (tryPick.tags.includes(want)) return ` (「${want}」 태그)`;
              const same = tryPick.tags.find((t) => t !== 'default');
              return same && !tryPick.tags.includes('default') ? ` (같은 뜻 태그 「${same}」)` : ' (맞는 태그가 없어 기본 그림)';
            })()}</> : ''}</span>
            <button type="button" className="small" onClick={() => setSalt((n) => n + 1)} title="같은 태그가 여러 장이면 돌아가며 보인다">다시 뽑기</button>
          </div>
        </div>
      )}
    </fieldset>
  );
}

function TagInput({ onAdd }: { onAdd: (t: string) => void }) {
  const [v, setV] = useState('');
  const add = () => { for (const t of v.split(',')) if (t.trim()) onAdd(t); setV(''); };
  return (
    <div className="row entity-tag-input">
      <input value={v} placeholder="직접 적기 (쉼표로 여러 개)" onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
      <button type="button" className="small" disabled={!v.trim()} onClick={add}>더하기</button>
    </div>
  );
}
