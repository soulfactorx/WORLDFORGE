import { useMemo, useState } from 'react';
import type { AssetMeta, WorldPackage } from '../engine/schema';
import { AssetImage } from './AssetImage';
import { zoomImage } from './Lightbox';
import { assetUrl } from '../storage/assets';
import { STOCK_ART, stockDataUrl } from '../data/stockart';
import { assignStockImages, missingImages, nextStockIndex, stockAsset } from '../gm/worldgen/stock';
import { createLlmClient } from '../llm';
import type { LlmSettings } from '../llm/types';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../storage/db';
import { applyUserArt, imageNeeds, needsText, targetTag } from '../gm/worldgen/imageNeeds';
import { addUserArt, listUserArt } from '../storage/userart';
import { AssetTools } from './AssetTools';
import { AssetFilterBar } from './AssetFilterBar';
import { type AssetFilter, EMPTY_FILTER, filterAssets } from '../gm/assetFilter';

const KIND = [['character', '인물'], ['scene', '장면'], ['map', '지도'], ['cover', '표지'], ['other', '분류 안 됨 (쓰이지 않음)']] as const;
const PAGE = 60;

/** 세계관 이미지 목록: 종류·인물·장소·태그를 고친다 (이미지 파일 자체는 브라우저 저장소에 있다) */
export function AssetGallery({ world, onChange, settings }: { world: WorldPackage; onChange: (assets: AssetMeta[]) => void; settings?: LlmSettings | null }) {
  const assets = world.assets ?? [];
  const [target, setTarget] = useState(() => world.characters[0] ? `c:${world.characters[0].id}` : world.locations[0] ? `l:${world.locations[0].id}` : '');
  const [busy, setBusy] = useState('');
  const missing = missingImages(world);
  const mine = useLiveQuery(() => db.userArt.orderBy('createdAt').toArray().catch(() => []), []) ?? [];
  const targetKind = target.startsWith('c:') ? 'character' : 'scene';
  const targetChar = world.characters.find((c) => `c:${c.id}` === target);
  async function auto() {
    setBusy('고르는 중…');
    try {
      const r = await assignStockImages(world, settings ? createLlmClient(settings) : undefined);
      onChange(r.assets);
      setBusy(r.added ? `${r.added}곳에 기본 이미지를 붙였습니다${r.byAi ? ' (AI가 고름)' : ' (낱말 규칙)'}. 저장하세요.` : '이미지가 없는 인물·장소가 없습니다.');
    } catch (e) { setBusy(`❌ ${(e as Error).message}`); }
  }
  const needs = imageNeeds(world);
  async function uploadFor(need: ReturnType<typeof imageNeeds>[number], files: FileList | null) {
    if (!files?.length) return;
    setBusy('내 기본 이미지에 저장하는 중…');
    try {
      await addUserArt([...files], { kind: need.kind === 'character' ? 'character' : 'scene', ...(need.gender ? { gender: need.gender } : {}), tags: [targetTag(world.manifest.id, need.id), need.name.toLowerCase()] });
      const arts = (await listUserArt()).map(({ blob: _b, createdAt: _c, ...a }) => a);
      const r = applyUserArt(world, arts);
      onChange(r.assets);
      setBusy(`${need.name}에 붙였습니다 (내 기본 이미지에도 저장). 저장하세요.`);
    } catch (e) { setBusy(`❌ ${(e as Error).message}`); }
  }
  async function copyList() {
    const text = needsText(world, needs);
    try { await navigator.clipboard.writeText(text); setBusy('필요한 그림 목록을 복사했습니다.'); }
    catch {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      Object.assign(document.createElement('a'), { href: url, download: `${world.manifest.name}-필요한-그림.txt` }).click();
      URL.revokeObjectURL(url);
    }
  }
  async function applyMine() {
    const arts = (await listUserArt()).map(({ blob: _b, createdAt: _c, ...a }) => a);
    const r = applyUserArt(world, arts);
    onChange(r.assets);
    setBusy(r.applied.length ? `내 이미지 ${r.applied.length}개를 붙였습니다: ${r.applied.slice(0, 6).map((a) => a.target).join(', ')}${r.applied.length > 6 ? ' …' : ''}. 저장하세요.` : '새로 맞는 내 이미지가 없습니다 (파일 이름·태그를 확인하세요).');
  }
  function addStock(artId: string) {
    const u = mine.find((a) => `u:${a.id}` === artId);
    const art = u ? { id: artId, kind: u.kind, label: `내 이미지: ${u.label}`, tags: u.tags, ...(u.gender ? { gender: u.gender } : {}) } : STOCK_ART.find((a) => a.id === artId)!;
    const t = target.slice(2);
    onChange([...assets, stockAsset(art, nextStockIndex(assets), target.startsWith('c:') ? { characterId: t } : { locationId: t })]);
  }
  const [filter, setFilter0] = useState<AssetFilter>(EMPTY_FILTER);
  const [page, setPage] = useState(0);
  const setFilter = (f: AssetFilter) => { setFilter0(f); setPage(0); };
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const list = useMemo(() => filterAssets(world, assets, filter, selected), [world, assets, filter, selected]);
  const shown = list.slice(page * PAGE, (page + 1) * PAGE);
  const up = (id: string, patch: Partial<AssetMeta>) => onChange(assets.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const toggle = (id: string) => { const n = new Set(selected); if (n.has(id)) n.delete(id); else n.add(id); setSelected(n); };
  return (
    <div>
      <p className="muted small">
        이미지 {assets.length.toLocaleString()}장. 플레이 중에는 AI가 고른 표정·장면 태그에 맞는 이미지를 엔진이 골라 보여줍니다. 같은 태그가 여러 장이면 돌려 가며 보여줍니다.
      </p>
      <details className="needs-box" open={needs.length > 0}>
        <summary><b>🖼 부족한 이미지 {needs.length}곳</b> <span className="small muted">— 진짜 이미지 없이 앱 내장 그림이나 빈 칸으로 보이는 인물·장소</span></summary>
        <p className="small muted">
          그림을 <b>여기서 바로 올리면</b> 그 대상에 붙고 내 기본 이미지에도 저장됩니다. 또는 추천 파일 이름(예: <code>{needs[0]?.fileName ?? 'yun.png'}</code>, 표정은 <code>yun_smile.png</code>)으로
          <b> 내 기본 이미지 관리</b>에 올리면 모든 세계에 자동으로 붙습니다.
        </p>
        <div className="row">
          <button onClick={copyList} disabled={!needs.length}>📋 필요한 그림 목록 복사</button>
          <button onClick={applyMine}>내 기본 이미지에서 맞는 것 다시 붙이기</button>
        </div>
        <ul className="needs">
          {needs.map((nd) => {
            const fb = assets.find((a) => (nd.kind === 'character' ? a.characterId : a.locationId) === nd.id);
            return (
              <li key={nd.id}>
                {fb ? <AssetImage pkg={world.manifest.id} id={fb.id} alt={nd.name} className="need-thumb" zoom /> : <span className="asset-ph need-thumb" />}
                <span className="need-body">
                  <b>{nd.kind === 'character' ? '인물' : '장소'} · {nd.name}</b> <span className="small muted">{nd.status === 'stock' ? '앱 내장 그림으로 대신하는 중' : '이미지 없음'} · 추천 파일 이름 <code>{nd.fileName}</code></span>
                  {nd.describe && <span className="small muted need-desc">{nd.describe}</span>}
                </span>
                <label className="file small">⇧ 그림 올리기<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml" multiple onChange={(e) => { uploadFor(nd, e.target.files); e.target.value = ''; }} /></label>
              </li>
            );
          })}
        </ul>
      </details>
      <details className="stock-box" open={assets.length === 0 || missing.characters.length + missing.locations.length > 0}>
        <summary><b>기본 이미지</b> <span className="small muted">— 앱에 내장된 그림 {STOCK_ART.length}종. 이미지 없는 인물 {missing.characters.length}명 · 장소 {missing.locations.length}곳</span></summary>
        <div className="row">
          <button onClick={auto} disabled={busy === '고르는 중…' || missing.characters.length + missing.locations.length === 0}>✦ 이미지 없는 곳에 자동 배정{settings ? ' (AI)' : ''}</button>
          {busy && <span className="small">{busy}</span>}
        </div>
        <div className="row">
          <label>직접 붙일 대상
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {world.characters.map((c) => <option key={c.id} value={`c:${c.id}`}>인물: {c.name}{missing.characters.includes(c) ? ' (이미지 없음)' : ''}</option>)}
              {world.locations.map((l) => <option key={l.id} value={`l:${l.id}`}>장소: {l.name}{missing.locations.includes(l) ? ' (이미지 없음)' : ''}</option>)}
            </select>
          </label>
        </div>
        {mine.some((a) => a.kind === targetKind) && <p className="small"><b>내 이미지</b></p>}
        <div className="gallery stock">
          {mine.filter((a) => a.kind === targetKind && (!targetChar?.gender || !a.gender || a.gender === targetChar.gender)).map((a) => (
            <figure key={a.id} onClick={() => addStock(`u:${a.id}`)} title="눌러서 붙이기">
              <button type="button" className="fig-peek" title="붙이기 전에 원본 보기" aria-label={`${a.label} 원본 보기`}
                onClick={(e) => { e.stopPropagation(); void assetUrl(world.manifest.id, `user.${a.id}`).then((u) => u && zoomImage(u, a.label)); }}>🔍</button>
              <AssetImage pkg={world.manifest.id} id={`user.${a.id}`} alt={a.label} />
              <figcaption>{a.label}</figcaption>
            </figure>
          ))}
        </div>
        <p className="small"><b>앱 내장</b></p>
        <div className="gallery stock">
          {STOCK_ART.filter((a) => a.kind === targetKind && (!targetChar?.gender || !a.gender || a.gender === targetChar.gender)).map((a) => (
            <figure key={a.id} onClick={() => addStock(a.id)} title="눌러서 붙이기">
              <button type="button" className="fig-peek" title="붙이기 전에 원본 보기" aria-label={`${a.label} 원본 보기`}
                onClick={(e) => { e.stopPropagation(); const u = stockDataUrl(`stock.${a.id}`); if (u) zoomImage(u, a.label); }}>🔍</button>
              <img src={stockDataUrl(`stock.${a.id}`)} alt={a.label} />
              <figcaption>{a.label}</figcaption>
            </figure>
          ))}
        </div>
      </details>
      <AssetFilterBar world={world} assets={assets} value={filter} onChange={setFilter} selected={selected} found={list.length} />
      <div className="row asset-pager">
        <button disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="앞 쪽">◀</button>
        <span className="small">{page + 1} / {pages} 쪽 · {list.length}장</span>
        <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} aria-label="뒤 쪽">▶</button>
      </div>
      <AssetTools world={world} assets={assets} onChange={onChange} settings={settings} selected={selected} setSelected={setSelected} visible={list} />
      {!list.length && assets.length > 0 && <p className="small muted">이 조건에 맞는 그림이 없습니다. <button type="button" className="small" onClick={() => setFilter(EMPTY_FILTER)}>조건 지우기</button></p>}
      <div className="gallery">
        {shown.map((a) => (
          <figure key={a.id}>
            <AssetImage pkg={world.manifest.id} id={a.id} alt={a.name} zoom />
            <figcaption>
              <label className="check asset-pick"><input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} /> {a.name}</label>
              <select value={a.kind} onChange={(e) => up(a.id, { kind: e.target.value as AssetMeta['kind'] })}>
                {KIND.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {a.kind === 'character' && (
                <select value={a.characterId ?? ''} onChange={(e) => up(a.id, { characterId: e.target.value || undefined })}>
                  <option value="">(인물 없음)</option>
                  {world.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              {(a.kind === 'scene' || a.kind === 'map') && (
                <select value={a.locationId ?? ''} onChange={(e) => up(a.id, { locationId: e.target.value || undefined })}>
                  <option value="">(모든 장소)</option>
                  {world.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              )}
              <input value={a.tags.join(', ')} title="태그 (쉼표로 구분)" onChange={(e) => up(a.id, { tags: e.target.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) })} />
              {(a.id.startsWith('stock.') || a.id.startsWith('user.')) && <button type="button" className="small" onClick={() => onChange(assets.filter((x) => x.id !== a.id))}>빼기</button>}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
