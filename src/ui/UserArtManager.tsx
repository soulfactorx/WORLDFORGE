import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { STOCK_ART, stockDataUrl } from '../data/stockart';
import { db, type UserArt } from '../storage/db';
import { addUserArt, applyUserArtToLibrary, deleteUserArt, exportUserArt, importUserArt, updateUserArt } from '../storage/userart';
import { imageNeeds, needsText } from '../gm/worldgen/imageNeeds';

const KIND = [['character', '인물'], ['scene', '장소·장면']] as const;
const GENDER = [['', '성별 없음'], ['F', '여'], ['M', '남']] as const;
const splitTags = (s: string) => s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20);

function Thumb({ art }: { art: UserArt }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => { const u = URL.createObjectURL(art.blob); setUrl(u); return () => URL.revokeObjectURL(u); }, [art.blob]);
  return url ? <img src={url} alt={art.label} /> : <span className="asset-ph" />;
}

/**
 * 내 기본 이미지 관리 (v0.17): 직접 만든 그림을 기본 이미지 세트로 모아 두고 모든 세계에서 쓴다.
 * 세계를 만들 때 AI·낱말 규칙이 어울리는 그림을 자동으로 고르고(내 이미지 우선), 편집기 이미지 탭에서 직접 붙일 수도 있다.
 */
