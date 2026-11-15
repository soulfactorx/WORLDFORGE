import { describe, expect, it } from 'vitest';
import { sampleWorld } from '../data/sample-world';
import { createCharacter, suggestedStandardArray } from '../engine/character/sheet';
import { replay } from '../engine/state/state';
import { guideEvent, parseTailJson, splitTail, TAIL_MARK } from './guide';
import { startEvents } from './turn';

const C = (t: string) => `{"text": "${t}", "skill": "", "kind": "advance", "scene": "", "stake": "", "option": ""}`;
describe('선택지 꼬리 읽기 (v0.139)', () => {
  it('정상 · 코드 블록 · 끝 쉼표 · 굽은 따옴표', () => {
    expect(parseTailJson(`{"summary":"s","choices":[${C('가')}]}`).report.status).toBe('ok');
    const fenced = parseTailJson('```json\n{"summary":"s","choices":[' + C('가') + ',]}\n```');
    expect(fenced.report.status).toBe('repaired');
    expect(fenced.out?.choices).toHaveLength(1);
    expect(parseTailJson('{“summary”: “s”, “choices”: [{“text”: “나”}]}').out?.choices?.[0]).toMatchObject({ text: '나' });
  });
  it('길이 제한으로 잘린 JSON은 끝난 선택지까지 살린다', () => {
    const cut = `{"summary":"s","suggestion":"","choices":[${C('하나')}, ${C('둘')}, {"text": "셋은 쓰다 말`;
    const r = parseTailJson(cut);
    expect(r.report.status).toMatch(/repaired|salvaged/);
    expect((r.out?.choices ?? []).map((c) => (typeof c === 'string' ? c : c.text))).toEqual(expect.arrayContaining(['하나', '둘']));
  });
  it('splitTail은 읽은 결과를 알려 준다', () => {
    expect(splitTail('서술만').report.status).toBe('none');
    expect(splitTail(`서술\n\n${TAIL_MARK}\n{"summary":"s","choices":[${C('가')}]}`).report.status).toBe('ok');
  });
  it('요약이 비어도 AI 선택지를 버리지 않고, 바꾼 것을 적는다', () => {
    const hero = createCharacter({ name: '나', classId: 'fighter', method: 'standard', abilities: suggestedStandardArray('fighter'), skills: ['athletics', 'perception'] });
    const s = replay(startEvents(sampleWorld, hero, 3).map((event, seq) => ({ saveId: 'x', seq, turn: 0, event })));
    const log: string[] = [];
    const long = '아주 긴 선택지 '.repeat(10);
    const ev = guideEvent(sampleWorld, s, { summary: '', suggestion: '', choices: [{ text: '첫째', skill: '', kind: 'advance' }, { text: long, skill: '', kind: 'bold' }, { text: '셋', skill: '', kind: '' }, { text: '넷', skill: '', kind: '' }, { text: '다섯', skill: '', kind: '' }] } as never, log);
    expect(ev && ev.type === 'gm_guide' && ev.choices[0]).toBe('첫째');
    expect(log.join('\n')).toContain('요약(summary)을 비워');
    expect(log.join('\n')).toContain('잘림 (60자)');
    expect(log.join('\n')).toContain('앞의 4개만');
  });
});
