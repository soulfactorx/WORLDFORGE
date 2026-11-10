import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { sampleWorld } from '../data/sample-world';
import { romanceSample, wuxiaSample } from '../data/sample-genres';
import { aetheriaWorld } from '../data/official/aetheria';
import { cheonhaWorld } from '../data/official/cheonha';
import { everheartWorld } from '../data/official/everheart';
import { fightingSample } from '../data/sample-fighting';
import { MORE_SAMPLES } from '../data/sample-more';
import type { WorldPackage } from '../engine/schema';
import { hasErrors, type Issue, validateWorld } from '../engine/package/validate';
import { findZipStart, looksLikeCardFile } from '../importers/charx';
import { db } from './db';
import { MATURE_NOTE, shareBlocked } from '../engine/rating';

/**
 * 세계관 패키지 라이브러리. 내장 샘플 + 사용자가 만들거나 가져온 패키지(IndexedDB).
 * .wpk = zip { manifest.json, world.json } (에셋은 다음 단계)
 */

export interface StoredPackage {
  key: string; // `${id}@${version}`
  id: string;
  version: string;
  name: string;
  world: WorldPackage;
  source: 'import' | 'created';
  updatedAt: number;
}

/** 내장: 공식 대형 세계 (설계 v4 E9) + 맛보기 샘플 */
export const BUILTIN: WorldPackage[] = [aetheriaWorld, cheonhaWorld, everheartWorld, sampleWorld, wuxiaSample, romanceSample, fightingSample, ...MORE_SAMPLES];
export const packageKey = (w: Pick<WorldPackage, 'manifest'>) => `${w.manifest.id}@${w.manifest.version}`;

export async function listPackages(): Promise<{ world: WorldPackage; builtin: boolean; stored?: StoredPackage }[]> {
  const stored = await db.packages.orderBy('updatedAt').reverse().toArray();
  return [...BUILTIN.map((world) => ({ world, builtin: true })), ...stored.map((p) => ({ world: p.world, builtin: false, stored: p }))];
}

/** 세이브가 쓰는 패키지 찾기: 정확한 버전 → 같은 ID의 최신 버전 → 내장 */
export async function findWorld(id: string, version: string): Promise<WorldPackage | null> {
  const exact = await db.packages.get(`${id}@${version}`);
  if (exact) return exact.world;
  const same = await db.packages.where('id').equals(id).reverse().sortBy('updatedAt');
  if (same[0]) return same[0].world;
  return BUILTIN.find((w) => w.manifest.id === id) ?? null;
}

export async function savePackage(world: WorldPackage, source: StoredPackage['source']): Promise<void> {
  if (BUILTIN.some((b) => packageKey(b) === packageKey(world))) throw new Error('내장 패키지와 같은 ID·버전으로는 저장할 수 없습니다. ID나 버전을 바꿔 주세요.');
  // 개인용 세계의 표시는 지울 수 없다: 같은 ID의 패키지가 개인용이면 계속 개인용
  const prev = await db.packages.where('id').equals(world.manifest.id).toArray();
  if (!world.manifest.private) {
    const priv = prev.find((p) => p.world.manifest.private)?.world.manifest.private;
    if (priv) world = { ...world, manifest: { ...world.manifest, private: priv } };
  }
  // 성인 등급은 한 번 정하면 바꿀 수 없다 (설계 v3 15.1)
  if (world.manifest.contentRating !== 'mature' && prev.some((p) => p.world.manifest.contentRating === 'mature')) {
    world = { ...world, manifest: { ...world.manifest, contentRating: 'mature' } };
  }
  await db.packages.put({ key: packageKey(world), id: world.manifest.id, version: world.manifest.version, name: world.manifest.name, world, source, updatedAt: Date.now() });
}

export async function deletePackage(key: string): Promise<void> {
  const p = await db.packages.get(key);
  await db.packages.delete(key);
  // 같은 ID의 다른 버전이 없으면 이미지도 지운다
  if (p && (await db.packages.where('id').equals(p.id).count()) === 0) await db.assets.where('pkg').equals(p.id).delete();
}

