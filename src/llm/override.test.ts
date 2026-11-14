import { describe, expect, it } from 'vitest';
import { resolveRoute } from './providers';
import { playSettings, withRoutes } from './override';
import type { LlmSettings } from './types';

const s: LlmSettings = {
  provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-5-5',
  providers: [{ id: 'a', name: 'Claude', provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-5-5' }, { id: 'o', name: 'OR', provider: 'openai-compatible', apiKey: 'k2', model: 'x/y', baseUrl: 'https://openrouter.ai/api/v1' }],
  defaultProvider: 'a', roles: { build: { provider: 'o', model: 'big/model' } },
};

describe('모델 덮어쓰기 (v0.119)', () => {
  it('모델만 바꾸면 그 역할의 원래 제공자를 그대로 쓴다', () => {
    const t = withRoutes(s, { build: { model: 'other/model' } });
    expect(resolveRoute(t, 'build')).toMatchObject({ provider: { id: 'o' }, model: 'other/model' });
    expect(resolveRoute(t, 'narrator').model).toBe('claude-sonnet-5-5');
  });
  it('제공자를 바꾸면 그 제공자의 기본 모델', () => {
    expect(resolveRoute(withRoutes(s, { narrator: { provider: 'o' } }), 'narrator')).toMatchObject({ provider: { id: 'o' }, model: 'x/y' });
  });
  it('플레이: 내 설정 < 세계 추천 < 세이브에서 고른 것', () => {
    const world = { narrator: 'claude-opus-5-5' };
    expect(resolveRoute(playSettings(s, world, { mode: 'world' }), 'narrator').model).toBe('claude-opus-5-5');
    expect(resolveRoute(playSettings(s, world, { mode: 'mine' }), 'narrator').model).toBe('claude-sonnet-5-5');
    expect(resolveRoute(playSettings(s, world, { mode: 'custom', routes: { narrator: { provider: 'o', model: 'z/z' } } }), 'narrator')).toMatchObject({ provider: { id: 'o' }, model: 'z/z' });
  });
});
