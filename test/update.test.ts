import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cacheFresh, compareVersions, latestTag, needsUpdate, readCache, UPDATE_CHECK_INTERVAL_MS } from '../src/core/update.ts';

test('버전은 숫자 단위로 비교한다', () => {
  assert.equal(compareVersions('v1.2.10', 'v1.2.9')! > 0, true);
  assert.equal(compareVersions('v1.3.0', '1.2.99')! > 0, true);
  assert.equal(compareVersions('v1.2.0', 'v1.2.0'), 0);
  assert.equal(compareVersions('v1.2.0-5-g9d5d360', 'v1.2.0'), null);
});

test('배포본이 최신 배포보다 낮을 때만 업데이트 알림을 띄운다', () => {
  assert.equal(needsUpdate({ current: 'v1.2.0', release: true, latest: 'v1.2.1' }), true);
  assert.equal(needsUpdate({ current: 'v1.2.1', release: true, latest: 'v1.2.1' }), false);
  assert.equal(needsUpdate({ current: 'v1.2.1', release: true, latest: 'v1.2.0' }), false);
  assert.equal(needsUpdate({ current: 'v1.2.0', release: true, latest: null }), false);
  // 개발 빌드는 배포되지 않은 코드라 최신 배포가 더 높아 보여도 알리지 않는다.
  assert.equal(needsUpdate({ current: 'v1.1.0-3-gabc1234', release: false, latest: 'v1.2.1' }), false);
  assert.equal(needsUpdate(null), false);
});

test('확인 결과는 한 시간 동안 다시 쓰고, 형식이 다른 저장값은 버린다', () => {
  const now = 10 * UPDATE_CHECK_INTERVAL_MS;
  assert.equal(cacheFresh({ latest: 'v1.2.0', checkedAt: now - UPDATE_CHECK_INTERVAL_MS + 1 }, now), true);
  assert.equal(cacheFresh({ latest: 'v1.2.0', checkedAt: now - UPDATE_CHECK_INTERVAL_MS }, now), false);
  // 시계가 뒤로 갔으면 다시 확인한다.
  assert.equal(cacheFresh({ latest: 'v1.2.0', checkedAt: now + 1000 }, now), false);
  assert.equal(cacheFresh(null, now), false);
  assert.deepEqual(readCache({ latest: 'v1.2.0', checkedAt: 5 }), { latest: 'v1.2.0', checkedAt: 5 });
  assert.equal(readCache({ latest: 'main', checkedAt: 5 }), null);
  assert.equal(readCache('v1.2.0'), null);
  assert.equal(latestTag({ tag_name: 'v1.2.3', name: 'GUI·UI Publish v1.2.3' }), 'v1.2.3');
  assert.equal(latestTag({ message: 'API rate limit exceeded' }), null);
});
