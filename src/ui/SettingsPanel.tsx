import { useState } from 'react';
import { ANTHROPIC_MODELS, createLlmClient } from '../llm';
import { buildSettings, defaultProviderOf, providerLabel, providersOf, roleRouteOf } from '../llm/providers';
import { type LlmProvider, type LlmSettings, type ProviderKind, ROLE_GROUP_HINT, ROLE_GROUP_LABEL, ROLE_GROUPS, type RoleGroup, type RoleRoute } from '../llm/types';
import { saveSettings } from '../storage/settings';

const PRESETS: Record<string, { baseUrl: string }> = {
  OpenAI: { baseUrl: 'https://api.openai.com/v1' },
  OpenRouter: { baseUrl: 'https://openrouter.ai/api/v1' },
  'Ollama (로컬)': { baseUrl: 'http://localhost:11434/v1' },
  'LM Studio (로컬)': { baseUrl: 'http://localhost:1234/v1' },
};

const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const blank = (kind: ProviderKind): LlmProvider => (kind === 'anthropic'
  ? { id: newId(), name: '', provider: 'anthropic', apiKey: '', model: ANTHROPIC_MODELS[0] }
  : { id: newId(), name: '', provider: 'openai-compatible', apiKey: '', model: '', baseUrl: PRESETS.OpenAI!.baseUrl });
/** 화면에 보일 이름: 직접 붙인 이름이 없으면 주소로 짐작한다 */
const nameOf = (p: LlmProvider) => p.name.trim() || providerLabel(p);

/**
 * AI 설정 (v0.101): 제공자를 여러 개 등록하고, 역할 묶음마다 어느 제공자의 어느 모델을 쓸지 정한다.
 * 예전 설정(제공자 하나)은 그대로 읽어 제공자 하나짜리 목록으로 보여 준다.
 */
