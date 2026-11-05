// 캔버스에서 숨긴 화면(관리 → 숨긴 화면)의 프레임을 고르면 목록 선택을 풀고 상세 가운데에 안내와 「다시 표시」를 보인다.
// 다시 표시하면 그 프레임이 신규 후보로 목록에 돌아와 선택된다(BEHAVIOR.md 「변경사항 확인과 화면 목록」, 2026-11-05 사용자 요청).
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1550, height: 820 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const app = page.locator('#app');
const NAME = '버튼 모음 (화면 아님)';
const pick = async nodeId => page.locator(`#tools [data-pick-gui="${nodeId}"]`).click();
try {
  await page.goto(pathToFileURL('tmp/build/preview.html').href);
  await app.locator('[data-action=scan]').click();
  await page.waitForFunction(() => document.querySelector('#app .toolbar .progress')?.textContent?.includes('마지막 검토'));
  for (const head of await app.locator('.group-head[aria-expanded=false]').all()) await head.click();
  const row = app.locator('.list .row').filter({ hasText: NAME });
  await row.click();
  await row.locator('[data-action=include]').check();
  await app.locator('[data-field=disposition][value=not-screen]').check();
  await app.locator('[data-action=prepare]').click();
  await app.locator('[data-action=commit]').click();
  await page.waitForFunction(n => ![...document.querySelectorAll('#app .list .row')].some(r => r.textContent.includes(n)), NAME);
  const nodeId = await page.evaluate(n => [...document.querySelectorAll('#tools .frame')]
    .find(f => f.querySelector('span').textContent === n).querySelector('[data-pick-gui]').dataset.pickGui, NAME);
  const other = await page.locator('#tools [data-pick-gui]').first().getAttribute('data-pick-gui');

  // 다른 화면을 고른 상태에서 숨긴 프레임을 고르면 목록 선택을 풀고 안내를 보인다.
  await pick(other);
  await app.locator('.list .row.selected').waitFor();
  await pick(nodeId);
  await app.locator('.excluded-hint [data-action=excluded-unexclude]').waitFor();
  assert.equal(await app.locator('.list .row.selected').count(), 0, '숨긴 프레임을 고르면 목록 선택을 푼다');
  assert.equal(await app.locator('.excluded-hint p').innerText(), '목록에서 숨긴 화면입니다.');

  // 목록에 있는 화면을 고르면 안내를 거둔다.
  await pick(other);
  await app.locator('.list .row.selected').waitFor();
  assert.equal(await app.locator('.excluded-hint').count(), 0, '목록 화면을 고르면 안내를 거둔다');

  // 관리를 보던 중에 골라도 목록 화면으로 돌아와 안내를 보이고, 다시 표시하면 신규 후보로 돌아와 선택된다.
  await app.locator('[data-action=settings]').click();
  await page.locator('.admin-nav').waitFor();
  await pick(nodeId);
  await app.locator('.excluded-hint').waitFor();
  await app.locator('[data-action=excluded-unexclude]').click();
  await page.waitForFunction(n => document.querySelector('#app .list .row.selected')?.textContent.includes(n), NAME);
  assert.equal(await app.locator('.excluded-hint').count(), 0, '다시 표시하면 안내 대신 그 화면을 보인다');
  assert.equal(await app.locator('.list .row.selected').count(), 1);

  assert.deepEqual(errors, []);
  console.log('Exclusion regressions: picking a hidden frame shows the centered notice; 다시 표시 returns and selects it');
} finally { await browser.close(); }
