/**
 * 카드 스크립트에서 이미지 연결 읽기 (v0.124).
 * RisuAI 카드는 이미지 이름에 인물 이름이 없어도, 카드 안의 다른 곳에 "어떤 인물·표정이 어떤 이미지인지"를 적어 두는 일이 많다.
 * 스크립트는 실행하지 않고, 글로만 읽어 그 연결을 찾는다.
 *
 *  ① 정규식: 바꾼 결과(out)가 이미지를 부르면 ({{raw::a12}}, <img src="…">), 바꾸기 전 규칙(in)·설명의 인물·표정을 그 이미지에 붙인다.
 *     out이 $1 같은 잡은 값을 쓰면 (예: {{raw::c1_$1}}), 고정된 앞뒤(c1_)로 시작하는 이미지 모두에 in의 인물을, 바뀌는 가운데(웃음)를 태그로.
 *  ② Lua 표: 값이 이미지 이름과 같은 칸을 찾아, 거쳐 온 열쇠(lia → happy)와 같은 표의 이름 칸(name = "리아")을 인물·태그로.
 *  ③ 로어북·설명 글: 이미지 이름이 나오는 줄에서 같은 토막(쉼표·| 등으로 나눔) → 같은 줄 → 위쪽 제목 줄 → 항목 이름 순으로 인물을 찾는다.
 *
 * 같은 이미지에 여러 단서가 있으면 ① > ② > ③.
 */
import type { AssetMeta } from '../engine/schema';
import { type Alias, aliasList, type MatchTarget, readContext, splitWords } from './assetmatch';
import type { RegexRule } from './charx';
import type { LuaValue } from './luadata';

export type LinkVia = 'regex' | 'lua' | 'text';
export interface ScriptHint { characterId?: string; locationId?: string; tags: string[]; via: LinkVia; from: string }

export interface ScriptSources {
  rules?: RegexRule[];
  luaData?: Record<string, LuaValue>;
  luaCode?: string;
  texts?: { name: string; keys?: string[]; content: string }[];
}

