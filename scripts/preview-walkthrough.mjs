// 브라우저 미리보기에서 GUI Publish(썸네일) → UI Flipbook(만들기·두 페이지·썸네일) → GUI 재배포 반영(화면 수정 표시·확인 완료) 흐름을 조작한다.
// 사용: npm run walkthrough (CHROME_PATH로 브라우저 경로 지정 가능)
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const previewPath = process.argv[2] ?? 'dist/preview.html';
const outDir = process.argv[3] ?? 'tmp/walkthrough';
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1550, height: 820 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
// 튜토리얼은 예시 화면 조작이 실패하면 경고만 남기고 넘어가므로 경고도 실패로 본다.
page.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && m.text().startsWith('tutorial'))) errors.push('console: ' + m.text()); });
const app = page.locator('#app');
const shot = async name => { await page.screenshot({ path: `${outDir}/${name}.png` }); console.log('step', name); };
const ready = async () => page.waitForFunction(() => document.querySelector('#app .toolbar .progress')?.textContent?.includes('마지막 검토'));
const scan = async () => { await app.locator('[data-action=scan]').click(); await ready(); };
// 플러그인 메뉴에서 다른 명령을 실행한 것처럼 바꾼다(미리보기 도구 버튼).
// 목록은 다음 프레임에 다시 그린다. 새 플립북 행이 기대한 상태가 될 때까지 잠시 기다린 뒤 확인한다.
const newRows = async (count, message) => {
  await page.waitForFunction(n => document.querySelectorAll('#app .list .new-row').length === n, count, { timeout: 3000 }).catch(() => {});
  assert.equal(await app.locator('.list .new-row').count(), count, message);
};
const newNames = async (names, message) => {
  await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('#app .list .new-row .name')].map(n => n.textContent)) === JSON.stringify(expected), names, { timeout: 3000 }).catch(() => {});
  assert.deepEqual(await app.locator('.list .new-row .name').allTextContents(), names, message);
};
const mode = async name => {
  await page.locator(`#tools [data-mode=${name}]`).click();
  await page.waitForFunction(tab => document.querySelector(`#app .tabs [data-action=${tab}]`), name === 'UI' ? 'text-close' : 'version-close');
};
// 튜토리얼: 예시 화면에서 단계마다 설명할 영역을 찾고 말풍선이 창 안에 있는지 본다. Enter·Space로 넘기고 마지막 단계에서 누르면 끝난다.
// 끝나면 실제 창의 목록·화면정보·크기가 그대로여야 한다.
const tutorial = async name => {
  const real = () => app.evaluate(root => ({ list: root.querySelector('.list').textContent, detail: root.querySelector('.detail').textContent, width: root.offsetWidth, height: root.offsetHeight, inert: root.inert }));
  const before = await real();
  await app.locator('[data-action=tutorial]').click();
  for (let step = 1; ; step++) {
    await page.waitForFunction(n => document.querySelector('.tutorial-layer')?.dataset.step === String(n), step, { timeout: 15000 });
    const info = await page.evaluate(() => {
      const box = document.querySelector('.tutorial').getBoundingClientRect();
      const bubble = document.querySelector('.tutorial-bubble');
      const b = bubble.getBoundingClientRect();
      return { missing: document.querySelector('.tutorial-layer').dataset.missing, tail: bubble.dataset.tail, progress: bubble.querySelector('.tutorial-progress').textContent,
        inside: b.left >= box.left && b.right <= box.right && b.top >= box.top && b.bottom <= box.bottom };
    });
    assert.equal(info.missing, '0', `${name} ${step}단계 영역`);
    assert.ok(info.tail && info.inside, `${name} ${step}단계 말풍선 위치 ${JSON.stringify(info)}`);
    if (step === 1) await shot(`${name}-first`);
    const [, total] = info.progress.split('/').map(Number);
    if (step === total) break;
    await page.keyboard.press(step % 2 ? 'Enter' : ' ');
  }
  await shot(`${name}-last`);
  await page.locator('.tutorial-bubble').click();
  await page.waitForFunction(() => !document.querySelector('.tutorial'));
  assert.deepEqual(await real(), before, '튜토리얼은 실제 창을 바꾸지 않는다');
};

