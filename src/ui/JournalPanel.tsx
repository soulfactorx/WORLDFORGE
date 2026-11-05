import { knowledgeOf } from '../engine/knowledge/knowledge';
import { AXES, AXIS_NAMES, HOSTILE_STAGES, loyaltyOf, OBEY_LOYALTY, relationshipOf, reputationLabel, reputationOf, stageFor } from '../engine/relationship';
import type { WorldPackage } from '../engine/schema';
import type { GameState } from '../engine/state/state';
import { calendarDate } from '../engine/calendar';
import { allJobs } from '../engine/jobs';
import { QUEST_TYPE_LABEL } from '../engine/scenario';

const LABEL = { rumor: '소문', partial: '들은 이야기', confirmed: '확인됨', mistaken: '잘못 앎', secret: '비밀' } as const;

/** 플레이어 수첩: 알게 된 것과 만난 사람들. 진위는 보여주지 않는다. */
export function JournalPanel({ world, state }: { world: WorldPackage; state: GameState }) {
  const all = knowledgeOf(world, state.beliefs, 'player');
  const prior = all.filter((k) => k.source === 'start');
  const known = all.filter((k) => k.source !== 'start');
  const date = calendarDate(world, state.worldMinutes);
  const metIds = [...new Set([...Object.keys(state.npcMemory), ...Object.keys(state.party), ...Object.keys(state.relationships)])];
  const met = metIds.map((id) => world.characters.find((c) => c.id === id)).filter((c) => !!c);
  const quests = (world.quests ?? []).filter((q) => state.quests[q.id]);
  const jobs = allJobs(world).flatMap((job) => (state.jobs?.[job.id] ? [{ job, st: state.jobs[job.id]! }] : []));
  const deadline = (days: number | undefined, from: number | undefined) => {
    if (!days || from === undefined) return '';
    const left = Math.ceil(days - (state.worldMinutes - from) / 1440);
    return left <= 0 ? ' · 기한 오늘까지' : ` · 기한 ${left}일 남음`;
  };
  const arcs = (world.arcs ?? []).flatMap((arc) => (state.arcs?.[arc.id] ? [{ arc, p: state.arcs[arc.id]! }] : []));
  // 평판이 바뀌었거나, 만난 사람이 속한 세력만 보여준다
  const factions = (world.factions ?? []).filter((f) => (state.reputation ?? {})[f.id] !== undefined || met.some((c) => c.faction === f.id));
  return (
    <aside className="sheet">
      {arcs.length > 0 && (
        <>
          <b>이야기</b>
          <ul className="arcs">
            {arcs.map(({ arc, p }) => {
              const ch = arc.chapters[p.chapter];
              return (
                <li key={arc.id} className={p.done ? 'done' : ''}>
                  <b>{arc.name}</b>{' '}
                  {p.done ? <span className={`tag ${p.failed ? 'stage-hostile' : 'confirmed'}`}>{p.failed ? '실패' : '완료'}</span>
                    : ch && <span className="small">{p.chapter + 1}장 「{ch.name}」{ch.summary ? ` — ${ch.summary}` : ''}</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <b>임무</b>
      {quests.length === 0 ? (
        <p className="muted small">아직 맡은 일이 없다.</p>
      ) : (
        <ul className="quests">
          {quests.map((q) => {
            const p = state.quests[q.id]!;
            return (
              <li key={q.id} className={p.done ? (p.failed ? 'done failed' : 'done') : ''}>
                <span className={`tag ${q.kind === 'main' ? 'confirmed' : ''}`}>{q.kind === 'main' ? '메인' : '사이드'}</span>{' '}
                {q.type && <span className="tag">{QUEST_TYPE_LABEL[q.type]}</span>}{' '}
                <b>{q.name}</b>
                {q.giver && <span className="small muted"> · 의뢰인 {world.characters.find((c) => c.id === q.giver)?.name}</span>}
                {p.done ? <span className={`small ${p.failed ? 'warn-text' : 'muted'}`}> — {p.failed ? '실패' : '완료'}</span> : <div className="small">▸ {q.stages[p.stage]?.objective}{deadline(q.timeLimit?.days, p.startedAt)}</div>}
                {/* 지난 단계 */}
                {q.stages.slice(0, p.stage).map((st) => <div key={st.objective} className="small muted past">✓ {st.objective}</div>)}
              </li>
            );
          })}
        </ul>
      )}
      {jobs.length > 0 && (
        <>
          <b>의뢰</b>
          <ul className="quests">
            {jobs.map(({ job, st }) => (
              <li key={job.id} className={st.active ? '' : 'done'}>
                <span className="tag">{QUEST_TYPE_LABEL[job.type]}</span> <b>{job.name}</b>
                {st.active ? <div className="small">▸ {job.description} ({world.locations.find((l) => l.id === job.locationId)?.name}){deadline(job.timeLimit?.days, st.active.acceptedAt)}</div>
                  : <span className="small muted"> — 완료 {st.done}회{st.failed ? ` · 실패 ${st.failed}회` : ''}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {date && <p className="small">오늘: <b>{date.label}</b>{date.countdown && <> · <b className="dday">{date.countdown}</b></>}{date.elapsed > 0 && <span className="muted"> (시작한 지 {date.elapsed}일째)</span>}</p>}
      <b>알게 된 것</b>
      {known.length === 0 ? (
        <p className="muted small">아직 이 세계에 대해 아는 것이 없다.</p>
      ) : (
        <ul className="journal">
          {known.map((k) => <li key={k.statement}><span className={`tag ${k.state}`}>{LABEL[k.state]}</span> {k.statement}</li>)}
        </ul>
      )}
      {prior.length > 0 && (
        <details className="prior">
          <summary><b>처음부터 알던 것</b> <span className="small muted">({prior.length}) — 원작·사전 지식</span></summary>
          <p className="small muted">고른 시작 방식 때문에 처음부터 머릿속에 있던 내용입니다(예: 원작을 읽은 빙의자의 기억). 이 세계에서는 <b>아직 일어나지 않은 일</b>도 있고, <b>당신의 행동으로 바뀔 수 있습니다</b>. 날짜는 위의 "오늘"과 비교해 보세요. 주변 인물들은 당신이 이걸 안다는 사실을 모릅니다.</p>
          <ul className="journal">
            {prior.map((k) => <li key={k.statement}><span className="tag prior-tag">원작 지식</span> {k.statement}</li>)}
          </ul>
        </details>
      )}
      <b>만난 사람들</b>
      {met.length === 0 ? (
        <p className="muted small">아직 제대로 이야기를 나눈 사람이 없다.</p>
      ) : (
        <ul className="people">
          {met.map((c) => {
            const r = relationshipOf(world, state.relationships, c.id);
            const stage = stageFor(world, state.relationships, c.id);
            const loyalty = loyaltyOf(r);
            return (
              <li key={c.id}>
                <div className="row">
                  {c.portrait && <img className="portrait small-portrait" src={c.portrait} alt="" />}
                  <b>{c.name}</b>
                  <span className={`tag ${HOSTILE_STAGES.includes(stage) ? 'stage-hostile' : stage === '낯섦' || stage === '아는 사이' ? '' : 'stage-close'} ${stage === '연인' ? 'stage-lover' : ''}`}>{stage}</span>
                  {state.party[c.id] && <span className="tag confirmed">동료</span>}
                  {state.party[c.id] && <span className={`small ${loyalty < OBEY_LOYALTY ? 'warn-text' : 'muted'}`} title="충성도가 낮으면 전투 명령을 따르지 않는다">충성 {loyalty}</span>}
                </div>
                <div className="rel-bars small">
                  {AXES.map((a) => (
                    <span key={a} className="rel">
                      <span className="muted">{AXIS_NAMES[a]}</span>
                      <span className="bar"><span className={(a === 'grudge' || a === 'fear' ? r[a] > 0 : r[a] < 0) ? 'neg' : 'pos'} style={{ width: `${Math.abs(r[a]) / 2}%`, [r[a] < 0 ? 'right' : 'left']: '50%' }} /></span>
                    </span>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {factions.length > 0 && (
        <>
          <b>세력 평판</b>
          <ul className="people">
            {factions.map((f) => {
              const n = reputationOf(world, state.reputation ?? {}, f.id);
              return <li key={f.id} className="row"><b>{f.name}</b> <span className={`tag ${n <= -10 ? 'stage-hostile' : n >= 10 ? 'stage-close' : ''}`}>{reputationLabel(n)}</span> <span className="small muted">{n > 0 ? '+' : ''}{n}</span></li>;
            })}
          </ul>
        </>
      )}
    </aside>
  );
}
