import { beginRun, endRun } from '../llm/usage';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorldPackage } from '../engine/schema';
import { analyzeBundle, cardToWorld } from '../gm/worldgen/fromCard';
import { type CharxBundle, mergeBundles, parseToggles, readCharxBundle } from '../importers/bundle';
import { portraitDataUrl } from '../importers/portrait';
import type { EntryChoice } from '../importers/worldcard';
import { createLlmClient } from '../llm';
import { confirmAdult, isAdultConfirmed } from './adult';
import { cached } from '../llm/robust';
import { clearGenCache, genCache, genCacheCount } from '../storage/gencache';
import type { LlmSettings } from '../llm/types';
import { storeAssets } from '../storage/assets';
import { savePackage } from '../storage/packages';

const ENTRY_CHOICES: [EntryChoice, string][] = [['character', '인물'], ['world', '세계 설정'], ['skip', '제외']];
const KIND_LABEL = { character: '인물', world: '설정', instruction: 'AI 지시문' } as const;
const mb = (n: number) => `${(n / 1048576).toFixed(1)}MB`;

/**
 * 캐릭터 카드(CHARX) 전체로 세계 만들기.
 * 카드·모듈(risum)·Lua 데이터·모든 이미지를 읽고 → AI가 세계 구조를 만들고 → 이미지를 저장한다.
 * 결과는 개인용 세계(내보내기·공유 불가).
 */
