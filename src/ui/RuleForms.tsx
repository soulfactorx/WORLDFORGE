/**
 * 세계 규칙 편집 (v0.83): 행동 → 결과 · 상태 → 연쇄 반응 · 인물 반응
 */
import { useEffect, useState } from 'react';
import type { RelationAxis, WorldPackage, WorldRule } from '../engine/schema';
import { AXES, AXIS_NAMES } from '../engine/relationship';
import { ConditionField } from './ConditionEditor';
import { Area, ItemList, Num, Select, Text } from './form';
import { EffectsEditor } from './WorldForms';

type Set = (patch: Partial<WorldPackage>) => void;
const REPEAT_OPTS = [['once', '한 번만'], ['always', '매번'], ['cooldown', '몇 턴마다']] as const;

/** 쉼표로 구분한 낱말 — 입력 중에는 글 그대로 두고, 바뀔 때마다 목록으로 */
function Keywords({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  useEffect(() => { if (text.split(',').map((x) => x.trim()).filter(Boolean).join('|') !== value.join('|')) setText(value.join(', ')); }, [value.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label>바로 발동하는 낱말 (쉼표로 구분, 선택 — 입력에 이 낱말이 있으면 GM 판단 없이 발동)
      <input value={text} placeholder="예: 성배, 맹세를 깨" onChange={(e) => { setText(e.target.value); onChange(e.target.value.split(',').map((x) => x.trim()).filter(Boolean)); }} />
    </label>
  );
}

function Reactions({ rule, w, up }: { rule: WorldRule; w: WorldPackage; up: (p: Partial<WorldRule>) => void }) {
  const list = rule.reactions ?? [];
  const set = (i: number, p: Partial<NonNullable<WorldRule['reactions']>[number]>) => up({ reactions: list.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const npcs = [['present', '그 자리에 있는 모두'] as const, ...w.characters.map((c) => [c.id, `${c.name} (${c.id})`] as const)];
  return (
    <fieldset className="cond-field">
      <legend>인물 반응 (NPC 연기·서술에 들어간다)</legend>
      {list.map((re, i) => {
        const axis = (Object.keys(re.relationship ?? {})[0] ?? '') as RelationAxis | '';
        return (
          <div key={i} className="rule-reaction">
            <Select label="누가" value={re.npcId} options={npcs} onChange={(npcId) => set(i, { npcId })} />
            <Area label="어떻게 반응하나" value={re.text} rows={2} onChange={(text) => set(i, { text })} />
            <div className="rule-rel">
              <Select label="관계 변화" value={axis} options={[['', '(없음)'], ...AXES.map((a) => [a, AXIS_NAMES[a]] as const)]} onChange={(a) => set(i, { relationship: a ? { [a]: (axis && re.relationship?.[axis]) || 5 } : undefined })} />
              {axis && <Num label="얼마나" value={re.relationship?.[axis]} onChange={(v) => set(i, { relationship: { [axis]: v ?? 0 } })} />}
              <button type="button" className="small" aria-label="반응 빼기" onClick={() => up({ reactions: list.filter((_, j) => j !== i) })}>🗑</button>
            </div>
          </div>
        );
      })}
      <button type="button" className="small" onClick={() => up({ reactions: [...list, { npcId: 'present', text: '' }] })}>＋ 반응 추가</button>
    </fieldset>
  );
}

export function RuleForms({ w, set }: { w: WorldPackage; set: Set }) {
  return (
    <ItemList<WorldRule> title="세계 규칙" items={w.rules ?? []} onChange={(rules) => set({ rules })}
      make={(n) => ({ id: `rule/new-${n}`, name: '새 규칙', trigger: { kind: 'action', describe: '' }, outcome: '' })}
      render={(r, up) => {
        const rep = r.repeat ?? 'once';
        return (
          <div className="form-grid">
            <Text label="ID" value={r.id} onChange={(id) => up({ id })} />
            <Text label="이름" value={r.name} onChange={(name) => up({ name })} />
            <label className="check"><input type="checkbox" checked={r.enabled !== false} onChange={(e) => up({ enabled: e.target.checked ? undefined : false })} />켜짐</label>
            <Select label="언제 발동하나" value={r.trigger.kind} options={[['action', '플레이어의 행동·말'], ['state', '세계 상태가 조건을 채우는 순간 (연쇄)']]}
              onChange={(kind) => up({ trigger: kind === 'action' ? { kind, describe: '' } : { kind, condition: { all: [] } } })} />
            {r.trigger.kind === 'action' ? (
              <>
                <Area label="어떤 행동·말인가 (GM이 판단한다)" value={r.trigger.describe} rows={2} onChange={(describe) => up({ trigger: { ...(r.trigger as Extract<WorldRule['trigger'], { kind: 'action' }>), describe } })} />
                <Keywords key={r.id} value={r.trigger.keywords ?? []}
                  onChange={(keywords) => up({ trigger: { kind: 'action', describe: (r.trigger as { describe: string }).describe, ...(keywords.length ? { keywords } : {}) } })} />
              </>
            ) : (
              <ConditionField label="발동 조건 (거짓 → 참이 되는 순간)" value={r.trigger.condition} world={w} onChange={(condition) => up({ trigger: { kind: 'state', condition: condition ?? { all: [] } } })} />
            )}
            <ConditionField label="추가 조건 (이때만 발동, 선택)" value={r.requires} world={w} optional onChange={(requires) => up({ requires })} />
            <EffectsEditor label="결과 — 세계에 남는 변화 (엔진 확정)" value={r.effects} w={w} onChange={(effects) => up({ effects: effects.length ? effects : undefined })} />
            <Area label="결과 지시 (서술자에게: 무슨 일이 벌어지나)" value={r.outcome} rows={2} onChange={(outcome) => up({ outcome: outcome || undefined })} />
            <Reactions rule={r} w={w} up={up} />
            <Text label="플레이어 기록에 남는 알림 (비우면 조용히)" value={r.announce} onChange={(announce) => up({ announce: announce || undefined })} />
            <Select label="반복" value={typeof rep === 'number' ? 'cooldown' : rep} options={REPEAT_OPTS}
              onChange={(v) => up({ repeat: v === 'once' ? undefined : v === 'always' ? 'always' : 5 })} />
            {typeof rep === 'number' && <Num label="다시 발동하기까지 턴 수" value={rep} onChange={(v) => up({ repeat: Math.max(1, v ?? 1) })} />}
          </div>
        );
      }} />
  );
}
