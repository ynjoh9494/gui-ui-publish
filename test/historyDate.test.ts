import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Controller, type Host } from '../src/controller.ts';
import { COPY } from '../src/core/copy.ts';
import { flipbookView, formatShort, guiAppendRows } from '../src/core/flipbook.ts';
import { planFlipbooks } from '../src/core/flipbooks.ts';
import { flipbookHistoryRows } from '../src/core/history.ts';
import { ensureSystemTags } from '../src/core/registry.ts';
import { keys, memoryKV, Store } from '../src/core/store.ts';
import type { AdminOp, ToUi } from '../src/core/wire.ts';

const actor = { id: 'user', name: 'Designer' };
const at = Date.UTC(2026, 11, 31, 15, 4, 5);

test('템플릿 날짜는 프로젝트 시간대의 연도·날짜 경계와 기존 시분 형식을 따른다', () => {
  assert.equal(formatShort(at, 540), '27.01.01');
  assert.equal(formatShort(at, -480), '26.12.31');
  assert.equal(formatShort(at, 540, 'MM/DD HH:mm'), '01/01 00:04');
});

test('날짜 형식은 파일에 저장하며 구형 파일의 기본 형식과 원기록을 보존한다', async () => {
  const kv = memoryKV({ project: JSON.stringify({ utcOffsetMinutes: 540, guiWidth: 1200 }) });
  const messages: ToUi[] = [];
  const controller = new Controller({ kv, actor, post: (msg: ToUi) => { messages.push(msg); } } as unknown as Host);
  assert.equal(controller.store.state.project.historyDateFormat, 'YY.MM.DD');
  const store = controller.store;
  ensureSystemTags(store, actor);
  const [fb] = planFlipbooks({ pageId: 'page', rows: [{ uids: [], scale: 1, multi: false, title: 'Policy' }] }, new Map(), actor, at, () => 'fb');
  store.put(keys.flipbook(fb.id), { ...fb, tracked: true });
  assert.equal(flipbookView(store.state, fb.id).status?.at, '27.01.01');
  store.put(keys.ui(fb.id, 1), {
    flipbookId: fb.id, version: 1, batchId: 'batch',
    tag: { id: 'tag', name: 'Tag', color: '#000000', colorKey: 'Black' },
    description: 'Reviewed', worker: actor, actor, committedAt: at, extra: {}, corrections: [],
  });
  store.put(keys.gui('screen', 1), { ...store.state.ui.get(fb.id)![0], screenId: 'screen' });
  const appendedAt = (s: typeof store.state) => guiAppendRows(s, [{ uid: 'screen', version: 1 }])[0].at;
  const record = kv.get(keys.ui(fb.id, 1));
  const history = flipbookHistoryRows(store.state, fb.id);
  assert.equal(appendedAt(store.state), '27.01.01');
  await controller.handle({ type: 'admin', action: { op: 'setHistoryDateFormat', format: 'MM/DD HH:mm' } });
  const reloaded = new Store(kv);
  assert.equal(reloaded.state.project.historyDateFormat, 'MM/DD HH:mm');
  assert.equal(reloaded.state.project.guiWidth, 1200);
  assert.equal(appendedAt(reloaded.state), '01/01 00:04');
  assert.equal(flipbookView(reloaded.state, fb.id).status?.at, '01/01 00:04');
  assert.equal(kv.get(keys.ui(fb.id, 1)), record);
  assert.deepEqual(flipbookHistoryRows(reloaded.state, fb.id), history);
  const auditCount = reloaded.state.audit.length;
  await controller.handle({ type: 'admin', action: { op: 'setHistoryDateFormat', format: 'MM/DD HH:mm' } });
  assert.equal(new Store(kv).state.audit.length, auditCount);
  await controller.handle({ type: 'admin', action: { op: 'setHistoryDateFormat', format: 'invalid' } as unknown as AdminOp });
  assert.equal(new Store(kv).state.project.historyDateFormat, 'MM/DD HH:mm');
  assert.ok(messages.some(msg => msg.type === 'error' && msg.message === COPY.historyDateInvalid));
  await controller.handle({ type: 'admin', action: { op: 'setHistoryDateFormat', format: 'YY.MM.DD' } });
  assert.equal(appendedAt(new Store(kv).state), '27.01.01');
});
