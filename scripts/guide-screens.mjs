// 사용 안내(release/guide.html)에 넣을 플러그인 창 화면을 브라우저 미리보기의 예시 데이터로 찍어 release/screens/에 저장한다.
// 화면이 바뀌면 다시 실행해 이미지를 갱신한다. 배포(npm run release) 때 이미지는 안내 HTML 안에 들어간다.
// 사용: npm run guide-screens (CHROME_PATH로 브라우저 경로 지정 가능)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const outDir = 'release/screens';
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const app = page.locator('#app');
// 입력하며 내려간 스크롤을 맨 위로 올려 화면 위쪽부터 보이게 찍는다.
const shot = async (name, target = app) => {
  await app.evaluate(root => root.querySelectorAll('*').forEach(el => { if (el.scrollTop) el.scrollTop = 0; }));
  await page.waitForTimeout(150);
  await target.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`${outDir}/${name}.png`);
};
const ready = () => page.waitForFunction(() => document.querySelector('#app .toolbar .progress')?.textContent?.includes('마지막 검토'));
const scan = async () => { await app.locator('[data-action=scan]').click(); await ready(); };
const expandGroups = async () => {
  for (const head of await app.locator('.group-head').all())
    if (await head.getAttribute('aria-expanded') === 'false') await head.click();
};
const mode = async name => {
  await page.locator(`#tools [data-mode=${name}]`).click();
  await page.waitForFunction(tab => document.querySelector(`#app .tabs [data-action=${tab}]`), name === 'UI' ? 'text-close' : 'version-close');
};
const resize = (width, height) => app.evaluate((root, size) => { root.style.width = `${size.width}px`; root.style.height = `${size.height}px`; }, { width, height });

