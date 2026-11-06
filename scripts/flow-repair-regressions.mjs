import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { Store, memoryKV, keys } from '../src/core/store.ts';
import { toUiWire } from '../src/core/wire.ts';
import { COPY as BASE } from '../src/core/copy.ts';
import { FLOW_REPAIR_COPY as COPY } from '../src/core/flowRepairCopy.ts';

const store = new Store(memoryKV());
for (const [id, code, name] of [['s2', 'ST_VP_010', 'Player Controls'], ['s1', 'ST_VP_002', 'Content Warning']])
  store.put(keys.screen(id), { id, rev: 1, code, name, categoryId: null, baseScreenId: null, status: 'active', source: null, guiVersion: 2, guiTag: null, createdAt: 1 });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 720, height: 600 } });
const errors = []; page.on('pageerror', e => errors.push(e.stack ?? e.message));
try {
  await page.addInitScript(() => {
    window.requests = [];
    window.addEventListener('message', e => {
      const m = e.data?.pluginMessage;
      if (m?.type === 'findFlowRepairs' || m?.type === 'restoreFlowImages') { window.requests.push(m); e.stopImmediatePropagation(); }
      else if ((m?.type === 'pages' && !('pages' in m)) || (m?.type === 'templateInfo' && !('info' in m)) || (m?.type === 'guiScreens' && !('screens' in m)) || (m?.type === 'thumbnails' && !('items' in m)) || (m?.type === 'history' && !('rows' in m))) e.stopImmediatePropagation();
    }, true);
  });
  await page.goto(pathToFileURL('tmp/build/ui.html').href);
  const send = msg => page.evaluate(m => window.postMessage({ pluginMessage: m }, '*'), msg);
  await send({ type: 'init', mode: 'UI', actor: { id: 'u', name: 'User' }, pages: [{ id: 'p', name: 'Page' }], issues: [], state: toUiWire(store.state) });
  await send({ type: 'startupReady' });
  await page.locator('[data-action=settings]').click();
  await page.locator('.admin-nav-item').filter({ hasText: BASE.adminMaintenance }).click();
  await page.locator('[data-action=flow-repair-find]').click();
  const dialog = page.locator('.flow-repair-overlay');
  await dialog.getByText(COPY.scanning).waitFor();
  const candidates = ['a', 'b'].map((nodeId, i) => ({ nodeId, pageId: 'p', name: i ? 'Disconnected image' : 'Marked image', flowId: i ? '' : 'f', uid: i ? '' : 's1', stamp: 'original', assignedUid: i ? null : 's1' }));
  await send({ type: 'flowRepairCandidates', token: 'scan-1', candidates });
  const submit = dialog.locator('[data-action=flow-repair-submit]');
  assert.equal(await submit.isDisabled(), true);
  assert.equal(await dialog.locator('.id-tag').first().innerText(), 'ST_VP_002');
  const picker = dialog.locator('.screen-picker').nth(1);
  await picker.locator('summary').click();
  assert.deepEqual(await picker.locator('.tag-option .id-tag').allTextContents(), ['ST_VP_002', 'ST_VP_010']);
  await picker.locator('.picker-search').fill('controls');
  assert.equal(await picker.locator('.tag-option:visible').count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), true);
  await picker.locator('summary').click();
  await picker.locator('.picker-search').fill('ST_VP_010');
  await page.keyboard.press('Enter');
  assert.equal(await submit.isDisabled(), false);
  mkdirSync('tmp/flow-repair', { recursive: true });
  await page.screenshot({ path: 'tmp/flow-repair/dialog.png' });
  await submit.click();
  await dialog.getByText(COPY.running).waitFor();
  assert.equal(await dialog.locator('[data-action=flow-repair-close]').isDisabled(), true);
  await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), true);
  await page.waitForFunction(() => window.requests.length === 2);
  assert.deepEqual(await page.evaluate(() => window.requests), [{ type: 'findFlowRepairs' }, { type: 'restoreFlowImages', token: 'scan-1', assignments: [{ nodeId: 'a', uid: 's1' }, { nodeId: 'b', uid: 's2' }] }]);
  await send({ type: 'flowRepairDone', result: { restored: ['a'], failed: [{ nodeId: 'b', message: 'Image changed' }] } });
  await dialog.getByText('Image changed').waitFor();
  assert.equal(await dialog.locator('.screen-picker').count(), 1);
  await dialog.locator('[data-action=flow-repair-find]').click();
  await send({ type: 'flowRepairCandidates', token: 'scan-2', candidates: [] });
  await dialog.getByText(COPY.empty).waitFor();
  assert.equal(await submit.isDisabled(), true);
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log('Flow repair: automatic/manual assignment, shared ID/search dropdown, keyboard, partial failure, empty selection and busy state passed.');
} finally { await browser.close(); }
