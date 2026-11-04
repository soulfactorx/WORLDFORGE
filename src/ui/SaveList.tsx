import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { sampleWorld } from '../data/sample-world';
import { appendEvents, db, deleteSave, exportSave, importSave } from '../storage/db';
import { startEvents } from '../gm/turn';

export function SaveList({ onOpen }: { onOpen: (saveId: string) => void }) {
  const saves = useLiveQuery(() => db.saves.orderBy('updatedAt').reverse().toArray(), []);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  async function newGame() {
    const id = crypto.randomUUID();
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    await db.saves.add({ id, name: `${sampleWorld.manifest.name} — ${new Date().toLocaleString()}`, packageId: sampleWorld.manifest.id, packageVersion: sampleWorld.manifest.version, createdAt: Date.now(), updatedAt: Date.now() });
    await appendEvents(id, startEvents(sampleWorld, name || '이방인', seed).map((event, seq) => ({ saveId: id, seq, turn: 0, event })));
    onOpen(id);
  }

  async function download(id: string, fileName: string) {
    const url = URL.createObjectURL(await exportSave(id));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${fileName.replace(/[^\w가-힣-]+/g, '_')}.wfsave.json` });
    a.click();
    URL.revokeObjectURL(url);
  }

  async function upload(file: File) {
    try { await importSave(await file.text()); setError(''); } catch (e) { setError((e as Error).message); }
  }

  return (
    <section className="panel">
      <h2>새 게임</h2>
      <p className="muted">세계: {sampleWorld.manifest.name} — 당신은 이 세계에 대해 아무것도 모른 채 깨어납니다.</p>
      <div className="row">
        <input placeholder="주인공 이름 (선택)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="primary" onClick={newGame}>시작</button>
      </div>

      <h2>세이브</h2>
      <p className="muted small">세이브는 이 브라우저에 저장됩니다. 브라우저 데이터 삭제에 대비해 <b>내보내기</b>로 파일을 백업하세요.</p>
      <label className="file">세이브 파일 가져오기
        <input type="file" accept=".json,application/json" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </label>
      {error && <p className="status">❌ {error}</p>}
      <ul className="saves">
        {saves?.map((s) => (
          <li key={s.id}>
            <span>{s.name}<br /><span className="muted small">{new Date(s.updatedAt).toLocaleString()}</span></span>
            <span className="row">
              <button className="primary" onClick={() => onOpen(s.id)}>이어하기</button>
              <button onClick={() => download(s.id, s.name)}>내보내기</button>
              <button onClick={() => confirm('이 세이브를 삭제할까요?') && deleteSave(s.id)}>삭제</button>
            </span>
          </li>
        ))}
        {saves?.length === 0 && <li className="muted">세이브가 없습니다.</li>}
      </ul>
    </section>
  );
}