try {
  await page.goto(pathToFileURL('tmp/build/preview.html').href);
  await page.waitForFunction(() => document.querySelector('#app .tabs [data-action=version-close]'));
  await resize(900, 640);
  // 작업 결과 토스트가 화면 아래를 가리지 않게 숨긴다.
  await page.addStyleTag({ content: '#app .toast { display: none !important; }' });

  // GUI Publish: 관리 → 변경사항 확인 → 화면 정보 입력 → 배포 확인
  await app.locator('[data-action=settings]').click();
  await shot('gui-settings');
  await app.locator('[data-action=settings]').click();

  await scan();
  await expandGroups();

  const first = app.locator('.row').first();
  const nodeId = (await first.getAttribute('data-key')).replace(/^node:/, '');
  const name = await first.locator('.name').innerText();
  await first.click();
  await first.locator('[data-action=include]').check();
  await app.locator('[data-action=begin-add][data-kind=category]').click();
  await app.locator('[data-field=newCategory]').fill('홈');
  await app.locator('[data-field=newCategory]').press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('#app [data-field=categoryId] option')].some(x => x.textContent === '홈'));
  await app.locator('[data-field=code]').fill('STB_HO_001');
  await app.locator('[data-action=begin-add][data-kind=worker]').click();
  await app.locator('[data-form=worker-add] [data-f=name]').fill('예시 작업자');
  await app.locator('[data-form=worker-add] [data-f=name]').press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('#app [data-field=workerId] option')].some(x => x.textContent?.includes('예시 작업자')));
  await app.locator('.footer [data-input=comment]').fill('홈 화면 첫 배포');
  await shot('gui-form');

  await app.locator('[data-action=prepare]').click();
  await app.locator('[data-action=commit]').waitFor();
  await shot('gui-confirm');
  await app.locator('[data-action=commit]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#log div')].some(x => x.textContent?.includes('GUI 썸네일')));

  await app.locator('[data-action=settings]').click();
  await app.locator('details[data-form=automatic-pages] > summary').click();
  await shot('settings-auto-pages');
  await app.locator('[data-action=settings]').click();

  // UI Flipbook: 관리 → 새 플립북
  await mode('UI');
  await app.locator('[data-action=settings]').click();
  if (!await app.locator('details[data-form=flipbook]').evaluate(node => node.open)) await app.locator('details[data-form=flipbook] > summary').click();
  await app.locator('[data-form=flipbook] [data-f=page]').selectOption('0:3');
  await page.waitForFunction(() => document.querySelectorAll('#app [data-form=flipbook] .scope-page').length === 2);
  await app.locator('[data-action=admin-ui-page-remove][data-id="0:2"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#app [data-form=flipbook] .scope-page').length === 1);
  await shot('ui-settings');
  await app.locator('[data-action=settings]').click();

  await app.locator('[data-action=new-add]').click();
  await app.locator('.list .new-row').click();
  const option = app.locator('.create-screen-option').filter({ hasText: 'STB_HO_001' }).first();
  await option.waitFor();
  await option.locator('[data-action=create-screen-toggle]').check();
  await shot('ui-create');
  await app.locator('[data-action=create-submit]').click();
  await page.waitForFunction(() => document.querySelector('#app .toast')?.textContent?.includes('만들었습니다'));

  // GUI 원본을 고쳐 다시 배포하면 플립북에 빨간 점이 붙는다.
  await mode('GUI');
  await page.locator(`#tools [data-edit="${nodeId}"]`).click();
  await scan();
  await expandGroups();
  // 이름이 같은 행만 고른다(「홈 메인 - 프로필 선택」처럼 이름이 이어지는 다른 화면이 먼저 올 수 있다).
  const changed = app.locator('.row').filter({ has: page.locator('.name').getByText(name, { exact: true }) }).first();
  await changed.click();
  await shot('gui-changed');
  await changed.locator('[data-action=include]').check();
  await app.locator('[data-action=begin-add][data-kind=tag]').click();
  await app.locator('[data-form=tag-add] [data-f=name]').fill('수정');
  await app.locator('[data-action=tag-add]').click();
  await page.waitForFunction(() => document.querySelector('#app .tag-picker summary .chip')?.textContent === '수정');
  await app.locator('[data-action=prepare]').click();
  await app.locator('[data-action=commit]').click();
  await page.waitForFunction(() => document.querySelector('#app .toast')?.textContent?.includes('GUI 갱신'));

  await mode('UI');
  await resize(900, 640);
  await app.locator('.review-count').waitFor();
  await expandGroups();
  await app.locator('.row').filter({ has: page.locator('.review-dot') }).first().click();
  await app.locator('.detail .fb-bottom.flagged').waitFor();
  await app.locator('.fb-bottom [data-field=description]').fill('콜아웃 위치 확인');
  await shot('ui-review');

  await app.locator('[data-action=paste-open]').click();
  await app.locator('.paste-view .paste-screen').first().waitFor();
  await app.locator('[data-action=paste-layout][data-layout=grid]').click();
  await app.locator('.paste-view .paste-card .paste-thumb img').first().waitFor();
  await shot('ui-paste');
  await app.locator('[data-action=text-close]').click();
  await resize(900, 640);

  // 텍스트 편집 탭: 가짜 캔버스에서 골라 둔 텍스트 레이어를 불러온 모습
  await app.locator('[data-action=text-open]').click();
  await app.locator('[data-action=text-import]').click();
  await page.waitForFunction(() => document.querySelector('#app .text-view .rich-editor')?.textContent);
  await shot('ui-text');
  await app.locator('[data-action=text-close]').click();

  // 플로우 탭: 썸네일 두 장을 놓고 점을 끌어 이은 모습(이 예시에는 배포된 화면이 하나라 같은 화면을 두 번 놓는다)
  await app.locator('[data-action=flow-open]').click();
  await app.locator('.flow-view .flow-screen').first().waitFor();
  await app.locator('.flow-view .flow-screen').first().click();
  await app.locator('.flow-view .flow-screen').first().click();
  {
    const cards = app.locator('.flow-view .flow-card');
    const a = await cards.nth(0).boundingBox();
    const b = await cards.nth(1).boundingBox();
    await cards.nth(0).hover();
    await page.mouse.move(a.x + a.width, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
    await page.mouse.up();
  }
  await app.locator('.flow-view [data-flow=title]').fill('홈 진입 플로우');
  // 썸네일 미리보기가 판을 가리지 않게 마우스를 안내 문구로 옮긴다.
  await app.locator('.flow-view .flow-hint').hover();
  await app.locator('[data-action=flow-layout][data-layout=grid]').click();
  await app.locator('.flow-screens .paste-thumb img').first().waitFor();
  await shot('ui-flow');
  await app.locator('[data-action=text-close]').click();

  // 튜토리얼 첫 단계
  await app.locator('[data-action=tutorial]').click();
  await page.waitForFunction(() => document.querySelector('.tutorial-layer')?.dataset.step === '1', null, { timeout: 15000 });
  await shot('tutorial', page.locator('.tutorial'));
} finally {
  await browser.close();
}
