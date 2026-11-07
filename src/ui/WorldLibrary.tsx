/**
 * 자료실 (v0.63): 만들어 둔 모든 세계의 인물·장소·아이템·장면·지식·이미지를 한곳에서 찾아 골라 담고,
 * 새 세계를 만들거나 기존 세계에 넣는다. AI를 다시 쓰지 않는다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BORROW_LABEL, type BorrowKind, type BorrowPick, borrow, type CatalogEntry, catalogOf } from '../engine/borrow';
import type { WorldPackage } from '../engine/schema';
import { assetBlob, storeAssets } from '../storage/assets';
import { listPackages, packageKey } from '../storage/packages';
import { AssetImage } from './AssetImage';
import { confirmAdult } from './adult';

type Src = { key: string; world: WorldPackage; builtin: boolean };
const KINDS: BorrowKind[] = ['character', 'location', 'scene', 'item', 'monster', 'faction', 'class', 'knowledge', 'image'];
const PAGE = 60;

export function WorldLibrary({ target, onApply, onClose, title }: {
  /** 넣을 세계 (편집 중인 것) */
  target: WorldPackage;
  /** 가져온 결과 (이미지 복사까지 끝난 뒤) */
  onApply: (world: WorldPackage, notes: string[]) => void;
  onClose: () => void;
  title?: string;
}) {
  const [srcs, setSrcs] = useState<Src[]>([]);
  const [from, setFrom] = useState('all');
  const [kind, setKind] = useState<BorrowKind>('character');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [basket, setBasket] = useState<Map<string, { src: string; kind: BorrowKind; id: string; name: string }>>(new Map());
  const [opts, setOpts] = useState({ withKnowledge: true, withImages: true, withFaction: true, link: true });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const doing = useRef(false);

  useEffect(() => { void listPackages().then((ps) => setSrcs(ps.filter((p) => packageKey(p.world) !== packageKey(target)).map((p) => ({ key: packageKey(p.world), world: p.world, builtin: p.builtin })))); }, []);
  const catalogs = useMemo(() => new Map(srcs.map((s) => [s.key, catalogOf(s.world)])), [srcs]);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = useMemo(() => {
    const out: { src: Src; e: CatalogEntry }[] = [];
    for (const s of srcs) {
      if (from !== 'all' && from !== s.key) continue;
      for (const e of catalogs.get(s.key) ?? []) if (e.kind === kind && words.every((t) => e.hay.includes(t) || s.world.manifest.name.toLowerCase().includes(t))) out.push({ src: s, e });
    }
    return out;
  }, [srcs, catalogs, from, kind, q]);
  const countOf = (k: BorrowKind) => srcs.filter((s) => from === 'all' || from === s.key).reduce((n, s) => n + (catalogs.get(s.key) ?? []).filter((e) => e.kind === k).length, 0);
  const bkey = (src: string, k: BorrowKind, id: string) => `${src}|${k}|${id}`;
  const toggle = (src: Src, e: CatalogEntry) => setBasket((b) => { const n = new Map(b); const k = bkey(src.key, e.kind, e.id); if (n.has(k)) n.delete(k); else n.set(k, { src: src.key, kind: e.kind, id: e.id, name: e.name }); return n; });
  const matureSrc = [...new Set([...basket.values()].map((b) => b.src))].map((k) => srcs.find((s) => s.key === k)!).filter((s) => s?.world.manifest.contentRating === 'mature');
  const privateSrc = [...new Set([...basket.values()].map((b) => b.src))].map((k) => srcs.find((s) => s.key === k)!).filter((s) => s?.world.manifest.private);

  async function apply() {
    if (doing.current || !basket.size) return;
    doing.current = true;
    setError('');
    try {
      let w = structuredClone(target);
      if (matureSrc.length && w.manifest.contentRating !== 'mature') {
        // 빈 새 세계면 성인 등급으로 정할 수 있다 (한 번 정하면 바꿀 수 없다)
        const blank = !w.characters.length && w.locations.length <= 1;
        if (!blank) throw new Error(`성인 등급 세계(${matureSrc.map((s) => s.world.manifest.name).join(', ')})의 것은 성인 등급 세계로만 가져올 수 있습니다. 담은 목록에서 빼 주세요.`);
        if (!confirmAdult() || !confirm('성인 등급 세계의 것을 담았습니다. 새 세계를 성인 등급으로 정할까요? (이후 바꿀 수 없고 공유할 수 없습니다)')) { doing.current = false; return; }
        w = { ...w, manifest: { ...w.manifest, contentRating: 'mature' } };
      }
      const notes: string[] = [];
      const copies: { fromPkg: string; fromId: string; toId: string }[] = [];
      const bySrc = new Map<string, BorrowPick[]>();
      for (const b of basket.values()) bySrc.set(b.src, [...(bySrc.get(b.src) ?? []), { kind: b.kind, id: b.id }]);
      let i = 0;
      for (const [k, picks] of bySrc) {
        const src = srcs.find((s) => s.key === k)!;
        setBusy(`${src.world.manifest.name}에서 가져오는 중… (${++i}/${bySrc.size})`);
        const r = borrow(w, src.world, picks, { withKnowledge: opts.withKnowledge, withImages: opts.withImages, withFaction: opts.withFaction, ...(opts.link ? { linkTo: w.start.locationId } : {}) });
        w = r.world;
        copies.push(...r.copies);
        const got = Object.entries(r.added).map(([kk, n]) => `${BORROW_LABEL[kk as BorrowKind]} ${n}`).join(' · ');
        notes.push(`「${src.world.manifest.name}」에서: ${got || '없음'}`, ...r.notes);
        await new Promise((res) => setTimeout(res, 0));
      }
      if (copies.length) {
        setBusy(`이미지 복사 중… 0/${copies.length}`);
        const res = await storeAssets(w.manifest.id, copies.map((c) => ({ id: c.toId, read: async () => { const b = await assetBlob(c.fromPkg, c.fromId); if (!b) throw new Error('없음'); return b; } })), (d, t) => setBusy(`이미지 복사 중… ${d}/${t}`));
        if (res.failed.length) {
          const bad = new Set(res.failed);
          w = { ...w, assets: (w.assets ?? []).filter((a) => !bad.has(a.id)) };
          notes.push(`이미지 ${res.failed.length}장은 원래 세계에 파일이 없어 뺐습니다.`);
        }
      }
      onApply(w, notes);
    } catch (e) {
      setError((e as Error).message);
      doing.current = false;
    } finally { setBusy(''); }
  }

  const shown = rows.slice(0, limit);
  return (
    <div className="dialog library">
      <div className="row"><b>📚 {title ?? '자료실 — 다른 세계에서 가져오기'}</b><span className="spacer" /><button type="button" onClick={onClose} disabled={!!busy}>닫기</button></div>
      <p className="small muted">만들어 둔 세계의 인물·장소·장면·아이템·지식·이미지를 골라 담아 <b>{target.manifest.name}</b>에 넣습니다. AI를 다시 쓰지 않습니다. 겹치는 ID는 새로 붙이고, 인물의 이미지·아는 지식·세력처럼 딸린 것도 함께 옮깁니다.</p>
      <div className="row">
        <label>세계
          <select value={from} onChange={(e) => { setFrom(e.target.value); setLimit(PAGE); }}>
            <option value="all">모든 세계 ({srcs.length})</option>
            {srcs.map((s) => <option key={s.key} value={s.key}>{s.world.manifest.name}{s.builtin ? ' (내장)' : ''}{s.world.manifest.private ? ' 🔒' : ''}{s.world.manifest.contentRating === 'mature' ? ' 🔞' : ''}</option>)}
          </select>
        </label>
        <input type="search" className="grow" placeholder="🔍 이름·설명·태그·세계 이름으로 찾기" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
      </div>
      <div className="row lib-kinds">
        {KINDS.map((k) => <button key={k} type="button" className={`small${kind === k ? ' on' : ''}`} onClick={() => { setKind(k); setLimit(PAGE); }}>{BORROW_LABEL[k]} {countOf(k)}</button>)}
      </div>
      <div className="lib-grid">
        {shown.map(({ src, e }) => {
          const on = basket.has(bkey(src.key, e.kind, e.id));
          return (
            <button key={`${src.key}|${e.id}`} type="button" className={`lib-cell${on ? ' on' : ''}`} onClick={() => toggle(src, e)} title={`${e.name}\n${e.sub}\n${src.world.manifest.name} · ${e.id}`}>
              {e.portrait ? <img src={e.portrait} alt="" /> : e.thumb ? <AssetImage pkg={src.world.manifest.id} id={e.thumb} alt="" /> : <span className="lib-ph">{BORROW_LABEL[e.kind].slice(0, 1)}</span>}
              <span className="lib-name">{on ? '✓ ' : ''}{e.name}</span>
              <span className="lib-sub">{e.sub}</span>
              <span className="lib-from">{src.world.manifest.name}{src.world.manifest.private ? ' 🔒' : ''}{src.world.manifest.contentRating === 'mature' ? ' 🔞' : ''}</span>
            </button>
          );
        })}
      </div>
      {rows.length > limit && <button type="button" className="small" onClick={() => setLimit((n) => n + PAGE)}>더 보기 ({rows.length - limit}개 남음)</button>}
      {rows.length === 0 && <p className="small muted">찾는 것이 없습니다.</p>}

      <div className="library-foot">
        {basket.size > 0 && (
          <details className="small">
            <summary>담은 것 {basket.size}개 — {[...new Set([...basket.values()].map((b) => b.src))].length}개 세계에서</summary>
            <ul className="lib-basket">{[...basket.entries()].map(([k, b]) => <li key={k}>{BORROW_LABEL[b.kind]}: {b.name} <span className="muted">({srcs.find((s) => s.key === b.src)?.world.manifest.name})</span> <button type="button" className="link small" onClick={() => setBasket((m) => { const n = new Map(m); n.delete(k); return n; })}>빼기</button></li>)}</ul>
          </details>
        )}
        <div className="row small">
          <label className="check"><input type="checkbox" checked={opts.withImages} onChange={(e) => setOpts({ ...opts, withImages: e.target.checked })} /> 인물·장소의 이미지도</label>
          <label className="check"><input type="checkbox" checked={opts.withKnowledge} onChange={(e) => setOpts({ ...opts, withKnowledge: e.target.checked })} /> 인물이 아는 지식도</label>
          <label className="check"><input type="checkbox" checked={opts.withFaction} onChange={(e) => setOpts({ ...opts, withFaction: e.target.checked })} /> 인물의 소속 세력도</label>
          <label className="check"><input type="checkbox" checked={opts.link} onChange={(e) => setOpts({ ...opts, link: e.target.checked })} /> 가져온 장소를 시작 장소와 잇기</label>
        </div>
        {privateSrc.length > 0 && <p className="small warn-text">🔒 개인용 세계({privateSrc.map((s) => s.world.manifest.name).join(', ')})의 것을 담았습니다 — 넣는 세계도 개인용이 됩니다 (내보내기·공유 불가, 기기 간 이동 때 원본 카드 필요).</p>}
        {matureSrc.length > 0 && target.manifest.contentRating !== 'mature' && <p className="small warn-text">🔞 성인 등급 세계의 것은 성인 등급 세계로만 넣을 수 있습니다.</p>}
        {error && <p className="small status">❌ {error}</p>}
        {busy && <p className="small" role="status"><span className="spinner" /> {busy}</p>}
        <div className="row">
          {basket.size > 0 && !busy && <button type="button" className="small" onClick={() => setBasket(new Map())}>모두 비우기</button>}
          <span className="spacer" />
          <button type="button" className="primary" disabled={!basket.size || !!busy} onClick={apply}>{busy ? '가져오는 중…' : `담은 것 ${basket.size}개 넣기`}</button>
        </div>
      </div>
    </div>
  );
}
