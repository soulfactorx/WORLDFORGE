/**
 * 이미지 분류 도구 (v0.121): 분류 안 된 이미지를 쓰이게 만든다.
 *  1) 여러 장 한 번에 고치기  2) 분류 안 된 이미지를 모두 한 인물로  3) AI로 다시 분류 — 파일 이름으로 / 그림을 보고(선택, 그림이 외부로 나간다)
 */
import { useRef, useState } from 'react';
import type { AssetMeta, WorldPackage } from '../engine/schema';
import { mergeBundles, readCharxBundle } from '../importers/bundle';
import { applyScriptHints, bundleSources, linkFromScripts, statsText, statsTotal } from '../importers/scriptLinks';
import { classifyAssetsAI, classifyAssetsVision, reclassifyByName, tokenize, type VisionInput } from '../importers/assetmatch';
import { createLlmClient } from '../llm';
import { type RouteOverrides, withRoutes } from '../llm/override';
import { resolveRoute } from '../llm/providers';
import type { LlmSettings } from '../llm/types';
import { assetBlob } from '../storage/assets';
import { appearanceOf } from '../engine/names';
import { ModelPicker } from './ModelPicker';

const KIND = [['character', '인물'], ['scene', '장면'], ['map', '지도'], ['cover', '표지'], ['other', '분류 안 됨']] as const;

/** 그림을 작게 줄여 JPEG base64로 (보내는 양·비용을 줄인다) */
async function thumb(blob: Blob, max = 512): Promise<{ mime: string; data: string }> {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.8);
  return { mime: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) };
}

