/**
 * 내 이미지 일괄 올리기 (v0.133): 여러 장을 고르면 파일 이름을 낱말로 나눠 태그·종류·성별을 채운 미리보기를 보여 주고,
 * 고친 뒤 한 번에 올린다. 내 기본 이미지 화면과 만계서고 그림 고르기가 함께 쓴다.
 */
import { useEffect, useRef, useState } from 'react';
import { nameWords } from '../importers/assetmatch';
import type { UserArt } from '../storage/db';
import { addUserArtItems } from '../storage/userart';
import { ImageFileButtons, imageFilesOf, meaninglessName } from './ImageFiles';

/** 이름 없는 그림에 한 번에 이름 붙이기 (모바일 사진 앱에서 고른 그림) */
function NamelessBar({ n, onName }: { n: number; onName: (base: string) => void }) {
  const [base, setBase] = useState('');
  return (
    <div className="nameless-bar small">
      <p>📱 {n}장은 <b>파일 이름이 전달되지 않았습니다</b> (휴대폰의 사진 앱에서 고르면 숫자·image 같은 이름만 옵니다). 아래에서 이름을 붙이거나, <b>「📁 파일 앱에서」</b>로 다시 고르면 원래 이름이 남습니다.</p>
      <div className="row">
        <input value={base} placeholder="예: knight female smile" aria-label="한 번에 붙일 이름" onChange={(e) => setBase(e.target.value)} />
        <button type="button" disabled={!base.trim()} onClick={() => { onName(base.trim()); setBase(''); }}>이름 없는 {n}장에 붙이기</button>
      </div>
      <p className="muted">"이름 1, 이름 2…"로 붙고, 이름의 낱말이 태그·성별·종류에 더해집니다.</p>
    </div>
  );
}

