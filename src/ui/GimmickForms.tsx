/**
 * 함정·퍼즐 편집 (v0.129): 쉬운 양식 → 장면. 바꿀 때마다 장면을 다시 만든다.
 * 만든 장면은 「장면」 탭에는 보이지 않는다 (여기서만 고친다).
 */
import { useState } from 'react';
import { SKILLS, SKILL_IDS } from '../engine/character/rules';
import { GIMMICK_KINDS, gimmickScene } from '../engine/gimmick';
import type { Gimmick, Rewards, SceneDef, StoryEffect, WorldPackage } from '../engine/schema';
import { Area, ItemList, Num, Select, Text } from './form';

type Set = (patch: Partial<WorldPackage>) => void;

const SKILL_OPTS = SKILL_IDS.map((id) => [`skill:${id}`, SKILLS[id].name] as const);
const DEFAULTS: Record<Gimmick['kind'], { name: string; g: Gimmick }> = {
  trap: { name: '숨은 함정', g: { kind: 'trap', intro: '발밑의 돌 하나가 다른 돌보다 조금 솟아 있다.', findDc: 13, reveal: '누르면 벽에서 화살이 날아오는 발판이다.', disarm: { check: 'skill:sleight_of_hand', dc: 13 }, avoid: { check: 'skill:acrobatics', dc: 12 }, sprung: '딸깍 — 벽 틈에서 화살이 날아든다!', damage: '2d6' } },
  riddle: { name: '문지기의 수수께끼', g: { kind: 'riddle', intro: '돌문에 글귀가 새겨져 있고, 그 아래 입 모양의 구멍이 있다.', question: '아침에는 네 발, 낮에는 두 발, 저녁에는 세 발로 걷는 것은?', answers: ['사람', '인간'], tries: 3, hint: { check: 'skill:history', dc: 12, text: '옛이야기에서 지팡이를 짚는 노인을 "세 발"이라 불렀다.' } } },
  sequence: { name: '세 개의 레버', g: { kind: 'sequence', intro: '벽에 해·달·별이 새겨진 레버 세 개가 있다.', steps: ['해', '달', '별'], mistakes: 3, hint: { check: 'skill:investigation', dc: 12, text: '벽화 속 하루는 해가 뜨고, 달이 오르고, 별이 남는다.' } } },
  device: { name: '봉인된 문', g: { kind: 'device', intro: '희미하게 빛나는 문양이 문을 가로막고 있다.', check: { check: 'skill:arcana', dc: 13, label: '봉인 풀기' }, alt: { check: 'skill:athletics', dc: 15, label: '힘으로 밀어 열기' }, goal: 3, mistakes: 3, damage: '1d6' } },
};

const rebuild = (d: SceneDef, g: Gimmick): SceneDef => gimmickScene({ id: d.id, name: d.name, ...(d.locationId ? { locationId: d.locationId } : {}), ...(d.image ? { image: d.image } : {}), ...(d.narration ? { narration: d.narration } : {}) }, g);