export function AssetTools({ world, assets, onChange, settings, selected, setSelected, visible }: {
  world: WorldPackage; assets: AssetMeta[]; onChange: (a: AssetMeta[]) => void; settings?: LlmSettings | null;
  selected: Set<string>; setSelected: (s: Set<string>) => void; visible: AssetMeta[];
}) {
  const others = assets.filter((a) => a.kind === 'other');
  const [kind, setKind] = useState<AssetMeta['kind'] | ''>('');
  const [who, setWho] = useState(world.characters[0]?.id ?? '');
  const [where, setWhere] = useState('');
  const [addTags, setAddTags] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<RouteOverrides>({});
  const abort = useRef<AbortController | null>(null);
  /** 되돌리기 (v0.123): 도구가 마지막으로 바꾸기 전의 목록 */
  const [undo, setUndo] = useState<{ assets: AssetMeta[]; what: string } | null>(null);
  const change = (next: AssetMeta[], what: string) => { setUndo({ assets, what }); onChange(next); };
  type Scope = 'selected' | 'visible' | 'other';
  const [scope0, setScope] = useState<Scope | ''>('');
  const scope: Scope = scope0 || (selected.size ? 'selected' : 'other');
  const scopeIds = new Set((scope === 'selected' ? assets.filter((a) => selected.has(a.id)) : scope === 'visible' ? visible : others).map((a) => a.id));
  const inScope = (a: AssetMeta) => scopeIds.has(a.id);
  const sample = assets.filter(inScope).slice(0, 3);
  const ai = settings ? withRoutes(settings, models) : null;
  const tagsOf = (s: string) => s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);

  function applyBulk() {
    const t = tagsOf(addTags);
    const next = assets.map((a) => {
      if (!selected.has(a.id)) return a;
      const k = kind || a.kind;
      let n: AssetMeta = { ...a, kind: k };
      if (k === 'character') { n = { ...n, characterId: who || a.characterId }; delete n.locationId; }
      if (k === 'scene' || k === 'map') { if (where) n = { ...n, locationId: where }; delete n.characterId; }
      if (k !== 'character' && k !== 'scene' && k !== 'map') { delete n.characterId; delete n.locationId; }
      if (t.length) n = { ...n, tags: [...new Set([...n.tags.filter((x) => x !== 'default' || !t.length), ...t])] };
      if (k === 'character' && !n.tags.length) n = { ...n, tags: ['default'] };
      return n;
    });
    change(next, '한 번에 고치기');
    setMsg(`${selected.size}장에 적용했습니다. 저장하세요.`);
    setSelected(new Set());
  }
  function othersTo(npcId: string) {
    if (!npcId || !others.length) return;
    if (!confirm(`분류 안 된 이미지 ${others.length}장을 모두 「${world.characters.find((c) => c.id === npcId)?.name}」의 이미지로 넘길까요? 태그는 파일 이름에서 가져오고, 없으면 기본 모습이 됩니다. (나중에 하나씩 고칠 수 있습니다)`)) return;
    change(assets.map((a) => (a.kind === 'other' ? { ...a, kind: 'character', characterId: npcId, tags: a.tags.length ? a.tags : ['default'] } : a)), '모두 한 인물로');
    setMsg(`${others.length}장을 넘겼습니다. 저장하세요.`);
  }
  /** AI 없이: 파일 이름을 낱말로 나눠 인물·장소·종류·태그를 찾는다 */
  function byWords() {
    if (!scopeIds.size) { setMsg('대상 그림이 없습니다.'); return; }
    const r = reclassifyByName(assets, world.characters.map((c) => ({ id: c.id, name: c.name, ...(c.gender ? { gender: c.gender } : {}) })), world.locations.map((l) => ({ id: l.id, name: l.name })), inScope);
    if (r.changed) change(r.assets, '낱말로 나눠 분류');
    else if (r.assets.some((a, i) => a !== assets[i])) change(r.assets, '낱말 태그 붙이기');
    const left = r.assets.filter((a) => a.kind === 'other').length;
    setMsg(r.changed ? `${r.tried}장 중 ${r.changed}장을 고쳤습니다. 저장하세요.${left ? ` 아직 분류 안 됨 ${left}장 — 이름에 인물·장소 이름이 없는 그림입니다. AI로 분류하거나 한 번에 고치세요.` : ''}` : `${r.tried}장에서 파일 이름으로 찾을 수 있는 인물·장소가 없었습니다.${r.assets.some((a, i) => a !== assets[i]) ? ' 이름의 낱말은 태그로 붙여 두었습니다 (거르기에 쓸 수 있습니다).' : ''}`);
  }
  /** 원본 카드 파일의 정규식·Lua 표·로어북 글에서 연결을 읽는다 (v0.124). 카드 파일은 이 기기에서만 읽고 어디에도 보내지 않는다 */
  async function fromCardFiles(files: File[]) {
    setBusy(true); setMsg('카드 읽는 중…');
    try {
      const bundles = [];
      for (const f of files) bundles.push(await readCharxBundle(f, f.name, (m) => setMsg(m)));
      const b = await mergeBundles(bundles[0]!, bundles.slice(1));
      const slug = (id: string) => id.replace(/^[a-z]+\//, '').replace(/[-_]+/g, ' ');
      const ct = world.characters.map((c) => ({ id: c.id, aliases: [c.name, slug(c.id)], ...(c.gender ? { gender: c.gender } : {}) }));
      const lt = world.locations.map((l) => ({ id: l.id, aliases: [l.name, slug(l.id)] }));
      const hints = linkFromScripts(assets.map((a) => a.name), ct, lt, bundleSources(b));
      const r = applyScriptHints(assets, hints, world.characters.length === 1 ? { mainCharacterId: world.characters[0]!.id } : {});
      const n = statsTotal(r.stats);
      if (n) change(r.assets, '카드 스크립트 연결');
      const rules = b.regexRules?.length ?? 0, tables = Object.keys(b.lua.data).length;
      setMsg(n ? `카드 스크립트에서 ${n}장을 연결했습니다 (${statsText(r.stats)}). 저장하세요.`
        : `연결을 찾지 못했습니다 — 단서 ${hints.size}개 (정규식 ${rules}개 · Lua 표 ${tables}개 · 로어북 ${b.card.lore.length + b.extraLore.length}개를 읽음). 이 카드는 이미지 이름을 AI가 직접 쓰게 하는 방식이거나, 이미 분류된 그림입니다.`);
    } catch (e) { setMsg(`❌ 카드를 읽지 못했습니다: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  async function byName() {
    if (!ai) return;
    if (!scopeIds.size) { setMsg('대상 그림이 없습니다.'); return; }
    const route = resolveRoute(ai, 'bulk');
    if (!confirm(`파일 이름 ${scopeIds.size}장을 「${route.provider.name}」의 ${route.model} 모델에 보냅니다.\n\n· 그림은 보내지 않고 파일 이름과 인물·장소 목록만 보냅니다.\n· 같은 이름 패턴은 한 번만 묻습니다 (숫자·해시뿐인 이름은 묻지 않음).\n· 요청 수만큼 비용이 듭니다.\n\n보낼까요?`)) return;
    abort.current = new AbortController(); setBusy(true);
    try {
      const chars = world.characters.map((c) => ({ id: c.id, name: c.name, aliases: [c.name, c.id.replace(/^[a-z]+\//, '')] }));
      const out = await classifyAssetsAI(createLlmClient(ai), assets, chars, world.locations.map((l) => ({ id: l.id, name: l.name })),
        (d, t, info) => setMsg(`파일 이름으로 분류 중 — ${d}/${t}장${info ? ` · ${info}` : ''}`), abort.current.signal, inScope);
      const n = out.filter((a, i) => a.kind !== assets[i]!.kind || a.characterId !== assets[i]!.characterId || a.locationId !== assets[i]!.locationId).length;
      if (n) change(out, 'AI 파일 이름 분류');
      setMsg(n ? `${n}장을 분류했습니다. 저장하세요. 남은 것은 파일 이름에 단서가 없는 이미지입니다 — 그림을 보고 분류하거나 한 번에 고치세요.` : '파일 이름으로는 더 분류할 수 없었습니다 (숫자·해시 이름은 묻지 않습니다).');
    } catch (e) { setMsg(abort.current?.signal.aborted ? '중단했습니다.' : `❌ ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  async function byPicture() {
    if (!ai) return;
    const ids = selected.size ? assets.filter((a) => selected.has(a.id)) : others;
    const real = ids.filter((a) => !a.id.startsWith('stock.') && !a.id.startsWith('user.'));
    if (!real.length) { setMsg('보낼 이미지가 없습니다 (이미지를 선택하거나, 분류 안 된 이미지가 있어야 합니다).'); return; }
    const route = resolveRoute(ai, 'bulk');
    if (!confirm(`그림 ${real.length}장을 「${route.provider.name}」의 ${route.model} 모델에 보냅니다.\n\n· 그림 내용이 그 제공자의 서버로 전송됩니다 (작게 줄인 JPEG).\n· 이미지 인식을 지원하는 모델이어야 합니다.\n· 장수만큼 요청·비용이 듭니다 (4장씩 묶어 약 ${Math.ceil(real.length / 4)}번).\n· 남의 캐릭터 카드 그림이면 원작자의 권리를, 성인 그림이면 제공자의 정책을 확인하세요.\n\n보낼까요?`)) return;
    abort.current = new AbortController(); setBusy(true);
    try {
      const inputs: VisionInput[] = [];
      for (const a of real) {
        const blob = await assetBlob(world.manifest.id, a.id);
        if (!blob) continue;
        try { inputs.push({ index: assets.indexOf(a), name: a.name, ...(await thumb(blob)) }); } catch { /* 읽을 수 없는 그림은 건너뛴다 */ }
        setMsg(`그림 준비 중 — ${inputs.length}/${real.length}`);
      }
      const r = await classifyAssetsVision(createLlmClient(ai), inputs, assets, world.characters.map((c) => ({ id: c.id, name: c.name, look: appearanceOf(c) })), world.locations.map((l) => ({ id: l.id, name: l.name })),
        (d, t, info) => setMsg(`그림을 보고 분류 중 — ${d}/${t}장${info ? ` · ${info}` : ''}`), abort.current.signal);
      change(r.assets, '그림을 보고 분류');
      setMsg(`${r.changed}장을 분류했습니다${r.failed ? ` (실패 ${r.failed}장)` : ''}. 저장하세요. 결과를 한 번 훑어보고 틀린 것은 고치세요.`);
      setSelected(new Set());
    } catch (e) { setMsg(abort.current?.signal.aborted ? '중단했습니다 (그때까지 분류한 것은 버렸습니다).' : `❌ ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  return (
    <details className="asset-tools" open={others.length > 0}>
      <summary className="small"><b>🧩 분류 도구</b> — <span className="nowrap">분류 안 됨 <b>{others.length}장</b></span> (분류 안 된 이미지는 플레이에 쓰이지 않습니다)</summary>

      <fieldset className="struct-obj"><legend>여러 장 한 번에 고치기 — 선택 {selected.size}장</legend>
        <div className="row">
          <button type="button" className="small" onClick={() => setSelected(new Set([...selected, ...visible.map((a) => a.id)]))}>찾은 것 모두 선택 ({visible.length})</button>
          <button type="button" className="small" onClick={() => setSelected(new Set([...selected, ...others.map((a) => a.id)]))}>분류 안 된 것 모두 선택 ({others.length})</button>
          {selected.size > 0 && <button type="button" className="small" onClick={() => setSelected(new Set())}>선택 해제</button>}
        </div>
        <div className="asset-bulk">
          <label>종류<select value={kind} onChange={(e) => setKind(e.target.value as AssetMeta['kind'] | '')}><option value="">(그대로)</option>{KIND.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          {(kind === 'character' || kind === '') && <label>인물<select value={who} onChange={(e) => setWho(e.target.value)}><option value="">(그대로)</option>{world.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
          {(kind === 'scene' || kind === 'map') && <label>장소<select value={where} onChange={(e) => setWhere(e.target.value)}><option value="">(모든 장소)</option>{world.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>}
          <label>태그 더하기 (쉼표로)<input value={addTags} placeholder="예: smile, blush" onChange={(e) => setAddTags(e.target.value)} /></label>
        </div>
        <button type="button" className="primary" disabled={!selected.size || busy} onClick={applyBulk}>선택한 {selected.size}장에 적용</button>
      </fieldset>

      {others.length > 0 && world.characters.length > 0 && (
        <fieldset className="struct-obj"><legend>분류 안 된 이미지를 모두 한 인물로</legend>
          <p className="small muted">주인공 한 명짜리 카드처럼 남은 그림이 대부분 한 인물의 것일 때.</p>
          <div className="asset-bulk">
            <label>인물<select value={who} onChange={(e) => setWho(e.target.value)}>{world.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          </div>
          <button type="button" disabled={busy || !who} onClick={() => othersTo(who)}>분류 안 된 {others.length}장 모두 넘기기</button>
        </fieldset>
      )}

      <fieldset className="struct-obj"><legend>📜 카드 스크립트에서 연결 읽기</legend>
        <p className="small muted">원본 캐릭터 카드(.charx · .png · .json · 모듈 .risum, 여러 개 가능)를 고르면, 카드의 <b>정규식 스크립트</b>(무엇이 어떤 이미지로 바뀌는지) · <b>Lua 표</b>(인물 → 표정 → 이미지) · <b>로어북·설명 글</b>(이미지 목록)에서 이미지가 어느 인물·표정인지 읽어 붙입니다. 스크립트는 실행하지 않고, 카드 파일은 이 기기에서만 읽습니다. 분류 안 된 그림과 기본 모습만 있는 그림만 바꿉니다.</p>
        <label className="file-pick">카드 파일 고르기
          <input type="file" multiple accept=".charx,.risum,.png,.json,application/zip,image/png,application/json" disabled={busy} onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) void fromCardFiles(fs); e.target.value = ''; }} />
        </label>
      </fieldset>

      <fieldset className="struct-obj"><legend>📄 파일 이름으로 다시 분류</legend>
        <p className="small muted">파일 이름을 <b>구분자(_ - . 공백 + ~ # 괄호 등)</b>, 글자 종류가 바뀌는 곳(한글↔영문↔숫자), 낙타 표기(liaSmile)에서 낱말로 나눠 인물·장소·종류·표정 태그를 찾습니다. 성을 뺀 이름(윤세아 → 세아)과 이름에 붙은 조사(리아의)도 알아봅니다.</p>
        <div className="asset-bulk">
          <label>대상
            <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
              <option value="selected">선택한 그림 ({selected.size}장)</option>
              <option value="visible">지금 보이는(거른) 그림 ({visible.length}장)</option>
              <option value="other">분류 안 된 그림 ({others.length}장)</option>
            </select>
          </label>
        </div>
        {sample.length > 0 && (
          <ul className="small muted asset-words">
            {sample.map((a) => <li key={a.id}><span className="mono">{a.name}</span> → {tokenize(a.name).tokens.join(' · ') || '(낱말 없음)'}</li>)}
          </ul>
        )}
        <div className="row">
          <button type="button" className="primary" disabled={busy || !scopeIds.size} onClick={byWords}>낱말로 나눠 분류 — AI 없이 ({scopeIds.size}장)</button>
          {settings && <button type="button" disabled={busy || !scopeIds.size} onClick={() => void byName()}>✦ AI로 분류 ({scopeIds.size}장)</button>}
        </div>
        <p className="small muted">찾은 것만 바꾸고, 원래 붙어 있던 태그는 남깁니다. 먼저 AI 없이 해 보고, 남은 것만 AI로 보내면 비용이 적습니다. AI 모델은 아래에서 고릅니다.</p>
      </fieldset>

      <fieldset className="struct-obj"><legend>✦ AI 모델 · 그림을 보고 분류</legend>
        {!settings ? <p className="small muted">AI 설정을 하면 쓸 수 있습니다.</p> : (
          <>
            <ModelPicker settings={settings} groups={['bulk']} value={models} onChange={setModels} title="🤖 분류에 쓸 AI 모델" note="AI 설정의 「번역·이미지 분류」 묶음이 기본입니다. 그림을 보고 분류하려면 이미지 인식을 지원하는 모델(예: Claude, GPT-4o급, Gemini)을 고르세요." />
            <div className="row">
              <button type="button" disabled={busy} onClick={() => void byPicture()}>그림을 보고 분류 ({selected.size || others.length}장)</button>
              {busy && <button type="button" onClick={() => abort.current?.abort()}>중단</button>}
            </div>
            <div className="asset-warn small">
              <b>⚠ 그림을 보고 분류할 때 주의</b>
              <ul>
                <li>그림 내용이 위에서 고른 <b>제공자의 서버로 전송</b>됩니다 (작게 줄인 JPEG). 파일 이름으로 분류할 때는 이름만 보냅니다.</li>
                <li><b>이미지 인식을 지원하는 모델</b>이어야 합니다. 지원하지 않으면 요청이 실패합니다.</li>
                <li>그림 수만큼 비용이 듭니다 (4장씩 묶어 보냄). 선택한 그림이 있으면 그것만, 없으면 분류 안 된 그림 전부를 보냅니다.</li>
                <li>남의 캐릭터 카드 그림이면 원작자의 권리를, 성인 그림이면 제공자의 이용 정책을 확인하세요. 제공자가 거절할 수 있습니다.</li>
                <li>AI의 분류는 틀릴 수 있습니다. 끝나면 결과를 훑어보고 고치세요.</li>
              </ul>
            </div>
          </>
        )}
      </fieldset>
      {msg && <p className="status small">{msg}</p>}
      {undo && !busy && <div className="row"><button type="button" className="small" onClick={() => { onChange(undo.assets); setUndo(null); setMsg(`「${undo.what}」을 되돌렸습니다.`); }}>↶ 「{undo.what}」 되돌리기</button></div>}
    </details>
  );
}
