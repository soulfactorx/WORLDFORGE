import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { CharacterSheet } from '../engine/character/sheet';
import { hasErrors, validateWorld } from '../engine/package/validate';
import type { WorldPackage } from '../engine/schema';
import { startEvents } from '../gm/turn';
import { appendEvents, db, deleteSave, exportSave, importSave } from '../storage/db';
import { deletePackage, exportWpk, listPackages, packageKey, parsePackageFile, savePackage } from '../storage/packages';
import { CharacterCreator } from './CharacterCreator';
import { IssueList } from './IssueList';

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  a.click();
  URL.revokeObjectURL(url);
}
const safeName = (s: string) => s.replace(/[^\w가-힣.-]+/g, '_');

export function SaveList({ onOpen, onEdit, onGenerate, onCard }: {
  onOpen: (saveId: string) => void; onEdit: (world: WorldPackage | null) => void; onGenerate: () => void; onCard: (file: File) => void;
}) {
  const saves = useLiveQuery(() => db.saves.orderBy('updatedAt').reverse().toArray(), []);
  const packages = useLiveQuery(() => listPackages(), []);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ text: string; issues?: ReturnType<typeof validateWorld> } | null>(null);

  const selected = packages?.find((p) => packageKey(p.world) === selectedKey) ?? packages?.[0];
  const world = selected?.world;
  const worldIssues = world ? validateWorld(world) : [];
  const playable = !!world && !hasErrors(worldIssues);

  async function newGame(character: CharacterSheet) {
    if (!world) return;
    const id = crypto.randomUUID();
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    await db.saves.add({ id, name: `${character.name} · ${world.manifest.name} — ${new Date().toLocaleString()}`, packageId: world.manifest.id, packageVersion: world.manifest.version, createdAt: Date.now(), updatedAt: Date.now() });
    await appendEvents(id, startEvents(world, character, seed).map((event, seq) => ({ saveId: id, seq, turn: 0, event })));
    onOpen(id);
  }

  async function importPackage(file: File) {
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

  if (creating && world) return <CharacterCreator onCreate={newGame} onCancel={() => setCreating(false)} />;

  return (
    <section className="panel">
      <h2>새 게임</h2>
      <label>세계관
        <select value={selected ? packageKey(selected.world) : ''} onChange={(e) => setSelectedKey(e.target.value)}>
          {packages?.map((p) => (
            <option key={packageKey(p.world)} value={packageKey(p.world)}>
              {p.world.manifest.name} v{p.world.manifest.version}{p.builtin ? ' (내장)' : ''}{p.world.manifest.aiAssisted ? ' ✦AI' : ''}
            </option>
          ))}
        </select>
      </label>
      {world && (
        <p className="muted small">
          {world.manifest.author && <>제작: {world.manifest.author} · </>}{world.manifest.aiAssisted && <>✦ AI 생성 보조 사용 · </>}등급: {{ all: '전체', teen: '청소년', mature: '성인' }[world.manifest.contentRating]} · 라이선스: {world.manifest.license}
          {' '}— 당신은 이 세계에 대해 아무것도 모른 채 깨어납니다.
        </p>
      )}
      {!playable && world && <p className="status">❌ 이 패키지에는 오류가 있어 플레이할 수 없습니다. 편집에서 고쳐 주세요.</p>}
      <div className="row">
        <button className="primary" disabled={!playable} onClick={() => setCreating(true)}>주인공 만들고 시작</button>
      </div>

      <h2>세계관 라이브러리</h2>
      <p className="muted small">세계관 패키지(.wpk)를 만들거나 가져와서 플레이할 수 있습니다. 패키지는 이 브라우저에 저장됩니다.</p>
      <div className="row">
        <button onClick={() => onEdit(null)}>＋ 새 세계관 만들기</button>
        <button onClick={onGenerate}>✦ AI로 세계관 만들기</button>
        <label className="file">⇩ 캐릭터 카드로 새 세계관 만들기 (.charx · .png · .json)
          <input type="file" accept=".charx,.png,.json,application/json,image/png,application/zip" onChange={(e) => { const f = e.target.files?.[0]; if (f) onCard(f); e.target.value = ''; }} />
        </label>
 <label className="file">패키지 가져오기 (.wpk / .json)
          <input type="file" accept=".wpk,.zip,.json,.charx,.png,application/zip,application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) importPackage(f); e.target.value = ''; }} />
        </label>
      </div>
      {message && (
        <div className="status">
          <p>{message.text}</p>
          {message.issues && message.issues.length > 0 && <IssueList issues={message.issues} />}
        </div>
      )}
      <ul className="saves">
        {packages?.map((p) => (
          <li key={packageKey(p.world)}>
            <span>{p.world.manifest.name} <span className="muted small">v{p.world.manifest.version} · {p.world.manifest.id}{p.builtin ? ' · 내장' : ''}</span></span>
            <span className="row">
              <button onClick={() => download(exportWpk(p.world), `${safeName(p.world.manifest.id)}-${p.world.manifest.version}.wpk`)}>내보내기</button>
              <button onClick={() => {
                if (!p.builtin) { onEdit(p.world); return; }
                // 내장 패키지는 복제해서 편집한다
                const copy = structuredClone(p.world);
                copy.manifest = { ...copy.manifest, id: `${copy.manifest.id}-copy`, name: `${copy.manifest.name} (사본)` };
                onEdit(copy);
              }}>{p.builtin ? '복제해서 편집' : '편집'}</button>
              {!p.builtin && <button onClick={() => confirm('이 패키지를 삭제할까요? 이 패키지를 쓰는 세이브는 열 수 없게 됩니다.') && deletePackage(p.stored!.key)}>삭제</button>}
            </span>
          </li>
        ))}
      </ul>

      <h2>세이브</h2>
      <p className="muted small">세이브는 이 브라우저에 저장됩니다. 브라우저 데이터 삭제에 대비해 <b>내보내기</b>로 파일을 백업하세요.</p>
      <label className="file">세이브 파일 가져오기
        <input type="file" accept=".json,application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) importSaveFile(f); e.target.value = ''; }} />
      </label>
      <ul className="saves">
        {saves?.map((s) => (
          <li key={s.id}>
            <span>{s.name}<br /><span className="muted small">{new Date(s.updatedAt).toLocaleString()}</span></span>
            <span className="row">
              <button className="primary" onClick={() => onOpen(s.id)}>이어하기</button>
              <button onClick={async () => download(await exportSave(s.id), `${safeName(s.name)}.wfsave.json`)}>내보내기</button>
              <button onClick={() => confirm('이 세이브를 삭제할까요?') && deleteSave(s.id)}>삭제</button>
            </span>
          </li>
        ))}
        {saves?.length === 0 && <li className="muted">세이브가 없습니다.</li>}
      </ul>
    </section>
  );
}
