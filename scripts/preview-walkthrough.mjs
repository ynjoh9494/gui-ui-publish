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
const collapseWindow = async name => {
  const snapshot = () => app.evaluate(root => ({ width: root.offsetWidth, height: root.offsetHeight,
    list: root.querySelector('.list').textContent, detail: root.querySelector('.detail').textContent,
    inputs: [...root.querySelectorAll('input, textarea')].map(el => ({ value: el.value, checked: el.checked })) }));
  const before = await snapshot();
  await app.locator('[data-action=collapse-window]').click();
  await page.waitForFunction(() => document.querySelector('#app').offsetHeight === 40);
  assert.equal(await app.evaluate(root => root.offsetWidth), 200);
  assert.equal(await app.locator('.tabs').isVisible(), false);
  assert.equal(await app.locator('.list').isVisible(), false);
  assert.equal(await app.locator('.window-bar').isVisible(), true);
  assert.equal(await app.locator('.window-bar strong').textContent(), name.startsWith('gui') ? 'GUI Publish' : 'UI Flipbook');
  await shot('window-' + name);
  await app.locator('.window-bar button').click();
  await page.waitForFunction(height => document.querySelector('#app').offsetHeight === height, before.height);
  assert.deepEqual(await snapshot(), before, 'Window restores dimensions, inputs, selection and panels');
};

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
    const pasteTutorial = page.locator('.tutorial .paste-view');
    if (await pasteTutorial.isVisible()) {
      assert.ok(await pasteTutorial.locator('.paste-screen').count() > 0);
      assert.ok(await pasteTutorial.locator('.paste-track:disabled .paste-count').count() > 0, '0개 버튼은 숫자와 함께 비활성화');
      assert.equal(await pasteTutorial.locator('.paste-track:not(:disabled)').count(), 0, '0개 버튼은 목록을 열지 않는다');
    }

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
  await collapseWindow('gui');
  await shot('01-gui-ready');

  await app.locator('[data-action=prepare]').click();
  await app.locator('[data-action=commit]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#log div')].some(x => x.textContent?.includes('GUI 썸네일')));
  await shot('02-gui-published');

  await mode('UI');
  await collapseWindow('ui');
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
  // 화면 편집은 없다(2026-10-29 사용자 결정: 화면은 캔버스·GUI 붙이기에서 넣고 뺀다). 상세에는 들어 있는 화면 수만 보인다.
  assert.equal(await app.locator('[data-action=fb-edit-screens]').count(), 0, '플립북 상세에 화면 편집이 없다');
  assert.match(await app.locator('.detail .fb-screens-head .note').innerText(), /화면 1개/);
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
  // 오른쪽 아래 확인 영역은 수정된 화면이 없어도 항상 보이며, 상태는 기본 태그 「현행」이다.
  await app.locator('.detail .fb-bottom').waitFor();
  assert.equal(await app.locator('.fb-bottom .tag-picker summary .chip').innerText(), '현행');
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
    await app.evaluate(root => { root.style.width = '960px'; root.style.height = '800px'; });
    await app.locator('.tabs [data-action=flow-open]').click();
    const screens = app.locator('.flow-view .flow-screen');
    await screens.first().waitFor();
    const flowCategory = app.locator('.flow-view [data-flow=category]');
    const flowSearch = app.locator('.flow-view [data-flow=query]');
    assert.equal(await flowCategory.locator('option:checked').innerText(), '전체');
    await flowCategory.selectOption({ label: '홈' });
    await flowSearch.fill('없는 검색 결과');
    assert.equal(await screens.count(), 0);
    await app.locator('[data-action=flow-search-all]').click();
    assert.equal(await flowCategory.locator('option:checked').innerText(), '전체');
    assert.equal(await flowSearch.inputValue(), '없는 검색 결과');
    assert.equal(await app.locator('[data-action=flow-search-all]').count(), 0);
    await flowSearch.fill('  stb_ho_001  ');
    assert.equal(await screens.count(), 1);
    await app.locator('[data-action=flow-layout][data-layout=grid]').click();
    await app.locator('.flow-screens .paste-thumb img').first().waitFor();
    assert.equal(await app.locator('.flow-screens .paste-thumb .picker-thumb-id').first().innerText(), 'STB_HO_001');
    assert.equal(await screens.first().locator('.paste-track:disabled .paste-count').innerText(), '0');
    assert.equal(await screens.first().getAttribute('data-thumb'), null, '그리드는 마우스 오버 미리보기 없음');
    await flowSearch.fill('');
    await app.locator('[data-action=flow-layout][data-layout=list]').click();
    const cards = app.locator('.flow-view .flow-card');
    const links = app.locator('.flow-view .flow-link:not(.preview)');
    const create = app.locator('.flow-view [data-action=flow-create]');
    assert.equal(await app.locator('.list').isVisible(), false, '플로우 탭은 목록 대신 보인다');
    assert.ok(await screens.first().getAttribute('data-thumb'), '배포된 화면에 마우스를 올리면 썸네일을 보여 준다');
    await screens.first().locator('.label').hover();
    await app.locator('.thumb-hover img').waitFor();
    assert.equal(await app.locator('.thumb-hover').evaluate(el => Math.round(el.getBoundingClientRect().width)), 240, '플로우 마우스 오버도 다른 곳과 같은 크기');
    await screens.first().locator('.paste-track').hover();
    assert.equal(await app.locator('.thumb-hover').count(), 0, '비활성 링크 버튼 위에서는 미리보기 닫기');

    await screens.nth(0).click();
    assert.equal(await create.isDisabled(), true, '화면 2개부터 만든다');
    // 이 시점에는 배포된 화면이 하나다. 같은 화면을 여러 번 놓을 수 있다.
    await screens.nth(0).click();
    assert.equal(await cards.count(), 2);
    assert.equal(await create.isEnabled(), true);
    const spots = await cards.evaluateAll(els => els.map(el => [el.offsetLeft, el.offsetTop]));
    // 확대된 썸네일은 216×121.5이며, 좁은 판에서는 다음 줄로 놓는다.
    assert.ok(spots[1][0] - spots[0][0] >= 252 || spots[1][1] - spots[0][1] >= 157, '확대된 썸네일도 화면 간격을 두고 겹치지 않는 빈 자리에 놓는다');
    assert.equal(await cards.nth(0).locator('.flow-card-id').innerText(), 'STB_HO_001', '썸네일 왼쪽 위에 Screen ID');
    await cards.first().locator('img').waitFor();
    assert.equal(await cards.first().getAttribute('data-thumb'), null, '판에 썸네일이 보이므로 마우스를 올린 미리보기는 띄우지 않는다');
    assert.deepEqual(await cards.first().evaluate(el => [el.offsetWidth, el.offsetHeight]), [216, 122], '썸네일은 캔버스 크기에 확대된 기본 판 배율을 곱한 크기');
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
      await page.waitForFunction(() => document.querySelector('#app .flow-card').offsetWidth > 216);
      const zoomed = await cards.nth(0).boundingBox();
      assert.deepEqual([Math.round(zoomed.x), Math.round(zoomed.y)], [Math.round(back.x), Math.round(back.y)], '포인터 아래 자리는 그대로다');
      await page.mouse.wheel(0, 100);
      await page.waitForFunction(() => document.querySelector('#app .flow-card').offsetWidth === 216);
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
    assert.deepEqual(await cards.nth(1).evaluate(el => [el.offsetLeft, el.offsetTop]), [spots[1][0], spots[1][1] + 126], '끌어 놓은 자리는 확대된 격자(40 = 18px)에 맞춘다');
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
    await page.waitForFunction(() => [...document.querySelectorAll('#log div')].some(x => x.textContent?.includes('플로우: 홈 진입 플로우') && x.textContent.includes('(0,0).right→STB_HO_001(560,280).left')));
    // 만든 플로우는 화면별 추적 목록 팝업에서 찾는다(머리의 이력 아이콘은 없다).
    assert.equal(await app.locator('.flow-view [data-action=flow-list]').count(), 0, '플로우 탭에는 만든 플로우 목록 버튼이 없다');
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
    // GUI 붙이기 탭: 창 크기를 유지하고, 고른 카테고리의 배포된 화면을 누르면 고른 크기로 보고 있는 화면 가운데에 붙인다.
    // 화면마다 붙인 수(추적 GUI와 그 화면이 든 플로우)를 보여 준다. 다른 탭으로 가도 창 크기를 유지한다.
    {
      // 탭을 오가도 현재 창 너비가 유지되는지 확인한다.
      const pasteWindow = await app.evaluate(root => root.getBoundingClientRect().width);
      await app.locator('.tabs [data-action=paste-open]').click();
      const rows = app.locator('.paste-view .paste-screen');
      await rows.first().waitFor();
      await collapseWindow('ui-paste');
      await page.waitForFunction(w => Math.abs(document.querySelector('#app').getBoundingClientRect().width - w) < 2, pasteWindow, { timeout: 3000 });
      assert.equal(await app.locator('.list').isVisible(), false, 'GUI 붙이기 탭은 목록 대신 보인다');
      assert.equal(await app.locator('.paste-view [data-paste=category] option:checked').innerText(), '전체', '처음에는 전체 카테고리');
      const categorySelect = app.locator('.paste-view [data-paste=category]');
      const searchInput = app.locator('.paste-view [data-paste=search]');
      await categorySelect.selectOption({ label: '홈' });
      await searchInput.fill('없는 검색 결과');
      assert.equal(await rows.count(), 0);
      const searchAll = app.locator('[data-action=paste-search-all]');
      assert.equal(await searchAll.innerText(), '전체 카테고리에서 검색하기');
      await searchAll.click();
      assert.equal(await categorySelect.locator('option:checked').innerText(), '전체');
      assert.equal(await searchInput.inputValue(), '없는 검색 결과', '전체 검색도 검색어 유지');
      assert.equal(await searchAll.count(), 0, '전체에서도 없으면 일반 검색 빈 상태');
      assert.equal(await app.locator('.paste-screens .empty').innerText(), '검색 결과가 없습니다.');
      await searchInput.fill('  stb_ho_001  ');
      assert.equal(await rows.count(), 1, 'Screen ID 검색은 대소문자와 앞뒤 공백을 무시');
      await searchInput.fill('홈 메인');
      assert.equal(await rows.count(), 1, '화면 이름도 검색');
      await searchInput.fill('');
      assert.ok(await rows.first().getAttribute('data-thumb'), '목록 보기는 마우스를 올리면 썸네일을 보여 준다');
      await rows.first().locator('.label').hover();
      await app.locator('.thumb-hover img').waitFor();
      await rows.first().locator('.paste-track').hover();
      assert.equal(await app.locator('.thumb-hover').count(), 0, '활성 링크 버튼도 미리보기를 띄우지 않는다');

      // 탭을 열 때 받은 화면 목록의 붙인 수: 그 화면이 든 플로우를 센다.
      await page.waitForFunction(() => document.querySelector('#app .paste-view .paste-screen .paste-count')?.textContent === '1', null, { timeout: 3000 });
      assert.equal(await app.locator('.paste-view [data-action=paste-scale]').count(), 0, 'GUI 붙이기에는 크기 선택 없음');
      assert.equal(await app.locator('.paste-tip').innerText(), 'K 단축키로 캔버스에 배치한 화면의 크기를 바꿀 수 있습니다.');
      await rows.first().click();
      await page.waitForFunction(() => [...document.querySelectorAll('#log div')].some(x => x.textContent?.includes('GUI 붙이기: STB_HO_001 기본')));
      await page.waitForFunction(() => document.querySelector('#app .paste-view .paste-screen .paste-count')?.textContent === '2');
      await app.locator('.paste-view [data-action=paste-layout][data-layout=grid]').click();
      await app.locator('.paste-view .paste-card .paste-thumb img').first().waitFor();
      assert.equal(await app.locator('.paste-card .paste-thumb .picker-thumb-id').first().innerText(), 'STB_HO_001');
      assert.equal(await app.locator('.paste-card .paste-track .paste-count').first().innerText(), '2');
      const cardMeta = await app.locator('.paste-card-meta').first().evaluate(el => {
        const label = el.querySelector('.label').getBoundingClientRect();
        const button = el.querySelector('button').getBoundingClientRect();
        return { sameLine: Math.abs(label.y + label.height / 2 - button.y - button.height / 2) < 1, separated: label.right <= button.left };
      });
      assert.deepEqual(cardMeta, { sameLine: true, separated: true }, '화면명과 링크 개수 버튼은 같은 행에서 겹치지 않는다');

      assert.equal(await app.locator('.paste-view .paste-card').first().getAttribute('data-thumb'), null, '그리드 보기는 썸네일이 보이므로 마우스를 올린 미리보기를 띄우지 않는다');
      await shot('04e-paste-tab');
      // 추적 목록 팝업: 화면 줄의 목록 아이콘으로 연다. 제목은 화면 이름이고, 붙인 화면과 그 화면이 든 플로우를 나눠 경로로 보여 준다.
      // 목록 아이콘을 눌러도 화면을 붙이지 않는다. 항목을 누르면 그 자리로 가고, 팝업은 Esc로 닫는다.
      const pastes = async () => (await page.locator('#log div').allTextContents()).filter(line => line.includes('GUI 붙이기:')).length;
      const pastedBefore = await pastes();
      await app.locator('.paste-view .paste-card [data-action=paste-track]').first().click();
      const dialog = app.locator('.track-list-overlay .track-list-dialog');
      await dialog.locator('.track-place').first().waitFor();
      assert.equal(await dialog.locator('h2').innerText(), '홈 메인', '팝업 제목은 Screen ID 없이 화면 이름이다');
      const places = dialog.locator('.track-section');
      assert.deepEqual(await places.locator('h3').allInnerTexts(), ['화면 1', '플로우 1'], '화면과 플로우를 나눠 센다');
      assert.match(await places.nth(1).locator('.track-place').innerText(), / › 홈 진입 플로우$/, '플로우는 경로 끝에 제목을 둔다');
      assert.equal(await pastes(), pastedBefore, '목록 아이콘은 화면을 붙이지 않는다');
      await shot('04f-track-list');
      await places.nth(1).locator('.track-place').click();
      await page.waitForFunction(() => [...document.querySelectorAll('#log div')].some(x => x.textContent?.includes('캔버스 이동') && x.textContent.includes('flow:')));
      await places.nth(0).locator('.track-place').click();
      await page.waitForFunction(() => [...document.querySelectorAll('#log div')].some(x => x.textContent?.includes('캔버스 이동') && x.textContent.includes('paste:')));
      await page.keyboard.press('Escape');
      assert.equal(await app.locator('.track-list-overlay').count(), 0, 'Esc로 팝업을 닫는다');
      await app.locator('.tabs [data-action=text-close]').click();
      await page.waitForFunction(w => document.querySelector('#app').getBoundingClientRect().width === w, pasteWindow, { timeout: 3000 });
    }
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
  assert.equal(await app.locator('[data-action=toggle-detail]').count(), 0);
  assert.equal(await app.locator('.detail').isVisible(), true);
  assert.equal(await app.locator('.pane-divider').isVisible(), true);
  await page.waitForFunction(() => document.querySelectorAll('#app .list .row').length === 1);
  await collapseWindow('ui-review');
  await tutorial('06c-tutorial-ui');
  assert.equal(await app.locator('.detail').isVisible(), true);
  await app.locator('[data-action=new-add]').click();
  assert.equal(await app.locator('.detail').isVisible(), true);
  await app.locator('.list .new-row [data-action=new-remove]').click();
  await newRows(0, 'Temporary flipbook removed');
  // 업데이트된 화면만 보기는 확인이 필요한 플립북만 남긴다.
  assert.equal(await app.locator('.list .switch span').innerText(), '업데이트된 화면만 보기');
  await page.waitForFunction(() => document.querySelectorAll('#app .list .row').length === 1);
  const flagged = app.locator('.row').filter({ has: page.locator('.review-dot') }).first();
  await flagged.click();
  await app.locator('.detail .fb-bottom.flagged').waitFor();
  assert.equal(await app.locator('.fb-bottom .review-screens li').count(), 1, '아래 영역에 수정된 화면을 보여 준다');
  // 썸네일 왼쪽 위 상태: 가장 최근 GUI 배포의 태그(그 배포로 바뀐 화면에만)와 확인이 필요한 화면의 알림 뱃지
  assert.equal(await app.locator('.detail .thumbs .thumb-state .review-dot').count(), 1, '썸네일에도 수정된 화면을 표시한다');
  assert.equal(await app.locator('.detail .thumbs .thumb-state .chip').innerText(), '검토', '가장 최근 GUI 배포의 태그를 그 화면에 붙인다');
  await shot('06a-ui-screen-state');
  // 화면을 누르면 그 화면의 추적 목록 팝업을 연다.
  await app.locator('.detail .thumbs .fb-screen').first().click();
  await app.locator('.track-list-overlay .track-list-dialog h2').waitFor();
  await page.keyboard.press('Escape');
  // 상태를 비우면 확인 완료를 막는다(필수). 다시 「현행」을 고르고 코멘트(선택)를 쓴다.
  await app.locator('.fb-bottom .tag-picker summary').click();
  await app.locator('.fb-bottom .tag-options [data-action=select-tag][data-id=""]').click();
  assert.equal(await app.locator('.fb-bottom [data-action=mark-reviewed]').isDisabled(), true, '상태는 필수');
  await app.locator('.fb-bottom .tag-picker summary').click();
  await app.locator('.fb-bottom .tag-options [data-action=select-tag]').filter({ hasText: '현행' }).click();
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
  await page.waitForFunction(() => [...document.querySelectorAll('#log div')].some(x => x.textContent?.includes('현행(Black)')));
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
  // 변경 사항: 보이는 차이는 상자에 한 줄씩 바로 보이고, 줄을 누르면 캔버스에서 고른다.
  await page.waitForFunction(() => document.querySelector('#app .detail .change-reason .reason-line')?.textContent?.includes('텍스트 내용'));
  await shot('07-change-detected');
  await app.locator('.change-reason [data-action=reason-layer]').first().click();
  await page.waitForFunction(id => [...document.querySelectorAll('#log div')].some(x => x.textContent?.includes(`프레임 선택: ${id}`)), initialNodeId);
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
  // 화면 선택 드롭다운을 펼치면 머리 자리의 검색 입력에 포커스가 가고, Screen ID·이름으로 목록을 거른다.
  await app.locator('.screen-picker summary').click();
  const pickerSearch = app.locator('.screen-picker .picker-search');
  await pickerSearch.waitFor();
  // 포커스는 펼친 뒤 오는 toggle 이벤트에서 옮기므로, 입력이 보이자마자 확인하지 않고 옮겨질 때까지 기다린다.
  const pickerFocused = await page.waitForFunction(() => document.activeElement?.matches('#app .screen-picker .picker-search'), null, { timeout: 2000 }).then(() => true, () => false);
  assert.equal(pickerFocused, true, 'opening a screen picker focuses its search input');
  await pickerSearch.fill('없는 화면');
  assert.equal(await app.locator('.screen-picker [data-action=pick]:visible').count(), 0, 'search hides screens that do not match');
  assert.equal(await app.locator('.screen-picker .picker-empty').isVisible(), true);
  await pickerSearch.fill('ho_001');
  assert.equal(await app.locator('.screen-picker .picker-empty').isVisible(), false);
  await pickerSearch.press('Enter');
  assert.equal(await app.locator('[data-field=code]').inputValue(), 'STB_HO_001-01', 'case ID is filled automatically');
  await app.locator('[data-field=code]').scrollIntoViewIfNeeded();
  await shot('08-case-id-autofill');
  await app.locator('[data-field=disposition][value=replace]').check();
  await app.locator('.screen-picker summary').click();
  await app.locator('.screen-picker .picker-search').press('Escape');
  assert.equal(await app.locator('.screen-picker').evaluate(node => node.open), false, 'Esc closes the screen picker');
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

  // 배포된 화면으로 다른 화면을 교체하고(잘못 신규로 배포한 화면 바로잡기), 배포를 취소하면 그 프레임이 신규로 돌아온다(2026-10-27 사용자 요청).
  await app.locator('[data-action=changed-only]').uncheck();
  for (const head of await app.locator('.group-head').all())
    if (await head.getAttribute('aria-expanded') === 'false') await head.click();
  const fresh = app.locator('.row:not(:has(.id-tag))');
  const keepKey = await fresh.nth(0).getAttribute('data-key');
  const wrongKey = await fresh.nth(1).getAttribute('data-key');
  for (const [key, code] of [[keepKey, 'STB_HO_002'], [wrongKey, 'STB_HO_003']]) {
    const row = app.locator(`.row[data-key="${key}"]`);
    await row.click();
    await row.locator('[data-action=include]').check();
    // 앞 단계에서 교체·케이스를 골랐던 후보도 있으므로 신규 등록·독립 화면을 직접 고른다.
    await app.locator('[data-field=disposition][value=new]').check();
    await app.locator('[data-field=relation][value=standalone]').check();
    await app.locator('[data-field=categoryId]').selectOption({ label: '홈' });
    await app.locator('[data-field=code]').fill(code);
  }
  await app.locator('[data-action=prepare]').click();
  await app.locator('[data-action=commit]').click();
  await page.waitForFunction(() => document.querySelector('#app .toast')?.textContent?.includes('배포했습니다'));
  await scan();
  for (const head of await app.locator('.group-head').all())
    if (await head.getAttribute('aria-expanded') === 'false') await head.click();
  const rowOf = async code => app.locator(`.row[data-key="${await app.locator('.row:has(.id-tag)').filter({ hasText: code }).first().getAttribute('data-key')}"]`);
  const keep = await rowOf('STB_HO_002');
  const wrong = await rowOf('STB_HO_003');
  await wrong.click();
  await wrong.locator('[data-action=include]').check();
  assert.equal(await app.locator('[data-field=disposition][value=modify]').isChecked(), true);
  await app.locator('[data-field=disposition][value=replace]').check();
  await app.locator('.screen-picker summary').click();
  assert.equal(await app.locator('.screen-picker [data-action=pick]').filter({ hasText: 'STB_HO_003' }).count(), 0, 'a screen cannot replace itself');
  await app.locator('.screen-picker [data-action=pick]').filter({ hasText: 'STB_HO_002' }).click();
  await stateIs(wrong, '화면 교체됨');
  await stateIs(keep, '이전 버전');
  assert.equal(await app.locator('[data-field=code]').inputValue(), 'STB_HO_002', 'the replaced screen ID is filled');
  assert.equal(await app.locator('.detail [data-field=relation]').count(), 0, 'a replacement keeps the relation');
  await shot('11b-replace-with-published');
  // 배포를 끄면 짝이 함께 풀리고, 다시 켜면 고른 화면과 다시 짝이 된다.
  await wrong.locator('[data-action=include]').uncheck();
  await stateIs(keep, '변경사항 없음');
  await wrong.locator('[data-action=include]').check();
  await stateIs(keep, '이전 버전');
  // 교체는 신규 후보의 교체처럼 태그를 고른다.
  await app.locator('.tag-picker summary[aria-label="태그 선택"]').click();
  await app.locator('.tag-options [data-action=select-tag]').filter({ hasText: '검토' }).click();
  await app.locator('[data-action=prepare]').click();
  await page.waitForFunction(() => document.querySelector('#app .dialog')?.textContent?.includes('사용 안 함으로 바꿀 화면: STB_HO_003'));
  await shot('11c-replace-confirm');
  await app.locator('[data-action=commit]').click();
  await page.waitForFunction(() => document.querySelector('#app .toast')?.textContent?.includes('배포했습니다'));
  await scan();
  assert.equal(await app.locator('.row:has(.id-tag)').filter({ hasText: 'STB_HO_003' }).count(), 0, 'the screen used for the replacement leaves the list');
  assert.equal(await app.locator(`.row[data-key="${wrongKey}"]`).count(), 0, 'its frame is now the source of STB_HO_002');
  const replaced = await rowOf('STB_HO_002');
  await stateIs(replaced, '변경사항 없음');

  await replaced.click();
  await replaced.locator('[data-action=include]').check();
  await app.locator('[data-field=disposition][value=unpublish]').check();
  await stateIs(replaced, '배포 취소');
  assert.equal(await app.locator('.detail [data-field=code]').count(), 0, 'unpublish has no inputs');
  await shot('11d-unpublish');
  await app.locator('[data-action=prepare]').click();
  await app.locator('[data-action=commit]').click();
  await page.waitForFunction(() => document.querySelector('#app .toast')?.textContent?.includes('배포를 취소했습니다'));
  await scan();
  assert.equal(await app.locator('.row:has(.id-tag)').filter({ hasText: 'STB_HO_002' }).count(), 0, 'the unpublished screen leaves the list');
  const back = app.locator(`.row[data-key="${wrongKey}"]`);
  assert.equal(await back.count(), 1, 'the frame comes back as a new candidate');
  await stateIs(back, '신규');
  await shot('11e-unpublished');

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
  // 카테고리 순서: 목록의 카테고리 머리를 드래그하면 바로 저장하고, 화면 목록·카테고리 선택·관리의 코드 목록이 그 순서를 따른다(2026-10-28 사용자 요청).
  {
    const thirdKey = await app.locator('.row').nth(2).getAttribute('data-key');
    for (const name of ['홈', '검색', 'VOD']) {
      await app.locator('[data-action=begin-add][data-kind=category]').click();
      await app.locator('[data-field=newCategory]').fill(name);
      await app.locator('[data-field=newCategory]').press('Enter');
      await page.waitForFunction(n => [...document.querySelectorAll('#app [data-field=categoryId] option')].some(x => x.textContent === n), name);
    }
    for (const [key, name] of [[firstKey, '홈'], [secondKey, '검색'], [thirdKey, 'VOD']]) {
      const row = app.locator(`.row[data-key="${key}"]`);
      await row.click();
      await row.locator('[data-action=include]').check();
      await app.locator('[data-field=categoryId]').selectOption({ label: name });
    }
    // 카테고리를 고르지 않은 나머지 후보는 「미분류」에 남는다. 목록은 다음 프레임에 다시 그리므로 묶음이 바뀔 때까지 기다린 뒤 확인한다.
    const waitGroups = async (expected, message) => {
      await page.waitForFunction(names => JSON.stringify([...document.querySelectorAll('#app .list .group-head')].map(h => h.textContent.replace(/[▾▸]/g, '').trim().split(/\s+/)[0]).filter(n => n !== '미분류')) === JSON.stringify(names), expected, { timeout: 3000 }).catch(() => {});
      const names = await app.locator('.list .group-head').evaluateAll(heads => heads.map(h => h.textContent.replace(/[▾▸]/g, '').trim().split(/\s+/)[0]).filter(n => n !== '미분류'));
      assert.deepEqual(names, expected, message);
      // 저장하는 동안(처리 중)에는 옮기지 않으므로 끝날 때까지 기다린다.
      await page.waitForFunction(() => !document.querySelector('#app').classList.contains('is-busy'));
    };
    await waitGroups(['홈', '검색', 'VOD'], '처음에는 만든 순서로 묶는다');
    const ids = Object.fromEntries(await app.locator('.list .group[data-category]').evaluateAll(groups => groups.map(g => [g.querySelector('.group-head').textContent.replace(/[▾▸]/g, '').trim().split(/\s+/)[0], g.dataset.category])));
    const group = name => app.locator(`.list .group[data-category="${ids[name]}"]`);
    assert.equal(await app.locator('.list .group:not([data-category]) .group-bar[draggable]').count(), 0, '미분류는 옮기지 않는다');
    const bar = await group('홈').locator('.group-bar').boundingBox();
    await group('VOD').locator('.group-head').dragTo(group('홈').locator('.group-bar'), { targetPosition: { x: 60, y: 3 } });
    await waitGroups(['VOD', '홈', '검색'], '머리 위쪽 절반에 놓으면 그 카테고리 앞으로 옮긴다');
    await group('검색').locator('.group-head').dragTo(group('VOD').locator('.group-bar'), { targetPosition: { x: 60, y: bar.height - 3 } });
    await waitGroups(['VOD', '검색', '홈'], '머리 아래쪽 절반에 놓으면 그 카테고리 뒤로 옮긴다');
    // 머리 줄은 체크박스 칸까지 한 색으로 채우고, 체크박스와 화살표 사이는 좁다.
    const head = await group('홈').locator('.group-bar').evaluate(bar => {
      const box = bar.querySelector('input').getBoundingClientRect(), caret = bar.querySelector('.caret').getBoundingClientRect();
      // 손잡이는 글자 자체의 너비로 잰다(칸은 고정 폭).
      const range = document.createRange();
      range.selectNodeContents(bar.querySelector('.drag-handle'));
      return { same: getComputedStyle(bar).backgroundColor === getComputedStyle(bar.querySelector('.group-head')).backgroundColor, gap: caret.left - box.right, handleGap: box.left - range.getBoundingClientRect().right };
    });
    assert.ok(head.same, '머리 줄 배경이 체크박스 오른쪽에서 끊기지 않는다');
    assert.ok(head.gap <= 6, `체크박스와 화살표 사이 간격 ${head.gap}px`);
    assert.ok(head.handleGap >= 2 && head.handleGap <= 5, `드래그 손잡이와 체크박스 사이 간격 ${head.handleGap}px`);
    await shot('12-category-order');
    assert.deepEqual((await app.locator('[data-field=categoryId] option').allInnerTexts()).slice(-3), ['VOD', '검색', '홈'], '카테고리 선택도 바뀐 순서');
    await app.locator('[data-action=settings]').click();
    assert.equal(await app.locator('details[data-form=category-order]').count(), 0, '관리에는 카테고리 순서가 없다');
    await app.locator('details[data-form=screen-id-prefix] > summary').click();
    assert.deepEqual(await app.locator('details[data-form=screen-id-prefix] .category-code > span').allInnerTexts(), ['VOD', '검색', '홈'], '관리의 카테고리 코드 목록도 같은 순서');
    await app.locator('[data-action=settings]').click();
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
