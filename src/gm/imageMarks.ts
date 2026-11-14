/**
 * 서술 속 그림 표시 (v0.119): AI가 서술을 쓰면서 그림이 들어갈 자리와 표정·상황 태그를 직접 고른다.
 * RisuAI 카드가 쓰는 방식(모델이 이미지 이름을 문장 사이에 넣음)과 같은 생각이다 — 서술과 그림이 같은 손에서 나와 어울린다.
 *
 *   [[그림 인물ID 태그]]  — 다음 문단에 그 인물의 그 태그 이미지 (태그를 비우면 기본 모습)
 *   [[배경 태그]]         — 이 장소의 그 태그 장면 이미지를 배경으로
 *
 * 엔진은 표시를 글에서 지우고, 실제 이미지(같은 뜻의 태그 포함)로 바꾼다. 없는 인물·태그는 가장 가까운 것으로.
 */
import { expressionTags, paragraphsOf, pickCharacterImage, pickSceneImage, sceneTags } from '../engine/assets';
import { displayName } from '../engine/names';
import type { Character, WorldPackage } from '../engine/schema';
import type { NarrationImage } from '../engine/state/events';
import type { GameState } from '../engine/state/state';

const MARK = /\[\[\s*(그림|배경)\s*([^\]]*?)\s*\]\]/g;

/** 화면에 보일 글: 완성된 표시와, 아직 쓰는 중인 끝의 "[[…"를 지운다 */
export function stripMarks(text: string): string {
  return text.replace(/^[ \t]*\[\[[^\]\n]*\]\][ \t]*\n?/gm, '').replace(MARK, '').replace(/\[\[[^\]\n]*$/, '');
}

export interface ImageMark { kind: 'char' | 'bg'; id?: string; tag: string; para: number }

/** 표시를 읽는다: 각 표시는 그 뒤에 처음 오는 (지운 뒤의) 문단에 붙는다 */
export function readMarks(raw: string): ImageMark[] {
  const out: ImageMark[] = [];
  let para = 0;
  for (const p of paragraphsOf(raw)) {
    const marks = [...p.matchAll(MARK)];
    const rest = p.replace(MARK, '').trim();
    for (const m of marks) {
      const [first = '', ...more] = (m[2] ?? '').split(/\s+/).filter(Boolean);
      if (m[1] === '배경') out.push({ kind: 'bg', tag: [first, ...more].join(' '), para });
      else out.push({ kind: 'char', id: first, tag: more.join(' '), para });
    }
    if (rest) para++;
  }
  return out;
}

/** 표시 → 실제 이미지. 인물 ID가 이름으로 적혔어도 찾는다 */
export function marksToImages(world: WorldPackage, s: GameState, raw: string, salt: string): NarrationImage[] {
  const out: NarrationImage[] = [];
  const find = (key: string): Character | undefined => world.characters.find((c) => c.id === key || c.name === key || c.id.replace(/^[a-z]+\//, '') === key);
  for (const m of readMarks(raw)) {
    if (m.kind === 'bg') {
      const img = pickSceneImage(world, s.player.locationId, m.tag, salt);
      const loc = world.locations.find((l) => l.id === s.player.locationId);
      if (img && !out.some((o) => o.bg)) out.push({ id: img.id, caption: loc?.name ?? '', bg: 'new' });
      continue;
    }
    const c = find(m.id ?? '');
    if (!c) continue;
    const img = pickCharacterImage(world, c.id, m.tag, `${salt}|${m.para}`);
    if (img && !out.some((o) => o.id === img.id)) out.push({ id: img.id, caption: c.name, para: m.para });
  }
  return out;
}

/**
 * 이번 턴의 그림: AI가 표시한 그림이 있으면 그것을(배경 표시가 없으면 엔진의 배경을 그대로), 없으면 엔진의 짐작(fallback).
 * fallback은 표시를 지운 글로 계산한 엔진의 그림 (turnImages).
 */
export function mergeMarkedImages(world: WorldPackage, s: GameState, raw: string, salt: string, fallback: (clean: string) => NarrationImage[]): NarrationImage[] {
  const base = fallback(stripMarks(raw));
  const marked = marksToImages(world, s, raw, salt);
  if (!marked.length) return base;
  const bg = marked.find((m) => m.bg) ?? base.find((b) => b.bg);
  return [...(bg ? [bg] : []), ...marked.filter((m) => !m.bg)].slice(0, 6);
}

/** AI에게: 이 장면에서 쓸 수 있는 그림 (인물별 표정·상황 태그, 이 장소의 장면 태그) */
export function imageMenu(world: WorldPackage, s: GameState, people: Character[]): string {
  if (!world.assets?.length) return '';
  const rows = people.flatMap((c) => {
    const has = world.assets!.some((a) => a.kind === 'character' && a.characterId === c.id);
    if (!has) return [];
    const tags = expressionTags(world, c.id).slice(0, 40);
    return [`- ${c.id} (${displayName(s, c)}): ${tags.length ? tags.join(', ') : '(기본 모습만)'}`];
  });
  const bg = sceneTags(world, s.player.locationId).filter((t) => t !== 'default').slice(0, 20);
  if (!rows.length && !bg.length) return '';
  return `\n\n## 그림 (서술 속에 넣을 수 있다 — 선택)
그림이 어울리는 문단 바로 앞 줄에 표시를 쓴다. 표시는 화면에서 그 그림으로 바뀐다.
- [[그림 인물ID 태그]] — 그 문단에서 그 인물이 짓는 표정·하는 행동에 가장 맞는 태그를 아래 목록에서 고른다 (맞는 것이 없으면 태그를 비운다).
- [[배경 태그]] — 장면의 분위기가 크게 바뀔 때만 (예: 밤이 됨, 싸움이 시작됨).
- 한 턴에 인물 그림 1~3장. 인물이 처음 등장하거나 표정·행동이 크게 바뀌는 문단에. 같은 인물을 같은 태그로 되풀이하지 않는다.
${rows.length ? `인물별 태그:\n${rows.join('\n')}` : ''}${bg.length ? `\n이 장소의 장면 태그: ${bg.join(', ')}` : ''}`;
}
