import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Store, memoryKV } from '../src/core/store.ts';
import { toUiWire } from '../src/core/wire.ts';
import { COPY } from '../src/core/copy.ts';

const store = new Store(memoryKV());
store.saveProject({ ...store.state.project, scopePageIds: ['p'], screenIdPrefix: 'ST' });
store.state.categories.set('home', { id: 'home', name: 'Home', code: 'HO', order: 0, active: true });
for (const [id, code, baseScreenId] of [['a', 'ST_HO_001', null], ['b', 'ST_HO_002', null], ['c', 'ST_HO_001-01', 'a']]) {
  store.state.screens.set(id, { id, rev: 1, code, name: `Screen ${id}`, categoryId: 'home', baseScreenId, status: 'active',
    source: { nodeId: id, pageId: 'p' }, guiVersion: 1, guiTag: null, createdAt: 1 });
}
const entries = ['a', 'b', 'c', 'new1', 'new2'].map(id => ({
  key: id.startsWith('new') ? `node:${id}` : id, screenId: store.state.screens.has(id) ? id : null,
  frame: { nodeId: id, pageId: 'p', name: `Screen ${id}`, width: 1920, height: 1080, screenTag: store.state.screens.has(id) ? id : null, fingerprint: `fp-${id}`, error: null },
  estimate: id.startsWith('new') ? 'new' : 'unchanged', categoryMissing: false, notes: [], suggestedScreenId: null, pairKey: null,
}));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1000, height: 820 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  // The isolated fixture is its own parent; outgoing requests have no Main receiver.
  const responses = new Set(['init', 'startupReady', 'entries', 'scanStatus', 'canvasSelection', 'state', 'busy']);
  window.addEventListener('message', event => {
    if (event.data?.pluginMessage && !responses.has(event.data.pluginMessage.type)) event.stopImmediatePropagation();
  }, true);
});
const send = message => page.evaluate(async message => {
  window.postMessage({ pluginMessage: message }, '*');
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}, message);
const select = keys => send({ type: 'canvasSelection', team: 'GUI', entryKeys: keys, lastKey: keys.at(-1) ?? null, excludedIds: [] });
const button = field => page.locator(`.canvas-pick[data-field="${field}"]`);
const picker = field => page.locator(`.screen-picker-control:has(.canvas-pick[data-field="${field}"]) .screen-picker`);
const selected = () => page.locator('.list .row.selected').evaluateAll(rows => rows.map(row => row.dataset.key).sort());
async function reset(keys = ['node:new1']) {
  await page.goto(pathToFileURL('tmp/build/ui.html').href);
  await send({ type: 'init', mode: 'GUI', actor: { id: 'u', name: 'User' }, pages: [{ id: 'p', name: 'GUI' }], issues: [], state: toUiWire(store.state) });
  await send({ type: 'startupReady' });
  await send({ type: 'entries', entries });
  await send({ type: 'scanStatus', team: 'GUI', status: 'done', done: entries.length, total: entries.length, checkedAt: Date.now(), partialAt: null });
  await select(keys);
  await page.locator('[data-action=include-selected]').check();
}
try {
  await reset();
  assert.equal(await button('baseScreenId').isDisabled(), true, 'standalone screens cannot pick a base');
  await page.locator('[data-field=relation][value=case]').check();
  await picker('baseScreenId').locator('summary').click();
  await picker('baseScreenId').locator('.picker-search').fill('no matching screen');
  await button('baseScreenId').click();
  assert.equal(await button('baseScreenId').getAttribute('aria-pressed'), 'true');
  const activeColor = await button('baseScreenId').evaluate(el => getComputedStyle(el).backgroundColor);
  for (const keys of [[], ['node:new1'], ['c'], ['a', 'b']]) {
    await select(keys);
    assert.deepEqual(await selected(), ['node:new1'], 'invalid or multiple canvas selections preserve the edited screen');
    assert.equal(await button('baseScreenId').getAttribute('aria-pressed'), 'true');
  }
  // A fresh state redraw must retain the armed input and its owners.
  await send({ type: 'state', state: toUiWire(store.state) });
  assert.equal(await button('baseScreenId').getAttribute('aria-pressed'), 'true');
  await select(['b']);
  await page.waitForFunction(() => document.querySelector('.canvas-pick[data-field=baseScreenId]')?.getAttribute('aria-pressed') === 'false');
  assert.match(await picker('baseScreenId').locator('summary').innerText(), /Screen b/);
  assert.deepEqual(await selected(), ['node:new1']);
  assert.notEqual(await button('baseScreenId').evaluate(el => getComputedStyle(el).backgroundColor), activeColor, 'active state is visually distinct');

  // Toggle, Esc, manual selection, relation changes and owner changes cancel the mode.
  await button('baseScreenId').click();
  await button('baseScreenId').click();
  assert.equal(await button('baseScreenId').getAttribute('aria-pressed'), 'false');
  await button('baseScreenId').click();
  await page.keyboard.press('Escape');
  assert.equal(await button('baseScreenId').getAttribute('aria-pressed'), 'false');
  await picker('baseScreenId').locator('summary').click();
  await button('baseScreenId').click();
  await picker('baseScreenId').locator('[data-action=pick][data-value=a]').click();
  assert.equal(await button('baseScreenId').getAttribute('aria-pressed'), 'false');
  await button('baseScreenId').click();
  await page.locator('[data-field=relation][value=standalone]').check();
  assert.equal(await button('baseScreenId').getAttribute('aria-pressed'), 'false');
  await page.locator('[data-field=relation][value=case]').check();
  await button('baseScreenId').click();
  await page.locator('.list .row[data-key="node:new2"]').click();
  await select(['b']);
  assert.deepEqual(await selected(), ['b'], 'normal canvas-to-list navigation resumes after changing owners');

  await reset();
  await page.locator('[data-field=disposition][value=replace]').check();
  await picker('replaceScreenId').locator('summary').click();
  await picker('replaceScreenId').locator('.picker-search').fill('no matching screen');
  await button('replaceScreenId').click();
  await select(['b']);
  await page.waitForFunction(() => document.querySelector('[data-field=code]')?.value === 'ST_HO_002');
  assert.deepEqual(await selected(), ['node:new1']);
  assert.match(await picker('replaceScreenId').locator('summary').innerText(), /Screen new1/, 'the selected screen uses its new version display');
  assert.equal(await button('replaceScreenId').getAttribute('aria-pressed'), 'false');

  await reset(['b']);
  await page.locator('[data-field=disposition][value=replace]').check();
  await page.locator('[data-action=replace-side][data-side=old]').click();
  await button('replaceWith').click();
  await select(['b']);
  assert.equal(await button('replaceWith').getAttribute('aria-pressed'), 'true', 'a screen cannot replace itself');
  await select(['node:new2']);
  await page.waitForFunction(() => document.querySelector('.canvas-pick[data-field=replaceWith]')?.getAttribute('aria-pressed') === 'false');
  assert.deepEqual(await selected(), ['b']);
  assert.match(await picker('replaceWith').locator('summary').innerText(), /Screen new2/);

  // Both picker types use edited IDs, including unpublished frames whose names
  // still contain an older ID. Old replacement frames never reappear as choices.
  await reset(['b']);
  await page.locator('[data-field=code]').fill('ST_HO_090');
  await page.locator('[data-field=name]').fill('Current B');
  await select(['node:new1']);
  await page.locator('[data-action=include-selected]').check();
  await page.locator('[data-field=disposition][value=replace]').check();
  assert.match(await picker('replaceScreenId').locator('[data-value=b]').textContent(), /ST_HO_090.*Current B/s);
  await button('replaceScreenId').click();
  await select(['b']);
  await page.locator('[data-field=code]').fill('ST_HO_091');
  await page.locator('[data-field=name]').fill('Current replacement');
  assert.equal(await page.locator('.row[data-key=b]').evaluate(el => el.classList.contains('previous') && el.previousElementSibling?.dataset.key === 'node:new1'), true, 'the old version stays directly below the new version');
  await select(['node:new2']);
  await page.locator('[data-action=include-selected]').check();
  await page.locator('[data-field=relation][value=case]').check();
  const replacementOption = picker('baseScreenId').locator('[data-value=b]');
  assert.equal(await replacementOption.getAttribute('data-entry-key'), 'node:new1');
  assert.match(await replacementOption.textContent(), /ST_HO_091.*Current replacement/s);
  assert.equal(await picker('baseScreenId').locator('[data-entry-key=b]').count(), 0, 'the old frame is not a base choice');
  await picker('baseScreenId').locator('summary').click();
  await picker('baseScreenId').locator('.picker-search').fill('ST_HO_002');
  assert.equal(await picker('baseScreenId').locator('.tag-option:visible').count(), 0, 'search does not match the saved ID');
  await button('baseScreenId').click();
  await select(['b']);
  assert.equal(await button('baseScreenId').getAttribute('aria-pressed'), 'true', 'picking the old frame is ignored');
  await select(['node:new1']);
  assert.equal(await button('baseScreenId').getAttribute('aria-pressed'), 'false');
  assert.match(await picker('baseScreenId').locator('summary').innerText(), /ST_HO_091/);
  await page.locator('[data-field=relation][value=standalone]').check();
  await page.locator('[data-field=code]').fill('ST_HO_092');
  await select(['a']);
  await page.locator('[data-action=include-selected]').check();
  await page.locator('[data-field=disposition][value=replace]').check();
  await page.locator('[data-action=replace-side][data-side=old]').click();
  const frameOptions = picker('replaceWith');
  assert.equal(await frameOptions.locator('[data-value=b]').count(), 0, 'the old frame is not a replacement choice');
  assert.match(await frameOptions.locator('[data-value="node:new1"]').textContent(), /ST_HO_091/);
  assert.match(await frameOptions.locator('[data-value="node:new2"]').textContent(), /ST_HO_092/, 'unpublished candidates use edited IDs');

  await reset(['node:new1', 'node:new2']);
  await page.locator('[data-field=relation][value=case]').check();
  await button('baseScreenId').click();
  await select(['b']);
  assert.deepEqual(await selected(), ['node:new1', 'node:new2'], 'bulk relationship editing retains both owners');
  for (const key of ['node:new1', 'node:new2']) {
    await select([key]);
    assert.match(await picker('baseScreenId').locator('summary').innerText(), /Screen b/, 'the base applies to every edited screen');
  }
  await button('baseScreenId').click();
  await send({ type: 'busy', label: 'Working' });
  assert.equal(await button('baseScreenId').getAttribute('aria-pressed'), 'false', 'busy work cancels canvas picking');
  await send({ type: 'busy', label: null });
  await button('baseScreenId').click();
  await picker('baseScreenId').locator('summary').click();
  mkdirSync('tmp/walkthrough', { recursive: true });
  await page.screenshot({ path: 'tmp/walkthrough/canvas-pick-active.png' });

  await reset(['b']);
  await page.locator('[data-field=disposition][value=unpublish]').check();
  await select(['a']);
  await page.locator('[data-action=include-selected]').check();
  await page.locator('[data-field=disposition][value=not-screen]').check();
  await page.waitForFunction(() => [...document.querySelectorAll('.list .row')].slice(-2).map(el => el.dataset.key).join(',') === 'a,b');
  assert.deepEqual(await page.locator('.list .group').last().locator('.row').evaluateAll(rows => rows.map(row => row.dataset.key)), ['a', 'b'], 'excluded rows retain their original order across action order');
  assert.equal(await page.locator('.list .group').last().locator('.group-bar').count(), 0, 'the bottom area adds no heading');
  await select(['b']);
  await page.locator('[data-field=disposition][value=modify]').check();
  await page.waitForFunction(() => document.querySelector('.list .row:last-child') !== null && [...document.querySelectorAll('.list .group')].at(-1)?.querySelectorAll('.row').length === 1);
  assert.equal(await page.locator('.list .row').last().getAttribute('data-key'), 'a');
  await page.screenshot({ path: 'tmp/walkthrough/gui-bottom-rows.png' });
  for (const mode of ['GUI', 'UI']) {
    await page.goto(pathToFileURL('tmp/build/ui.html').href);
    await send({ type: 'init', mode, actor: { id: 'u', name: 'User' }, pages: [{ id: 'p', name: 'Page' }], issues: [], state: toUiWire(store.state) });
    await send({ type: 'startupReady' });
    await page.locator('[data-action=settings]').click();
    await page.locator('.admin-nav-item').filter({ hasText: COPY.uiApp162 }).click();
    const input = page.locator('[data-form=screen-id-prefix] input[data-f=prefix]');
    await input.fill('KEEP');
    await page.evaluate(() => { window.adminInput = document.querySelector('[data-form=screen-id-prefix] input[data-f=prefix]'); });
    for (const selection of [
      { entryKeys: ['b'], lastKey: 'b', excludedIds: [] },
      { entryKeys: [], lastKey: null, excludedIds: ['hidden'] },
      { entryKeys: [], lastKey: null, excludedIds: [] },
    ]) {
      await send({ type: 'canvasSelection', team: mode, ...selection });
      assert.equal(await page.locator('#app').evaluate(el => el.classList.contains('admin-mode')), true, `${mode} keeps management open`);
      assert.equal(await input.inputValue(), 'KEEP', `${mode} preserves unsaved management input`);
      assert.equal(await page.evaluate(() => window.adminInput === document.querySelector('[data-form=screen-id-prefix] input[data-f=prefix]')), true, 'canvas selection does not rebuild the panel');
    }
  }
  assert.deepEqual(errors, []);
  console.log('Canvas picker: replacement directions, relationships, bulk edit, candidate validation, active styles and cancellation passed');
} finally { await browser.close(); }
