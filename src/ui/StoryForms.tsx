/**
 * 임무·플래그·결말 폼 (R8 제작 도구 2.0). 조건은 조건 빌더로, 고급 항목은 JSON으로.
 */
import { CARD_LIST } from '../engine/combat/combat';
import { QUEST_TYPE_LABEL } from '../engine/scenario';
import { type Ending, type Quest, QUEST_TYPES, type StoryFlag, type WorldPackage } from '../engine/schema';
import { ConditionField } from './ConditionEditor';
import { Area, ItemList, JsonField, Num, Select, Text } from './form';

type Set = (patch: Partial<WorldPackage>) => void;

export function QuestForms({ w, set }: { w: WorldPackage; set: Set }) {
  const chars = [['', '(없음)'], ...w.characters.map((c) => [c.id, c.name] as const)] as const;
  return (
    <ItemList<Quest> title="임무" items={w.quests ?? []} onChange={(quests) => set({ quests })}
      make={(n) => ({ id: `quest/new-${n}`, name: '새 임무', kind: 'side', start: { all: [] }, stages: [{ objective: '목표', hint: '', complete: { all: [] } }] })}
      render={(q, up) => (
        <div className="form-grid">
          <Text label="ID" value={q.id} onChange={(id) => up({ id })} />
          <Text label="이름" value={q.name} onChange={(name) => up({ name })} />
          <Select label="메인/사이드" value={q.kind} options={[['main', '메인'], ['side', '사이드']] as const} onChange={(kind) => up({ kind })} />
          <Select label="유형" value={q.type ?? ''} options={[['', '(일반)'], ...QUEST_TYPES.map((t) => [t, QUEST_TYPE_LABEL[t]] as const)] as const} onChange={(type) => up({ type: type || undefined })} />
          <Select label="의뢰인" value={q.giver ?? ''} options={chars} onChange={(giver) => up({ giver: giver || undefined })} />
          <Select label="대상 (죽으면 실패)" value={q.target ?? ''} options={chars} onChange={(target) => up({ target: target || undefined })} />
          <Num label="기한 (일, 비우면 없음)" value={q.timeLimit?.days} onChange={(days) => up({ timeLimit: days ? { days } : undefined })} />
          <ConditionField label="시작 조건" value={q.start} world={w} onChange={(start) => up({ start: start ?? { all: [] } })} />
          <ConditionField label="실패 조건 (언제든)" value={q.fail} world={w} optional onChange={(fail) => up({ fail })} />
          <b>단계</b>
          {q.stages.map((st, i) => {
            const upSt = (patch: Partial<typeof st>) => up({ stages: q.stages.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
            return (
              <fieldset key={i} className="stage-box">
                <legend>{i + 1}단계</legend>
                <Text label="목표 (수첩에 보임)" value={st.objective} onChange={(objective) => upSt({ objective })} />
                <Area label="GM 힌트" value={st.hint} onChange={(hint) => upSt({ hint })} rows={2} />
                <ConditionField label="완료 조건" value={st.complete} world={w} onChange={(complete) => upSt({ complete: complete ?? { all: [] } })} />
                <ConditionField label="실패 조건 (이 단계에서만)" value={st.fail} world={w} optional onChange={(fail) => upSt({ fail })} />
                <div className="row">
                  {i > 0 && <button type="button" className="small" onClick={() => { const s2 = [...q.stages]; [s2[i - 1], s2[i]] = [s2[i]!, s2[i - 1]!]; up({ stages: s2 }); }}>▲ 위로</button>}
                  {q.stages.length > 1 && <button type="button" className="small" onClick={() => up({ stages: q.stages.filter((_, j) => j !== i) })}>단계 삭제</button>}
                </div>
              </fieldset>
            );
          })}
          <button type="button" className="small" onClick={() => up({ stages: [...q.stages, { objective: '다음 목표', hint: '', complete: { all: [] } }] })}>＋ 단계 추가</button>
          <fieldset><legend>보상</legend>
            <div className="ability-grid">
              <Select label="경험치 (레벨에 맞춰 계산)" value={typeof q.rewards?.xp === 'number' ? 'num' : q.rewards?.xp ?? 'none'}
                options={[['none', '없음'], ['minor', '작은 보상 (다음 레벨까지의 15%)'], ['major', '큰 보상 (40%)'], ['num', '직접 입력']] as const}
                onChange={(v) => up({ rewards: { ...q.rewards, xp: v === 'none' ? undefined : v === 'num' ? (typeof q.rewards?.xp === 'number' ? q.rewards.xp : 100) : v } })} />
              {typeof q.rewards?.xp === 'number' && <Num label="경험치 (고정 — 레벨이 높으면 최소 10%)" value={q.rewards.xp} onChange={(xp) => up({ rewards: { ...q.rewards, xp } })} />}
              <Num label="돈" value={q.rewards?.money} onChange={(money) => up({ rewards: { ...q.rewards, money } })} />
            </div>
            <JsonField label="그 밖의 보상 (아이템·관계·평판·카드)" value={{ items: q.rewards?.items ?? [], relationship: q.rewards?.relationship ?? [], reputation: q.rewards?.reputation ?? [], cards: q.rewards?.cards ?? [] }}
              onChange={(r) => r && typeof r === 'object' && up({ rewards: { ...q.rewards, ...Object.fromEntries(Object.entries(r).filter(([, v]) => Array.isArray(v) && v.length)), ...Object.fromEntries(Object.entries(r).filter(([, v]) => Array.isArray(v) && !v.length).map(([k]) => [k, undefined])) } })} rows={5}
              help={`예: "items": [{ "itemId": "std/potion-healing" }], "relationship": [{ "npcId": "npc/…", "trust": 10 }], "reputation": [{ "factionId": "fac/…", "delta": 5 }], "cards": [{ "who": "player", "cardId": "rogue/steady_aim" }] · 카드: ${CARD_LIST.slice(0, 12).join(', ')} …`} />
          </fieldset>
        </div>
      )} />
  );
}

export function FlagForms({ w, set }: { w: WorldPackage; set: Set }) {
  const locs = [['', '(어디서나)'], ...w.locations.map((l) => [l.id, l.name] as const)] as const;
  return (
    <ItemList<StoryFlag> title="플래그" items={w.flags ?? []} onChange={(flags) => set({ flags })}
      make={(n) => ({ id: `flag_${n}`, when: '플레이어가 무엇을 했을 때' })}
      render={(f, up) => (
        <div className="form-grid">
          <Text label="ID (소문자·숫자·_)" value={f.id} onChange={(id) => up({ id })} />
          <Area label="GM에게: 언제 이 플래그를 세우는가" value={f.when} onChange={(when) => up({ when })} rows={2} />
          <Select label="이 장소에서만" value={f.locationId ?? ''} options={locs} onChange={(locationId) => up({ locationId: locationId || undefined })} />
          <ConditionField label="이 조건일 때만 세울 수 있다" value={f.requires} world={w} optional onChange={(requires) => up({ requires })} />
        </div>
      )} />
  );
}

export function EndingForms({ w, set }: { w: WorldPackage; set: Set }) {
  return (
    <ItemList<Ending> title="결말" items={w.endings ?? []} onChange={(endings) => set({ endings })}
      make={(n) => ({ id: `ending/new-${n}`, name: '새 결말', condition: { all: [{ flag: w.flags?.[0]?.id ?? '' }] }, epilogue: '' })}
      render={(e, up) => (
        <div className="form-grid">
          <Text label="ID" value={e.id} onChange={(id) => up({ id })} />
          <Text label="이름" value={e.name} onChange={(name) => up({ name })} />
          <ConditionField label="도달 조건 (비우면 시작하자마자 끝난다 — 꼭 넣는다)" value={e.condition} world={w} onChange={(condition) => up({ condition: condition ?? { all: [] } })} />
          <Area label="에필로그 방향 (서술 AI에게)" value={e.epilogue} onChange={(epilogue) => up({ epilogue })} rows={3} />
        </div>
      )} />
  );
}