/** 개인용 세계(다른 사람의 작품으로 만든 세계)는 내보낼 수 없다 */
export const isPrivate = (w: Pick<WorldPackage, 'manifest'>) => !!w.manifest.private;
export const PRIVATE_NOTE = '다른 사람의 작품으로 만든 개인용 세계입니다. 이 브라우저에서 혼자 플레이할 수만 있고 패키지·세이브 내보내기와 공유는 막혀 있습니다.';

// ---------------------------------------------------------------- 파일

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ENTRIES = 200;
const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;

export function exportWpk(world: WorldPackage): Blob {
  if (isPrivate(world)) throw new Error(PRIVATE_NOTE);
  if (shareBlocked(world)) throw new Error(MATURE_NOTE);
  const files = {
    'manifest.json': strToU8(JSON.stringify(world.manifest, null, 2)),
    'world.json': strToU8(JSON.stringify(world, null, 2)),
  };
  return new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' });
}

export interface ParsedPackage {
  world: WorldPackage | null;
  issues: Issue[];
  /** 세계관 패키지가 아니라 캐릭터 카드(CHARX·PNG·JSON 카드)다 */
  isCard?: boolean;
}

/** .wpk(zip) 또는 .json을 읽어 검사한다. 압축 폭탄·과도한 파일 수를 막는다. 스크립트는 읽지도 실행하지도 않는다. */
export function parsePackageFile(name: string, input: Uint8Array): ParsedPackage {
  const original = input;
  let bytes = input;
  const fail = (message: string): ParsedPackage => ({ world: null, issues: [{ level: 'error', path: name, message }] });
  if (bytes.byteLength > MAX_FILE_BYTES) return fail('파일이 너무 큽니다 (최대 20MB).');
  let text: string;
  const zipStart = findZipStart(bytes);
  if (zipStart > 0) bytes = bytes.subarray(zipStart); // 앞에 다른 데이터가 붙은 zip
  const isZip = zipStart >= 0;
  if (isZip) {
    let total = 0;
    let count = 0;
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(bytes, {
        filter: (f) => {
          count++;
          total += f.originalSize;
          if (count > MAX_ENTRIES || total > MAX_UNZIPPED_BYTES) throw new Error('압축을 풀면 너무 큽니다 (파일 수 또는 용량 초과).');
          return f.name === 'world.json'; // 필요한 파일만 푼다
        },
      });
    } catch (e) {
      return fail(`압축 파일을 읽을 수 없습니다: ${(e as Error).message}`);
    }
    if (!files['world.json']) {
      if (looksLikeCardFile(original)) return { world: null, isCard: true, issues: [] };
      return fail('패키지 안에 world.json이 없습니다. 세계관 패키지(.wpk)가 아닌 것 같습니다.');
    }
    text = strFromU8(files['world.json']);
  } else {
    text = new TextDecoder().decode(bytes);
  }
  let data: unknown;
  try { data = JSON.parse(text); } catch {
    if (looksLikeCardFile(original)) return { world: null, isCard: true, issues: [] };
    return fail('세계관 패키지(.wpk) 또는 world.json 형식이 아닙니다. 캐릭터 카드(.charx·.png)라면 "캐릭터 카드로 새 세계관 만들기"를 쓰세요.');
  }
  if (data && typeof data === 'object' && !('manifest' in data) && looksLikeCardFile(original)) return { world: null, isCard: true, issues: [] };
  const issues = validateWorld(data);
  return { world: hasErrors(issues) && !(data && typeof data === 'object' && 'manifest' in data) ? null : (data as WorldPackage), issues };
}

/** 빈 세계 템플릿 */
export function blankWorld(): WorldPackage {
  return {
    manifest: { id: 'me.new-world', type: 'world', name: '새 세계', version: '0.1.0', schemaVersion: '0', author: '', license: 'CC-BY-4.0', contentRating: 'teen', locales: ['ko'] },
    locations: [{ id: 'loc/start', name: '시작 장소', description: '당신이 눈을 뜬 곳.', connections: [] }],
    characters: [], facts: [], claims: [], beliefs: [], encounters: [], quests: [], flags: [], endings: [],
    start: { locationId: 'loc/start', openingScene: '낯선 곳에서 눈을 뜬다.' },
  };
}
