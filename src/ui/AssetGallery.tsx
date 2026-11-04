import { useMemo, useState } from 'react';
import type { AssetMeta, WorldPackage } from '../engine/schema';
import { AssetImage } from './AssetImage';

const KIND = [['character', '인물'], ['scene', '장면'], ['map', '지도'], ['cover', '표지'], ['other', '분류 안 됨 (쓰이지 않음)']] as const;
const PAGE = 60;

/** 세계관 이미지 목록: 종류·인물·장소·태그를 고친다 (이미지 파일 자체는 브라우저 저장소에 있다) */
export function AssetGallery({ world, onChange }: { world: WorldPackage; onChange: (assets: AssetMeta[]) => void }) {
  const assets = world.assets ?? [];
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
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
