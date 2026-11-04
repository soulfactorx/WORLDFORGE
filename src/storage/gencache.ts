/**
 * 세계 만들기 중간 결과 저장 (v0.19.1). 카드 지문(ns)별로 AI 응답을 저장해, 중간에 멈추거나 실패해도
 * 다시 시작하면 끝난 단계(인물 찾기·번역 묶음·세계 구조·이미지 분류 등)는 AI를 다시 쓰지 않는다.
 * 30일이 지난 결과는 지운다.
 */
import type { ResultCache } from '../llm/robust';
import { db } from './db';

const TTL = 30 * 24 * 3600 * 1000;

export function genCache(ns: string): ResultCache {
  return {
    async get(key) { const r = await db.genCache.get(`${ns}|${key}`); return r && Date.now() - r.at < TTL ? r.value : undefined; },
    async set(key, value) { await db.genCache.put({ key: `${ns}|${key}`, ns, value, at: Date.now() }); },
  };
}

export async function genCacheCount(ns: string): Promise<number> {
  try { return await db.genCache.where('ns').equals(ns).count(); } catch { return 0; }
}

export async function clearGenCache(ns?: string): Promise<void> {
  if (ns) await db.genCache.where('ns').equals(ns).delete();
  else await db.genCache.where('at').below(Date.now() - TTL).delete();
}
