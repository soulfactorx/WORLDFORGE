/**
 * 리소스별 출처·라이선스 (v0.157).
 * 전에는 다른 사람의 카드에서 온 것이 하나라도 있으면 세계 전체를 「개인용」으로 잠갔다.
 * 이제 출처 카드마다 그 카드에서 온 리소스(인물·지식·그림·그 밖의 것) 목록과 라이선스를 기록하고:
 *  - 라이선스가 없는 카드(라이선스 모름)에서 온 것만 개인용 — 내보낼 때 그것만 빼고 내보낼 수 있다
 *  - 제작자가 허락한 라이선스(예: CC BY)를 표시한 카드의 것은 잠그지 않고, 출처 표시가 함께 간다
 *  - 세계 전체를 카드로 만든 경우(via world)에는 뺄 수 없으므로 세계 전체가 개인용이다 (라이선스를 표시하면 풀린다)
 * 라이선스 표시는 기록일 뿐 권리를 만들지 않는다 — 제작자가 허락했는지 확인하는 것은 표시하는 사람의 몫이다.
 */
import type { SourceCard, WorldPackage } from './schema';
import { removeSource, sourcesOf } from './sources';
import { pruneDanglingAll } from './borrow';

export const isOpen = (s: SourceCard) => !!s.license;
/** 개인용(라이선스 모름) 출처 */
export const personalSources = (w: WorldPackage) => sourcesOf(w).filter((s) => !isOpen(s));

/**
 * 잠금 상태:
 *  - free: 개인용 리소스 없음 (자유롭게 내보내기·공유)
 *  - parts: 개인용 리소스가 있지만 모두 뺄 수 있다 (빼고 내보내기)
 *  - world: 세계 전체가 카드에서 왔다 (뺄 수 없음 — 이 브라우저에서 혼자만)
 */
export function lockState(w: WorldPackage): 'free' | 'parts' | 'world' {
  const all = sourcesOf(w);
  const personal = all.filter((s) => !isOpen(s));
  if (!all.length) return w.manifest.private ? 'world' : 'free'; // 출처 기록이 없는 예전 개인용 세계
  if (!personal.length) return 'free';
  // 예전 기록: 목록이 비어 있는 개인용 출처는 무엇이 그 카드에서 왔는지 알 수 없다 → 세계 전체로 본다 (안전하게)
  const unknown = (s: SourceCard) => !s.ids || ![...s.ids.characters, ...s.ids.facts, ...s.ids.claims, ...s.ids.assets, ...(s.ids.others ?? [])].length;
  return personal.some((s) => s.via === 'world' || unknown(s)) ? 'world' : 'parts';
}

/** 개인용 리소스 수 (화면 표시) */
export function personalCount(w: WorldPackage): number {
  return personalSources(w).reduce((n, s) => n + (s.ids ? s.ids.characters.length + s.ids.facts.length + s.ids.claims.length + s.ids.assets.length + (s.ids.others?.length ?? 0) : 0), 0);
}

/** 출처 하나를 뺀다 — 인물·지식·그림에 더해 그 밖의 것(others)도 빼고, 남은 곳의 끊어진 가리킴을 정리한다 */
export function removeSourceFull(w: WorldPackage, hash: string): { world: WorldPackage; notes: string[] } {
  const src = sourcesOf(w).find((s) => s.hash === hash);
  const r = removeSource(w, hash);
  const next = structuredClone(r.world);
  const notes: string[] = [];
  const others = src?.ids?.others ?? [];
  if (others.length) {
    const lists = next as unknown as Record<string, { id: string }[] | undefined>;
    for (const key of others) {
      const i = key.indexOf(':');
      const coll = key.slice(0, i), id = key.slice(i + 1);
      if (Array.isArray(lists[coll])) lists[coll] = lists[coll]!.filter((x) => x.id !== id);
    }
    if (next.start && !next.locations.some((l) => l.id === next.start.locationId) && next.locations[0]) next.start = { ...next.start, locationId: next.locations[0].id };
  }
  pruneDanglingAll(next, notes);
  return { world: next, notes };
}

/** 내보내기용: 개인용 리소스를 모두 뺀 사본 (parts일 때만) */
export function stripPersonal(w: WorldPackage): { world: WorldPackage; removed: number; notes: string[] } {
  if (lockState(w) === 'world') throw new Error('세계 전체를 다른 사람의 카드로 만들어 뺄 수 없습니다.');
  let cur = w;
  const notes: string[] = [];
  const removed = personalCount(w);
  for (const s of personalSources(w)) { const r = removeSourceFull(cur, s.hash); cur = r.world; notes.push(...r.notes); }
  return { world: unlockIfFree(cur), removed, notes };
}

/** 개인용 출처가 없으면 세계 잠금을 푼다 (있으면 출처 이름을 맞춘다) */
export function unlockIfFree(w: WorldPackage): WorldPackage {
  if (lockState(w) === 'free') { const { private: _p, ...m } = w.manifest; return { ...w, manifest: m }; }
  if (!w.manifest.private) return w;
  return { ...w, manifest: { ...w.manifest, private: { ...w.manifest.private, source: personalSources(w).map((s) => s.name).join(' · ') || w.manifest.private.source } } };
}

/** 출처 카드에 라이선스를 표시(또는 지움) — 허락된 것만 남으면 잠금이 풀린다 */
export function setLicense(w: WorldPackage, hash: string, license: SourceCard['license'] | undefined): WorldPackage {
  const list = sourcesOf(w).map((s) => (s.hash === hash ? (license ? { ...s, license } : (({ license: _l, ...r }) => r)(s)) : s));
  let next: WorldPackage = { ...w, manifest: { ...w.manifest, sources: list } };
  if (!license && !next.manifest.private) {
    // 다시 개인용으로: 잠근다
    const s = list.find((x) => x.hash === hash);
    next = { ...next, manifest: { ...next.manifest, private: { source: s?.name ?? '캐릭터 카드', note: '다른 사람의 작품으로 만든 개인용 세계입니다. 이 브라우저에서 혼자 플레이할 수만 있고 패키지·세이브 내보내기와 공유는 막혀 있습니다.', ...(s?.hash ? { cardHash: s.hash } : {}) } } };
  }
  return unlockIfFree(next);
}

/** 출처 표시 줄 (내보낸 패키지·세계 정보에) */
export const credits = (w: WorldPackage) => sourcesOf(w).filter(isOpen).map((s) => `${s.name}${s.creator ? ` — ${s.creator}` : ''} (${s.license!.spdx})${s.license!.attribution ? `: ${s.license!.attribution}` : ''}`);

/** 흔한 라이선스 */
export const LICENSES: [string, string][] = [
  ['CC-BY-4.0', 'CC BY 4.0 (출처 표시)'], ['CC-BY-SA-4.0', 'CC BY-SA 4.0 (출처 표시·같은 조건)'], ['CC-BY-NC-4.0', 'CC BY-NC 4.0 (출처 표시·비영리)'],
  ['CC-BY-NC-SA-4.0', 'CC BY-NC-SA 4.0'], ['CC0-1.0', 'CC0 (조건 없음)'], ['permission', '제작자에게 직접 허락받음'],
];
