/**
 * 세계관 만들기 마법사 (v0.125): 단계마다 몇 칸만 채우면 세계가 된다. 초보자용.
 * 각 단계에 쉬운 설명·예시·팁이 있고, AI가 있으면 그 단계를 제안받을 수 있다 (없어도 끝까지 만들 수 있다).
 * 쓰던 초안은 이 브라우저에 저절로 남아, 나갔다 와도 이어서 만든다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorldPackage } from '../engine/schema';
import { validateWorld } from '../engine/package/validate';
import {
  ATTITUDES, blankDraft, blankEnding, blankPerson, blankPlace, blankSecret, blankStage, buildWorld, checkDraft, ENDING_WHEN, sampleDraft,
  STAGE_KINDS, STEPS, type StepId, suggestStep, type SuggestStep, type WizDraft, type WizEnding, type WizPerson, type WizPlace, type WizSecret, type WizStage,
} from '../gm/wizard';
import { assignStockImages } from '../gm/worldgen/stock';
import { createLlmClient } from '../llm';
import { type RouteOverrides, withRoutes } from '../llm/override';
import type { LlmSettings } from '../llm/types';
import { beginRun, endRun } from '../llm/usage';
import { savePackage } from '../storage/packages';
import { loadWizard, storeWizard } from '../storage/drafts';
import { confirmAdult } from './adult';
import { GenrePicker } from './GenrePicker';
import { ModelPicker } from './ModelPicker';

const load = loadWizard;
const store = (s: { draft: WizDraft; step: number } | null) => storeWizard(s);

/** 단계마다 초보자에게 주는 팁 */
const TIPS: Record<StepId, string[]> = {
  basics: ['이름은 나중에 바꿀 수 있습니다. 떠오르는 대로 적어 보세요.', '한 줄 소개는 "누가, 어디서, 무엇 때문에"가 들어가면 좋습니다.', '장르는 진행 방식(전투·대화의 비중, 말투)을 정합니다.'],
  background: ['플레이어도 알아도 되는 것만 적습니다. 숨길 것은 「비밀」 단계에서.', '"이 세계에서는 ~하다"처럼 규칙이나 분위기를 적으면 AI가 그 세계답게 진행합니다.', '문체는 비워도 됩니다.'],
  places: ['처음에는 2~4곳이면 충분합니다.', '묘사에는 보이는 것·들리는 것·냄새를 한두 개씩.', '"이어지는 곳"을 체크하면 그 사이를 오갈 수 있습니다 (한쪽만 체크해도 양쪽으로 이어집니다).', '그림은 완성한 뒤 편집기의 「장소」에서 넣을 수 있습니다 (시간·날씨마다 다른 그림도).'],
  people: ['인물마다 원하는 것이 하나씩 있으면 살아 움직입니다 (성격·배경에 적으세요).', '말투를 적으면 대사가 그 사람답게 나옵니다.', '태도는 처음 만났을 때의 마음입니다. 플레이하면서 바뀝니다.', '그림은 완성한 뒤 편집기의 「인물」에서 넣을 수 있습니다 (표정마다 다른 그림도).'],
  secrets: ['비밀은 이야기를 끌고 가는 힘입니다. 누가 알고, 어디서 찾을 수 있는지 정하세요.', '아는 인물은 믿을 만해지면(신뢰가 쌓이면) 털어놓습니다.', '거짓 소문을 섞으면 플레이어가 진실을 가려내는 재미가 생깁니다.'],
  goal: ['목표는 비워도 됩니다 — 그러면 자유롭게 돌아다니는 세계가 됩니다.', '단계마다 "언제 끝나는지"를 고릅니다: 어느 곳에 가면 · 비밀을 알면 · 누구와 가까워지면.', '결말은 둘(성공·실패)이면 충분합니다.'],
  start: ['첫 장면에서 곧바로 무언가 일어나게 하세요. 플레이어가 반응하고 싶어집니다.', '"당신은 누구인가"는 짧게. 자세한 것은 플레이어가 주인공을 만들 때 정합니다.'],
  review: ['빨간 표시(꼭 필요)만 채우면 완성할 수 있습니다.', '편집기에서 전투·장면·세계 규칙·이미지 같은 더 많은 것을 덧붙일 수 있습니다.'],
};