/** 이미지 이름을 비교할 꼴: 소문자, 확장자·경로 뺌 */
export const assetKey = (name: string) => name.trim().toLowerCase().replace(/^.*[\\/]/, '').replace(/\.(png|jpe?g|webp|gif|avif)$/i, '');
/** 이미지를 부르는 표시: {{raw::x}} {{img::x}} {{asset::x}} {{emotion::x}} {{image::x}} {{source::x}} {{bg::x}} {{inlay::x}} · <img src="x"> */
const CBS = /\{\{\s*(?:raw|img|image|asset|emotion|source|bg|background|inlay|inlayed|path|imgsrc|bgm?image)\s*::\s*([^}]+?)\s*\}\}/gi;
const IMG_SRC = /<img[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
/** 글 속 낱말 경계: 이미지 이름에 흔한 _ - . 은 남긴다 */
const WORD_SPLIT = /[^\p{L}\p{N}_\-.]+/u;

/** 정규식 문법을 지워 사람이 쓴 낱말만 남긴다 (\s \d 같은 기호 · 수량자 · 묶음) */
const unregex = (re: string) => re.replace(/\\[a-zA-Z]/g, ' ').replace(/\\(.)/g, '$1').replace(/[()[\]{}|^$*+?.]/g, ' ');

export function linkFromScripts(assetNames: string[], characters: MatchTarget[], locations: MatchTarget[], src: ScriptSources): Map<string, ScriptHint> {
  const chars = aliasList(characters), locs = aliasList(locations);
  const byKey = new Map<string, string[]>();
  for (const n of assetNames) { const k = assetKey(n); if (k) byKey.set(k, [...(byKey.get(k) ?? []), n]); }
  const out = new Map<string, ScriptHint>();
  const put = (key: string, h: Omit<ScriptHint, 'tags'> & { tags: string[] }) => {
    for (const name of byKey.get(key) ?? []) {
      const prev = out.get(name);
      // 먼저 찾은(더 확실한) 단서를 남긴다. 단, 앞의 것에 인물이 없고 이번 것에 있으면 바꾼다
      if (prev && (prev.characterId || prev.locationId || !(h.characterId || h.locationId))) continue;
      out.set(name, h);
    }
  };
  const ctx = (text: string, exclude: string, allWords = false) => readContext(text, chars, locs, { allWords, exclude: new Set(splitWords(exclude)) });

  // ① 정규식
  for (const r of src.rules ?? []) {
    const refs: { ref: string; at: number }[] = [];
    for (const re of [CBS, IMG_SRC]) for (const m of r.out.matchAll(re)) refs.push({ ref: m[1]!.trim(), at: m.index ?? 0 });
    refs.sort((a, b) => a.at - b.at);
    const head = `${unregex(r.in)} ${r.comment ?? ''}`;
    refs.forEach(({ ref, at }, i) => {
      // 여러 이미지를 부르면 각 이미지 바로 앞의 out 글(조건 등)도 단서로
      const before = refs.length > 1 ? r.out.slice(i ? refs[i - 1]!.at : 0, at).replace(CBS, ' ').replace(/<[^>]*>/g, ' ') : '';
      const dyn = /\$(\d|&|<)/.exec(ref);
      if (!dyn) {
        const k = assetKey(ref);
        if (!byKey.has(k)) return;
        const c = ctx(`${head} ${before}`, k);
        if (c.ambiguous && !c.tags.length) return;
        put(k, { ...c, via: 'regex', from: r.comment || r.in.slice(0, 40) });
        return;
      }
      // 잡은 값을 쓰는 이름: 고정된 앞뒤로 이미지를 고르고, 바뀌는 가운데를 태그로
      const parts = ref.split(/\$(?:\d+|&|<[^>]+>)/);
      const pre = assetKey(parts[0] ?? '').replace(/\.$/, ''), post = (parts.length > 1 ? parts[parts.length - 1]! : '').toLowerCase().replace(/\.(png|jpe?g|webp|gif|avif)$/i, '');
      if (!pre && !post) return; // 이름 전체가 잡은 값 — 고정된 단서가 없다
      const c = ctx(head, '');
      if (!c.characterId && !c.locationId) return;
      for (const k of byKey.keys()) {
        if (!k.startsWith(pre) || !k.endsWith(post) || k.length <= pre.length + post.length) continue;
        const mid = k.slice(pre.length, k.length - post.length);
        const tags = splitWords(mid).filter((t) => !/^\d+$/.test(t)).slice(0, 3);
        put(k, { ...(c.characterId ? { characterId: c.characterId } : {}), ...(c.locationId ? { locationId: c.locationId } : {}), tags: tags.length ? tags : c.tags, via: 'regex', from: r.comment || r.in.slice(0, 40) });
      }
    });
  }

  // ② Lua 표
  const NAME_KEY = /^(name|char|chara|character|who|owner|npc|이름|캐릭터|인물)$/i;
  const walk = (v: LuaValue, path: string[], names: string[], depth: number) => {
    if (depth > 8 || v === null) return;
    if (typeof v === 'string') {
      const k = assetKey(v);
      if (!byKey.has(k) || /^\d+$/.test(k)) return;
      const keys = path.filter((p) => !/^\d+$/.test(p));
      // 변수 이름(맨 앞 열쇠)은 인물을 찾을 때만 보고 태그로는 쓰지 않는다 (emotionTable · cast …)
      const tags = ctx([...names, ...keys.slice(1)].join(' '), k, true).tags;
      let c = ctx([...names, ...keys].join(' '), k, true);
      if (c.ambiguous) c = ctx([...names, ...keys.slice(-2)].join(' '), k, true);
      if (!c.ambiguous) put(k, { ...c, tags, via: 'lua', from: keys.join('.') });
      return;
    }
    if (typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, path, names, depth + 1)); return; }
    const own = Object.entries(v).filter(([k, x]) => NAME_KEY.test(k) && typeof x === 'string').map(([, x]) => x as string);
    for (const [k, x] of Object.entries(v)) if (!NAME_KEY.test(k)) walk(x, [...path, k], [...names, ...own], depth + 1);
  };
  for (const [name, v] of Object.entries(src.luaData ?? {})) walk(v, [name.replace(/@.*$/, '')], [], 0);

  // ③ 로어북·설명 글 (Lua 코드의 주석·문자열도 글로 읽는다)
  const texts = [...(src.texts ?? []), ...(src.luaCode ? [{ name: '', content: src.luaCode }] : [])];
  const textual = [...byKey.keys()].filter((k) => k.length >= 2 && !/^\d+$/.test(k));
  const known = new Set(textual);
  if (known.size) {
    for (const e of texts) {
      let heading = '';
      for (const line of e.content.split('\n')) {
        const words = line.split(WORD_SPLIT).map((w) => assetKey(w.replace(/^[-.]+|[-.]+$/g, ''))).filter(Boolean);
        const hits = words.filter((w) => known.has(w));
        if (!hits.length) {
          if (ctx(line, '').characterId && line.length <= 80) heading = line;
          continue;
        }
        const segs = line.split(/[,，、;|/·]|\s[-–—]\s/);
        for (const k of new Set(hits)) {
          const seg = segs.find((s) => s.toLowerCase().split(WORD_SPLIT).some((w) => assetKey(w.replace(/^[-.]+|[-.]+$/g, '')) === k)) ?? line;
          const others = new Set(hits.filter((h) => h !== k));
          const exclude = [k, ...others].join(' ');
          const short = splitWords(seg).length <= 8;
          let c = ctx(seg, exclude, short);
          if (!c.characterId && !c.locationId && !c.ambiguous) {
            for (const wider of [line, heading, [e.name, ...(e.keys ?? [])].join(' ')]) {
              if (!wider) continue;
              const w = ctx(wider, exclude);
              if (w.ambiguous) break;
              if (w.characterId || w.locationId) { c = { ...c, ...(w.characterId ? { characterId: w.characterId } : { locationId: w.locationId }) }; break; }
            }
          }
          if (c.ambiguous && !c.tags.length) continue;
          put(k, { ...c, via: 'text', from: e.name || line.slice(0, 40) });
        }
      }
    }
  }
  for (const [n, h] of out) { const { ambiguous: _a, ...rest } = h as ScriptHint & { ambiguous?: boolean }; out.set(n, rest); }
  return out;
}

