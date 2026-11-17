/**
 * 흐름도 ＋ 「만계서고에서」 (v0.158): 내 에셋·다른 세계의 것을 골라 복사해 붙인다 (고른 상자 다음에 이어 붙이기).
 */
import { useEffect, useMemo, useState } from 'react';
import { BORROW_LABEL, type BorrowKind, catalogOf, dependencies } from '../engine/borrow';
import type { Condition, WorldPackage } from '../engine/schema';
import { FLOW_IMPORT_KINDS, importFromLibrary } from '../gm/flowImport';
import { assetBlob, storeAssets } from '../storage/assets';
import { isMyAssets } from '../storage/myAssets';
import { listPackages } from '../storage/packages';
import { AssetImage } from './AssetImage';

type Src = { world: WorldPackage; mine: boolean };
const LIMIT = 80;

export function FlowLibrary({ w, kind: kind0, after, afterName, onApply, onClose }: {
  w: WorldPackage; kind?: BorrowKind; after?: Condition; afterName?: string;
  onApply: (world: WorldPackage, note: string, newKey?: string) => void; onClose: () => void;
}) {
  const [srcs, setSrcs] = useState<Src[] | null>(null);
  const [hidden, setHidden] = useState(0);
  const [kind, setKind] = useState<BorrowKind>(kind0 ?? 'quest');
  const [from, setFrom] = useState('all');
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<{ src: string; id: string } | null>(null);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    void listPackages().then((all) => {
      const ok = all.filter((p) => p.world.manifest.id !== w.manifest.id);
      const allowed = ok.filter((p) => p.world.manifest.contentRating !== 'mature' || w.manifest.contentRating === 'mature');
      setHidden(ok.length - allowed.length);
      // 같은 세계의 여러 버전은 최신 하나만, 내 에셋을 맨 앞에
      const seen = new Set<string>();
      const uniq = allowed.filter((p) => (seen.has(p.world.manifest.id) ? false : (seen.add(p.world.manifest.id), true)));
      setSrcs(uniq.map((p) => ({ world: p.world, mine: isMyAssets(p.world) })).sort((a, b) => Number(b.mine) - Number(a.mine)));
    });
  }, [w.manifest.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = useMemo(() => (srcs ?? []).filter((s) => from === 'all' || s.world.manifest.id === from).flatMap((s) =>
    catalogOf(s.world).filter((e) => e.kind === kind && !(s.mine && e.id === 'loc/start') && words.every((t) => e.hay.toLowerCase().includes(t) || e.name.toLowerCase().includes(t)))
      .map((e) => ({ s, e }))), [srcs, from, kind, q]);
  const chosen = pick ? rows.find((r) => r.s.world.manifest.id === pick.src && r.e.id === pick.id) : undefined;
  const deps = chosen ? dependencies(chosen.s.world, [{ kind: chosen.e.kind, id: chosen.e.id }]).length : 0;

  async function apply() {
    if (!chosen) return;
    setBusy('붙이는 중…');
    try {
      const r = importFromLibrary(w, chosen.s.world, { kind: chosen.e.kind, id: chosen.e.id }, after);
      if (r.copies.length) {
        setBusy(`그림 복사 중… 0/${r.copies.length}`);
        await storeAssets(w.manifest.id, r.copies.map((c) => ({ id: c.toId, read: async () => { const b = await assetBlob(c.fromPkg, c.fromId); if (!b) throw new Error('없음'); return b; } })), (d, t) => setBusy(`그림 복사 중… ${d}/${t}`));
      }
      const n = Object.values(r.added).reduce((a, b) => a + (b ?? 0), 0);
      onApply(r.world, `🌌 「${r.newName ?? chosen.e.name}」을(를) ${chosen.s.mine ? '내 에셋' : `「${chosen.s.world.manifest.name}」`}에서 가져왔습니다${n > 1 ? ` (딸린 것 포함 ${n}개)` : ''}${after && afterName ? ` — 「${afterName}」 다음에 이었습니다` : ''}.${r.notes.length ? ` ${r.notes.slice(0, 2).join(' ')}` : ''}`, r.newKey);
    } catch (e) { setBusy(`❌ ${(e as Error).message}`); }
  }

  return (
    <div className="flow-dialog-back" onClick={(e) => { if (e.target === e.currentTarget && !busy.endsWith('…')) onClose(); }}>
      <div className="flow-dialog flow-library" role="dialog" aria-modal="true" aria-label="만계서고에서 가져오기">
        <div className="row"><b>🌌 만계서고에서 가져오기{afterName ? ` — 「${afterName}」 다음에` : ''}</b><span className="spacer" /><button type="button" className="small" onClick={onClose} aria-label="닫기">✕</button></div>
        <p className="small muted">⭐ 내 에셋과 만들어 둔 세계의 것을 복사해 붙입니다 (딸린 것·그림·출처 함께). 원래 것은 그대로입니다.</p>
        <div className="row flow-nums">
          <label>종류<select value={kind} onChange={(e) => { setKind(e.target.value as BorrowKind); setPick(null); }}>{FLOW_IMPORT_KINDS.map((k) => <option key={k} value={k}>{BORROW_LABEL[k]}</option>)}</select></label>
          <label>어디서<select value={from} onChange={(e) => { setFrom(e.target.value); setPick(null); }}>
            <option value="all">모든 곳</option>
            {(srcs ?? []).map((s) => <option key={s.world.manifest.id} value={s.world.manifest.id}>{s.mine ? s.world.manifest.name : `🌍 ${s.world.manifest.name}`}</option>)}
          </select></label>
        </div>
        <input type="search" placeholder="🔍 이름·설명으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
        {hidden > 0 && <p className="small muted">성인 등급 세계 {hidden}곳은 이 세계로 가져올 수 없어 숨겼습니다.</p>}
        {!srcs ? <p className="small muted">불러오는 중…</p> : !rows.length ? <p className="small muted">찾는 {BORROW_LABEL[kind]}이(가) 없습니다.{(srcs ?? []).some((s) => s.mine) ? '' : ' 흐름도 상자의 「⭐ 에셋으로 보관」으로 내 에셋을 모아 보세요.'}</p> : (
          <ul className="flow-lib-list">
            {rows.slice(0, LIMIT).map(({ s, e }) => {
              const on = pick?.src === s.world.manifest.id && pick.id === e.id;
              return (
                <li key={`${s.world.manifest.id}|${e.id}`}>
                  <button type="button" className={`flow-lib-item${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setPick({ src: s.world.manifest.id, id: e.id })}>
                    {e.thumb ? <AssetImage pkg={s.world.manifest.id} id={e.thumb} alt="" className="flow-lib-thumb" /> : e.portrait ? <img src={e.portrait} alt="" className="flow-lib-thumb" /> : null}
                    <span className="flow-lib-text"><b>{e.name}</b><span className="small muted">{s.mine ? '⭐ 내 에셋' : s.world.manifest.name}{s.world.manifest.private ? ' 🔒' : ''}{e.sub ? ` · ${e.sub}` : ''}</span></span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {rows.length > LIMIT && <p className="small muted">{rows.length - LIMIT}개 더 있습니다 — 찾기로 좁혀 보세요.</p>}
        {busy && <p className="small status">{busy}</p>}
        <div className="row flow-dialog-actions">
          {chosen && <span className="small muted flow-lib-deps">{deps ? `딸린 것 ${deps}개도 함께 옵니다.` : '딸린 것 없이 하나만 옵니다.'}{chosen.s.world.manifest.private ? ' 다른 사람의 카드에서 온 것이면 개인용으로 표시됩니다.' : ''}</span>}
          <button type="button" className="primary" disabled={!chosen || busy.endsWith('…')} onClick={() => void apply()}>붙이기</button>
          <button type="button" onClick={onClose} disabled={busy.endsWith('…')}>취소</button>
        </div>
      </div>
    </div>
  );
}