export function WorldWizard({ settings, onDone, onCancel }: {
  settings: LlmSettings | null;
  /** 편집기에서 마저 다듬기 */
  onDone: (world: WorldPackage, notes: string[]) => void;
  onCancel: () => void;
}) {
  const saved = useMemo(load, []);
  const [d, setD] = useState<WizDraft>(() => saved?.draft ?? blankDraft());
  const [step, setStep] = useState(() => Math.min(saved?.step ?? 0, STEPS.length - 1));
  const [resumed, setResumed] = useState(!!saved);
  useEffect(() => { store({ draft: d, step }); }, [d, step]);
  const top = useRef<HTMLElement>(null);
  const go = (i: number) => { setStep(Math.max(0, Math.min(STEPS.length - 1, i))); top.current?.scrollIntoView({ block: 'start' }); };
  const cur = STEPS[step]!;
  const notes = checkDraft(d);
  const needsOf = (id: StepId) => notes.filter((n) => n.step === id && n.level === 'need').length;
  const set = (p: Partial<WizDraft>) => setD((x) => ({ ...x, ...p }));

  // AI 도움
  const [models, setModels] = useState<RouteOverrides>({});
  const [wish, setWish] = useState('');
  const [ai, setAi] = useState('');
  const abort = useRef<AbortController | null>(null);
  async function suggest(s: SuggestStep) {
    if (!settings) return;
    abort.current = new AbortController();
    setAi('AI가 제안을 쓰는 중…');
    const run = beginRun('마법사 AI 도움');
    try {
      const next = await suggestStep(createLlmClient(withRoutes(settings, models)), s, d, wish, abort.current.signal);
      setD(next);
      setAi('✓ 제안을 더했습니다. 마음에 들지 않는 것은 고치거나 🗑로 지우세요.');
    } catch (e) { setAi(abort.current.signal.aborted ? '중단했습니다.' : `❌ ${(e as Error).message}`); }
    finally { endRun(run); }
  }
  const aiBusy = ai.endsWith('…');

  function restart(sample: boolean) {
    const filled = d.name.trim() || d.places.some((p) => p.name.trim()) || d.people.length;
    if (filled && !confirm(sample ? '지금 쓴 내용을 지우고 예시(안개 수도원)로 채울까요?' : '지금 쓴 내용을 지우고 처음부터 다시 만들까요?')) return;
    setD(sample ? sampleDraft() : blankDraft()); setStep(sample ? 1 : 0); setResumed(false);
  }

  // 완성
  const [busy, setBusy] = useState('');
  const [withImages, setWithImages] = useState(true);
  async function finish(mode: 'editor' | 'save') {
    setBusy(mode === 'save' ? '저장하는 중…' : '세계를 만드는 중…');
    try {
      let world = buildWorld(d);
      const out: string[] = ['마법사로 만든 세계입니다. 편집기에서 전투·장면·세계 규칙·이미지 등을 더할 수 있습니다.'];
      if (withImages) {
        const st = await assignStockImages(world).catch(() => null);
        if (st?.added) { world = { ...world, assets: st.assets }; out.push(`인물·장소에 기본 이미지 ${st.added}장을 붙였습니다 (편집기 「자료 › 이미지」에서 바꿀 수 있습니다).`); }
      }
      if (mode === 'save') {
        await savePackage(world, 'created');
        store(null);
        alert(`「${world.manifest.name}」을 저장했습니다. 홈의 세계관 목록에서 플레이할 수 있습니다.`);
        onCancel();
        return;
      }
      store(null);
      onDone(world, out);
    } catch (e) { alert(`만들지 못했습니다: ${(e as Error).message}`); }
    finally { setBusy(''); }
  }

  const places = d.places.filter((p) => p.name.trim());
  const people = d.people.filter((c) => c.name.trim());
  const secrets = d.secrets.filter((s) => s.statement.trim());

  return (
    <section className="panel wizard" ref={top}>
      <div className="wiz-head">
        <h2>🧭 세계관 만들기 마법사</h2>
        <button type="button" className="small" onClick={() => restart(true)}>예시로 채워 보기</button>
        <button type="button" className="small" onClick={() => restart(false)}>처음부터</button>
      </div>
      {resumed && <p className="small status">✎ 만들던 초안을 이어서 엽니다. <button type="button" className="small" onClick={() => setResumed(false)}>확인</button></p>}

      <ol className="wiz-steps" aria-label="단계">
        {STEPS.map((s, i) => {
          const need = s.id === 'review' ? 0 : needsOf(s.id);
          return (
            <li key={s.id}>
              <button type="button" ref={i === step ? (el) => el?.scrollIntoView({ block: 'nearest', inline: 'center' }) : undefined} className={`wiz-step${i === step ? ' on' : ''}${i < step && !need ? ' done' : ''}`} aria-current={i === step ? 'step' : undefined} onClick={() => go(i)}>
                <span aria-hidden>{i < step && !need ? '✓' : s.icon}</span> {i + 1}. {s.title}{need ? <span className="wiz-need" title="꼭 채울 것이 있습니다"> •</span> : null}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="progress-bar wiz-progress" aria-hidden><span style={{ width: `${Math.round((step / (STEPS.length - 1)) * 100)}%` }} /></div>

      <h3 className="wiz-title">{cur.icon} {step + 1}단계 · {cur.title}</h3>
      <p className="muted">{cur.what}</p>
      <details className="wiz-tips" open={step < 2}>
        <summary className="small">💡 이렇게 해 보세요</summary>
        <ul className="small">{TIPS[cur.id].map((t) => <li key={t}>{t}</li>)}</ul>
      </details>

      <div className="wiz-body">
        {cur.id === 'basics' && <Basics d={d} set={set} />}
        {cur.id === 'background' && (
          <>
            <label>세계 배경 <span className="small muted">— 플레이어도 아는 모습·분위기·규칙</span>
              <textarea rows={7} value={d.overview} placeholder="예: 깊은 산속, 안개가 걷히지 않는 수도원. 수도사들은 매일 밤 자정에 종을 친다. 종소리가 멈추면 산 아래 무언가가 깨어난다고 믿기 때문이다." onChange={(e) => set({ overview: e.target.value })} />
            </label>
            <label>서술 문체 <span className="small muted">— 선택</span>
              <textarea rows={2} value={d.style} placeholder="예: 조용하고 으스스하게. 짧은 문장, 소리와 냄새를 자주 묘사한다." onChange={(e) => set({ style: e.target.value })} />
            </label>
          </>
        )}
        {cur.id === 'places' && <Places d={d} set={set} />}
        {cur.id === 'people' && <People d={d} set={set} />}
        {cur.id === 'secrets' && <Secrets d={d} set={set} />}
        {cur.id === 'goal' && <Goal d={d} set={set} />}
        {cur.id === 'start' && (
          <>
            <label>시작 장소
              <select value={d.start.place} onChange={(e) => set({ start: { ...d.start, place: e.target.value } })}>
                {!places.some((p) => p.key === d.start.place) && <option value="">(골라 주세요)</option>}
                {places.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
            </label>
            {!places.length && <p className="small status">먼저 「장소」 단계에서 장소를 만들어 주세요.</p>}
            <label>플레이어는 누구인가 <span className="small muted">— 짧게, 선택</span>
              <input value={d.start.who} placeholder="예: 약초를 구하러 올라온 떠돌이" onChange={(e) => set({ start: { ...d.start, who: e.target.value } })} />
            </label>
            <label>첫 장면
              <textarea rows={5} value={d.start.scene} placeholder="예: 안개 속에서 종탑의 그림자가 보인다. 누군가 비명을 지르며 계단을 뛰어 내려온다." onChange={(e) => set({ start: { ...d.start, scene: e.target.value } })} />
            </label>
            {d.start.scene.trim() && (
              <div className="wiz-preview">
                <span className="small muted">플레이어가 처음 보는 글</span>
                <p>{buildWorld(d).start.openingScene}</p>
              </div>
            )}
          </>
        )}
        {cur.id === 'review' && (
          <Review d={d} go={go} notes={notes} counts={{ places: places.length, people: people.length, secrets: secrets.length }} />
        )}
      </div>

      {cur.id !== 'basics' && cur.id !== 'review' && (
        <fieldset className="wiz-ai">
          <legend>✦ AI에게 이 단계 제안 받기 <span className="small muted">— 선택</span></legend>
          {!settings ? <p className="small muted">AI 설정을 하면 쓸 수 있습니다. AI 없이도 끝까지 만들 수 있습니다.</p> : (
            <>
              <label>바라는 방향 <span className="small muted">— 비워도 됩니다</span>
                <input value={wish} placeholder={cur.id === 'people' ? '예: 주인공을 돕는 척하는 배신자 한 명' : cur.id === 'places' ? '예: 숨겨진 장소 하나' : '예: 더 어둡게'} onChange={(e) => setWish(e.target.value)} />
              </label>
              <div className="row">
                <button type="button" disabled={aiBusy} onClick={() => void suggest(cur.id as SuggestStep)}>✦ {cur.title} 제안 받기</button>
                {aiBusy && <button type="button" onClick={() => abort.current?.abort()}>중단</button>}
              </div>
              <p className="small muted">지금까지 채운 내용과 어울리게 더합니다 (지우지는 않습니다). 세계 이름·배경·장소·인물 등 초안의 요약이 고른 AI 제공자로 보내집니다.</p>
              <ModelPicker settings={settings} groups={['build']} value={models} onChange={setModels} title="🤖 제안에 쓸 AI 모델" />
              {ai && <p className="status small">{ai}</p>}
            </>
          )}
        </fieldset>
      )}

      {notes.some((n) => n.step === cur.id) && cur.id !== 'review' && (
        <ul className="wiz-notes small">
          {notes.filter((n) => n.step === cur.id).map((n) => <li key={n.text} className={n.level}>{n.level === 'need' ? '● 꼭: ' : '○ '}{n.text}</li>)}
        </ul>
      )}

      {cur.id === 'review' && (
        <div className="wiz-finish">
          <label className="check"><input type="checkbox" checked={withImages} onChange={(e) => setWithImages(e.target.checked)} /> 인물·장소에 앱의 기본 이미지 붙이기</label>
          <div className="row">
            <button type="button" className="primary" disabled={!!busy || notes.some((n) => n.level === 'need')} onClick={() => void finish('editor')}>편집기에서 다듬고 저장</button>
            <button type="button" disabled={!!busy || notes.some((n) => n.level === 'need')} onClick={() => void finish('save')}>바로 저장</button>
            {busy && <span className="small"><span className="spinner" /> {busy}</span>}
          </div>
          {notes.some((n) => n.level === 'need') && <p className="small status">● 표시를 채우면 완성할 수 있습니다.</p>}
          <p className="small muted">초안은 완성할 때까지 이 브라우저에 저절로 남습니다. 나갔다 와도 이어서 만들 수 있습니다.</p>
        </div>
      )}
      <div className="wiz-nav">
        <button type="button" onClick={() => (step ? go(step - 1) : onCancel())}>{step ? '◀ 이전' : '나가기'}</button>
        <span className="small muted">{step + 1} / {STEPS.length}</span>
        {cur.id !== 'review'
          ? <button type="button" className="primary" onClick={() => go(step + 1)}>다음 ▶</button>
          : <span />}
      </div>

    </section>
  );
}

type Set = (p: Partial<WizDraft>) => void;
const upd = <T extends { key: string }>(list: T[], key: string, p: Partial<T>) => list.map((x) => (x.key === key ? { ...x, ...p } : x));
const del = <T extends { key: string }>(list: T[], key: string, filled: boolean) => (!filled || confirm('지울까요?') ? list.filter((x) => x.key !== key) : list);

function Basics({ d, set }: { d: WizDraft; set: Set }) {
  return (
    <>
      <label>세계 이름
        <input value={d.name} placeholder="예: 안개 수도원" onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label>한 줄 소개
        <input value={d.logline} placeholder="예: 종소리가 멈추면 무언가가 깨어나는 산골 수도원" onChange={(e) => set({ logline: e.target.value })} />
      </label>
      <fieldset><legend>장르</legend><GenrePicker value={d.genre} onChange={(g) => set({ genre: g })} /></fieldset>
      <label>콘텐츠 등급
        <select value={d.rating} onChange={(e) => { const v = e.target.value as WizDraft['rating']; if (v !== 'mature' || confirmAdult()) set({ rating: v }); }}>
          <option value="all">전체</option><option value="teen">청소년</option><option value="mature">성인 (공유 불가 · 이후 변경 불가)</option>
        </select>
      </label>
    </>
  );
}

function Places({ d, set }: { d: WizDraft; set: Set }) {
  const up = (k: string, p: Partial<WizPlace>) => set({ places: upd(d.places, k, p) });
  return (
    <>
      {d.places.map((p, i) => (
        <fieldset key={p.key} className="wiz-card">
          <legend>장소 {i + 1}{p.key === d.start.place ? ' · 시작 장소' : ''}</legend>
          <label>이름<input value={p.name} placeholder="예: 수도원 마당" onChange={(e) => up(p.key, { name: e.target.value })} /></label>
          <label>묘사<textarea rows={2} value={p.description} placeholder="예: 이끼 낀 돌바닥, 종탑의 그림자. 축축한 안개가 발목까지 깔려 있다." onChange={(e) => up(p.key, { description: e.target.value })} /></label>
          {d.places.length > 1 && (
            <div className="wiz-links">
              <span className="small muted">이어지는 곳</span>
              {d.places.filter((o) => o.key !== p.key).map((o) => {
                const on = p.links.includes(o.key) || o.links.includes(p.key);
                return (
                  <label key={o.key} className="check">
                    <input type="checkbox" checked={on} onChange={() => set({ places: d.places.map((x) => (x.key === p.key ? { ...x, links: on ? x.links.filter((l) => l !== o.key) : [...x.links, o.key] } : x.key === o.key && on ? { ...x, links: x.links.filter((l) => l !== p.key) } : x)) })} />
                    {o.name || `장소 ${d.places.indexOf(o) + 1}`}
                  </label>
                );
              })}
            </div>
          )}
          {d.places.length > 1 && <div className="row"><button type="button" className="small" aria-label={`${p.name || '이 장소'} 지우기`} onClick={() => {
            const places = del(d.places, p.key, !!(p.name || p.description));
            if (places.length === d.places.length) return;
            set({ places: places.map((x) => ({ ...x, links: x.links.filter((l) => l !== p.key) })), ...(d.start.place === p.key ? { start: { ...d.start, place: places[0]?.key ?? '' } } : {}) });
          }}>🗑</button></div>}
        </fieldset>
      ))}
      <button type="button" onClick={() => { const p = blankPlace(d.places); const prev = d.places[d.places.length - 1]; set({ places: [...d.places, { ...p, links: prev ? [prev.key] : [] }] }); }}>＋ 장소 더하기</button>
    </>
  );
}

function People({ d, set }: { d: WizDraft; set: Set }) {
  const up = (k: string, p: Partial<WizPerson>) => set({ people: upd(d.people, k, p) });
  const places = d.places.filter((p) => p.name.trim());
  return (
    <>
      {!d.people.length && <p className="small muted">아직 인물이 없습니다. 아래 버튼으로 더하세요.</p>}
      {d.people.map((c, i) => (
        <fieldset key={c.key} className="wiz-card">
          <legend>인물 {i + 1}{c.name ? ` · ${c.name}` : ''}</legend>
          <div className="wiz-grid">
            <label>이름<input value={c.name} placeholder="예: 엘라" onChange={(e) => up(c.key, { name: e.target.value })} /></label>
            <label>한 줄 역할<input value={c.role} placeholder="예: 견습 수도사" onChange={(e) => up(c.key, { role: e.target.value })} /></label>
            <label>성별<select value={c.gender} onChange={(e) => up(c.key, { gender: e.target.value as WizPerson['gender'] })}><option value="">정하지 않음</option><option value="F">여성</option><option value="M">남성</option></select></label>
            <label>있는 곳<select value={c.place} onChange={(e) => up(c.key, { place: e.target.value })}><option value="">(시작 장소)</option>{places.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select></label>
            <label>처음 태도<select value={c.attitude} onChange={(e) => up(c.key, { attitude: e.target.value as WizPerson['attitude'] })}>{ATTITUDES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          </div>
          <label>외모<input value={c.appearance} placeholder="예: 짧게 자른 갈색 머리, 손등의 화상 자국" onChange={(e) => up(c.key, { appearance: e.target.value })} /></label>
          <label>성격 · 원하는 것<input value={c.personality} placeholder="예: 호기심 많고 바깥세상을 동경한다" onChange={(e) => up(c.key, { personality: e.target.value })} /></label>
          <label>말투<input value={c.speech} placeholder="예: 빠르고 솔직한 반말" onChange={(e) => up(c.key, { speech: e.target.value })} /></label>
          <label>배경 이야기 <span className="small muted">— 이 인물만 아는 과거, 선택</span><textarea rows={2} value={c.background} onChange={(e) => up(c.key, { background: e.target.value })} /></label>
          <div className="row"><button type="button" className="small" aria-label={`${c.name || '이 인물'} 지우기`} onClick={() => {
            const people = del(d.people, c.key, !!c.name);
            if (people.length !== d.people.length) set({ people, secrets: d.secrets.map((s) => ({ ...s, knowers: s.knowers.filter((k) => k !== c.key) })) });
          }}>🗑</button></div>
        </fieldset>
      ))}
      <button type="button" onClick={() => set({ people: [...d.people, blankPerson(d.people, d.start.place)] })}>＋ 인물 더하기</button>
    </>
  );
}

function Secrets({ d, set }: { d: WizDraft; set: Set }) {
  const up = (k: string, p: Partial<WizSecret>) => set({ secrets: upd(d.secrets, k, p) });
  const people = d.people.filter((c) => c.name.trim());
  const places = d.places.filter((p) => p.name.trim());
  return (
    <>
      {!d.secrets.length && <p className="small muted">아직 비밀이 없습니다. 아래 버튼으로 더하세요.</p>}
      {d.secrets.map((s, i) => (
        <fieldset key={s.key} className="wiz-card">
          <legend>비밀 {i + 1}</legend>
          <label>내용<textarea rows={2} value={s.statement} placeholder="예: 30년 전 종이 멈춘 밤, 마을 아이들이 사라졌다." onChange={(e) => up(s.key, { statement: e.target.value })} /></label>
          <label>진짜인가<select value={s.truth} onChange={(e) => up(s.key, { truth: e.target.value as WizSecret['truth'] })}><option value="true">진실</option><option value="false">거짓 (잘못 알려진 소문)</option></select></label>
          <div className="wiz-links">
            <span className="small muted">아는 인물 {s.truth === 'true' ? '(숨기고 있다)' : '(사실이라 믿는다)'}</span>
            {people.length ? people.map((c) => (
              <label key={c.key} className="check"><input type="checkbox" checked={s.knowers.includes(c.key)} onChange={() => up(s.key, { knowers: s.knowers.includes(c.key) ? s.knowers.filter((k) => k !== c.key) : [...s.knowers, c.key] })} /> {c.name}</label>
            )) : <span className="small muted">— 「인물」 단계에서 인물을 만들면 고를 수 있습니다.</span>}
          </div>
          <label>단서를 찾을 수 있는 곳<select value={s.place} onChange={(e) => up(s.key, { place: e.target.value })}><option value="">(없음)</option>{places.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select></label>
          <label className="check"><input type="checkbox" checked={s.rumor} onChange={(e) => up(s.key, { rumor: e.target.checked })} /> 사람들 사이에 소문으로 떠돈다</label>
          <div className="row"><button type="button" className="small" aria-label="이 비밀 지우기" onClick={() => set({ secrets: del(d.secrets, s.key, !!s.statement) })}>🗑</button></div>
        </fieldset>
      ))}
      <button type="button" onClick={() => set({ secrets: [...d.secrets, blankSecret(d.secrets)] })}>＋ 비밀 더하기</button>
    </>
  );
}

function Goal({ d, set }: { d: WizDraft; set: Set }) {
  const g = d.goal;
  const setG = (p: Partial<WizDraft['goal']>) => set({ goal: { ...g, ...p } });
  const upS = (k: string, p: Partial<WizStage>) => setG({ stages: upd(g.stages, k, p) });
  const upE = (k: string, p: Partial<WizEnding>) => set({ endings: upd(d.endings, k, p) });
  const people = d.people.filter((c) => c.name.trim());
  const places = d.places.filter((p) => p.name.trim());
  const secrets = d.secrets.filter((s) => s.statement.trim());
  const targets = (kind: WizStage['kind']) => (kind === 'at' ? places.map((p) => [p.key, p.name]) : kind === 'friend' ? people.map((c) => [c.key, c.name]) : secrets.map((s) => [s.key, s.statement.length > 40 ? `${s.statement.slice(0, 40)}…` : s.statement]));
  return (
    <>
      <label>목표 이름<input value={g.name} placeholder="예: 멈추지 않는 종" onChange={(e) => setG({ name: e.target.value })} /></label>
      <label>왜 해야 하나<textarea rows={2} value={g.motive} placeholder="예: 오늘 밤 종지기가 쓰러졌다. 자정까지 종의 비밀을 알아내야 한다." onChange={(e) => setG({ motive: e.target.value })} /></label>
      <label>맡기는 인물<select value={g.giver} onChange={(e) => setG({ giver: e.target.value })}><option value="">(없음)</option>{people.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select></label>
      <h4 className="wiz-sub">단계</h4>
      {g.stages.map((s, i) => (
        <fieldset key={s.key} className="wiz-card">
          <legend>단계 {i + 1}</legend>
          <label>할 일 <span className="small muted">— 플레이어 수첩에 보입니다</span><input value={s.objective} placeholder="예: 납골당에서 종의 진실을 찾는다" onChange={(e) => upS(s.key, { objective: e.target.value })} /></label>
          <div className="wiz-grid">
            <label>끝나는 때<select value={s.kind} onChange={(e) => upS(s.key, { kind: e.target.value as WizStage['kind'], ref: '' })}>{STAGE_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label>대상<select value={s.ref} onChange={(e) => upS(s.key, { ref: e.target.value })}><option value="">(골라 주세요)</option>{targets(s.kind).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
          </div>
          {!targets(s.kind).length && <p className="small muted">고를 {s.kind === 'at' ? '장소' : s.kind === 'friend' ? '인물' : '비밀'}이 아직 없습니다.</p>}
          <div className="row"><button type="button" className="small" aria-label="이 단계 지우기" onClick={() => setG({ stages: del(g.stages, s.key, !!s.objective) })}>🗑</button></div>
        </fieldset>
      ))}
      <button type="button" onClick={() => setG({ stages: [...g.stages, blankStage(g.stages)] })}>＋ 단계 더하기</button>
      <h4 className="wiz-sub">결말</h4>
      {d.endings.map((e, i) => (
        <fieldset key={e.key} className="wiz-card">
          <legend>결말 {i + 1}</legend>
          <div className="wiz-grid">
            <label>이름<input value={e.name} placeholder="예: 새벽의 종" onChange={(x) => upE(e.key, { name: x.target.value })} /></label>
            <label>언제<select value={e.when} onChange={(x) => upE(e.key, { when: x.target.value as WizEnding['when'], ref: '' })}>{ENDING_WHEN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            {e.when === 'knows' && <label>어떤 비밀<select value={e.ref} onChange={(x) => upE(e.key, { ref: x.target.value })}><option value="">(골라 주세요)</option>{secrets.map((s) => <option key={s.key} value={s.key}>{s.statement.slice(0, 40)}</option>)}</select></label>}
          </div>
          <label>마지막 장면<textarea rows={2} value={e.epilogue} placeholder="예: 종소리가 산을 덮고, 안개가 처음으로 옅어진다." onChange={(x) => upE(e.key, { epilogue: x.target.value })} /></label>
          <div className="row"><button type="button" className="small" aria-label="이 결말 지우기" onClick={() => set({ endings: del(d.endings, e.key, !!e.name) })}>🗑</button></div>
        </fieldset>
      ))}
      <button type="button" onClick={() => set({ endings: [...d.endings, blankEnding(d.endings)] })}>＋ 결말 더하기</button>
    </>
  );
}

function Review({ d, go, notes, counts }: { d: WizDraft; go: (i: number) => void; notes: ReturnType<typeof checkDraft>; counts: { places: number; people: number; secrets: number } }) {
  const world = useMemo(() => buildWorld(d), [d]);
  const errors = validateWorld(world).filter((i) => i.level === 'error');
  const rows: [StepId, string][] = [
    ['basics', `${d.name || '(이름 없음)'}${d.logline ? ` — ${d.logline}` : ''}`],
    ['background', d.overview ? `${d.overview.slice(0, 80)}${d.overview.length > 80 ? '…' : ''}` : '(비어 있음)'],
    ['places', `${counts.places}곳`],
    ['people', `${counts.people}명`],
    ['secrets', `${counts.secrets}개`],
    ['goal', d.goal.name ? `${d.goal.name} · 단계 ${d.goal.stages.filter((s) => s.objective.trim()).length} · 결말 ${d.endings.filter((e) => e.name.trim()).length}` : '(목표 없음 — 자유 탐험)'],
    ['start', d.start.scene ? `${d.places.find((p) => p.key === d.start.place)?.name ?? '?'} · ${d.start.scene.slice(0, 50)}${d.start.scene.length > 50 ? '…' : ''}` : '(비어 있음)'],
  ];
  return (
    <>
      <ul className="wiz-review">
        {rows.map(([id, text]) => {
          const i = STEPS.findIndex((s) => s.id === id);
          const mine = notes.filter((n) => n.step === id);
          return (
            <li key={id}>
              <div className="wiz-review-head">
                <b>{STEPS[i]!.icon} {STEPS[i]!.title}</b>
                <button type="button" className="small" onClick={() => go(i)}>고치기</button>
              </div>
              <span className="small">{text}</span>
              {mine.map((n) => <span key={n.text} className={`small wiz-note ${n.level}`}>{n.level === 'need' ? '● 꼭: ' : '○ '}{n.text}</span>)}
            </li>
          );
        })}
      </ul>
      {errors.length > 0 && <p className="small status">검사기 오류 {errors.length}개: {errors.slice(0, 3).map((e) => e.message).join(' · ')}</p>}
    </>
  );
}
