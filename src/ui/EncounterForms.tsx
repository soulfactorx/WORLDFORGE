/**
 * 조우 편집 (v0.85): 적·발동 조건(GM용) + 엔진 조건·강제 시작·결과에 따라 남는 것·다시 일어나기.
 * 지금까지 조우는 JSON으로만 고칠 수 있었다.
 */
import { monstersOfWorld } from '../engine/combat/monsters';
import { encounterStages } from '../engine/encounter';
import { type Encounter, ENCOUNTER_RETRY_TURNS, type WorldPackage } from '../engine/schema';
import { ConditionField } from './ConditionEditor';
import { Area, ItemList, JsonField, Num, Select, Text } from './form';
import { SPEC, StructField } from './Struct';
import { EffectsEditor } from './WorldForms';

type Set = (patch: Partial<WorldPackage>) => void;

const RETRY_OPTS = [['default', `${ENCOUNTER_RETRY_TURNS}턴 쉬었다가 다시 (기본)`], ['turns', '쉬는 턴 수를 직접 정한다'], ['now', '바로 다시 일어날 수 있다'], ['gone', '다시 일어나지 않는다']] as const;
const retryMode = (r: Encounter['retry']) => (r === undefined ? 'default' : r === 'gone' ? 'gone' : r === 0 ? 'now' : 'turns');

export function EncounterForms({ w, set }: { w: WorldPackage; set: Set }) {
  const locs = w.locations.map((l) => [l.id, l.name] as const);
  const monsters = [...monstersOfWorld(w).map((m) => [m.id, `${m.name} · ${m.xp}XP`] as const), ...w.characters.map((c) => [`npc:${c.id}`, `인물: ${c.name}`] as const)];
  return (
    <ItemList<Encounter> title="조우" testKind="encounter" items={w.encounters ?? []} onChange={(encounters) => set({ encounters })}
      make={(n) => ({ id: `enc/new-${n}`, name: '새 조우', locationId: w.locations[0]?.id ?? '', enemies: [{ monsterId: monsters[0]?.[0] ?? '', zone: 2 }], trigger: '' })}
      render={(e, up) => {
        const stages = encounterStages(w, e.id);
        const fx = (key: 'onVictory' | 'onDefeat' | 'onFlee', label: string) => (
          <EffectsEditor label={label} value={e[key]} w={w} onChange={(v) => up({ [key]: v.length ? v : undefined } as Partial<Encounter>)} />
        );
        return (
          <div className="form-grid">
            <Text label="ID" value={e.id} onChange={(id) => up({ id })} />
            <Text label="이름" value={e.name} onChange={(name) => up({ name })} />
            <Select label="장소" value={e.locationId} options={locs} onChange={(locationId) => up({ locationId })} />
            <fieldset className="cond-field">
              <legend>적</legend>
              {e.enemies.map((en, i) => {
                const upE = (p: Partial<typeof en>) => up({ enemies: e.enemies.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                return (
                  <div key={i} className="enc-enemy">
                    <Select label="누구" value={en.monsterId} options={monsters} onChange={(monsterId) => upE({ monsterId })} />
                    <Select label="자리" value={String(en.zone) as '2' | '3'} options={[['2', '전열'], ['3', '후열']] as const} onChange={(z) => upE({ zone: z === '3' ? 3 : 2 })} />
                    {e.enemies.length > 1 && <button type="button" className="small" aria-label="이 적 빼기" onClick={() => up({ enemies: e.enemies.filter((_, j) => j !== i) })}>🗑</button>}
                  </div>
                );
              })}
              <button type="button" className="small" onClick={() => up({ enemies: [...e.enemies, { monsterId: monsters[0]?.[0] ?? '', zone: 2 }] })}>＋ 적 추가</button>
            </fieldset>
            <Area label="발동 조건 (GM용 — 플레이어가 무엇을 하면 싸움이 시작되는가)" value={e.trigger} onChange={(trigger) => up({ trigger })} rows={2} />
            <Area label="전투 직전 한 줄 (선택 — 서술의 재료)" value={e.intro ?? ''} onChange={(intro) => up({ intro: intro || undefined })} rows={2} />
            <fieldset className="cond-field">
              <legend>언제 일어날 수 있나</legend>
              <p className="small muted enc-note">
                {e.when ? '아래 조건이 참일 때만 일어난다.'
                  : stages.length ? `조건을 비워 두었고 임무 단계에 걸려 있어, 그 단계가 진행 중일 때만 일어난다 — ${stages.map((g) => `${g.questName} ${g.stage + 1}단계`).join(', ')}. 언제나 열어 두려면 "조건 정하기"를 누르고 조건을 비운 채 둔다.`
                    : '조건이 없고 임무에도 걸려 있지 않아 언제나 일어날 수 있다 (GM이 발동 조건을 보고 시작한다).'}
              </p>
              <ConditionField label="일어날 수 있는 조건" value={e.when} world={w} optional onChange={(when) => up({ when })} />
              <ConditionField label="이 조건이 참이 되면 GM 판단 없이 바로 시작 (매복·결전)" value={e.force} world={w} optional onChange={(force) => up({ force })} />
            </fieldset>
            <fieldset className="cond-field">
              <legend>지거나 달아난 뒤</legend>
              <div className="enc-retry">
                <Select label="같은 조우가 다시 일어나기까지" value={retryMode(e.retry)} options={RETRY_OPTS}
                  onChange={(m) => up({ retry: m === 'default' ? undefined : m === 'gone' ? 'gone' : m === 'now' ? 0 : typeof e.retry === 'number' && e.retry > 0 ? e.retry : ENCOUNTER_RETRY_TURNS })} />
                {retryMode(e.retry) === 'turns' && <Num label="쉬는 턴 수" value={e.retry as number} onChange={(v) => up({ retry: Math.max(1, Math.min(99, Math.round(v ?? ENCOUNTER_RETRY_TURNS))) })} />}
              </div>
            </fieldset>
            {fx('onVictory', '이겼을 때 세계에 남는 것')}
            {fx('onDefeat', '졌을 때 (예: 붙잡힘 — 플래그 + 플레이어 옮기기 + 장면으로 이어진다)')}
            {fx('onFlee', '달아났을 때')}
            <StructField w={w} spec={{ fields: SPEC.loot }} label="전리품 (비우면 적 경험치에 비례한 돈과 굴린 아이템)" value={e.loot ?? null} rows={3} onChange={(loot) => up({ loot: loot && typeof loot === 'object' ? loot : undefined })}
              help='예: { "money": 30, "items": [{ "itemId": "std/potion-healing", "n": 2 }] }' />
          </div>
        );
      }} />
  );
}
