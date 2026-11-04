import { useState } from 'react';
import type { WorldPackage } from '../engine/schema';
import { readCharxBundle } from '../importers/bundle';
import { exportMove, importMove, readMoveHeader } from '../storage/move';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 라이브러리의 개인용 세계 줄에 붙는 "다른 기기로" 버튼 */
export function MoveOutButton({ world, onMessage }: { world: WorldPackage; onMessage: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const needsCard = !world.manifest.private?.cardHash;
  async function run(cardFile?: File) {
    setBusy(true);
    try {
      const card = cardFile ? await readCharxBundle(cardFile, cardFile.name) : undefined;
      const blob = await exportMove(world, card);
      download(blob, `worldforge-${world.manifest.id.replace(/[^\w.-]+/g, "_")}.wfmove`);
      onMessage(`"${world.manifest.name}" 옮기기 파일을 만들었습니다 (${(blob.size / 1048576).toFixed(1)}MB). 다른 기기의 WORLDFORGE에서 "옮겨 온 세계 받기"로 이 파일과 원본 카드 파일을 함께 고르세요.`);
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
  const [info, setInfo] = useState<{ worldName: string; cardName: string } | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function pickMove(f: File) {
    setStatus('');
    try { const h = await readMoveHeader(f); setMove(f); setInfo({ worldName: h.worldName, cardName: h.cardName }); }
    catch (e) { setStatus(`❌ ${(e as Error).message}`); }
  }
  async function pickCard(card: File) {
    if (!move) return;
    setBusy(true);
    try {
      const r = await importMove(move, card, card.name, (m, d, t) => setStatus(`${m}${d !== undefined ? ` ${d}/${t}` : ''}`));
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
      {info && (
        <>
          <p className="small">세계: <b>{info.worldName}</b> · 필요한 카드: <b>{info.cardName}</b></p>
          <label className="file">② 원본 카드 파일
            <input type="file" accept=".charx,.png,.json,application/zip,image/png,application/json" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) pickCard(f); e.target.value = ''; }} />
          </label>
        </>
      )}
      {status && <p className="status small">{status}</p>}
    </div>
  );
}