export interface LinkStats { regex: number; lua: number; text: number }

/**
 * 단서를 이미지 목록에 적용한다. 바꾸는 것:
 * - 분류 안 된 이미지 → 단서의 인물(장면이면 장소). 인물이 없는 단서는 주인공 한 명짜리 카드일 때만 그 인물로.
 * - 기본 모습(default)만 있는 같은 인물의 이미지 → 단서의 태그를 붙인다.
 */
export function applyScriptHints(assets: AssetMeta[], hints: Map<string, ScriptHint>, opts: { mainCharacterId?: string } = {}): { assets: AssetMeta[]; stats: LinkStats } {
  const stats: LinkStats = { regex: 0, lua: 0, text: 0 };
  const next = assets.map((a) => {
    const h = hints.get(a.name);
    if (!h) return a;
    const tags = h.tags.length ? h.tags : ['default'];
    if (a.kind === 'other') {
      const who = h.characterId ?? (!h.locationId ? opts.mainCharacterId : undefined);
      if (who) { stats[h.via]++; return { ...a, kind: 'character' as const, characterId: who, tags: [...new Set([...tags, ...a.tags.filter((t) => tags.includes(t))])] }; }
      if (h.locationId) { stats[h.via]++; return { ...a, kind: 'scene' as const, locationId: h.locationId, tags: h.tags }; }
      return a;
    }
    if (a.kind === 'character' && h.tags.length && (!h.characterId || h.characterId === a.characterId) && a.tags.every((t) => t === 'default')) {
      stats[h.via]++;
      return { ...a, tags: [...h.tags, ...(a.tags.includes('default') && h.tags.some((t) => /^(default|normal|neutral|기본|평상시)$/.test(t)) ? ['default'] : [])] };
    }
    return a;
  });
  return { assets: next, stats };
}

export const statsText = (s: LinkStats) => [s.regex && `정규식 ${s.regex}`, s.lua && `Lua 표 ${s.lua}`, s.text && `로어북·설명 글 ${s.text}`].filter(Boolean).join(' · ');
export const statsTotal = (s: LinkStats) => s.regex + s.lua + s.text;

/** 카드 묶음에서 단서를 읽을 글을 모은다 */
export function bundleSources(b: { card: { description: string; personality: string; scenario: string; firstMes: string; mesExample: string; lore: { name: string; keys: string[]; content: string }[] }; extraLore: { name: string; keys: string[]; content: string }[]; regexRules?: RegexRule[]; lua: { code: string; data: Record<string, LuaValue> } }): ScriptSources {
  const c = b.card;
  return {
    rules: b.regexRules ?? [],
    luaData: b.lua.data,
    luaCode: b.lua.code,
    texts: [
      ...[...c.lore, ...b.extraLore].map((e) => ({ name: e.name, keys: e.keys, content: e.content })),
      ...[['설명', c.description], ['성격', c.personality], ['상황', c.scenario], ['첫 인사', c.firstMes], ['대화 예시', c.mesExample]].filter(([, t]) => t).map(([name, content]) => ({ name: name!, content: content! })),
    ],
  };
}
