/**
 * 내 에셋 보관함 (v0.158): 어느 세계에도 속하지 않은 재사용 부품(인물·장소·아이템·적·장면·함정·임무·카드·결말…)을 모아 둔다.
 * 따로 저장 형식을 만들지 않고 「보관함 세계」(정해진 ID의 숨은 세계)를 쓴다 — 만계서고의 가져오기 엔진(borrow)이
 * 딸린 것·그림·ID 겹침·출처(라이선스)를 그대로 처리하고, 보관함도 편집기(흐름도·탭)로 그대로 고친다.
 * 성인 등급의 것은 성인 등급 세계로만 가므로 보관함도 둘이다.
 */
import { borrow, type BorrowPick, type BorrowResult } from '../engine/borrow';
import type { WorldPackage } from '../engine/schema';
import { assetBlob, storeAssets } from './assets';
import { db } from './db';
import { blankWorld, savePackage } from './packages';

export const MY_ASSETS_ID = 'worldforge.my-assets';
export const MY_ASSETS_MATURE_ID = 'worldforge.my-assets-mature';
export const isMyAssets = (w: Pick<WorldPackage, 'manifest'>) => w.manifest.id === MY_ASSETS_ID || w.manifest.id === MY_ASSETS_MATURE_ID;

export function blankMyAssets(mature: boolean): WorldPackage {
  const b = blankWorld();
  return { ...b, manifest: { ...b.manifest, id: mature ? MY_ASSETS_MATURE_ID : MY_ASSETS_ID, name: mature ? '⭐ 내 에셋 (성인 등급)' : '⭐ 내 에셋', version: '0.1.0', contentRating: mature ? 'mature' : 'all', author: '' },
    locations: [{ id: 'loc/start', name: '(보관함 자리)', description: '내 에셋 보관함의 자리 표시 — 쓰지 않는다.', connections: [] }],
    start: { locationId: 'loc/start', openingScene: '' } };
}

export async function loadMyAssets(mature: boolean): Promise<WorldPackage> {
  const id = mature ? MY_ASSETS_MATURE_ID : MY_ASSETS_ID;
  const rows = await db.packages.where('id').equals(id).toArray();
  return rows.sort((a, b) => b.updatedAt - a.updatedAt)[0]?.world ?? blankMyAssets(mature);
}

/** 세계의 것을 내 에셋에 보관한다 (딸린 것·그림·출처 함께). 돌려주는 것: 가져오기 결과 */
export async function keepAsAsset(from: WorldPackage, picks: BorrowPick[]): Promise<BorrowResult> {
  const mature = from.manifest.contentRating === 'mature';
  const mine = await loadMyAssets(mature);
  if (from.manifest.id === mine.manifest.id) throw new Error('이미 내 에셋 보관함에 있습니다.');
  const r = borrow(mine, from, picks, { withKnowledge: true, withImages: true, withFaction: true });
  if (r.copies.length) await storeAssets(mine.manifest.id, r.copies.map((c) => ({ id: c.toId, read: async () => { const b = await assetBlob(c.fromPkg, c.fromId); if (!b) throw new Error('없음'); return b; } })));
  await savePackage(r.world, 'created');
  return r;
}
