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
  await page.waitForFunction(title => document.querySelector('#app .tabs .app-title')?.textContent === title, name === 'UI' ? 'UI Flipbook' : 'GUI Publish');
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
  await page.waitForFunction(() => document.querySelector('#app .tabs .app-title')?.textContent === 'GUI Publish');
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
  assert.ok((await widths()).list >= 260, '목록 최소 너비 유지');
  await dragDivider(1000);
  assert.ok((await widths()).detail >= 320, '화면정보 최소 너비 유지');
  await divider.focus();
  await divider.press('Home');
  assert.equal(Math.round((await widths()).list), 260, '키보드로 목록 최소 너비 이동');
  await divider.press('End');
  assert.ok((await widths()).detail >= 320, '키보드로 화면정보 최소 너비 이동');
  await dragDivider(initialListWidth + 4);
  const originalWidth = await app.evaluate(root => root.style.width);
  await app.evaluate(root => { root.style.width = '600px'; });
  assert.ok((await widths()).list >= 260 && (await widths()).detail >= 320, '창이 작아져도 양쪽 최소 너비 유지');
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
  assert.equal(await app.locator('.create-tabs').count(), 0, '플립북 목록과 만들기를 한 화면에서 한다');
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
  assert.equal(await app.locator('.footer [data-action=create-submit]').innerText(), '플립북 1개 만들기', '아래에서 한 번에 만든다');
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
  assert.equal(await app.locator('.detail .create-plan-ids .id-tag').innerText(), 'STB_HO_001', '제목 아래에 선택한 화면 ID만 표시한다');
  assert.equal(await app.locator('.list .new-row .name').innerText(), initialName, '목록에는 첫 화면 이름을 제목으로 보여 준다');
  assert.ok((await app.locator('.list .group-head').filter({ has: page.locator('.new-count') }).innerText()).includes('홈'), '화면 카테고리 Section에 놓는다');
  assert.equal(await app.locator('[data-input=new-title]').count(), 0, '제목은 기본적으로 텍스트로 표시한다');
  assert.ok(await app.locator('.create-selected-box').evaluate(el => el.getBoundingClientRect().height >= 165), '선택된 화면 박스 높이를 확보한다');
  assert.equal(await app.locator('.create-selected-list .create-screen-option').count(), 1, '선택 화면은 위쪽 별도 박스로 이동한다');
  assert.equal(await app.locator('.create-screen-list .create-screen-option').count(), 0, '선택 화면을 후보 목록에 중복 표시하지 않는다');
  await app.locator('.create-selected-list [data-action=create-screen-toggle]').click();
  assert.equal(await app.locator('.create-screen-list .create-screen-option').count(), 1, '체크 해제한 화면은 후보 목록으로 돌아간다');
  await app.locator('.create-screen-list [data-action=create-screen-toggle]').click();
  await app.locator('[data-action=new-edit-title]').click();
  assert.equal(await app.locator('[data-input=new-title]').getAttribute('placeholder'), initialName, '연필을 누르면 실제 화면 이름을 안내하는 입력으로 바뀐다');
  await app.locator('[data-input=new-title]').press('Enter');
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
  await app.locator('[data-action=new-edit-title]').click();
  await app.locator('[data-input=new-title]').fill('정책 안내');
  await app.locator('[data-input=new-title]').press('Enter');
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
  await page.waitForFunction(() => [...document.querySelectorAll('#app .list .group-head')].some(head => head.textContent?.includes('안내')));
  assert.equal(await app.locator('[data-input=new-section] option:checked').innerText(), '안내', '새 Section을 고른다');
  // 다른 새 플립북을 끌어 그 Section의 「정책 안내」 아래에 놓는다.
  const dragged = app.locator('.list .new-row').filter({ hasText: initialName });
  const targetRow = app.locator('.list .new-row').filter({ hasText: '정책 안내' });
  const box = await targetRow.boundingBox();
  await dragged.dragTo(targetRow, { targetPosition: { x: 20, y: box.height - 3 } });
  const sectionOf = async name => app.locator('.list .group').filter({ has: page.locator('.new-row').filter({ hasText: name }) }).locator('.group-head').innerText();
  await page.waitForFunction(name => [...document.querySelectorAll('#app .list .group')].some(group =>
    [...group.querySelectorAll('.new-row .name')].some(row => row.textContent === name) && group.querySelector('.group-head')?.textContent?.includes('안내')), initialName);
  assert.ok((await sectionOf(initialName)).includes('안내'), '끌어서 다른 Section으로 옮긴다');
  await newNames(['정책 안내', initialName], '놓은 자리 순서');
  await shot('03b-create-arrange');
  // Section을 「화면 카테고리」로 되돌리면 홈 Section 맨 뒤로 간다.
  await app.locator('[data-input=new-section]').selectOption('');
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
  await app.locator('[data-action=fb-edit-title]').click();
  await app.locator('[data-input=fb-title]').fill('');
  await app.locator('[data-input=fb-title]').press('Enter');
  await page.waitForFunction(name => document.querySelector('#app .detail h2')?.textContent === name, initialName);
  // 모든 화면에 플립북이 있으면 노란 점 필터와 일괄 만들기 대상이 없다. 「모두 취소」는 두 번 눌러 지운다.
  await app.locator('[data-action=new-add]').click();
  await app.locator('.create-switch').click();
  assert.equal(await app.locator('.create-screen-list .create-screen-option').count(), 0, '스위치가 노란 점 없는 화면을 숨긴다');
  await app.locator('.list-actions [data-action=bulk-open]').click();
  assert.equal(await app.locator('.bulk-dialog .bulk-screen-list').innerText(), '플립북이 없는 화면이 없습니다.', '모든 화면에 플립북이 있으면 일괄 만들기 대상이 없다');
  await app.locator('[data-action=bulk-close]').click();
  await app.locator('[data-action=new-clear]').click();
  await newRows(1, '한 번 누르면 확인을 묻는다');
  await app.locator('[data-action=new-clear]').click();
  await newRows(0, '두 번 누르면 새 플립북을 모두 지운다');

  // 한 파일의 다른 UI 페이지에도 플립북을 만든다.
  await app.locator('[data-action=settings]').click();
  await app.locator('[data-form=flipbook] [data-f=page]').selectOption('0:2');
  await page.waitForFunction(() => document.querySelectorAll('#app [data-form=flipbook] .scope-page').length === 2);
  await app.locator('[data-action=settings]').click();
  await app.locator('[data-action=new-add]').click();
  await app.locator('[data-input=new-page]').selectOption('0:2');
  await app.locator('[data-action=new-edit-title]').click();
  await app.locator('[data-input=new-title]').fill('다른 페이지 정책');
  await app.locator('[data-input=new-title]').press('Enter');
  assert.ok((await sectionOf('다른 페이지 정책')).includes('UI 플립북'), '고른 페이지의 Section으로 옮긴다');
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

  await mode('GUI');
  await page.locator(`#tools [data-edit="${initialNodeId}"]`).click();
  await scan();
  for (const head of await app.locator('.group-head').all())
    if (await head.getAttribute('aria-expanded') === 'false') await head.click();
  await app.locator('.row').first().waitFor();
  await page.waitForTimeout(100);
  const changed = app.locator('.row').filter({ hasText: initialName }).first();
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

  await mode('UI');
  // 플립북에 「화면이 수정되었습니다」 빨간 점과 목록 위에 확인이 필요한 개수를 표시한다. 변경사항 확인을 누르지 않아도 보인다.
  await app.locator('.review-count').waitFor();
  assert.match(await app.locator('.review-count').innerText(), /확인이 필요한 플립북 1개/);
  for (const head of await app.locator('.group-head').all())
    if (await head.getAttribute('aria-expanded') === 'false') await head.click();
  await page.waitForFunction(() => document.querySelectorAll('#app .list .row').length === 3);
  assert.equal(await app.locator('.row .review-dot').count(), 1);
  assert.equal(await app.locator('.row .review-dot').getAttribute('title'), '화면이 수정되었습니다');
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
  const noisy = app.locator('.row').filter({ hasText: initialName }).first();
  await noisy.click();
  // 배포를 켜기 전에는 입력 영역이 없다.
  assert.equal(await app.locator('.detail [data-field=code]').count(), 0, 'inputs hidden until 배포 is checked');
  await shot('07-change-detected');
  await app.locator('[data-action=ignore-changes]').click();
  await page.waitForFunction(() => document.querySelector('#app .toast')?.textContent?.includes('변경을 무시했습니다'));
  await scan();
  assert.equal(await app.locator('.row').filter({ hasText: initialName }).count(), 0, 'ignored screen leaves the changed-only list');
  await shot('08-ignored');

  // 신규 후보에서 기존 화면 교체를 고르면 두 화면의 상태가 함께 바뀌고, 배포를 끄면 함께 돌아간다.
  // 교체 대상은 변경 감지 상태로 만든다(변경 무시 비활성화 확인용).
  await page.locator(`#tools [data-edit="${initialNodeId}"]`).click();
  await scan();
  await app.locator('[data-action=changed-only]').uncheck();
  for (const head of await app.locator('.group-head').all())
    if (await head.getAttribute('aria-expanded') === 'false') await head.click();
  // 입력한 카테고리·관계에 따라 행이 다른 그룹으로 옮겨 가므로 처음 찾은 행의 키로 고정한다.
  const rowByKey = async text => app.locator(`.row[data-key="${await app.locator('.row').filter({ hasText: text }).first().getAttribute('data-key')}"]`);
  const candidate = await rowByKey('홈 메인');
  const target = await rowByKey(initialName);
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
  const gone = app.locator('.row').filter({ hasText: initialName }).first();
  await gone.click();
  await gone.locator('[data-action=include]').check();
  await page.waitForFunction(() => document.querySelector('#app .tag-picker summary .chip')?.textContent === '삭제');
  await shot('10-delete-input');
  await app.locator('[data-action=prepare]').click();
  await app.locator('[data-action=commit]').click();
  await page.waitForFunction(() => document.querySelector('#app .toast')?.textContent?.includes('배포했습니다'));
  await scan();
  assert.equal(await app.locator('.row').filter({ hasText: initialName }).count(), 0, 'deleted screen leaves the list');
  await shot('11-deleted');

  // 여러 후보의 화면 이름이 다르면 '-'를 보여 주고 공통 이름을 두 초안에 적용한다.
  await page.goto(pathToFileURL(previewPath).href);
  await page.waitForFunction(() => document.querySelector('#app .tabs .app-title')?.textContent === 'GUI Publish');
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
  assert.deepEqual(errors, []);
  console.log('walkthrough passed');
} catch (error) {
  // 실패한 시점의 화면을 남긴다.
  await shot('zz-failed').catch(() => {});
  throw error;
} finally {
  await browser.close();
}
