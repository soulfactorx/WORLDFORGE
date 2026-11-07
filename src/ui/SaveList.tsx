import { useLiveQuery } from 'dexie-react-hooks';
import { sourcesOf } from '../engine/sources';
import { endingsSeen } from './collection';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { genreOf } from '../data/genres';
import { classesFor } from '../engine/classes';
import { profileFor } from '../engine/profile';
import type { CharacterSheet } from '../engine/character/sheet';
import { hasErrors, validateWorld } from '../engine/package/validate';
import type { WorldPackage } from '../engine/schema';
import { startEvents } from '../gm/turn';
import { appendEvents, db, deleteSave, exportSave, importSave } from '../storage/db';
import { deletePackage, exportWpk, listPackages, MAX_FILE_BYTES, packageKey, parsePackageFile, PRIVATE_NOTE, savePackage } from '../storage/packages';
import { BlobZip } from '../importers/blobzip';
import { imageNeeds } from '../gm/worldgen/imageNeeds';
import { MoveInPanel, MoveOutButton } from './MovePanel';
import { MATURE_NOTE, shareBlocked } from '../engine/rating';
import { confirmAdult } from './adult';
import { ReskinContext } from './reskin';
import { reskinner } from '../engine/genre';
import { CharacterCreator } from './CharacterCreator';
import { IssueList } from './IssueList';

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  a.click();
  URL.revokeObjectURL(url);
}
const safeName = (s: string) => s.replace(/[^\w가-힣.-]+/g, '_');

type Tab = 'play' | 'worlds' | 'saves';
const TAB_KEY = 'worldforge.home.tab';
function loadTab(): Tab { try { const t = localStorage.getItem(TAB_KEY); return t === 'worlds' || t === 'saves' ? t : 'play'; } catch { return 'play'; } }
const RATING: Record<string, string> = { all: '전체', teen: '청소년', mature: '성인' };
const cutText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

/** 펼침 메뉴 — 자주 안 쓰는 동작을 한 버튼 뒤로 숨긴다 (v0.55) */
export function Menu({ label, title, children, className }: { label: ReactNode; title?: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className={`menu${className ? ` ${className}` : ''}`} ref={ref}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} title={title} onClick={() => setOpen((o) => !o)}>{label}</button>
      {open && <div className="menu-pop" role="menu" onChange={() => setOpen(false)} onClick={(e) => { if ((e.target as HTMLElement).closest('button')) setOpen(false); }}>{children}</div>}
    </div>
  );
}

