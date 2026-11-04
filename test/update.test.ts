import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareVersions, fileVersionRecord, needsUpdate, readFileVersion, versionToRecord } from '../src/core/update.ts';

test('버전은 숫자 단위로 비교한다', () => {
  assert.equal(compareVersions('v1.2.10', 'v1.2.9')! > 0, true);
  assert.equal(compareVersions('v1.3.0', '1.2.99')! > 0, true);
  assert.equal(compareVersions('v1.2.0', 'v1.2.0'), 0);
  assert.equal(compareVersions('v1.2.0-5-g9d5d360', 'v1.2.0'), null);
});

test('배포본이 파일에 기록된 최신 버전보다 낮을 때만 업데이트 알림을 띄운다', () => {
  assert.equal(needsUpdate({ current: 'v1.2.0', release: true, latest: 'v1.2.1' }), true);
  assert.equal(needsUpdate({ current: 'v1.2.1', release: true, latest: 'v1.2.1' }), false);
  assert.equal(needsUpdate({ current: 'v1.2.1', release: true, latest: 'v1.2.0' }), false);
  assert.equal(needsUpdate({ current: 'v1.2.0', release: true, latest: null }), false);
  // 개발 빌드는 배포되지 않은 코드라 기록이 더 높아 보여도 알리지 않는다.
  assert.equal(needsUpdate({ current: 'v1.1.0-3-gabc1234', release: false, latest: 'v1.2.1' }), false);
  assert.equal(needsUpdate(null), false);
});

test('파일 기록은 더 높은 배포 버전일 때만 올리고, 형식이 다른 기록은 없는 것으로 본다', () => {
  assert.equal(versionToRecord(null, 'v1.2.0'), 'v1.2.0');
  assert.equal(versionToRecord('v1.2.0', 'v1.2.1'), 'v1.2.1');
  assert.equal(versionToRecord('v1.2.1', 'v1.2.0'), null);
  assert.equal(versionToRecord('v1.2.1', 'v1.2.1'), null);
  // 태그가 없는 개발 빌드는 남기지 않는다.
  assert.equal(versionToRecord('v1.2.0', null), null);
  assert.equal(versionToRecord(null, 'dev'), null);
  assert.equal(readFileVersion(fileVersionRecord('v1.2.3', 5)), 'v1.2.3');
  assert.equal(readFileVersion(''), null);
  assert.equal(readFileVersion('{"version":"main"}'), null);
  assert.equal(readFileVersion('not json'), null);
});
