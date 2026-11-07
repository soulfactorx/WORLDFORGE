/** 주인공 정보 양식 편집 (v0.68): 시작할 때 고르거나 적는 성별·나이·종족·신분·외모… */
import { genreOf } from '../data/genres';
import { DEFAULT_GENDERS, PROFILE_PRESETS, profileFor } from '../engine/profile';
import type { PlayerProfile, ProfileField, WorldPackage } from '../engine/schema';

const KINDS: [ProfileField['kind'], string][] = [['text', '한 줄'], ['long', '여러 줄'], ['select', '고르기']];

export function ProfileEditor({ world, onChange }: { world: WorldPackage; onChange: (p: PlayerProfile | undefined) => void }) {
  const own = world.playerProfile;
  const p = profileFor(world);
  const fields = p.fields ?? [];
  const put = (patch: Partial<PlayerProfile>) => onChange({ ...structuredClone(p), ...patch });
  const setField = (i: number, patch: Partial<ProfileField>) => put({ fields: fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const move = (i: number, d: number) => { const n = [...fields]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); put({ fields: n }); };
  const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  return (
    <div className="profile-editor">
      <p className="muted small">
        플레이어가 <b>주인공 만들기</b>에서 고르거나 적는 것입니다. 정한 정보는 서술·판단 AI에게 전해지고, <b>사람들이 보고 아는 것</b>으로 표시한 칸(외모·종족 등)은 NPC도 압니다.
        {!own && <> 지금은 장르({genreOf(world.genre?.id).label}) 기본 양식을 씁니다 — 아무 칸이나 고치면 이 세계 전용 양식이 됩니다.</>}
      </p>
      <div className="row">
        {own && <button type="button" onClick={() => confirm('이 세계 전용 양식을 지우고 장르 기본 양식을 쓸까요?') && onChange(undefined)}>장르 기본으로 되돌리기</button>}
        <label>다른 장르 양식으로 채우기
          <select value="" onChange={(e) => { const k = e.target.value; if (k && PROFILE_PRESETS[k] && (!own || confirm('지금 양식을 바꿀까요?'))) onChange(structuredClone(PROFILE_PRESETS[k])); }}>
            <option value="">(고르기)</option>
            {Object.keys(PROFILE_PRESETS).map((k) => <option key={k} value={k}>{genreOf(k).label}</option>)}
          </select>
        </label>
      </div>
      <fieldset>
        <legend>성별</legend>
        <label className="check"><input type="checkbox" checked={!p.noGender} onChange={(e) => put({ noGender: e.target.checked ? undefined : true })} /> 시작할 때 성별을 고른다</label>
        {!p.noGender && (
          <label>선택지 (쉼표로 구분, 비우면 {DEFAULT_GENDERS.join('·')})
            <input defaultValue={(p.genders ?? []).join(', ')} placeholder={DEFAULT_GENDERS.join(', ')} onBlur={(e) => put({ genders: csv(e.target.value).length ? csv(e.target.value) : undefined })} />
          </label>
        )}
      </fieldset>
      {fields.map((f, i) => (
        <fieldset key={i} className="profile-field">
          <legend>{f.label || '(이름 없음)'}</legend>
          <div className="form-grid">
            <label>항목 이름<input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} /></label>
            <label>ID (영문)<input value={f.id} onChange={(e) => setField(i, { id: e.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase() })} /></label>
            <label>입력 방식
              <select value={f.kind} onChange={(e) => setField(i, { kind: e.target.value as ProfileField['kind'] })}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </label>
            {f.kind === 'select'
              ? <label>선택지 (쉼표로 구분)<input defaultValue={(f.options ?? []).join(', ')} key={`${i}-${f.id}`} onBlur={(e) => setField(i, { options: csv(e.target.value) })} /></label>
              : <label>예시 (흐린 글씨)<input value={f.placeholder ?? ''} onChange={(e) => setField(i, { placeholder: e.target.value || undefined })} /></label>}
            <label>도움말<input value={f.help ?? ''} onChange={(e) => setField(i, { help: e.target.value || undefined })} /></label>
          </div>
          <div className="row">
            <label className="check small"><input type="checkbox" checked={!!f.required} onChange={(e) => setField(i, { required: e.target.checked || undefined })} /> 꼭 정해야 함</label>
            <label className="check small"><input type="checkbox" checked={!!f.visible} onChange={(e) => setField(i, { visible: e.target.checked || undefined })} /> 사람들이 보고 아는 것 (NPC도 안다)</label>
            <span className="spacer" />
            <button type="button" className="small" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button type="button" className="small" disabled={i === fields.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button type="button" className="small" onClick={() => put({ fields: fields.filter((_, j) => j !== i) })}>삭제</button>
          </div>
        </fieldset>
      ))}
      <button type="button" onClick={() => { let n = fields.length + 1; while (fields.some((f) => f.id === `field${n}`)) n++; put({ fields: [...fields, { id: `field${n}`, label: '새 항목', kind: 'text' }] }); }}>＋ 항목 추가</button>
    </div>
  );
}
