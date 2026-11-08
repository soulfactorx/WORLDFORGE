/**
 * NPC 캐릭터 데이터 편집 (v0.79): 직업·기준 레벨·성장 방식·능력치·성향.
 * 미리보기: 주인공이 1·5·10레벨일 때 이 인물의 레벨·HP·능력 요약.
 */
import { ABILITIES, ABILITY_NAMES } from '../engine/character/rules';
import { suggestedStandardArray } from '../engine/character/sheet';
import { classesFor } from '../engine/classes';
import { npcClassOf, npcSheet, npcStatLine } from '../engine/npcStats';
import type { Character, NpcStats, WorldPackage } from '../engine/schema';
import type { GameState } from '../engine/state/state';
import { traitsFor } from '../engine/traits';

const GROWTH = [['follow', '주인공 따라 성장'], ['time', '시간 따라 성장'], ['fixed', '고정']] as const;

export function NpcStatsEditor({ c, w, onChange }: { c: Character; w: WorldPackage; onChange: (stats: NpcStats | undefined) => void }) {
  const st = c.stats ?? {};
  const up = (p: Partial<NpcStats>) => {
    const next = { ...st, ...p } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    onChange(Object.keys(next).length ? next as NpcStats : undefined);
  };
  const classes = classesFor(w);
  const cls = npcClassOf(w, c);
  const abilities = st.abilities ?? c.companion?.abilities ?? suggestedStandardArray(cls.base);
  const axes = traitsFor(w);
  const growth = st.growth ?? 'follow';
  const preview = [1, 5, 10].map((lv) => {
    const fake = { player: { sheet: { level: lv } }, worldMinutes: 8 * 60 + (lv - 1) * 7 * 1440, party: {} } as unknown as GameState;
    const sh = npcSheet(w, fake, c);
    return `주인공 ${lv}레벨${growth === 'time' ? `(${(lv - 1) * 7}일째)` : ''} → ${npcStatLine(w, fake, c)} · HP ${sh.maxHp}`;
  });
  return (
    <fieldset className="npc-stats">
      <legend>캐릭터 데이터 — 직업·레벨·능력치·성향 (전투·장면 판정에 쓰임)</legend>
      <div className="npc-stats-row">
        <label>직업<select value={st.role ?? (st.classId ? '' : cls.role?.id ?? '')} onChange={(e) => { const wc = classes.find((k) => k.id === e.target.value); up({ role: wc?.id, classId: wc ? undefined : st.classId }); }}>
          {classes.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select></label>
        <label>기준 레벨<input type="number" className="num" min={1} max={10} value={st.level ?? 1} onChange={(e) => up({ level: Math.max(1, Math.min(10, Number(e.target.value) || 1)) === 1 ? undefined : Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} /></label>
        <label>성장<select value={growth} onChange={(e) => up({ growth: e.target.value === 'follow' ? undefined : e.target.value as NpcStats['growth'] })}>
          {GROWTH.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></label>
        {growth === 'follow' && <label>주인공보다<input type="number" className="num" min={-9} max={9} value={st.offset ?? 0} onChange={(e) => up({ offset: Number(e.target.value) || undefined })} /></label>}
        {growth === 'time' && <label>며칠마다 1레벨<input type="number" className="num" min={1} value={st.everyDays ?? 7} onChange={(e) => up({ everyDays: Number(e.target.value) === 7 ? undefined : Math.max(1, Number(e.target.value) || 7) })} /></label>}
      </div>
      <div className="row"><b className="small">능력치</b><span className="small muted">{st.abilities ? '직접 정함' : '직업 추천값'}</span>
        {st.abilities && <button type="button" className="small" onClick={() => up({ abilities: undefined })}>추천값으로</button>}</div>
      <div className="ability-grid">
        {ABILITIES.map((a) => (
          <label key={a} className="small">{ABILITY_NAMES[a]}<input type="number" className="num" min={1} max={20} value={abilities[a]} onChange={(e) => up({ abilities: { ...abilities, [a]: Math.max(1, Math.min(20, Number(e.target.value) || 10)) } })} /></label>
        ))}
      </div>
      {axes.length > 0 && (
        <>
          <b className="small">성향 (주인공과 같은 축, -100~100)</b>
          <div className="npc-traits">
            {axes.map((t) => (
              <label key={t.id} className="small">{t.low} ↔ {t.high}
                <input type="range" min={-100} max={100} step={10} value={st.traits?.[t.id] ?? 0} onChange={(e) => { const v = Number(e.target.value); const tr = { ...(st.traits ?? {}), [t.id]: v }; if (!v) delete tr[t.id]; up({ traits: Object.keys(tr).length ? tr : undefined }); }} />
                <span className="muted">{st.traits?.[t.id] ?? 0}</span>
              </label>
            ))}
          </div>
        </>
      )}
      <ul className="small muted npc-preview">{preview.map((p) => <li key={p}>{p}</li>)}</ul>
      <p className="small muted">장면의 상대가 되면 맞서는 기술(설득→통찰, 은신→지각 …)이 판정 DC에 더해지고, 조우의 적으로 <code>npc:{c.id}</code>를 넣으면 이 능력치로 싸웁니다. 동료가 되면 그때의 레벨로 합류합니다.</p>
    </fieldset>
  );
}
