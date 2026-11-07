import { useState } from 'react';
import type { WorldPackage } from '../engine/schema';
import { sourcesOf } from '../engine/sources';
import { type CharxBundle, readCharxBundle } from '../importers/bundle';
import { exportMove, importMove, missingCards, type MoveHeader, readMoveHeader } from '../storage/move';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 라이브러리의 개인용 세계 줄에 붙는 "다른 기기로" 버튼 */
export function MoveOutButton({ world, onMessage }: { world: WorldPackage; onMessage: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const byPass = !world.manifest.private;
  const needsCard = !byPass && !world.manifest.private?.cardHash;
  async function run(cardFile?: File) {
    let pass: string | undefined;
    if (byPass) {
      // 직접 만든 성인 등급 세계: 암호로 잠근다
      pass = prompt('옮기기 암호를 정하세요 (4자 이상). 받는 기기에서 이 암호가 필요합니다.') ?? undefined;
      if (!pass) return;
      if (prompt('암호를 한 번 더 입력하세요.') !== pass) { onMessage('❌ 암호가 서로 다릅니다.'); return; }
    }
    setBusy(true);
    try {
      const card = cardFile ? await readCharxBundle(cardFile, cardFile.name) : undefined;
      const blob = await exportMove(world, card, pass);
      download(blob, `worldforge-${world.manifest.id.replace(/[^\w.-]+/g, "_")}.wfmove`);
      onMessage(`"${world.manifest.name}" 옮기기 파일을 만들었습니다 (${(blob.size / 1048576).toFixed(1)}MB). 다른 기기의 WORLDFORGE에서 "옮겨 온 세계 받기"로 이 파일과 ${byPass ? '정한 암호' : `원본 카드 파일 ${sourcesOf(world).length || 1}장`}을 함께 쓰세요.`);
    } catch (e) { onMessage(`❌ ${(e as Error).message}`); } finally { setBusy(false); }
  }
  if (needsCard) {
    return (
      <label className="file small" title="이 세계는 카드 지문이 저장되기 전에 만들어서, 원본 카드 파일을 한 번 골라야 합니다">📱 다른 기기로 (원본 카드 고르기)
        <input type="file" accept=".charx,.png,.json,application/zip,image/png,application/json" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = ''; }} />
      </label>
    );
  }
  return <button disabled={busy} onClick={() => run()} title="AI를 다시 쓰지 않고 내 다른 기기(스마트폰 등)에서 이어서 플레이">{busy ? '만드는 중…' : '📱 다른 기기로'}</button>;
}

