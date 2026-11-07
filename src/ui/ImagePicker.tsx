/**
 * 그림 고르기 (v0.60): 이미지가 많아도 찾기 쉽게 — 검색(이름·태그·인물·장소·ID), 종류별 거르기, 썸네일 격자.
 * 장면 편집기의 모든 그림 칸(시작·단계·행동·반작용·끝)에서 쓴다.
 */
import { useEffect, useMemo, useState } from 'react';
import { SCENE_FX } from '../data/sceneArt';
import type { WorldPackage } from '../engine/schema';
import { assetUrl } from '../storage/assets';
import { AssetImage } from './AssetImage';
import { zoomImage } from './Lightbox';

type Kind = 'all' | 'fx' | 'scene' | 'character' | 'other';
interface Item { id: string; name: string; kind: Exclude<Kind, 'all'>; hay: string; sub: string }
const KIND_LABEL: Record<Kind, string> = { all: '전체', fx: '장면 그림 (내장)', scene: '장소', character: '인물', other: '지도·표지·기타' };
const PAGE = 60;
const KIND_WORD: Record<string, string> = { character: '인물', scene: '장소 배경', map: '지도', cover: '표지', other: '기타' };

function itemsOf(w: WorldPackage): Item[] {
  const charName = new Map(w.characters.map((c) => [c.id, c.name]));
  const charGender = new Map(w.characters.map((c) => [c.id, c.gender]));
  const locName = new Map(w.locations.map((l) => [l.id, l.name]));
  const fx: Item[] = SCENE_FX.map((f) => ({ id: `stock.${f.id}`, name: f.label, kind: 'fx', sub: '내장 장면 그림', hay: [f.label, f.id, ...f.tags].join(' ').toLowerCase() }));
  const own: Item[] = (w.assets ?? []).map((a) => {
    const who = a.characterId ? charName.get(a.characterId) ?? a.characterId : '';
    const where = a.locationId ? locName.get(a.locationId) ?? a.locationId : '';
    const kind: Item['kind'] = a.kind === 'character' ? 'character' : a.kind === 'scene' ? 'scene' : 'other';
    return { id: a.id, name: a.name, kind, sub: [who, where, a.tags.slice(0, 4).join('·')].filter(Boolean).join(' · '), hay: [a.name, a.id, who, where, a.kind, KIND_WORD[a.kind] ?? '', ((g) => (g === 'F' ? '여성 여자' : g === 'M' ? '남성 남자' : ''))(a.gender ?? (a.characterId ? charGender.get(a.characterId) : undefined)), ...a.tags].join(' ').toLowerCase() };
  });
  return [...own, ...fx];
}

