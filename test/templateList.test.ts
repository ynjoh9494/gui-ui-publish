import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Controller, type Host } from '../src/controller.ts';
import { COPY } from '../src/core/copy.ts';
import { planFlipbooks } from '../src/core/flipbooks.ts';
import { planExistingFlipbooks } from '../src/core/registerFlipbooks.ts';
import { keys, memoryKV, Store } from '../src/core/store.ts';
import { addPreviousTemplate, removePreviousTemplate, setCurrentTemplate } from '../src/core/templateList.ts';
import type { ToUi } from '../src/core/wire.ts';

// 템플릿 목록(2026-11-02 사용자 결정): 현재 템플릿을 바꾸면 바뀌기 전 템플릿이 이전 템플릿 맨 위에 남고,
// 이전 템플릿은 직접 더하고 뺄 수 있다. 반영할 때 이전 템플릿을 위부터 넘긴다.
const actor = { id: 'u', name: 'Designer' };

test('현재 템플릿을 바꾸면 바뀌기 전 템플릿을 이전 템플릿 맨 위에 남기고 새 현재 템플릿은 목록에서 뺀다', () => {
  const store = new Store(memoryKV());
  assert.deepEqual(store.state.project.previousTemplates, [], '이전 형식 파일은 빈 목록으로 읽는다');
  let project = setCurrentTemplate(store.state.project, { id: 'v1', name: 'V1' });
  assert.deepEqual(project.previousTemplates, []);
  project = setCurrentTemplate(project, { id: 'v2', name: 'V2' });
  project = setCurrentTemplate(project, { id: 'v3', name: 'V3' });
  assert.deepEqual(project.previousTemplates.map(t => t.nodeId), ['v2', 'v1']);
  project = setCurrentTemplate(project, { id: 'v1', name: 'V1' });
  assert.equal(project.templateNodeId, 'v1');
  assert.deepEqual(project.previousTemplates.map(t => t.nodeId), ['v3', 'v2']);
  assert.deepEqual(setCurrentTemplate(project, { id: 'v1', name: 'V1 renamed' }).previousTemplates, project.previousTemplates, '같은 템플릿을 다시 지정하면 목록을 바꾸지 않는다');
});

test('이전 템플릿은 맨 위에 더하고(이미 있으면 맨 위로 옮김) 현재 템플릿은 더할 수 없으며 목록에서 뺄 수 있다', () => {
  const base = setCurrentTemplate(new Store(memoryKV()).state.project, { id: 'cur', name: 'Current' });
  let project = addPreviousTemplate(base, { id: 'a', name: 'A' });
  project = addPreviousTemplate(project, { id: 'b', name: 'B' });
  project = addPreviousTemplate(project, { id: 'a', name: 'A2' });
  assert.deepEqual(project.previousTemplates, [{ nodeId: 'a', name: 'A2' }, { nodeId: 'b', name: 'B' }]);
  assert.throws(() => addPreviousTemplate(project, { id: 'cur', name: 'Current' }), new Error(COPY.templatePreviousIsCurrent));
  assert.deepEqual(removePreviousTemplate(project, 'a').previousTemplates, [{ nodeId: 'b', name: 'B' }]);
});

test('이전 템플릿 프레임도 기존 플립북으로 등록할 수 없다', () => {
  const store = new Store(memoryKV());
  store.saveProject({ ...addPreviousTemplate(setCurrentTemplate(store.state.project, { id: 'cur', name: 'C' }), { id: 'old', name: 'O' }), flipbookPageIds: ['ui'] });
  assert.throws(() => planExistingFlipbooks(store.state, [{ nodeId: 'old', pageId: 'ui', title: 'Old', flipbookId: null }], actor, 1), new Error(COPY.registerExistingTemplate));
});

test('관리에서 템플릿을 바꾸거나 이전 템플릿을 더하고 빼면 저장하고, 반영할 때 이전 템플릿을 위부터 넘긴다', async () => {
  const store = new Store(memoryKV());
  store.saveProject({ ...store.state.project, templateNodeId: 'v1', templateName: 'V1', flipbookPageIds: ['ui'], flipbookPageId: 'ui' });
  for (const fb of planFlipbooks({ pageId: 'ui', rows: [{ uids: [], multi: false, scale: 1, title: '정책 A' }] }, new Map(), actor, 1000, () => 'fb1')) {
    store.put(keys.flipbook(fb.id), { ...fb, category: { key: 'home', name: '홈', order: 1 } });
  }
  let picked = { id: 'v2', name: 'V2' };
  const settings: { templateId: string; fallbackTemplateIds?: string[] }[] = [];
  const posted: ToUi[] = [];
  const host = {
    kv: store.kv, mode: 'UI', actor, post: (m: ToUi) => posted.push(m), pages: () => [{ id: 'ui', name: 'UI' }], selectionNodeIds: () => [],
    templateFromSelection: async () => picked,
    templateIssues: async () => [],
    inspectFlipbooks: async () => ({ found: new Map([['fb1', '1:1']]), spots: { '1:1': { pageId: 'ui', section: 'home', sectionName: '홈', sectionIndex: 0, index: 0 } } }),
    listFlipbooks: async () => new Map(),
    syncFlipbook: async (s: { templateId: string; fallbackTemplateIds?: string[] }) => { settings.push(s); return { nodeId: '1:1', notes: [] }; },
    ensureDataPage: async () => 'data', renderData: async () => {},
  } as unknown as Host;
  const controller = new Controller(host);
  await controller.handle({ type: 'admin', action: { op: 'setTemplateFromSelection' } });
  assert.equal(controller.store.state.project.templateNodeId, 'v2');
  assert.deepEqual(controller.store.state.project.previousTemplates, [{ nodeId: 'v1', name: 'V1' }]);
  picked = { id: 'v0', name: 'V0' };
  await controller.handle({ type: 'admin', action: { op: 'addPreviousTemplate' } });
  assert.deepEqual(controller.store.state.project.previousTemplates.map(t => t.nodeId), ['v0', 'v1']);
  await controller.handle({ type: 'renameFlipbook', id: 'fb1', title: '새 제목' });
  assert.deepEqual(settings.map(s => [s.templateId, s.fallbackTemplateIds]), [['v2', ['v0', 'v1']]]);
  await controller.handle({ type: 'admin', action: { op: 'removePreviousTemplate', nodeId: 'v0' } });
  assert.deepEqual(controller.store.state.project.previousTemplates.map(t => t.nodeId), ['v1']);
  assert.ok(!posted.some(m => m.type === 'error'), JSON.stringify(posted.filter(m => m.type === 'error')));
});
