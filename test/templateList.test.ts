import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Controller, type Host } from '../src/controller.ts';
import { COPY } from '../src/core/copy.ts';
import { planFlipbooks } from '../src/core/flipbooks.ts';
import { planExistingFlipbooks } from '../src/core/registerFlipbooks.ts';
import { keys, memoryKV, Store } from '../src/core/store.ts';
import { addTemplate, removeTemplate, setCurrentTemplate, setRepresentativeTemplate, templateEntries, templateForItem } from '../src/core/templateList.ts';
import type { TemplateInfo, TemplateItem } from '../src/core/templateParts.ts';
import type { ToUi } from '../src/core/wire.ts';

// 템플릿 목록(2026-11-02 사용자 결정): 템플릿을 목록 하나로 두고 대표를 지정한다. 새 플립북은 대표로 만들고,
// 대표를 바꾸면 이전 대표는 대표 바로 아래에 남는다. 반영할 때 대표가 아닌 템플릿을 위부터 넘긴다.
// 대표가 아닌 템플릿도 항목별로 연결하되, 이미 있는 플립북 반영에 쓰는 항목만 받는다.
const actor = { id: 'u', name: 'Designer' };

test('대표를 바꾸면 이전 대표를 대표 바로 아래에 남기고 새 대표는 나머지에서 뺀다', () => {
  const store = new Store(memoryKV());
  assert.deepEqual(store.state.project.previousTemplates, [], '이전 형식 파일은 빈 목록으로 읽는다');
  let project = setCurrentTemplate(store.state.project, { id: 'v1', name: 'V1' });
  assert.deepEqual(project.previousTemplates, []);
  project = setCurrentTemplate(project, { id: 'v2', name: 'V2' });
  project = setCurrentTemplate(project, { id: 'v3', name: 'V3' });
  assert.deepEqual(templateEntries(project).map(t => [t.nodeId, t.representative]), [['v3', true], ['v2', false], ['v1', false]]);
  project = setRepresentativeTemplate(project, 'v1');
  assert.deepEqual(templateEntries(project).map(t => [t.nodeId, t.name, t.representative]), [['v1', 'V1', true], ['v3', 'V3', false], ['v2', 'V2', false]]);
  assert.equal(setRepresentativeTemplate(project, 'v1'), project, '이미 대표인 템플릿은 그대로 둔다');
  assert.throws(() => setRepresentativeTemplate(project, 'nope'), new Error(COPY.templateNotListed));
});

test('목록이 비었으면 처음 더한 템플릿이 대표가 되고, 그다음부터는 대표 바로 아래에 더하며 대표는 뺄 수 없다', () => {
  let project = addTemplate(new Store(memoryKV()).state.project, { id: 'cur', name: 'Current' });
  assert.equal(project.templateNodeId, 'cur');
  project = addTemplate(project, { id: 'a', name: 'A' });
  project = addTemplate(project, { id: 'b', name: 'B' });
  project = addTemplate(project, { id: 'a', name: 'A2' });
  assert.deepEqual(templateEntries(project).map(t => t.nodeId), ['cur', 'a', 'b'], '이미 있으면 대표 바로 아래로 옮긴다');
  assert.equal(project.previousTemplates[0].name, 'A2');
  assert.throws(() => addTemplate(project, { id: 'cur', name: 'Current' }), new Error(COPY.templateAddIsRepresentative));
  assert.throws(() => removeTemplate(project, 'cur'), new Error(COPY.templateRemoveRepresentative));
  assert.deepEqual(templateEntries(removeTemplate(project, 'a')).map(t => t.nodeId), ['cur', 'b']);
});

