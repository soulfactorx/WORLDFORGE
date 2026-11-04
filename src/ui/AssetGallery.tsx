import { useMemo, useState } from 'react';
import type { AssetMeta, WorldPackage } from '../engine/schema';
import { AssetImage } from './AssetImage';
import { STOCK_ART, stockDataUrl } from '../data/stockart';
import { assignStockImages, missingImages, nextStockIndex, stockAsset } from '../gm/worldgen/stock';
import { createLlmClient } from '../llm';
import type { LlmSettings } from '../llm/types';

const KIND = [['character', '인물'], ['scene', '장면'], ['map', '지도'], ['cover', '표지'], ['other', '분류 안 됨 (쓰이지 않음)']] as const;
const PAGE = 60;

/** 세계관 이미지 목록: 종류·인물·장소·태그를 고친다 (이미지 파일 자체는 브라우저 저장소에 있다) */
export function AssetGallery({ world, onChange, settings }: { world: WorldPackage; onChange: (assets: AssetMeta[]) => void; settings?: LlmSettings | null }) {
  const assets = world.assets ?? [];
  const [target, setTarget] = useState(() => world.characters[0] ? `c:${world.characters[0].id}` : world.locations[0] ? `l:${world.locations[0].id}` : '');
  const [busy, setBusy] = useState('');
  const missing = missingImages(world);
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
  function addStock(artId: string) {
    const art = STOCK_ART.find((a) => a.id === artId)!;
    const t = target.slice(2);
    onChange([...assets, stockAsset(art, nextStockIndex(assets), target.startsWith('c:') ? { characterId: t } : { locationId: t })]);
  }
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const list = useMemo(() => assets.filter((a) => filter === 'all' || a.kind === filter || a.characterId === filter || a.locationId === filter), [assets, filter]);
  const shown = list.slice(page * PAGE, (page + 1) * PAGE);
  const up = (id: string, patch: Partial<AssetMeta>) => onChange(assets.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  return (
    <div>
      <p className="muted small">
        이미지 {assets.length.toLocaleString()}장. 플레이 중에는 AI가 고른 표정·장면 태그에 맞는 이미지를 엔진이 골라 보여줍니다. 같은 태그가 여러 장이면 돌려 가며 보여줍니다.
      </p>
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
        <div className="gallery stock">
          {STOCK_ART.filter((a) => a.kind === targetKind && (!targetChar?.gender || !a.gender || a.gender === targetChar.gender)).map((a) => (
            <figure key={a.id} onClick={() => addStock(a.id)} title="눌러서 붙이기">
              <img src={stockDataUrl(`stock.${a.id}`)} alt={a.label} />
              <figcaption>{a.label}</figcaption>
            </figure>
          ))}
        </div>
      </details>
      <div className="row">
        <label>보기
          <select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(0); }}>
            <option value="all">전체</option>
            {KIND.map(([v, l]) => <option key={v} value={v}>{l} ({assets.filter((a) => a.kind === v).length})</option>)}
            {world.characters.map((c) => <option key={c.id} value={c.id}>인물: {c.name} ({assets.filter((a) => a.characterId === c.id).length})</option>)}
            {world.locations.map((l) => <option key={l.id} value={l.id}>장소: {l.name} ({assets.filter((a) => a.locationId === l.id).length})</option>)}
          </select>
        </label>
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>◀</button>
        <span className="small">{page + 1} / {pages}</span>
        <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>▶</button>
      </div>
      <div className="gallery">
        {shown.map((a) => (
          <figure key={a.id}>
            <AssetImage pkg={world.manifest.id} id={a.id} alt={a.name} />
            <figcaption>
              {a.name}
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
              {a.id.startsWith('stock.') && <button type="button" className="small" onClick={() => onChange(assets.filter((x) => x.id !== a.id))}>빼기</button>}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
