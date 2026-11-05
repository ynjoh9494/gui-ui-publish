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
    if (message?.type === 'retry') { window.retryRequests++; window.lastRetry = message; }
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
  const switcher = page.locator('#app [data-action=switch-mode]');
  assert.equal(await switcher.innerText(), 'GUI 배포');
  await switcher.click();
  await page.locator('#app [data-action=version-open]').waitFor();
  assert.equal(await switcher.innerText(), '플립북 관리');
  await page.locator('#app [data-action=settings]').click();
  await switcher.click();
  await page.locator('#app [data-action=text-open]').waitFor();
  assert.equal(await switcher.innerText(), 'GUI 배포');
  for (let i = 0; i < 3; i++) {
    await page.locator('#app [data-action=tutorial]').click();
    await page.waitForFunction(() => document.querySelector('.tutorial-layer')?.dataset.step === '1' && !document.querySelector('.tutorial-bubble')?.hidden);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.tutorial'));
    assert.deepEqual(await listeners(), before, 'tutorial disposal releases its document listeners');
  }
  await page.locator('#app [data-action=settings]').click();
  await page.getByRole('button', { name: '히스토리 날짜', exact: true }).click();
  const dateFormat = page.locator('#history-date-format');
  assert.equal(await dateFormat.inputValue(), 'YY.MM.DD');
  await dateFormat.selectOption('MM/DD HH:mm');
  await page.locator('[data-action=admin-history-date]').click();
  await page.waitForFunction(() => document.querySelector('#history-date-format')?.value === 'MM/DD HH:mm');
  await page.locator('#app [data-action=settings]').click();
  await page.locator('#app [data-action=settings]').click();
  await page.getByRole('button', { name: '히스토리 날짜', exact: true }).click();
  assert.equal(await dateFormat.inputValue(), 'MM/DD HH:mm', 'history date format survives closing management');
  await switcher.click();
  await page.locator('#app [data-action=settings]').click();
  await page.getByRole('button', { name: '히스토리 날짜', exact: true }).click();
  assert.equal(await dateFormat.inputValue(), 'MM/DD HH:mm', 'GUI and UI share the history date format');
  await dateFormat.selectOption('YY.MM.DD');
  await page.locator('[data-action=admin-history-date]').click();
  await page.waitForFunction(() => document.querySelector('#history-date-format')?.value === 'YY.MM.DD');
  await page.screenshot({ path: 'tmp/history-date-menu.png' });
  await switcher.click();
  console.log('UI regressions: shared history date menu saves and restores both formats');

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

  await page.keyboard.press('ControlOrMeta+a');
  await page.locator('[data-rt=red]').click();
  assert.equal(await editor.locator('span').first().evaluate(el => getComputedStyle(el).color), 'rgb(214, 52, 52)');
  await page.locator('[data-rt=bold]').click();
  assert.ok(await editor.locator('b').count(), 'bold and red overlap');
  await page.keyboard.press('Control+z');
  assert.equal(await editor.locator('span').first().evaluate(el => getComputedStyle(el).color), 'rgb(214, 52, 52)', 'undo bold preserves red');
  await page.locator('[data-rt=red]').click();
  assert.equal(await editor.locator('span').count(), 0, 'red can be removed');
  await page.keyboard.press('Control+z');
  assert.equal(await editor.locator('span').first().evaluate(el => getComputedStyle(el).color), 'rgb(214, 52, 52)', 'undo restores red');

  await page.keyboard.press('ControlOrMeta+a');
  await editor.evaluate(el => {
    const data = new DataTransfer();
    data.setData('text/plain', '- <red>red **bold**</red>');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  assert.equal(await editor.innerText(), 'red bold');
  await page.keyboard.press('ControlOrMeta+a');
  const copied = await editor.evaluate(el => {
    const data = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData('text/plain');
  });
  assert.equal(copied, '- <red>red **bold**</red>', 'copy retains red, bold and list');
  await editor.evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let last;
    while (walker.nextNode()) last = walker.currentNode;
    document.getSelection().setBaseAndExtent(last, last.textContent.length, last, last.textContent.length);
  });
  await page.locator('[data-rt=red]').click();
  await page.keyboard.type(' normal');
  assert.equal(await editor.evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let last;
    while (walker.nextNode()) last = walker.currentNode;
    return getComputedStyle(last.parentElement).color;
  }), 'rgb(51, 51, 51)', 'caret toggle controls new text');
  await page.keyboard.press('ControlOrMeta+a');
  await editor.evaluate(el => {
    const data = new DataTransfer();
    data.setData('text/plain', '1. **첫째**\n2. 둘째');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  assert.deepEqual(await editor.locator('.rt-p').evaluateAll(nodes => nodes.map(node => [node.dataset.list, node.dataset.marker])), [['ORDERED', '1.'], ['ORDERED', '2.']]);
  assert.ok(await editor.locator('b').count(), 'numbered list keeps bold');
  await page.locator('[data-rt=layout]').click();
  assert.equal(await page.locator('.text-layout [data-layout=gap]').inputValue(), '12');
  assert.equal(await page.locator('.text-layout [data-layout=spacer]').inputValue(), '15');
  assert.deepEqual(await page.locator('.text-layout .layout-label').evaluateAll(nodes => nodes.map(node => node.title)),
    ['Top', 'Right', 'Bottom', 'Left', 'Font size', 'List spacing', 'Line height', 'Letter spacing', 'Gap', 'Spacer height']);
  assert.equal(await page.locator('.layout-label svg').count(), 0);
  assert.equal(await page.locator('.layout-control svg').count(), 4);
  assert.ok(await page.locator('.text-layout [data-layout=lineHeight]').evaluate(el => el.parentElement.getBoundingClientRect().height <= 26));
  assert.deepEqual(await page.locator('.text-layout h3').allTextContents(), ['Padding', 'Formatting', 'Spacing']);
  console.log('UI regressions: red toggle, bold overlap, undo, clipboard and typing passed');

  const init = { type: 'init', mode: 'UI', actor: { id: 'r', name: 'Review' }, pages: [], issues: [], state: toUiWire(new Store(memoryKV()).state) };
  await page.goto(pathToFileURL('tmp/build/ui.html').href);
  await page.evaluate(m => {
    window.postMessage({ pluginMessage: m }, '*');
    window.postMessage({ pluginMessage: { type: 'startupReady' } }, '*');
  }, init);
  // 처리 중에 탭을 다시 그려도(업데이트 확인 응답 등) 처리가 끝나면 모드 전환 버튼이 다시 켜져야 한다.
  await page.locator('[data-action=switch-mode]:not([disabled])').waitFor();
  await page.evaluate(() => {
    window.postMessage({ pluginMessage: { type: 'busy', label: '처리 중' } }, '*');
    window.postMessage({ pluginMessage: { type: 'updateLatest', latest: null } }, '*');
  });
  await page.locator('[data-action=switch-mode][disabled]').waitFor();
  await page.evaluate(() => window.postMessage({ pluginMessage: { type: 'busy', label: null } }, '*'));
  await page.locator('[data-action=switch-mode]:not([disabled])').waitFor({ timeout: 2000 });
  await page.locator('[data-action=paste-open]').click();
  await page.evaluate(() => window.postMessage({ pluginMessage: { type: 'guiScreens', counts: [], screens: Array.from({ length: 100 }, (_, i) => ({ uid: 's' + i, code: 'S' + i, name: 'Screen ' + i, category: null, status: 'active', isCase: false, version: 1, thumb: { hash: 'h' + i, width: 100, height: 100 }, sourceNodeId: 'n' + i })) } }, '*'));
  await page.locator('.paste-screen').first().waitFor();
  await page.locator('[data-action=paste-layout][data-layout=grid]').click();
  await page.waitForFunction(() => window.requests.flatMap(r => r.hashes).length > 0);
  assert.ok(await page.evaluate(() => window.requests.flatMap(r => r.hashes).length < 100), 'grid requests only visible images');
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
  await page.waitForFunction(() => document.querySelectorAll('.paste-thumb img').length > 0);
  assert.equal(await page.evaluate(() => window.card === document.querySelector('.paste-card')), true, 'image arrivals preserve card DOM and drag targets');
  assert.equal(await page.evaluate(() => window.replacements), 0, 'image arrivals never rebuild the list');
  assert.ok(await page.evaluate(() => window.liveUrls.size < 100), 'grid keeps only visible images');
  await page.locator('.paste-screens').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForFunction(() => window.requests.flatMap(r => r.hashes).some(hash => hash === 'h99'));
  await page.waitForFunction(() => window.liveUrls.size === 0);
  await page.locator('.paste-screens').evaluate(el => { el.scrollTop = 0; });
  await page.waitForFunction(() => window.requests.flatMap(r => r.hashes).filter(hash => hash === 'h0').length > 1);
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
  assert.equal(await page.evaluate(() => window.lastRetry.reconcile), undefined, 'the banner retry never starts the full re-sync');
  assert.equal(await page.locator('.recovery-list').count(), 0);
  await page.locator('.recovery-status [data-action=recovery-toggle]').click();
  const row = page.locator('.recovery-status .recovery-item');
  await row.waitFor();
  assert.equal(await row.count(), 1);
  assert.deepEqual((await row.innerText()).split('\n'), ['GUI', 'screen', '반영 도중 중단됨']);
  await page.screenshot({ path: 'tmp/safety-pending-preview.png' });
  await page.locator('.recovery-status [data-action=recovery-toggle]').click();
  await page.locator('.recovery-list').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  console.log('UI regressions: visible images load on scroll, release offscreen URLs, and preserve card DOM');
  console.log('UI regressions: 26 stale destinations excluded; 1 pending GUI job shown, retry requires a click');
} finally { await browser.close(); }