test('대표가 아닌 템플릿은 반영에 쓰는 항목(화면 이름·Chapter·컴포넌트·이력 행 안의 칸)만 연결한다', () => {
  const project = addTemplate(addTemplate(new Store(memoryKV()).state.project, { id: 'cur', name: 'C' }), { id: 'old', name: 'O' });
  for (const key of ['title', 'chapter', 'idTag', 'row', 'statusTag', 'rowStatusTag', 'rowStatus', 'rowComment', 'rowWorker', 'rowDate', 'rowTeam'] as TemplateItem[]) {
    assert.equal(templateForItem(project, 'old', key), 'old', key);
  }
  for (const key of ['status', 'ids', 'gui', 'description', 'history', 'previous', 'pdfHidden'] as TemplateItem[]) {
    assert.throws(() => templateForItem(project, 'old', key), new Error(COPY.templateItemNotUsed), key);
    assert.equal(templateForItem(project, 'cur', key), 'cur', `대표는 ${key}도 연결한다`);
  }
  assert.throws(() => templateForItem(project, 'nope', 'title'), new Error(COPY.templateNotListed));
  assert.throws(() => templateForItem(new Store(memoryKV()).state.project, 'cur', 'title'), new Error(COPY.controller053));
});

test('목록의 템플릿 프레임은 기존 플립북으로 등록할 수 없다', () => {
  const store = new Store(memoryKV());
  store.saveProject({ ...addTemplate(addTemplate(store.state.project, { id: 'cur', name: 'C' }), { id: 'old', name: 'O' }), flipbookPageIds: ['ui'] });
  assert.throws(() => planExistingFlipbooks(store.state, [{ nodeId: 'old', pageId: 'ui', title: 'Old', flipbookId: null }], actor, 1), new Error(COPY.registerExistingTemplate));
});

test('관리에서 템플릿을 더하고 대표를 바꾸고 빼면 저장하고, 반영할 때 대표가 아닌 템플릿을 위부터 넘긴다', async () => {
  const store = new Store(memoryKV());
  store.saveProject({ ...store.state.project, flipbookPageIds: ['ui'], flipbookPageId: 'ui' });
  for (const fb of planFlipbooks({ pageId: 'ui', rows: [{ uids: [], multi: false, scale: 1, title: '정책 A' }] }, new Map(), actor, 1000, () => 'fb1')) {
    store.put(keys.flipbook(fb.id), { ...fb, category: { key: 'home', name: '홈', order: 1 } });
  }
  let picked = { id: 'v1', name: 'V1' };
  const settings: { templateId: string; fallbackTemplateIds?: string[] }[] = [];
  const posted: ToUi[] = [];
  const info = (id: string): TemplateInfo => ({ id, name: id, pageName: 'P', items: [], error: null });
  const host = {
    kv: store.kv, mode: 'UI', actor, post: (m: ToUi) => posted.push(m), pages: () => [{ id: 'ui', name: 'UI' }], selectionNodeIds: () => [],
    templateFromSelection: async () => picked,
    templateIssues: async () => [],
    describeTemplate: async (id: string) => info(id),
    inspectFlipbooks: async () => ({ found: new Map([['fb1', '1:1']]), spots: { '1:1': { pageId: 'ui', section: 'home', sectionName: '홈', sectionIndex: 0, index: 0 } } }),
    listFlipbooks: async () => new Map(),
    syncFlipbook: async (s: { templateId: string; fallbackTemplateIds?: string[] }) => { settings.push(s); return { nodeId: '1:1', notes: [] }; },
    ensureDataPage: async () => 'data', renderData: async () => {},
  } as unknown as Host;
  const controller = new Controller(host);
  const lastInfo = () => (posted.filter(m => m.type === 'templateInfo').slice(-1)[0] as Extract<ToUi, { type: 'templateInfo' }> | undefined)?.info?.id;
  await controller.handle({ type: 'admin', action: { op: 'addTemplate' } });
  assert.equal(controller.store.state.project.templateNodeId, 'v1', '목록이 비었으면 대표가 된다');
  picked = { id: 'v2', name: 'V2' };
  await controller.handle({ type: 'admin', action: { op: 'addTemplate' } });
  assert.equal(lastInfo(), 'v2', '더한 템플릿의 연결 항목을 보여 준다');
  await controller.handle({ type: 'admin', action: { op: 'setRepresentativeTemplate', nodeId: 'v2' } });
  assert.equal(controller.store.state.project.templateNodeId, 'v2');
  assert.deepEqual(controller.store.state.project.previousTemplates, [{ nodeId: 'v1', name: 'V1' }]);
  picked = { id: 'v0', name: 'V0' };
  await controller.handle({ type: 'admin', action: { op: 'addTemplate' } });
  assert.deepEqual(controller.store.state.project.previousTemplates.map(t => t.nodeId), ['v0', 'v1']);
  await controller.handle({ type: 'templateInfo', templateId: 'v1' });
  assert.equal(lastInfo(), 'v1', '고른 템플릿의 연결 항목');
  await controller.handle({ type: 'templateInfo', templateId: 'gone' });
  assert.equal(lastInfo(), 'v2', '목록에 없으면 대표');
  await controller.handle({ type: 'renameFlipbook', id: 'fb1', title: '새 제목' });
  assert.deepEqual(settings.map(s => [s.templateId, s.fallbackTemplateIds]), [['v2', ['v0', 'v1']]]);
  await controller.handle({ type: 'admin', action: { op: 'removeTemplate', nodeId: 'v0' } });
  assert.deepEqual(controller.store.state.project.previousTemplates.map(t => t.nodeId), ['v1']);
  assert.ok(!posted.some(m => m.type === 'error'), JSON.stringify(posted.filter(m => m.type === 'error')));
  await controller.handle({ type: 'admin', action: { op: 'removeTemplate', nodeId: 'v2' } });
  assert.equal(controller.store.state.project.templateNodeId, 'v2', '대표는 빼지 않는다');
  assert.deepEqual(posted.filter(m => m.type === 'error').map(m => (m as { message: string }).message), [COPY.templateRemoveRepresentative]);
});

