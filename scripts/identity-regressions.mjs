import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
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
      if (m?.type === 'updateFlipbookIdentity' || m?.type === 'renameFlipbook' || m?.type === 'applyFlipbookEdits' || (m?.type === 'flipbookDescription' && !('paragraphs' in m) && !('error' in m))) { window.requests.push(m); e.stopImmediatePropagation(); }
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
  const save = page.locator('[data-action=fb-identity-save]');
  assert.equal(await save.innerText(), '적용하기');
  assert.equal(await save.isDisabled(), true, 'nothing to apply yet');
  await page.locator('[data-input=fb-page-title]').fill('A title without a dash');
  assert.equal(await save.isDisabled(), false, 'unsaved input enables 적용하기');
  await page.locator('[data-input=fb-page-title]').fill('Policy');
  assert.equal(await save.isDisabled(), true, 'typing the saved title back disables 적용하기 again');
  await page.locator('[data-input=fb-page-title]').fill('A title without a dash');
  await page.locator('[data-input=fb-screen-id]').fill('ST_LI_POLICY_05');
  assert.equal(await page.locator('[data-identity-frame]').count(), 0, 'no frame-name preview row');
  // 고르면 Description을 불러온다. 불러온 내용을 고치면 「수정 중」 태그와 맨 아래 줄이 생기고 적용하기에 함께 실린다(2026-11-04).
  assert.ok(await page.evaluate(() => window.requests.some(r => r.type === 'flipbookDescription' && r.id === 'fb')), 'selecting loads the Description');
  const layout = { gap: 12, padding: [8, 12, 12, 16], fontSize: 16, letterSpacing: 0, lineHeight: 140, listSpacing: 2, spacer: 3 };
  await page.evaluate(layout => window.postMessage({ pluginMessage: { type: 'flipbookDescription', id: 'fb', paragraphs: [{ text: 'Policy', depth: null, bold: [{ start: 0, end: 6 }] }, { text: '설명', depth: 0, bold: [] }], layout } }, '*'), layout);
  const description = page.locator('.detail .fb-description .rich-editor');
  await description.waitFor();
  assert.equal(await description.innerText(), 'Policy\n설명');
  assert.equal(await page.locator('.list .row-state').count(), 1, 'title change already marks the row');
  await description.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' 추가');
  await page.locator('.detail .fb-description [data-rt=layout]').click();
  assert.equal(await page.locator('.detail .text-layout input').count(), 10, 'Gap, Padding x4, font size, letter spacing, line height, list spacing, spacer');
  assert.equal(await page.locator('.list .row .row-state.edit-state').innerText(), '수정 중');
  assert.match(await page.locator('.footer .pending-line').innerText(), /수정 1개/);
  assert.equal(await page.locator('.footer [data-action=create-submit]').innerText(), '모두 적용하기');
  mkdirSync('tmp/walkthrough', { recursive: true });
  await page.locator('#app').screenshot({ path: 'tmp/walkthrough/ui-description-edit.png' });
  await page.locator('[data-action=fb-identity-save]').click();
  await page.waitForFunction(() => window.requests.at(-1)?.type === 'applyFlipbookEdits');
  const applied = await page.evaluate(() => window.requests.at(-1));
  assert.deepEqual(applied.edits.map(e => [e.id, e.rev, e.identity]), [['fb', 1, { title: 'A title without a dash', screenId: 'ST_LI_POLICY_05' }]]);
  assert.equal(applied.edits[0].description.paragraphs.map(p => p.text).join('|'), 'Policy|설명 추가');
  assert.deepEqual(applied.edits[0].description.layout, layout);
  assert.equal(applied.create, undefined, 'detail 적용하기 does not create or move flipbooks');
  await page.evaluate(() => window.postMessage({ pluginMessage: { type: 'flipbookEditsApplied', applied: ['fb'], failed: [], message: 'ok', creating: false } }, '*'));
  await page.waitForFunction(() => !document.querySelector('.footer .pending-line'));
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
  // 안내 화면(release/screens)은 배포 직전에만 갱신하므로 검사 화면은 tmp에 남긴다.
  mkdirSync('tmp/walkthrough', { recursive: true });
  await page.locator('#app').screenshot({ path: 'tmp/walkthrough/ui-identity.png' });
  console.log('Identity UI: automatic Chapter/policy ID, editable ID/title, 적용하기 enabled only with changes and title-only double click passed');
} finally { await browser.close(); }