export function GimmickForms({ w, set }: { w: WorldPackage; set: Set }) {
  const all = w.scenes ?? [];
  const mine = all.filter((d) => d.gimmick);
  const [kind, setKind] = useState<Gimmick['kind']>('trap');
  const save = (list: SceneDef[]) => { const rest = all.filter((d) => !d.gimmick); const next = [...rest, ...list]; set({ scenes: next.length ? next : undefined }); };
  return (
    <>
      <p className="muted small">
        <b>함정·퍼즐</b>은 장소에 놓는 기믹입니다. 판정은 엔진(d20 + 기술)이 하고, AI는 결과를 서술만 합니다. <b>막는 길</b>을 정하면 그 기믹을 지나가기(함정) · 풀기(퍼즐) 전에는 그쪽으로 갈 수 없습니다.
        함정은 그 장소에 들어서면 저절로 시작되고, 퍼즐은 플레이어가 살피거나 건드리면 GM이 엽니다 (🎭 버튼으로도). 실패하거나 그만두면 나중에 다시 해 볼 수 있습니다.
      </p>
      <div className="row gimmick-add">
        <label>종류
          <select value={kind} onChange={(e) => setKind(e.target.value as Gimmick['kind'])}>
            {GIMMICK_KINDS.map(([k, l, d]) => <option key={k} value={k}>{l} — {d}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => {
          const n = all.length + 1;
          let id = `scene/gimmick-${n}`; let i = n; while (all.some((d) => d.id === id)) id = `scene/gimmick-${++i}`;
          const def = DEFAULTS[kind];
          save([...mine, gimmickScene({ id, name: def.name, locationId: w.start.locationId }, structuredClone(def.g))]);
        }}>＋ 예시로 추가</button>
      </div>
      {mine.length === 0 ? <p className="small muted">아직 함정·퍼즐이 없습니다. 종류를 고르고 "예시로 추가"를 누른 뒤 고쳐 보세요.</p> : (
        <ItemList<SceneDef> title="함정·퍼즐" items={mine} testKind="scene" onChange={save}
          make={(n) => gimmickScene({ id: `scene/gimmick-new-${n}`, name: DEFAULTS[kind].name, locationId: w.start.locationId }, structuredClone(DEFAULTS[kind].g))}
          render={(d, up) => <GimmickForm w={w} d={d} onChange={(nd) => up(nd)} />} />
      )}
    </>
  );
}

function GimmickForm({ w, d, onChange }: { w: WorldPackage; d: SceneDef; onChange: (d: SceneDef) => void }) {
  const g = d.gimmick!;
  const setG = (p: Partial<Gimmick>) => onChange(rebuild(d, { ...g, ...p }));
  const setBase = (p: Partial<SceneDef>) => onChange(rebuild({ ...d, ...p }, g));
  const here = w.locations.find((l) => l.id === d.locationId);
  const lines = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);
  const effects = g.onSuccess?.effects ?? [];
  const pick = <K extends string>(list: StoryEffect[], key: K) => list.find((x) => key in x) as Record<K, string> | undefined;
  const setSuccessFx = (key: 'giveItem' | 'reveal' | 'setFlag', v: string) => {
    const rest = effects.filter((x) => !(key in x));
    setG({ onSuccess: { ...g.onSuccess, effects: v ? [...rest, { [key]: v } as StoryEffect] : rest } });
  };
  const failFx = g.onFail?.effects ?? [];
  const xp = g.onSuccess?.rewards?.xp;
  return (
    <div className="form-grid gimmick-form">
      <Text label="이름" value={d.name} onChange={(name) => setBase({ name })} />
      <Select label="종류" value={g.kind} options={GIMMICK_KINDS.map(([k, l]) => [k, l] as const)} onChange={(kind) => setG({ ...DEFAULTS[kind].g, intro: g.intro, ...(g.guards ? { guards: g.guards } : {}), onSuccess: g.onSuccess, onFail: g.onFail, kind })} />
      <Select label="장소" value={d.locationId ?? ''} options={w.locations.map((l) => [l.id, l.name] as const)} onChange={(locationId) => onChange(rebuild({ ...d, locationId }, { ...g, guards: undefined }))} />
      <Select label="막는 길 (이 장소에서 그곳으로)" value={g.guards ?? ''} options={[['', '(막지 않음)'], ...(here?.connections ?? []).map((id) => [id, w.locations.find((l) => l.id === id)?.name ?? id] as const)] as const} onChange={(guards) => setG({ guards: guards || undefined })} />
      <Area label={g.kind === 'trap' ? '처음 보이는 낌새 (함정이라고 말하지 않는다)' : '처음 보이는 모습'} value={g.intro} onChange={(intro) => setG({ intro })} rows={2} />

      {g.kind === 'trap' && (
        <>
          <Num label="찾기 난이도 (지각 판정 DC)" value={g.findDc} onChange={(findDc) => setG({ findDc })} />
          <Area label="찾았을 때 보이는 정체" value={g.reveal} onChange={(reveal) => setG({ reveal })} rows={2} />
          <CheckField label="해제하기" value={g.disarm} onChange={(disarm) => setG({ disarm })} />
          <CheckField label="조심해서 지나가기" value={g.avoid} onChange={(avoid) => setG({ avoid })} />
          <Area label="걸렸을 때" value={g.sprung} onChange={(sprung) => setG({ sprung })} rows={2} />
        </>
      )}
      {g.kind === 'riddle' && (
        <>
          <Area label="문제" value={g.question} onChange={(question) => setG({ question })} rows={2} />
          <Area label="정답 (줄마다 하나 — 띄어쓰기·대소문자는 가리지 않는다)" value={(g.answers ?? []).join('\n')} onChange={(v) => setG({ answers: lines(v) })} rows={2} />
          <Num label="기회 (틀려도 되는 횟수 + 1)" value={g.tries} onChange={(tries) => setG({ tries })} />
        </>
      )}
      {g.kind === 'sequence' && (
        <>
          <Area label="올바른 순서 (줄마다 하나 — 플레이 화면에는 섞여 보인다)" value={(g.steps ?? []).join('\n')} onChange={(v) => setG({ steps: lines(v) })} rows={4} />
          <Num label="실수 허용 (이만큼 틀리면 실패)" value={g.mistakes} onChange={(mistakes) => setG({ mistakes })} />
        </>
      )}
      {g.kind === 'device' && (
        <>
          <CheckField label="주된 방법" value={g.check} withLabel onChange={(check) => setG({ check })} />
          <CheckField label="다른 방법 (선택)" value={g.alt} withLabel optional onChange={(alt) => setG({ alt })} />
          <Num label="필요한 성공 수" value={g.goal} onChange={(goal) => setG({ goal })} />
          <Num label="버틸 수 있는 실패 수" value={g.mistakes} onChange={(mistakes) => setG({ mistakes })} />
        </>
      )}
      <Text label="실패·걸렸을 때 피해 (주사위, 예: 2d6 · 비우면 없음 — HP는 1 밑으로 내려가지 않는다)" value={g.damage} onChange={(damage) => setG({ damage: damage.trim() || undefined })} />
      {g.kind !== 'trap' && (
        <fieldset className="gimmick-hint"><legend>단서 떠올리기 (선택)</legend>
          <Select label="판정" value={g.hint?.check ?? 'skill:investigation'} options={SKILL_OPTS} onChange={(check) => setG({ hint: { check, dc: g.hint?.dc ?? 12, text: g.hint?.text ?? '' } })} />
          <Num label="난이도" value={g.hint?.dc} onChange={(dc) => setG({ hint: { check: g.hint?.check ?? 'skill:investigation', dc: dc ?? 12, text: g.hint?.text ?? '' } })} />
          <Area label="떠오르는 단서 (비우면 단서 없음)" value={g.hint?.text} onChange={(text) => setG({ hint: text.trim() ? { check: g.hint?.check ?? 'skill:investigation', dc: g.hint?.dc ?? 12, text } : undefined })} rows={2} />
        </fieldset>
      )}

      <fieldset><legend>✔ {g.kind === 'trap' ? '해제했을 때' : '풀었을 때'}</legend>
        <Area label="결과 글" value={g.onSuccess?.text} onChange={(text) => setG({ onSuccess: { ...g.onSuccess, text } })} rows={2} />
        <Select label="경험치" value={xp === undefined ? 'minor' : String(xp) as 'minor'} options={[['minor', '작게'], ['major', '크게'], ['0', '없음']] as const}
          onChange={(v) => setG({ onSuccess: { ...g.onSuccess, rewards: { ...(g.onSuccess?.rewards ?? {}), xp: v === '0' ? 0 : v } as Rewards } })} />
        {(w.items ?? []).length > 0 && <Select label="얻는 물건" value={pick(effects, 'giveItem')?.giveItem ?? ''} options={[['', '(없음)'], ...(w.items ?? []).map((i) => [i.id, i.name] as const)] as const} onChange={(v) => setSuccessFx('giveItem', v)} />}
        {w.claims.length > 0 && <Select label="알게 되는 것" value={pick(effects, 'reveal')?.reveal ?? ''} options={[['', '(없음)'], ...w.claims.map((c) => [c.id, c.statement.slice(0, 40)] as const)] as const} onChange={(v) => setSuccessFx('reveal', v)} />}
      </fieldset>
      <fieldset><legend>✖ {g.kind === 'trap' ? '걸렸을 때 (그 뒤의 일)' : '실패했을 때'}</legend>
        {g.kind !== 'trap' && <Area label="결과 글" value={g.onFail?.text} onChange={(text) => setG({ onFail: { ...g.onFail, text } })} rows={2} />}
        {(w.encounters ?? []).length > 0 && <Select label="소란에 적이 몰려온다 (전투 시작)" value={(failFx.find((x) => 'startEncounter' in x) as { startEncounter: string } | undefined)?.startEncounter ?? ''}
          options={[['', '(없음)'], ...(w.encounters ?? []).map((e) => [e.id, e.name] as const)] as const}
          onChange={(v) => { const rest = failFx.filter((x) => !('startEncounter' in x)); setG({ onFail: { ...g.onFail, effects: v ? [...rest, { startEncounter: v }] : rest } }); }} />}
      </fieldset>
    </div>
  );
}

function CheckField({ label, value, onChange, withLabel, optional }: {
  label: string; value: { check: string; dc: number; label?: string } | undefined; onChange: (v: { check: string; dc: number; label?: string } | undefined) => void; withLabel?: boolean; optional?: boolean;
}) {
  const v = value ?? { check: '', dc: 13 };
  return (
    <fieldset className="gimmick-check"><legend>{label}</legend>
      <Select label="판정" value={v.check} options={[...(optional ? [['', '(쓰지 않음)'] as const] : []), ...SKILL_OPTS]} onChange={(check) => onChange(check ? { ...v, check } : undefined)} />
      <Num label="난이도 (DC)" value={v.dc} onChange={(dc) => onChange({ ...v, dc: dc ?? 13 })} />
      {withLabel && <Text label="버튼 이름" value={v.label} onChange={(l) => onChange({ ...v, label: l })} />}
    </fieldset>
  );
}
