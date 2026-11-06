import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { Store, memoryKV } from '../src/core/store.ts';
import { toUiWire } from '../src/core/wire.ts';
import { COPY } from '../src/core/copy.ts';

const store = new Store(memoryKV());
store.saveProject({ ...store.state.project, templateNodeId: 'tpl', flipbookPageIds: ['p'], flipbookPageId: 'p' });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.addInitScript(() => {
    window.requests = [];
    window.addEventListener('message', e => {
      const m = e.data?.pluginMessage;
      if (m?.type === 'findTemplateMigrations' || m?.type === 'migrateFlipbookTemplates') { window.requests.push(m); e.stopImmediatePropagation(); }
      else if ((m?.type === 'guiScreens' && !('screens' in m)) || (m?.type === 'thumbnails' && !('items' in m)) || (m?.type === 'history' && !('rows' in m))) e.stopImmediatePropagation();
    }, true);
  });
  await page.goto(pathToFileURL('tmp/build/ui.html').href);
  await page.evaluate(state => {
    window.postMessage({ pluginMessage: { type: 'init', mode: 'UI', actor: { id: 'u', name: 'User' }, pages: [{ id: 'p', name: 'Pages' }], issues: [], state } }, '*');
    window.postMessage({ pluginMessage: { type: 'startupReady' } }, '*');
  }, toUiWire(store.state));
  const send = msg => page.evaluate(m => window.postMessage({ pluginMessage: m }, '*'), msg);
  const dialog = page.locator('.template-migration-overlay');
  await page.locator('[data-action=template-migration-find]').click();
  await dialog.getByText(COPY.templateMigrationScanning).waitFor();
  const candidates = ['a', 'b'].map(id => ({ id, nodeId: `node-${id}`, pageId: 'p', rev: 1, title: `Book ${id}`, templateId: id === 'a' ? 'old' : null }));
  await send({ type: 'templateMigrations', templateId: 'tpl', candidates });
  assert.equal(await dialog.getByText(COPY.templateMigrationUnknown).count(), 1);
  const submit = dialog.locator('[data-action=template-migration-submit]');
  assert.equal(await submit.isDisabled(), true);
  await dialog.locator('[data-id=a]').check();
  await dialog.locator('[data-id=b]').check();
  assert.equal(await submit.isDisabled(), true, 'conversion must stay blocked even after selecting candidates');
  await dialog.getByText(COPY.templateMigrationPaused).waitFor();
  await page.waitForFunction(() => window.requests.length === 1);
  assert.deepEqual(await page.evaluate(() => window.requests), [{ type: 'findTemplateMigrations' }]);
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  await page.locator('[data-action=template-migration-find]').click();
  await send({ type: 'templateMigrations', templateId: 'tpl', candidates: [] });
  await dialog.getByText(COPY.templateMigrationEmpty).waitFor();
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log('Template migration remains blocked after selection; read-only discovery and close states passed.');
} finally { await browser.close(); }
