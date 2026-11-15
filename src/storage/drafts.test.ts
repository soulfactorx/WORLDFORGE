import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { blankWorld } from './packages';
import { deleteEditorDraft, getEditorDraft, listEditorDrafts, saveEditorDraft, wizardHasContent } from './drafts';
import { blankDraft } from '../gm/wizard';

describe('만들던 것 지키기 (v0.126)', () => {
  it('편집 초안을 보관·불러오기·지우기', async () => {
    const w = { ...blankWorld(), manifest: { ...blankWorld().manifest, name: '안개 마을' } };
    await saveEditorDraft('new.abc', w, ['메모']);
    await new Promise((r) => setTimeout(r, 5));
    await saveEditorDraft('me.other', { ...w, manifest: { ...w.manifest, name: '두 번째' } });
    expect((await getEditorDraft('new.abc'))).toMatchObject({ name: '안개 마을', notes: ['메모'] });
    expect((await listEditorDrafts()).map((d) => d.name)).toEqual(['두 번째', '안개 마을']);
    await deleteEditorDraft('new.abc');
    expect(await getEditorDraft('new.abc')).toBeUndefined();
  });
  it('빈 마법사 초안은 이어서 할 것이 없다', () => {
    expect(wizardHasContent(blankDraft())).toBe(false);
    expect(wizardHasContent({ ...blankDraft(), name: '세계' })).toBe(true);
  });
});