test('대표가 아닌 템플릿의 항목도 연결·해제·보기를 그 템플릿에 하고, 반영에 쓰지 않는 항목은 받지 않는다', async () => {
  const store = new Store(memoryKV());
  store.saveProject(addTemplate(addTemplate(store.state.project, { id: 'cur', name: 'C' }), { id: 'old', name: 'O' }));
  const calls: string[] = [];
  const issuesFor: (string | null)[] = [];
  const posted: ToUi[] = [];
  const host = {
    kv: store.kv, mode: 'UI', actor, post: (m: ToUi) => posted.push(m), pages: () => [], selectionNodeIds: () => [],
    templateIssues: async (id: string | null) => { issuesFor.push(id); return []; },
    describeTemplate: async (id: string): Promise<TemplateInfo> => ({ id, name: id, pageName: '', items: [], error: null }),
    connectTemplateItem: async (id: string, key: string) => { calls.push(`connect ${id} ${key}`); },
    disconnectTemplateItem: async (id: string, key: string) => { calls.push(`disconnect ${id} ${key}`); },
    templateItemNodes: async (id: string, key: string) => { calls.push(`nodes ${id} ${key}`); return [`${id}:${key}`]; },
    selectNodes: async (ids: string[]) => { calls.push(`select ${ids.join(',')}`); },
    reveal: async () => true,
  } as unknown as Host;
  const controller = new Controller(host);
  await controller.handle({ type: 'admin', action: { op: 'connectTemplateItem', templateId: 'old', key: 'statusTag' } });
  await controller.handle({ type: 'admin', action: { op: 'disconnectTemplateItem', templateId: 'old', key: 'rowTeam' } });
  await controller.handle({ type: 'revealTemplateItem', nav: 1, templateId: 'old', key: 'row' });
  assert.deepEqual(calls, ['connect old statusTag', 'disconnect old rowTeam', 'nodes old row', 'select old:row']);
  assert.deepEqual(issuesFor, [], '대표가 아닌 템플릿을 바꿔도 대표 템플릿 경고는 다시 확인하지 않는다');
  assert.ok(posted.filter(m => m.type === 'templateInfo').every(m => (m as Extract<ToUi, { type: 'templateInfo' }>).info?.id === 'old'));
  await controller.handle({ type: 'admin', action: { op: 'connectTemplateItem', templateId: 'old', key: 'gui' } });
  await controller.handle({ type: 'admin', action: { op: 'connectTemplateItem', templateId: 'cur', key: 'gui' } });
  assert.deepEqual(calls.slice(4), ['connect cur gui'], '대표가 아닌 템플릿의 GUI 영역은 받지 않는다');
  assert.deepEqual(issuesFor, ['cur']);
  assert.deepEqual(posted.filter(m => m.type === 'error').map(m => (m as { message: string }).message), [COPY.templateItemNotUsed]);
});
