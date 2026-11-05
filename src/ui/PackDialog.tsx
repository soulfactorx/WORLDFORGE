/**
 * 콘텐츠 패키지 내보내기·넣기 (설계 v3 10장 · R7).
 * 넣을 때는 충돌·의존성·장소 문제를 보여주고, 무엇을 할지 사용자가 고른다 (덮어쓰지 않는다).
 */
import { useState } from 'react';
import { applyPack, buildCharacterPack, buildRulesPack, type ContentPack, planImport, type Resolution } from '../engine/package/packs';
import { shareBlocked } from '../engine/rating';
import type { WorldPackage } from '../engine/schema';
import { isPrivate } from '../storage/packages';
import { exportPack, PACK_EXT, parsePack, storePackImages } from '../storage/packs';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PackExport({ w, kind, onClose }: { w: WorldPackage; kind: 'character' | 'rules'; onClose: () => void }) {
  const base = w.manifest.id.replace(/[^a-z0-9._-]/g, '');
  const [ids, setIds] = useState<string[]>([]);
  const [m, setM] = useState({ id: `${base}.${kind === 'character' ? 'cast' : 'rules'}`.slice(0, 64), name: kind === 'character' ? `${w.manifest.name} 인물들` : `${w.manifest.name} 규칙`, version: '1.0.0', author: w.manifest.author, license: w.manifest.license });
  const [status, setStatus] = useState('');
  const blocked = isPrivate(w) ? '다른 사람의 작품으로 만든 개인용 세계라 패키지로 내보낼 수 없습니다.' : shareBlocked(w) ? '성인 등급 세계는 공유할 수 없어 패키지로 내보낼 수 없습니다.' : '';
  async function run() {
    try {
      let pack: ContentPack;
      let notes: string[] = [];
      if (kind === 'character') ({ pack, notes } = buildCharacterPack(w, ids, m));
      else pack = buildRulesPack(w, m);
      download(await exportPack(w, pack), `${m.id}.${PACK_EXT[kind]}`);
      setStatus(`✅ ${m.id}.${PACK_EXT[kind]}을(를) 만들었습니다.${notes.length ? ` ${notes.join(' ')}` : ''}`);
    } catch (e) { setStatus(`❌ ${(e as Error).message}`); }
  }
  return (
    <div className="dialog pack-dialog">
      <div className="row"><b>{kind === 'character' ? '⇧ 인물 패키지(.chp) 내보내기' : '⇧ 규칙 패키지(.rule) 내보내기'}</b><span className="spacer" /><button type="button" onClick={onClose}>닫기</button></div>
      {blocked ? <p className="status">{blocked}</p> : (
        <>
          <p className="small muted">{kind === 'character'
            ? '고른 인물과 그들이 아는 것, 그들 사이의 관계, 그들의 이미지·건네는 아이템을 담습니다. 세력·진실·임무는 세계의 것이라 담지 않습니다.'
            : '이 세계만의 아이템과 장르 용어 바꿈표·화폐·최대 레벨을 담습니다.'}</p>
          {kind === 'character' && (
            <div className="stage-checks">
              {w.characters.map((c) => (
                <label key={c.id} className="check small"><input type="checkbox" checked={ids.includes(c.id)} onChange={(e) => setIds((x) => (e.target.checked ? [...x, c.id] : x.filter((y) => y !== c.id)))} />{c.name}</label>
              ))}
            </div>
          )}
          <div className="form-grid">
            <label>패키지 ID<input value={m.id} onChange={(e) => setM({ ...m, id: e.target.value })} /></label>
            <label>이름<input value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} /></label>
            <label>버전<input value={m.version} onChange={(e) => setM({ ...m, version: e.target.value })} /></label>
            <label>만든 사람<input value={m.author} onChange={(e) => setM({ ...m, author: e.target.value })} /></label>
            <label>라이선스<input value={m.license} onChange={(e) => setM({ ...m, license: e.target.value })} /></label>
          </div>
          <button type="button" className="primary" disabled={kind === 'character' && !ids.length} onClick={run}>내보내기</button>
        </>
      )}
      {status && <p className="status small">{status}</p>}
    </div>
  );
}

