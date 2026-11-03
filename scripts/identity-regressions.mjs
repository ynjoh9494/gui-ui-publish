import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { Store, memoryKV, keys } from '../src/core/store.ts';
import { toUiWire } from '../src/core/wire.ts';
import { ensureSystemTags } from '../src/core/registry.ts';
import { planFlipbooks } from '../src/core/flipbooks.ts';

const store = new Store(memoryKV());
store.saveProject({ ...store.state.project, screenIdPrefix: 'ST', flipbookPageIds: ['p'], flipbookPageId: 'p', templateNodeId: 'tpl' });
store.state.categories.set('live', { id: 'live', name: 'Live', code: 'LI', order: 0, active: true });
const [fb] = planFlipbooks({ pageId: 'p', rows: [{ uids: [], multi: false, scale: 1, title: 'Policy', section: { key: 'live', name: 'Unrelated Section', order: 0 } }] }, new Map(), { id: 'u', name: 'User' }, 1, () => 'fb');
fb.tracked = true;
store.put(keys.flipbook(fb.id), fb);
ensureSystemTags(store, { id: 'u', name: 'User' });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
try {
  await page.addInitScript(() => {
    window.requests = [];
    window.addEventListener('message', e => {
      const m = e.data?.pluginMessage;
      if (m?.type === 'updateFlipbookIdentity' || m?.type === 'renameFlipbook') { window.requests.push(m); e.stopImmediatePropagation(); }
      else if ((m?.type === 'history' && !('rows' in m)) || (m?.type === 'guiScreens' && !('screens' in m))) e.stopImmediatePropagation();
    }, true);
  });
  await page.goto(pathToFileURL('tmp/build/ui.html').href);
  await page.evaluate(state => {
    window.postMessage({ pluginMessage: { type: 'init', mode: 'UI', actor: { id: 'u', name: 'User' }, pages: [{ id: 'p', name: 'Pages' }], issues: [], state } }, '*');
    window.postMessage({ pluginMessage: { type: 'startupReady' } }, '*');
    window.postMessage({ pluginMessage: { type: 'uiScan', scans: [{ flipbookId: 'fb', nodeId: 'n', fingerprint: null, error: null }] } }, '*');
  }, toUiWire(store.state));
  // UI listing is built from state; give it the connected canvas lookup through refresh.
  await page.waitForTimeout(200);
  const row = page.locator('.list .row').first();
  for (const head of await page.locator('[data-action=page-group]').all()) if (await head.getAttribute('aria-expanded') === 'false') await head.click();
  await row.waitFor();
  assert.equal(await row.locator('.name').innerText(), 'ST_LI_POLICY · Policy');
  await row.click();
  await page.locator('[data-input=fb-page-title]').waitFor();
  assert.equal(await page.locator('[data-identity-chapter]').inputValue(), 'Live');
  assert.equal(await page.locator('[data-identity-chapter]').isDisabled(), true);
  assert.equal(await page.locator('[data-input=fb-screen-id]').inputValue(), 'ST_LI_POLICY');
  await page.locator('[data-input=fb-page-title]').fill('A title without a dash');
  await page.locator('[data-input=fb-screen-id]').fill('ST_LI_POLICY_05');
  assert.equal(await page.locator('[data-identity-frame]').innerText(), 'ST_LI_POLICY_05 \u00b7 A title without a dash');
  await page.locator('[data-action=fb-identity-save]').click();
  await page.waitForFunction(() => window.requests.at(-1)?.type === 'updateFlipbookIdentity');
  assert.deepEqual(await page.evaluate(() => window.requests.at(-1)), { type: 'updateFlipbookIdentity', id: 'fb', title: 'A title without a dash', screenId: 'ST_LI_POLICY_05', rev: 1 });
  await row.locator('.name').dblclick();
  assert.equal(await page.locator('.list [data-input=fb-title]').inputValue(), 'Policy', 'inline editor contains Page title only');
  await page.locator('.list [data-input=fb-title]').fill('Only Page title');
  await page.locator('.list [data-input=fb-title]').press('Enter');
  await page.waitForFunction(() => window.requests.at(-1)?.type === 'renameFlipbook');
  assert.deepEqual(await page.evaluate(() => window.requests.at(-1)), { type: 'renameFlipbook', id: 'fb', title: 'Only Page title' });
  await page.locator('.list [data-input=fb-title]').waitFor({ state: 'detached' });
  store.put(keys.flipbook(fb.id), { ...fb, rev: 3, title: 'Only Page title', screenId: 'ST_LI_POLICY_05' });
  await page.evaluate(state => window.postMessage({ pluginMessage: { type: 'state', state, pages: [{ id: 'p', name: 'Pages' }] } }, '*'), toUiWire(store.state));
  await page.waitForFunction(() => document.querySelector('[data-input=fb-page-title]')?.value === 'Only Page title');
  await page.waitForFunction(() => document.querySelector('.list .row .name')?.textContent === 'ST_LI_POLICY_05 · Only Page title');
  await page.locator('#app').screenshot({ path: 'release/screens/ui-identity.png' });
  console.log('Identity UI: automatic Chapter/policy ID, editable ID/title, frame preview and title-only double click passed');
} finally { await browser.close(); }
