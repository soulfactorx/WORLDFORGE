/**
 * 만계서고에서 그림 고르기 (v0.127): 다른 세계의 그림 · 내 기본 이미지 · 앱 기본 이미지에서 여러 장 골라 넣는다.
 * 다른 세계의 그림은 이 세계로 파일을 복사한다 (원래 세계를 지워도 남게).
 */
import { useEffect, useMemo, useState } from 'react';
import { STOCK_ART } from '../data/stockart';
import { EXPRESSIONS } from '../engine/assets';
import type { AssetMeta, WorldPackage } from '../engine/schema';
import { newImageIds } from '../gm/entityImages';
import { nextStockIndex, stockAsset } from '../gm/worldgen/stock';
import { assetBlob, storeAssets } from '../storage/assets';
import { listPackages } from '../storage/packages';
import { listUserArt } from '../storage/userart';
import { AssetImage } from './AssetImage';
import { UserArtUpload } from './UserArtUpload';

type Src = 'world' | 'user' | 'stock';
interface Item { key: string; src: Src; from: string; pkg: string; id: string; name: string; kind: string; tags: string[]; gender?: 'M' | 'F'; sub: string; hay: string; meta?: AssetMeta }
const PAGE = 60;

export function LibraryImages({ target, kind, onAdd, onClose }: {
  target: WorldPackage; kind: 'character' | 'scene';
  /** 고른 그림 (파일 복사까지 끝난 것) */
  onAdd: (metas: AssetMeta[]) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [hidden, setHidden] = useState(0);
  const [from, setFrom] = useState('all');
  const [onlyKind, setOnlyKind] = useState(true);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [busy]);

  const [reload, setReload] = useState(0);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    void (async () => {
      const out: Item[] = [];
      let skip = 0;
      for (const p of await listPackages()) {
        const w = p.world;
        if (w.manifest.id === target.manifest.id) continue;
        // 성인 등급·개인용(남의 카드) 세계의 그림은 같은 성격의 세계에만
        if ((w.manifest.contentRating === 'mature' && target.manifest.contentRating !== 'mature') || (w.manifest.private && !target.manifest.private)) { skip += (w.assets ?? []).length; continue; }
        const who = new Map(w.characters.map((c) => [c.id, c.name])), where = new Map(w.locations.map((l) => [l.id, l.name]));
        for (const a of w.assets ?? []) {
          if (a.id.startsWith('stock.') || a.id.startsWith('user.')) continue; // 기본 이미지는 아래 출처에서
          const owner = (a.characterId && who.get(a.characterId)) || (a.locationId && where.get(a.locationId)) || '';
          out.push({ key: `${w.manifest.id}|${a.id}`, src: 'world', from: w.manifest.name, pkg: w.manifest.id, id: a.id, name: a.name, kind: a.kind, tags: a.tags, ...(a.gender ? { gender: a.gender } : {}), meta: a,
            sub: [w.manifest.name, owner, a.tags.slice(0, 3).join('·')].filter(Boolean).join(' · '), hay: [w.manifest.name, a.name, owner, ...a.tags].join(' ').toLowerCase() });
        }
      }
      for (const u of await listUserArt()) out.push({ key: `user|${u.id}`, src: 'user', from: '내 기본 이미지', pkg: target.manifest.id, id: `user.${u.id}`, name: u.label, kind: u.kind, tags: u.tags, ...(u.gender ? { gender: u.gender } : {}), sub: `내 기본 이미지${u.tags.length ? ` · ${u.tags.slice(0, 3).join('·')}` : ''}`, hay: [u.label, ...u.tags, '내'].join(' ').toLowerCase() });
      for (const s of STOCK_ART) out.push({ key: `stock|${s.id}`, src: 'stock', from: '앱 기본 이미지', pkg: target.manifest.id, id: `stock.${s.id}`, name: s.label, kind: s.kind, tags: s.tags, ...(s.gender ? { gender: s.gender } : {}), sub: '앱 기본 이미지', hay: [s.label, ...s.tags].join(' ').toLowerCase() });
      setItems(out); setHidden(skip);
    })();
  }, [reload]);

  const sources = useMemo(() => [...new Set(items.filter((i) => i.src === 'world').map((i) => i.from))], [items]);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = items.filter((i) => (from === 'all' || (from === 'user' ? i.src === 'user' : from === 'stock' ? i.src === 'stock' : i.src === 'world' && i.from === from))
    && (!onlyKind || i.kind === kind) && words.every((t) => i.hay.includes(t)));
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  async function add() {
    const chosen = items.filter((i) => picked.has(i.key));
    if (!chosen.length) return;
    const assets = target.assets ?? [];
    const out: AssetMeta[] = [];
    // 다른 세계의 그림: 파일을 이 세계로 복사
    const copies = chosen.filter((i) => i.src === 'world');
    const ids = newImageIds(assets, copies.length);
    if (copies.length) {
      setBusy(`그림 복사 중… 0/${copies.length}`);
      const r = await storeAssets(target.manifest.id, copies.map((c, i) => ({ id: ids[i]!, read: async () => { const b = await assetBlob(c.pkg, c.id); if (!b) throw new Error('없음'); return b; } })), (d, t) => setBusy(`그림 복사 중… ${d}/${t}`));
      const bad = new Set(r.failed);
      copies.forEach((c, i) => { if (!bad.has(ids[i]!)) out.push({ id: ids[i]!, name: c.name, mime: c.meta?.mime ?? 'image/png', size: c.meta?.size ?? 0, kind: kind, tags: c.tags, ...(c.gender ? { gender: c.gender } : {}) }); });
      if (r.failed.length) setBusy(`${r.failed.length}장은 원래 세계에 파일이 없어 넣지 못했습니다.`);
    }
    // 기본 이미지: 파일 복사 없이 가리킨다
    let n = nextStockIndex([...assets, ...out]);
    for (const c of chosen.filter((i) => i.src !== 'world')) {
      const art = { id: c.src === 'user' ? `u:${c.id.slice(5)}` : c.id.slice(6), kind: (c.kind === 'scene' ? 'scene' : 'character') as 'scene' | 'character', label: c.name, tags: c.tags, ...(c.gender ? { gender: c.gender } : {}) };
      const meta = { ...stockAsset(art, n++, {}), kind };
      // 내 이미지의 태그는 그대로 가져온다 (표정 태그가 없으면 기본 모습도) — 앱 기본 이미지는 기본 모습
      if (c.src === 'user' && c.tags.length) meta.tags = kind === 'character' && !c.tags.some((t) => EXPRESSIONS.some((g) => g.key === t || g.words.includes(t))) ? [...c.tags, 'default'] : [...c.tags];
      out.push(meta);
    }
    onAdd(out);
  }

  return (
    <div className="dialog library lib-images" role="dialog" aria-label="만계서고에서 그림 고르기">
      <div className="row"><b className="multiverse-title">🌌 만계서고에서 그림 고르기</b><span className="spacer" /><button type="button" onClick={onClose} disabled={!!busy}>닫기</button></div>
      <p className="small muted">다른 세계의 그림 · 내 기본 이미지 · 앱 기본 이미지에서 여러 장을 골라 넣습니다. 다른 세계의 그림은 이 세계로 복사되고, 태그도 함께 옵니다.</p>
      <div className="row">
        <button type="button" className={uploading ? 'on' : ''} aria-expanded={uploading} onClick={() => setUploading((v) => !v)}>⇧ 내 이미지 올리기 (일괄)</button>
        <span className="small muted">올린 그림은 「내 기본 이미지」에 모여 모든 세계에서 쓸 수 있습니다.</span>
      </div>
      {uploading && <UserArtUpload defaultKind={kind} onDone={() => { setReload((n) => n + 1); setFrom('user'); setUploading(false); }} />}
      <div className="lib-img-filters">
        <label>어디서
          <select value={from} onChange={(e) => { setFrom(e.target.value); setLimit(PAGE); }}>
            <option value="all">모든 곳 ({items.length})</option>
            {sources.map((s) => <option key={s} value={s}>🌍 {s}</option>)}
            <option value="user">내 기본 이미지</option>
            <option value="stock">앱 기본 이미지</option>
          </select>
        </label>
        <input type="search" placeholder="🔍 이름·태그·세계·인물로 찾기" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
        <label className="check"><input type="checkbox" checked={onlyKind} onChange={(e) => setOnlyKind(e.target.checked)} /> {kind === 'character' ? '인물 그림만' : '장소·장면 그림만'}</label>
      </div>
      {hidden > 0 && <p className="small muted">성인 등급·개인용(남의 캐릭터 카드로 만든) 세계의 그림 {hidden}장은 이 세계에 넣을 수 없어 숨겼습니다.</p>}
      <p className="small muted">{hits.length}장{hits.length > limit ? ` 중 ${limit}장` : ''} · 누르면 고르고 다시 누르면 빼기 · 고른 {picked.size}장</p>
      <div className="lib-grid">
        {hits.slice(0, limit).map((i) => (
          <button key={i.key} type="button" className={`lib-cell${picked.has(i.key) ? ' on' : ''}`} aria-pressed={picked.has(i.key)} onClick={() => toggle(i.key)} title={`${i.name}\n${i.sub}`}>
            <AssetImage pkg={i.pkg} id={i.id} alt={i.name} />
            <span className="lib-name">{picked.has(i.key) ? '✓ ' : ''}{i.name}</span>
            <span className="lib-sub">{i.sub}</span>
          </button>
        ))}
      </div>
      {hits.length > limit && <button type="button" className="small" onClick={() => setLimit((n) => n + PAGE)}>더 보기 ({hits.length - limit}장 남음)</button>}
      {!hits.length && <p className="small muted">찾는 그림이 없습니다.</p>}
      <div className="library-foot">
        {busy && <p className="small status">{busy}</p>}
        <div className="row">
          <button type="button" className="primary" disabled={!picked.size || busy.endsWith('…') || busy.includes('…')} onClick={() => void add()}>고른 {picked.size}장 넣기</button>
          {picked.size > 0 && <button type="button" className="small" onClick={() => setPicked(new Set())}>고르기 취소</button>}
        </div>
      </div>
    </div>
  );
}
