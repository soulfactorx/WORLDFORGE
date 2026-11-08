import { describe, expect, it } from 'vitest';
import { normalize } from '../../importers/charx';
import type { CharxBundle } from '../../importers/bundle';
import { analyzeBundle, cardDataPrompt } from './fromCard';

describe('카드 데이터 흐름 (v0.79.6)', () => {
  // 세계 설정을 설명에 길게 적고, 첫 인사말은 비우고 대체 인사말에만 시작 장면이 있는 카드 (중립 예시)
  const desc = `# 해안 도시\n${'항구와 등대에 대한 설정. '.repeat(400)}\n## 끝부분 설정\n등대지기는 밤마다 종을 친다.`;
  const raw = { spec: 'chara_card_v2', spec_version: '2.0', data: {
    name: 'Harbor Town', description: desc, personality: '', scenario: '', first_mes: '', mes_example: '',
    alternate_greetings: ['안개 낀 부두에 배가 닿는다. 시작 장면 A.', '등대 계단을 오른다. 시작 장면 B.'],
    character_book: { entries: [{ keys: [''], content: '', name: 'folder' }, { keys: [''], content: '## 등대지기 민서\n30 / 조용한 성격', name: 'Minseo' }] },
  } };
  const card = normalize(raw, 'ccv2');
  const bundle = { fileName: 'harbor.json', fileSize: 1, card, rawCard: raw, extraLore: [], lua: { code: '', data: {} }, regexComments: [], toggles: '', assets: [], warnings: [], fingerprint: 'x' } as unknown as CharxBundle;

  it('대체 인사말을 읽고, 대체 인사말을 "무시"했다고 알리지 않는다', () => {
    expect(card.alternateGreetings).toEqual(['안개 낀 부두에 배가 닿는다. 시작 장면 A.', '등대 계단을 오른다. 시작 장면 B.']);
    expect(card.unsupported.join(' ')).not.toContain('대체 인사말');
    expect(card.lore.map((e) => e.name)).toEqual(['Minseo']); // 빈 폴더 항목만 빠진다
  });

  it('AI에게 긴 설명의 끝부분까지, 시작 장면 후보를 모두 넘긴다', () => {
    const { card: c, analyzed } = analyzeBundle(bundle);
    const p = cardDataPrompt(bundle, c, analyzed, [], true);
    expect(desc.length).toBeGreaterThan(4000);
    expect(p).toContain('등대지기는 밤마다 종을 친다.');
    expect(p).toContain('## 첫 메시지 (원작 문체·도입부 — 시작 방식(starts) 후보)\n안개 낀 부두에 배가 닿는다');
    expect(p).toContain('## 다른 시작 장면 1 (원작 문체·도입부 — 시작 방식(starts) 후보)\n등대 계단을 오른다');
  });
});
