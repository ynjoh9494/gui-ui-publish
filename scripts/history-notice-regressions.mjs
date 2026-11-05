import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { Store, keys, memoryKV } from '../src/core/store.ts';
import { planFlipbooks } from '../src/core/flipbooks.ts';
import { toUiWire } from '../src/core/wire.ts';

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  const actor = { id: 'user', name: 'Designer' };
  const store = new Store(memoryKV());
  store.saveProject({ ...store.state.project, flipbookPageIds: ['page'] });
  let sequence = 0;
  for (const fb of planFlipbooks({ pageId: 'page', rows: [{ uids: [], multi: false, scale: 1, title: 'First' }, { uids: [], multi: false, scale: 1, title: 'Other' }] }, new Map(), actor, 1, () => 'fb' + ++sequence))
    store.put(keys.flipbook(fb.id), { ...fb, tracked: true, screens: fb.id === 'fb1' ? [{ uid: 'screen', code: 'HO_001', name: 'Home', version: 1 }] : [] });
  const state = toUiWire(store.state);
  await page.addInitScript(() => {
    window.requests = [];
    window.addEventListener('message', event => {
      const msg = event.data?.pluginMessage;
      if (msg && ['flipbookDescription', 'followFlipbook', 'history', 'guiScreens'].includes(msg.type) && !('paragraphs' in msg) && !('screens' in msg)) { window.requests.push(msg); event.stopImmediatePropagation(); }
    }, true);
  });
  await page.goto(pathToFileURL('tmp/build/ui.html').href);
  const send = msg => page.evaluate(msg => window.postMessage({ pluginMessage: msg }, '*'), msg);
  const init = async () => {
    await send({ type: 'init', mode: 'UI', actor, pages: [{ id: 'page', name: 'Pages' }], issues: [], state });
    await send({ type: 'startupReady' });
    await send({ type: 'uiScan', scans: ['fb1', 'fb2'].map(id => ({ flipbookId: id, nodeId: 'node-' + id, fingerprint: null, error: null })) });
    await page.locator('[data-action=page-group]').first().waitFor();
    for (const head of await page.locator('[data-action=page-group]').all()) if (await head.getAttribute('aria-expanded') === 'false') await head.click();
  };
  await init();
  await send({ type: 'historyNotices', items: [['fb1', [
    { key: 'GUI:one', at: '26.11.04', description: 'Earlier change', worker: 'Other worker', tag: 'Changed', screenIds: ['screen'] },
    { key: 'GUI:two', at: '26.11.05', description: '<img src=x>', worker: 'Designer', tag: 'Added', screenIds: ['screen'] },
  ]]] });
  await page.locator('.list .row[data-key=fb1] .review-dot').waitFor();
  await page.locator('.list .row[data-key=fb1]').click();
  const fold = page.locator('.detail details[data-fold=screens]');
  await fold.locator('summary').click();
  await page.locator('.fb-new-history tr').first().waitFor();
  assert.equal(await page.locator('.fb-new-history tr').count(), 2);
  assert.equal(await page.locator('.fb-new-history img').count(), 0, 'history text is escaped');
  assert.equal(await page.locator('.fb-screen-list li').count(), 1);
  assert.equal(await fold.evaluate(node => !!(node.querySelector('.fb-new-history').compareDocumentPosition(node.querySelector('.fb-screen-list')) & Node.DOCUMENT_POSITION_FOLLOWING)), true, 'new histories precede the screen list');
  assert.equal(await fold.locator('summary .review-dot').count(), 1);
  assert.equal(await page.locator('.fb-screen-list .review-dot').count(), 1);
  await fold.locator('summary').click();
  await fold.locator('summary').click();
  assert.equal(await page.locator('.fb-new-history tr').count(), 2, 'opening the fold does not dismiss this session notifications');
  await page.locator('[data-action=changed-only]').check();
  await page.waitForFunction(() => document.querySelectorAll('.list .row').length === 1);
  await page.locator('[data-action=changed-only]').uncheck();
  await page.waitForFunction(() => document.querySelectorAll('.list .row').length === 2);
  assert.equal(await page.locator('[data-action=fb-history-open], .history-overlay, [data-action=mark-reviewed]').count(), 0);
  await page.screenshot({ path: 'tmp/history-notices.png' });
  await init();
  await send({ type: 'historyNotices', items: [] });
  await page.locator('.list .row[data-key=fb1]').click();
  await page.locator('.detail details[data-fold=screens] summary').click();
  assert.equal(await page.locator('.fb-new-history, .fb-screen-list .review-dot').count(), 0, 'a new session with no new rows has no old alert');
  assert.equal(await page.evaluate(() => window.requests.some(msg => msg.type === 'history' && msg.team === 'UI')), false, 'no editable flipbook history is requested');
  assert.deepEqual(errors, []);
  console.log('History notices: grouped rows above screens, session retention, alerts, filter, and new-session reset passed');
} catch (error) {
  await page.screenshot({ path: 'tmp/history-notices-failed.png' });
  console.log(await page.locator('#app').innerText());
  console.log('page errors', errors);
  throw error;
} finally { await browser.close(); }