/** 받기: 옮기기 파일 + 원본 카드 */
export function MoveInPanel({ onDone, onClose }: { onDone: (world: WorldPackage) => void; onClose: () => void }) {
  const [move, setMove] = useState<File | null>(null);
  const [info, setInfo] = useState<{ worldName: string; cardName: string; lock?: 'card' | 'pass'; cards?: MoveHeader['cards'] } | null>(null);
  const [cards, setCards] = useState<{ blob: File; name: string; bundle: CharxBundle }[]>([]);
  const [pass, setPass] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function pickMove(f: File) {
    setStatus('');
    try { const h = await readMoveHeader(f); setMove(f); setCards([]); setInfo({ worldName: h.worldName, cardName: h.cardName, lock: h.lock, ...(h.cards ? { cards: h.cards } : {}) }); }
    catch (e) { setStatus(`❌ ${(e as Error).message}`); }
  }
  /** 카드 파일 고르기 (여러 장): 지문을 읽어 필요한 카드인지 표시한다 (v0.53) */
  async function addCards(files: File[]) {
    setBusy(true);
    try {
      const got = [...cards];
      for (const [i, f] of files.entries()) {
        setStatus(`카드 읽는 중… (${i + 1}/${files.length}) ${f.name}`);
        const bundle = await readCharxBundle(f, f.name);
        if (!got.some((g) => g.bundle.fingerprint === bundle.fingerprint)) got.push({ blob: f, name: f.name, bundle });
      }
      setCards(got);
      setStatus('');
      // 예전 파일(카드 한 장, 목록 없음)은 고르자마자 받는다
      if (!info?.cards?.length && got.length) await receive(got);
    } catch (e) { setStatus(`❌ ${(e as Error).message}`); } finally { setBusy(false); }
  }
  const have = cards.map((c) => c.bundle.fingerprint);
  const missing = info?.cards ? missingCards({ cards: info.cards } as MoveHeader, have) : [];
  async function pickCard(card: File | null) { await receive(card ? [{ blob: card, name: card.name, bundle: await readCharxBundle(card, card.name) }] : null); }
  async function receive(list: { blob: File; name: string; bundle: CharxBundle }[] | null) {
    if (!move) return;
    setBusy(true);
    try {
      const r = await importMove(move, list, '', (m, d, t) => setStatus(`${m}${d !== undefined ? ` ${d}/${t}` : ''}`), pass || undefined);
      setStatus(`✓ "${r.world.manifest.name}"을(를) 받았습니다 — 이미지 ${r.images}장, 세이브 ${r.saves}개. 세이브 목록에서 이어하기를 누르세요.`);
      onDone(r.world);
    } catch (e) { setStatus(`❌ ${(e as Error).message}`); } finally { setBusy(false); }
  }

  return (
    <div className="dialog move-panel">
      <div className="row"><b>📲 옮겨 온 세계 받기</b><span className="spacer" /><button onClick={onClose}>닫기</button></div>
      <p className="small muted">다른 기기에서 <b>📱 다른 기기로</b>로 만든 <code>.wfmove</code> 파일과, 그 세계를 만든 <b>원본 카드 파일</b>(.charx 등)을 고르세요. AI를 다시 쓰지 않고 세계·세이브를 그대로 이어 갑니다. 카드 이미지는 카드 파일에서 다시 읽습니다.</p>
      <label className="file">① 옮기기 파일 (.wfmove)
        <input type="file" accept=".wfmove,application/octet-stream,application/zip" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) pickMove(f); e.target.value = ''; }} />
      </label>
      {info?.lock === 'pass' && (
        <>
          <p className="small">세계: <b>{info.worldName}</b> · 암호로 잠긴 파일</p>
          <div className="row">
            <label>② 옮기기 암호<input type="password" value={pass} disabled={busy} onChange={(e) => setPass(e.target.value)} /></label>
            <button className="primary" disabled={busy || pass.length < 4} onClick={() => pickCard(null)}>받기</button>
          </div>
        </>
      )}
      {info && info.lock !== 'pass' && (
        <>
          <p className="small">세계: <b>{info.worldName}</b> · 필요한 카드 {info.cards?.length ?? 1}장</p>
          {info.cards?.length ? (
            <ul className="small move-cards">
              {info.cards.map((c) => <li key={c.hash} className={have.includes(c.hash) ? 'ok' : ''}>{have.includes(c.hash) ? '✓' : '○'} <b>{c.name}</b>{c.fileName && <span className="muted"> ({c.fileName})</span>}</li>)}
            </ul>
          ) : <p className="small">필요한 카드: <b>{info.cardName}</b></p>}
          <label className="file">② 원본 카드 파일{info.cards && info.cards.length > 1 ? ' (여러 장 한꺼번에 골라도 된다)' : ''}
            <input type="file" multiple accept=".charx,.png,.json,application/zip,image/png,application/json" disabled={busy} onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) void addCards(fs); e.target.value = ''; }} />
          </label>
          {info.cards?.length ? (
            <div className="row">
              {missing.length > 0 && <span className="small warn-text">빠진 카드 {missing.length}장 — 모든 원본 파일이 있어야 열린다</span>}
              <span className="spacer" />
              <button className="primary" disabled={busy || missing.length > 0} onClick={() => receive(cards)}>받기</button>
            </div>
          ) : null}
        </>
      )}
      {status && <p className="status small">{status}</p>}
    </div>
  );
}