try {
  await page.goto(`${pathToFileURL(previewPath).href}?tall-thumb`);
  await page.waitForFunction(() => document.querySelector('#app .tabs [data-action=version-close]'));
  assert.equal(await app.locator('[data-action=settings]').count(), 1, 'settings gear instead of admin tab');
  const divider = app.locator('.pane-divider');
  const widths = () => app.evaluate(root => ({
    root: root.getBoundingClientRect().width,
    list: root.querySelector('.list').getBoundingClientRect().width,
    detail: root.querySelector('.detail').getBoundingClientRect().width,
  }));
  const dragDivider = async x => {
    const handle = await divider.boundingBox();
    const root = await app.boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(root.x + x, handle.y + handle.height / 2, { steps: 5 });
    await page.mouse.up();
  };
  const initialListWidth = (await widths()).list;
  await dragDivider(0);
  assert.ok((await widths()).list >= 200, '목록 최소 너비 유지');
  await dragDivider(1000);
  assert.ok((await widths()).detail >= 240, '화면정보 최소 너비 유지');
  await divider.focus();
  await divider.press('Home');
  assert.equal(Math.round((await widths()).list), 200, '키보드로 목록 최소 너비 이동');
  await divider.press('End');
  assert.ok((await widths()).detail >= 240, '키보드로 화면정보 최소 너비 이동');
  await dragDivider(initialListWidth + 4);
  const originalWidth = await app.evaluate(root => root.style.width);
  // 미리보기 창은 테두리 1px씩이 있어 최소 창 너비(448px)보다 2px 넓힌다.
  await app.evaluate(root => { root.style.width = '450px'; });
  assert.ok((await widths()).list >= 200 && (await widths()).detail >= 240, '창이 작아져도 양쪽 최소 너비 유지');
  await app.evaluate((root, width) => { root.style.width = width; }, originalWidth);
  await shot('00-start');
  await tutorial('00b-tutorial-gui');

  await scan();
  await app.locator('.group-head').first().click();
  await page.waitForFunction(() => document.querySelectorAll('#app .row').length >= 7);
  const listScroll = await app.evaluate(async root => {
    const box = root.querySelector('.list-box');
    box.scrollTop = 120;
    const before = box.scrollTop;
    const row = root.querySelectorAll('.row')[Math.min(6, root.querySelectorAll('.row').length - 1)];
    row.click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { before, after: root.querySelector('.list-box').scrollTop, preserved: row.isConnected };
  });
  assert.ok(listScroll.before > 0 && Math.abs(listScroll.after - listScroll.before) <= 2, `목록 행을 선택해도 스크롤 유지: ${JSON.stringify(listScroll)}`);
  assert.equal(listScroll.preserved, true, '행 선택은 목록 DOM을 교체하지 않는다');
  const first = app.locator('.row').first();
  const initialName = await first.locator('.name').innerText();
  const initialNodeId = (await first.getAttribute('data-key')).replace(/^node:/, '');
  await first.click();
  await first.locator('[data-action=include]').check();
  assert.equal(await app.locator('[data-field=code]').getAttribute('aria-invalid'), null, '필수 입력은 처음부터 빨갛게 표시하지 않는다');
  await app.locator('[data-field=code]').focus();
  await app.locator('[data-field=categoryId]').focus();
  assert.equal(await app.locator('[data-field=code]').getAttribute('aria-invalid'), 'true', '비어 있는 입력에서 벗나면 오류 표시');
  await app.locator('[data-field=code]').fill('STB_HO_001');
  assert.equal(await app.locator('[data-field=code]').getAttribute('aria-invalid'), null, '입력하면 오류 표시 해제');
  assert.equal(await app.locator('[data-field=categoryId]').getAttribute('aria-invalid'), 'true', '카테고리 선택도 포커스를 벗어난 뒤 오류 표시');
  const nameInput = app.locator('[data-field=name]');
  const originalName = await nameInput.inputValue();
  await nameInput.fill('이름 미리보기 확인');
  await page.waitForFunction(nodeId => document.querySelector(`#app .row[data-key="node:${nodeId}"] .name`)?.textContent === '이름 미리보기 확인', initialNodeId);
  assert.equal(await app.locator(`.row[data-key="node:${initialNodeId}"] .id-tag`).count(), 0, '미배포 화면은 ID 태그가 없다');
  await nameInput.fill('');
  await app.locator('[data-field=code]').focus();
  assert.equal(await nameInput.getAttribute('aria-invalid'), 'true', '비어 있는 화면 이름 오류 표시');
  await nameInput.fill(originalName);
  assert.equal(await nameInput.getAttribute('aria-invalid'), null, '화면 이름 입력 시 오류 표시 해제');

  await app.locator('[data-action=begin-add][data-kind=category]').click();
  await app.locator('[data-field=newCategory]').fill('홈');
  // 새 항목 입력란의 Enter는 확인 버튼과 같다.
  await app.locator('[data-field=newCategory]').press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('#app [data-field=categoryId] option')].some(x => x.textContent === '홈'));
  assert.equal(await app.locator('[data-field=categoryId]').getAttribute('aria-invalid'), null, '카테고리 지정 시 오류 표시 해제');

  await app.locator('[data-action=begin-add][data-kind=worker]').click();
  await app.locator('[data-form=worker-add] [data-f=name]').fill('테스트 작업자');
  await app.locator('[data-form=worker-add] [data-f=name]').press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('#app [data-field=workerId] option')].some(x => x.textContent?.includes('테스트 작업자')));

  await app.locator('[data-action=begin-add][data-kind=tag]').click();
  await app.locator('[data-form=tag-add] [data-f=name]').fill('검토');
  await app.locator('[data-action=tag-add]').click();
  await page.waitForFunction(() => document.querySelector('#app .tag-picker summary .chip')?.textContent === '검토');
  await shot('01-gui-ready');

  await app.locator('[data-action=prepare]').click();
  await app.locator('[data-action=commit]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#log div')].some(x => x.textContent?.includes('GUI 썸네일')));
  await shot('02-gui-published');

  await mode('UI');
  await app.locator('[data-action=settings]').click();
  await app.locator('[data-form=flipbook] [data-f=page]').selectOption('0:3');
  await page.waitForFunction(() => document.querySelectorAll('#app [data-form=flipbook] .scope-page').length === 2);
  await app.locator('[data-action=admin-ui-page-remove][data-id="0:2"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#app [data-form=flipbook] .scope-page').length === 1);
  await shot('02-ui-page-settings');
  await app.locator('[data-action=settings]').click();
  // 플립북 만들기 탭은 플립북 목록에 합쳤다(2026-10-21). 목록 위 「새 플립북」으로 목록에 바로 넣고, 만들기 전에는 저장하지 않는다.
  assert.equal(await app.locator('.create-tabs button').filter({ hasText: '플립북 만들기' }).count(), 0, '플립북 목록과 만들기를 한 화면에서 한다');
  const sizeBeforeCreate = await app.evaluate(root => ({ width: root.offsetWidth, height: root.offsetHeight }));
  // 플립북 없는 화면 일괄 만들기: 페이지·카테고리·화면 유형·검색으로 범위를 정하고 화면별로 뺄 수 있다.
  {
    await app.locator('.list-actions [data-action=bulk-open]').click();
    const dialog = app.locator('.bulk-dialog');
    const submit = dialog.locator('[data-action=bulk-submit]');
    const listed = () => dialog.locator('.bulk-screen-list .create-screen-option').count();
    assert.equal(await dialog.locator('[data-input=bulk-page]').inputValue(), '0:3', '일괄 만들기 페이지는 설정에서 지정한 UI 페이지다');
    await page.waitForFunction(() => document.querySelectorAll('#app .bulk-screen-list .create-screen-option').length === 1);
    assert.ok((await dialog.locator('.bulk-filter').first().innerText()).includes('홈'), '카테고리 필터에 플립북 없는 화면의 카테고리를 보여 준다');
    assert.equal(await submit.innerText(), '플립북 1개 만들기');
    await dialog.locator('[data-input=bulk-kind][value=case]').check();
    assert.equal(await listed(), 0, '화면 유형으로 거른다');
    assert.equal(await submit.isDisabled(), true, '대상 화면이 없으면 만들 수 없다');
    await dialog.locator('[data-input=bulk-kind][value=all]').check();
    await dialog.locator('[data-input=bulk-category]').first().uncheck();
    assert.equal(await listed(), 0, '카테고리로 거른다');
    assert.equal(await dialog.locator('[data-input=bulk-category-all]').isChecked(), false);
    await dialog.locator('[data-input=bulk-category-all]').check();
    assert.equal(await listed(), 1, '카테고리 전체 선택');
    await dialog.locator('[data-input=bulk-query]').fill('없는 화면');
    assert.equal(await listed(), 0, '검색으로 거른다');
    assert.equal(await dialog.locator('[data-input=bulk-query]').evaluate(el => el === document.activeElement), true, '검색 중 포커스를 유지한다');
    await dialog.locator('[data-input=bulk-query]').fill('');
    await dialog.locator('[data-input=bulk-screen]').uncheck();
    assert.equal(await dialog.locator('.bulk-count').innerText(), '0 / 1', '화면별로 체크를 풀어 뺀다');
    assert.equal(await submit.isDisabled(), true);
    await dialog.locator('[data-input=bulk-screen-all]').check();
    assert.equal(await submit.innerText(), '플립북 1개 만들기');
    await shot('03-bulk-create');
    await page.keyboard.press('Escape');
    assert.equal(await app.locator('.bulk-dialog').count(), 0, 'Esc로 모달을 닫는다');
  }
  await app.locator('[data-action=new-add]').click();
  await page.waitForFunction(() => document.querySelector('#app').offsetHeight >= 800);
  await newRows(1, '새 플립북을 목록에 바로 넣는다');
  assert.ok(await app.locator('.list .new-row').evaluate(el => el.classList.contains('selected')), '넣은 새 플립북을 고른다');
  assert.equal(await app.locator('.detail .new-actions [data-action=create-submit]').innerText(), '플립북 1개 만들기', '플립북 편집 머리에서 한 번에 만든다');
  assert.equal(await app.locator('.toolbar .pending-line').count(), 0, '플립북 편집이 보이면 목록 위 줄은 없다');
  assert.equal(await app.locator('.detail .edit-head [data-action=new-remove]').count(), 0, '플립북 편집 머리에 X가 없다');
  assert.equal(await app.locator('[data-action=create-page-manage] svg').count(), 1, '페이지 관리 화살표는 아이콘이다');
  assert.ok(await app.locator('.new-place .field-head').evaluate(head => {
    const [label, link] = [head.firstElementChild.getBoundingClientRect(), head.querySelector('[data-action=create-page-manage]').getBoundingClientRect()];
    return head.querySelector('[data-action=create-page-manage]').textContent === '관리' && Math.abs(label.top + label.height / 2 - (link.top + link.height / 2)) < 2 && Math.abs(link.right - head.getBoundingClientRect().right) < 1;
  }), '관리 링크는 페이지 선택 줄 오른쪽에 있다');
  assert.deepEqual(await app.locator('[data-input=new-page] option').evaluateAll(options => options.map(option => option.value)), ['0:3']);
  await app.locator('[data-action=create-page-manage]').click();
  assert.equal(await app.locator('details[data-form=flipbook][open]').count(), 1, '페이지 관리로 이동한다');
  await app.locator('[data-action=settings]').click();
  await newRows(1, '설정을 다녀와도 새 플립북이 남는다');
  await app.locator('.list .new-row').click();
  const option = app.locator('.create-screen-option').filter({ hasText: 'STB_HO_001' }).first();
  await option.waitFor();
  assert.ok((await app.locator('.create-category-heading').first().innerText()).includes('홈'), '화면 후보를 카테고리로 나눈다');
  await app.locator('.create-category-heading').first().click();
  assert.equal(await app.locator('.create-screen-list .create-screen-option').count(), 0, '카테고리를 접는다');
  await app.locator('.create-category-heading').first().click();
  assert.equal(await app.locator('.create-screen-list .create-screen-option').count(), 1, '카테고리를 다시 펼친다');
  assert.equal(await option.locator('.create-unused-dot').getAttribute('title'), '제작된 플립북 없음');
  await app.locator('[data-input=create-query]').fill('없는 화면');
  assert.equal(await app.locator('.create-screen-list .create-screen-option').count(), 0, '오른쪽 화면 목록을 검색한다');
  await app.locator('[data-input=create-query]').fill('');
  // 화면 선택에서 마우스를 올리면 GUI 썸네일을 보여 준다.
  await option.hover();
  await page.locator('#app .thumb-hover img').waitFor();
  await page.waitForFunction(() => document.querySelector('#app .thumb-hover img')?.naturalHeight === 1600);
  const hoverBounds = await app.evaluate(root => {
    const box = root.querySelector('.thumb-hover').getBoundingClientRect();
    const host = root.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, hostTop: host.top, hostBottom: host.bottom, scrollHeight: root.scrollHeight, clientHeight: root.clientHeight };
  });
  assert.ok(hoverBounds.top >= hoverBounds.hostTop && hoverBounds.bottom <= hoverBounds.hostBottom, '긴 썸네일은 창 안쪽 위로 띄운다');
  assert.ok(hoverBounds.scrollHeight <= hoverBounds.clientHeight, '썸네일 마우스오버로 세로 스크롤이 생기지 않는다');
  await shot('03-create-view');
  await option.locator('[data-action=create-screen-toggle]').check();
  await shot('03-create-selected');
  assert.equal(await app.locator('.detail .create-plan-ids, .detail .id-tag:not(.create-screen-option .id-tag)').count(), 0, '선택된 화면 위에 ID를 따로 표시하지 않는다');
  assert.equal(await app.locator('.detail .edit-head h2').innerText(), '플립북 편집', '머리에는 「플립북 편집」을 둔다');
  assert.ok(await app.locator('.new-place').evaluate(place => {
    const [pageField, section, title] = [place.querySelector('[data-input=new-page]'), place.querySelector('[data-input=new-section]'), place.querySelector('[data-input=new-title]')].map(el => el.getBoundingClientRect());
    return pageField.bottom <= section.top && section.bottom <= title.top && Math.abs(pageField.left - section.left) < 1 && Math.abs(section.left - title.left) < 1;
  }), '페이지 → 섹션 → 제목을 한 줄씩 위아래로 놓는다');
  assert.ok(await app.locator('.detail .edit-head').evaluate(head => {
    const [title, hint, cancel, cta] = [head.querySelector('h2'), head.querySelector('.edit-title .note'), head.querySelector('[data-action=new-clear]'), head.querySelector('[data-action=create-submit]')];
    const [t, h, c, b] = [title, hint, cancel, cta].map(el => el.getBoundingClientRect());
    return hint.textContent.startsWith('만들기 전까지 저장 안 함') && cancel.textContent === '취소' && Math.abs(h.left - t.left) < 1 && h.top >= t.bottom - 1 && h.right <= c.left && c.right <= b.left;
  }), '왼쪽에 제목과 안내, 오른쪽에 취소·만들기를 둔다');
  assert.equal(await app.locator('.list .new-row .name').innerText(), initialName, '목록에는 첫 화면 이름을 제목으로 보여 준다');
  assert.ok((await app.locator('.list .section-group').filter({ has: page.locator('.new-row') }).locator('.section-label').innerText()).includes('홈'), '화면 카테고리 Section에 놓는다');
  assert.equal(await app.locator('.detail [data-input=new-title]').inputValue(), initialName, '오른쪽 제목은 첫 화면 이름이 채워진 입력란이다');
  assert.equal(await app.locator('.detail [data-action=new-edit-title]').count(), 0, '오른쪽 제목에는 연필이 없다');
  assert.ok(await app.locator('.list .new-row.selected').evaluate(row => row.querySelector('.name').getBoundingClientRect().right <= row.querySelector('[data-action=new-edit-title]').getBoundingClientRect().left), '연필은 목록 이름 오른쪽에 있다');
  assert.ok(await app.locator('.create-selected-box').evaluate(el => el.getBoundingClientRect().height >= 165), '선택된 화면 박스 높이를 확보한다');
  assert.equal(await app.locator('.create-selected-list .create-screen-option').count(), 1, '선택 화면은 위쪽 별도 박스로 이동한다');
  assert.equal(await app.locator('.create-screen-list .create-screen-option').count(), 0, '선택 화면을 후보 목록에 중복 표시하지 않는다');
  await app.locator('.create-selected-list [data-action=create-screen-toggle]').click();
  assert.equal(await app.locator('.create-screen-list .create-screen-option').count(), 1, '체크 해제한 화면은 후보 목록으로 돌아간다');
  await app.locator('.create-screen-list [data-action=create-screen-toggle]').click();
  await app.locator('.list .new-row.selected [data-action=new-edit-title]').click();
  assert.equal(await app.locator('.list [data-input=new-title]').getAttribute('placeholder'), initialName, '목록 연필을 누르면 그 행이 실제 화면 이름을 안내하는 입력으로 바뀐다');
  await app.locator('.list [data-input=new-title]').press('Enter');
  await app.locator('.list [data-input=new-title]').waitFor({ state: 'detached', timeout: 3000 }); // Enter로 목록 입력을 닫는다(목록은 다음 프레임에 다시 그린다)
  await app.locator('[data-input=create-screen-scale]').selectOption('0.5');
  assert.equal(await app.locator('[data-input=create-bulk-scale]').inputValue(), '0.5', '선택된 화면 제목에서 일괄 크기를 보여 준다');
  // 새 플립북을 하나 더 넣으면 고른 항목 바로 다음에 들어간다.
  await app.locator('[data-action=new-add]').click();
  await newNames([initialName, '새 플립북']);
  assert.equal(await app.locator('.detail .create-plan-ids').count(), 0, '화면이 없는 새 플립북에는 ID 영역을 만들지 않는다');
  assert.equal(await app.locator('.create-screen-list .create-unused-dot.planned').getAttribute('title'), '생성 목록에서 선택됨', '다른 새 플립북에 고른 화면은 회색 점이다');
  await app.locator('.create-switch').click();
  assert.equal(await app.locator('.create-screen-list .create-screen-option').count(), 0, '노란 점 필터는 새 플립북에 고른 화면을 제외한다');
  await app.locator('.create-switch').click();
  assert.equal(await app.locator('.detail [data-input=new-title]').inputValue(), '새 플립북', '화면이 없으면 제목 기본값은 「새 플립북」이다');
  // 목록의 이름을 더블클릭하면 그 행에서 바로 고친다.
  await app.locator('.list .new-row.selected .name').dblclick();
  await app.locator('.list .new-row [data-input=new-title]').waitFor({ timeout: 3000 }); // 목록 이름을 더블클릭하면 그 행이 입력으로 바뀐다
  await app.locator('.list .new-row [data-input=new-title]').fill('정책 안내');
  assert.equal(await app.locator('.detail [data-input=new-title]').inputValue(), '정책 안내', '목록에서 고치는 동안 오른쪽 제목도 바뀐다');
  await app.locator('.list .new-row [data-input=new-title]').press('Enter');
  await newNames([initialName, '정책 안내'], '입력한 제목을 목록에 보여 준다');
  // 화면을 우클릭하면 그 화면 하나로 된 새 플립북을 추가하고, 고른 항목은 그대로 둔다.
  await app.locator('.create-screen-option').filter({ hasText: 'STB_HO_001' }).first().click({ button: 'right' });
  await newRows(3, '우클릭한 화면으로 새 플립북을 하나 추가한다');
  assert.equal(await app.locator('.list .new-row.selected .name').innerText(), '정책 안내', '우클릭해도 고른 항목은 바뀌지 않는다');
  await app.locator('.list .new-row').nth(2).locator('[data-action=new-remove]').click();
  await newRows(2, '목록에서 새 플립북을 지운다');
  // Alt+↑로 한 칸 위로 옮긴다.
  await app.locator('.list .new-row.selected').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await newNames(['정책 안내', initialName], 'Alt+↑로 자리를 옮긴다');
  // 새 Section을 만들어 그 Section에 놓는다.
  await app.locator('[data-action=new-section-add]').click();
  assert.equal(await app.locator('[data-action=new-section-cancel]').innerText(), '취소', '섹션 추가는 다른 입력처럼 취소로 닫는다');
  await app.locator('[data-input=new-section-name]').fill('안내');
  await app.locator('[data-input=new-section-name]').press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('#app .list .section-label')].some(head => head.textContent?.includes('안내')));
  assert.equal(await app.locator('[data-input=new-section] option:checked').innerText(), '안내', '새 Section을 고른다');
  // 다른 새 플립북을 드래그해 그 Section의 「정책 안내」 아래에 놓는다.
  const dragged = app.locator('.list .new-row').filter({ hasText: initialName });
  const targetRow = app.locator('.list .new-row').filter({ hasText: '정책 안내' });
  const box = await targetRow.boundingBox();
  await dragged.dragTo(targetRow, { targetPosition: { x: 20, y: box.height - 3 } });
  const sectionOf = async name => app.locator('.list .section-group').filter({ has: page.locator('.new-row').filter({ hasText: name }) }).locator('.section-label').innerText();
  await page.waitForFunction(name => [...document.querySelectorAll('#app .list .section-group')].some(group =>
    [...group.querySelectorAll('.new-row .name')].some(row => row.textContent === name) && group.querySelector('.section-label')?.textContent?.includes('안내')), initialName);
  assert.ok((await sectionOf(initialName)).includes('안내'), '드래그해서 다른 Section으로 옮긴다');
  await newNames(['정책 안내', initialName], '놓은 자리 순서');
  await shot('03b-create-arrange');
  // Section을 「화면 카테고리」로 되돌리면 홈 Section 맨 뒤로 간다.
  await app.locator('[data-input=new-section]').selectOption('');
  // 목록은 다음 프레임에 다시 그린다.
  await page.waitForFunction(name => [...document.querySelectorAll('#app .list .section-group')].some(group =>
    [...group.querySelectorAll('.new-row .name')].some(row => row.textContent === name) && group.querySelector('.section-label')?.textContent?.includes('홈')), initialName, { timeout: 3000 }).catch(() => {});
  assert.ok((await sectionOf(initialName)).includes('홈'), '화면 카테고리 Section으로 되돌린다');
  await app.locator('[data-action=create-submit]').click();
  await page.waitForFunction(() => document.querySelector('#app .toast')?.textContent?.includes('2개를 만들었습니다'));
  const createdLogs = (await page.locator('#log div').allTextContents()).filter(line => line.includes('플립북 반영'));
  assert.ok(createdLogs[1]?.includes('안내 / 정책 안내') && createdLogs[0]?.includes(`홈 / ${initialName}`), `목록 순서대로 정한 Section에 만든다: ${createdLogs.slice(0, 2)}`);
  await newRows(0, '만든 뒤 새 플립북 표시를 지운다');
  await page.waitForFunction(size => document.querySelector('#app').offsetHeight === size.height, sizeBeforeCreate);
  // 만든 플립북은 목록의 정한 Section에 보이고, 제목을 바로 바꿀 수 있다.
  const made = app.locator('.list .row').filter({ hasText: initialName }).first();
  await made.click();
  await app.locator('[data-action=fb-edit-title]').click();
  await app.locator('[data-input=fb-title]').fill('홈 메인 플립북');
  await app.locator('[data-input=fb-title]').press('Enter');
  await page.waitForFunction(() => document.querySelector('#app .toast')?.textContent?.includes('플립북 제목을 바꿨습니다'));
  await page.waitForFunction(() => [...document.querySelectorAll('#log div')].some(x => x.textContent?.includes('제목 변경: 홈 메인 플립북')));
  await page.waitForFunction(() => [...document.querySelectorAll('#app .list .row .name')].some(x => x.textContent === '홈 메인 플립북'));
  await shot('03c-rename');
  // 제목을 비우면 첫 화면 이름으로 돌아간다.
  await app.locator('.list .row.selected .name').dblclick();
  await app.locator('.list [data-input=fb-title]').fill('');
  await app.locator('.list [data-input=fb-title]').press('Enter');
  await page.waitForFunction(name => document.querySelector('#app .detail h2')?.textContent === name, initialName);
  // 화면 편집(2026-10-26): 기존 플립북의 화면을 빼고 넣거나 크기를 바꿔 적용하면 GUI 영역을 다시 반영한다. 끝나면 원래대로 둔다.
  // (이 시점에는 배포한 화면이 하나뿐이다. 두 화면의 순서 바꾸기는 새 플립북과 같은 「선택된 화면」 드래그·Alt+↑↓다.)
  {
    const selectedUids = () => app.locator('.create-selected-list .create-screen-option').evaluateAll(nodes => nodes.map(n => n.dataset.uid));
    const applyButton = app.locator('[data-action=edit-screens-apply]');
    const small = await app.evaluate(root => ({ width: root.offsetWidth, height: root.offsetHeight }));
    await app.locator('[data-action=fb-edit-screens]').click();
    await app.locator('.detail.screen-edit-detail').waitFor();
    await page.waitForFunction(() => document.querySelector('#app').offsetHeight >= 800);
    assert.equal(await applyButton.isDisabled(), true, '바꾸기 전에는 적용할 수 없다');
    const [first] = await selectedUids();
    // 빼면 적용할 수 있고, 다시 넣으면 바뀐 것이 없다.
    await app.locator(`.create-selected-list input[value="${first}"]`).click();
    assert.deepEqual(await selectedUids(), []);
    assert.equal(await applyButton.isDisabled(), false);
    await app.locator(`.create-screen-list input[value="${first}"]`).click();
    assert.deepEqual(await selectedUids(), [first]);
    assert.equal(await applyButton.isDisabled(), true, '원래와 같으면 적용할 수 없다');
    // 우클릭해도 새 플립북을 넣지 않는다(화면 편집 중).
    await app.locator('.create-selected-list .create-screen-option').first().click({ button: 'right' });
    await newRows(0, '화면 편집에서는 우클릭으로 새 플립북을 넣지 않는다');
    // 크기를 바꿔 적용한다.
    await app.locator('.create-selected-list [data-input=create-screen-scale]').selectOption('0.25');
    assert.equal(await applyButton.isDisabled(), false);
    await shot('03c1-screen-edit');
    await applyButton.click();
    await page.waitForFunction(() => document.querySelector('#app .toast')?.textContent?.includes('플립북 화면을 바꿨습니다'));
    await page.waitForFunction(() => [...document.querySelectorAll('#log div')].some(x => x.textContent?.includes('플립북 화면 구성: STB_HO_001@0.25')));
    await app.locator('.detail .fb-screens-head').waitFor();
    await page.waitForFunction(size => document.querySelector('#app').offsetHeight === size.height, small);
    // 다시 열어 원래 크기로 되돌린다. 취소하면 바꾸지 않는다.
    await app.locator('[data-action=fb-edit-screens]').click();
    await app.locator('.create-selected-list [data-input=create-screen-scale]').selectOption('0.5');
    await app.locator('[data-action=edit-screens-cancel]').click();
    await app.locator('.detail .fb-screens-head').waitFor();
    await app.locator('[data-action=fb-edit-screens]').click();
    assert.equal(await app.locator('.create-selected-list [data-input=create-screen-scale]').inputValue(), '0.25', '취소한 편집은 남지 않는다');
    await app.locator('.create-selected-list [data-input=create-screen-scale]').selectOption('0.5');
    await applyButton.click();
    await page.waitForFunction(() => [...document.querySelectorAll('#log div')].some(x => x.textContent?.includes('플립북 화면 구성: STB_HO_001@0.5')));
    await app.locator('.detail .fb-screens-head').waitFor();
    assert.match(await app.locator('.detail .fb-screens-head .note').innerText(), /화면 1개/);
    await page.waitForFunction(name => document.querySelector('#app .detail h2')?.textContent === name, initialName);
  }
  // 기존 플립북도 드래그해 다른 Section으로 옮긴다(2026-10-22). 만들기 전까지는 목록에서만 옮기고, 캔버스 배치에 반영할지 묻는다.
  {
    const groupOfRow = name => app.locator('.list .section-group').filter({ has: page.locator('.row:not(.new-row) .name', { hasText: name }) }).locator('.section-label').innerText();
    const inGroup = (name, section) => page.waitForFunction(([name, section]) => [...document.querySelectorAll('#app .list .section-group')].some(group =>
      [...group.querySelectorAll('.row:not(.new-row) .name')].some(row => row.textContent === name) && group.querySelector('.section-label')?.textContent?.includes(section)), [name, section], { timeout: 3000 });
    const dragToHome = () => app.locator('.list .row:not(.new-row)').filter({ has: page.locator('.name', { hasText: '정책 안내' }) })
      .dragTo(app.locator('.list .section-label').filter({ hasText: /^홈$/ }));
    await dragToHome();
    await inGroup('정책 안내', '홈');
    assert.match(await app.locator('.toolbar .pending-line').innerText(), /옮긴 플립북 1개/, '옮긴 기존 플립북 수를 목록 위 줄에 보여 준다');
    assert.equal(await app.locator('[data-action=create-submit]').innerText(), '배치 반영', '새 플립북이 없으면 배치 반영 버튼이다');
    await shot('03c2-pending-line');
    await app.locator('[data-action=create-submit]').click();
    await app.locator('.arrange-overlay:not([hidden]) .arrange-dialog').waitFor();
    await shot('03d-arrange-ask');
    // 반영하지 않으면 기존 플립북은 원래 순서로 돌아간다.
    await app.locator('[data-action=arrange-skip]').click();
    await inGroup('정책 안내', '안내');
    assert.equal(await app.locator('.arrange-overlay').isHidden(), true);
    assert.equal(await app.locator('.toolbar .pending-line').count(), 0, '옮긴 플립북이 없으면 목록 위 줄을 비운다');
    // 반영하면 캔버스에서도 옮긴다.
    await dragToHome();
    await inGroup('정책 안내', '홈');
    await app.locator('[data-action=create-submit]').click();
    await app.locator('[data-action=arrange-apply]').click();
    await page.waitForFunction(() => document.querySelector('#app .toast')?.textContent?.includes('기존 플립북 1개를 옮겼습니다'));
    await page.waitForFunction(() => [...document.querySelectorAll('#log div')].some(x => x.textContent?.includes('플립북 옮김: 홈')));
    await inGroup('정책 안내', '홈');
    assert.ok((await groupOfRow('정책 안내')).includes('홈'), '반영한 뒤에도 옮긴 Section에 있다');
    await app.locator('.list .row:not(.new-row)').filter({ has: page.locator('.name', { hasText: initialName }) }).click();
  }
  // 모든 화면에 플립북이 있으면 노란 점 필터와 일괄 만들기 대상이 없다. 「모두 취소」는 두 번 눌러 지운다.
  await app.locator('[data-action=new-add]').click();
  await app.locator('.create-switch').click();
  assert.equal(await app.locator('.create-screen-list .create-screen-option').count(), 0, '스위치가 노란 점 없는 화면을 숨긴다');
  await app.locator('.list-actions [data-action=bulk-open]').click();
  assert.equal(await app.locator('.bulk-dialog .bulk-screen-list').innerText(), '플립북이 없는 화면이 없습니다.', '모든 화면에 플립북이 있으면 일괄 만들기 대상이 없다');
  await app.locator('[data-action=bulk-close]').click();
  // 취소는 모달로 확인한다. 계속 편집하면 그대로 두고, 모두 취소하면 새 플립북을 모두 지운다.
  await app.locator('[data-action=new-clear]').click();
  await app.locator('.arrange-overlay:not([hidden]) .cancel-dialog').waitFor();
  await shot('03e-cancel-ask');
  await app.locator('[data-action=new-dialog-close]').click();
  assert.equal(await app.locator('.arrange-overlay').isHidden(), true);
  await newRows(1, '계속 편집하면 새 플립북이 남는다');
  await app.locator('[data-action=new-clear]').click();
  await app.locator('[data-action=new-cancel-confirm]').click();
  await newRows(0, '모두 취소하면 새 플립북을 모두 지운다');

  // 한 파일의 다른 UI 페이지에도 플립북을 만든다.
  await app.locator('[data-action=settings]').click();
  await app.locator('[data-form=flipbook] [data-f=page]').selectOption('0:2');
  await page.waitForFunction(() => document.querySelectorAll('#app [data-form=flipbook] .scope-page').length === 2);
  await app.locator('[data-action=settings]').click();
  await app.locator('[data-action=new-add]').click();
  await app.locator('[data-input=new-page]').selectOption('0:2');
  // 오른쪽 제목 입력란에 바로 입력한다.
  await app.locator('.detail [data-input=new-title]').fill('다른 페이지 정책');
  await app.locator('.detail [data-input=new-title]').press('Enter');
  const pageOf = name => app.locator('.list .group').filter({ has: page.locator('.new-row').filter({ hasText: name }) }).locator('.group-head').innerText();
  assert.ok((await pageOf('다른 페이지 정책')).includes('UI 플립북'), '고른 페이지의 Section으로 옮긴다');
  assert.notEqual(await sectionOf('다른 페이지 정책'), '정책', '화면이 없다고 「정책」 Section에 넣지 않는다');
  await app.locator('[data-action=create-submit]').click();
  await page.waitForFunction(() => document.querySelector('#app .toast')?.textContent?.includes('1개를 만들었습니다'));

  // UI Flipbook은 배포하지 않는다. 변경사항 확인·배포 체크·배포 버튼 없이 만든 플립북 목록을 바로 보여 준다.
  assert.equal(await app.locator('[data-action=scan]').count(), 0, 'UI Flipbook에는 변경사항 확인이 없다');
  assert.equal(await app.locator('[data-action=prepare]').count(), 0, 'UI Flipbook에는 배포 버튼이 없다');
  assert.equal(await app.locator('.list [data-action=include], .list [data-action=include-all]').count(), 0, 'UI Flipbook에는 배포 체크가 없다');
  assert.match(await app.locator('.review-count').innerText(), /확인이 필요한 플립북 0개/);
  for (const head of await app.locator('.group-head').all())
    if (await head.getAttribute('aria-expanded') === 'false') await head.click();
  // 두 페이지에 만든 플립북 3개를 모두 보여 준다.
  await page.waitForFunction(() => document.querySelectorAll('#app .list .row').length === 3);
  const groupNames = await app.locator('.group-head').allInnerTexts();
  assert.ok(['UI 플립북', 'UI 두 번째 페이지'].every(page => groupNames.some(name => name.includes(page))), '페이지별로 묶는다');
  await app.locator('.row').filter({ hasText: initialName }).first().click();
  // 플립북을 고르면 들어 있는 화면의 GUI 썸네일을 보여 준다.
  await app.locator('.detail .thumbs img').waitFor();
  assert.equal(await app.locator('.detail [data-field=workerId]').count(), 0, '작업자 입력이 없다');
  // 오른쪽 아래 확인 영역은 수정된 화면이 없어도 항상 보이며, 상태는 기본 태그 「최신」이다.
  await app.locator('.detail .fb-bottom').waitFor();
  assert.equal(await app.locator('.fb-bottom .tag-picker summary .chip').innerText(), '최신');
  assert.equal(await app.locator('.fb-bottom [data-action=mark-reviewed]').isEnabled(), true);
  await shot('04-ui-list');
  // 목록 새로고침: 캔버스 선택만으로는 목록을 맞추지 않으므로 새로고침 아이콘으로 플립북 페이지를 다시 읽고 동기화 시각을 보여 준다.
  {
    await app.locator('.sync-status [data-action=refresh-list]').click();
    await page.waitForFunction(() => !document.querySelector('#app .sync-status .spinning'));
    assert.match(await app.locator('.sync-status span').innerText(), /^동기화 \d{2}:\d{2}$/, '새로고침이 끝나면 동기화 시:분을 보여 준다');
    assert.match(await app.locator('.sync-status span').getAttribute('title'), /^마지막 동기화 \d{4}-\d{2}-\d{2} /, '마우스를 올리면 날짜까지 보인다');
  }

  // 플로우 탭: 배포된 화면을 썸네일로 판에 놓고(격자는 위치 스냅), 썸네일 점을 끌어 다른 썸네일에 이어 플로우를 만든다(FigJam처럼).
  {
    await app.locator('.tabs [data-action=flow-open]').click();
    const screens = app.locator('.flow-view .flow-screen');
    await screens.first().waitFor();
    const flowCategory = app.locator('.flow-view .flow-category-label').first();
    assert.equal(await flowCategory.locator('.group-name').innerText(), '홈', 'GUI 화면 목록과 같은 카테고리로 구분한다');
    await flowCategory.click();
    assert.equal(await flowCategory.getAttribute('aria-expanded'), 'false', '카테고리를 접으면 화면을 숨긴다');
    await flowCategory.click();
    assert.equal(await flowCategory.getAttribute('aria-expanded'), 'true', '카테고리를 다시 펼칠 수 있다');
    const cards = app.locator('.flow-view .flow-card');
    const links = app.locator('.flow-view .flow-link:not(.preview)');
    const create = app.locator('.flow-view [data-action=flow-create]');
    assert.equal(await app.locator('.list').isVisible(), false, '플로우 탭은 목록 대신 보인다');
    assert.ok(await screens.first().getAttribute('data-thumb'), '배포된 화면에 마우스를 올리면 썸네일을 보여 준다');
    await screens.nth(0).click();
    assert.equal(await create.isDisabled(), true, '화면 2개부터 만든다');
    // 이 시점에는 배포된 화면이 하나다. 같은 화면을 여러 번 놓을 수 있다.
    await screens.nth(0).click();
    assert.equal(await cards.count(), 2);
    assert.equal(await create.isEnabled(), true);
    const spots = await cards.evaluateAll(els => els.map(el => [el.offsetLeft, el.offsetTop]));
    // 480×270 썸네일이 판 배율 0.3으로 144×81, 화면 간격 80은 24px이다.
    assert.deepEqual(spots[1], [spots[0][0] + 168, spots[0][1]], '누르면 첫 빈 자리(같은 줄, 화면 간격 80 뒤)에 놓는다');
    assert.equal(await cards.nth(0).locator('.flow-card-id').innerText(), 'STB_HO_001', '썸네일 왼쪽 위에 Screen ID');
    await cards.first().locator('img').waitFor();
    assert.equal(await cards.first().getAttribute('data-thumb'), null, '판에 썸네일이 보이므로 마우스를 올린 미리보기는 띄우지 않는다');
    assert.deepEqual(await cards.first().evaluate(el => [el.offsetWidth, el.offsetHeight]), [144, 81], '썸네일은 캔버스 크기에 판 배율을 곱한 크기');
    assert.equal(await app.locator('.flow-view .flow-board').evaluate(el => getComputedStyle(el).overflow), 'hidden', '판에는 스크롤 막대가 없다');
    // 판은 Figma 캔버스처럼 움직인다: 가운데 버튼으로 끌기, 휠
    {
      const boardBox = await app.locator('.flow-view .flow-board').boundingBox();
      const empty = { x: boardBox.x + boardBox.width - 10, y: boardBox.y + boardBox.height - 10 };
      const before = await cards.nth(0).boundingBox();
      await page.mouse.move(empty.x, empty.y);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(empty.x - 40, empty.y - 20, { steps: 4 });
      await page.mouse.up({ button: 'middle' });
      const panned = await cards.nth(0).boundingBox();
      assert.deepEqual([Math.round(panned.x - before.x), Math.round(panned.y - before.y)], [-40, -20], '가운데 버튼으로 끌면 판이 움직인다');
      await page.mouse.wheel(0, -20);
      await page.waitForFunction(y => Math.round(document.querySelector('#app .flow-card').getBoundingClientRect().y) === y, Math.round(before.y));
      // 처음 자리로 되돌린다.
      await page.mouse.move(empty.x, empty.y);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(empty.x + 40, empty.y, { steps: 4 });
      await page.mouse.up({ button: 'middle' });
      const back = await cards.nth(0).boundingBox();
      assert.deepEqual([Math.round(back.x), Math.round(back.y)], [Math.round(before.x), Math.round(before.y)], '휠로 세로로 움직인다');
      // Ctrl+휠로 포인터 자리를 두고 확대·축소한다.
      await page.mouse.move(back.x, back.y);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -100);
      await page.waitForFunction(() => document.querySelector('#app .flow-card').offsetWidth > 144);
      const zoomed = await cards.nth(0).boundingBox();
      assert.deepEqual([Math.round(zoomed.x), Math.round(zoomed.y)], [Math.round(back.x), Math.round(back.y)], '포인터 아래 자리는 그대로다');
      await page.mouse.wheel(0, 100);
      await page.waitForFunction(() => document.querySelector('#app .flow-card').offsetWidth === 144);
      await page.keyboard.up('Control');
    }
    const drag = async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
      await page.mouse.move(to.x, to.y, { steps: 4 });
      await page.mouse.up();
    };
    const center = async locator => { const b = await locator.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const rightDot = async i => { const b = await cards.nth(i).boundingBox(); return { x: b.x + b.width, y: b.y + b.height / 2 }; };
    // 첫 카드의 오른쪽 점을 끌어 둘째 카드에 놓는다.
    await cards.nth(0).hover();
    await drag(await rightDot(0), await center(cards.nth(1)));
    assert.equal(await links.count(), 1, '점을 끌어 다른 카드에 놓으면 화살표로 잇는다');
    const straight = await links.first().getAttribute('d');
    // 둘째 썸네일을 아래로 옮기면 격자에 맞춰 놓이고 화살표가 꺾인다.
    {
      const from = await center(cards.nth(1));
      await drag(from, { x: from.x + 5, y: from.y + 125 });
    }
    assert.equal(await links.count(), 1);
    assert.deepEqual(await cards.nth(1).evaluate(el => [el.offsetLeft, el.offsetTop]), [168, 120], '끌어 놓은 자리는 격자(40 = 12px)에 맞춘다');
    assert.ok((await links.first().getAttribute('d')).split('L').length > straight.split('L').length, '줄이 어긋나면 꺾인 화살표가 된다');
    // 화살표를 골라 Delete로 지우고 다시 잇는다.
    await app.locator('.flow-view .flow-link-hit').first().dispatchEvent('pointerdown', { button: 0, pointerId: 1, isPrimary: true });
    await page.keyboard.press('Delete');
    assert.equal(await links.count(), 0, '고른 화살표는 Delete로 지운다');
    await cards.nth(0).hover();
    await drag(await rightDot(0), await center(cards.nth(1)));
    assert.equal(await links.count(), 1);
    await app.locator('.flow-view [data-flow=title]').fill('홈 진입 플로우');
    await shot('04b-flow-tab');
    await create.click();
    await page.waitForFunction(() => document.querySelector('#app .toast')?.textContent?.includes('플로우를 만들었습니다'));
    await page.waitForFunction(() => [...document.querySelectorAll('#log div')].some(x => x.textContent?.includes('플로우: 홈 진입 플로우') && x.textContent.includes('(0,0).right→STB_HO_001(560,400).left')));
    // 이력 아이콘: 만든 플로우 목록을 모달로 보여 주고, 플로우·화면을 누르면 캔버스의 그 자리로 간다.
    await app.locator('.flow-view [data-action=flow-list]').click();
    const made = app.locator('.flow-list-overlay .flow-list li');
    await made.first().waitFor();
    assert.equal(await made.count(), 1);
    assert.equal(await made.first().locator('.flow-list-title').innerText(), '홈 진입 플로우');
    assert.deepEqual(await made.first().locator('.flow-list-screen .id-tag').allInnerTexts(), ['STB_HO_001'], '같은 화면을 여러 번 놓아도 한 번만 보인다');
    await shot('04c-flow-list');
    await made.first().locator('.flow-list-screen').first().click();
    await page.waitForFunction(() => [...document.querySelectorAll('#log div')].some(x => x.textContent?.includes('캔버스 이동') && x.textContent.includes('flow:')));
    await page.keyboard.press('Escape');
    assert.equal(await app.locator('.flow-list-overlay').count(), 0, 'Esc로 목록을 닫는다');
    assert.equal(await cards.count(), 2, '목록을 여닫아도 판의 썸네일은 그대로다');
    // PDF 저장 탭: 다른 탭처럼 목록 대신 열리고, 고른 프레임이 없으면 저장할 수 없다(미리보기 캔버스에는 프레임 선택이 없다).
    await app.locator('.tabs [data-action=pdf-open]').click();
    await app.locator('.pdf-view').waitFor();
    assert.equal(await app.locator('.flow-view').count(), 0);
    assert.equal(await app.locator('.pdf-view .pdf-count').innerText(), '저장할 프레임을 캔버스에서 선택하세요.');
    assert.equal(await app.locator('.pdf-view [data-action=pdf-export]').isDisabled(), true);
    await shot('04d-pdf-tab');
    // 미리보기 도구로 플립북 프레임을 고르면 저장할 수 있다. 저장 중에는 실행 버튼이 취소가 되고, 누르면 파일을 만들지 않는다.
    await page.locator('#tools [data-pick-flipbooks]').click();
    const exportButton = app.locator('.pdf-view [data-action=pdf-export]');
    await page.waitForFunction(() => document.querySelector('#app .pdf-view [data-action=pdf-export]')?.disabled === false);
    assert.match(await app.locator('.pdf-view .pdf-count').innerText(), /^선택한 프레임 \d+개$/);
    let downloads = 0;
    const countDownload = () => { downloads++; };
    page.on('download', countDownload);
    await exportButton.click();
    await app.locator('.pdf-view [data-action=pdf-cancel]').click();
    await exportButton.waitFor();
    assert.equal(downloads, 0, '취소하면 파일을 만들지 않는다');
    page.off('download', countDownload);
    const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
    assert.match(download.suggestedFilename(), /\.pdf$/, '고른 프레임을 한 PDF로 내려받는다');
    await page.locator('#tools [data-pick-flipbooks]').click();
    await app.locator('.tabs [data-action=text-close]').click();
    assert.equal(await app.locator('.list').isVisible(), true);
  }

  await mode('GUI');
  await page.locator(`#tools [data-edit="${initialNodeId}"]`).click();
  await scan();
  for (const head of await app.locator('.group-head').all())
    if (await head.getAttribute('aria-expanded') === 'false') await head.click();
  await app.locator('.row').first().waitFor();
  await page.waitForTimeout(100);
  const changed = app.locator('.row:has(.id-tag)').filter({ hasText: initialName }).first();
  assert.equal(await changed.locator('.id-tag').innerText(), 'STB_HO_001', '배포된 화면은 이름 왼쪽에 Screen ID 태그를 표시한다');
  assert.equal(await changed.locator('.name').innerText(), initialName, '이름에 Screen ID를 중복 표시하지 않는다');
  await changed.click();
  await changed.locator('[data-action=include]').check();
  assert.equal(await app.locator('[data-field=relation][value=standalone]').isChecked(), true, '배포된 화면의 독립·케이스 관계도 편집할 수 있다');
  await app.locator('[data-field=relation][value=case]').check();
  assert.equal(await app.locator('.detail .screen-picker summary[aria-label="기본 화면 선택"]').count(), 1);
  await app.locator('[data-field=relation][value=standalone]').check();
  assert.equal(await app.locator('[data-field=code]').inputValue(), 'STB_HO_001', '관계 변경은 기존 Screen ID를 바꾸지 않는다');
  const existingName = app.locator('[data-field=name]');
  assert.equal(await existingName.inputValue(), initialName, '배포된 화면 이름을 입력란에서 수정할 수 있다');
  await existingName.fill('수정한 화면 이름');
  await page.waitForFunction(() => [...document.querySelectorAll('#app .row .name')].some(node => node.textContent === '수정한 화면 이름'));
  await existingName.fill(initialName);
  await app.locator('[data-field=code]').fill('STB_HO_002');
  await page.waitForFunction(name => [...document.querySelectorAll('#app .row')].some(row => row.querySelector('.name')?.textContent === name && row.querySelector('.id-tag')?.textContent === 'STB_HO_002'), initialName);
  await app.locator('[data-field=code]').fill('STB_HO_001');
  // 추가 설명은 화면별이 아니라 아래쪽에 배포 한 번에 하나를 쓴다.
  await app.locator('.footer [data-input=comment]').fill('홈 화면 구성 변경');
  await app.locator('.tag-picker summary[aria-label="태그 선택"]').click();
  await app.locator('.tag-options [data-action=select-tag]').filter({ hasText: '검토' }).click();
  await app.locator('[data-action=prepare]').click();
  await app.locator('[data-action=commit]').click();
  // 같은 파일이므로 GUI Publish 직후 그 화면을 쓰는 플립북에 바로 반영한다.
  await page.waitForFunction(() => document.querySelector('#app .toast')?.textContent?.includes('GUI 갱신'));
  await shot('05-gui-updated');
  assert.match(await app.locator('.toast').innerText(), /플로우 1개의 썸네일을 바꿨습니다/, '다시 배포한 화면이 든 플로우의 썸네일을 바꾼다');

  await mode('UI');
  // 플립북에 「화면이 수정되었습니다」 빨간 점과 목록 위에 확인이 필요한 개수를 표시한다. 변경사항 확인을 누르지 않아도 보인다.
  await app.locator('.review-count').waitFor();
  assert.match(await app.locator('.review-count').innerText(), /확인이 필요한 플립북 1개/);
  for (const head of await app.locator('.group-head').all())
    if (await head.getAttribute('aria-expanded') === 'false') await head.click();
  await page.waitForFunction(() => document.querySelectorAll('#app .list .row').length === 3);
  assert.equal(await app.locator('.row .review-dot').count(), 1);
  assert.equal(await app.locator('.row .review-dot').getAttribute('title'), '화면이 수정되었습니다');
  // 접힌 그룹에 확인이 필요한 플립북이 있으면 머리 맨 오른쪽에 빨간 점을 둔다. 개수는 그룹 이름 바로 오른쪽이다.
  {
    const pageKey = await app.locator('.list .group').filter({ has: page.locator('.row .review-dot') }).locator('.group-head').getAttribute('data-page');
    const head = app.locator(`.list .group-head[data-page="${pageKey}"]`);
    assert.equal(await head.locator('.review-dot').count(), 0, '펼친 그룹 머리에는 빨간 점이 없다');
    await head.click();
    await head.locator('.review-dot').waitFor({ timeout: 3000 });
    assert.ok(await head.evaluate(el => {
      const [name, count, dot, box] = [el.querySelector('.group-name'), el.querySelector('.count'), el.querySelector('.review-dot'), el].map(n => n.getBoundingClientRect());
      return count.left - name.right < 12 && Math.abs(box.right - dot.right) < 12;
    }), '개수는 이름 바로 오른쪽, 빨간 점은 맨 오른쪽에 있다');
    await shot('05b-ui-group-flagged');
    await head.click();
    await page.waitForFunction(() => document.querySelectorAll('#app .list .row').length === 3);
  }
  await app.locator('[data-action=changed-only]').check();
  // 확인이 필요한 플립북 줄 오른쪽 끝 버튼으로 오른쪽 영역을 접고 펼친다. 접으면 창 너비가 목록 너비로 준다.
  const detailToggle = app.locator('.review-line [data-action=toggle-detail]');
  const before = await widths();
  const pressed = value => page.waitForFunction(v => document.querySelector('#app .review-line [data-action=toggle-detail]')?.getAttribute('aria-pressed') === v, value, { timeout: 3000 }).catch(() => {});
  const panes = () => app.evaluate(root => ({
    hidden: getComputedStyle(root.querySelector('.detail')).display === 'none' && getComputedStyle(root.querySelector('.pane-divider')).display === 'none',
    root: Math.round(root.getBoundingClientRect().width),
    inside: ['.list', '.review-line [data-action=toggle-detail]', '[data-action=settings]', '[data-action=tutorial]'].every(sel => root.querySelector(sel).getBoundingClientRect().right <= root.getBoundingClientRect().right + 1),
  }));
  await detailToggle.click();
  await pressed('true');
  assert.deepEqual(await panes(), { hidden: true, root: Math.round(before.list), inside: true }, '접으면 오른쪽 영역이 사라지고 창이 목록 너비로 준다');
  await shot('06b-ui-detail-collapsed');
  // 접은 채 플립북을 골라도 오른쪽 영역은 나타나지 않고 목록이 그대로 보인다.
  await app.locator('.list .row').first().click();
  await page.waitForFunction(() => document.querySelector('#app .list .row.selected'));
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  assert.deepEqual(await panes(), { hidden: true, root: Math.round(before.list), inside: true }, '접은 채 플립북을 골라도 오른쪽 영역이 나타나지 않는다');
  assert.equal(await app.locator('.list').isVisible(), true);
  // 접어서 줄인 창에서도 튜토리얼을 넓혀 보여 준 뒤 접은 너비로 되돌린다.
  await tutorial('06c-tutorial-ui');
  assert.deepEqual(await panes(), { hidden: true, root: Math.round(before.list), inside: true }, '튜토리얼을 끝내면 접은 창 너비로 돌아간다');
  await detailToggle.click();
  await pressed('false');
  assert.deepEqual(await panes(), { hidden: false, root: Math.round(before.root), inside: true }, '펼치면 접기 전 창 너비로 돌아간다');
  // 접은 채 새 플립북을 넣으면 오른쪽 영역을 펼친다.
  await detailToggle.click();
  await pressed('true');
  await app.locator('[data-action=new-add]').click();
  await pressed('false');
  assert.equal((await panes()).hidden, false, '새 플립북은 오른쪽 영역을 펼쳐 정한다');
  await app.locator('.list .new-row [data-action=new-remove]').click();
  await newRows(0, '확인용 새 플립북을 지운다');
  // 업데이트된 화면만 보기는 확인이 필요한 플립북만 남긴다.
  assert.equal(await app.locator('.list .switch span').innerText(), '업데이트된 화면만 보기');
  await page.waitForFunction(() => document.querySelectorAll('#app .list .row').length === 1);
  const flagged = app.locator('.row').filter({ has: page.locator('.review-dot') }).first();
  await flagged.click();
  await app.locator('.detail .fb-bottom.flagged').waitFor();
  assert.equal(await app.locator('.fb-bottom .review-screens li').count(), 1, '아래 영역에 수정된 화면을 보여 준다');
  assert.equal(await app.locator('.detail .thumbs figcaption .review-dot').count(), 1, '썸네일에도 수정된 화면을 표시한다');
  // 상태를 비우면 확인 완료를 막는다(필수). 다시 「최신」을 고르고 코멘트(선택)를 쓴다.
  await app.locator('.fb-bottom .tag-picker summary').click();
  await app.locator('.fb-bottom .tag-options [data-action=select-tag][data-id=""]').click();
  assert.equal(await app.locator('.fb-bottom [data-action=mark-reviewed]').isDisabled(), true, '상태는 필수');
  await app.locator('.fb-bottom .tag-picker summary').click();
  await app.locator('.fb-bottom .tag-options [data-action=select-tag]').filter({ hasText: '최신' }).click();
  await app.locator('.fb-bottom [data-field=description]').fill('콜아웃 위치 확인');
  await shot('06-ui-review');
  await app.locator('[data-action=mark-reviewed]').click();
  await page.waitForFunction(() => document.querySelector('#app .toast')?.textContent?.includes('확인 완료'));
  await page.waitForFunction(() => document.querySelector('#app .review-count')?.textContent?.includes('확인이 필요한 플립북 0개'));
  assert.equal(await app.locator('.detail .fb-bottom.flagged').count(), 0, '확인 완료하면 빨간 점이 풀린다');
  assert.equal(await app.locator('.detail .fb-bottom').count(), 1, '확인 영역은 계속 보인다');
  assert.equal(await app.locator('.fb-bottom [data-field=description]').inputValue(), '', '코멘트를 비운다');
  // 확인 완료의 상태·코멘트는 플립북 이력에 남는다.
  await page.waitForFunction(() => document.querySelector('#app .detail .history')?.textContent?.includes('콜아웃 위치 확인'));
  await page.waitForFunction(() => [...document.querySelectorAll('#log div')].some(x => x.textContent?.includes('최신(Black)')));
  await app.locator('[data-action=changed-only]').uncheck();
  await page.waitForFunction(() => document.querySelectorAll('#app .list .row').length === 3);
  assert.equal(await app.locator('.row .review-dot').count(), 0);
  await shot('06-ui-reviewed');

  // 변경 감지된 화면에 「변경 무시」를 누르면 버전을 올리지 않고 변경사항 없음으로 바뀐다.
  await mode('GUI');
  await page.locator(`#tools [data-edit="${initialNodeId}"]`).click();
  await scan();
  const noisy = app.locator('.row:has(.id-tag)').filter({ hasText: initialName }).first();
  await noisy.click();
  // 배포를 켜기 전에는 입력 영역이 없다.
  assert.equal(await app.locator('.detail [data-field=code]').count(), 0, 'inputs hidden until 배포 is checked');
  await shot('07-change-detected');
  await app.locator('[data-action=ignore-changes]').click();
  await page.waitForFunction(() => document.querySelector('#app .toast')?.textContent?.includes('변경을 무시했습니다'));
  await scan();
  assert.equal(await app.locator('.row:has(.id-tag)').filter({ hasText: initialName }).count(), 0, 'ignored screen leaves the changed-only list');
  await shot('08-ignored');

  // 신규 후보에서 기존 화면 교체를 고르면 두 화면의 상태가 함께 바뀌고, 배포를 끄면 함께 돌아간다.
  // 교체 대상은 변경 감지 상태로 만든다(변경 무시 비활성화 확인용).
  await page.locator(`#tools [data-edit="${initialNodeId}"]`).click();
  await scan();
  await app.locator('[data-action=changed-only]').uncheck();
  for (const head of await app.locator('.group-head').all())
    if (await head.getAttribute('aria-expanded') === 'false') await head.click();
  // 입력한 카테고리·관계에 따라 행이 다른 그룹으로 옮겨 가므로 처음 찾은 행의 키로 고정한다.
  const rowByKey = async (text, registered) => app.locator(`.row[data-key="${await app.locator(registered ? '.row:has(.id-tag)' : '.row:not(:has(.id-tag))').filter({ hasText: text }).first().getAttribute('data-key')}"]`);
  const candidate = await rowByKey('홈 메인', false);
  const target = await rowByKey(initialName, true);
  await candidate.click();
  await candidate.locator('[data-action=include]').check();
  assert.equal(await app.locator('[data-field=code]').inputValue(), '', 'new Screen ID starts empty');
  assert.equal(await app.locator('[data-field=code]').getAttribute('placeholder'), null, 'standalone screen has no suggested ID');
  await app.locator('[data-field=relation][value=case]').check();
  await app.locator('.screen-picker summary').click();
  await app.locator('.screen-picker [data-action=pick]').filter({ hasText: 'STB_HO_001' }).click();
  assert.equal(await app.locator('[data-field=code]').inputValue(), 'STB_HO_001-01', 'case ID is filled automatically');
  await app.locator('[data-field=code]').scrollIntoViewIfNeeded();
  await shot('08-case-id-autofill');
  await app.locator('[data-field=disposition][value=replace]').check();
  await app.locator('.screen-picker summary').click();
  await app.locator('.screen-picker [data-action=pick]').filter({ hasText: 'STB_HO_001' }).click();
  // 목록은 다음 프레임에 다시 그려지므로 상태 아이콘이 바뀔 때까지 기다린다.
  const stateIs = async (row, label) => {
    const key = await row.getAttribute('data-key');
    await page.waitForFunction(([k, l]) => document.querySelector(`#app .row[data-key="${k}"] .estimate-icon`)?.getAttribute('title')?.startsWith(l), [key, label]);
  };
  await stateIs(candidate, '화면 교체됨');
  await stateIs(target, '이전 버전');
  assert.equal(await target.locator('[data-action=include]').isChecked(), true);
  await shot('09-replace-pair');
  // 이전 버전으로 정해진 화면은 변경 무시를 누를 수 없다.
  await target.click();
  assert.equal(await app.locator('[data-action=ignore-changes]').isDisabled(), true, 'ignore disabled once resolved');
  await candidate.locator('[data-action=include]').uncheck();
  await stateIs(target, '변경 감지');
  assert.equal(await target.locator('[data-action=include]').isChecked(), false);
  // 이미 배포한 화면도 화면이 아님으로 고를 수 있다. 입력란 없이 제외 사유만 받는다.
  await target.click();
  await target.locator('[data-action=include]').check();
  assert.equal(await app.locator('[data-field=disposition][value=modify]').isChecked(), true, '배포한 화면의 기본 등록 방식은 화면 수정');
  await app.locator('[data-field=disposition][value=not-screen]').check();
  await stateIs(target, '화면이 아님');
  assert.equal(await app.locator('.detail [data-field=code]').count(), 0, 'not-screen has no Screen ID input');
  assert.equal(await app.locator('.detail [data-field=excludeReason]').count(), 1);
  await shot('09b-published-not-screen');
  await app.locator('[data-field=disposition][value=modify]').check();
  await stateIs(target, '수정됨');
  await target.locator('[data-action=include]').uncheck();
  await stateIs(target, '변경 감지');
  await app.locator('[data-action=changed-only]').check();

  // 원본을 지우면 「삭제」로 나오고, 배포하면 사용 안 함이 되어 목록에서 빠진다.
  await page.locator(`#tools [data-del="${initialNodeId}"]`).click();
  await scan();
  const gone = app.locator('.row:has(.id-tag)').filter({ hasText: initialName }).first();
  await gone.click();
  await gone.locator('[data-action=include]').check();
  await page.waitForFunction(() => document.querySelector('#app .tag-picker summary .chip')?.textContent === '삭제');
  await shot('10-delete-input');
  await app.locator('[data-action=prepare]').click();
  await app.locator('[data-action=commit]').click();
  await page.waitForFunction(() => document.querySelector('#app .toast')?.textContent?.includes('배포했습니다'));
  await scan();
  assert.equal(await app.locator('.row:has(.id-tag)').filter({ hasText: initialName }).count(), 0, 'deleted screen leaves the list');
  await shot('11-deleted');

  // 여러 후보의 화면 이름이 다르면 '-'를 보여 주고 공통 이름을 두 초안에 적용한다.
  await page.goto(pathToFileURL(previewPath).href);
  await page.waitForFunction(() => document.querySelector('#app .tabs [data-action=version-close]'));
  await scan();
  await app.locator('.group-head').first().click();
  const firstKey = await app.locator('.row').nth(0).getAttribute('data-key');
  const secondKey = await app.locator('.row').nth(1).getAttribute('data-key');
  await app.locator(`.row[data-key="${firstKey}"]`).click();
  await app.locator(`.row[data-key="${secondKey}"]`).click({ modifiers: ['Control'] });
  await app.locator('.detail [data-action=include-selected]').check();
  const bulkName = app.locator('.detail [data-field=name]');
  assert.equal(await bulkName.getAttribute('placeholder'), '-', '서로 다른 화면 이름은 혼합값 표시');
  assert.equal(await bulkName.inputValue(), '');
  assert.equal(await app.locator('.detail [data-field=code]').count(), 0, 'Screen ID는 일괄 입력하지 않는다');
  await bulkName.fill('공통 화면 이름');
  await page.waitForFunction(keys => keys.every(key => document.querySelector(`#app .row[data-key="${key}"] .name`)?.textContent === '공통 화면 이름'), [firstKey, secondKey]);
  // 창 크기 손잡이: 플러그인 창 밖에서 버튼을 놓으면 pointerup이 오지 않는다. 돌아온 첫 움직임에서 버튼이 떼어져 있으면
  // 그 움직임으로 크기를 바꾸지 않고 끝낸다(2026-10-22 사용자 보고).
  {
    const handle = app.locator('.resize-handle');
    const size = () => app.evaluate(root => ({ width: root.offsetWidth, height: root.offsetHeight }));
    const hb = await handle.boundingBox();
    const before = await size();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 - 40, hb.y + hb.height / 2 - 30, { steps: 4 });
    await page.waitForFunction(width => document.querySelector('#app').offsetWidth < width, before.width);
    const dragged = await size();
    // 창 밖에서 놓은 뒤 돌아온 움직임: 버튼이 떼어져 있다.
    await handle.dispatchEvent('pointermove', { pointerId: 1, buttons: 0, screenX: 0, screenY: 0, isPrimary: true, pointerType: 'mouse' });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    assert.deepEqual(await size(), dragged, '버튼을 뗀 채 돌아오면 크기를 바꾸지 않는다');
    await page.mouse.up();
    await handle.dispatchEvent('pointermove', { pointerId: 1, buttons: 0, screenX: 5000, screenY: 5000, isPrimary: true, pointerType: 'mouse' });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    assert.deepEqual(await size(), dragged, '드래그가 끝난 뒤 움직임으로 크기가 바뀌지 않는다');
  }
  assert.deepEqual(errors, []);
  console.log('walkthrough passed');
} catch (error) {
  // 실패한 시점의 화면을 남긴다.
  await shot('zz-failed').catch(() => {});
  throw error;
} finally {
  await browser.close();
}
