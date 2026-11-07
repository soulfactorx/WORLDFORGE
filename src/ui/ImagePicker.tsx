/**
 * 그림 고르기 (v0.60): 이미지가 많아도 찾기 쉽게 — 검색(이름·태그·인물·장소·ID), 종류별 거르기, 썸네일 격자.
 * 장면 편집기의 모든 그림 칸(시작·단계·행동·반작용·끝)에서 쓴다.
 */
import { useMemo, useState } from 'react';
import { SCENE_FX } from '../data/sceneArt';
import type { WorldPackage } from '../engine/schema';
import { AssetImage } from './AssetImage';

type Kind = 'all' | 'fx' | 'scene' | 'character' | 'other';
interface Item { id: string; name: string; kind: Exclude<Kind, 'all'>; hay: string; sub: string }
const KIND_LABEL: Record<Kind, string> = { all: '전체', fx: '장면 그림 (내장)', scene: '장소', character: '인물', other: '지도·표지·기타' };
const PAGE = 60;

function itemsOf(w: WorldPackage): Item[] {
  const charName = new Map(w.characters.map((c) => [c.id, c.name]));
  const locName = new Map(w.locations.map((l) => [l.id, l.name]));
  const fx: Item[] = SCENE_FX.map((f) => ({ id: `stock.${f.id}`, name: f.label, kind: 'fx', sub: '내장 장면 그림', hay: [f.label, f.id, ...f.tags].join(' ').toLowerCase() }));
  const own: Item[] = (w.assets ?? []).map((a) => {
    const who = a.characterId ? charName.get(a.characterId) ?? a.characterId : '';
    const where = a.locationId ? locName.get(a.locationId) ?? a.locationId : '';
    const kind: Item['kind'] = a.kind === 'character' ? 'character' : a.kind === 'scene' ? 'scene' : 'other';
    return { id: a.id, name: a.name, kind, sub: [who, where, a.tags.slice(0, 4).join('·')].filter(Boolean).join(' · '), hay: [a.name, a.id, who, where, a.kind, ...a.tags].join(' ').toLowerCase() };
  });
  return [...own, ...fx];
}

export function ImagePicker({ label, value, w, onChange }: { label: string; value: string | undefined; w: WorldPackage; onChange: (v: string | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [limit, setLimit] = useState(PAGE);
  const all = useMemo(() => itemsOf(w), [w.assets, w.characters, w.locations]);
  const cur = value ? all.find((x) => x.id === value) : undefined;
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = all.filter((x) => (kind === 'all' || x.kind === kind) && words.every((t) => x.hay.includes(t)));
  const counts = (k: Kind) => (k === 'all' ? all.length : all.filter((x) => x.kind === k).length);
  const pick = (id: string | undefined) => { onChange(id); setOpen(false); };

  return (
    <div className="img-pick">
      <span className="img-pick-label">{label}</span>
      <span className="row">
        {value && <AssetImage pkg={w.manifest.id} id={value} alt={label} className="img-pick-thumb" zoom />}
        <span className="img-pick-name">{value ? cur?.name ?? value : <span className="muted">(그림 없음)</span>}</span>
        <button type="button" className="small" onClick={() => { setOpen((o) => !o); setLimit(PAGE); }} aria-expanded={open}>{open ? '닫기' : value ? '바꾸기' : '🔍 고르기'}</button>
        {value && <button type="button" className="small" onClick={() => onChange(undefined)} title="그림 빼기">✕</button>}
      </span>
      {open && (
        <div className="img-pick-pop">
          <input type="search" autoFocus placeholder="이름·태그·인물·장소로 찾기 (여러 낱말은 모두 포함)" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
          <div className="row img-pick-kinds">
            {(Object.keys(KIND_LABEL) as Kind[]).filter((k) => k === 'all' || counts(k) > 0).map((k) => (
              <button key={k} type="button" className={`small${kind === k ? ' on' : ''}`} onClick={() => { setKind(k); setLimit(PAGE); }}>{KIND_LABEL[k]} {counts(k)}</button>
            ))}
          </div>
          <p className="small muted">{hits.length}개{hits.length > limit ? ` 중 ${limit}개 표시` : ''}</p>
          <div className="img-pick-grid">
            {hits.slice(0, limit).map((x) => (
              <button key={x.id} type="button" className={`img-pick-cell${x.id === value ? ' on' : ''}`} onClick={() => pick(x.id)} title={`${x.name}\n${x.id}${x.sub ? `\n${x.sub}` : ''}`}>
                <AssetImage pkg={w.manifest.id} id={x.id} alt={x.name} />
                <span className="img-pick-cap">{x.name}</span>
                {x.sub && <span className="img-pick-sub">{x.sub}</span>}
              </button>
            ))}
          </div>
          {hits.length > limit && <button type="button" className="small" onClick={() => setLimit((n) => n + PAGE)}>더 보기 ({hits.length - limit}개 남음)</button>}
          {hits.length === 0 && <p className="small muted">찾는 그림이 없습니다. 이미지 탭에서 올리거나 이름·태그를 바꿔 보세요.</p>}
        </div>
      )}
    </div>
  );
}
