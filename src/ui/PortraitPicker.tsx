import { useState } from 'react';
import type { Character, WorldPackage } from '../engine/schema';
import { portraitFromBlob } from '../importers/portrait';
import { assetUrl } from '../storage/assets';
import { AssetImage } from './AssetImage';
import { ZoomImg } from './Lightbox';

const PAGE = 24;

/** 초상화 바꾸기 (v0.53.1): 파일에서 · 이 세계의 이미지에서 (이 인물의 이미지 먼저) · 지우기 */
export function PortraitPicker({ c, w, onChange }: { c: Character; w: WorldPackage; onChange: (portrait: string | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState('');
  const mine = (w.assets ?? []).filter((a) => a.characterId === c.id);
  const others = (w.assets ?? []).filter((a) => a.characterId !== c.id && a.kind !== 'map');
  const list = [...mine, ...others];
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  async function use(blob: Blob) {
    setBusy('초상화 만드는 중…');
    try { const url = await portraitFromBlob(blob); if (url) { onChange(url); setOpen(false); } else setBusy('❌ 이 이미지를 읽지 못했습니다.'); }
    finally { setBusy((b) => (b.startsWith('❌') ? b : '')); }
  }
  async function pickAsset(id: string) {
    setBusy('초상화 만드는 중…');
    try {
      const url = await assetUrl(w.manifest.id, id);
      if (!url) { setBusy('❌ 이미지 파일이 없습니다.'); return; }
      await use(await (await fetch(url)).blob());
    } catch (e) { setBusy(`❌ ${(e as Error).message}`); }
  }
  return (
    <fieldset className="portrait-pick">
      <legend>초상화 (편집기·수첩·목록에 보이는 작은 얼굴)</legend>
      <div className="row">
        {c.portrait ? <ZoomImg className="portrait" src={c.portrait} alt={c.name} /> : <span className="asset-ph portrait" aria-label="초상화 없음" />}
        <label className="file small">📁 파일에서<input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void use(f); e.target.value = ''; }} /></label>
        {list.length > 0 && <button type="button" className="small" onClick={() => { setOpen((o) => !o); setPage(0); }} aria-expanded={open}>🖼 세계 이미지에서 고르기 ({mine.length ? `이 인물 ${mine.length}장 · ` : ''}전체 {list.length}장)</button>}
        {c.portrait && <button type="button" className="small" onClick={() => onChange(undefined)}>지우기</button>}
      </div>
      {busy && <p className="small status">{busy}</p>}
      {open && (
        <>
          <div className="portrait-grid">
            {list.slice(page * PAGE, page * PAGE + PAGE).map((a) => (
              <button key={a.id} type="button" className={a.characterId === c.id ? 'mine' : undefined} title={a.name} onClick={() => pickAsset(a.id)}>
                <AssetImage pkg={w.manifest.id} id={a.id} alt={a.name} />
              </button>
            ))}
          </div>
          {pages > 1 && <div className="row"><span className="spacer" /><button type="button" className="small" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>◀</button><span className="small">{page + 1} / {pages}</span><button type="button" className="small" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>▶</button></div>}
        </>
      )}
    </fieldset>
  );
}
