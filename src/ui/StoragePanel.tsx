/**
 * 저장소 관리 (v0.77): 이 브라우저에 저장된 것 — 종류별 총량, 세계관별 세부(버전·이미지·세이브·디버그), 정리.
 * 지우는 동작은 모두 확인을 받고, 세계관 본체(최신 버전)와 쓰는 이미지는 여기서 지우지 않는다 (세계관 목록에서).
 */
import { useEffect, useState } from 'react';
import { deleteSave } from '../storage/db';
import { clearDebug, clearGenCache, deleteDebugIds, deleteDebugOfSaves, deleteEventsOf, deleteImageKeys, deleteImport, deleteOldVersions, fmtBytes, storageReport, type StorageReport, type WorldStorage } from '../storage/report';

const day = (at: number) => new Date(at).toLocaleDateString('ko-KR');

export function StoragePanel({ onClose }: { onClose: () => void }) {
  const [r, setR] = useState<StorageReport | null>(null);
  const [stage, setStage] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => { let live = true; setStage('세는 중…'); void storageReport((s) => live && setStage(s)).then((x) => { if (live) { setR(x); setStage(''); } }); return () => { live = false; }; }, [tick]);
  const refresh = () => setTick((n) => n + 1);
  async function act(what: string, ask: string, run: () => Promise<unknown>) {
    if (!confirm(ask)) return;
    setBusy(what); setMsg('');
    try { await run(); setMsg(`✔ ${what} — 완료`); } catch (e) { setMsg(`❌ ${what}: ${(e as Error).message}`); } finally { setBusy(''); refresh(); }
  }
  async function persist() {
    const ok = await navigator.storage?.persist?.().catch(() => false);
    setMsg(ok ? '✔ 브라우저가 이 앱의 저장소를 "지우지 않음"으로 표시했습니다.' : '브라우저가 요청을 받아 주지 않았습니다 (홈 화면에 설치하거나 자주 쓰면 허용되는 경우가 많습니다).');
    refresh();
  }
  const used = r?.categories.reduce((s, c) => s + c.bytes, 0) ?? 0;
  const maxCat = Math.max(1, ...(r?.categories.map((c) => c.bytes) ?? [1]));
  const orphanTotal = r ? r.orphans.images.bytes + r.orphans.saves.bytes + r.orphans.debug.bytes : 0;

  return (
    <section className="panel storage">
      <div className="row"><h2>💾 저장소 관리</h2><span className="spacer" /><button type="button" onClick={onClose}>닫기</button></div>
      <p className="small muted">이 브라우저(IndexedDB)에 저장된 세계관·이미지·세이브·기록입니다. 브라우저 저장소는 공간이 부족하면 브라우저가 지울 수 있으니, 중요한 세계관과 세이브는 파일로도 내보내 두세요.</p>
      {msg && <p className="small status" role="status">{msg}</p>}
      {!r ? <p className="muted small">{stage || '세는 중…'}</p> : (
        <>
          <div className="usage-tiles">
            <div><span className="small muted">앱 데이터 (추정)</span><b>{fmtBytes(used)}</b></div>
            {r.estimate && <div><span className="small muted">브라우저가 센 사용량</span><b>{fmtBytes(r.estimate.usage)}</b><span className="small muted">한도 {fmtBytes(r.estimate.quota)} 중 {(r.estimate.usage / Math.max(1, r.estimate.quota) * 100).toFixed(1)}%</span></div>}
            <div><span className="small muted">보존</span><b>{r.persisted ? '지우지 않음' : '자동 정리 대상'}</b>{!r.persisted && <button type="button" className="small" onClick={() => void persist()}>지우지 않게 요청</button>}</div>
          </div>

          <h3>종류별</h3>
          <ul className="usage-list">
            {r.categories.filter((c) => c.bytes > 0 || c.count > 0).sort((a, b) => b.bytes - a.bytes).map((c) => (
              <li key={c.key}>
                <div className="usage-line"><span className="usage-name">{c.label}</span>
                  <span className="small muted">{c.count ? `${c.count.toLocaleString()}개 · ` : ''}{fmtBytes(c.bytes)}
                    {c.key === 'genCache' && c.count > 0 && <> · <button type="button" className="linklike" disabled={!!busy} onClick={() => void act('중간 결과 지우기', `세계 만들기 중간 결과 ${c.count}개를 지울까요? 멈춘 카드 세계 만들기를 이어서 할 때만 쓰입니다.`, clearGenCache)}>지우기</button></>}
                    {c.key === 'debug' && c.count > 0 && <> · <button type="button" className="linklike" disabled={!!busy} onClick={() => void act('디버그 기록 지우기', `디버그 기록 ${c.count}개를 모두 지울까요?`, clearDebug)}>모두 지우기</button></>}
                  </span></div>
                <span className="usage-bar" aria-hidden><span style={{ width: `${Math.max(1, Math.round((c.bytes / maxCat) * 100))}%` }} /></span>
              </li>
            ))}
          </ul>

          {orphanTotal > 0 && (
            <div className="storage-orphans">
              <b>주인 없는 데이터 {fmtBytes(orphanTotal)}</b>
              <span className="small muted">지운 세계관·세이브에서 남은 것 — 지워도 안전합니다.</span>
              <ul className="small">
                {r.orphans.images.count > 0 && <li>이미지 {r.orphans.images.count}장 · {fmtBytes(r.orphans.images.bytes)}</li>}
                {r.orphans.saves.count > 0 && <li>세이브 진행 기록 {r.orphans.saves.count}개 · {fmtBytes(r.orphans.saves.bytes)}</li>}
                {r.orphans.debug.count > 0 && <li>디버그 기록 {r.orphans.debug.count}개 · {fmtBytes(r.orphans.debug.bytes)}</li>}
              </ul>
              <button type="button" disabled={!!busy} onClick={() => void act('주인 없는 데이터 지우기', `주인 없는 데이터 ${fmtBytes(orphanTotal)}를 지울까요?`, async () => {
                await deleteImageKeys(r.orphans.images.keys); await deleteEventsOf(r.orphans.saves.ids); await deleteDebugIds(r.orphans.debug.ids);
              })}>🧹 모두 지우기</button>
            </div>
          )}

          <h3>세계관별</h3>
          {r.worlds.length === 0 ? <p className="muted small">저장된 세계관 데이터가 없습니다.</p> : (
            <ul className="storage-worlds">
              {r.worlds.map((w) => <WorldRow key={w.id} w={w} busy={!!busy} act={act} />)}
            </ul>
          )}

          {r.imports.length > 0 && (
            <>
              <h3>가져온 카드 원본</h3>
              <p className="small muted">카드를 가져올 때 보관한 원본 파일입니다. 세계관은 이 파일 없이도 동작합니다.</p>
              <ul className="storage-files">
                {r.imports.sort((a, b) => b.bytes - a.bytes).map((i) => (
                  <li key={i.id}><span className="usage-name">{i.fileName}</span><span className="small muted">{fmtBytes(i.bytes)} · {day(i.importedAt)}</span>
                    <button type="button" className="row-del" title="원본 파일 지우기" aria-label={`${i.fileName} 원본 지우기`} disabled={!!busy} onClick={() => void act('카드 원본 지우기', `"${i.fileName}" 원본 파일(${fmtBytes(i.bytes)})을 지울까요?`, () => deleteImport(i.id))}>🗑</button></li>
                ))}
              </ul>
            </>
          )}
          <div className="row"><button type="button" disabled={!!busy || !!stage} onClick={refresh}>↻ 다시 세기</button>{busy && <span className="small muted">{busy}…</span>}</div>
        </>
      )}
    </section>
  );
}

