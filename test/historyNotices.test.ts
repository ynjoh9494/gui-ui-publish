import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beginHistoryWindow, inHistoryWindow } from '../src/core/historyNotices.ts';

test('실행 시 사용자·파일별 이전 실행 경계를 읽고 다음 실행 기준을 저장한다', async () => {
  const data = new Map<string, unknown>();
  const storage = { getAsync: async (key: string) => data.get(key), setAsync: async (key: string, value: unknown) => { data.set(key, value); } };
  assert.deepEqual(await beginHistoryWindow(storage, 'user:file', 100), { since: null, until: 100 });
  const session = await beginHistoryWindow(storage, 'user:file', 200);
  assert.deepEqual(session, { since: 100, until: 200 });
  assert.deepEqual([100, 101, 200, 201].map(at => inHistoryWindow(at, session)), [false, true, true, false]);
  assert.equal(inHistoryWindow(150, session), true, '같은 실행 중에는 확인하거나 다시 펼쳐도 경계가 바뀌지 않는다');
  const next = await beginHistoryWindow(storage, 'user:file', 300);
  assert.equal(inHistoryWindow(150, next), false, '다음 실행에는 지난번에 알린 행을 다시 알리지 않는다');
  assert.equal(inHistoryWindow(250, next), true);
  assert.deepEqual(await beginHistoryWindow(storage, 'another:file', 400), { since: null, until: 400 });
});

test('처음 실행하거나 저장한 시각이 잘못된 경우 과거 히스토리를 한꺼번에 알리지 않는다', async () => {
  for (const value of [undefined, '100', NaN, -1, 500]) {
    const window = await beginHistoryWindow({ getAsync: async () => value, setAsync: async () => {} }, 'file', 200);
    assert.equal(window.since, null);
    assert.equal(inHistoryWindow(150, window), false);
  }
  const window = await beginHistoryWindow({ getAsync: async () => { throw new Error('unavailable'); }, setAsync: async () => { throw new Error('unavailable'); } }, 'file', 200);
  assert.equal(window.since, null);
});
