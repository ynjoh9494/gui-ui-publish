import { Controller } from './controller.ts';
import { clampWindow, WINDOW, type ToMain } from './core/wire.ts';
import { figmaHost, WINDOW_KEY } from './figma/host.ts';

// 한 플러그인 안의 두 명령: GUI Publish(gui), UI Flipbook(ui). 플러그인 메뉴에서 고른다(2026-10-20 사용자 결정).
const mode = figma.command === 'ui' ? 'UI' : 'GUI';
// 기록을 읽기 전에 창부터 띄운다. 창은 본체가 응답할 때까지 「불러오는 중」을 보여 준다.
figma.showUI(__html__, { width: WINDOW.width, height: WINDOW.height, themeColors: true, title: mode === 'UI' ? 'UI Flipbook' : 'GUI Publish' });
const controller = new Controller(figmaHost(mode));
// 같은 파일을 바꾸는 요청은 순서대로 실행한다. 스캔·취소·탐색은 최신 요청이 앞선 요청을 중단할 수 있게 둔다.
const writes = new Set<ToMain['type']>([
  'ready', 'prepare', 'commit', 'cancelPlan', 'retry', 'refreshData', 'resetData', 'admin', 'ignoreChanges',
  'refreshList', 'createFlipbooks', 'renameFlipbook', 'markReviewed', 'removeFlipbooks', 'resizeFlipbooks', 'switchVersion', 'textApply', 'createFlow', 'flows', 'revealFlow',
]);
// UI 쪽 스캔은 플립북 페이지를 읽으며 표식 없는(캔버스에서 만든·복제한) Section에 표식을 쓰므로 쓰기 순서에 넣는다.
const isWrite = (msg: ToMain) => writes.has(msg.type) || msg.type === 'scanUi' || (msg.type === 'scanSelected' && msg.team === 'UI');
let writeQueue: Promise<void> = Promise.resolve();
figma.ui.onmessage = (msg: ToMain) => {
  if (isWrite(msg)) writeQueue = writeQueue.then(() => controller.handle(msg), () => controller.handle(msg));
  else void controller.handle(msg);
};
let selectionSeq = 0;
figma.on('selectionchange', () => {
  const seq = ++selectionSeq;
  // 드래그·연속 선택과 배포 중 발생한 선택 이벤트는 마지막 상태만 읽는다.
  setTimeout(() => {
    if (seq !== selectionSeq) return;
    void writeQueue.then(() => {
      if (seq !== selectionSeq) return;
      return controller.canvasSelectionChanged();
    }).catch(error => {
      figma.ui.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    });
  }, 80);
});
// 보고 있는 페이지가 바뀌면 페이지 목록을 다시 보낸다(새 플립북의 기본 페이지).
figma.on('currentpagechange', () => { void controller.handle({ type: 'pages' }); });
// 마지막으로 바꾼 창 크기로 다시 연다.
void figma.clientStorage.getAsync(WINDOW_KEY).then((size: { width?: number; height?: number } | undefined) => {
  if (size?.width && size.height) { const s = clampWindow(mode, size.width, size.height); figma.ui.resize(s.width, s.height); }
}).catch(() => {});
