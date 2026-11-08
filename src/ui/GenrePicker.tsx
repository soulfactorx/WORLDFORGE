/**
 * 장르 고르기 (v0.81): 프리셋 장르 + 사용자 정의 장르(이름·분위기 지침·전투 빈도·바탕 장르·화폐·용어).
 */
import { CUSTOM_GENRE_ID, GENRES, type CustomGenre } from '../data/genres';
import type { WorldPackage } from '../engine/schema';

type Genre = NonNullable<WorldPackage['genre']>;
const BASES = [['high_fantasy', '하이 판타지 (기본 8직업·선악/질서)'], ['wuxia', '무협 (무협 직업·정사/의리)'], ['romance', '로맨스 (궁정 직업·온기/대담)'], ['fighting', '현대 격투 (격투 직업·정정당당/투지)']] as const;

export function GenrePicker({ value, onChange, compact }: { value: Genre | undefined; onChange: (g: Genre) => void; compact?: boolean }) {
  const id = value?.id ?? 'high_fantasy';
  const custom: CustomGenre = value?.custom ?? { label: '', tone: '' };
  const setCustom = (p: Partial<CustomGenre>) => onChange({ ...(value ?? { id }), id: CUSTOM_GENRE_ID, custom: { ...custom, ...p } });
  const termsText = Object.entries(value?.terms ?? {}).map(([a, b]) => `${a}=${b}`).join('\n');
  return (
    <div className="genre-picker">
      <label>장르
        <select value={id} onChange={(e) => onChange(e.target.value === CUSTOM_GENRE_ID ? { ...(value ?? { id }), id: CUSTOM_GENRE_ID, custom } : { ...(value ?? { id }), id: e.target.value, custom: undefined })}>
          {GENRES.map((g) => <option key={g.id} value={g.id}>{g.label} — {g.description}</option>)}
          <option value={CUSTOM_GENRE_ID}>✎ 사용자 정의 장르…</option>
        </select>
      </label>
      {id === CUSTOM_GENRE_ID && (
        <fieldset className="genre-custom">
          <legend>사용자 정의 장르</legend>
          <label>이름<input value={custom.label} placeholder="예: 스팀펑크 모험, 오피스 코미디, 해적 활극" onChange={(e) => setCustom({ label: e.target.value })} /></label>
          <label>분위기 지침 (AI가 서술·대사·선택지에 쓰는 장르의 맛)
            <textarea rows={compact ? 3 : 4} value={custom.tone} placeholder="예: 증기 기관과 비행선의 도시. 톱니바퀴·석탄 연기·놋쇠의 질감을 묘사하고, 발명과 모험의 낙천성을 살린다. 마법은 없고 기계와 연금술이 있다."
              onChange={(e) => setCustom({ tone: e.target.value })} /></label>
          <div className="genre-custom-row">
            <label>전투 빈도<select value={custom.combat ?? 'sometimes'} onChange={(e) => setCustom({ combat: e.target.value as CustomGenre['combat'] })}>
              <option value="often">자주 (모험·전투 중심)</option><option value="sometimes">가끔</option><option value="rare">드물게 (대화·관계 중심)</option>
            </select></label>
            <label>바탕 장르 (직업·성향·주인공 양식·기본 적)<select value={custom.base ?? 'high_fantasy'} onChange={(e) => setCustom({ base: e.target.value as CustomGenre['base'] })}>
              {BASES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></label>
          </div>
          {!compact && (
            <label>용어 바꾸기 (선택, 한 줄에 하나: 원래 말=바꿀 말)
              <textarea rows={3} value={termsText} placeholder={'파이터=기관사\n위저드=발명가\n골드=파운드'}
                onChange={(e) => { const terms = Object.fromEntries(e.target.value.split('\n').map((l) => l.split('=').map((x) => x.trim())).filter((x) => x.length === 2 && x[0] && x[1])); onChange({ ...(value ?? { id }), terms: Object.keys(terms).length ? terms : undefined }); }} />
            </label>
          )}
          {!custom.tone.trim() && <p className="small err">분위기 지침을 적어야 사용자 정의 장르가 적용됩니다 (비어 있으면 하이 판타지로 다룸).</p>}
        </fieldset>
      )}
    </div>
  );
}
