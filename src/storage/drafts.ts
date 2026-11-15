/**
 * 만들던 것 지키기 (v0.126): 세계관 편집기와 마법사의 저장하지 않은 내용.
 * - 편집기 초안은 IndexedDB(큰 세계도 들어가게), 마법사 초안은 localStorage(작다)
 * - 앱이 꺼지거나, 뒤로 가기를 잘못 눌러도 홈에서 이어서 만든다
 */
import type { WorldPackage } from '../engine/schema';
import type { WizDraft } from '../gm/wizard';
import { db, type EditorDraft } from './db';

export type { EditorDraft };

export async function saveEditorDraft(id: string, world: WorldPackage, notes?: string[], origin?: WorldPackage): Promise<void> {
  await db.drafts.put({ id, name: world.manifest.name || '새 세계', world, ...(notes?.length ? { notes } : {}), ...(origin ? { origin } : {}), savedAt: Date.now() });
}
export async function getEditorDraft(id: string): Promise<EditorDraft | undefined> {
  return db.drafts.get(id).catch(() => undefined);
}
export async function listEditorDrafts(): Promise<EditorDraft[]> {
  return db.drafts.orderBy('savedAt').reverse().toArray().catch(() => []);
}
export async function deleteEditorDraft(id: string): Promise<void> {
  await db.drafts.delete(id).catch(() => undefined);
}

// ---------------------------------------------------------------- 마법사

const WIZ_KEY = 'worldforge.wizard.v1';
export interface WizardSaved { draft: WizDraft; step: number; savedAt?: number }
export function loadWizard(): WizardSaved | null {
  try { const s = JSON.parse(localStorage.getItem(WIZ_KEY) ?? '') as WizardSaved; return s?.draft?.places ? s : null; } catch { return null; }
}
export function storeWizard(s: WizardSaved | null): void {
  try { if (s) localStorage.setItem(WIZ_KEY, JSON.stringify({ ...s, savedAt: Date.now() })); else localStorage.removeItem(WIZ_KEY); } catch { /* 저장 못 해도 마법사는 쓴다 */ }
}
/** 마법사에 무언가 적었나 (빈 초안은 이어서 할 것이 없다) */
export function wizardHasContent(d: WizDraft): boolean {
  return !!(d.name.trim() || d.logline.trim() || d.overview.trim() || d.places.some((p) => p.name.trim() || p.description.trim()) || d.people.length || d.secrets.length || d.goal.name.trim() || d.start.scene.trim());
}

/**
 * 저장한 뒤 정리 (v0.131): 같은 세계의 초안 가운데 저장본과 다른 곳이 없는 것만 지운다.
 * 다른 곳이 남은 초안은 지우지 않는다 — 홈에서 "저장본에 합치기"로 골라 가져올 수 있다.
 */
export async function pruneDraftsFor(saved: WorldPackage, except?: string): Promise<{ removed: number; kept: number }> {
  const { diffWorlds } = await import('../gm/worldDiff');
  let removed = 0, kept = 0;
  for (const d of await listEditorDrafts()) {
    if (d.id === except || d.world.manifest.id !== saved.manifest.id) continue;
    if (!diffWorlds(saved, d.world, d.origin).length) { await deleteEditorDraft(d.id); removed++; } else kept++;
  }
  return { removed, kept };
}
