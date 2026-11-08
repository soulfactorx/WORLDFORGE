/**
 * 🌌 만계서고(萬界書庫) — 멀티버스 아카이브 (v0.63 자료실 → v0.64).
 * 만들어 둔 모든 세계(우주)의 존재·사물(인물·장소·아이템…)과 서사·법칙(임무·이야기 줄기·결말…)을 한곳에서 찾아 담고,
 * 새 크로스오버 세계를 만들거나 기존 세계로 불러온다. AI를 다시 쓰지 않는다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BORROW_LABEL, type BorrowKind, type BorrowPick, borrow, type CatalogEntry, catalogOf, dependencies, isBlankWorld, wholePicks } from '../engine/borrow';
import { genreOf } from '../data/genres';
import type { WorldPackage } from '../engine/schema';
import { assetBlob, storeAssets } from '../storage/assets';
import { listPackages, packageKey } from '../storage/packages';
import { AssetImage } from './AssetImage';
import { confirmAdult } from './adult';
import { JsonTree } from './DebugPanel';
import { zoomImage } from './Lightbox';
import { assetUrl } from '../storage/assets';

type Src = { key: string; world: WorldPackage; builtin: boolean };
/** 존재·사물 / 서사·법칙 */
const BEINGS: BorrowKind[] = ['character', 'location', 'item', 'monster', 'faction', 'class', 'profile', 'knowledge', 'image'];
const LORE: BorrowKind[] = ['arc', 'quest', 'scene', 'choice', 'ending', 'encounter', 'clock', 'event', 'flag', 'var'];
const PAGE = 60;
const ICON: Record<BorrowKind, string> = { profile: '🧭', character: '👤', location: '🗺', item: '🎒', monster: '👹', faction: '🏰', class: '🎓', knowledge: '💡', image: '🖼', arc: '📜', quest: '📌', scene: '🎭', choice: '⚖', ending: '🏁', encounter: '⚔', clock: '⏳', event: '📅', flag: '🚩', var: '📊' };

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
  const [basket, setBasket] = useState<Map<string, { src: string; kind: BorrowKind | 'whole'; id: string; name: string }>>(new Map());
  const wholeKey = (src: string) => `${src}|whole`;
  const toggleWhole = (s: Src) => setBasket((b) => { const n = new Map(b); const k = wholeKey(s.key); if (n.has(k)) n.delete(k); else { for (const key of [...n.keys()]) if (key.startsWith(`${s.key}|`)) n.delete(key); n.set(k, { src: s.key, kind: 'whole', id: '*', name: `세계 통째로 — ${s.world.manifest.name}` }); } return n; });
  const [opts, setOpts] = useState({ withKnowledge: true, withImages: true, withFaction: true, link: true });
  const [busy, setBusy] = useState('');
  /** 자세히 보기 (v0.66) */
  const [detail, setDetail] = useState<{ src: Src; e: CatalogEntry } | null>(null);
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
  // 서사를 담으면 그것이 가리키는 것도 함께 온다 — 미리 보여 준다
  const depPreview = useMemo(() => {
    const by = new Map<string, BorrowPick[]>();
    for (const b of basket.values()) if (b.kind !== 'whole') by.set(b.src, [...(by.get(b.src) ?? []), { kind: b.kind, id: b.id }]);
    const counts: Partial<Record<BorrowKind, number>> = {};
    for (const [k, picks] of by) { const s = srcs.find((x) => x.key === k); if (!s) continue; for (const d of dependencies(s.world, picks)) counts[d.kind] = (counts[d.kind] ?? 0) + 1; }
    return Object.entries(counts).map(([k, n]) => `${BORROW_LABEL[k as BorrowKind]} ${n}`).join(' · ');
  }, [basket, srcs]);
  const toggle = (src: Src, e: CatalogEntry) => setBasket((b) => { const n = new Map(b); if (n.has(wholeKey(src.key))) return n; const k = bkey(src.key, e.kind, e.id); if (n.has(k)) n.delete(k); else n.set(k, { src: src.key, kind: e.kind, id: e.id, name: e.name }); return n; });
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
      const wholeSrc = new Set([...basket.values()].filter((b) => b.kind === 'whole').map((b) => b.src));
      // 통째로 담은 세계를 먼저 (빈 새 세계면 그 세계의 설정·시작을 그대로 쓴다)
      for (const k of wholeSrc) bySrc.set(k, wholePicks(srcs.find((s) => s.key === k)!.world));
      for (const b of basket.values()) if (b.kind !== 'whole' && !wholeSrc.has(b.src)) bySrc.set(b.src, [...(bySrc.get(b.src) ?? []), { kind: b.kind, id: b.id }]);
      let i = 0;
      for (const [k, picks] of bySrc) {
        const src = srcs.find((s) => s.key === k)!;
        setBusy(`「${src.world.manifest.name}」에서 불러오는 중… (${++i}/${bySrc.size})`);
        const whole = wholeSrc.has(k);
        const r = borrow(w, src.world, picks, { withKnowledge: opts.withKnowledge, withImages: opts.withImages, withFaction: opts.withFaction, ...(whole ? { whole: true } : {}), ...(opts.link && !(whole && isBlankWorld(w)) ? { linkTo: w.start.locationId } : {}) });
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
      <div className="row"><b className="multiverse-title">🌌 {title ?? '만계서고 萬界書庫'}</b><span className="small muted">멀티버스 아카이브 — 모든 세계가 만나는 곳</span><span className="spacer" /><button type="button" onClick={onClose} disabled={!!busy}>닫기</button></div>
      <p className="small muted">만들어 둔 세계(우주)들의 <b>존재·사물</b>(인물·장소·아이템…)과 <b>서사·법칙</b>(이야기 줄기·임무·결말…)을 골라 담아 <b>{target.manifest.name}</b>(으)로 불러옵니다. AI를 다시 쓰지 않습니다. 겹치는 ID는 새로 붙이고, 딸린 것과 서사가 가리키는 것(인물·장소·플래그·조우…)도 함께 옮깁니다.</p>
      <div className="universes">
        <button type="button" className={`universe${from === 'all' ? ' on' : ''}`} onClick={() => { setFrom('all'); setLimit(PAGE); }}><b>✦ 모든 우주</b><span>{srcs.length}개 세계</span></button>
        {srcs.map((s) => {
          const whole = basket.has(wholeKey(s.key));
          return (
            <div key={s.key} className={`universe-wrap${whole ? ' whole' : ''}`}>
              <button type="button" className={`universe${from === s.key ? ' on' : ''}`} onClick={() => { setFrom(s.key); setLimit(PAGE); }} title={s.world.overview ?? ''}>
                <b>{s.world.manifest.name}</b>
                <span>{genreOf(s.world.genre?.id, s.world.genre?.custom).label}{s.builtin ? ' · 내장' : ''}{s.world.manifest.private ? ' · 🔒' : ''}{s.world.manifest.contentRating === 'mature' ? ' · 🔞' : ''}</span>
                <span>인물 {s.world.characters.length} · 장소 {s.world.locations.length} · 임무 {s.world.quests?.length ?? 0}{s.world.manifest.crossover?.length ? ` · 🌌${s.world.manifest.crossover.length}` : ''}</span>
              </button>
              <button type="button" className={`small universe-whole${whole ? ' on' : ''}`} onClick={() => toggleWhole(s)} title="이 세계의 모든 것(인물·장소·임무·이야기 흐름·이미지…)과 세계 설정(장르·개요·문체·시작·달력·시간)을 통째로 담는다">{whole ? '✓ 통째로 담음' : '⬇ 통째로 담기'}</button>
            </div>
          );
        })}
      </div>
      <div className="row">
        <label>세계
          <select value={from} onChange={(e) => { setFrom(e.target.value); setLimit(PAGE); }}>
            <option value="all">모든 우주 ({srcs.length})</option>
            {srcs.map((s) => <option key={s.key} value={s.key}>{s.world.manifest.name}{s.builtin ? ' (내장)' : ''}{s.world.manifest.private ? ' 🔒' : ''}{s.world.manifest.contentRating === 'mature' ? ' 🔞' : ''}</option>)}
          </select>
        </label>
        <input type="search" className="grow" placeholder="🔍 이름·설명·태그·세계 이름으로 찾기" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
      </div>
      <div className="row lib-kinds"><span className="small muted lib-group">존재·사물</span>
        {BEINGS.map((k) => <button key={k} type="button" className={`small${kind === k ? ' on' : ''}`} onClick={() => { setKind(k); setLimit(PAGE); }}>{BORROW_LABEL[k]} {countOf(k)}</button>)}
      </div>
      <div className="row lib-kinds"><span className="small muted lib-group">서사·법칙</span>
        {LORE.map((k) => <button key={k} type="button" className={`small${kind === k ? ' on' : ''}`} disabled={!countOf(k)} onClick={() => { setKind(k); setLimit(PAGE); }}>{BORROW_LABEL[k]} {countOf(k)}</button>)}
      </div>
      {rows.length > 0 && (() => {
        const inB = rows.filter(({ src, e }) => basket.has(bkey(src.key, e.kind, e.id)) || basket.has(wholeKey(src.key))).length;
        return (
          <div className="row small lib-bulk">
            <span className="muted">{q.trim() ? `"${q.trim()}" ` : ''}{BORROW_LABEL[kind]} {rows.length.toLocaleString()}개{from !== 'all' ? ` · ${srcs.find((x) => x.key === from)?.world.manifest.name}` : ' · 모든 우주'}{inB ? ` · 담음 ${inB}` : ''}</span>
            <span className="spacer" />
            <button type="button" className="small" disabled={inB === rows.length} onClick={() => setBasket((b) => { const n = new Map(b); for (const { src, e } of rows) { if (n.has(wholeKey(src.key))) continue; n.set(bkey(src.key, e.kind, e.id), { src: src.key, kind: e.kind, id: e.id, name: e.name }); } return n; })}>＋ 이 결과 {rows.length.toLocaleString()}개 모두 담기</button>
            <button type="button" className="small" disabled={!inB} onClick={() => setBasket((b) => { const n = new Map(b); for (const { src, e } of rows) n.delete(bkey(src.key, e.kind, e.id)); return n; })}>− 이 결과 모두 빼기</button>
          </div>
        );
      })()}
      <div className="lib-grid">
        {shown.map(({ src, e }) => {
          const on = basket.has(bkey(src.key, e.kind, e.id)) || basket.has(wholeKey(src.key));
          return (
            <div key={`${src.key}|${e.id}`} className="lib-cell-wrap">
            <button type="button" className="lib-info" title="자세히 보기" aria-label={`${e.name} 자세히 보기`} onClick={() => setDetail({ src, e })}>ⓘ</button>
            <button type="button" className={`lib-cell${on ? ' on' : ''}`} onClick={() => toggle(src, e)} onDoubleClick={() => setDetail({ src, e })} title={`${e.name}\n${e.sub}\n${src.world.manifest.name} · ${e.id}\n(누르면 담기 · 두 번 누르거나 ⓘ로 자세히)`}>
              {e.portrait ? <img src={e.portrait} alt="" /> : e.thumb ? <AssetImage pkg={src.world.manifest.id} id={e.thumb} alt="" /> : <span className="lib-icon" aria-hidden>{ICON[e.kind]} <span className="small muted">{BORROW_LABEL[e.kind]}</span></span>}
              <span className="lib-name">{on ? '✓ ' : ''}{e.name}</span>
              <span className="lib-sub">{e.sub}</span>
              <span className="lib-from">{src.world.manifest.name}{src.world.manifest.private ? ' 🔒' : ''}{src.world.manifest.contentRating === 'mature' ? ' 🔞' : ''}</span>
            </button>
            </div>
          );
        })}
      </div>
      {rows.length > limit && <button type="button" className="small" onClick={() => setLimit((n) => n + PAGE)}>더 보기 ({rows.length - limit}개 남음)</button>}
      {rows.length === 0 && <p className="small muted">찾는 것이 없습니다.</p>}

      {detail && <LibraryDetail src={detail.src} e={detail.e} inBasket={basket.has(bkey(detail.src.key, detail.e.kind, detail.e.id))}
        onToggle={() => toggle(detail.src, detail.e)} onClose={() => setDetail(null)} onOpen={(e) => setDetail({ src: detail.src, e })} />}
      <div className="library-foot">
        {basket.size > 0 && (
          <details className="small">
            <summary>담은 것 {basket.size}개 — {[...new Set([...basket.values()].map((b) => b.src))].length}개 세계에서</summary>
            <ul className="lib-basket">{[...basket.entries()].map(([k, b]) => <li key={k}>{b.kind === 'whole' ? '🌌' : `${BORROW_LABEL[b.kind]}:`} {b.name} <span className="muted">({srcs.find((s) => s.key === b.src)?.world.manifest.name})</span> <button type="button" className="link small" onClick={() => setBasket((m) => { const n = new Map(m); n.delete(k); return n; })}>빼기</button></li>)}</ul>
          </details>
        )}
        <div className="row small">
          <label className="check"><input type="checkbox" checked={opts.withImages} onChange={(e) => setOpts({ ...opts, withImages: e.target.checked })} /> 인물·장소의 이미지도</label>
          <label className="check"><input type="checkbox" checked={opts.withKnowledge} onChange={(e) => setOpts({ ...opts, withKnowledge: e.target.checked })} /> 인물이 아는 지식도</label>
          <label className="check"><input type="checkbox" checked={opts.withFaction} onChange={(e) => setOpts({ ...opts, withFaction: e.target.checked })} /> 인물의 소속 세력도</label>
          <label className="check"><input type="checkbox" checked={opts.link} onChange={(e) => setOpts({ ...opts, link: e.target.checked })} /> 가져온 장소를 시작 장소와 잇기</label>
        </div>
        {depPreview && <p className="small">🔗 담은 서사가 가리켜 함께 올 것: {depPreview}</p>}
        {privateSrc.length > 0 && <p className="small warn-text">🔒 개인용 세계({privateSrc.map((s) => s.world.manifest.name).join(', ')})의 것을 담았습니다 — 넣는 세계도 개인용이 됩니다 (내보내기·공유 불가, 기기 간 이동 때 원본 카드 필요).</p>}
        {matureSrc.length > 0 && target.manifest.contentRating !== 'mature' && <p className="small warn-text">🔞 성인 등급 세계의 것은 성인 등급 세계로만 넣을 수 있습니다.</p>}
        {error && <p className="small status">❌ {error}</p>}
        {busy && <p className="small" role="status"><span className="spinner" /> {busy}</p>}
        <div className="row">
          {basket.size > 0 && !busy && <button type="button" className="small" onClick={() => setBasket(new Map())}>모두 비우기</button>}
          <span className="spacer" />
          <button type="button" className="primary" disabled={!basket.size || !!busy} onClick={apply}>{busy ? '불러오는 중…' : `🌌 담은 것 ${basket.size}개 불러오기`}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 자세히 보기 (v0.66)

const RAW_LIST: Partial<Record<BorrowKind, string>> = { character: 'characters', location: 'locations', item: 'items', monster: 'monsters', scene: 'scenes', faction: 'factions', class: 'classes', image: 'assets',
  quest: 'quests', arc: 'arcs', choice: 'choices', clock: 'clocks', event: 'events', ending: 'endings', flag: 'flags', var: 'vars', encounter: 'encounters' };
function rawOf(w: WorldPackage, kind: BorrowKind, id: string): Record<string, unknown> | undefined {
  if (kind === 'knowledge') return (w.claims.find((c) => c.id === id) ?? w.facts.find((f) => f.id === id)) as unknown as Record<string, unknown> | undefined;
  const list = (w as unknown as Record<string, { id: string }[] | undefined>)[RAW_LIST[kind]!] ?? [];
  return list.find((x) => x.id === id) as unknown as Record<string, unknown> | undefined;
}

/** 원본 크기로 크게 보기 (저장소 이미지는 파일 그대로) */
async function openOriginal(pkg: string, id: string, caption: string) {
  const url = await assetUrl(pkg, id);
  if (url) zoomImage(url, caption);
}

function Field({ label, text }: { label: string; text?: string | undefined }) {
  if (!text) return null;
  return <div className="lib-field"><b>{label}</b><p>{text}</p></div>;
}

function LibraryDetail({ src, e, inBasket, onToggle, onClose, onOpen }: { src: Src; e: CatalogEntry; inBasket: boolean; onToggle: () => void; onClose: () => void; onOpen: (e: CatalogEntry) => void }) {
  const w = src.world;
  const pkg = w.manifest.id;
  const raw = rawOf(w, e.kind, e.id);
  const name = (id?: string) => (id ? w.characters.find((c) => c.id === id)?.name ?? w.locations.find((l) => l.id === id)?.name ?? w.factions?.find((f) => f.id === id)?.name ?? id : '');
  const deps = useMemo(() => {
    const d = dependencies(w, [{ kind: e.kind, id: e.id }]);
    const by: Partial<Record<BorrowKind, number>> = {};
    for (const x of d) by[x.kind] = (by[x.kind] ?? 0) + 1;
    return Object.entries(by).map(([k, n]) => `${BORROW_LABEL[k as BorrowKind]} ${n}`).join(' · ');
  }, [w, e]);
  const imgs = e.kind === 'character' ? (w.assets ?? []).filter((a) => a.characterId === e.id) : e.kind === 'location' ? (w.assets ?? []).filter((a) => a.locationId === e.id) : [];
  const thumbEntry = (id: string) => catalogOf(w).find((x) => x.kind === 'image' && x.id === id);
  const c = e.kind === 'character' ? w.characters.find((x) => x.id === e.id) : undefined;
  const l = e.kind === 'location' ? w.locations.find((x) => x.id === e.id) : undefined;
  const a = e.kind === 'image' ? (w.assets ?? []).find((x) => x.id === e.id) : undefined;
  const q = e.kind === 'quest' ? w.quests?.find((x) => x.id === e.id) : undefined;
  const arc = e.kind === 'arc' ? w.arcs?.find((x) => x.id === e.id) : undefined;
  return (
    <div className="lib-detail-back" role="dialog" aria-label={`${e.name} 자세히`} onClick={onClose}>
      <div className="lib-detail" onClick={(ev) => ev.stopPropagation()}>
        <div className="row">
          <b>{BORROW_LABEL[e.kind]}: {e.name}</b>
          <span className="small muted">{w.manifest.name} · <code>{e.id}</code></span>
          <span className="spacer" />
          <button type="button" className={inBasket ? '' : 'primary'} onClick={onToggle}>{inBasket ? '✓ 담음 — 빼기' : '＋ 담기'}</button>
          <button type="button" onClick={onClose}>닫기</button>
        </div>
        {deps && <p className="small">🔗 담으면 함께 올 것: {deps}</p>}

        {a && (
          <div className="lib-image-view">
            <AssetImage pkg={pkg} id={a.id} alt={a.name} zoom />
            <div className="row">
              <button type="button" onClick={() => void openOriginal(pkg, a.id, a.name)}>⤢ 원본 크기로 보기</button>
              <span className="small muted">{a.mime} · {(a.size / 1024).toFixed(0)}KB · 종류 {a.kind}{a.characterId ? ` · 인물 ${name(a.characterId)}` : ''}{a.locationId ? ` · 장소 ${name(a.locationId)}` : ''}</span>
            </div>
            {a.tags.length > 0 && <p className="small">태그: {a.tags.map((t) => <code key={t}>{t}</code>)}</p>}
          </div>
        )}

        {c && (
          <div className="lib-char">
            <div className="row lib-char-head">
              {c.portrait ? <img className="lib-portrait zoomable" src={c.portrait} alt={c.name} onClick={() => zoomImage(c.portrait!, c.name)} /> : e.thumb ? <AssetImage pkg={pkg} id={e.thumb} alt={c.name} className="lib-portrait" zoom /> : null}
              <div className="small">
                {c.gender && <div>성별: {c.gender === 'F' ? '여성' : '남성'}</div>}
                <div>있는 곳: {name(c.locationId)}</div>
                {c.faction && <div>세력: {name(c.faction)}</div>}
                {c.companion && <div>동료로 영입 가능</div>}
                {c.romanceable && <div>연인이 될 수 있음</div>}
              </div>
            </div>
            <Field label="외형" text={c.appearance} />
            <Field label="성격" text={c.personality} />
            <Field label="말투" text={c.speech} />
            <Field label="배경" text={c.background} />
            <Field label="첫 만남의 말" text={c.greeting} />
            {(() => { const known = w.beliefs.filter((b) => b.holder === c.id).map((b) => w.claims.find((x) => x.id === b.claim)?.statement).filter(Boolean); return known.length ? <div className="lib-field"><b>아는 것 {known.length}</b><ul className="small">{known.slice(0, 12).map((t, i) => <li key={i}>{t}</li>)}{known.length > 12 && <li className="muted">… {known.length - 12}개 더</li>}</ul></div> : null; })()}
          </div>
        )}

        {l && (
          <>
            <Field label="묘사" text={l.description} />
            {l.connections.length > 0 && <p className="small">이어진 곳: {l.connections.map(name).join(' · ')}</p>}
            {l.shop && <p className="small">상점: {l.shop.name} (물건 {l.shop.items.length}개)</p>}
            {w.characters.some((x) => x.locationId === l.id) && <p className="small">있는 인물: {w.characters.filter((x) => x.locationId === l.id).map((x) => x.name).join(' · ')}</p>}
          </>
        )}

        {q && (
          <>
            <p className="small">{q.kind === 'main' ? '메인' : '사이드'} 임무{q.giver ? ` · 의뢰인 ${name(q.giver)}` : ''}{q.rewards?.xp ? ` · 경험치 ${q.rewards.xp}` : ''}{q.rewards?.money ? ` · 돈 ${q.rewards.money}` : ''}</p>
            <Field label="동기" text={q.motive} />
            <ol className="small">{q.stages.map((st, i) => <li key={i}><b>{st.objective}</b>{st.hint ? <span className="muted"> — {st.hint}</span> : null}</li>)}</ol>
          </>
        )}

        {arc && (
          <ol className="small">{arc.chapters.map((ch, i) => <li key={i}><b>{ch.name}</b>{ch.summary ? ` — ${ch.summary}` : ''}{ch.goal ? <div className="muted">GM 목표: {ch.goal}</div> : null}</li>)}</ol>
        )}

        {e.kind === 'knowledge' && raw && <Field label={'truth' in raw ? `주장·소문 (${raw.truth === 'true' ? '참' : raw.truth === 'false' ? '거짓' : '반쯤 참'})` : '사실'} text={String(raw.statement ?? '')} />}
        {['item', 'faction', 'scene', 'choice', 'ending', 'event', 'flag', 'class', 'monster', 'clock', 'var', 'encounter'].includes(e.kind) && raw && (
          <>
            <Field label="설명" text={String(raw.description ?? raw.prompt ?? raw.epilogue ?? raw.when ?? raw.blurb ?? raw.trigger ?? raw.announce ?? '') || undefined} />
            {'image' in raw && typeof raw.image === 'string' && <div className="lib-image-view"><AssetImage pkg={pkg} id={raw.image} alt={e.name} zoom /></div>}
          </>
        )}

        {imgs.length > 0 && (
          <div className="lib-field">
            <b>이미지 {imgs.length}장</b> <span className="small muted">— 누르면 크게, ⓘ로 이 이미지 자세히</span>
            <div className="lib-gallery">
              {imgs.slice(0, 60).map((im) => (
                <figure key={im.id}>
                  <AssetImage pkg={pkg} id={im.id} alt={im.name} zoom />
                  <figcaption title={im.name}>{im.tags.join('·') || im.name}</figcaption>
                  <button type="button" className="link small" onClick={() => { const te = thumbEntry(im.id); if (te) onOpen(te); }}>ⓘ</button>
                </figure>
              ))}
            </div>
            {imgs.length > 60 && <p className="small muted">… {imgs.length - 60}장 더 (이미지 종류에서 찾아보기)</p>}
          </div>
        )}

        {raw && <details className="small"><summary>데이터 전체 보기</summary><JsonTree value={raw} open /></details>}
      </div>
    </div>
  );
}
