import { buyPrice, itemDef, moneyOf, priceFactor, sellPrice } from '../engine/items';
import type { ItemDef, WorldPackage } from '../engine/schema';
import type { GameEvent } from '../engine/state/events';
import type { GameState } from '../engine/state/state';
import { acceptJob, buyItem, currencyName, equipItem, sellItem, shopHere, useItem } from '../gm/economy';
import { boardHere, jobRewards, jobStatus } from '../engine/jobs';
import { QUEST_TYPE_LABEL } from '../engine/scenario';
import { useRs } from './reskin';

const KIND_LABEL: Record<ItemDef['kind'], string> = { consumable: '소모품', weapon: '무기', armor: '갑옷', shield: '방패', key: '중요한 물건', treasure: '보물', misc: '잡동사니' };
const SLOT: Partial<Record<ItemDef['kind'], 'weapon' | 'armor' | 'shield'>> = { weapon: 'weapon', armor: 'armor', shield: 'shield' };

/** 소지품: 쓰기·장비하기 (설계 v3 6.4) */
export function InventoryPanel({ world, state, onCommit, disabled }: { world: WorldPackage; state: GameState; onCommit: (make: (s: GameState) => GameEvent[]) => void; disabled: boolean }) {
  const rs = useRs();
  const cur = currencyName(world);
  const items = Object.entries(state.inventory ?? {}).filter(([, n]) => n > 0).map(([id, n]) => ({ def: itemDef(world, id), id, n }));
  const eq = state.equipped ?? {};
  return (
    <aside className="sheet inventory">
      <div className="row"><b>소지품</b><span className="spacer" /><span><b>{moneyOf(state).toLocaleString()}</b> {rs(cur)}</span></div>
      {items.length === 0 ? <p className="muted small">가진 것이 없다.</p> : (
        <ul className="items-list">
          {items.map(({ def, id, n }) => {
            const slot = def ? SLOT[def.kind] : undefined;
            const worn = slot && eq[slot] === id;
            return (
              <li key={id}>
                <div className="row">
                  <b>{rs(def?.name ?? id)}</b>{n > 1 && <span className="muted">×{n}</span>}
                  {def && <span className="tag">{KIND_LABEL[def.kind]}</span>}
                  {worn && <span className="tag confirmed">장비 중</span>}
                  <span className="spacer" />
                  {def?.kind === 'consumable' && <button type="button" className="small" disabled={disabled || (!!def.heal && state.player.sheet.hp >= state.player.sheet.maxHp && !def.cures?.length)} onClick={() => onCommit((s) => useItem(world, s, id))}>쓰기</button>}
                  {slot && !worn && <button type="button" className="small" disabled={disabled} onClick={() => onCommit((s) => equipItem(world, s, id))}>장비</button>}
                  {slot && worn && <button type="button" className="small" disabled={disabled} onClick={() => onCommit((s) => equipItem(world, s, null, slot))}>벗기</button>}
                </div>
                {def?.description && <p className="small muted">{rs(def.description)}</p>}
              </li>
            );
          })}
        </ul>
      )}
      <p className="small muted">전투에서는 물약이 카드로 손패에 들어온다 (보너스 행동, 같은 존의 쓰러진 동료에게도 먹일 수 있다). 장비한 무기는 공격 카드가 된다.</p>
    </aside>
  );
}

/** 상점: 사기·팔기. 세력 평판이 값에 반영된다 */
export function ShopPanel({ world, state, onCommit, disabled }: { world: WorldPackage; state: GameState; onCommit: (make: (s: GameState) => GameEvent[]) => void; disabled: boolean }) {
  const rs = useRs();
  const shop = shopHere(world, state);
  if (!shop) return null;
  const cur = currencyName(world);
  const f = priceFactor(world, state, shop);
  const stock = shop.items.map((id) => itemDef(world, id)).filter((x): x is ItemDef => !!x);
  const mine = Object.entries(state.inventory ?? {}).filter(([, n]) => n > 0).map(([id, n]) => ({ def: itemDef(world, id), n })).filter((x): x is { def: ItemDef; n: number } => !!x.def && x.def.kind !== 'key');
  return (
    <aside className="sheet shop">
      <div className="row"><b>🛒 {rs(shop.name)}</b><span className="spacer" /><span>가진 돈 <b>{moneyOf(state).toLocaleString()}</b> {rs(cur)}</span></div>
      {f === null ? <p className="status">상인이 당신을 보고 고개를 젓는다. 평판이 너무 나빠 거래하지 않는다.</p> : (
        <>
          {f !== 1 && <p className="small muted">{f < 1 ? '평판이 좋아 값을 깎아 준다' : '평판이 나빠 값을 올려 부른다'} (×{f})</p>}
          <ul className="items-list">
            {stock.map((def) => {
              const price = buyPrice(def, f);
              return (
                <li key={def.id} className="row">
                  <b>{rs(def.name)}</b><span className="small muted">{rs(def.description)}</span><span className="spacer" />
                  <span>{price} {rs(cur)}</span>
                  <button type="button" className="small" disabled={disabled || moneyOf(state) < price} onClick={() => onCommit((s) => buyItem(world, s, def.id))}>사기</button>
                </li>
              );
            })}
          </ul>
          {shop.buys !== false && mine.length > 0 && (
            <>
              <b className="small">팔기 (절반 값)</b>
              <ul className="items-list">
                {mine.map(({ def, n }) => (
                  <li key={def.id} className="row">
                    <span>{rs(def.name)}{n > 1 ? ` ×${n}` : ''}</span><span className="spacer" /><span>{sellPrice(def)} {rs(cur)}</span>
                    <button type="button" className="small" disabled={disabled} onClick={() => onCommit((s) => sellItem(world, s, def.id))}>팔기</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </aside>
  );
}

/** 의뢰판 (설계 v3 6.3): 받을 수 있는 의뢰·진행 중·잠긴 의뢰 */
export function BoardPanel({ world, state, onCommit, disabled }: { world: WorldPackage; state: GameState; onCommit: (make: (s: GameState) => GameEvent[]) => void; disabled: boolean }) {
  const rs = useRs();
  const board = boardHere(world, state);
  if (!board) return null;
  const cur = currencyName(world);
  return (
    <aside className="sheet board">
      <b>📜 {rs(board.name)}</b>
      <ul className="items-list">
        {board.jobs.map((job) => {
          const st = jobStatus(world, state, job);
          const r = jobRewards(job);
          const where = world.locations.find((l) => l.id === job.locationId)?.name;
          return (
            <li key={job.id}>
              <div className="row">
                <span className="tag">{QUEST_TYPE_LABEL[job.type]}</span><b>{rs(job.name)}</b>
                <span className="spacer" />
                {r.money ? <span className="small">보상 {r.money} {rs(cur)}</span> : null}
                {st === 'available' && <button type="button" className="small" disabled={disabled} onClick={() => onCommit((s) => acceptJob(world, s, job.id))}>맡기</button>}
                {st === 'active' && <span className="tag confirmed">진행 중</span>}
                {st === 'locked' && <span className="tag muted">아직 맡길 수 없다</span>}
                {st === 'done' && <span className="tag">끝남</span>}
              </div>
              <p className="small muted">{rs(job.description)}{where ? ` — 장소: ${rs(where)}` : ''}{job.timeLimit ? ` · 기한 ${job.timeLimit.days}일` : ''}{state.jobs?.[job.id]?.done ? ` · 완료 ${state.jobs[job.id]!.done}회` : ''}</p>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
