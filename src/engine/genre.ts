/**
 * 장르 적용 (설계 v3 2.2): 엔진·세이브는 그대로 두고, 화면과 AI에 보이는 글만 장르 용어로 바꾼다.
 */
import { genreDataKey, genreOf } from '../data/genres';
import { MAX_LEVEL } from './character/progression';
import type { WorldPackage } from './schema';
import { josa } from './text/josa';

export const genreProfile = (w: Pick<WorldPackage, 'genre'>) => genreOf(w.genre?.id, w.genre?.custom);
/** 장르별 데이터(성향·양식·적·그림·음악)를 찾을 열쇠 — 새 장르·사용자 정의 장르는 바탕 장르 (v0.81) */
export const genreKey = (w: Pick<WorldPackage, 'genre'> | undefined) => genreDataKey(w?.genre?.id, w?.genre?.custom);

/** 세계의 최대 레벨 (엔진 상한 이하) */
export const levelCapOf = (w: Pick<WorldPackage, 'genre'>) => Math.max(1, Math.min(MAX_LEVEL, w.genre?.levelCap ?? genreProfile(w).levelCap));

const JOSA_PAIR: Record<string, '이/가' | '은/는' | '을/를' | '과/와' | '으로/로'> = { 이: '이/가', 가: '이/가', 은: '은/는', 는: '은/는', 을: '을/를', 를: '을/를', 과: '과/와', 와: '과/와', 으로: '으로/로', 로: '으로/로' };

const cache = new WeakMap<object, (s: string) => string>();

/** 용어 바꾸기 함수 (긴 용어부터, 한 번에) */
export function reskinner(w: Pick<WorldPackage, 'genre'>): (s: string) => string {
  const hit = cache.get(w);
  if (hit) return hit;
  const terms = { ...genreProfile(w).terms, ...(w.genre?.terms ?? {}) };
  const keys = Object.keys(terms).sort((a, b) => b.length - a.length);
  const fn = keys.length
    ? (() => {
      // 바꾼 낱말 뒤의 조사도 받침에 맞게 고친다 (롱소드로 → 장검으로)
      const re = new RegExp(`(${keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(으로|로|이|가|은|는|을|를|과|와)?`, 'g');
      return (s: string) => s.replace(re, (_m, word: string, j?: string) => {
        const to = terms[word]!;
        if (!j) return to;
        const pair = JOSA_PAIR[j]!;
        return josa(to, pair);
      });
    })()
    : (s: string) => s;
  cache.set(w, fn);
  return fn;
}

/** AI에게 주는 장르 지침 */
export function genreGuide(w: Pick<WorldPackage, 'genre'>): string {
  const g = genreProfile(w);
  return `${g.tone} 화폐 단위: ${w.genre?.currency ?? g.currency}.`;
}
