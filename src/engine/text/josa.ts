/**
 * 한국어 조사 선택: 마지막 글자의 받침 유무로 이/가, 은/는, 을/를, 과/와, 으로/로를 고른다.
 * 한글이 아닌 글자로 끝나면 "이(가)" 형태로 둔다.
 */
type Pair = '이/가' | '은/는' | '을/를' | '과/와' | '으로/로';

export function josa(word: string, pair: Pair): string {
  const [withBatchim, without] = pair.split('/') as [string, string];
  const code = word.trim().charCodeAt(word.trim().length - 1);
  if (!(code >= 0xac00 && code <= 0xd7a3)) return `${word}${withBatchim}(${without})`;
  const jong = (code - 0xac00) % 28;
  if (pair === '으로/로') return word + (jong === 0 || jong === 8 ? without : withBatchim); // ㄹ 받침은 "로"
  return word + (jong ? withBatchim : without);
}
