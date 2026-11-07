import { useEffect, useMemo, useState } from 'react';
import type { AssetMeta, WorldPackage } from '../engine/schema';
import { readCharxBundle, type CharxBundle } from '../importers/bundle';
import { buildEntities, type Candidate, inferCandidates, type Inference, matchCardImages, SOURCE_LABEL } from '../importers/inferCharacters';
import { portraitDataUrl } from '../importers/portrait';
import type { LlmSettings } from '../llm/types';
import { db } from '../storage/db';

export interface ImportedEntities {
  /** 가져온 카드의 이름 (빈 세계를 카드로 만들 때 세계 이름으로) */
  cardName?: string;
  characters: import('../engine/schema').Character[];
  facts: import('../engine/schema').Fact[];
  claims: import('../engine/schema').Claim[];
  beliefs: import('../engine/schema').Belief[];
  /** 카드의 이미지 (v0.52): 세계 이미지로 저장할 것 */
  assets?: AssetMeta[];
  images?: { id: string; read: () => Promise<Blob> }[];
  /** 출처 카드 (v0.53) */
  source?: { hash: string; name: string; creator?: string; fileName?: string; format?: string };
}

const PAGE = 40;
interface Row { key: string; name: string; pick: boolean; gender?: 'M' | 'F'; source: Candidate['source']; why: string; title?: string }

/**
 * 캐릭터 카드 가져오기 (v0.52): 용량 제한 없이 읽고(스트리밍), AI 없이 데이터만으로 인물 후보를 찾고,
 * 카드의 이미지를 전부 불러와 인물에 붙인다 (이름 규칙 + 손으로 고치기).
 */
