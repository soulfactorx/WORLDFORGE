import { useState } from 'react';
import { ANTHROPIC_MODELS, createLlmClient } from '../llm';
import { type LlmSettings, type ProviderKind, ROLE_GROUP_LABEL, type RoleGroup } from '../llm/types';
import { saveSettings } from '../storage/settings';

const PRESETS: Record<string, { baseUrl: string; model: string }> = {
  OpenAI: { baseUrl: 'https://api.openai.com/v1', model: '' },
  OpenRouter: { baseUrl: 'https://openrouter.ai/api/v1', model: '' },
  'Ollama (로컬)': { baseUrl: 'http://localhost:11434/v1', model: '' },
  'LM Studio (로컬)': { baseUrl: 'http://localhost:1234/v1', model: '' },
};

export function SettingsPanel({ initial, onSaved }: { initial: LlmSettings | null; onSaved: (s: LlmSettings) => void }) {
  const [s, setS] = useState<LlmSettings>(initial ?? { provider: 'anthropic', apiKey: '', model: ANTHROPIC_MODELS[0] });
  const [remember, setRemember] = useState(true);
  const [status, setStatus] = useState('');
  const set = (patch: Partial<LlmSettings>) => setS((p) => ({ ...p, ...patch }));

  async function test() {
    setStatus('연결 확인 중…');
    try {
      let out = '';
      await createLlmClient(s).stream({ system: '짧게 답한다.', user: '"연결 성공"이라고만 답해.', maxTokens: 200 }, (d) => { out += d; });
      setStatus(`✅ ${out.trim()}`);
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`);
    }
  }

  return (
    <section className="panel">
      <h2>AI 설정</h2>
      <p className="muted">
        API 키는 이 브라우저에만 저장되며 WORLDFORGE 서버로 전송되지 않습니다(서버가 없습니다). 요청은 브라우저에서 AI 제공자에게 직접 갑니다.
      </p>
      <label>제공자
        <select value={s.provider} onChange={(e) => {
          const provider = e.target.value as ProviderKind;
          set(provider === 'anthropic' ? { provider, model: ANTHROPIC_MODELS[0], baseUrl: undefined, roleModels: undefined } : { provider, model: '', baseUrl: PRESETS.OpenAI!.baseUrl, roleModels: undefined });
        }}>
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai-compatible">OpenAI 호환 (OpenAI · OpenRouter · Ollama · LM Studio)</option>
        </select>
      </label>
      {s.provider === 'openai-compatible' && (
        <>
          <div className="row">
            {Object.entries(PRESETS).map(([name, p]) => (
              <button key={name} type="button" onClick={() => set({ baseUrl: p.baseUrl })}>{name}</button>
            ))}
          </div>
          <label>Base URL<input value={s.baseUrl ?? ''} onChange={(e) => set({ baseUrl: e.target.value })} /></label>
          <p className="muted small">로컬 모델은 브라우저 요청 허용이 필요합니다. Ollama: <code>OLLAMA_ORIGINS=*</code> 설정 후 재시작. LM Studio: 서버 설정에서 CORS 활성화.</p>
        </>
      )}
      <label>API 키{s.provider === 'openai-compatible' && ' (로컬 모델은 비워 두어도 됨)'}
        <input type="password" value={s.apiKey} autoComplete="off" onChange={(e) => set({ apiKey: e.target.value })} />
      </label>
      <label>모델
        {s.provider === 'anthropic' ? (
          <select value={s.model} onChange={(e) => set({ model: e.target.value })}>
            {ANTHROPIC_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (
          <input value={s.model} placeholder="예: gpt-4o-mini, llama3.1:8b" onChange={(e) => set({ model: e.target.value })} />
        )}
      </label>
      <details className="role-models" open={!!s.roleModels && Object.values(s.roleModels).some(Boolean)}>
        <summary>역할별 모델 (선택) — 비용 줄이기</summary>
        <p className="muted small">비워 두면 위의 모델을 씁니다. 예: 서술만 큰 모델, 판단·기록은 작고 빠른 모델. 같은 제공자·키를 씁니다. 바꾼 뒤 아래 "품질 점검"으로 규칙을 잘 지키는지 확인하세요.</p>
        {(Object.keys(ROLE_GROUP_LABEL) as RoleGroup[]).map((g) => (
          <label key={g}>{ROLE_GROUP_LABEL[g]}
            {s.provider === 'anthropic' ? (
              <select value={s.roleModels?.[g] ?? ''} onChange={(e) => set({ roleModels: { ...s.roleModels, [g]: e.target.value || undefined } })}>
                <option value="">(기본: {s.model})</option>
                {ANTHROPIC_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input value={s.roleModels?.[g] ?? ''} placeholder={`(기본: ${s.model || '위의 모델'})`} onChange={(e) => set({ roleModels: { ...s.roleModels, [g]: e.target.value || undefined } })} />
            )}
          </label>
        ))}
      </details>
      <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> 이 브라우저에 키 기억하기 (끄면 탭을 닫을 때 삭제)</label>
      <div className="row">
        <button type="button" onClick={test} disabled={!s.model}>연결 테스트</button>
        <button type="button" className="primary" disabled={!s.model} onClick={() => { saveSettings(s, remember); onSaved(s); }}>저장</button>
      </div>
      {status && <p className="status">{status}</p>}
    </section>
  );
}