export function CardWorldPanel({ file, extraFiles, settings, onDone, onCancel, onCharactersOnly }: {
  file: File; settings: LlmSettings | null;
  /** 홈에서 함께 고른 추가 파일 (v0.62) */
  extraFiles?: File[];
  onDone: (world: WorldPackage, notes: string[]) => void; onCancel: () => void;
  /** 기존 방식: 빈 세계에 인물로만 가져오기 */
  onCharactersOnly: (file: File) => void;
}) {
  const [bundle, setBundle] = useState<CharxBundle | null>(null);
  /** 본 카드 + 추가 파일 (v0.62): 모듈(.risum)·다른 카드·로어북을 함께 분석한다 */
  const [main, setMain] = useState<CharxBundle | null>(null);
  const [extras, setExtras] = useState<CharxBundle[]>([]);
  const [extraMsg, setExtraMsg] = useState('');
  const [loading, setLoading] = useState('파일 읽는 중…');
  const [error, setError] = useState('');
  const [choices, setChoices] = useState<EntryChoice[]>([]);
  const [rating, setRating] = useState<WorldPackage['manifest']['contentRating']>('teen');
  const [classify, setClassify] = useState(true);
  const [withScenario, setWithScenario] = useState(true);
  const [withScenes, setWithScenes] = useState(true);
  const [withRules, setWithRules] = useState(true);

  const [agree, setAgree] = useState(false);
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState<[number, number] | null>(null);
  // 이미지 정리는 이야기 만들기와 동시에 돈다 — 진행을 따로 보여 준다 (v0.86.1)
  const [imageStage, setImageStage] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<{ name: string; url: string }[]>([]);
  const abort = useRef<AbortController | null>(null);
  const [translate, setTranslate] = useState(true);
  const [findChars, setFindChars] = useState(true);
  const [stored, setStored] = useState(0);
  const [reuse, setReuse] = useState(true);
  const [failed, setFailed] = useState(false);
  const [pct, setPct] = useState<{ at: number; next: number; since: number; start: number }>({ at: 0, next: 0, since: 0, start: 0 });
  const [, tick] = useState(0);
  useEffect(() => { if (!stage) return; const t = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(t); }, [stage !== '']);
  const onStage = (st: string, at?: number, next?: number) => {
    setStage(st);
    if (at !== undefined) setPct((p) => ({ at: Math.max(p.at, at), next: Math.max(next ?? at, at), since: Date.now(), start: p.start || Date.now() }));
  };
  useEffect(() => {
    let live = true;
    const urls: string[] = [];
    (async () => {
      try {
        const b = await readCharxBundle(file, file.name, (m) => live && setLoading(m));
        if (!live) return;
        setMain(b);
        if (/nsfw|성인|19금|adult/i.test(b.card.tags.join(' ')) && isAdultConfirmed()) setRating('mature');
        const t: { name: string; url: string }[] = [];
        for (const a of b.assets.slice(0, 12)) { const u = URL.createObjectURL(await a.read()); urls.push(u); t.push({ name: a.name, url: u }); }
        if (live) setThumbs(t);
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) setLoading('');
      }
    })();
    return () => { live = false; urls.forEach((u) => URL.revokeObjectURL(u)); abort.current?.abort(); };
  }, [file]);

  // 본 카드·추가 파일이 바뀌면 다시 합치고 다시 분석한다
  useEffect(() => {
    if (!main) return;
    let live = true;
    (async () => {
      const b = await mergeBundles(main, extras);
      if (!live) return;
      setBundle(b);
      // 추가한 인물 카드의 본문 항목은 처음부터 인물로 (v0.62)
      const cardNames = new Set(extras.filter((x) => x.card.format !== 'risum').map((x) => x.card.nickname || x.card.name));
      const an = analyzeBundle(b);
      const mainCount = b.card.lore.length + main.extraLore.length;
      setChoices(an.analyzed.map((x) => (x.index >= mainCount && cardNames.has(an.card.lore[x.index]!.name) ? 'character' : x.choice)));
      setStored(await genCacheCount(b.fingerprint));
    })();
    return () => { live = false; };
  }, [main, extras]);

  // 홈에서 함께 고른 파일은 본 카드를 읽은 뒤 한 번만 넣는다
  const extrasDone = useRef(false);
  useEffect(() => { if (main && extraFiles?.length && !extrasDone.current) { extrasDone.current = true; void addExtras(extraFiles); } }, [main]);

  async function addExtras(files: File[]) {
    const got: CharxBundle[] = [];
    const errs: string[] = [];
    for (const [i, f] of files.entries()) {
      setExtraMsg(`추가 파일 읽는 중… (${i + 1}/${files.length}) ${f.name}`);
      try {
        const x = await readCharxBundle(f, f.name, (m) => setExtraMsg(`${f.name}: ${m}`));
        if (x.fingerprint === main?.fingerprint || [...extras, ...got].some((e) => e.fingerprint === x.fingerprint)) { errs.push(`${f.name}: 이미 넣은 파일`); continue; }
        got.push(x);
      } catch (e) { errs.push(`${f.name}: ${(e as Error).message}`); }
    }
    setExtras((xs) => [...xs, ...got]);
    setExtraMsg(errs.length ? `❌ ${errs.join(' · ')}` : '');
  }

  const analysis = useMemo(() => (bundle ? analyzeBundle(bundle) : null), [bundle]);

  async function run() {
    if (!bundle || !settings) return;
    setError('');
    abort.current = new AbortController();
    const signal = abort.current.signal;
    setPct({ at: 0, next: 3, since: Date.now(), start: Date.now() });
    setFailed(false);
    const runId = beginRun(`카드로 세계 만들기 — ${bundle.card.name}`.slice(0, 60));
    try {
      if (!reuse) await clearGenCache(bundle.fingerprint);
      let hits = 0;
      // 재시도·잘린 응답 처리 + 단계별 결과 저장(같은 카드로 다시 하면 끝난 단계는 건너뜀)
      const llm = cached(createLlmClient(settings, { onRetry: (n, why, label) => setStage(`${label ? `${label}: ` : ''}${why.includes('앱을 벗어나') ? `${why} (${n}번째)` : why.includes('요청 한도') ? `${why} (${n}번째)` : `다시 시도하는 중 (${n}번째)… ${why.includes('길이 제한') ? '응답이 길어 잘림 — 한도를 늘려 다시 요청' : why.slice(0, 80)}`}`) }), genCache(bundle.fingerprint), () => { hits++; setStage(`저장된 결과를 다시 쓰는 중… (${hits}개)`); });
      const r = await cardToWorld(llm, bundle, {
        contentRating: rating, classifyImages: classify, withScenario, withScenes, withRules, choices, translate, aiFindCharacters: findChars,
        makePortrait: async (blob) => portraitDataUrl(new Uint8Array(await blob.arrayBuffer()), blob.type),
        onImageStage: setImageStage,
      }, onStage, signal);
      onStage('이미지 저장 중…', 91, 91);
      const saved = await storeAssets(r.world.manifest.id, r.images, (d, t) => { setProgress([d, t]); onStage('이미지 저장 중…', 91 + Math.round((d / Math.max(1, t)) * 8), 99); }, signal);
      if (saved.failed.length) {
        const bad = new Set(saved.failed);
        r.world.assets = r.world.assets?.filter((a) => !bad.has(a.id));
        r.notes.push(`이미지 ${saved.failed.length}장을 읽지 못해 뺐습니다.`);
      }
      onStage('세계 저장 중…', 99, 100);
      await savePackage(r.world, 'created');
      onStage('완료', 100, 100);
      onDone(r.world, r.notes);
    } catch (e) {
      if (!signal.aborted) { setError((e as Error).message); setFailed(true); }
      setStored(await genCacheCount(bundle.fingerprint));
    } finally {
      endRun(runId);
      setStage(''); setProgress(null); setImageStage(null); setPct({ at: 0, next: 0, since: 0, start: 0 });
    }
  }

  const busy = stage !== '';
  const b = bundle;
  const toggles = b ? parseToggles(b.toggles) : [];
  const luaKeys = b ? Object.keys(b.lua.data) : [];
  const nChar = choices.filter((c) => c === 'character').length, nWorld = choices.filter((c) => c === 'world').length;

  return (
    <section className="panel">
      <h2>✦ 캐릭터 카드로 세계 전체 만들기</h2>
      <p className="muted small">
        CHARX 안의 카드·로어북·모듈(risum)·스크립트의 데이터 표·<b>모든 이미지</b>를 읽어, AI가 이 게임의 세계관(장소·인물 배치·연표·시작 방식·문체·임무)으로 옮깁니다.
        인물 프로필과 설정 글은 원문을 그대로 재사용합니다. 카드의 스크립트는 실행하지 않습니다.
      </p>
      <p className="muted small">파일: {file.name} ({mb(file.size)})</p>
      {loading && <p className="status">{loading}</p>}
      {error && (
        <div className="status">
          <p>❌ {error}</p>
          {failed && b && (
            <p className="small">
              끝난 단계의 AI 결과 {stored}개는 저장되어 있습니다. <button className="primary" onClick={run} disabled={!settings}>↻ 이어서 다시 시도</button>
              {' '}<span className="muted">— 끝난 단계는 AI를 다시 쓰지 않고 건너뜁니다. 나중에 같은 카드를 다시 열어도 이어집니다 (30일 보관).</span>
            </p>
          )}
        </div>
      )}
      {b && analysis && (
        <>
          <div className="row">
            {thumbs.map((t) => <img key={t.url} className="portrait small-portrait" src={t.url} alt={t.name} title={t.name} />)}
          </div>
          <fieldset className="extra-files">
            <legend>함께 분석할 파일 {b.parts ? `${b.parts.length}개` : '1개'}</legend>
            <ul className="small">
              {(b.parts ?? [{ fileName: b.fileName, name: b.card.name, format: b.card.format, lore: analysis.card.lore.length, images: b.assets.length, fingerprint: b.fingerprint }]).map((p, i) => (
                <li key={p.fingerprint}>
                  {i === 0 ? '📇 본 카드' : p.format === 'risum' ? '🧩 모듈' : '📇 추가 카드'}: <b>{p.name}</b> <span className="muted">({p.fileName} · {p.format.toUpperCase()} · 로어북 {p.lore} · 이미지 {p.images.toLocaleString()})</span>
                  {i > 0 && !busy && <button type="button" className="small link" onClick={() => setExtras((xs) => xs.filter((x) => x.fingerprint !== p.fingerprint))}>빼기</button>}
                </li>
              ))}
            </ul>
            <label className="file small">＋ 모듈·다른 카드 추가 (.risum · .charx · .png · .json, 여러 개 가능)
              <input type="file" multiple accept=".risum,.charx,.png,.json,application/zip,image/png,application/json" disabled={busy || !!extraMsg && !extraMsg.startsWith('❌')} onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) void addExtras(fs); e.target.value = ''; }} />
            </label>
            {extraMsg && <p className="small status">{extraMsg}</p>}
            <p className="small muted">카드에 쓰이는 모듈이나 함께 쓰는 인물 카드가 따로 있으면 넣으세요. 모든 파일의 로어북·이미지·스크립트 데이터 표를 합쳐 분석하고, 추가 인물 카드의 본문은 그 인물의 항목이 됩니다. 기기 간 이동 때는 넣은 파일이 모두 필요합니다.</p>
          </fieldset>
          <ul className="small">
            <li><b>{b.card.name}</b>{b.card.creator && ` · 제작 ${b.card.creator}`}</li>
            <li>로어북 {analysis.card.lore.length}항목 (모듈에만 있는 항목 {b.extraLore.length}) → 규칙으로 찾은 인물 {nChar} · 세계 설정 {nWorld} · 제외 {choices.length - nChar - nWorld}
              {findChars && <span className="muted"> — 카드마다 인물 정보 형식이 달라 규칙이 놓친 인물은 <b>세계를 만들 때 AI가 설정 항목을 읽고 더 찾습니다</b>.</span>}</li>
            <li>이미지 {b.assets.length.toLocaleString()}장 ({mb(b.assets.reduce((s, a) => s + a.size, 0))}){b.cover ? ' + 표지' : ''}</li>
            <li>스크립트 데이터 표 {luaKeys.length}개{luaKeys.length > 0 && <span className="muted"> ({luaKeys.slice(0, 8).join(', ')}{luaKeys.length > 8 ? ' …' : ''})</span>}</li>
            {toggles.length > 0 && <li>카드 선택 설정 {toggles.length}개 (시작 방식 참고)</li>}
            {b.warnings.map((w, i) => <li key={i} className="warn">{w}</li>)}
          </ul>
          <details className="small">
            <summary>로어북 분류 바꾸기</summary>
            <div className="lore-list">
              {analysis.analyzed.map((a, i) => (
                <div key={i} className="lore-item small">
                  <select value={choices[i]} disabled={busy} onChange={(ev) => setChoices((c) => c.map((x, j) => (j === i ? ev.target.value as EntryChoice : x)))}>
                    {ENTRY_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <span><b>{analysis.card.lore[a.index]!.name || `(이름 없음 ${i + 1})`}</b> <span className="muted">[{KIND_LABEL[a.kind]}] {a.note}</span></span>
                </div>
              ))}
            </div>
          </details>
          <div className="row">
            <label>콘텐츠 등급
              <select value={rating} disabled={busy} onChange={(e) => { const v = e.target.value as typeof rating; if (v !== 'mature' || confirmAdult()) setRating(v); }}>
                <option value="all">전체</option><option value="teen">청소년</option><option value="mature">성인 (공유 불가 · 이후 변경 불가)</option>
              </select>
            </label>
            <label className="check"><input type="checkbox" checked={classify} disabled={busy} onChange={(e) => setClassify(e.target.checked)} /> 이름 규칙으로 못 찾은 이미지를 AI로 분류 (파일 이름만 보냄)</label>
            <label className="check"><input type="checkbox" checked={withScenario} disabled={busy} onChange={(e) => setWithScenario(e.target.checked)} /> 임무·결말까지 만들기</label>
            <label className="check"><input type="checkbox" checked={withScenes} disabled={busy} onChange={(e) => setWithScenes(e.target.checked)} /> 장면(협상·대결·데이트…)까지 만들기</label>
            <label className="check"><input type="checkbox" checked={withRules} disabled={busy} onChange={(e) => setWithRules(e.target.checked)} /> 세계 규칙(원작의 법칙·금기 → 행동 결과·인물 반응)까지 만들기</label>
            {stored > 0 && <label className="check"><input type="checkbox" checked={reuse} disabled={busy} onChange={(e) => setReuse(e.target.checked)} /> 이전에 진행한 AI 결과 {stored}개 다시 쓰기 (끄면 처음부터 새로 만듦)</label>}
            <label className="check"><input type="checkbox" checked={findChars} disabled={busy} onChange={(e) => setFindChars(e.target.checked)} /> 규칙으로 못 찾은 인물을 AI가 로어북에서 더 찾기</label>
            <label className="check"><input type="checkbox" checked={translate} disabled={busy} onChange={(e) => setTranslate(e.target.checked)} /> 외국어(영어 등) 인물·설정 글을 한국어로 번역</label>
          </div>
          <div className="private-banner">
            🔒 이 카드는 다른 사람의 작품입니다. 만든 세계는 <b>개인용</b>으로 표시되어 <b>이 브라우저에서 혼자 플레이할 수만 있고</b>, 패키지·세이브 내보내기와 공유가 막힙니다.
            <label className="check"><input type="checkbox" checked={agree} disabled={busy} onChange={(e) => setAgree(e.target.checked)} /> 이해했습니다. 개인적으로만 사용합니다.</label>
          </div>
          {!settings && <p className="status">❌ 먼저 AI 설정을 해 주세요.</p>}
          <p className="muted small">AI 호출: {findChars ? `인물 찾기 ${Math.max(1, Math.ceil(nWorld / 20))}회 안팎 + ` : ''}세계 구조 1회{translate ? ' + 번역(필요할 때, 동시에)' : ''} + 기본 이미지 고르기 1회{withScenario ? ' + 임무 1회' : ''}{withScenes ? ' + 장면 1회' : ''}{withRules ? ' + 규칙 1회' : ''}{classify ? ' + 이미지 분류(필요할 때만)' : ''}. 카드 글이 길면 시간이 걸립니다.</p>
          {busy && (() => {
            // 긴 AI 호출 중에는 다음 단계 쪽으로 천천히 차오르게 한다 (실제 진행률은 단계가 끝날 때 맞춘다)
            const creep = pct.at + (pct.next - pct.at) * (1 - Math.exp(-(Date.now() - pct.since) / 45000)) * 0.9;
            const shown = Math.min(100, Math.round(creep));
            const sec = Math.floor((Date.now() - pct.start) / 1000);
            return (
              <div className="gen-progress" role="status" aria-live="polite">
                <div className="row"><span className="spinner" /> <b>{shown}%</b> <span className="small">{stage}</span><span className="spacer" /><span className="small muted">{Math.floor(sec / 60)}분 {sec % 60}초</span></div>
                <div className="progress-bar"><span style={{ width: `${shown}%` }} /></div>
                {imageStage && <span className="small muted gen-side">🖼 이미지 (동시에 진행): {imageStage}</span>}
                {progress && <span className="small muted">이미지 {progress[0].toLocaleString()} / {progress[1].toLocaleString()}장</span>}
              </div>
            );
          })()}
        </>
      )}
      <div className="row">
        <button onClick={() => (busy ? abort.current?.abort() : onCancel())}>{busy ? '중단' : '취소'}</button>
        <button className="primary" disabled={!b || !settings || busy || !agree} onClick={run}>{busy ? '만드는 중…' : '세계 만들기'}</button>
        {!busy && b && b.card.lore.length > 0 && file.size < 30 * 1024 * 1024 && <button onClick={() => onCharactersOnly(file)}>인물로만 가져오기 (기존 방식)</button>}
      </div>
    </section>
  );
}
