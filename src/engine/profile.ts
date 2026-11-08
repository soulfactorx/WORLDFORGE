/**
 * 주인공 정보 양식 (v0.68): 세계마다 시작할 때 고르거나 적는 것 (성별·나이·종족·신분·외모…).
 * 세계가 정하지 않으면 장르 기본 양식을 쓴다. AI는 이 정보를 알고 서술한다 (NPC에게 보이는 것만 NPC가 안다).
 */
import { genreKey } from './genre';
import type { CharacterSheet } from './character/sheet';
import type { PlayerProfile, ProfileField, WorldPackage } from './schema';

export const DEFAULT_GENDERS = ['남성', '여성', '밝히지 않음'];
const age: ProfileField = { id: 'age', label: '나이', kind: 'text', placeholder: '예: 24' };
const looks: ProfileField = { id: 'looks', label: '외모', kind: 'long', placeholder: '키·머리·눈·옷차림 등 — 사람들이 처음 보고 알아채는 모습', visible: true };

export const PROFILE_PRESETS: Record<string, PlayerProfile> = {
  high_fantasy: { fields: [{ id: 'race', label: '종족', kind: 'select', options: ['인간', '엘프', '드워프', '하플링', '수인'], visible: true }, age, looks, { id: 'origin', label: '출신', kind: 'text', placeholder: '예: 북쪽 국경 마을' }] },
  wuxia: { fields: [age, looks, { id: 'origin', label: '내력', kind: 'text', placeholder: '예: 몰락한 무가의 자손' }] },
  romance: { fields: [age, { id: 'status', label: '신분', kind: 'select', options: ['평민', '몰락 귀족', '귀족', '이방인'], visible: true }, looks, { id: 'impression', label: '첫인상', kind: 'text', placeholder: '예: 차갑지만 예의 바르다', visible: true }] },
  fighting: { fields: [{ id: 'ringname', label: '링 네임', kind: 'text', placeholder: '예: 블랙 호넷', visible: true }, age, { id: 'weight', label: '체급', kind: 'select', options: ['경량급', '중량급', '헤비급'], visible: true }, looks] },
};

/** 이 세계의 주인공 양식 */
export function profileFor(world: Pick<WorldPackage, 'playerProfile' | 'genre'>): PlayerProfile {
  return world.playerProfile ?? PROFILE_PRESETS[world.genre?.id ?? 'high_fantasy'] ?? PROFILE_PRESETS[genreKey(world)] ?? { fields: [age, looks] };
}
export const gendersOf = (p: PlayerProfile) => (p.noGender ? [] : p.genders?.length ? p.genders : DEFAULT_GENDERS);

/** 주인공 정보 한 줄 (AI용). visibleOnly면 NPC가 겉으로 볼 수 있는 것만 */
export function profileLine(world: Pick<WorldPackage, 'playerProfile' | 'genre'>, sheet: Pick<CharacterSheet, 'gender' | 'profile'>, visibleOnly = false): string {
  const p = profileFor(world);
  const parts: string[] = [];
  if (sheet.gender && sheet.gender !== '밝히지 않음') parts.push(`성별: ${sheet.gender}`);
  for (const f of p.fields ?? []) {
    const v = sheet.profile?.[f.id]?.trim();
    if (v && (!visibleOnly || f.visible)) parts.push(`${f.label}: ${v}`);
  }
  // 양식에서 빠진 칸도 기록에 있으면 (보이는 것만 볼 때는 뺀다)
  if (!visibleOnly) for (const [k, v] of Object.entries(sheet.profile ?? {})) if (v && !(p.fields ?? []).some((f) => f.id === k)) parts.push(`${k}: ${v}`);
  return parts.join(' · ');
}

/** 필수 칸이 비었는지 */
export function profileErrors(p: PlayerProfile, gender: string, profile: Record<string, string>): string[] {
  const out: string[] = [];
  if (gendersOf(p).length && !gender) out.push('성별을 고르세요.');
  for (const f of p.fields ?? []) if (f.required && !profile[f.id]?.trim()) out.push(`${f.label}을(를) 적으세요.`);
  return out;
}
