/** 이미지 거르기 (v0.122): 종류·인물·장소·상태·태그·검색어를 함께 걸어 그 그림만 보며 작업한다 */
import { useMemo, useState } from 'react';
import type { AssetMeta, WorldPackage } from '../engine/schema';
import { activeCount, type AssetFilter, type AssetSort, type AssetState, EMPTY_FILTER, tagCounts } from '../gm/assetFilter';

const KINDS: [AssetMeta['kind'], string][] = [['character', '인물'], ['scene', '장면'], ['map', '지도'], ['cover', '표지'], ['other', '분류 안 됨']];
const STATES: [AssetState, string][] = [['', '모두'], ['selected', '선택한 것만'], ['unselected', '선택 안 한 것'], ['untagged', '태그 없는 것'], ['unlinked', '인물·장소 연결 안 된 것'], ['original', '세계에 들어 있던 그림'], ['stock', '기본 이미지'], ['user', '내 이미지']];
const QUICK: [string, Partial<AssetFilter>][] = [['분류 안 됨', { kind: 'other' }], ['인물 없는 인물 그림', { kind: 'character', character: '-' }], ['태그 없음', { state: 'untagged' }], ['선택한 것만', { state: 'selected' }]];
const TAG_LIMIT = 30;

export function AssetFilterBar({ world, assets, value, onChange, selected, found }: {
  world: WorldPackage; assets: AssetMeta[]; value: AssetFilter; onChange: (f: AssetFilter) => void; selected: Set<string>; found: number;
}) {
  const [allTags, setAllTags] = useState(false);
  const [tagQ, setTagQ] = useState('');
  const set = (p: Partial<AssetFilter>) => onChange({ ...value, ...p });
  const tags = useMemo(() => tagCounts(world, assets, value, selected), [world, assets, value, selected]);
  const tq = tagQ.trim().toLowerCase();
  const tagList = tags.filter(([t]) => !tq || t.includes(tq));
  const shownTags = allTags || tq ? tagList : tagList.slice(0, TAG_LIMIT);
  const n = activeCount(value);
  const count = (p: (a: AssetMeta) => boolean) => assets.filter(p).length;
  const toggleTag = (t: string) => set({ tags: value.tags.includes(t) ? value.tags.filter((x) => x !== t) : [...value.tags, t] });
  return (
    <fieldset className="asset-filter">
      <legend>🔎 이미지 거르기 — <b>{found}장</b> / 전체 {assets.length}장</legend>
      <div className="asset-quick">
        {QUICK.map(([label, p]) => {
          const on = Object.entries(p).every(([k, v]) => value[k as keyof AssetFilter] === v);
          return <button key={label} type="button" className={`small${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onChange(on ? { ...EMPTY_FILTER, q: value.q, sort: value.sort } : { ...EMPTY_FILTER, sort: value.sort, ...p })}>{label}</button>;
        })}
        {n > 0 && <button type="button" className="small" onClick={() => onChange({ ...EMPTY_FILTER, sort: value.sort })}>✕ 조건 {n}개 모두 지우기</button>}
      </div>
      <input type="search" className="asset-filter-q" placeholder="🔍 이름·태그·인물·장소 (여러 낱말 · 앞에 -를 붙이면 빼기)" value={value.q} onChange={(e) => set({ q: e.target.value })} />
      <div className="asset-filter-grid">
        <label>종류
          <select value={value.kind} onChange={(e) => set({ kind: e.target.value as AssetFilter['kind'] })}>
            <option value="">모두 ({assets.length})</option>
            {KINDS.map(([k, l]) => <option key={k} value={k}>{l} ({count((a) => a.kind === k)})</option>)}
          </select>
        </label>
        <label>인물
          <select value={value.character} onChange={(e) => set({ character: e.target.value })}>
            <option value="">모두</option>
            <option value="-">인물 없음 ({count((a) => !a.characterId)})</option>
            {world.characters.map((c) => <option key={c.id} value={c.id}>{c.name} ({count((a) => a.characterId === c.id)})</option>)}
          </select>
        </label>
        <label>장소
          <select value={value.location} onChange={(e) => set({ location: e.target.value })}>
            <option value="">모두</option>
            <option value="-">장소 없음 ({count((a) => !a.locationId)})</option>
            {world.locations.map((l) => <option key={l.id} value={l.id}>{l.name} ({count((a) => a.locationId === l.id)})</option>)}
          </select>
        </label>
        <label>상태
          <select value={value.state} onChange={(e) => set({ state: e.target.value as AssetState })}>
            {STATES.map(([s, l]) => <option key={s} value={s}>{s === 'selected' ? `${l} (${selected.size})` : l}</option>)}
          </select>
        </label>
        <label>정렬
          <select value={value.sort} onChange={(e) => set({ sort: e.target.value as AssetSort })}>
            <option value="">원래 순서</option>
            <option value="name">이름순</option>
            <option value="tags">태그 적은 것부터</option>
          </select>
        </label>
      </div>
      <div className="asset-tags-head">
        <span className="small muted">태그 {value.tags.length ? `— 고른 ${value.tags.length}개를 모두 가진 그림만` : '— 누르면 그 태그만 (여럿 고르면 모두 가진 것)'}</span>
        {tags.length > 8 && <input type="search" className="asset-tag-q" placeholder="태그 찾기" value={tagQ} onChange={(e) => setTagQ(e.target.value)} />}
      </div>
      {tags.length ? (
        <div className="asset-tags">
          {shownTags.map(([t, c]) => {
            const on = value.tags.includes(t);
            return <button key={t} type="button" className={`tag-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => toggleTag(t)}>{on ? '✓ ' : ''}{t} <span className="muted">{c}</span></button>;
          })}
          {!tq && tagList.length > TAG_LIMIT && <button type="button" className="tag-chip" onClick={() => setAllTags(!allTags)}>{allTags ? '접기' : `+${tagList.length - TAG_LIMIT}개 더`}</button>}
        </div>
      ) : <p className="small muted">이 조건의 그림에는 태그가 없습니다.</p>}
    </fieldset>
  );
}
