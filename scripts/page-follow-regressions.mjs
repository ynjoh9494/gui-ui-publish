import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { Store, keys, memoryKV } from '../src/core/store.ts';
import { planFlipbooks } from '../src/core/flipbooks.ts';
import { toUiWire } from '../src/core/wire.ts';

// 2026-11-20 사용자 요청: 보고 있는 페이지만 펼치기, 플립북 페이지가 아니면 등록 안내와 「추가하기」, 페이지 머리 새로고침.
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(`${error.message} ${error.stack ?? ''}`));
try {
  const actor = { id: 'user', name: 'Designer' };
  const store = new Store(memoryKV());
  store.saveProject({ ...store.state.project, flipbookPageIds: ['p1', 'p2'] });
  let sequence = 0;
  for (const pageId of ['p1', 'p2'])
    for (const fb of planFlipbooks({ pageId, rows: [{ uids: [], multi: false, scale: 1, title: `Book ${pageId}` }] }, new Map(), actor, 1, () => 'fb' + ++sequence)) store.put(keys.flipbook(fb.id), fb);
  const state = toUiWire(store.state);
  await page.addInitScript(() => {
    window.sent = [];
    window.addEventListener('message', event => {
      const msg = event.data?.pluginMessage;
      // UI가 보낸 요청은 이 창으로 되돌아오므로 받은 메시지로 처리되지 않게 막는다.
      if (msg && ['refreshList', 'admin', 'flipbookDescription', 'followFlipbook', 'history', 'guiScreens'].includes(msg.type) && !('screens' in msg)) { window.sent.push(msg); event.stopImmediatePropagation(); }
    }, true);
  });
  await page.goto(pathToFileURL('tmp/build/ui.html').href);
  const send = msg => page.evaluate(msg => window.postMessage({ pluginMessage: msg }, '*'), msg);
  const pages = current => [{ id: 'p1', name: 'Page 1' }, { id: 'p2', name: 'Page 2' }, { id: 'gui', name: 'GUI' }].map(p => ({ ...p, current: p.id === current }));
  const expandedPages = () => page.$$eval('[data-action=page-group]', heads => heads.filter(h => h.getAttribute('aria-expanded') === 'true').map(h => h.dataset.page));
  await send({ type: 'init', mode: 'UI', actor, pages: pages('p1'), issues: [], state });
  await send({ type: 'startupReady' });
  await page.locator('[data-action=page-group]').first().waitFor();
  assert.deepEqual(await expandedPages(), ['p1'], '열 때 보고 있는 페이지만 펼친다');

  await send({ type: 'pages', pages: pages('p2') });
  await page.waitForFunction(() => document.querySelector('[data-action=page-group][data-page=p2]')?.getAttribute('aria-expanded') === 'true');
  assert.deepEqual(await expandedPages(), ['p2'], '옮긴 페이지만 펼치고 나머지는 접는다');

  // 직접 펼친 것은 다음에 페이지를 옮길 때까지 둔다.
  await page.locator('[data-action=page-group][data-page=p1]').click();
  await page.waitForFunction(() => document.querySelector('[data-action=page-group][data-page=p1]')?.getAttribute('aria-expanded') === 'true');
  assert.deepEqual((await expandedPages()).sort(), ['p1', 'p2']);

  // 페이지 머리 새로고침: 그 페이지만 요청하고 응답이 올 때까지 돈다.
  await page.locator('[data-action=refresh-page][data-page=p1]').click();
  await page.waitForFunction(() => window.sent.some(m => m.type === 'refreshList'));
  assert.deepEqual(await page.evaluate(() => window.sent.filter(m => m.type === 'refreshList')), [{ type: 'refreshList', pageId: 'p1' }]);
  assert.equal(await page.locator('[data-action=refresh-page][data-page=p1].spinning').count(), 1);
  await send({ type: 'listSynced', at: 1, pageIds: ['p1'] });
  await page.waitForFunction(() => !document.querySelector('[data-action=refresh-page][data-page=p1].spinning'));

  // 동기화하는 동안 오른쪽 영역을 비우고 안내만 두며, 끝나면 고른 플립북 상세로 돌아온다.
  await page.locator('.list .row').first().click();
  await page.locator('.detail.flipbook-detail').waitFor();
  await send({ type: 'listSyncing', on: true });
  await page.waitForFunction(() => document.querySelector('.detail .detail-hint')?.textContent?.includes('동기화'));
  assert.equal(await page.locator('.detail input, .detail button').count(), 0, '동기화 중에는 오른쪽 영역에서 고칠 수 없다');
  await send({ type: 'listSyncing', on: false });
  await page.locator('.detail.flipbook-detail').waitFor();

  // 플립북 페이지가 아닌 페이지: 모두 접고 오른쪽에 등록 안내와 「추가하기」.
  await page.locator('.list .row').first().click();
  await page.locator('.list .row.selected').waitFor();
  await send({ type: 'pages', pages: pages('gui') });
  await page.locator('.detail .page-unregistered').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-action=page-group][aria-expanded=true]'));
  assert.deepEqual(await expandedPages(), []);
  assert.equal(await page.locator('.list .row.selected').count(), 0, '목록 선택을 비운다');
  await page.locator('[data-action=add-current-page]').click();
  await page.waitForFunction(() => window.sent.some(m => m.type === 'admin'));
  assert.deepEqual(await page.evaluate(() => window.sent.filter(m => m.type === 'admin').map(m => m.action)), [{ op: 'setFlipbookPages', pageIds: ['p1', 'p2', 'gui'] }]);
  await page.screenshot({ path: 'tmp/page-follow.png' });
  assert.deepEqual(errors, []);
  console.log('Page follow: current page expands, unregistered notice and add, per-page refresh, detail lock while syncing passed');
} catch (error) {
  await page.screenshot({ path: 'tmp/page-follow-failed.png' });
  console.log(await page.locator('#app').innerText());
  console.log('page errors', errors);
  throw error;
} finally { await browser.close(); }