function WorldRow({ w, busy, act }: { w: WorldStorage; busy: boolean; act: (what: string, ask: string, run: () => Promise<unknown>) => Promise<void> }) {
  const verBytes = w.versions.reduce((s, v) => s + v.bytes, 0);
  const saveBytes = w.saves.reduce((s, v) => s + v.bytes, 0);
  const dbgBytes = w.saves.reduce((s, v) => s + v.debugBytes, 0);
  const old = [...w.versions].sort((a, b) => a.updatedAt - b.updatedAt).slice(0, -1);
  const oldBytes = old.reduce((s, v) => s + v.bytes, 0);
  return (
    <li className="storage-world">
      <details>
        <summary><span className="usage-name">{w.name}{w.builtin ? ' (내장)' : ''}</span><span className="small muted">{fmtBytes(w.total)}</span></summary>
        <div className="storage-world-body">
          <div className="storage-item">
            <span>세계관 데이터 <span className="small muted">{w.builtin && !w.versions.length ? '앱에 포함 (저장소 안 씀)' : `버전 ${w.versions.length}개 · ${fmtBytes(verBytes)}`}</span></span>
            {old.length > 0 && <button type="button" className="small" disabled={busy} onClick={() => void act('옛 버전 지우기', `"${w.name}"의 옛 버전 ${old.length}개(${old.map((v) => v.version).join(', ')} · ${fmtBytes(oldBytes)})를 지울까요? 가장 최근에 저장한 버전은 남습니다. 옛 버전으로 시작한 세이브는 최신 버전으로 열립니다.`, () => deleteOldVersions(w.id))}>옛 버전 {old.length}개 지우기</button>}
          </div>
          <div className="storage-item">
            <span>이미지 <span className="small muted">{w.images.count.toLocaleString()}장 · {fmtBytes(w.images.bytes)}{w.images.unusedCount ? ` (이 세계관이 안 쓰는 ${w.images.unusedCount}장 · ${fmtBytes(w.images.unusedBytes)})` : ''}</span></span>
            {w.images.unusedCount > 0 && <button type="button" className="small" disabled={busy} onClick={() => void act('안 쓰는 이미지 지우기', `"${w.name}"의 어느 버전도 쓰지 않는 이미지 ${w.images.unusedCount}장(${fmtBytes(w.images.unusedBytes)})을 지울까요?`, () => deleteImageKeys(w.images.unusedKeys))}>안 쓰는 이미지 지우기</button>}
          </div>
          <div className="storage-item">
            <span>세이브 <span className="small muted">{w.saves.length}개 · {fmtBytes(saveBytes)}{dbgBytes ? ` · 디버그 ${fmtBytes(dbgBytes)}` : ''}</span></span>
            {dbgBytes > 0 && <button type="button" className="small" disabled={busy} onClick={() => void act('디버그 기록 지우기', `"${w.name}" 세이브들의 디버그 기록(${fmtBytes(dbgBytes)})을 지울까요? 세이브는 그대로입니다.`, () => deleteDebugOfSaves(w.saves.map((s) => s.id)))}>디버그 기록 지우기</button>}
          </div>
          {w.saves.length > 0 && (
            <ul className="storage-files">
              {[...w.saves].sort((a, b) => b.bytes + b.debugBytes - (a.bytes + a.debugBytes)).map((s) => (
                <li key={s.id}><span className="usage-name">{s.name}</span>
                  <span className="small muted">기록 {s.events.toLocaleString()}개 · {fmtBytes(s.bytes)}{s.debugCount ? ` · 디버그 ${s.debugCount}개 ${fmtBytes(s.debugBytes)}` : ''} · {day(s.updatedAt)}</span>
                  <button type="button" className="row-del" title="세이브 지우기" aria-label={`${s.name} 세이브 지우기`} disabled={busy} onClick={() => void act('세이브 지우기', `세이브 "${s.name}"을(를) 지울까요? 되돌릴 수 없습니다. (필요하면 먼저 세이브 목록에서 내보내기)`, () => deleteSave(s.id))}>🗑</button></li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </li>
  );
}