export function UserArtManager({ onClose }: { onClose: () => void }) {
  const list = useLiveQuery(() => db.userArt.orderBy('createdAt').toArray(), []) ?? [];
  const [kind, setKind] = useState<UserArt['kind']>('character');
  const [gender, setGender] = useState<'' | 'M' | 'F'>('');
  const [tags, setTags] = useState('');
  const [filter, setFilter] = useState<'all' | UserArt['kind']>('all');
  const [status, setStatus] = useState('');
  const [showBuiltin, setShowBuiltin] = useState(false);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setStatus('저장 중…');
    try {
      const n = await addUserArt([...files], { kind, ...(gender ? { gender } : {}), tags: splitTags(tags) }, (d, t) => setStatus(`저장 중… ${d}/${t}`));
      setStatus(`${n}장을 추가했습니다.${await applyReport()}`);
    } catch (e) { setStatus(`❌ ${(e as Error).message}`); }
  }

  async function backup() {
    const blob = await exportUserArt();
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: `worldforge-my-art-${new Date().toISOString().slice(0, 10)}.wfart` }).click();
    URL.revokeObjectURL(url);
  }

  async function restore(file: File | undefined) {
    if (!file) return;
    try { const n = await importUserArt(file); setStatus(`${n}장을 가져왔습니다.${await applyReport()}`); } catch (e) { setStatus(`❌ ${(e as Error).message}`); }
  }

  /** 모든 세계에 자동 적용하고 결과를 글로 */
  async function applyReport(): Promise<string> {
    const r = await applyUserArtToLibrary();
    if (!r.applied.length) return ' 아직 맞는 세계의 인물·장소가 없습니다 (파일 이름이나 태그로 맞춥니다).';
    return ` 세계 ${r.worlds}곳에 자동으로 붙였습니다: ${r.applied.slice(0, 8).map((a) => `${a.world}의 ${a.target}`).join(', ')}${r.applied.length > 8 ? ` 외 ${r.applied.length - 8}곳` : ''}.`;
  }
  const worlds = useLiveQuery(() => db.packages.toArray(), []) ?? [];
  const needy = worlds.map((p) => ({ p, needs: imageNeeds(p.world) })).filter((x) => x.needs.length);

  const shown = list.filter((a) => filter === 'all' || a.kind === filter);
  return (
    <section className="panel">
      <div className="row"><h2>🖼 내 기본 이미지</h2><span className="spacer" /><button onClick={onClose}>닫기</button></div>
      <p className="muted small">
        직접 만든 그림을 기본 이미지 세트로 모아 둡니다. 이 브라우저에 저장되고 모든 세계에서 쓸 수 있습니다.
        세계를 만들 때 이미지가 없는 인물·장소에 <b>어울리는 내 이미지를 먼저</b> 고르고(AI·낱말 규칙), 편집기 <b>이미지</b> 탭에서 직접 붙일 수도 있습니다.
        <b> 태그</b>에 신분·직업·장소 낱말(예: 기사, 시녀, 마법사 / 정원, 집무실, 숲)을 적어 두면 잘 골라집니다.
      </p>

      <fieldset>
        <legend>그림 추가</legend>
        <div className="row">
          <label>종류<select value={kind} onChange={(e) => setKind(e.target.value as UserArt['kind'])}>{KIND.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          {kind === 'character' && <label>성별<select value={gender} onChange={(e) => setGender(e.target.value as typeof gender)}>{GENDER.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
          <label>태그 (쉼표로 구분)<input value={tags} placeholder={kind === 'character' ? '기사, knight, 호위' : '정원, garden, 장미'} onChange={(e) => setTags(e.target.value)} /></label>
        </div>
        <label className="file">이미지 파일 고르기 (여러 장 가능, png·jpg·webp·gif·svg)
          <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
        </label>
        <p className="muted small">큰 그림은 긴 변 1024px로 줄여 저장합니다. 파일 이름이 그림 이름이 됩니다.</p>
      </fieldset>

      <div className="row">
        <label>보기<select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">전체 ({list.length})</option>
          {KIND.map(([v, l]) => <option key={v} value={v}>{l} ({list.filter((a) => a.kind === v).length})</option>)}
        </select></label>
        <span className="spacer" />
        <button onClick={backup} disabled={!list.length}>⇩ 묶음 파일로 백업 (.wfart)</button>
        <label className="file">⇧ 묶음 파일 가져오기<input type="file" accept=".wfart,.zip,application/zip" onChange={(e) => { restore(e.target.files?.[0]); e.target.value = ''; }} /></label>
      </div>
      {status && <p className="status small">{status}</p>}

      {shown.length === 0 ? <p className="muted">아직 내 이미지가 없습니다.</p> : (
        <div className="gallery user-art">
          {shown.map((a) => (
            <figure key={a.id}>
              <Thumb art={a} />
              <figcaption>
                <input value={a.label} title="이름" onChange={(e) => updateUserArt(a.id, { label: e.target.value.slice(0, 60) })} />
                <select value={a.kind} onChange={(e) => updateUserArt(a.id, { kind: e.target.value as UserArt['kind'] })}>{KIND.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                {a.kind === 'character' && <select value={a.gender ?? ''} onChange={(e) => updateUserArt(a.id, { gender: (e.target.value || undefined) as UserArt['gender'] })}>{GENDER.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
                <input defaultValue={a.tags.join(', ')} title="태그 (쉼표로 구분)" placeholder="태그" onBlur={(e) => updateUserArt(a.id, { tags: splitTags(e.target.value) })} />
                <button type="button" className="small" onClick={() => confirm(`"${a.label}"을(를) 지울까요? 이 그림을 쓰던 세계에서는 빈 칸으로 보입니다.`) && deleteUserArt(a.id)}>삭제</button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      <details className="needs-box" open={needy.length > 0}>
        <summary><b>🖼 이미지가 부족한 세계 {needy.length}곳</b> <span className="small muted">— 추천 파일 이름으로 위에 올리면 자동으로 붙습니다</span></summary>
        <div className="row"><button onClick={async () => setStatus(`다시 적용했습니다.${await applyReport()}`)} disabled={!list.length}>내 이미지를 모든 세계에 다시 적용</button></div>
        {needy.map(({ p, needs }) => (
          <details key={p.key} className="small">
            <summary>{p.world.manifest.name} — 인물 {needs.filter((n) => n.kind === 'character').length} · 장소 {needs.filter((n) => n.kind === 'location').length}</summary>
            <button className="small" onClick={async () => { try { await navigator.clipboard.writeText(needsText(p.world, needs)); setStatus('필요한 그림 목록을 복사했습니다.'); } catch { setStatus(needsText(p.world, needs)); } }}>📋 목록 복사</button>
            <ul>{needs.map((n) => <li key={n.id}>{n.kind === 'character' ? '인물' : '장소'} · <b>{n.name}</b> → <code>{n.fileName}</code> <span className="muted">{n.describe.slice(0, 80)}</span></li>)}</ul>
          </details>
        ))}
      </details>

      <details open={showBuiltin} onToggle={(e) => setShowBuiltin((e.target as HTMLDetailsElement).open)}>
        <summary className="small">앱 내장 기본 이미지 {STOCK_ART.length}종 보기 (고칠 수 없음)</summary>
        {showBuiltin && (
          <div className="gallery stock">
            {STOCK_ART.map((a) => <figure key={a.id}><img src={stockDataUrl(`stock.${a.id}`)} alt={a.label} /><figcaption>{a.label}</figcaption></figure>)}
          </div>
        )}
      </details>
    </section>
  );
}