/** 적용 전 미리보기 (v0.74): 큰 그림 · 원본 해상도 · 원본 크기로 보기 · 적용 */
function PickPreview({ w, item, current, onApply, onCancel }: { w: WorldPackage; item: Item; current: boolean; onApply: () => void; onCancel: () => void }) {
  const [url, setUrl] = useState<string>();
  const [dim, setDim] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(undefined); setDim(null);
    assetUrl(w.manifest.id, item.id).then((u) => { if (live) setUrl(u); }).catch(() => {});
    return () => { live = false; };
  }, [w.manifest.id, item.id]);
  return (
    <div className="img-pick-preview" aria-label={`미리보기: ${item.name}`}>
      <div className="img-pick-preview-stage">
        {url ? <img src={url} alt={item.name} title="눌러서 원본 크기로 보기" onClick={() => zoomImage(url, item.name)}
          onLoad={(e) => setDim({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} /> : <span className="asset-ph" />}
      </div>
      <div className="img-pick-preview-info">
        <b>{item.name}</b>
        <span className="small muted">{item.id}</span>
        {item.sub && <span className="small">{item.sub}</span>}
        <span className="small muted">{dim ? `원본 ${dim.w} × ${dim.h}px` : '불러오는 중…'}{current ? ' · 지금 쓰는 그림' : ''}</span>
        <div className="row">
          <button type="button" className="primary" onClick={onApply}>✔ 이 그림 적용</button>
          <button type="button" className="small" disabled={!url} onClick={() => url && zoomImage(url, item.name)}>⛶ 원본 크기로 보기</button>
          <button type="button" className="small" onClick={onCancel}>다른 그림 고르기</button>
        </div>
      </div>
    </div>
  );
}

/** 검색·종류별 거르기·썸네일 격자 (그림 고르기·초상화 고르기가 함께 쓴다, v0.61) */
export function ImageSearchGrid({ w, value, onPick, fx = true, prefer, autoFocus = true }: {
  w: WorldPackage; value?: string | undefined; onPick: (id: string) => void;
  /** 내장 장면 그림도 보여 줄지 */ fx?: boolean;
  /** 이 인물의 이미지를 맨 앞에 */ prefer?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [limit, setLimit] = useState(PAGE);
  /** 누르면 먼저 미리보기, 적용은 따로 (두 번 누르면 바로 적용) */
  const [sel, setSel] = useState<string | null>(null);
  const all = useMemo(() => {
    const items = itemsOf(w).filter((x) => fx || x.kind !== 'fx');
    if (!prefer) return items;
    const mine = new Set((w.assets ?? []).filter((a) => a.characterId === prefer).map((a) => a.id));
    return [...items.filter((x) => mine.has(x.id)), ...items.filter((x) => !mine.has(x.id))];
  }, [w.assets, w.characters, w.locations, fx, prefer]);
  const mineIds = useMemo(() => new Set(prefer ? (w.assets ?? []).filter((a) => a.characterId === prefer).map((a) => a.id) : []), [w.assets, prefer]);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = all.filter((x) => (kind === 'all' || x.kind === kind) && words.every((t) => x.hay.includes(t)));
  const counts = (k: Kind) => (k === 'all' ? all.length : all.filter((x) => x.kind === k).length);
  return (
    <div className="img-pick-pop">
      <input type="search" autoFocus={autoFocus} placeholder="이름·태그·인물·장소로 찾기 (여러 낱말은 모두 포함)" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
      <div className="row img-pick-kinds">
        {(Object.keys(KIND_LABEL) as Kind[]).filter((k) => k === 'all' || counts(k) > 0).map((k) => (
          <button key={k} type="button" className={`small${kind === k ? ' on' : ''}`} onClick={() => { setKind(k); setLimit(PAGE); }}>{KIND_LABEL[k]} {counts(k)}</button>
        ))}
      </div>
      <p className="small muted">{hits.length}개{hits.length > limit ? ` 중 ${limit}개 표시` : ''} · 누르면 미리보기, 두 번 누르면 바로 적용{mineIds.size ? ` · ★ = 이 인물의 이미지 ${mineIds.size}장 (먼저 보임)` : ''}</p>
      <div className="img-pick-grid">
        {hits.slice(0, limit).map((x) => (
          <button key={x.id} type="button" className={`img-pick-cell${x.id === value ? ' on' : ''}${x.id === sel ? ' sel' : ''}${mineIds.has(x.id) ? ' mine' : ''}`}
            onClick={() => setSel(x.id)} onDoubleClick={() => { onPick(x.id); setSel(null); }} aria-pressed={x.id === sel}
            title={`${x.name}\n${x.id}${x.sub ? `\n${x.sub}` : ''}\n누르면 미리보기 · 두 번 누르면 바로 적용`}>
            <AssetImage pkg={w.manifest.id} id={x.id} alt={x.name} />
            <span className="img-pick-cap">{mineIds.has(x.id) ? '★ ' : ''}{x.name}</span>
            {x.sub && <span className="img-pick-sub">{x.sub}</span>}
          </button>
        ))}
      </div>
      {sel && all.find((x) => x.id === sel) && (
        <PickPreview w={w} item={all.find((x) => x.id === sel)!} current={sel === value} onApply={() => { onPick(sel); setSel(null); }} onCancel={() => setSel(null)} />
      )}
      {hits.length > limit && <button type="button" className="small" onClick={() => setLimit((n) => n + PAGE)}>더 보기 ({hits.length - limit}개 남음)</button>}
      {hits.length === 0 && <p className="small muted">찾는 그림이 없습니다. 이미지 탭에서 올리거나 이름·태그를 바꿔 보세요.</p>}
    </div>
  );
}

export function ImagePicker({ label, value, w, onChange }: { label: string; value: string | undefined; w: WorldPackage; onChange: (v: string | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const all = useMemo(() => itemsOf(w), [w.assets, w.characters, w.locations]);
  const cur = value ? all.find((x) => x.id === value) : undefined;
  return (
    <div className="img-pick">
      <span className="img-pick-label">{label}</span>
      <span className="row">
        {value && <AssetImage pkg={w.manifest.id} id={value} alt={label} className="img-pick-thumb" zoom />}
        <span className="img-pick-name">{value ? cur?.name ?? value : <span className="muted">(그림 없음)</span>}</span>
        <button type="button" className="small" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? '닫기' : value ? '바꾸기' : '🔍 고르기'}</button>
        {value && <button type="button" className="small" onClick={() => onChange(undefined)} title="그림 빼기">빼기</button>}
      </span>
      {open && <ImageSearchGrid w={w} value={value} onPick={(id) => { onChange(id); setOpen(false); }} />}
    </div>
  );
}