export function PackImport({ w, onApply, onClose }: { w: WorldPackage; onApply: (world: WorldPackage, notes: string[]) => void; onClose: () => void }) {
  const [parsed, setParsed] = useState<ReturnType<typeof parsePack> | null>(null);
  const [resolve, setResolve] = useState<Record<string, Resolution>>({});
  const [loc, setLoc] = useState(w.start.locationId);
  const [genre, setGenre] = useState(false);
  const [status, setStatus] = useState('');
  const pack = parsed?.pack ?? null;
  const plan = pack ? planImport(w, pack) : null;
  async function apply() {
    if (!pack || !parsed) return;
    try {
      const r = applyPack(w, pack, { resolve, locationId: loc, applyGenreSettings: genre });
      const metaOf = (id: string) => ('assets' in pack ? pack.assets.find((a) => a.id === id)?.mime : undefined) ?? 'image/png';
      const n = Object.keys(r.assetIds).length ? await storePackImages(w.manifest.id, parsed.images, r.assetIds, metaOf) : 0;
      onApply(r.world, [...r.notes, ...(n ? [`이미지 ${n}장을 저장했습니다.`] : [])]);
    } catch (e) { setStatus(`❌ ${(e as Error).message}`); }
  }
  return (
    <div className="dialog pack-dialog">
      <div className="row"><b>⇩ 패키지 넣기 (.chp 인물 · .rule 규칙)</b><span className="spacer" /><button type="button" onClick={onClose}>닫기</button></div>
      <input type="file" accept=".chp,.rule,.zip" onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setParsed(parsePack(f.name, new Uint8Array(await f.arrayBuffer())));
        setResolve({}); setStatus('');
      }} />
      {parsed?.errors.length ? <ul className="small issues">{parsed.errors.map((x) => <li key={x} className="error">{x}</li>)}</ul> : null}
      {pack && plan && (
        <>
          <p><b>{pack.manifest.name}</b> <span className="small muted">{pack.manifest.type === 'character' ? '인물 패키지' : '규칙 패키지'} · {pack.manifest.id}@{pack.manifest.version} · {pack.manifest.author} · {pack.manifest.license} · 등급 {pack.manifest.contentRating}</span></p>
          {'characters' in pack && <p className="small">인물: {pack.characters.map((c) => c.name).join(', ')} · 지식 {pack.claims.length} · 관계 {pack.relations.length} · 이미지 {pack.assets.length} · 아이템 {pack.items.length}</p>}
          {!('characters' in pack) && <p className="small">아이템 {pack.items.length}{pack.genre?.terms ? ` · 용어 ${Object.keys(pack.genre.terms).length}` : ''}{pack.genre?.currency ? ` · 화폐 ${pack.genre.currency}` : ''}{pack.genre?.levelCap ? ` · 최대 레벨 ${pack.genre.levelCap}` : ''}</p>}
          {plan.blockers.map((b) => <p key={b} className="status">⛔ {b}</p>)}
          {plan.missingRequires.length > 0 && <p className="small warn-text">이 패키지가 쓰는 다른 패키지가 세계에 없습니다: {plan.missingRequires.map((r) => `${r.id}@${r.version}`).join(', ')} — 먼저 넣으면 좋습니다.</p>}
          {plan.warnings.map((x) => <p key={x} className="small muted">⚠ {x}</p>)}
          {plan.unknownLocations.length > 0 && (
            <label className="small">이 세계에 없는 장소({plan.unknownLocations.join(', ')})에 있던 인물을 둘 곳
              <select value={loc} onChange={(e) => setLoc(e.target.value)}>{w.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            </label>
          )}
          {plan.conflicts.length > 0 && (
            <table className="small flow-table">
              <thead><tr><th>겹치는 ID</th><th>세계에 있는 것</th><th>패키지의 것</th><th>어떻게</th></tr></thead>
              <tbody>{plan.conflicts.map((c) => (
                <tr key={c.id}><td>{c.kind} <code>{c.id}</code></td><td>{c.existing}</td><td>{c.incoming}</td>
                  <td><select value={resolve[c.id] ?? 'rename'} onChange={(e) => setResolve((x) => ({ ...x, [c.id]: e.target.value as Resolution }))}>
                    <option value="rename">새 ID로 넣기</option><option value="replace">패키지 것으로 바꾸기</option><option value="skip">넣지 않기</option>
                  </select></td></tr>
              ))}</tbody>
            </table>
          )}
          {'genre' in pack && pack.genre && (pack.genre.currency || pack.genre.levelCap) && (
            <label className="check small"><input type="checkbox" checked={genre} onChange={(e) => setGenre(e.target.checked)} /> 화폐·최대 레벨도 패키지 값으로 바꾸기</label>
          )}
          <button type="button" className="primary" disabled={plan.blockers.length > 0} onClick={apply}>세계에 넣기</button>
        </>
      )}
      {status && <p className="status small">{status}</p>}
    </div>
  );
}
