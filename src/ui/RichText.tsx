import { Fragment, type ReactNode } from 'react';

/** 서술 글 꾸미기: 따옴표 대사와 *속마음*을 구분해 보여준다 (HTML은 해석하지 않는다) */
const RE = /(“[^”\n]*”|"[^"\n]*"|「[^」\n]*」|『[^』\n]*』|\*[^*\n]+\*)/g;

export function RichText({ text }: { text: string }) {
  const parts = text.split(RE);
  const out: ReactNode[] = parts.map((p, i) => {
    if (i % 2 === 0) return <Fragment key={i}>{p}</Fragment>;
    if (p.startsWith('*')) return <em key={i} className="thought">{p.slice(1, -1)}</em>;
    return <span key={i} className="dlg">{p}</span>;
  });
  return <>{out}</>;
}