type Kind = UserArt['kind'];
interface Pending { key: string; file: File; url: string; label: string; kind: Kind; gender: '' | 'M' | 'F'; tags: string; /** 사진 앱이 붙인 뜻 없는 이름 (모바일) */ nameless?: boolean }
const splitTags = (s: string) => [...new Set(s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
const baseName = (n: string) => n.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

export function UserArtUpload({ onDone, defaultKind = 'auto' }: { onDone?: (n: number) => void | Promise<void>; defaultKind?: Kind | 'auto' }) {
  const [useName, setUseName] = useState(true);
  const [kind, setKind] = useState<Kind | 'auto'>(defaultKind);
  const [gender, setGender] = useState<'' | 'M' | 'F' | 'auto'>('auto');
  const [common, setCommon] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  // 화면을 떠날 때 미리보기 그림을 놓아 준다
  const live = useRef<Pending[]>([]);
  live.current = pending;
  useEffect(() => () => live.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  /** 고른 파일 → 미리보기 (파일 이름의 낱말을 태그로) */
  const prepare = (files: File[]) => {
    const ok = imageFilesOf(files);
    const next = ok.map((f, i): Pending => {
      const nameless = meaninglessName(f.name);
      const nw = useName && !nameless ? nameWords(f.name) : { tags: [] as string[], scene: false };
      const k: Kind = kind === 'auto' ? (nw.scene ? 'scene' : 'character') : kind;
      const g = gender === 'auto' ? ('gender' in nw && nw.gender ? nw.gender : '') : gender;
      return { key: `${Date.now()}-${i}`, file: f, url: URL.createObjectURL(f), label: nameless ? '' : baseName(f.name), ...(nameless ? { nameless } : {}), kind: k, gender: k === 'character' ? g : '', tags: [...new Set([...splitTags(common), ...nw.tags])].join(', ') };
    });
    setPending((p) => [...p, ...next]);
    setStatus(`${ok.length}장을 골랐습니다${files.length > ok.length ? ` (그림이 아닌 파일 ${files.length - ok.length}개는 뺐습니다)` : ''}. 태그를 확인하고 올리세요.`);
  };
  const up = (key: string, p: Partial<Pending>) => setPending((l) => l.map((x) => (x.key === key ? { ...x, ...p } : x)));
  async function upload() {
    setBusy(true);
    try {
      let k = 0;
      const n = await addUserArtItems(pending.map((p) => ({ file: p.file, kind: p.kind, ...(p.gender ? { gender: p.gender } : {}), tags: splitTags(p.tags), label: p.label.trim() || `그림 ${++k}` })), (d, t) => setStatus(`저장 중… ${d}/${t}`));
      pending.forEach((p) => URL.revokeObjectURL(p.url));
      setPending([]);
      setStatus(`${n}장을 내 이미지에 올렸습니다.`);
      await onDone?.(n);
    } catch (e) { setStatus(`❌ ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  return (
    <fieldset className="art-upload">
      <legend>⇧ 내 이미지 올리기 (여러 장 한 번에)</legend>
      <div className="art-upload-opts">
        <label className="check"><input type="checkbox" checked={useName} onChange={(e) => setUseName(e.target.checked)} /> 파일 이름을 낱말로 나눠 태그로 쓰기</label>
        <label>종류<select value={kind} onChange={(e) => setKind(e.target.value as Kind | 'auto')}><option value="auto">자동 (이름에 bg·배경이 있으면 장소)</option><option value="character">인물</option><option value="scene">장소·장면</option></select></label>
        <label>성별<select value={gender} onChange={(e) => setGender(e.target.value as typeof gender)}><option value="auto">자동 (이름에 female·여자… 가 있으면)</option><option value="">없음</option><option value="F">여</option><option value="M">남</option></select></label>
        <label>모든 그림에 더할 태그 (쉼표로)<input value={common} placeholder="예: 기사, 중세" onChange={(e) => setCommon(e.target.value)} /></label>
      </div>
      <ImageFileButtons disabled={busy} label="📁 이미지 파일 고르기 (여러 장 · png·jpg·webp·gif·svg)" onFiles={prepare} />
      <p className="small muted">예: <code>knight_female_smile.png</code> → 태그 knight, smile · 성별 여 / <code>bg_ForestNight.jpg</code> → 장소, 태그 forest, night. 숫자·해시·확장자 같은 잡음은 뺍니다.</p>
      {pending.some((p) => p.nameless && !p.label.trim()) && <NamelessBar n={pending.filter((p) => p.nameless && !p.label.trim()).length} onName={(base) => {
        const nw = nameWords(base);
        let k = 0;
        setPending((l) => l.map((p) => (p.nameless && !p.label.trim() ? { ...p, label: `${base} ${++k}`, tags: [...new Set([...splitTags(p.tags), ...nw.tags])].join(', '), ...(p.kind === 'character' && !p.gender && nw.gender ? { gender: nw.gender } : {}), ...(nw.scene ? { kind: 'scene' as Kind, gender: '' as const } : {}) } : p)));
      }} />}
      {pending.length > 0 && (
        <>
          <ul className="art-pending">
            {pending.map((p) => (
              <li key={p.key}>
                <img src={p.url} alt={p.label} loading="lazy" />
                <div className="art-pending-fields">
                  <input value={p.label} aria-label="이름" placeholder={p.nameless ? '이름 없음 — 사진 앱이 이름을 넘겨주지 않았어요' : '이름'} onChange={(e) => up(p.key, { label: e.target.value })} />
                  <div className="row">
                    <select value={p.kind} aria-label="종류" onChange={(e) => up(p.key, { kind: e.target.value as Kind })}><option value="character">인물</option><option value="scene">장소·장면</option></select>
                    {p.kind === 'character' && <select value={p.gender} aria-label="성별" onChange={(e) => up(p.key, { gender: e.target.value as Pending['gender'] })}><option value="">성별 없음</option><option value="F">여</option><option value="M">남</option></select>}
                  </div>
                  <input value={p.tags} aria-label="태그" placeholder="태그 (쉼표로)" onChange={(e) => up(p.key, { tags: e.target.value })} />
                </div>
                <button type="button" className="small" aria-label={`${p.label} 빼기`} onClick={() => { URL.revokeObjectURL(p.url); setPending((l) => l.filter((x) => x.key !== p.key)); }}>빼기</button>
              </li>
            ))}
          </ul>
          <div className="row">
            <button type="button" className="primary" disabled={busy} onClick={() => void upload()}>{pending.length}장 올리기</button>
            <button type="button" disabled={busy} onClick={() => { pending.forEach((p) => URL.revokeObjectURL(p.url)); setPending([]); setStatus(''); }}>모두 취소</button>
          </div>
        </>
      )}
      {status && <p className="small status">{status}</p>}
    </fieldset>
  );
}
