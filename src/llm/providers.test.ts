import { describe, expect, it } from 'vitest';
import { groupOf, modelFor, routeFor } from './index';
import { buildSettings, defaultProviderOf, modelsInUse, providerLabel, providersOf, resolveRoute, routeSummary } from './providers';
import type { LlmProvider, LlmSettings } from './types';

/** v0.101: 여러 제공자 · 역할별 제공자와 모델 */
const claude: LlmProvider = { id: 'a', name: 'Claude', provider: 'anthropic', apiKey: 'ka', model: 'claude-sonnet-5-5' };
const router: LlmProvider = { id: 'b', name: 'OpenRouter', provider: 'openai-compatible', apiKey: 'kb', model: 'cheap/flash', baseUrl: 'https://openrouter.ai/api/v1' };

describe('여러 제공자', () => {
  it('예전 설정(제공자 하나 + roleModels)은 그대로 읽힌다', () => {
    const old: LlmSettings = { provider: 'openai-compatible', apiKey: 'k', model: 'big', baseUrl: 'http://localhost:11434/v1', roleModels: { judge: 'small' } };
    expect(providersOf(old)).toHaveLength(1);
    expect(defaultProviderOf(old)).toMatchObject({ model: 'big', name: 'Ollama (로컬)' });
    expect(resolveRoute(old, 'judge').model).toBe('small');
    expect(resolveRoute(old, 'narrator').model).toBe('big');
  });
  it('역할마다 제공자와 모델을 고른다 — 모델을 비우면 그 제공자의 기본 모델', () => {
    const s = buildSettings([claude, router], 'a', { narrator: { model: 'claude-opus-5-5' }, bulk: { provider: 'b' }, judge: { provider: 'b', model: 'mid/model' } });
    expect(s).toMatchObject({ provider: 'anthropic', apiKey: 'ka', model: 'claude-sonnet-5-5', defaultProvider: 'a' }); // 맨 위 칸은 기본 제공자의 사본
    expect(resolveRoute(s, 'narrator')).toMatchObject({ provider: { id: 'a' }, model: 'claude-opus-5-5' });
    expect(resolveRoute(s, 'bulk')).toMatchObject({ provider: { id: 'b' }, model: 'cheap/flash' });
    expect(resolveRoute(s, 'judge')).toMatchObject({ provider: { id: 'b' }, model: 'mid/model' });
    expect(resolveRoute(s, 'actor')).toMatchObject({ provider: { id: 'a' }, model: 'claude-sonnet-5-5' });
    expect(modelsInUse(s).sort()).toEqual(['cheap/flash', 'claude-opus-5-5', 'claude-sonnet-5-5', 'mid/model']);
    expect(routeSummary(s)).toContain('bulk:OpenRouter/cheap/flash');
  });
  it('인물 찾기·번역·이미지는 정하지 않으면 세계 설계를 따른다', () => {
    const s = buildSettings([claude, router], 'a', { build: { provider: 'b', model: 'smart/model' } });
    expect(resolveRoute(s, 'extract')).toMatchObject({ provider: { id: 'b' }, model: 'smart/model' });
    expect(resolveRoute(s, 'bulk').model).toBe('smart/model');
    const t = buildSettings([claude, router], 'a', { build: { provider: 'b', model: 'smart/model' }, bulk: { model: 'claude-haiku-5-5' } });
    expect(resolveRoute(t, 'bulk')).toMatchObject({ provider: { id: 'a' }, model: 'claude-haiku-5-5' });
  });
  it('지운 제공자를 가리키는 역할은 기본 제공자로 돌아가고, 저장할 때 정리된다', () => {
    const s = buildSettings([claude], 'a', { judge: { provider: 'gone', model: '' }, actor: { provider: 'a' } });
    expect(s.roles).toBeUndefined();
    expect(resolveRoute({ ...s, roles: { judge: { provider: 'gone' } } }, 'judge').provider.id).toBe('a');
  });
  it('요청의 역할로 길을 고른다: 번역·이미지 → bulk, 인물 찾기 → extract', () => {
    const s = buildSettings([claude, router], 'a', { bulk: { provider: 'b' }, extract: { provider: 'b', model: 'mid/model' } });
    expect(routeFor(s, '너는 게임 설정 번역가다.')).toMatchObject({ provider: { id: 'b' }, model: 'cheap/flash' });
    expect(routeFor(s, '너는 게임 이미지 정리 담당이다.').provider.id).toBe('b');
    expect(modelFor(s, '너는 게임 세계관 정리 담당이다. 캐릭터 카드의 로어북 항목들을 읽고')).toBe('mid/model');
    expect(modelFor(s, '너는 1인칭 AI TRPG의 세계관 설계자다. 다른 플랫폼용 캐릭터 카드의 데이터를 읽고')).toBe('claude-sonnet-5-5');
    expect([groupOf('translate'), groupOf('image'), groupOf('extract'), groupOf('worldgen'), groupOf('card')]).toEqual(['bulk', 'bulk', 'extract', 'build', 'build']);
  });
  it('이름이 없으면 주소로 짐작한다', () => {
    expect(providerLabel({ provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1' })).toBe('OpenRouter');
    expect(providerLabel({ provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1' })).toBe('api.example.com');
    expect(providerLabel({ provider: 'anthropic' })).toBe('Anthropic (Claude)');
  });
});
