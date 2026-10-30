import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { Store, memoryKV } from '../src/core/store.ts';
import { toUiWire } from '../src/core/wire.ts';

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1550, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  window.requests = [];
    window.retryRequests = 0;
  // In this isolated UI fixture parent === window. Capture outgoing requests
  // before the UI can mistake them for Main responses with the same type.
  window.addEventListener('message', event => {
    const message = event.data?.pluginMessage;
    if (message?.type === 'retry') window.retryRequests++;
    if (message?.type === 'thumbnails' && !('items' in message)) {
      window.requests.push(message);
      event.stopImmediatePropagation();
    } else if (message?.type === 'guiScreens' && !('screens' in message)) event.stopImmediatePropagation();
  }, true);
  window.liveUrls = new Set();
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = blob => { const url = create(blob); window.liveUrls.add(url); return url; };
  URL.revokeObjectURL = url => { window.liveUrls.delete(url); revoke(url); };
});
try {
  const cdp = await page.context().newCDPSession(page);
  const listeners = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const result = await cdp.send('Runtime.evaluate', { expression: 'JSON.stringify(Object.fromEntries(Object.entries(getEventListeners(document)).map(([key,value]) => [key,value.length])))', includeCommandLineAPI: true, returnByValue: true });
    return JSON.parse(result.result.value);
  };
  await page.goto(pathToFileURL('tmp/build/preview.html').href + '?mode=ui');
  await page.locator('#app [data-action=tutorial]').waitFor();
  const before = await listeners();
  for (let i = 0; i < 3; i++) {
    await page.locator('#app [data-action=tutorial]').click();
    await page.waitForFunction(() => document.querySelector('.tutorial-layer')?.dataset.step === '1' && !document.querySelector('.tutorial-bubble')?.hidden);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.tutorial'));
    assert.deepEqual(await listeners(), before, 'tutorial disposal releases its document listeners');
  }
  await page.locator('#app [data-action=text-open]').click();
  const editor = page.locator('#app .rich-editor');
  await editor.click();
  await page.keyboard.type('base');
  await page.waitForTimeout(900);
  await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.insertText', { text: '한' });
  assert.equal(await editor.innerText(), 'base한');
  await page.keyboard.press('Control+z');
  assert.equal(await editor.innerText(), 'base', 'undo preserves text before IME composition');
  await cdp.send('Input.imeSetComposition', { text: '가', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
  assert.equal(await editor.innerText(), 'base', 'cancelling composition preserves the document');
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await editor.innerText(), 'base한', 'redo restores the committed composition');
  console.log('UI regressions: tutorial disposal and IME undo/redo passed');

  const init = { type: 'init', mode: 'UI', actor: { id: 'r', name: 'Review' }, pages: [], issues: [], state: toUiWire(new Store(memoryKV()).state) };
  await page.goto(pathToFileURL('tmp/build/ui.html').href);
  await page.evaluate(m => {
    window.postMessage({ pluginMessage: m }, '*');
    window.postMessage({ pluginMessage: { type: 'startupReady' } }, '*');
  }, init);
  await page.locator('[data-action=paste-open]').click();
  await page.evaluate(() => window.postMessage({ pluginMessage: { type: 'guiScreens', counts: [], screens: Array.from({ length: 100 }, (_, i) => ({ uid: 's' + i, code: 'S' + i, name: 'Screen ' + i, category: null, status: 'active', isCase: false, version: 1, thumb: { hash: 'h' + i, width: 100, height: 100 }, sourceNodeId: 'n' + i })) } }, '*'));
  await page.locator('.paste-screen').first().waitFor();
  await page.locator('[data-action=paste-layout][data-layout=grid]').click();
  await page.waitForFunction(() => window.requests.flatMap(r => r.hashes).length === 100);
  assert.equal(await page.evaluate(() => window.requests.length), 1, 'grid image requests are batched');
  await page.evaluate(() => {
    window.card = document.querySelector('.paste-card');
    window.replacements = 0;
    new MutationObserver(entries => { window.replacements += entries.length; }).observe(document.querySelector('.paste-screens'), { childList: true });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const bytes = Array.from(atob(canvas.toDataURL('image/jpeg').split(',')[1]), c => c.charCodeAt(0));
    // Deliver one at a time as well: batching must not hide full-list rerenders.
    for (const hash of window.requests.flatMap(r => r.hashes)) window.postMessage({ pluginMessage: { type: 'thumbnails', items: [{ hash, bytes }] } }, '*');
  });
  await page.waitForFunction(() => document.querySelectorAll('.paste-thumb img').length === 100);
  assert.equal(await page.evaluate(() => window.card === document.querySelector('.paste-card')), true, 'image arrivals preserve card DOM and drag targets');
  assert.equal(await page.evaluate(() => window.replacements), 0, 'image arrivals never rebuild the list');
  assert.equal(await page.evaluate(() => window.liveUrls.size), 100);
  await page.evaluate(m => window.postMessage({ pluginMessage: m }, '*'), init);
  await page.waitForFunction(() => window.liveUrls.size === 0);
  const stale = Array.from({ length: 26 }, (_, i) => [`dlv:old:gone${i}`, { batchId: 'old', kind: 'flipbook', targetId: `gone${i}`, team: 'GUI', version: 1, state: 'applying', error: null, updatedAt: 0 }]);
  await page.evaluate(m => window.postMessage({ pluginMessage: m }, '*'), { ...init, state: { ...init.state, deliveries: stale } });
  await page.locator('.recovery-status').waitFor({ state: 'hidden' });
  const guiJob = ['gdl:batch:screen', { batchId: 'batch', kind: 'gui', targetId: 'screen', team: 'GUI', version: 1, state: 'applying', error: null, updatedAt: 0 }];
  await page.evaluate(m => window.postMessage({ pluginMessage: m }, '*'), { ...init, state: { ...init.state, deliveries: [...stale, guiJob] } });
  await page.locator('.recovery-status').waitFor({ state: 'visible' });
  assert.match(await page.locator('.recovery-status').innerText(), /미완료 반영 1/);
  const placement = await page.evaluate(() => ({ tabs: document.querySelector('.tabs').getBoundingClientRect().bottom, warning: document.querySelector('.recovery-status').getBoundingClientRect().toJSON(), view: document.querySelector('.paste-view').getBoundingClientRect().top }));
  assert.ok(placement.warning.top >= placement.tabs && placement.warning.bottom <= placement.view, 'unfinished work stays above the active editor');
  assert.equal(await page.evaluate(() => window.retryRequests), 0, 'reopening never automatically resumes canvas writes');
  await page.locator('.recovery-status [data-action=retry]').click();
  await page.waitForFunction(() => window.retryRequests === 1);
  await page.screenshot({ path: 'tmp/safety-pending-preview.png' });
  assert.deepEqual(errors, []);
  console.log('UI regressions: 100 images, 1 request, 0 list replacements; reset releases all Blob URLs');
  console.log('UI regressions: 26 stale destinations excluded; 1 pending GUI job shown, retry requires a click');
} finally { await browser.close(); }
