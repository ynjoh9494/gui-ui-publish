// 여러 화면을 한 번에 켜고 끄는 컨트롤(「모두 배포하기」·묶음 체크·상세 배포 스위치)은
// 일부만 켜진 중간 상태에서 누르면 모두 끈다(BEHAVIOR.md 「GUI 목록」).
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const app = page.locator('#app');
const read = sel => (typeof sel === 'string' ? app.locator(sel) : sel).first().evaluate(el => el.indeterminate ? 'mixed' : el.checked ? 'on' : 'off');
// 목록은 다음 프레임에 다시 그린다. 기대한 상태가 될 때까지 잠시 기다린 뒤 확인한다.
const state = async (sel, want) => { for (let i = 0; i < 20 && await read(sel) !== want; i++) await page.waitForTimeout(50); return read(sel); };
const rowStates = rows => Promise.all(rows.map(row => row.locator('[data-action=include]').isChecked()));
try {
  await page.goto(pathToFileURL('tmp/build/preview.html').href);
  await app.locator('[data-action=scan]').click();
  await page.waitForFunction(() => document.querySelector('#app .toolbar .progress')?.textContent?.includes('마지막 검토'));
  for (const head of await app.locator('.group-head[aria-expanded=false]').all()) await head.click();
  await app.locator('.row').first().waitFor();
  const master = '.list [data-action=include-all]';
  const enabled = async () => {
    const all = [];
    for (const row of await app.locator('.row').all()) if (await row.locator('[data-action=include]').isEnabled()) all.push(row);
    return all;
  };
  let rows = await enabled();
  assert.ok(rows.length >= 3, `바꿀 수 있는 화면이 3개 이상 필요: ${rows.length}`);

  // 「모두 배포하기」: 일부 → 모두 끔, 없음 → 모두 켬, 모두 → 모두 끔
  await rows[0].locator('[data-action=include]').check();
  assert.equal(await state(master, 'mixed'), 'mixed');
  await app.locator(master).click();
  rows = await enabled();
  assert.ok((await rowStates(rows)).every(v => !v), '중간 상태의 모두 배포하기는 모두 끈다');
  assert.equal(await state(master, 'off'), 'off');
  await app.locator(master).click();
  rows = await enabled();
  assert.ok((await rowStates(rows)).every(v => v), '하나도 없으면 모두 켠다');
  assert.equal(await state(master, 'on'), 'on');
  await app.locator(master).click();
  rows = await enabled();
  assert.ok((await rowStates(rows)).every(v => !v), '모두 켜졌으면 모두 끈다');

  // 묶음 머리 체크
  const group = app.locator('.group').filter({ has: page.locator('.row [data-action=include]:enabled') }).filter({ has: page.locator('.row + .row') }).first();
  const groupRows = await group.locator('.row').all();
  await groupRows[0].locator('[data-action=include]').check();
  const groupBox = group.locator('[data-action=include-group]');
  assert.equal(await state(groupBox, 'mixed'), 'mixed');
  await group.locator('[data-action=include-group]').click();
  assert.equal(await state(groupBox, 'off'), 'off');
  assert.ok((await rowStates(groupRows)).every(v => !v), '중간 상태의 묶음 체크는 묶음을 모두 끈다');

  // 여러 화면을 고른 상세의 배포 스위치
  rows = await enabled();
  await rows[0].click();
  await rows[1].click({ modifiers: ['ControlOrMeta'] });
  await rows[0].locator('[data-action=include]').check();
  const sw = '.detail [data-action=include-selected]';
  assert.equal(await state(sw, 'mixed'), 'mixed');
  await app.locator(sw).click();
  assert.equal(await state(sw, 'off'), 'off');
  rows = await enabled();
  assert.deepEqual((await rowStates(rows.slice(0, 2))), [false, false], '중간 상태의 배포 스위치는 고른 화면을 모두 끈다');
  await app.locator(sw).click();
  assert.equal(await state(sw, 'on'), 'on');

  assert.deepEqual(errors, []);
  console.log('Include toggle regressions: mixed state turns all off for all-include, group and detail switch');
} finally { await browser.close(); }
