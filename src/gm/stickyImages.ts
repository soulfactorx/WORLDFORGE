/**
 * 서술 그림 고정 (v0.137): 서술이 흘러나오는 동안 놓인 그림은 서술이 끝난 뒤에도 바뀌지 않는다.
 *
 * 전에는 흘러나오는 동안(끝난 문단까지의 글로) 그림을 고르고, 서술이 끝나면 전체 글로 다시 골라 그것을 저장했다.
 * 글이 길어지면 표정 짐작이 달라지고, AI의 [[그림 …]] 표시가 뒤늦게 나오면 엔진 짐작을 통째로 버려 —
 * 보던 그림이 끝나는 순간 다른 그림으로 바뀌었다.
 *
 * 이제: 한 번 놓인 그림(과 그 문단)은 고정하고, 아직 그림이 정해지지 않은 뒤쪽 문단에만 새 그림을 더한다.
 * 화면과 저장이 같은 고정 목록을 쓴다. 고른 까닭은 모두 기록해 디버그에 남긴다.
 */
import { paragraphsOf, type ImagePick, traceImages } from '../engine/assets';
import type { NarrationImage } from '../engine/state/events';
import { stripMarks } from './imageMarks';

export interface PlacedRecord { id: string; caption: string; para?: number; bg?: boolean; how: string; when: string; detail?: string }
/** 고르는 함수: 그림과 그림마다의 까닭(같은 순서) */
export type ImageCompute = (text: string) => { images: NarrationImage[]; why: string[] };

const MAX = 6;
const order = (a: NarrationImage, b: NarrationImage) => (a.bg ? -1 : b.bg ? 1 : (a.para ?? 99) - (b.para ?? 99));

export function stickyImages(compute: ImageCompute) {
  let fixed: NarrationImage[] = [];
  let paras = 0;
  let calls = 0;
  const placed: PlacedRecord[] = [];
  const kept: string[] = [];
  const steps: ImagePick[] = [];
  /** text: 지금까지 나온 (끝난 문단의) 글. final: 서술이 다 끝났다 */
  const place = (text: string, final = false): NarrationImage[] => {
    calls++;
    const { result, picks } = traceImages(() => compute(text));
    const n = paragraphsOf(stripMarks(text)).length;
    const when = final ? '서술이 끝난 뒤' : `서술 중 (${n}문단까지 나왔을 때)`;
    result.images.forEach((im, i) => {
      const dropped = (why: string) => { if (final) kept.push(`(「${im.caption || im.id}」${im.para !== undefined ? ` ${im.para + 1}번째 문단` : ''} — ${why})`); };
      if (im.bg) { if (fixed.some((f) => f.bg)) { if (!fixed.some((f) => f.bg && f.id === im.id)) dropped('배경은 이미 보인 것을 그대로 둔다'); return; } }
      else {
        // 자리(문단)가 아직 없는 그림은 서술 중에는 고정하지 않는다 — 그 인물이 글에 나오면 그 문단에 놓인다
        if (!final && im.para === undefined) return;
        if (fixed.some((f) => f.id === im.id)) return;
        if (im.para !== undefined && im.para < paras) { dropped('이미 지나간 문단이라 보인 그림을 그대로 둔다'); return; }
        if (fixed.some((f) => !f.bg && f.caption === im.caption && f.para === im.para)) { dropped('같은 문단에 그 인물 그림이 이미 있다'); return; }
      }
      if (fixed.length >= MAX) { dropped(`한 턴에 그림은 ${MAX}장까지`); return; }
      fixed = [...fixed, im].sort(order);
      const p = picks.find((x) => x.step !== '서술 언급' && x.chosen === im.id);
      placed.push({ id: im.id, caption: im.caption, ...(im.para !== undefined ? { para: im.para } : {}), ...(im.bg ? { bg: true } : {}), how: result.why[i] ?? '', when,
        ...(p ? { detail: `${p.rule}${p.wanted && !p.rule.includes(`"${p.wanted}"`) ? ` · 원한 태그 "${p.wanted}"` : ''}${p.resolved && p.resolved !== p.wanted && !p.rule.includes(`"${p.resolved}"`) ? ` → 맞춘 태그 "${p.resolved}"` : ''}` } : {}) });
    });
    if (steps.length < 80) steps.push(...picks.slice(0, 80 - steps.length));
    paras = Math.max(paras, n);
    return fixed;
  };
  return {
    place,
    /** 디버그 기록 (imageNote와 같은 꼴 — 디버그 창이 그대로 보여 준다) */
    note: (inputs: Record<string, string>) => ({
      kind: 'images' as const,
      inputs: { ...inputs, '그림을 고른 횟수': `${calls}번 (서술 중 문단이 끝날 때마다 + 끝난 뒤)` },
      chosen: fixed.map((im) => { const r = placed.find((x) => x.id === im.id); return { id: im.id, caption: im.caption, why: `${r?.how || (im.bg ? '배경' : '')}${r ? ` · ${r.when}` : ''}${im.bg ? ' · 서술 맨 앞(배경)' : im.para !== undefined ? ` · ${im.para + 1}번째 문단` : ''}`, ...(r?.detail ? { detail: r.detail } : {}) }; }),
      skipped: kept,
      steps,
    }),
  };
}
