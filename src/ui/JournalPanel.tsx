import { knowledgeOf } from '../engine/knowledge/knowledge';
import { AXES, AXIS_NAMES, relationshipOf, stageOf } from '../engine/relationship';
import type { WorldPackage } from '../engine/schema';
import type { GameState } from '../engine/state/state';

const LABEL = { rumor: '소문', partial: '들은 이야기', confirmed: '확인됨', mistaken: '잘못 앎', secret: '비밀' } as const;

/** 플레이어 수첩: 알게 된 것과 만난 사람들. 진위는 보여주지 않는다. */
export function JournalPanel({ world, state }: { world: WorldPackage; state: GameState }) {
  const known = knowledgeOf(world, state.beliefs, 'player');
  const metIds = [...new Set([...Object.keys(state.npcMemory), ...Object.keys(state.party), ...Object.keys(state.relationships)])];
  const met = metIds.map((id) => world.characters.find((c) => c.id === id)).filter((c) => !!c);
  return (
    <aside className="sheet">
      <b>수첩</b>
      {known.length === 0 ? (
        <p className="muted small">아직 이 세계에 대해 아는 것이 없다.</p>
      ) : (
        <ul className="journal">
          {known.map((k) => <li key={k.statement}><span className={`tag ${k.state}`}>{LABEL[k.state]}</span> {k.statement}</li>)}
        </ul>
      )}
      <b>만난 사람들</b>
      {met.length === 0 ? (
        <p className="muted small">아직 제대로 이야기를 나눈 사람이 없다.</p>
      ) : (
        <ul className="people">
          {met.map((c) => {
            const r = relationshipOf(world, state.relationships, c.id);
            return (
              <li key={c.id}>
                <div className="row">
                  <b>{c.name}</b>
                  <span className={`tag stage-${stageOf(r)}`}>{stageOf(r)}</span>
                  {state.party[c.id] && <span className="tag confirmed">동료</span>}
                </div>
                <div className="rel-bars small">
                  {AXES.map((a) => (
                    <span key={a} className="rel">
                      <span className="muted">{AXIS_NAMES[a]}</span>
                      <span className="bar"><span className={r[a] < 0 ? 'neg' : 'pos'} style={{ width: `${Math.abs(r[a]) / 2}%`, [r[a] < 0 ? 'right' : 'left']: '50%' }} /></span>
                    </span>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