export function CardImportDialog({ world, onAdd, onClose, initialFile }: {
  world: WorldPackage; settings?: LlmSettings | null; onAdd: (e: ImportedEntities) => void; onClose: () => void;
  /** 홈 화면에서 넘겨받은 카드 파일 (바로 연다) */
  initialFile?: File;
}) {
  const [bundle, setBundle] = useState<CharxBundle | null>(null);
  const [inf, setInf] = useState<Inference | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [locationId, setLocationId] = useState(world.start.locationId);
  const [loreAsKnowledge, setLoreAsKnowledge] = useState(true);
  const [keepAll, setKeepAll] = useState(true);
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => { if (initialFile) void load(initialFile); }, [initialFile]);

  async function load(file: File) {
    setError(''); setBundle(null); setInf(null); setOverrides({}); setPage(0);
    setBusy('카드 읽는 중…');
    try {
      const b = await readCharxBundle(file, file.name, (m) => setBusy(m));
      const i = inferCandidates(b);
      setBundle(b); setInf(i);
      setRows(i.candidates.map((c) => ({ key: c.key, name: c.name, pick: c.pick, source: c.source, why: c.why, ...(c.gender ? { gender: c.gender } : {}), ...(c.title ? { title: c.title } : {}) })));
      // 원본은 이 브라우저에 보존한다 (아주 큰 파일은 메모리를 아끼려 건너뛴다)
      if (file.size <= 64 * 1024 * 1024) {
        try { await db.imports.put({ id: crypto.randomUUID(), fileName: file.name, format: b.card.format, bytes: new Uint8Array(await file.arrayBuffer()), importedAt: Date.now() }); } catch { /* 저장소가 없으면 생략 */ }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(''); }
  }

  // 이미지 자동 연결 (후보 key를 임시 ID로) + 손으로 고친 것
  const picked = rows.filter((r) => r.pick);
  const auto = useMemo(() => (bundle ? matchCardImages(bundle, picked.map((r) => ({ id: r.key, name: r.name, aliases: [inf?.candidates.find((c) => c.key === r.key)?.latin ?? ''], ...(r.gender ? { gender: r.gender } : {}) })), world, 'tmp') : []),
    [bundle, picked.map((r) => `${r.key}=${r.name}`).join('|')]);
  const owner = (i: number): string => (i in overrides ? overrides[i]! : auto[i]?.characterId ?? '');
  const assets = bundle?.assets ?? [];
  const shown = assets.map((_, i) => i).filter((i) => filter === 'all' || (filter === 'none' ? !owner(i) : owner(i) === filter));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pageItems = shown.slice(page * PAGE, page * PAGE + PAGE);

  // 지금 쪽의 썸네일만 불러온다 (수천 장도 가볍게)
  useEffect(() => {
    if (!bundle) return;
    let live = true;
    const made: string[] = [];
    (async () => {
      const t: Record<number, string> = {};
      for (const i of pageItems) {
        try { const url = URL.createObjectURL(await bundle.assets[i]!.read()); made.push(url); t[i] = url; } catch { /* 깨진 이미지 */ }
        if (!live) return;
      }
      if (live) setThumbs(t);
    })();
    return () => { live = false; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [bundle, page, filter, shown.length]);

  const counts = useMemo(() => { const c: Record<string, number> = {}; assets.forEach((_, i) => { const o = owner(i); if (o) c[o] = (c[o] ?? 0) + 1; }); return c; }, [auto, overrides, assets.length]);

  async function add() {
    if (!bundle || !inf) return;
    setBusy('인물 만드는 중…');
    try {
      const ents = buildEntities(world, bundle, { inference: inf, picked: picked.map((r) => ({ key: r.key, name: r.name.trim() || r.key, ...(r.gender ? { gender: r.gender } : {}) })), loreAsKnowledge, locationId, mature: world.manifest.contentRating === 'mature' });
      // 이미지: 인물 key → 실제 ID, 손으로 고친 연결 반영, 세계 에셋 ID로
      const prefix = `card.${(bundle.fingerprint || 'x').slice(0, 8)}.`;
      const taken = new Set((world.assets ?? []).map((a) => a.id));
      const metas: AssetMeta[] = [];
      const images: { id: string; read: () => Promise<Blob> }[] = [];
      assets.forEach((a, i) => {
        const key = owner(i);
        const cid = key ? ents.keyOf.get(key) : undefined;
        const base = auto[i]!;
        const meta: AssetMeta = cid
          ? { ...base, kind: 'character', characterId: cid, tags: base.characterId === key ? base.tags : ['default'], id: `${prefix}${i}` }
          : (() => { const { characterId: _c, ...rest } = base; return { ...rest, ...(base.kind === 'character' ? { kind: 'other' as const } : {}), id: `${prefix}${i}` }; })();
        if (!cid && !keepAll) return;
        if (taken.has(meta.id)) return;
        metas.push(meta);
        images.push({ id: meta.id, read: () => a.read() });
      });
      // 초상화: 인물마다 기본 이미지 하나를 작게
      setBusy('초상화 만드는 중…');
      for (const c of ents.characters) {
        const m = metas.find((x) => x.characterId === c.id && x.tags.includes('default')) ?? metas.find((x) => x.characterId === c.id);
        if (!m) continue;
        try { const blob = await images[metas.indexOf(m)]!.read(); const url = await portraitDataUrl(new Uint8Array(await blob.arrayBuffer()), blob.type || m.mime); if (url) c.portrait = url; } catch { /* 없이 */ }
      }
      onAdd({ characters: ents.characters, facts: ents.facts, claims: ents.claims, beliefs: ents.beliefs, cardName: bundle.card.name, assets: metas, images,
        source: { hash: bundle.fingerprint, name: bundle.card.name, ...(bundle.card.creator ? { creator: bundle.card.creator } : {}), fileName: bundle.fileName, format: bundle.card.format } });
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(''); }
  }

  const upRow = (k: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...p } : r)));
  const nKnow = inf && loreAsKnowledge ? inf.analyzed.filter((a) => a.kind === 'world' && inf.card.lore[a.index]!.enabled && !picked.some((p) => inf.candidates.find((c) => c.key === p.key)?.entry === a.index)).length : 0;
  const nImg = keepAll ? assets.length : assets.filter((_, i) => owner(i)).length;

  return (
    <div className="dialog card-import">
      <div className="row">
        <b>캐릭터 카드 가져오기</b>
        <span className="muted small">RisuAI CHARX · Character Card V3/V2/V1 (.charx · .png · .json) · 용량 제한 없음</span>
        <span className="spacer" />
        <button type="button" onClick={onClose}>닫기</button>
      </div>
      <p className="muted small">
        AI 없이 카드의 데이터(로어북·프로필 낱말·카드 본인·이미지 이름)만으로 인물 목록을 만들고, 카드의 이미지를 전부 불러와 인물에 붙입니다.
        스크립트는 실행하지 않고, 시스템 프롬프트류는 쓰지 않습니다. 원작자의 권리와 배포 조건을 확인해 주세요.
      </p>
      <label className="file">카드 파일 선택
        <input type="file" accept=".charx,.png,.json,application/json,image/png,application/zip" disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ''; }} />
      </label>
      {busy && <p className="status"><span className="spinner" /> {busy}</p>}
      {error && <p className="status">❌ {error}</p>}
      {bundle && inf && (
        <>
          <p className="small"><b>{bundle.card.name}</b> <span className="muted">{bundle.card.format.toUpperCase()}{bundle.card.creator && ` · 제작 ${bundle.card.creator}`} · {(bundle.fileSize / 1048576).toFixed(1)}MB · 로어북 {inf.card.lore.length}항목 · 이미지 {assets.length.toLocaleString()}장</span></p>
          {bundle.warnings.length > 0 && <p className="small warn">{bundle.warnings.join(' · ')}</p>}

          <fieldset>
            <legend>인물 후보 {rows.length}명 (데이터로 추정 — 고르고 이름을 고칠 수 있다)</legend>
            {rows.length === 0 && <p className="muted small">인물로 보이는 데이터를 찾지 못했습니다.</p>}
            <div className="cand-list">
              {rows.map((r) => (
                <div key={r.key} className={`cand-row ${r.pick ? '' : 'off'}`}>
                  <input type="checkbox" checked={r.pick} onChange={(e) => upRow(r.key, { pick: e.target.checked })} aria-label={`${r.name} 가져오기`} />
                  <input className="cand-name" value={r.name} onChange={(e) => upRow(r.key, { name: e.target.value })} />
                  <select value={r.gender ?? ''} onChange={(e) => upRow(r.key, { gender: (e.target.value || undefined) as Row['gender'] })}><option value="">성별?</option><option value="F">여</option><option value="M">남</option></select>
                  <span className="tag">{SOURCE_LABEL[r.source]}</span>
                  {r.pick && <button type="button" className="small link" onClick={() => { setFilter(r.key); setPage(0); }}>🖼 {counts[r.key] ?? 0}</button>}
                  <span className="small muted cand-why">{r.title ? `${r.title} · ` : ''}{r.why}</span>
                </div>
              ))}
            </div>
            <div className="row">
              <button type="button" className="small" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, pick: true })))}>모두 고르기</button>
              <button type="button" className="small" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, pick: false })))}>모두 빼기</button>
            </div>
          </fieldset>

          <div className="form-grid">
            <label>인물을 둘 장소
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>{world.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            </label>
            <label className="check"><input type="checkbox" checked={loreAsKnowledge} onChange={(e) => setLoreAsKnowledge(e.target.checked)} /> 인물이 아닌 로어북 항목을 세계 지식으로 ({nKnow}항목)</label>
            <label className="check"><input type="checkbox" checked={keepAll} onChange={(e) => setKeepAll(e.target.checked)} /> 인물에 붙지 않은 이미지도 세계 이미지로 저장 (이미지 탭에서 나중에 붙일 수 있다)</label>
          </div>

          {assets.length > 0 && (
            <fieldset>
              <legend>카드 이미지 {assets.length.toLocaleString()}장 — 인물에 붙이기</legend>
              <div className="row">
                <select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(0); }}>
                  <option value="all">전체 ({assets.length})</option>
                  <option value="none">인물 없음 ({assets.length - Object.values(counts).reduce((a, n) => a + n, 0)})</option>
                  {picked.map((r) => <option key={r.key} value={r.key}>{r.name} ({counts[r.key] ?? 0})</option>)}
                </select>
                <span className="spacer" />
                <button type="button" className="small" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>◀</button>
                <span className="small">{page + 1} / {pages}</span>
                <button type="button" className="small" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>▶</button>
              </div>
              <div className="card-gallery">
                {pageItems.map((i) => (
                  <figure key={i}>
                    {thumbs[i] ? <img src={thumbs[i]} alt={assets[i]!.name} loading="lazy" /> : <span className="asset-ph" />}
                    <figcaption title={assets[i]!.name}>{assets[i]!.name}</figcaption>
                    <select value={owner(i)} onChange={(e) => setOverrides((o) => ({ ...o, [i]: e.target.value }))}>
                      <option value="">(인물 없음)</option>
                      {picked.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                    </select>
                  </figure>
                ))}
              </div>
            </fieldset>
          )}

          <div className="row">
            <span className="spacer" />
            <button type="button" className="primary" disabled={!!busy || (!picked.length && !nKnow)} onClick={add}>
              {busy || `인물 ${picked.length}명 · 지식 ${nKnow}항목 · 이미지 ${nImg.toLocaleString()}장 추가`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