export function SettingsPanel({ initial, onSaved }: { initial: LlmSettings | null; onSaved: (s: LlmSettings) => void }) {
  const [list, setList] = useState<LlmProvider[]>(() => (initial ? providersOf(initial).map((p) => ({ ...p })) : [blank('anthropic')]));
  const [def, setDef] = useState<string>(() => (initial ? defaultProviderOf(initial).id : ''));
  const [roles, setRoles] = useState<Partial<Record<RoleGroup, RoleRoute>>>(() => (initial ? Object.fromEntries(ROLE_GROUPS.map((g) => [g, roleRouteOf(initial, g)])) : {}));
  const [remember, setRemember] = useState(true);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState('');
  const defId = list.some((p) => p.id === def) ? def : list[0]!.id;
  const defP = list.find((p) => p.id === defId)!;

  const patch = (id: string, x: Partial<LlmProvider>) => { setSaved(''); setList((ps) => ps.map((p) => (p.id === id ? { ...p, ...x } : p))); };
  const setRole = (g: RoleGroup, x: RoleRoute) => { setSaved(''); setRoles((r) => ({ ...r, [g]: { ...r[g], ...x } })); };
  function remove(id: string) {
    const p = list.find((x) => x.id === id);
    if (!p || list.length < 2 || !confirm(`제공자 "${nameOf(p)}"를 지울까요? 이 제공자를 쓰던 역할은 기본 제공자로 돌아갑니다.`)) return;
    setSaved('');
    setList((ps) => ps.filter((x) => x.id !== id));
    setRoles((r) => Object.fromEntries(Object.entries(r).map(([g, v]) => [g, v?.provider === id ? {} : v])));
  }

  async function test(p: LlmProvider, model = p.model, key = p.id) {
    setStatus((s) => ({ ...s, [key]: '연결 확인 중…' }));
    try {
      let out = '';
      await createLlmClient({ provider: p.provider, apiKey: p.apiKey, model, ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}) }).stream({ system: '짧게 답한다.', user: '"연결 성공"이라고만 답해.', maxTokens: 200 }, (d) => { out += d; });
      setStatus((s) => ({ ...s, [key]: `✅ ${model}: ${out.trim()}` }));
    } catch (e) {
      setStatus((s) => ({ ...s, [key]: `❌ ${model}: ${(e as Error).message}` }));
    }
  }

  const ready = list.every((p) => p.model.trim());
  function save() {
    const named = list.map((p) => ({ ...p, name: nameOf(p), model: p.model.trim(), apiKey: p.apiKey.trim(), ...(p.baseUrl ? { baseUrl: p.baseUrl.trim() } : {}) }));
    const s = buildSettings(named, defId, roles);
    saveSettings(s, remember);
    setSaved('✅ 저장했습니다.');
    onSaved(s);
  }

  return (
    <section className="panel ai-settings">
      <h2>AI 설정</h2>
      <p className="muted">
        API 키는 이 브라우저에만 저장되며 WORLDFORGE 서버로 전송되지 않습니다(서버가 없습니다). 요청은 브라우저에서 AI 제공자에게 직접 갑니다.
      </p>

      <h3>제공자</h3>
      <p className="muted small">제공자를 여러 개 등록해 두고 역할마다 골라 쓸 수 있습니다. 예: 서술은 Claude, 번역·이미지 분류는 OpenRouter의 싼 모델, 판단은 집의 로컬 모델. <b>기본</b>으로 고른 제공자는 따로 정하지 않은 모든 역할에 쓰입니다.</p>
      {list.map((p, i) => (
        <fieldset key={p.id} className="provider-card">
          <legend>{nameOf(p)}{p.id === defId ? ' · 기본' : ''}</legend>
          <div className="provider-head">
            <label className="check"><input type="radio" name="default-provider" checked={p.id === defId} onChange={() => { setSaved(''); setDef(p.id); }} /> 기본 제공자로 쓰기</label>
            {list.length > 1 && <button type="button" className="icon" aria-label={`제공자 ${i + 1} 지우기`} title="이 제공자 지우기" onClick={() => remove(p.id)}>🗑</button>}
          </div>
          <label>종류
            <select value={p.provider} onChange={(e) => {
              const kind = e.target.value as ProviderKind;
              patch(p.id, kind === 'anthropic' ? { provider: kind, model: ANTHROPIC_MODELS[0], baseUrl: undefined } : { provider: kind, model: '', baseUrl: PRESETS.OpenAI!.baseUrl });
            }}>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai-compatible">OpenAI 호환 (OpenAI · OpenRouter · Ollama · LM Studio)</option>
            </select>
          </label>
          <label>이름 (목록에서 구분하는 이름)
            <input value={p.name} placeholder={providerLabel(p)} onChange={(e) => patch(p.id, { name: e.target.value })} />
          </label>
          {p.provider === 'openai-compatible' && (
            <>
              <div className="row provider-presets">
                {Object.entries(PRESETS).map(([name, x]) => <button key={name} type="button" onClick={() => patch(p.id, { baseUrl: x.baseUrl })}>{name}</button>)}
              </div>
              <label>Base URL<input value={p.baseUrl ?? ''} onChange={(e) => patch(p.id, { baseUrl: e.target.value })} /></label>
              <p className="muted small">로컬 모델은 브라우저 요청 허용이 필요합니다. Ollama: <code>OLLAMA_ORIGINS=*</code> 설정 후 재시작. LM Studio: 서버 설정에서 CORS 활성화.</p>
            </>
          )}
          <label>API 키{p.provider === 'openai-compatible' && ' (로컬 모델은 비워 두어도 됨)'}
            <input type="password" value={p.apiKey} autoComplete="off" onChange={(e) => patch(p.id, { apiKey: e.target.value })} />
          </label>
          <label>이 제공자의 기본 모델
            {p.provider === 'anthropic' ? (
              <select value={p.model} onChange={(e) => patch(p.id, { model: e.target.value })}>
                {ANTHROPIC_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input value={p.model} placeholder="예: gpt-4o-mini, llama3.1:8b" onChange={(e) => patch(p.id, { model: e.target.value })} />
            )}
          </label>
          <div className="row">
            <button type="button" onClick={() => test(p)} disabled={!p.model.trim()}>연결 테스트</button>
          </div>
          {status[p.id] && <p className="status small">{status[p.id]}</p>}
        </fieldset>
      ))}
      <div className="row">
        <button type="button" onClick={() => { setSaved(''); setList((ps) => [...ps, blank('openai-compatible')]); }}>＋ 제공자 추가</button>
      </div>

      <h3>역할별 제공자·모델</h3>
      <p className="muted small">
        역할마다 다른 제공자와 모델을 쓸 수 있습니다. 비워 두면 기본 제공자({nameOf(defP)})의 기본 모델({defP.model || '아직 없음'})을 씁니다.
        바꾼 뒤에는 📊 품질 점검으로 규칙을 잘 지키는지, AI 사용량의 타임라인으로 속도와 토큰을 확인하세요.
      </p>
      {ROLE_GROUPS.map((g) => {
        const r = roles[g] ?? {};
        const inherit = (g === 'extract' || g === 'bulk') && !r.provider && !r.model?.trim();
        const base = inherit ? roles.build ?? {} : r;
        const p = list.find((x) => x.id === (base.provider ?? '')) ?? defP;
        const own = list.find((x) => x.id === (r.provider ?? '')) ?? (inherit ? p : defP);
        const used = base.model?.trim() || p.model;
        const hint = ROLE_GROUP_HINT[g];
        return (
          <fieldset key={g} className="role-card">
            <legend>{ROLE_GROUP_LABEL[g]}</legend>
            <div className="role-pick">
              <label>제공자
                <select value={list.some((x) => x.id === r.provider) ? r.provider : ''} onChange={(e) => setRole(g, { provider: e.target.value || undefined, model: '' })}>
                  <option value="">{inherit ? `(세계 설계와 같게: ${nameOf(p)})` : `(기본: ${nameOf(defP)})`}</option>
                  {list.map((x) => <option key={x.id} value={x.id}>{nameOf(x)}</option>)}
                </select>
              </label>
              <label>모델
                {own.provider === 'anthropic' ? (
                  <select value={r.model ?? ''} onChange={(e) => setRole(g, { model: e.target.value })}>
                    <option value="">{inherit ? `(세계 설계와 같게: ${used})` : `(이 제공자의 기본: ${own.model})`}</option>
                    {ANTHROPIC_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <input value={r.model ?? ''} placeholder={inherit ? `(세계 설계와 같게: ${used || '없음'})` : `(이 제공자의 기본: ${own.model || '없음'})`} onChange={(e) => setRole(g, { model: e.target.value })} />
                )}
              </label>
            </div>
            <p className="small role-now">지금 쓰이는 것: <b>{nameOf(p)}</b> · <code>{used || '(모델 없음)'}</code>
              {used && <> <button type="button" className="small link" onClick={() => test(p, used, `role:${g}`)}>테스트</button></>}
            </p>
            {status[`role:${g}`] && <p className="status small">{status[`role:${g}`]}</p>}
            <details className="small role-hint">
              <summary>어떤 모델이 어울리나요?</summary>
              <p><b>하는 일</b> — {hint.work}</p>
              <p><b>어울리는 모델</b> — {hint.fit}</p>
              <p><b>조심할 점</b> — {hint.caution}</p>
            </details>
          </fieldset>
        );
      })}

      <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> 이 브라우저에 키 기억하기 (끄면 탭을 닫을 때 삭제)</label>
      {!ready && <p className="status small">❌ 모델이 비어 있는 제공자가 있습니다. 기본 모델을 넣거나 그 제공자를 지워 주세요.</p>}
      <div className="row">
        <button type="button" className="primary" disabled={!ready} onClick={save}>저장</button>
      </div>
      {saved && <p className="status">{saved}</p>}
    </section>
  );
}