export function SaveList({ onOpen, onEdit, onGenerate, onCard, onUserArt }: {
  onOpen: (saveId: string) => void; onEdit: (world: WorldPackage | null, library?: boolean) => void; onGenerate: () => void; onCard: (file: File, extras?: File[]) => void; onUserArt: () => void;
}) {
  const saves = useLiveQuery(() => db.saves.orderBy('updatedAt').reverse().toArray(), []);
  const packages = useLiveQuery(() => listPackages(), []);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [startId, setStartId] = useState('');
  const [receiving, setReceiving] = useState(false);
  const [tab, setTabState] = useState<Tab>(loadTab);
  const [filter, setFilter] = useState('');
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* 저장 못 해도 괜찮다 */ } };
  const [message, setMessage] = useState<{ text: string; issues?: ReturnType<typeof validateWorld> } | null>(null);

  const privateIds = new Set((packages ?? []).filter((p) => shareBlocked(p.world)).map((p) => p.world.manifest.id));
  const matureIds = new Set((packages ?? []).filter((p) => p.world.manifest.contentRating === 'mature').map((p) => p.world.manifest.id));
  const selected = packages?.find((p) => packageKey(p.world) === selectedKey) ?? packages?.[0];
  const world = selected?.world;
  const worldIssues = world ? validateWorld(world) : [];
  const playable = !!world && !hasErrors(worldIssues);

  async function newGame(character: CharacterSheet) {
    if (!world) return;
    const id = crypto.randomUUID();
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    await db.saves.add({ id, name: `${character.name} · ${world.manifest.name} — ${new Date().toLocaleString()}`, packageId: world.manifest.id, packageVersion: world.manifest.version, createdAt: Date.now(), updatedAt: Date.now() });
    const start = world.starts?.find((x) => x.id === startId) ? startId : world.starts?.[0]?.id;
    await appendEvents(id, startEvents(world, character, seed, start).map((event, seq) => ({ saveId: id, seq, turn: 0, event })));
    onOpen(id);
  }

  async function importPackage(file: File) {
    // 큰 파일·CHARX는 통째로 읽지 않고 카드인지 먼저 본다
    if (/\.risum$/i.test(file.name)) { onCard(file); return; }
    if (/\.charx$/i.test(file.name) || file.size > MAX_FILE_BYTES) {
      const zip = await BlobZip.open(file).catch(() => null);
      if (zip?.get('card.json')) { onCard(file); return; }
      if (file.size > MAX_FILE_BYTES) { setMessage({ text: '파일이 너무 큽니다 (패키지는 최대 20MB).' }); return; }
    }
    const parsed = parsePackageFile(file.name, new Uint8Array(await file.arrayBuffer()));
    // 캐릭터 카드를 패키지 가져오기에 넣었다면: 카드로 새 세계관을 만든다
    if (parsed.isCard) { onCard(file); return; }
    if (!parsed.world) { setMessage({ text: '패키지를 가져오지 못했습니다.', issues: parsed.issues }); return; }
    try {
      await savePackage(parsed.world, 'import');
      setSelectedKey(packageKey(parsed.world));
      setMessage({ text: `"${parsed.world.manifest.name}" 패키지를 가져왔습니다.${hasErrors(parsed.issues) ? ' 오류가 있어 편집 후 플레이할 수 있습니다.' : ''}`, issues: parsed.issues });
    } catch (e) {
      setMessage({ text: (e as Error).message });
    }
  }

  async function importSaveFile(file: File) {
    try { await importSave(await file.text()); setMessage({ text: '세이브를 가져왔습니다.' }); } catch (e) { setMessage({ text: (e as Error).message }); }
  }

  if (creating && world) return <ReskinContext.Provider value={reskinner(world)}><CharacterCreator classes={classesFor(world)} profile={profileFor(world)} onCreate={newGame} onCancel={() => setCreating(false)} /></ReskinContext.Provider>;

  const nameOf = new Map((packages ?? []).map((p) => [p.world.manifest.id, p.world.manifest.name]));
  const endingsLabel = (w: WorldPackage) => (w.endings?.length ? `결말 ${w.endings.filter((e) => endingsSeen(w.manifest.id).includes(e.id)).length}/${w.endings.length}` : '');
  const q = filter.trim().toLowerCase();
  const shown = (packages ?? []).filter((p) => !q || `${p.world.manifest.name} ${p.world.manifest.id} ${p.world.manifest.author ?? ''}`.toLowerCase().includes(q));
  const mine = shown.filter((p) => !p.builtin);
  const builtin = shown.filter((p) => p.builtin);
  // 세이브는 세계별로 묶는다 (최근에 한 세계부터)
  const groups: { id: string; list: NonNullable<typeof saves> }[] = [];
  for (const s of saves ?? []) { const g = groups.find((x) => x.id === s.packageId); if (g) g.list.push(s); else groups.push({ id: s.packageId, list: [s] }); }
  const open = (id: string, pkg: string) => { if (!matureIds.has(pkg) || confirmAdult()) onOpen(id); };
  const pickWorld = (w: WorldPackage) => { setSelectedKey(packageKey(w)); setTab('play'); };

  const saveRow = (s: NonNullable<typeof saves>[number], withWorld: boolean) => (
    <li key={s.id}>
      <span className="grow">{s.name}<br /><span className="muted small">{withWorld && nameOf.get(s.packageId) ? `${nameOf.get(s.packageId)} · ` : ''}{new Date(s.updatedAt).toLocaleString()}</span></span>
      <span className="row nowrap">
        <button className="primary" onClick={() => open(s.id, s.packageId)}>이어하기</button>
        <Menu label="⋯" title="더 보기">
          {privateIds.has(s.packageId)
            ? <span className="small muted" title="개인용 세계의 세이브는 파일로 내보낼 수 없습니다">🔒 내보내기 불가 — 세계의 📱 다른 기기로에 함께 담깁니다</span>
            : <button onClick={async () => { try { download(await exportSave(s.id), `${safeName(s.name)}.wfsave.json`); } catch (e) { setMessage({ text: (e as Error).message }); } }}>⤓ 파일로 내보내기</button>}
          <button className="danger" onClick={() => confirm('이 세이브를 삭제할까요?') && deleteSave(s.id)}>🗑 삭제</button>
        </Menu>
      </span>
    </li>
  );

  const worldRow = (p: NonNullable<typeof packages>[number]) => {
    const w = p.world;
    const n = !p.builtin ? imageNeeds(w).length : 0;
    const src = sourcesOf(w);
    return (
      <li key={packageKey(w)} className={selected && packageKey(selected.world) === packageKey(w) ? 'current' : ''}>
        <span className="grow">
          <b>{w.manifest.name}</b>
          <span className="muted small"> {genreOf(w.genre?.id).label} · {RATING[w.manifest.contentRating]}{endingsLabel(w) ? ` · ${endingsLabel(w)}` : ''}</span>
          <span className="badges">
            {w.manifest.private && <span className="need-badge" title={PRIVATE_NOTE}>🔒 개인용</span>}
            {!w.manifest.private && shareBlocked(w) && <span className="need-badge" title={MATURE_NOTE}>🔞 성인</span>}
            {src.length > 0 && <span className="need-badge" title={src.map((x) => x.name).join(' · ')}>출처 카드 {src.length}장</span>}
            {w.manifest.crossover?.length ? <span className="need-badge" title={`크로스오버: ${w.manifest.crossover.map((c) => c.name).join(' · ')}`}>🌌 크로스오버 {w.manifest.crossover.length}</span> : null}
            {n > 0 && <span className="need-badge" title="진짜 이미지가 없는 인물·장소 — 편집 → 이미지 탭, 또는 내 기본 이미지에 추천 파일 이름으로 올리면 자동으로 붙습니다">🖼 이미지 부족 {n}</span>}
          </span>
        </span>
        <span className="row nowrap">
          <button onClick={() => pickWorld(w)} title="이 세계로 새 게임">▶<span className="wide-only"> 플레이</span></button>
          <Menu label="⋯" title="편집·내보내기·삭제">
            <button onClick={() => {
              if (!p.builtin) { onEdit(w); return; }
              // 내장 패키지는 복제해서 편집한다
              const copy = structuredClone(w);
              copy.manifest = { ...copy.manifest, id: `${copy.manifest.id}-copy`, name: `${copy.manifest.name} (사본)` };
              onEdit(copy);
            }}>✎ {p.builtin ? '복제해서 편집' : '편집'}</button>
            {w.manifest.private || shareBlocked(w)
              ? <MoveOutButton world={w} onMessage={(text) => setMessage({ text })} />
              : <button onClick={() => download(exportWpk(w), `${safeName(w.manifest.id)}-${w.manifest.version}.wpk`)}>⤓ 패키지로 내보내기</button>}
            {!p.builtin && <button className="danger" onClick={() => confirm('이 패키지를 삭제할까요? 이 패키지를 쓰는 세이브는 열 수 없게 됩니다.') && deletePackage(p.stored!.key)}>🗑 삭제</button>}
            <span className="small muted">v{w.manifest.version} · {w.manifest.id}{w.manifest.author ? ` · ${w.manifest.author}` : ''}</span>
          </Menu>
        </span>
      </li>
    );
  };

  const overview = world?.overview?.trim();
  const start = world?.starts?.find((x) => x.id === startId) ?? world?.starts?.[0];

  return (
    <section className="panel home">
      <nav className="tabs home-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'play'} className={tab === 'play' ? 'on' : ''} onClick={() => setTab('play')}>▶ 플레이</button>
        <button role="tab" aria-selected={tab === 'worlds'} className={tab === 'worlds' ? 'on' : ''} onClick={() => setTab('worlds')}>🌍 세계관 <span className="count">{packages?.length ?? 0}</span></button>
        <button role="tab" aria-selected={tab === 'saves'} className={tab === 'saves' ? 'on' : ''} onClick={() => setTab('saves')}>💾 세이브 <span className="count">{saves?.length ?? 0}</span></button>
      </nav>

      {message && (
        <div className="status home-message">
          <span className="row"><span className="grow">{message.text}</span><button className="link" onClick={() => setMessage(null)}>닫기</button></span>
          {message.issues && message.issues.length > 0 && <IssueList issues={message.issues} />}
        </div>
      )}

      {tab === 'play' && (
        <>
          {saves && saves.length > 0 && (
            <>
              <h2>이어하기</h2>
              <ul className="saves">{saves.slice(0, 3).map((s) => saveRow(s, true))}</ul>
              {saves.length > 3 && <button className="link small" onClick={() => setTab('saves')}>세이브 {saves.length}개 모두 보기 →</button>}
            </>
          )}
          <h2>새 게임</h2>
          <div className="new-game">
            <label>세계관
              <select value={selected ? packageKey(selected.world) : ''} onChange={(e) => setSelectedKey(e.target.value)}>
                {packages?.map((p) => (
                  <option key={packageKey(p.world)} value={packageKey(p.world)}>
                    {p.world.manifest.name} v{p.world.manifest.version}{p.builtin ? ' (내장)' : ''}{p.world.manifest.aiAssisted ? ' ✦AI' : ''}{endingsLabel(p.world) ? ` · ${endingsLabel(p.world)}` : ''}
                  </option>
                ))}
              </select>
            </label>
            {world && (
              <p className="muted small">
                {genreOf(world.genre?.id).label} · 등급 {RATING[world.manifest.contentRating]}{world.manifest.author && <> · 제작 {world.manifest.author}</>}{world.manifest.aiAssisted && <> · ✦ AI 보조</>}{world.manifest.private && <> · 🔒 개인용 (원작: {world.manifest.private.source})</>}
              </p>
            )}
            {overview && (
              overview.length > 160
                ? <details className="world-blurb"><summary>{cutText(overview.replace(/\s+/g, " "), 160)} <span className="more">더 보기</span></summary><p>{overview}</p></details>
                : <p className="world-blurb">{overview}</p>
            )}
            {world?.starts && world.starts.length > 0 && (
              <label>시작 방식
                <select value={start?.id} onChange={(e) => setStartId(e.target.value)}>
                  {world.starts.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                </select>
                {start?.description && <span className="small muted">{start.description}</span>}
              </label>
            )}
            {!playable && world && <p className="status">❌ 이 패키지에는 오류가 있어 플레이할 수 없습니다. 편집에서 고쳐 주세요.</p>}
            <div className="row">
              <button className="primary" disabled={!playable} onClick={() => { if (world?.manifest.contentRating !== 'mature' || confirmAdult()) setCreating(true); }}>주인공 만들고 시작</button>
              <span className="small muted">당신은 이 세계에 대해 아무것도 모른 채 깨어납니다.</span>
            </div>
          </div>
        </>
      )}

      {tab === 'worlds' && (
        <>
          <div className="row toolbar">
            <Menu label="＋ 만들기 ▾" className="primary-menu">
              <button onClick={() => onEdit(null)}>＋ 빈 세계관에서 직접 만들기</button>
              <button onClick={onGenerate}>✦ AI로 세계관 만들기</button>
              <button onClick={() => onEdit(null, true)}>🌌 만계서고에서 골라 크로스오버 세계 만들기 (AI 없이)</button>
              <label className="file">✦ 캐릭터 카드로 만들기 (.charx · .risum · .png · .json — 모듈 등 여러 파일을 함께 골라도 된다)
                <input type="file" multiple accept=".charx,.risum,.png,.json,application/json,image/png,application/zip" onChange={(e) => {
                  const fs = [...(e.target.files ?? [])];
                  // 본 카드: 모듈(.risum)이 아닌 첫 파일 — 나머지는 함께 분석할 추가 파일
                  const main = fs.find((f) => !/\.risum$/i.test(f.name)) ?? fs[0];
                  if (main) onCard(main, fs.filter((f) => f !== main));
                  e.target.value = '';
                }} />
              </label>
            </Menu>
            <Menu label="⤒ 가져오기 ▾">
              <label className="file">패키지 파일 (.wpk · .json)
                <input type="file" accept=".wpk,.zip,.json,.charx,.risum,.png,application/zip,application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) importPackage(f); e.target.value = ''; }} />
              </label>
              <button onClick={() => setReceiving(true)} title="다른 기기에서 만든 개인용 세계를 AI 없이 이어받기">📲 옮겨 온 세계 받기 (.wfmove)</button>
            </Menu>
            <button onClick={() => onEdit(null, true)} title="만계서고 — 모든 세계(우주)의 인물·장소·임무·이야기 흐름·이미지를 한곳에서 찾아 골라 크로스오버 세계를 만든다">🌌 만계서고</button>
            <button onClick={onUserArt}>🖼 내 기본 이미지</button>
            {(packages?.length ?? 0) > 6 && <input className="grow filter" type="search" placeholder="세계관 찾기" value={filter} onChange={(e) => setFilter(e.target.value)} />}
          </div>
          {receiving && <MoveInPanel onClose={() => setReceiving(false)} onDone={(w) => setSelectedKey(packageKey(w))} />}
          <h2>내 세계관 <span className="muted small">{mine.length}</span></h2>
          {mine.length > 0
            ? <ul className="saves">{mine.map(worldRow)}</ul>
            : <p className="muted small">{q ? '찾는 세계관이 없습니다.' : '아직 만든 세계관이 없습니다. ＋ 만들기에서 시작하거나, 아래 내장 세계관을 복제해서 고쳐 보세요.'}</p>}
          <details className="fold" open={mine.length === 0 || !!q}>
            <summary><h2>내장 세계관 <span className="muted small">{builtin.length}</span></h2></summary>
            <ul className="saves">{builtin.map(worldRow)}</ul>
          </details>
          <p className="muted small">세계관과 세이브는 이 브라우저에 저장됩니다.</p>
        </>
      )}

      {tab === 'saves' && (
        <>
          <div className="row toolbar">
            <label className="file file-btn">⤒ 세이브 파일 가져오기
              <input type="file" accept=".json,application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) importSaveFile(f); e.target.value = ''; }} />
            </label>
          </div>
          <p className="muted small">브라우저 데이터 삭제에 대비해 가끔 ⋯ → 파일로 내보내기로 백업하세요.</p>
          {groups.length === 0 && <p className="muted">세이브가 없습니다.</p>}
          {groups.map((g, i) => (
            <details key={g.id} className="fold" open={i === 0 || groups.length <= 2}>
              <summary><h2>{nameOf.get(g.id) ?? `${g.id} (없는 세계관)`} <span className="muted small">{g.list.length}</span></h2></summary>
              <ul className="saves">{g.list.map((s) => saveRow(s, false))}</ul>
            </details>
          ))}
        </>
      )}
    </section>
  );
}
