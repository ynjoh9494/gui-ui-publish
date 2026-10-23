import { COPY } from '../core/copy.ts';
import { changeDetected, entryName, ignoreBlock, uiEntries as buildUiEntries, uiEstimate, type Entry, type UiScan } from '../core/compare.ts';
import type { GuiScreenInfo } from '../core/guiScreens.ts';
import { guiStateBadge, unlinkedBadge } from './estimate.ts';
import { startTutorial } from './tutorial.ts';
import { textEditor } from './textEditor.ts';
import { flowView } from './flowView.ts';
import { clearFill, defaultDraft, draftCode, draftIndex, draftName, fillFromScreen, isDeletion, isPrevious, needsLink, OPTIONAL_FIELDS, renumberAutoCodes, STATUS_LABEL, validateDraft, type Draft, type DraftIndex, type InputStatus, type Validation } from '../core/drafts.ts';
import { formatTime, type HistoryRow } from '../core/history.ts';
import { arrangeFlipbooks, buildList, guiGroupKey, placeDrafts, savedGuiDisplay, savedGuiPlace, UNCATEGORIZED, type ArrangedGroup, type GuiPlace, type ListModel } from '../core/list.ts';
import { emptyComment, type BatchComment, type Plan } from '../core/publish.ts';
import { customSection, defaultSection, filterScreens, needsReview, pageSections, rowKind, screenCategoryKey, uncreatedScreens, unreviewed, type FlipbookMove, type FlipbookRowRequest, type FlipbookSection, type ScreenFilter, type ScreenKind } from '../core/flipbooks.ts';
import { defaultTitle, guiTargetWidth, GUI_WIDTH_MAX, GUI_WIDTH_MIN, NO_SECTION_KEY, validGuiWidth } from '../core/flipbook.ts';
import { TAG_PALETTE } from '../core/palette.ts';
import { findCategoryByName, systemTagId, workerLabel } from '../core/registry.ts';
import { formatFrameName, parseFrameName } from '../core/screenName.ts';
import type { State } from '../core/store.ts';
import type { Actor, FlipbookScale, ImportedGuiRecord, SystemTag, Team } from '../core/types.ts';
import { SIMILAR_MIN, type VersionEvidence, type VersionLink } from '../core/versionMatch.ts';
import { clampWindow, fromWire, type AdminOp, type NavTarget, type PageInfo, type ScanState, type ToMain, type ToUi, type VersionMatchView } from '../core/wire.ts';

export interface Bridge {
  send(message: ToMain): void;
  listen(handler: (message: ToUi) => void): void;
}

interface ScreenItem { value: string; code: string; name: string; categoryId?: string | null }

export function sortScreenItems(items: ScreenItem[], preferredCategoryId?: string): ScreenItem[] {
  return [...items].sort((a, b) =>
    Number(b.value === '') - Number(a.value === '')
    || (preferredCategoryId ? Number(b.categoryId === preferredCategoryId) - Number(a.categoryId === preferredCategoryId) : 0)
    || a.code.localeCompare(b.code, 'ko', { numeric: true })
    || a.name.localeCompare(b.name, 'ko'));
}

type Tab = Team | 'ADMIN';

const NODE_PREVIEW = 'node:';

// 처리 중에도 허용하는 조작: 탭 전환과 목록 탐색, 튜토리얼(예시 화면에서 진행하므로 처리 중인 작업과 겹치지 않는다)
const WHILE_BUSY = new Set(['tab', 'settings', 'group', 'page-group', 'select', 'changed-only', 'cancel-scan', 'toggle-detail', 'tutorial', 'text-open', 'text-close', 'flow-open']);
// 변경사항 확인 전에도 허용하는 조작: 목록 탐색, 캔버스 이동, 변경사항 확인
const BEFORE_CHECK = new Set([...WHILE_BUSY, 'scan', 'scan-selected', 'nav', 'nav-suggested', 'create-page-manage', 'new-add', 'new-remove', 'new-select', 'new-edit-title', 'new-section-add', 'new-section-confirm', 'new-section-cancel', 'new-clear', 'arrange-skip', 'arrange-apply', 'new-dialog-close', 'new-cancel-confirm', 'fb-edit-title', 'create-category-toggle', 'create-screen-toggle', 'create-uncreated-only', 'create-submit', 'bulk-open', 'bulk-close', 'bulk-submit', 'pick', 'admin-template', 'admin-gui-width', 'admin-policy-template', 'admin-flipbook-page',
  'text-import', 'text-apply',
  'version-open', 'version-close', 'version-match', 'version-select', 'version-review-only', 'version-reveal', 'version-switch', 'version-cancel']);

import { WORK_LABEL } from '../core/copy.ts';

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// 지우기(x) 아이콘
const X_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
const CHEVRON_RIGHT_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
// 가운데 세로선이 있는 직사각형: UI Flipbook 오른쪽 영역 접기·펼치기
const PANELS_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg>';
const PENCIL_ICON ='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4.5-1 10-10a2.8 2.8 0 0 0-4-4l-10 10L4 20Z"/></svg>';

// 「+ 추가」 버튼 내용. 더하기 아이콘을 글자 앞에 붙인다.
const ADD_LABEL = `<svg class="add-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>${COPY.uiApp101}`;

function option(value: string, label: string, selected: boolean): string {
  return `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
}

// 여러 화면의 값이 서로 다를 때 표시한다. 이 항목은 고를 수 없고, 다른 값을 고르면 선택한 화면 전체에 적용한다.
function mixedOption(): string {
  return `<option value="" selected disabled>${esc(COPY.uiApp175)}</option>`;
}

function mixedMark(mixed: boolean): string {
  return mixed ? ` <span class="mixed">${esc(COPY.uiApp175)}</span>` : '';
}

export function startApp(bridge: Bridge, root: HTMLElement): void {
  let state: State | null = null;
  let actor: Actor | null = null;
  let pages: PageInfo[] = [];
  let issues: string[] = [];
  // 플립북 템플릿의 문제. UI Flipbook 목록 위에 경고로 보여 준다(관리 화면이 아니어도).
  let templateIssues: string[] = [];
  let entries: Entry[] = [];
  // 변경사항 확인 진행. 실행만 해서는 비교하지 않고, 탭 맨 위 버튼을 눌러야 비교한다.
  // partialAt: 선택 화면 확인을 마친 시각
  type Check = { status: ScanState; done: number; total: number; checkedAt: number | null; partialAt: number | null };
  const idleCheck = (): Check => ({ status: 'idle', done: 0, total: 0, checkedAt: null, partialAt: null });
  const check: Record<Team, Check> = { GUI: idleCheck(), UI: idleCheck() };
  const scanStartedAt: Record<Team, number> = { GUI: 0, UI: 0 };
  const cancelPending: Record<Team, boolean> = { GUI: false, UI: false };
  const scanFinishTimer: Record<Team, ReturnType<typeof setTimeout> | null> = { GUI: null, UI: null };
  const MIN_SCAN_VISIBLE_MS = 400;
  const checking = (t: Team) => check[t].status === 'loading' || check[t].status === 'comparing';
  // GUI: 변경사항 확인을 끝까지 마치기 전에는 배포 체크·입력·최종 확인을 막는다. 관리 탭은 막지 않는다.
  // UI Flipbook은 배포하지 않으므로 변경사항 확인 없이 저장된 기록으로 목록과 「화면이 수정되었습니다」를 보여 준다(2026-10-20 사용자 결정).
  const locked = (t: Team) => t === 'GUI' && tab !== 'ADMIN' && !check[t].checkedAt && !check[t].partialAt;
  // 전체 확인 전에는 선택 화면 확인으로 판정이 나온 화면(「비교 전」이 아닌 화면)만 입력·배포할 수 있다.
  const entryLocked = (t: Team, entry: Entry) => t === 'GUI' && (locked(t) || (tab !== 'ADMIN' && !check[t].checkedAt && entry.estimate === 'pending'));
  // 플립북 만들기 직후 받은 플립북 프레임 위치. UI 목록의 사용 안 함 판정에 쓴다.
  let uiScans = new Map<string, UiScan>();
  // 실행한 플러그인 명령(GUI Publish·UI Flipbook). 설정(⚙)을 열면 tab이 ADMIN이 된다.
  let mode: Team = 'GUI';
  let tab: Tab = 'GUI';
  // GUI 배포의 추가 설명. 배포 한 번에 하나(2026-10-20 사용자 결정)
  let comment: BatchComment = emptyComment();
  // 새 플립북(2026-10-21 사용자 요청: 플립북 만들기 탭을 플립북 목록에 합친다). 「새 플립북」을 누르면 목록에 바로 들어가는 미리보기이며,
  // 만들기를 누르기 전에는 저장하지 않는다. 목록에서 드래그하거나 Alt+↑↓로 자리를, 오른쪽에서 페이지·Section을 정한다.
  // section: null이면 첫 화면의 카테고리 Section(화면이 없으면 그 페이지 맨 아래 Section). after: Section 안에서 바로 앞 항목(기존 플립북 ID 또는 새 플립북 키, null이면 맨 앞, 없으면 맨 뒤).
  // 배열 순서는 목록 순서와 같게 유지한다(normalizeNew).
  // seq: 목록에 끼워 넣는 순서(앞 항목이 먼저 놓이게 목록 순서대로 매긴다). 옮긴 기존 플립북과 함께 센다.
  type NewFlipbook = { key: string; uids: string[]; scale: FlipbookScale; scales: Record<string, FlipbookScale>; title: string; pageId: string; section: FlipbookSection | null; after?: string | null; seq: number };
  // 목록에서 옮긴 기존 플립북(2026-10-22 사용자 요청). 키는 플립북 ID다. 만들기(새 플립북이 없으면 배치 반영)를 누르면 캔버스에 반영할지 묻는다.
  type MovedFlipbook = { key: string; pageId: string; section: FlipbookSection; after?: string | null; seq: number };
  let movedFlipbooks: MovedFlipbook[] = [];
  let floatSeq = 0;
  // 새 플립북 확인 모달: 캔버스 배치 반영 여부(arrange), 만들기 취소 확인(cancel)
  let newDialog: 'arrange' | 'cancel' | null = null;
  const NEW_PREFIX = 'new:';
  const isNewKey = (key: string) => key.startsWith(NEW_PREFIX);
  let newFlipbooks: NewFlipbook[] = [];
  let newSeq = 0;
  // 목록에서 고른 새 플립북. 기존 플립북 선택(selection.UI)과 함께 쓰지 않는다.
  let selectedNew: string | null = null;
  // 제목을 고치는 중인 새 플립북 키 또는 기존 플립북 ID와 고치는 자리. 이름을 더블클릭한 자리(목록·오른쪽 영역)에서 고친다(2026-10-22 사용자 요청).
  let editingTitle: string | null = null;
  let editingIn: 'list' | 'detail' = 'detail';
  // 목록을 다시 그린 뒤 목록의 제목 입력에 포커스를 둔다.
  let focusListTitle = false;
  // 새 Section 이름을 입력하는 중인가
  let addingSection = false;
  let newSubmitting = false;
  // 드래그 중인 새 플립북
  let draggingNew: string | null = null;
  let sizeBeforeCreate: { width: number; height: number } | null = null;
  const createCollapsedCategories = new Set<string>();
  let createQuery = '';
  let createUncreatedOnly = false;
  let createScreens: GuiScreenInfo[] = [];
  let createError: string | null = null;
  // 플립북 없는 화면 일괄 만들기 모달. 범위 안의 화면마다 단일 플립북을 하나씩 만든다.
  // excluded: 범위 안에서 체크를 푼 화면. submitting: 만들기 요청 중(완료·오류 메시지를 이 모달이 받는다).
  let bulk: (ScreenFilter & { pageId: string; categories: Set<string>; excluded: Set<string>; submitting: boolean; error: string | null }) | null = null;
  // 썸네일 이미지: 해시 → blob URL(불러오는 중이면 '')
  const thumbUrls = new Map<string, string>();
  // 읽지 못한 썸네일(해시)과 내보내지 못한 프레임 미리보기(`node:` 키). 다시 요청하지 않고 「썸네일 없음」으로 보여 준다.
  const failedPreviews = new Set<string>();
  const drafts: Record<Team, Record<string, Draft>> = { GUI: {}, UI: {} };
  // 필수 입력 테두리는 해당 입력에서 벗어난 뒤 또는 미충족 항목으로 이동한 뒤에만 표시한다.
  const touched: Record<Team, Record<string, Set<string>>> = { GUI: {}, UI: {} };
  const revealed: Record<Team, Set<string>> = { GUI: new Set(), UI: new Set() };
  const selected: Record<Team, string | null> = { GUI: null, UI: null };
  const selection: Record<Team, Set<string>> = { GUI: new Set(), UI: new Set() };
  const anchor: Record<Team, string | null> = { GUI: null, UI: null };
  let addMode: 'category' | 'tag' | 'worker' | null = null;
  let editMode: 'category' | 'tag' | null = null;
  // 그룹은 접힌 상태가 기본이다. 펼친 그룹만 기억한다.
  const expanded: Record<Team, Set<string>> = { GUI: new Set(), UI: new Set() };
  const query: Record<Team, string> = { GUI: '', UI: '' };
  // UI는 만든 플립북 전체를 먼저 보여 준다.
  const changedOnly: Record<Team, boolean> = { GUI: true, UI: false };
  const recentWorker: Record<Team, string | undefined> = { GUI: undefined, UI: undefined };
  let plan: Plan | null = null;
  let toast: { kind: 'info' | 'error'; text: string } | null = null;
  let navSeq = 0;
  let history: { id: string; rows: HistoryRow[] } | null = null;
  // GUI Publish에서 추가한 카테고리. 상태가 돌아오면 해당 화면의 카테고리로 선택한다.
  let pendingCategory: { name: string; keys: string[] } | null = null;
  // 태그 입력란: 추가 후 선택할 태그와 사용 안 함을 한 번 누른 태그
  let pendingTag: { name: string; team: Team; keys: string[] } | null = null;
  let pendingWorker: { name: string; team: Team; keys: string[] } | null = null;
  let tagArmed: string | null = null;
  // 데이터 초기화를 한 번 눌렀는가. 한 번 더 누르면 초기화한다.
  let resetArmed = false;
  // Screen ID 번호 다시 매기기를 한 번 눌렀는가. 한 번 더 누르면 다시 매긴다.
  let renumberArmed = false;
  // 설정에서 열어 둔 아코디언 항목(제목)
  let adminOpen: string | null = null;
  // 새 버전 페이지 탭(2026-10-21 사용자 요청: 설정 안이 아니라 GUI Publish 머리의 탭으로 연다).
  // 비교할 페이지, 비교 결과, 사용자가 고친 연결(화면 ID → 노드 ID, ''는 연결 안 함), 전환을 한 번 눌렀는가
  let versionOpen = false;
  // UI Flipbook의 텍스트 편집 탭(2026-10-22 사용자 요청). 관리를 다녀와도 열린 탭을 유지한다.
  let textOpen = false;
  // UI Flipbook의 플로우 탭(2026-10-23 사용자 결정). 텍스트 편집 탭과 같이 하나만 열린다.
  let flowOpen = false;
  // 플러그인에 마지막으로 알린 텍스트 편집 탭 표시 여부
  let textTabSent = false;
  // GUI 화면정보의 이전 배포 썸네일을 펼쳐 두었는가
  let prevThumbOpen = false;
  let sizeBeforeVersion: { width: number; height: number } | null = null;
  let versionPageId = '';
  let versionMatch: VersionMatchView | null = null;
  let versionChoice = new Map<string, string>();
  let versionArmed = false;
  // 왼쪽 목록에서 고른 항목: 등록 화면(screen) 또는 연결되지 않은 새 프레임(frame, 노드 ID)
  let versionSelected: { kind: 'screen' | 'frame'; id: string } | null = null;
  let versionQuery = '';
  let versionHideSame = false;
  // 유사도 근거: `화면 ID|노드 ID` → 근거(null: 내용 비교 불가). 요청 중이면 undefined로 둔다.
  const versionEvidence = new Map<string, VersionEvidence | null | undefined>();
  // 삭제를 한 번 누른 카테고리. 한 번 더 누르면 삭제한다.
  let deleteArmed: string | null = null;
  // 목록 하단의 연결 끊긴 플립북 전체 삭제를 한 번 눌렀다. 한 번 더 누르면 삭제한다.
  let removeAllArmed = false;
  // UI Flipbook 오른쪽 영역(플립북 상세)을 접었다. 창이 커서 접는 것이므로 창 너비를 목록 너비로 줄인다(2026-10-21 사용자 요청).
  let detailCollapsed = false;
  // 창을 목록 너비로 줄여 둔 동안 펼칠 때 돌아갈 창 너비
  let compactFrom: { width: number } | null = null;
  // 플러그인 본체가 처리 중인 작업. 처리 중에는 목록 탐색 외의 조작을 막는다.
  // 처음에는 본체의 첫 응답을 기다리는 중이다.
  let busyLabel: string | null = COPY.uiApp001;

  root.innerHTML = `
    <div class="busy" role="status" aria-live="polite" hidden><span class="spinner" aria-hidden="true"></span><span class="busy-label"></span></div>
    <header class="tabs" role="tablist"></header>
    <div class="toolbar"></div>
    <section class="list" aria-label="${COPY.uiApp002}"></section>
    <div class="pane-divider" role="separator" aria-orientation="vertical" aria-label="목록과 화면정보 너비 조절" tabindex="0"></div>
    <section class="detail" aria-label="${COPY.uiApp003}"></section>
    <footer class="footer"></footer>
    <div class="toast" role="status" aria-live="polite"></div>
    <div class="overlay" hidden></div>
    <div class="overlay bulk-overlay" hidden></div>
    <div class="overlay arrange-overlay" hidden></div>
    <div class="resize-handle" title="${COPY.uiApp208}" aria-label="${COPY.uiApp208}"></div>`;
  const $ = (sel: string) => root.querySelector(sel) as HTMLElement;
  const editor = textEditor(root);
  const flows = flowView(root, request => bridge.send({ type: 'createFlow', request }));

  // 두 영역 구분선: 현재 창 너비에서 목록 260px, 화면정보 320px을 확보한다.
  {
    const divider = $('.pane-divider');
    const list = $('.list');
    const minList = 260, minDetail = 320, dividerWidth = 8;
    const limits = () => ({ min: minList, max: Math.max(minList, root.clientWidth - dividerWidth - minDetail) });
    const sync = () => {
      const { min, max } = limits();
      divider.setAttribute('aria-valuemin', String(min));
      divider.setAttribute('aria-valuemax', String(max));
      divider.setAttribute('aria-valuenow', String(Math.round(list.getBoundingClientRect().width)));
    };
    const setWidth = (width: number) => {
      const { min, max } = limits();
      root.style.setProperty('--list-width', `${Math.min(max, Math.max(min, Math.round(width)))}px`);
      sync();
    };
    let start: { x: number; width: number } | null = null;
    divider.addEventListener('pointerdown', ev => {
      if (ev.button !== 0 || tab === 'ADMIN') return;
      ev.preventDefault();
      divider.setPointerCapture(ev.pointerId);
      start = { x: ev.clientX, width: list.getBoundingClientRect().width };
      root.classList.add('resizing-panes');
    });
    const stop = (ev: PointerEvent) => {
      if (!start) return;
      start = null;
      root.classList.remove('resizing-panes');
      if (divider.hasPointerCapture(ev.pointerId)) divider.releasePointerCapture(ev.pointerId);
    };
    divider.addEventListener('pointermove', ev => {
      if (!start) return;
      // 플러그인 창 밖에서 버튼을 놓으면 pointerup이 오지 않는다. 돌아왔을 때 버튼이 떼어져 있으면 끝낸다.
      if (!(ev.buttons & 1)) { stop(ev); return; }
      setWidth(start.width + ev.clientX - start.x);
    });
    divider.addEventListener('pointerup', stop);
    divider.addEventListener('pointercancel', stop);
    divider.addEventListener('lostpointercapture', stop);
    divider.addEventListener('keydown', ev => {
      if (tab === 'ADMIN') return;
      const { min, max } = limits();
      const width = list.getBoundingClientRect().width;
      const next = ev.key === 'ArrowLeft' ? width - 10 : ev.key === 'ArrowRight' ? width + 10 : ev.key === 'Home' ? min : ev.key === 'End' ? max : null;
      if (next === null) return;
      ev.preventDefault();
      setWidth(next);
    });
    new ResizeObserver(sync).observe(root);
  }

  // 창 크기 손잡이: 끄는 동안 프레임마다 크기를 보내고, 놓으면 그 크기를 기억한다.
  // 플러그인 창(iframe) 밖으로 나간 동안에는 포인터 이벤트가 오지 않아 크기도 따라가지 않는다. 밖에서 버튼을 놓으면 pointerup이 오지 않으므로,
  // 다시 들어온 첫 움직임에서 버튼이 떼어져 있으면 마지막으로 반영한 크기로 끝낸다(2026-10-22 사용자 보고: 놓은 뒤에도 창 크기가 따라 움직임).
  {
    const handle = $('.resize-handle');
    let start: { x: number; y: number; width: number; height: number } | null = null;
    let pending: { width: number; height: number } | null = null;
    let frame = 0;
    const send = (save = false) => {
      frame = 0;
      // 접어서 줄인 너비는 기억하지 않는다. 다음 실행은 마지막으로 기억한 펼친 크기로 연다.
      if (pending) bridge.send({ type: 'resize', ...pending, save: save && !compactFrom, compact: !!compactFrom });
      if (save) pending = null;
    };
    const stop = (ev: PointerEvent) => {
      if (!start) return;
      start = null;
      if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
      if (frame) cancelAnimationFrame(frame);
      send(true);
    };
    handle.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      handle.setPointerCapture(ev.pointerId);
      start = { x: ev.screenX, y: ev.screenY, width: root.offsetWidth, height: root.offsetHeight };
    });
    handle.addEventListener('pointermove', ev => {
      if (!start) return;
      if (!(ev.buttons & 1)) { stop(ev); return; }
      pending = clampWindow(start.width + ev.screenX - start.x, start.height + ev.screenY - start.y, !!compactFrom);
      if (!frame) frame = requestAnimationFrame(() => send());
    });
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    handle.addEventListener('lostpointercapture', stop);
  }

  // ── 상태 계산 ─────────────────────────────────────────

  const team = (): Team => (tab === 'ADMIN' ? mode : tab);
  function draftOf(t: Team, entry: Entry): Draft {
    if (!drafts[t][entry.key]) drafts[t][entry.key] = defaultDraft(t, state!, entry, recentWorker[t]);
    return drafts[t][entry.key];
  }

  function validation(t: Team, entry: Entry, index?: DraftIndex): Validation {
    return validateDraft(t, state!, entry, drafts[t][entry.key], drafts[t], entriesFor(t), index);
  }

  // UI 목록: GUI 등록 화면마다 플립북 비교 결과를 변경 추정으로 쓴다. GUI 원본 비교·이름·카테고리 표시는 넣지 않는다.
  function uiEntries(): Entry[] { return buildUiEntries(state!, uiScans); }

  const entriesFor = (t: Team): Entry[] => (t === 'UI' ? uiEntries() : entries);

  // 왼쪽 목록에 반영할 입력값. 배포를 켠 화면만 쓴다(배포를 끄면 입력 영역이 숨고 배포에도 쓰이지 않는다).
  function shownDraft(entry: Entry): Draft | null {
    const draft = drafts.GUI[entry.key];
    return draft?.included && !draft.notScreen && !isDeletion(entry, draft) && !isPrevious(entry, draft) ? draft : null;
  }

  // GUI 목록에 보이는 이름·Screen ID. 배포 전이라도 배포할 값(draftName·draftCode)을 쓴다. 화면 선택 드롭다운도 같은 값을 쓴다.
  function guiDisplay(entry: Entry, saved = savedGuiDisplay(state!, entry)): { name: string; code: string } {
    const draft = shownDraft(entry);
    if (!draft) return saved;
    return { name: draftName(state!, entry, draft) || saved.name, code: entry.screenId ? draftCode(state!, entry, draft) : '' };
  }

  // GUI 목록의 카테고리 그룹·케이스 위치. 배포할 값과 같은 규칙(publish.ts guiItem)으로 입력 중인 값을 쓴다(2026-10-21 사용자 요청).
  function guiPlace(entry: Entry, saved = savedGuiPlace(state!, entry.screenId)): GuiPlace {
    const draft = shownDraft(entry);
    if (!draft) return saved;
    const relation = (target: GuiPlace) => draft.relation === 'case' ? draft.baseScreenId ?? null : draft.relation === 'standalone' ? null : target.baseScreenId;
    if (registersNew('GUI', entry)) return { categoryId: draft.categoryId ?? null, baseScreenId: relation(savedGuiPlace(state!, null)) };
    // 기존 화면 교체는 이전 화면의 카테고리를 기준으로 하고 화면 관계는 그대로 둔다.
    if (!entry.screenId) { const target = savedGuiPlace(state!, draft.replaceScreenId ?? null); return { categoryId: draft.categoryId ?? target.categoryId, baseScreenId: target.baseScreenId }; }
    return { categoryId: draft.categoryId ?? saved.categoryId, baseScreenId: relation(saved) };
  }

  // 입력으로 선택한 화면의 그룹·기본 화면이 바뀌면 옮겨 간 그룹을 펼치고 행을 보이게 한다.
  const shownPlace = new Map<string, string>();
  let revealSelection = false;
  function followSelection() {
    for (const entry of selectedEntries('GUI')) {
      const place = guiPlace(entry);
      const group = guiGroupKey(state!, place.categoryId);
      const key = `${group}|${place.baseScreenId ?? ''}`;
      const before = shownPlace.get(entry.key);
      if (before !== undefined && before !== key) { expanded.GUI.add(group); revealSelection = true; }
      shownPlace.set(entry.key, key);
    }
  }

  // UI 플립북 목록은 페이지별로 접는다(2026-10-23 사용자 요청). 「페이지|Section」 키 중 그 페이지의 키가 하나라도 있으면 펼친다.
  const pageOfGroup = (groupKey: string) => { const at = groupKey.indexOf('|'); return at < 0 ? groupKey : groupKey.slice(0, at); };
  const pageOpen = (pageId: string) => [...expanded.UI].some(key => pageOfGroup(key) === pageId);

  function listModel(t: Team): ListModel {
    if (t === 'GUI') followSelection();
    const sourceEntries = entriesFor(t);
    const index = t === 'GUI' ? draftIndex(state!, sourceEntries) : undefined;
    const groups = new Set<string>([UNCATEGORIZED, ...state!.categories.keys(), ...[...state!.flipbooks.values()].map(f => `${f.pageId ?? state!.project.flipbookPageId ?? ''}|${f.category.key}`)]);
    const collapsed = new Set([...groups].filter(g => !(t === 'UI' ? pageOpen(pageOfGroup(g)) : expanded[t].has(g))));
    return buildList(t, state!, sourceEntries, e => (t === 'UI' || entryLocked(t, e) ? 'excluded' : validation(t, e, index).status), {
      collapsed, query: query[t], changedOnly: changedOnly[t] && !locked(t), pages,
      changed: t === 'UI' ? e => !!e.flipbookId && needsReview(state!, e.flipbookId) : undefined,
      spots: t === 'UI' ? id => uiScans.get(id)?.spot : undefined,
      guiDisplay, guiPlace,
    });
  }

  const current = (): Entry | null => entriesFor(team()).find(e => e.key === selected[team()]) ?? null;
  const selectedEntries = (t = team()): Entry[] => entriesFor(t).filter(e => selection[t].has(e.key));
  const selectedKeys = (t = team()): string[] => selectedEntries(t).map(e => e.key);
  const detailLocked = (t: Team) => locked(t) || selectedEntries(t).some(e => entryLocked(t, e));

  // ── 새 플립북(만들기 전 미리보기) ──
  const flipbookPageOptions = () => pages.filter(pg => state?.project.flipbookPageIds.includes(pg.id) && pg.id !== state.project.dataPageId);
  const onFlipbookPage = (g: ArrangedGroup) => !!g.pageId && flipbookPageOptions().some(p => p.id === g.pageId);
  // 새 플립북을 넣거나 기존 플립북을 놓을 수 있는 그룹: 플립북 페이지의 Section. 「(섹션 없음)」에는 넣지 않는다(2026-10-23 사용자 결정).
  const placeable = (g: ArrangedGroup) => onFlipbookPage(g) && g.section.key !== NO_SECTION_KEY;
  const activeScreens = () => createScreens.filter(x => x.status === 'active' && x.sourceNodeId);
  const currentNew = (): NewFlipbook | null => newFlipbooks.find(n => n.key === selectedNew) ?? null;
  function newScreens(n: NewFlipbook): GuiScreenInfo[] {
    const screens = activeScreens();
    return n.uids.map(uid => screens.find(screen => screen.uid === uid)).filter((screen): screen is GuiScreenInfo => !!screen);
  }
  const newKind = (n: NewFlipbook) => rowKind({ uids: n.uids, multi: n.uids.length > 1, scale: n.scale });
  // 따로 고르지 않았으면 첫 화면의 카테고리 Section이다. 화면이 없으면 「정책」으로 보내지 않고 그 페이지 맨 아래 Section에 둔다
  // (2026-10-22 사용자 요청). 페이지에 플립북이 없으면 미분류다.
  // canvas: 이미 계산한 캔버스 배치. 목록 전체를 배치할 때 새 플립북마다 다시 계산하지 않도록 넘긴다.
  function autoSection(n: NewFlipbook, canvas?: ArrangedGroup[]): FlipbookSection {
    const first = newScreens(n)[0];
    if (!state) return defaultSection(first);
    if (first) return defaultSection(first, canvas ? canvas.filter(g => g.pageId === n.pageId && g.section.key !== NO_SECTION_KEY).map(g => g.section) : pageSections(state, n.pageId));
    const onPage = (canvas ?? canvasArrangement()).filter(g => g.pageId === n.pageId && g.section.key !== NO_SECTION_KEY);
    return onPage.length ? onPage[onPage.length - 1].section : defaultSection(undefined);
  }
  const newSection = (n: NewFlipbook, canvas?: ArrangedGroup[]): FlipbookSection => n.section ?? autoSection(n, canvas);
  // 제목을 비우면 첫 화면 이름, 화면이 없으면 「새 플립북」을 쓴다.
  const newTitle = (n: NewFlipbook): string => n.title.trim() || defaultTitle(newKind(n), newScreens(n));
  const canvasArrangement = (): ArrangedGroup[] => state ? arrangeFlipbooks(state, pages, id => uiScans.get(id)?.spot) : [];
  // 목록 순서: 기존 플립북은 캔버스 순서, 새 플립북과 옮긴 기존 플립북은 정한 자리
  function arrangement(): ArrangedGroup[] {
    if (!state) return [];
    const moving = new Set(movedFlipbooks.map(m => m.key));
    const canvas = canvasArrangement();
    const placed = canvas.map(g => ({ ...g, items: g.items.filter(item => !moving.has(item)) }));
    const floats = [...newFlipbooks.map(n => ({ key: n.key, pageId: n.pageId, section: newSection(n, canvas), after: n.after, seq: n.seq })), ...movedFlipbooks].sort((a, b) => a.seq - b.seq);
    return placeDrafts(placed, floats, pages);
  }
  // 목록에 보이는 순서로 새 플립북·옮긴 기존 플립북의 앞 항목과 순서를 다시 적는다. 같은 자리에 여럿을 넣거나 옮긴 뒤에도 순서가 그대로 남는다.
  function normalizeNew(groups = arrangement()) {
    const byKey = new Map<string, NewFlipbook | MovedFlipbook>([...newFlipbooks, ...movedFlipbooks].map(n => [n.key, n]));
    const order: NewFlipbook[] = [];
    let seq = 0;
    for (const group of groups) group.items.forEach((item, i) => {
      const n = byKey.get(item);
      if (!n) return;
      n.after = i ? group.items[i - 1] : null;
      n.seq = ++seq;
      if (isNewKey(n.key)) order.push(n as NewFlipbook);
    });
    newFlipbooks = order;
    floatSeq = seq;
  }
  // 옮긴 기존 플립북이 원래 Section으로 돌아오고 그 Section의 기존 플립북 순서도 캔버스와 같아지면 옮기지 않은 것으로 본다.
  function pruneMoved() {
    if (!movedFlipbooks.length) return;
    const existing = (g: ArrangedGroup) => g.items.filter(item => !isNewKey(item)).join('\n');
    const original = canvasArrangement();
    const originalGroup = new Map(original.flatMap(g => g.items.map(item => [item, g.key] as const)));
    const originalOrder = new Map(original.map(g => [g.key, existing(g)]));
    const groupOf = new Map(arrangement().flatMap(g => g.items.map(item => [item, g] as const)));
    const keep = movedFlipbooks.filter(m => {
      const g = groupOf.get(m.key);
      return !g || g.key !== originalGroup.get(m.key) || existing(g) !== originalOrder.get(g.key);
    });
    if (keep.length === movedFlipbooks.length) return;
    movedFlipbooks = keep;
    normalizeNew();
  }
  // 캔버스에 반영할 옮기기: 목록 순서대로 보낸다. 앞 항목은 같은 Section에서 바로 앞 기존 플립북이다(새 플립북은 아직 없으므로 건너뛴다).
  function plannedMoves(): FlipbookMove[] {
    const moving = new Set(movedFlipbooks.map(m => m.key));
    const out: FlipbookMove[] = [];
    for (const group of arrangement()) {
      let previous: string | null = null;
      for (const item of group.items) {
        if (isNewKey(item)) continue;
        if (moving.has(item) && group.pageId) out.push({ flipbookId: item, pageId: group.pageId, section: group.section, after: previous });
        previous = item;
      }
    }
    return out;
  }
  // 새 플립북이나 기존 플립북을 다른 자리로 옮긴다. to: 그 항목 앞(before)·뒤(after), 또는 그룹 맨 앞(start)·맨 뒤(end).
  // 다른 Section으로 옮기면 그 페이지·Section을 고른 것으로 본다. 기존 플립북은 만들기 전까지 목록에서만 옮긴다.
  function moveItem(key: string, groupKey: string, to: { before?: string; after?: string; start?: boolean }) {
    const groups = arrangement();
    const target = groups.find(g => g.key === groupKey);
    if (!target?.pageId || !placeable(target) || (to.before === key || to.after === key)) return;
    const n = isNewKey(key) ? newFlipbooks.find(x => x.key === key) : undefined;
    let m = n ? undefined : movedFlipbooks.find(x => x.key === key);
    if (!n && !m) {
      if (isNewKey(key) || state?.flipbooks.get(key)?.status !== 'active') return;
      m = { key, pageId: target.pageId, section: target.section, seq: 0 };
      movedFlipbooks.push(m);
    }
    for (const group of groups) group.items = group.items.filter(item => item !== key);
    const ref = to.before ?? to.after;
    const at = ref ? target.items.indexOf(ref) + (to.after ? 1 : 0) : to.start ? 0 : target.items.length;
    target.items.splice(ref && at < (to.after ? 1 : 0) ? target.items.length : at, 0, key);
    if (n && (n.pageId !== target.pageId || newSection(n).key !== target.section.key)) { n.pageId = target.pageId; n.section = target.section; }
    if (m) { m.pageId = target.pageId; m.section = target.section; }
    normalizeNew(groups);
    pruneMoved();
    expanded.UI.add(target.key);
  }
  // 새 플립북을 다른 페이지·Section의 맨 뒤로 옮긴다(section이 null이면 화면 카테고리 Section). 바로 뒤에 있던 항목은 제자리에 남긴다.
  function relocateNew(n: NewFlipbook, pageId: string, section: FlipbookSection | null) {
    for (const other of [...newFlipbooks, ...movedFlipbooks]) if (other.after === n.key) other.after = n.after;
    n.pageId = pageId; n.section = section; n.after = undefined;
    // 가장 나중에 놓아야 그 Section의 다른 항목보다 뒤에 놓인다(placeDrafts는 순서대로 놓는다).
    n.seq = ++floatSeq;
    normalizeNew();
    expanded.UI.add(`${pageId}|${newSection(n).key}`);
  }
  // Alt+↑↓: 한 칸 옮긴다. 그룹 끝에서는 이웃 그룹의 맨 끝·맨 앞으로 넘어간다.
  function stepItem(key: string, step: -1 | 1) {
    const groups = arrangement().filter(placeable);
    const gi = groups.findIndex(g => g.items.includes(key));
    if (gi < 0) return;
    const items = groups[gi].items;
    const i = items.indexOf(key);
    const neighbor = items[i + step];
    if (neighbor) { moveItem(key, groups[gi].key, step < 0 ? { before: neighbor } : { after: neighbor }); return; }
    const next = groups[gi + step];
    if (next) moveItem(key, next.key, step < 0 ? {} : { start: true });
  }
  // 「새 플립북」: 고른 항목 바로 다음(같은 페이지·Section)에 넣고 고른다. 고른 항목이 없으면 기본 페이지의 화면 카테고리 Section 맨 뒤다.
  // quiet: 화면 우클릭으로 추가. 고른 항목을 바꾸지 않고, 화면·제목이 빈 새 플립북이 있으면 그 항목을 채운다.
  function addNew(uids: string[] = [], quiet = false): boolean {
    const options = flipbookPageOptions();
    if (!state || !options.length) { notify('error', COPY.uiApp209); return false; }
    if (!createScreens.length) bridge.send({ type: 'guiScreens' });
    if (quiet) {
      const empty = newFlipbooks.find(n => !n.uids.length && !n.title.trim());
      if (empty) { empty.uids = uids; normalizeNew(); expanded.UI.add(`${empty.pageId}|${newSection(empty).key}`); renderList(); renderFooter(); return true; }
    }
    if (!newFlipbooks.length && !sizeBeforeCreate) {
      // 오른쪽 영역을 펼치며 넣는 중이면 접기 전 너비를 기준으로 넓힌다.
      const expanding = !!compactFrom && !detailCollapsed;
      sizeBeforeCreate = { width: compactFrom?.width ?? root.offsetWidth, height: root.offsetHeight };
      if (expanding) compactFrom = null;
      if (expanding || sizeBeforeCreate.width < 960 || sizeBeforeCreate.height < 800) bridge.send({ type: 'resize', width: Math.max(sizeBeforeCreate.width, 960), height: Math.max(sizeBeforeCreate.height, 800) });
    }
    const pageId = options.find(pg => pg.id === state!.project.flipbookPageId)?.id ?? options[0].id;
    const n: NewFlipbook = { key: `${NEW_PREFIX}${++newSeq}`, uids, scale: 1, scales: {}, title: '', pageId, section: null, seq: ++floatSeq };
    const anchorKey = quiet ? null : selectedNew ?? (selection.UI.size ? selected.UI : null);
    const group = anchorKey ? arrangement().find(g => g.items.includes(anchorKey)) : null;
    if (anchorKey && group?.pageId && placeable(group)) { n.pageId = group.pageId; n.section = group.section; n.after = anchorKey; }
    newFlipbooks.push(n);
    normalizeNew();
    expanded.UI.add(`${n.pageId}|${newSection(n).key}`);
    createError = null;
    if (!quiet) {
      selectedNew = n.key; editingTitle = null; addingSection = false;
      selection.UI.clear(); selected.UI = null;
      renderDetail();
    }
    renderList(); renderFooter();
    return true;
  }
  function removeNew(key: string) {
    const groups = arrangement();
    for (const group of groups) group.items = group.items.filter(item => item !== key);
    newFlipbooks = newFlipbooks.filter(n => n.key !== key);
    normalizeNew(groups);
    if (selectedNew === key) { selectedNew = null; editingTitle = null; }
    if (!newFlipbooks.length && !movedFlipbooks.length) finishNew();
    renderList(); renderDetail(); renderFooter();
  }
  // 새 플립북을 모두 만들었거나 지웠다. 옮긴 기존 플립북도 반영했거나 되돌렸다. 「새 플립북」을 처음 누를 때 넓힌 창을 되돌린다.
  function finishNew() {
    newFlipbooks = [];
    movedFlipbooks = [];
    newDialog = null;
    renderNewDialog();
    selectedNew = null;
    editingTitle = null;
    addingSection = false;
    createError = null;
    // 접어 둔 동안이면 창은 그대로 두고 펼칠 때 돌아갈 너비만 바꾼다.
    if (sizeBeforeCreate) {
      if (compactFrom) compactFrom.width = sizeBeforeCreate.width;
      else bridge.send({ type: 'resize', ...sizeBeforeCreate });
      sizeBeforeCreate = null;
    }
  }
  // 고를 수 있는 Section: 그 페이지에 있는 Section과 다른 새 플립북에 정한 새 Section
  function sectionChoices(pageId: string): FlipbookSection[] {
    const out = new Map(pageSections(state!, pageId).map(s => [s.key, s]));
    for (const n of newFlipbooks) if (n.pageId === pageId && n.section && !out.has(n.section.key)) out.set(n.section.key, n.section);
    return [...out.values()];
  }
  function selectNew(key: string) {
    selectedNew = key;
    if (editingTitle !== key) editingTitle = null;
    addingSection = false;
    selection.UI.clear(); selected.UI = null; anchor.UI = null;
    removeAllArmed = false;
    renderList(); renderDetail(); renderFooter();
  }
  // 만들기(새 플립북이 없으면 배치 반영). 옮긴 기존 플립북이 있으면 캔버스 배치에 반영할지 먼저 묻는다(2026-10-22 사용자 요청).
  // reflect: 모달에서 고른 답. 반영하지 않으면 기존 플립북은 캔버스 순서로 돌아가고 새 플립북만 만든다.
  function submitNew(reflect?: boolean) {
    if (!state || newSubmitting || (!newFlipbooks.length && !movedFlipbooks.length)) return;
    const options = flipbookPageOptions();
    normalizeNew();
    pruneMoved();
    if (movedFlipbooks.length && reflect === undefined) { newDialog = 'arrange'; renderNewDialog(); return; }
    newDialog = null;
    renderNewDialog();
    if (!reflect && movedFlipbooks.length) { movedFlipbooks = []; normalizeNew(); }
    if (!newFlipbooks.length && !movedFlipbooks.length) { finishNew(); renderList(); renderDetail(); renderFooter(); return; }
    if (newFlipbooks.some(n => !options.some(p => p.id === n.pageId))) { createError = COPY.uiApp209; renderFooter(); return; }
    const moves = plannedMoves();
    const index = new Map(newFlipbooks.map((n, i) => [n.key, i]));
    const rows: FlipbookRowRequest[] = newFlipbooks.map(n => ({
      uids: n.uids, multi: n.uids.length > 1, scale: n.scale, scales: n.scales, title: n.title.trim(), pageId: n.pageId, section: newSection(n),
      after: n.after === undefined || n.after === null ? n.after : isNewKey(n.after) ? `row:${index.get(n.after)}` : n.after,
    }));
    newSubmitting = true;
    createError = null;
    bridge.send({ type: 'createFlipbooks', request: { pageId: options.find(pg => pg.id === state!.project.flipbookPageId)?.id ?? newFlipbooks[0]?.pageId ?? moves[0].pageId, rows, moves } });
    renderList(); renderDetail(); renderFooter();
  }
  // 새 플립북 확인 모달. 배치 반영 여부는 「반영하지 않음」·「반영함」, 만들기 취소는 「계속 편집」·「모두 취소」 두 버튼이다.
  // 두 번 눌러 실행하는 버튼은 누적 데이터 삭제처럼 중요한 동작에만 쓰고, 만들기 중 취소는 모달로 확인한다(2026-10-22 사용자 요청).
  function renderNewDialog() {
    const overlay = $('.arrange-overlay');
    if (!newDialog) { overlay.hidden = true; overlay.innerHTML = ''; return; }
    overlay.innerHTML = newDialog === 'arrange'
      ? `<div class="dialog arrange-dialog" role="dialog" aria-modal="true" aria-label="${COPY.uiApp317}">
      <h2>${COPY.uiApp317}</h2>
      <p>${COPY.uiApp318} <b>${movedFlipbooks.length}</b>${COPY.uiApp319}</p>
      <p class="note">${COPY.uiApp320}</p>
      <div class="dialog-actions"><button data-action="arrange-skip">${COPY.uiApp321}</button><button class="primary" data-action="arrange-apply">${COPY.uiApp322}</button></div></div>`
      : `<div class="dialog arrange-dialog cancel-dialog" role="dialog" aria-modal="true" aria-label="${COPY.uiApp323}">
      <h2>${COPY.uiApp323}</h2>
      <p>${COPY.uiApp324}</p>
      <div class="dialog-actions"><button data-action="new-dialog-close">${COPY.uiApp325}</button><button class="danger" data-action="new-cancel-confirm">${COPY.uiApp326}</button></div></div>`;
    overlay.hidden = false;
    overlay.querySelector<HTMLButtonElement>('.dialog-actions button:last-child')?.focus();
  }
  // 「취소」·「플립북 N개 만들기」(새 플립북이 없으면 「배치 반영」)
  function newActions(): string {
    const label = newSubmitting ? COPY.uiApp330 : newFlipbooks.length ? `${COPY.uiApp331} ${newFlipbooks.length}${COPY.uiApp332}` : COPY.uiApp316;
    return `<button data-action="new-clear" ${newSubmitting ? 'disabled' : ''}>${COPY.uiApp149}</button>
      <button class="primary" data-action="create-submit" ${newSubmitting || !flipbookPageOptions().length ? 'disabled' : ''}>${label}</button>`;
  }
  // 오른쪽에 「플립북 편집」이 보이면 버튼은 그 머리에 있고 하단 줄은 없다(2026-10-22 사용자 요청).
  const editingNewShown = () => !!currentNew() && !detailCollapsed;
  function renameExisting(id: string, title: string) {
    const fb = state?.flipbooks.get(id);
    editingTitle = null;
    if (fb && title.trim() !== fb.title && (title.trim() || !fb.autoTitle)) bridge.send({ type: 'renameFlipbook', id, title });
    renderDetail(); renderList();
  }
  // 제목 고치기를 연다. 목록에서 열면 그 행의 이름을, 오른쪽 영역에서 열면 제목을 입력으로 바꾼다.
  function editTitle(id: string, where: 'list' | 'detail') {
    editingTitle = id;
    editingIn = where;
    focusListTitle = where === 'list';
    renderList(); renderDetail();
    if (where === 'detail') {
      const input = root.querySelector<HTMLInputElement>('.detail .title-input');
      input?.focus(); input?.select();
    }
  }
  const editingAt = (id: string | undefined, where: 'list' | 'detail') => !!id && editingTitle === id && editingIn === where;

  // ── 렌더링 ───────────────────────────────────────────

  // 관리는 탭이 아니라 오른쪽 위 톱니바퀴(설정)로 연다(2026-10-20 사용자 결정).
  const GEAR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>';
  // 튜토리얼은 톱니바퀴 오른쪽(원래 톱니바퀴 자리)의 도움말로 연다(2026-10-21 사용자 요청).
  const HELP = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>';
  function renderTabs() {
    const settings = tab === 'ADMIN';
    // 머리에는 명령 이름(GUI Publish·UI Flipbook)을 쓰지 않고 탭만 둔다(2026-10-22 사용자 요청). 탭이 없는 관리 화면만 「관리」를 쓴다.
    $('.tabs').innerHTML = `${settings ? `<span class="app-title">${COPY.uiApp004}</span>` : ''}` +
      `${mode === 'GUI' && !settings ? `<div class="create-tabs"><button data-action="version-close" aria-selected="${!versionOpen}">${COPY.uiApp272}</button><button data-action="version-open" aria-selected="${versionOpen}">${COPY.uiApp248}</button></div>` : ''}` +
      `${mode === 'UI' && !settings ? `<div class="create-tabs"><button data-action="text-close" aria-selected="${!textOpen && !flowOpen}">${COPY.uiApp302}</button><button data-action="text-open" aria-selected="${textOpen}">${COPY.uiApp303}</button><button data-action="flow-open" aria-selected="${flowOpen}">${COPY.flow020}</button></div>` : ''}` +
      `<span class="who" title="${COPY.uiApp005}">${esc(actor?.name ?? '')}</span>` +
      `<button class="icon-button" data-action="settings" aria-pressed="${settings}" title="${COPY.uiApp004}" aria-label="${COPY.uiApp004}">${GEAR}</button>` +
      `<button class="icon-button help-button" data-action="tutorial" title="${COPY.uiTutorial001}" aria-label="${COPY.uiTutorial001}">${HELP}</button>`;
  }

  function renderToolbar() {
    if (tab === 'ADMIN' || team() === 'UI') {
      $('.toolbar').innerHTML = (tab !== 'ADMIN' && templateIssues.length
        ? `<div class="template-warning" role="alert"><b class="bad">${COPY.uiApp239}</b>${templateIssues.map(i => `<span class="bad">${esc(i)}</span>`).join('')}</div>` : '')
        + (tab !== 'ADMIN' && state ? pendingLine() : '');
      return;
    }
    const t = team();
    const title = t === 'UI' ? COPY.uiApp006 : COPY.uiApp007;
    $('.toolbar').innerHTML = `
      <div class="check-row${checking(t) ? ' is-checking' : ''}">
        <button class="primary" data-action="scan" title="${title}" ${checking(t) ? 'disabled' : ''}>${COPY.uiApp008}</button>
        <button data-action="scan-selected" title="${t === 'UI' ? COPY.uiApp178 : COPY.uiApp179}" ${checking(t) || !selection[t].size ? 'disabled' : ''}>${COPY.uiApp177}</button>
        ${checking(t) ? '<span class="spinner" aria-hidden="true"></span>' : ''}
        <span class="progress" aria-live="polite">${esc(progressText(t))}</span>
        ${checking(t) ? `<button data-action="cancel-scan">${COPY.uiApp009}</button>` : ''}
      </div>`;
  }

  function updateScanStatus(t: Team, next: Check) {
    const previous = check[t];
    check[t] = next;
    if (tab !== t) return;
    if (previous.status !== next.status || previous.checkedAt !== next.checkedAt || previous.partialAt !== next.partialAt) {
      // 불러오는 중 → 비교하는 중에는 툴바 구성이 같다. 다시 그리면 누르던 취소 버튼이 바뀌어 클릭이 사라진다.
      const sameToolbar = checking(t) && (previous.status === 'loading' || previous.status === 'comparing');
      const progress = root.querySelector('.toolbar .progress');
      if (sameToolbar && progress) progress.textContent = progressText(t); else renderToolbar();
      renderList(); renderFooter();
      if (!previous.checkedAt !== !next.checkedAt || previous.partialAt !== next.partialAt) renderDetail();
    } else {
      const progress = root.querySelector('.toolbar .progress');
      if (progress) progress.textContent = progressText(t);
    }
  }

  function clearScanFinishTimer(t: Team) {
    if (scanFinishTimer[t]) clearTimeout(scanFinishTimer[t]);
    scanFinishTimer[t] = null;
  }

  function clock(ms: number): string {
    const d = new Date(ms + (state?.project.utcOffsetMinutes ?? 540) * 60000);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }

  function progressText(t: Team): string {
    const c = check[t];
    if (t === 'UI' && !state?.project.flipbookPageIds.length && !state?.flipbooks.size) return COPY.uiApp010;
    if (c.status === 'loading') return t === 'UI' ? COPY.uiApp011 : COPY.uiApp012;
    if (c.status === 'comparing') return `${COPY.uiApp013} ${c.done}/${c.total}`;
    if (c.checkedAt) return `${COPY.uiApp014} ${clock(c.checkedAt)} · ${c.total}${COPY.uiApp015}`;
    if (c.partialAt && c.status === 'done') return `${COPY.uiApp180} ${clock(c.partialAt)} · ${c.total}${COPY.uiApp015}`;
    if (c.status === 'cancelled') return COPY.uiApp016;
    if (c.status === 'failed') return COPY.uiApp017;
    return COPY.uiApp018;
  }

  function dot(status: InputStatus) {
    const symbol = status === 'ready-plus' ? '◉' : '●';
    return `<span class="dot ${status}" role="img" aria-label="${STATUS_LABEL[status]}" title="${STATUS_LABEL[status]}">${symbol}</span>`;
  }

  // 같은 프레임에 들어온 목록·진행률·입력 갱신은 한 번 계산하고 함께 그린다.
  let listDirty = false, footerDirty = false, renderFrame = 0;
  function scheduleList() {
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      const model = state && tab !== 'ADMIN' ? listModel(team()) : undefined;
      if (listDirty) paintList(model);
      if (footerDirty) paintFooter(model);
      listDirty = footerDirty = false;
    });
  }
  function renderList() { listDirty = true; scheduleList(); }
  function renderFooter() { footerDirty = true; scheduleList(); }
  let listRebuildTimer: ReturnType<typeof setTimeout> | null = null;
  function deferListRebuild() {
    if (listRebuildTimer) clearTimeout(listRebuildTimer);
    listRebuildTimer = setTimeout(() => { listRebuildTimer = null; renderList(); }, 120);
  }
  function updateVisibleGuiNames() {
    const selectedRows = selection.GUI;
    for (const row of root.querySelectorAll<HTMLElement>('.list-box .row[data-action="select"]')) {
      const key = row.dataset.key;
      if (!key || !selectedRows.has(key)) continue;
      const entry = entries.find(item => item.key === key);
      if (!entry) continue;
      const display = guiDisplay(entry);
      const name = row.querySelector<HTMLElement>('.name');
      if (name) name.textContent = display.name;
      const code = row.querySelector<HTMLElement>('.id-tag');
      if (code) code.textContent = display.code;
    }
  }

  // GUI 행 선택은 목록 구조를 바꾸지 않으므로 기존 DOM을 유지한다.
  function paintGuiSelection() {
    for (const row of root.querySelectorAll<HTMLElement>('.list-box .row[data-action="select"]')) {
      const selected = selection.GUI.has(row.dataset.key ?? '');
      if (row.classList.contains('selected') === selected) continue;
      row.classList.toggle('selected', selected);
      row.setAttribute('aria-selected', String(selected));
    }
  }

  function allInclude(checked: number, total: number, lock: boolean): string {
    return `<label class="check all-include"><input type="checkbox" data-action="include-all" ${total && checked === total ? 'checked' : ''} ${total && !lock ? '' : 'disabled'}> ${COPY.uiApp030}</label>`;
  }

  function paintList(sharedModel?: ListModel) {
    if (tab === 'ADMIN' || !state) { $('.list').innerHTML = ''; return; }
    const t = team();
    const model = sharedModel ?? listModel(t);
    if (t === 'UI') { paintFlipbookList(model); return; }
    const list = $('.list');
    if (list.dataset.team !== t || !list.querySelector('.list-body')) {
      list.dataset.team = t;
      list.innerHTML = `<div class="list-filters"><input type="search" placeholder="${COPY.uiApp020}" value="${esc(query[t])}" data-input="query" aria-label="${COPY.uiApp021}"><div class="filter-line"><span class="all-slot"></span><label class="switch"><span>${COPY.uiApp022}</span><input type="checkbox" role="switch" data-action="changed-only" ${changedOnly[t] ? 'checked' : ''}></label></div></div><div class="list-body"></div>`;
    }
    const body = list.querySelector<HTMLElement>('.list-body')!;
    // 확인 전 안내는 오른쪽 입력 영역 가운데에 둔다(renderDetail).
    if (!state.project.scopePageIds.length && t === 'GUI') {
      body.innerHTML = `<p class="empty">${COPY.uiApp025} <button data-action="tab" data-tab="ADMIN">${COPY.uiApp026}</button>${COPY.uiApp027}</p>`;
      return;
    }
    // 스크롤 박스 노드를 유지한다. 노드를 교체하면 행 선택 직후 브라우저가 스크롤을 맨 위로 돌린다.
    let box = body.querySelector<HTMLElement>('.list-box');
    if (!box) {
      body.innerHTML = '';
      box = document.createElement('div');
      box.className = 'list-box';
      body.append(box);
    }
    // 「모두 배포하기」는 「변경된 화면만 보기」와 같은 줄 왼쪽에 둔다.
    const allSlot = list.querySelector<HTMLElement>('.all-slot')!;
    // 변경사항 확인 전에는 「모두 배포하기」·「변경된 화면만 보기」 줄을 비활성화하고 필터를 적용하지 않는다.
    const filterLocked = locked(t);
    const onlyChanged = list.querySelector<HTMLInputElement>('[data-action="changed-only"]')!;
    onlyChanged.disabled = filterLocked;
    onlyChanged.checked = changedOnly[t] && !filterLocked;
    list.querySelector('.filter-line')!.classList.toggle('disabled', filterLocked);
    if (!model.groups.length) { allSlot.innerHTML = allInclude(0, 0, true); body.querySelector('.review-count')?.remove(); box.innerHTML = `<p class="empty">${query[t] ? COPY.uiApp028 : COPY.uiApp029}</p>`; return; }
    const all = model.groups.flatMap(g => g.visibleRows);
    const checked = all.filter(r => draftOf(t, r.entry).included).length;
    const lock = locked(t);
    allSlot.innerHTML = allInclude(checked, all.length, lock);
    box.innerHTML = model.groups.map(g => `
      <div class="group">
        <div class="group-bar"><input type="checkbox" data-action="include-group" data-group="${esc(g.key)}" ${g.visibleRows.length && g.visibleRows.every(r => draftOf(t, r.entry).included) ? 'checked' : ''} ${g.visibleRows.length && !lock ? '' : 'disabled'} aria-label="${esc(g.name)}${COPY.uiApp032}">
        <button class="group-head" data-action="group" data-group="${esc(g.key)}" aria-expanded="${g.expanded}">
          <span class="caret">${g.expanded ? '▾' : '▸'}</span> ${esc(g.name)}
          <span class="count">${g.total}${COPY.uiApp033} ${g.included}</span>
        </button></div>
        ${g.rows.map(r => {
          const draft = drafts[t][r.entry.key];
          const sel = selection[t].has(r.entry.key);
          return `<div class="row${sel ? ' selected' : ''}${r.depth ? ' case' : ''}" data-action="select" data-key="${esc(r.entry.key)}" tabindex="0" aria-selected="${sel}">
            ${dot(r.status)}
            <input type="checkbox" data-action="include" data-key="${esc(r.entry.key)}" ${draft?.included ? 'checked' : ''} ${entryLocked(t, r.entry) ? 'disabled' : ''} aria-label="${esc(r.name)} ${COPY.uiApp034}">
            ${r.depth ? '<span class="case-indent" aria-hidden="true">└</span>' : ''}
            ${r.entry.screenId && r.code ? `<span class="id-tag">${esc(r.code)}</span>` : ''}
            <span class="name">${esc(r.name)}</span>
            ${guiStateBadge(state!, r.entry, draft)}
          </div>`;
        }).join('')}
      </div>`).join('');
    if (revealSelection) { revealSelection = false; box.querySelector<HTMLElement>('.row.selected')?.scrollIntoView({ block: 'nearest' }); }
    const master = root.querySelector<HTMLInputElement>('[data-action="include-all"]');
    if (master) master.indeterminate = checked > 0 && checked < all.length;
    const groupInputs = new Map([...box.querySelectorAll<HTMLInputElement>('[data-action="include-group"]')].map(node => [node.dataset.group, node]));
    for (const group of model.groups) {
      const input = groupInputs.get(group.key);
      const count = group.visibleRows.filter(r => draftOf(t, r.entry).included).length;
      if (input) input.indeterminate = count > 0 && count < group.visibleRows.length;
    }
  }

  // UI Flipbook 목록: 만든 플립북을 페이지 → Section → 캔버스 순서로 보여 준다(2026-10-21 사용자 요청: 캔버스 순서).
  // 배포 체크·상태 아이콘 없이, GUI가 다시 배포되어 확인이 필요한 플립북에 빨간 점을 붙이고 맨 위에 그 개수를 보여 준다(2026-10-20 사용자 결정).
  // 만들기 전 새 플립북도 정한 자리에 함께 보여 주며, 검색·필터와 관계없이 항상 보인다.
  function paintFlipbookList(model: ListModel) {
    const list = $('.list');
    if (list.dataset.team !== 'UI' || !list.querySelector('.list-body')) {
      list.dataset.team = 'UI';
      list.innerHTML = `<div class="list-filters"><div class="review-line"><p class="review-count" aria-live="polite"></p><button class="icon-button" data-action="toggle-detail">${PANELS_ICON}</button></div><div class="list-actions"><button class="add-button" data-action="new-add" title="고른 플립북 다음에 새 플립북을 넣습니다. 만들기를 누르기 전에는 저장하지 않습니다.">${ADD_LABEL.replace(COPY.uiApp101, '새 플립북')}</button><button data-action="bulk-open">플립북 없는 화면 일괄 만들기</button></div><input type="search" placeholder="${COPY.uiApp020}" value="${esc(query.UI)}" data-input="query" aria-label="${COPY.uiApp021}"><div class="filter-line"><label class="switch"><span>${COPY.uiApp301}</span><input type="checkbox" role="switch" data-action="changed-only" ${changedOnly.UI ? 'checked' : ''}></label></div></div><div class="list-body"><div class="list-box"></div><div class="unlinked-all"></div></div>`;
    }
    const canCreate = flipbookPageOptions().length > 0;
    for (const button of list.querySelectorAll<HTMLButtonElement>('.list-actions button')) {
      button.disabled = !canCreate;
      button.title = canCreate ? button.title : COPY.uiApp209;
    }
    const reviews = [...state!.flipbooks.keys()].filter(id => needsReview(state!, id)).length;
    list.querySelector<HTMLElement>('.review-count')!.innerHTML = `<span class="review-dot${reviews ? '' : ' none'}" aria-hidden="true"></span><span>${COPY.uiApp192} <b>${reviews}</b>${COPY.uiApp015}</span>`;
    list.querySelector<HTMLInputElement>('[data-action="changed-only"]')!.checked = changedOnly.UI;
    const toggle = list.querySelector<HTMLButtonElement>('[data-action="toggle-detail"]')!;
    const toggleLabel = detailCollapsed ? '오른쪽 영역 펼치기' : '오른쪽 영역 접기';
    toggle.title = toggleLabel;
    toggle.setAttribute('aria-label', toggleLabel);
    toggle.setAttribute('aria-pressed', String(detailCollapsed));
    const box = list.querySelector<HTMLElement>('.list-box')!;
    const made = [...state!.flipbooks.values()].some(fb => fb.status === 'active');
    // 목록 하단: 연결 끊긴 플립북 전체 삭제(두 번 눌러 삭제). 검색·필터와 관계없이 연결이 끊긴 플립북 전체가 대상이다.
    const unlinkedCount = uiEntries().filter(e => e.estimate === 'missing').length;
    if (!unlinkedCount) removeAllArmed = false;
    list.querySelector<HTMLElement>('.unlinked-all')!.innerHTML = unlinkedCount
      ? `<p class="note">${unlinkedBadge()}<span>${COPY.uiApp240} <b>${unlinkedCount}</b>${COPY.uiApp241}</span></p><button class="danger" data-action="remove-all-unlinked">${COPY.uiApp242}</button>${removeAllArmed ? `<p class="bad" role="status">${COPY.uiApp211}</p>` : ''}`
      : '';
    const scrollTop = box.scrollTop;
    const shown = new Map(model.groups.map(g => [g.key, g]));
    const moving = new Set(movedFlipbooks.map(m => m.key));
    const rows = new Map(model.groups.flatMap(g => g.rows).map(r => [r.entry.key, r]));
    const groups = arrangement().filter(g => shown.has(g.key) || g.items.some(item => isNewKey(item) || moving.has(item)));
    if (!groups.length) {
      box.innerHTML = `<p class="empty">${!made ? COPY.uiApp218 : query.UI ? COPY.uiApp028 : changedOnly.UI ? COPY.uiApp222 : COPY.uiApp029}</p>`;
      return;
    }
    const byKey = new Map(newFlipbooks.map(n => [n.key, n]));
    // 목록에서 제목을 고치는 중이면 다시 그려도 입력 중인 값과 커서를 유지한다.
    const typing = box.querySelector<HTMLInputElement>('.title-input');
    const typed = typing ? { id: typing.dataset.key ?? typing.dataset.id, value: typing.value, focused: document.activeElement === typing, start: typing.selectionStart, end: typing.selectionEnd } : null;
    // 페이지마다 아코디언 하나로 접고, 그 안의 Section은 작은 라벨 행으로만 나눈다(2026-10-23 사용자 요청).
    const byPage: { pageId: string; sections: ArrangedGroup[] }[] = [];
    for (const g of groups) {
      const last = byPage[byPage.length - 1];
      if (last && last.pageId === (g.pageId ?? '')) last.sections.push(g); else byPage.push({ pageId: g.pageId ?? '', sections: [g] });
    }
    box.innerHTML = byPage.map(({ pageId, sections }) => {
      const all = sections.flatMap(g => g.items);
      const drafts = all.filter(isNewKey).length;
      const open = !!query.UI || pageOpen(pageId);
      // 접힌 페이지에 확인이 필요한 플립북이 있으면 머리 맨 오른쪽에 빨간 점을 둔다(2026-10-22 사용자 요청). 펼치면 행마다 보인다.
      const flagged = !open && all.some(item => !isNewKey(item) && needsReview(state!, item));
      const name = pages.find(p => p.id === pageId)?.name ?? sections[0].name;
      return `<div class="group">
        <div class="group-bar"><button class="group-head flipbook-head" data-action="page-group" data-page="${esc(pageId)}" aria-expanded="${open}">
          <span class="caret">${open ? '▾' : '▸'}</span><span class="group-name">${esc(name)}</span>
          <span class="count">${all.length - drafts}${drafts ? ` <b class="new-count" title="${COPY.uiApp333}">+${drafts}</b>` : ''}</span>
          ${flagged ? `<span class="review-dot group-review" role="img" title="${COPY.uiApp192}" aria-label="${COPY.uiApp192}"></span>` : ''}
        </button></div>
        ${open ? sections.map(g => sectionRows(g)).join('') : ''}
      </div>`;
    }).join('');
    // Section 라벨 행과 그 Section의 플립북 행. 라벨에 놓으면 그 Section 맨 앞으로 옮긴다.
    function sectionRows(g: ArrangedGroup): string {
      // Section 밖 플립북은 라벨 행 없이 페이지 맨 위에 모은다. 끌어서 Section으로 옮길 수는 있다.
      const outside = g.section.key === NO_SECTION_KEY;
      const movablePage = onFlipbookPage(g);
      const items = g.items.filter(item => rows.has(item) || byKey.has(item));
      return `<div class="section-group">
        ${outside ? '' : `<div class="section-label" data-group="${esc(g.key)}" title="${esc(g.section.name)}">${esc(g.section.name)}</div>`}
        ${items.map(item => {
          const n = byKey.get(item);
          if (n) {
            const sel = selectedNew === n.key;
            const title = newTitle(n);
            const editing = editingAt(n.key, 'list');
            const name = editing
              ? `<input class="title-input" data-input="new-title" data-key="${esc(n.key)}" value="${esc(n.title)}" placeholder="${esc(defaultTitle(newKind(n), newScreens(n)))}" aria-label="${COPY.uiApp203}">`
              : `<span class="name" data-edit-title="${esc(n.key)}" title="${COPY.uiApp314}">${esc(title)}</span>`;
            return `<div class="row new-row${sel ? ' selected' : ''}" data-action="new-select" data-key="${esc(n.key)}" data-group="${esc(g.key)}" draggable="${!editing}" tabindex="0" aria-selected="${sel}" title="${COPY.uiApp334}">
              <span class="drag-handle" aria-hidden="true">⠿</span>
              ${name}
              <button class="icon-button" data-action="new-edit-title" data-key="${esc(n.key)}" title="${COPY.uiApp335}" aria-label="${esc(title)} ${COPY.uiApp335}" aria-pressed="${editing}">${PENCIL_ICON}</button>
              <button class="icon-button" data-action="new-remove" data-key="${esc(n.key)}" title="${COPY.uiApp105}" aria-label="${esc(title)} ${COPY.uiApp105}">${X_ICON}</button>
            </div>`;
          }
          const r = rows.get(item)!;
          const sel = selection.UI.has(r.entry.key);
          const flagged = !!r.entry.flipbookId && needsReview(state!, r.entry.flipbookId);
          // 연결이 끊긴 플립북은 프레임이 없어 반영할 수 없으므로 제목을 고치지 않는다(오른쪽 영역의 연필과 같다).
          const fb = r.entry.flipbookId && r.entry.estimate !== 'missing' ? state!.flipbooks.get(r.entry.flipbookId) : undefined;
          const name = fb && editingAt(fb.id, 'list')
            ? `<input class="title-input" data-input="fb-title" data-id="${esc(fb.id)}" value="${esc(fb.title)}" placeholder="${esc(defaultTitle(fb.kind, fb.screens))}" aria-label="${COPY.uiApp203}">`
            : `<span class="name"${fb ? ` data-edit-title="${esc(fb.id)}" title="${COPY.uiApp314}"` : ''}>${esc(r.name)}</span>`;
          // 기존 플립북도 드래그하거나 Alt+↑↓로 자리를 옮긴다(2026-10-22 사용자 요청). 연결이 끊긴 플립북은 캔버스에 프레임이 없어 옮기지 않는다.
          const movable = !!fb && movablePage && !editingAt(fb.id, 'list') && !newSubmitting;
          return `<div class="row${sel ? ' selected' : ''}" data-action="select" data-key="${esc(r.entry.key)}" data-group="${esc(g.key)}" draggable="${movable}" tabindex="0" aria-selected="${sel}">
            ${name}
            ${r.entry.estimate === 'missing' ? unlinkedBadge() : ''}
            ${flagged ? `<span class="review-dot" role="img" title="${COPY.uiApp193}" aria-label="${COPY.uiApp193}"></span>` : ''}
          </div>`;
        }).join('')}
      </div>`;
    }
    box.scrollTop = scrollTop;
    if (revealSelection) { revealSelection = false; box.querySelector<HTMLElement>('.row.selected')?.scrollIntoView({ block: 'nearest' }); }
    const input = box.querySelector<HTMLInputElement>('.title-input');
    if (input && typed && typed.id === (input.dataset.key ?? input.dataset.id)) {
      input.value = typed.value;
      if (typed.focused) { input.focus(); input.setSelectionRange(typed.start, typed.end); }
    } else if (input && focusListTitle) {
      input.focus(); input.select();
      input.closest('.row')?.scrollIntoView({ block: 'nearest' });
    }
    if (input) focusListTitle = false;
  }

  // 새 플립북: 고른 항목의 화면 선택·페이지·Section, 만들기 전 미리보기를 정한다(2026-10-21 사용자 요청).
  function paintNewFooter() {
    const footer = $('.footer');
    const actions = root.querySelector<HTMLElement>('.detail .new-actions');
    if (actions) actions.innerHTML = newActions();
    const error = root.querySelector<HTMLElement>('.detail .new-error');
    if (error) error.innerHTML = createError ? `<p class="bad" role="alert">${esc(createError)}</p>` : '';
    footer.innerHTML = '';
    renderToolbar();
  }

  // 기존 플립북을 보고 있거나 순서만 바꿔 「플립북 편집」이 없으면 목록 위 줄 오른쪽에 개수와 버튼을 둔다
  // (2026-10-23 사용자 요청: 하단 오른쪽 버튼을 「플립북 편집」처럼 위 오른쪽으로).
  function pendingLine(): string {
    if ((!newFlipbooks.length && !movedFlipbooks.length) || editingNewShown()) return '';
    const counts = [newFlipbooks.length ? `${COPY.uiApp333} <b>${newFlipbooks.length}</b>${COPY.uiApp015}` : '', movedFlipbooks.length ? `${COPY.uiApp315} <b>${movedFlipbooks.length}</b>${COPY.uiApp015}` : ''].filter(Boolean).join(' · ');
    return `<div class="pending-line"><span class="pending-counts">${counts}</span>${createError ? `<span class="bad" role="alert">${esc(createError)}</span>` : ''}<span class="new-actions">${newActions()}</span></div>`;
  }

  function paintFooter(sharedModel?: ListModel) {
    if (tab !== 'ADMIN' && state && team() === 'UI') { paintNewFooter(); return; }
    if (tab === 'ADMIN' || !state) { $('.footer').innerHTML = ''; return; }
    const model = sharedModel ?? listModel(team());
    const unchecked = locked(team());
    const blocked = model.included === 0 || model.invalid > 0 || unchecked;
    const commentArea = team() === 'GUI' ? `<div class="batch-comment">
        <label>${COPY.uiApp064}<textarea data-input="comment" rows="2" ${unchecked ? 'disabled' : ''}>${esc(comment.description)}</textarea></label></div>` : '';
    // 추가 설명을 입력하는 동안에는 하단을 다시 그리지 않는다(포커스 유지).
    const focused = document.activeElement as HTMLElement | null;
    if (focused?.closest('.batch-comment') && $('.footer').querySelector('.batch-comment')) {
      $('.footer .footer-line').innerHTML = footerLine(model, unchecked, blocked);
      return;
    }
    $('.footer').innerHTML = commentArea + `<div class="footer-line">${footerLine(model, unchecked, blocked)}</div>`;
  }

  function footerLine(model: ListModel, unchecked: boolean, blocked: boolean): string {
    return `
      ${unchecked ? `<span class="note">${COPY.uiApp035}</span>` : `<span>${COPY.uiApp036} <b>${model.included}</b> ${COPY.uiApp037} <b class="${model.invalid ? 'bad' : ''}">${model.invalid}</b></span>
      ${model.invalid ? `<button data-action="first-invalid">${COPY.uiApp038}</button>` : ''}`}
      <button class="primary" data-action="prepare" ${blocked ? 'disabled' : ''}>${COPY.uiApp039}</button>`;
  }

  function workerOptions(selectedId?: string, mixed = false) {
    const workers = [...state!.workers.values()].filter(w => w.active || w.id === selectedId).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return (mixed ? mixedOption() : '') + option('', COPY.uiApp041, !selectedId && !mixed) + workers.map(w => option(w.id, workerLabel(w), w.id === selectedId)).join('');
  }

  // GUI Publish에서 새 화면으로 등록하는 항목. 이름·화면 관계를 입력한다.
  function registersNew(t: Team, entry: Entry): boolean {
    const draft = draftOf(t, entry);
    return t === 'GUI' && needsLink(entry) && draft.link !== 'replace' && !draft.notScreen;
  }

  // 화면 선택 드롭다운: 회색 ID 태그 + 이름, ID 순(2026-10-20 사용자 결정)
  // 「화면 없음」(값 '')은 맨 위에 두고, 케이스 기본 화면은 선택한 카테고리를 먼저 보여 준다.
  function screenLabel(item: { code: string; name: string }): string {
    return `<span class="screen-option">${item.code ? `<span class="id-tag">${esc(item.code)}</span>` : ''}<span class="label">${esc(item.name)}</span></span>`;
  }
  function screenPicker(field: string, items: ScreenItem[], selectedValue: string | undefined, placeholder: string, opts: { disabled?: boolean; mixed?: boolean; thumbs?: Map<string, string | null>; preferredCategoryId?: string } = {}): string {
    const sorted = sortScreenItems(items, opts.preferredCategoryId);
    const chosen = opts.mixed ? null : sorted.find(i => i.value === selectedValue);
    const head = chosen ? screenLabel(chosen) : `<span class="placeholder">${esc(opts.mixed ? COPY.uiApp175 : placeholder)}</span>`;
    return `<details class="tag-picker screen-picker${opts.disabled ? ' disabled' : ''}"><summary aria-label="${esc(placeholder)}" data-required-field="${esc(field)}">${head}<span class="dropdown-caret" aria-hidden="true"></span></summary>
      <div class="tag-options">${sorted.map(i => `<button data-action="pick" data-field="${field}" data-value="${esc(i.value)}" class="tag-option" aria-pressed="${i.value === selectedValue}"${opts.thumbs?.get(i.value) ? ` data-thumb="${esc(opts.thumbs.get(i.value)!)}"` : ''}>${screenLabel(i)}</button>`).join('') || `<p class="note">${COPY.uiApp190}</p>`}</div></details>`;
  }
  // 등록된 화면은 왼쪽 목록과 같은 이름·Screen ID로 보여 준다(배포 전 수정값 포함, 2026-10-21 사용자 요청).
  const registeredItems = (filter: (id: string) => boolean = () => true): ScreenItem[] => {
    const byScreen = new Map(entries.filter(e => e.screenId).map(e => [e.screenId!, e]));
    return [...state!.screens.values()].filter(x => x.status === 'active' && filter(x.id)).map(x => {
      const entry = byScreen.get(x.id);
      const shown = entry ? guiDisplay(entry) : { code: x.code, name: x.name };
      return { value: x.id, code: shown.code, name: shown.name, categoryId: x.categoryId };
    });
  };
  // 신규 후보 프레임. 이름은 왼쪽 목록과 같고, ID는 프레임 이름의 대괄호 안을 보여 준다.
  const candidateItems = (): ScreenItem[] => entries.filter(e => !e.screenId && e.frame).map(e => {
    const parsed = parseFrameName(e.frame!.name);
    return { value: e.key, code: parsed.code ?? '', name: guiDisplay(e).name };
  });

  // 교체 짝 반대쪽 화면의 이름
  function partnerName(key: string | undefined): string {
    const other = key ? entries.find(e => e.key === key) : null;
    return other && state ? entryName(state, other) : '';
  }

  function renderDetail() {
    $('.detail').classList.toggle('locked', tab !== 'ADMIN' && detailLocked(team()));
    $('.detail').classList.remove('flipbook-detail', 'new-flipbook-detail');
    if (tab === 'ADMIN') { renderAdmin(); return; }
    if (team() === 'UI') { if (currentNew()) renderNewDetail(); else renderFlipbookDetail(); return; }
    const t = team();
    // 변경사항 확인 전에는 안내 문구만 가운데에 보여 주고 다른 정보는 숨긴다.
    if (state && locked(t)) { $('.detail').innerHTML = `<div class="detail-hint"><p>${COPY.uiApp023}</p></div>`; return; }
    const chosen = selectedEntries(t);
    const entry = current();
    if (!state || !entry || !chosen.length) { $('.detail').innerHTML = `<p class="empty">${COPY.uiApp042}</p>`; return; }
    const multi = chosen.length > 1;
    const draft = draftOf(t, entry);
    const name = entryName(state, entry);
    const isNew = registersNew(t, entry);
    const descLabel = isNew ? COPY.uiApp043 : COPY.uiApp045;
    const common = (value: (d: Draft) => string | undefined): string => {
      const values = chosen.map(e => value(draftOf(t, e)) ?? '');
      return values.every(v => v === values[0]) ? values[0] : '';
    };
    // 선택한 화면마다 값이 다르면 입력란에 「—」를 표시한다. 입력하면 선택한 화면 전체에 적용한다.
    const mixed = (value: (d: Draft) => string | undefined): boolean => {
      const values = chosen.map(e => value(draftOf(t, e)) ?? '');
      return values.some(v => v !== values[0]);
    };
    const allIncluded = chosen.every(e => draftOf(t, e).included);
    let html = `<div class="detail-head"><h2>${esc(name)}${multi ? ` ${COPY.uiApp046} ${chosen.length - 1}${COPY.uiApp015}` : ''}</h2><div class="validation" aria-live="polite"></div></div>`;
    if (detailLocked(t)) html += `<p class="note">${locked(t) ? COPY.uiApp176 : COPY.uiApp181}</p>`;
    if (!multi) html += entry.notes.map(n => `<p class="note">${esc(n)}</p>`).join('');
    // 변경 감지: 배포 토글 위에 「변경 무시」. 프레임 이름·카테고리가 바뀐 화면은 무시할 수 없다.
    // 배포를 켜 수정됨·이전 버전으로 정해진 화면은 변경 상태가 해결되었으므로 누를 수 없다.
    if (t === 'GUI' && chosen.every(e => changeDetected(e))) {
      const blocked = chosen.map(e => [e, ignoreBlock(state!, e)] as const).filter(([, why]) => why);
      const resolved = chosen.some(e => draftOf(t, e).included);
      html += `<div class="ignore-row"><button data-action="ignore-changes" title="${esc(COPY.uiApp183)}" ${blocked.length || resolved ? 'disabled' : ''}>${COPY.uiApp182}</button>${blocked.map(([e, why]) => `<p class="note">${multi ? `${esc(entryName(state!, e))}: ` : ''}${esc(why!)}</p>`).join('')}</div>`;
    }
    html += `<section class="detail-section"><h3><label class="check include"><input type="checkbox" data-action="include-selected" ${allIncluded ? 'checked' : ''}> ${COPY.uiApp034}</label></h3>`;
    // GUI는 배포를 켠 뒤에만 등록 방식과 입력 영역을 보여 준다(2026-10-20 사용자 결정).
    const showInputs = allIncluded;
    if (t === 'GUI' && allIncluded) {
      const excludeReason = `<label>${COPY.uiApp053}<input data-field="excludeReason" value="${esc(common(d => d.excludeReason))}" placeholder="${mixed(d => d.excludeReason) ? esc(COPY.uiApp175) : ''}"></label>`;
      if (chosen.every(e => needsLink(e))) {
        const allNew = chosen.every(e => { const d = draftOf(t, e); return d.link === 'new' && !d.notScreen; });
        const allReplace = chosen.every(e => { const d = draftOf(t, e); return d.link === 'replace' && !d.notScreen; });
        const allNotScreen = chosen.every(e => draftOf(t, e).notScreen);
        html += `<fieldset><legend>${COPY.uiApp047}${mixedMark(multi && !allNew && !allReplace && !allNotScreen)}</legend>
          <label class="check"><input type="radio" name="disposition" value="new" data-field="disposition" ${allNew ? 'checked' : ''}> ${COPY.uiApp048}</label>
          ${multi ? '' : `<label class="check"><input type="radio" name="disposition" value="replace" data-field="disposition" ${allReplace ? 'checked' : ''}> ${COPY.uiApp049}</label>`}
          <label class="check"><input type="radio" name="disposition" value="not-screen" data-field="disposition" ${allNotScreen ? 'checked' : ''}> ${COPY.uiApp050}</label>
          ${!multi && allReplace ? screenPicker('replaceScreenId', registeredItems(), draft.replaceScreenId, COPY.uiApp052) : ''}
          ${allNotScreen ? excludeReason : ''}</fieldset>`;
      } else if (chosen.every(e => e.estimate === 'missing')) {
        const allDelete = chosen.every(e => draftOf(t, e).retire !== 'replace');
        const allReplace = chosen.every(e => draftOf(t, e).retire === 'replace');
        html += `<fieldset><legend>${COPY.uiApp047}${mixedMark(multi && !allDelete && !allReplace)}</legend>
          <label class="check"><input type="radio" name="retire" value="delete" data-field="retire" ${allDelete ? 'checked' : ''}> ${COPY.uiApp185}</label>
          ${multi ? '' : `<label class="check"><input type="radio" name="retire" value="replace" data-field="retire" ${allReplace ? 'checked' : ''}> ${COPY.uiApp186}</label>`}
          ${!multi && allReplace ? screenPicker('replaceWith', candidateItems(), draft.replacedBy, COPY.uiApp187) : ''}</fieldset>`;
      } else if (chosen.every(e => !!e.screenId && !!e.frame && !isPrevious(e, draftOf(t, e)))) {
        // 이미 배포한 화면도 화면이 아님으로 고를 수 있다. 프레임은 제외 목록에 넣고 화면은 사용 안 함으로 바꾼다.
        const allNotScreen = chosen.every(e => draftOf(t, e).notScreen);
        const allModify = chosen.every(e => !draftOf(t, e).notScreen);
        html += `<fieldset><legend>${COPY.uiApp047}${mixedMark(multi && !allModify && !allNotScreen)}</legend>
          <label class="check"><input type="radio" name="disposition" value="modify" data-field="disposition" ${allModify ? 'checked' : ''}> ${COPY.uiApp243}</label>
          <label class="check"><input type="radio" name="disposition" value="not-screen" data-field="disposition" ${allNotScreen ? 'checked' : ''}> ${COPY.uiApp050}</label>
          ${allNotScreen ? excludeReason : ''}</fieldset>`;
      }
      if (!multi && isPrevious(entry, draft)) html += `<p class="note">${COPY.uiApp188} ${esc(partnerName(draft.replacedBy))}. ${COPY.uiApp189}</p>`;
    }
    html += '</section>';
    // 화면이 아님·교체 짝의 이전 화면은 정보를 입력하지 않는다.
    const inputs = showInputs && chosen.every(e => {
      const d = draftOf(t, e);
      return !d.notScreen && !isPrevious(e, d) && !(t === 'GUI' && e.estimate === 'missing' && d.retire === 'replace');
    });
    if (inputs) {
      const deleting = t === 'GUI' && chosen.every(e => isDeletion(e, draftOf(t, e)));
      void deleting;
      html += `<section class="detail-section"><h3>${COPY.uiApp055}</h3><div class="section-body">`;
      if (t === 'GUI' && chosen.every(e => !isDeletion(e, draftOf(t, e)))) {
        const names = chosen.map(e => draftName(state!, e, draftOf(t, e)));
        const nameMixed = multi && names.some(value => value !== names[0]);
        html += `<label class="wide">${COPY.uiApp056}<input data-field="name" data-required-field="name" value="${esc(nameMixed ? '' : names[0])}" placeholder="${nameMixed ? '-' : ''}"></label>`;
      }
      if (t === 'GUI' && !multi && !deleting) {
        const code = draftCode(state, entry, draft);
        html += `<label class="wide">Screen ID<input data-field="code" data-required-field="code" value="${esc(code)}" required></label>`;
      }
      if (t === 'GUI' && !deleting && chosen.every(e => {
        const d = draftOf(t, e);
        return e.estimate !== 'missing' && !d.notScreen;
      })) html += categoryField(entry, draft, multi, common(d => d.categoryId), mixed(d => d.categoryId));
      if (t === 'GUI' && chosen.every(e => registersNew(t, e) || (!!e.screenId && e.estimate !== 'missing'))) {
        const relation = common(d => d.relation);
        const allCase = relation === 'case';
        const baseMixed = allCase && mixed(d => d.baseScreenId);
        html += `<fieldset class="wide"><legend>${COPY.uiApp057}${mixedMark(mixed(d => d.relation))}</legend>
        <label class="check"><input type="radio" name="relation" value="standalone" data-field="relation" ${relation === 'standalone' ? 'checked' : ''}> ${COPY.uiApp058}</label>
        <label class="check"><input type="radio" name="relation" value="case" data-field="relation" ${allCase ? 'checked' : ''}> ${COPY.uiApp059}</label>
        ${screenPicker('baseScreenId', registeredItems(id => !state!.screens.get(id)?.baseScreenId), allCase ? common(d => d.baseScreenId) || undefined : undefined, COPY.uiApp061, { disabled: !allCase, mixed: baseMixed, preferredCategoryId: common(d => d.categoryId) })}</fieldset>`;
      }
      html += tagField(t, draft, multi, common(d => d.tagId), mixed(d => d.tagId));
      html += workerField(draft, common(d => d.workerId), mixed(d => d.workerId));
      html += '</div></section>';
    }
    if (!multi) html += previousThumb(entry) + '<div class="history"></div>';
    $('.detail').innerHTML = html;
    if (detailLocked(t)) {
      for (const control of root.querySelectorAll<HTMLInputElement>('.detail input, .detail select, .detail textarea, .detail button')) control.disabled = true;
      for (const summary of root.querySelectorAll<HTMLElement>('.detail summary')) { summary.tabIndex = -1; summary.setAttribute('aria-disabled', 'true'); }
    }
    const include = root.querySelector<HTMLInputElement>('.detail [data-action="include-selected"]');
    if (include) include.indeterminate = chosen.some(e => draftOf(t, e).included) && !allIncluded;
    renderValidation();
    renderHistory();
  }

  // ── 썸네일 ──
  function thumbOf(uid: string): string | null {
    const rows = state?.gui.get(uid) ?? [];
    return rows[rows.length - 1]?.thumb?.hash ?? null;
  }
  // `node:` 키는 썸네일이 아니라 캔버스 프레임을 바로 내보낸 미리보기다(새 버전 페이지 비교).
  function requestThumbs(hashes: (string | null)[]) {
    const missing = [...new Set(hashes.filter((h): h is string => !!h && !thumbUrls.has(h)))];
    if (!missing.length) return;
    for (const h of missing) thumbUrls.set(h, '');
    const nodeIds = missing.filter(h => h.startsWith(NODE_PREVIEW)).map(h => h.slice(NODE_PREVIEW.length));
    const images = missing.filter(h => !h.startsWith(NODE_PREVIEW));
    if (images.length) bridge.send({ type: 'thumbnails', hashes: images });
    if (nodeIds.length) bridge.send({ type: 'framePreviews', nodeIds });
  }
  function clearNodePreviews() {
    for (const [key, url] of [...thumbUrls]) {
      if (!key.startsWith(NODE_PREVIEW)) continue;
      if (url) URL.revokeObjectURL(url);
      thumbUrls.delete(key);
      failedPreviews.delete(key);
    }
  }
  function thumbImg(hash: string | null, alt: string): string {
    const url = hash ? thumbUrls.get(hash) : null;
    return url ? `<img src="${url}" alt="${esc(alt)}">` : `<span class="thumb-empty">${hash && !failedPreviews.has(hash) ? COPY.uiApp001 : COPY.uiApp195}</span>`;
  }
  // changed: 확인이 필요한(다시 배포된) 화면. 캡션에 빨간 점을 붙인다.
  function flipbookThumbs(flipbookId: string, changed = new Set<string>()): string {
    const fb = state?.flipbooks.get(flipbookId);
    if (!fb?.screens.length) return '';
    const hashes = fb.screens.map(s => thumbOf(s.uid));
    requestThumbs(hashes);
    return `<div class="thumbs">${fb.screens.map((s, i) => `<figure>${thumbImg(hashes[i], s.name)}<figcaption>${changed.has(s.uid) ? `<span class="review-dot" role="img" title="${COPY.uiApp193}" aria-label="${COPY.uiApp193}"></span>` : ''}<span class="id-tag">${esc(s.code)}</span> ${esc(s.name)}</figcaption></figure>`).join('')}</div>`;
  }

  // 크기를 맞출 플립북: 연결된 플립북 중 반영한 1x 크기가 설정과 다르거나 기록이 없는 것
  function resizeTargets(chosen: Entry[]): string[] {
    return chosen.filter(e => !!e.flipbookId && e.estimate !== 'missing' && state!.flipbooks.get(e.flipbookId)?.guiWidth !== state!.project.guiWidth).map(e => e.flipbookId!);
  }

  // UI Flipbook 상세: 오른쪽 영역을 위아래로 나눈다(2026-10-20 사용자 결정).
  // 위: 들어 있는 화면의 GUI 썸네일과 플립북 이력. 아래(항상 표시): 수정된 화면, 상태(필수, 기본 「최신」)·코멘트(선택), 확인 완료.
  function renderFlipbookDetail() {
    const detail = $('.detail');
    const chosen = selectedEntries('UI').filter(e => !!e.flipbookId);
    const entry = current();
    detail.classList.toggle('flipbook-detail', !!state && !!entry?.flipbookId && !!chosen.length);
    if (!state || !entry?.flipbookId || !chosen.length) { detail.innerHTML = `<p class="empty">${COPY.uiApp217}</p>`; return; }
    const multi = chosen.length > 1;
    const drafts = chosen.map(e => draftOf('UI', e));
    const common = (value: (d: Draft) => string | undefined) => { const values = drafts.map(d => value(d) ?? ''); return values.every(v => v === values[0]) ? values[0] : ''; };
    const mixed = (value: (d: Draft) => string | undefined) => drafts.some(d => (value(d) ?? '') !== (value(drafts[0]) ?? ''));
    const flagged = chosen.filter(e => needsReview(state!, e.flipbookId!));
    const changed = new Map<string, ImportedGuiRecord>();
    if (!multi) for (const r of unreviewed(state, entry.flipbookId)) if ((changed.get(r.uid)?.version ?? -1) < r.version) changed.set(r.uid, r);
    // 제목 변경(2026-10-21 사용자 요청): 연필을 눌러 고치고 Enter·포커스 이동으로 바꾼다. 비우면 첫 화면 이름으로 돌아간다.
    // 연결이 끊긴 플립북은 프레임이 없어 반영할 수 없으므로 바꾸지 않는다.
    const fb = state.flipbooks.get(entry.flipbookId);
    const renamable = !multi && !!fb && entry.estimate !== 'missing';
    const heading = renamable && editingAt(fb.id, 'detail')
      ? `<input class="title-input" data-input="fb-title" data-id="${esc(fb.id)}" value="${esc(fb.title)}" placeholder="${esc(defaultTitle(fb.kind, fb.screens))}" aria-label="${COPY.uiApp203}">`
      : `<h2${renamable ? ` data-edit-title="${esc(fb.id)}" title="${COPY.uiApp314}"` : ''}>${esc(entryName(state, entry))}${multi ? ` ${COPY.uiApp046} ${chosen.length - 1}${COPY.uiApp015}` : ''}</h2>`;
    let top = `<div class="detail-head title-head">${heading}${renamable ? `<button class="icon-button" data-action="fb-edit-title" data-id="${esc(entry.flipbookId)}" title="${COPY.uiApp335}" aria-label="${COPY.uiApp336}" aria-pressed="${editingAt(fb.id, 'detail')}">${PENCIL_ICON}</button>` : ''}</div>`;
    // 연결이 끊긴 플립북은 목록에서 삭제할 수 있다. 한 번 누르면 삭제한다(2026-10-20 사용자 결정).
    const unlinked = chosen.filter(e => e.estimate === 'missing');
    if (unlinked.length) {
      top += `<div class="unlinked">${unlinkedBadge()}<p class="note">${multi ? `${COPY.uiApp238} <b>${unlinked.length}</b>${COPY.uiApp015}` : COPY.uiApp236}</p><button class="danger" data-action="remove-flipbooks">${COPY.uiApp237}</button></div>`;
    }
    // 1x 화면 크기: 설정 크기와 다른(기록이 없는) 플립북을 골라 맞춘다(2026-10-21 사용자 요청). 연결이 끊긴 플립북은 뺀다.
    const resizable = resizeTargets(chosen);
    if (chosen.length > unlinked.length) {
      const width = state.project.guiWidth;
      const own = state.flipbooks.get(entry.flipbookId)?.guiWidth;
      const label = multi
        ? `${COPY.uiApp270} <b>${resizable.length}</b>${COPY.uiApp015}`
        : `${COPY.uiApp266} <b>${own ? `${own}px` : COPY.uiApp267}</b> · ${COPY.uiApp268} ${width}px`;
      top += `<div class="gui-size"><p class="note">${label}</p><button data-action="resize-flipbooks" title="${esc(COPY.uiApp271)}" ${resizable.length ? '' : 'disabled'}>${width}px${COPY.uiApp269}</button></div>`;
    }
    if (!multi) {
      const fb = state.flipbooks.get(entry.flipbookId);
      top += fb?.screens.length ? flipbookThumbs(entry.flipbookId, new Set(changed.keys())) : `<p class="note">${COPY.uiApp221}</p>`;
      top += '<div class="history"></div>';
    }
    let bottom = '';
    if (multi) {
      bottom += `<p class="review-title"><span class="review-dot${flagged.length ? '' : ' none'}" aria-hidden="true"></span><span>${COPY.uiApp220} <b>${flagged.length}</b>${COPY.uiApp015}</span></p>`;
    } else if (changed.size) {
      const offset = state.project.utcOffsetMinutes;
      bottom += `<p class="review-title"><span class="review-dot" aria-hidden="true"></span><b>${COPY.uiApp193}</b></p>
        <p class="note">${COPY.uiApp215}</p>
        <ul class="review-screens" aria-label="${COPY.uiApp216}">${[...changed.values()].map(r => `<li><span class="id-tag">${esc(r.code)}</span><span class="name">${esc(r.name)}</span><small>${esc(formatTime(r.committedAt, offset))}</small></li>`).join('')}</ul>`;
    }
    const tagMissing = drafts.some(d => !d.tagId || !state!.tags.get(d.tagId)?.active);
    const commentMixed = multi && mixed(d => d.description);
    bottom += `<div class="review-form">${tagField('UI', drafts[0], multi, common(d => d.tagId), mixed(d => d.tagId), COPY.uiApp223)}
      <label class="wide">${COPY.uiApp224}<textarea data-field="description" rows="2" placeholder="${commentMixed ? esc(COPY.uiApp175) : ''}">${esc(common(d => d.description))}</textarea></label></div>
      <div class="review-actions"><button class="primary" data-action="mark-reviewed" ${tagMissing ? 'disabled' : ''}>${COPY.uiApp214}</button></div>`;
    detail.innerHTML = `<div class="fb-top">${top}</div><section class="fb-bottom${flagged.length ? ' flagged' : ''}" aria-label="${COPY.uiApp214}">${bottom}</section>`;
    if (tagMissing) detail.querySelector('.fb-bottom summary[data-required-field="tagId"]')?.classList.add('input-error');
    renderHistory();
  }

  function renderValidation() {
    const box = root.querySelector('.detail .validation');
    const entry = current();
    if (!box || !entry || !state) return;
    const chosen = selectedEntries();
    if (chosen.length > 1) {
      const checks = chosen.map(e => validation(team(), e));
      const invalid = checks.some(v => v.status === 'invalid');
      const included = chosen.filter(e => draftOf(team(), e).included).length;
      const status = invalid ? STATUS_LABEL.invalid : included ? STATUS_LABEL.ready : STATUS_LABEL.excluded;
      const details = [...new Set(checks.flatMap(v => [...v.missing, ...v.errors]))];
      box.innerHTML = `<b class="${invalid ? 'bad' : ''}">${esc(status)}</b>${details.length ? ` - ${details.map(esc).join(', ')}` : ''} ${COPY.uiApp069} ${included}/${chosen.length}${COPY.uiApp015}`;
      renderFieldErrors();
      return;
    }
    const v = validation(team(), entry);
    const details = [...v.missing, ...v.errors];
    box.innerHTML = `<b class="${v.status === 'invalid' ? 'bad' : ''}">${esc(STATUS_LABEL[v.status])}</b>${details.length ? ` - ${details.map(esc).join(', ')}` : ''}`;
    renderFieldErrors();
  }

  function missingRequired(t: Team, entry: Entry, field: string): boolean {
    const draft = draftOf(t, entry);
    if (!draft.included || draft.notScreen || isPrevious(entry, draft)) return false;
    if (t === 'GUI' && entry.estimate === 'missing' && draft.retire === 'replace') return field === 'replaceWith' && !draft.replacedBy;
    if (field === 'workerId') return !draft.workerId;
    if (field === 'tagId') return !draft.tagId;
    if (t !== 'GUI' || isDeletion(entry, draft)) return false;
    if (field === 'code') return !draftCode(state!, entry, draft).trim();
    if (field === 'replaceScreenId') return needsLink(entry) && draft.link === 'replace' && !draft.replaceScreenId;
    if (field === 'name') return !draftName(state!, entry, draft);
    if (field === 'categoryId') return (registersNew(t, entry) || entry.categoryMissing) && !draft.categoryId && !draft.newCategoryName?.trim();
    if (field === 'baseScreenId') return draft.relation === 'case' && !draft.baseScreenId;
    return false;
  }

  function renderFieldErrors() {
    if (!state || tab === 'ADMIN') return;
    const t = team();
    const chosen = selectedEntries(t);
    for (const control of root.querySelectorAll<HTMLElement>('.detail [data-required-field]')) {
      const field = control.dataset.requiredField!;
      const filledNewItem = (control.dataset.field === 'newCategory' || !!control.closest('[data-form="worker-add"], [data-form="tag-add"]'))
        && (control as HTMLInputElement).value.trim();
      const invalid = !filledNewItem && chosen.some(entry =>
        (revealed[t].has(entry.key) || touched[t][entry.key]?.has(field)) && missingRequired(t, entry, field));
      control.classList.toggle('input-error', !!invalid);
      if (invalid) control.setAttribute('aria-invalid', 'true'); else control.removeAttribute('aria-invalid');
    }
  }

  function touchField(t: Team, field: string) {
    for (const entry of selectedEntries(t)) (touched[t][entry.key] ??= new Set()).add(field);
    renderFieldErrors();
  }

  // 이전 배포 썸네일(2026-10-21 사용자 요청): 배포 이력 위, 기본은 접혀 있다. 펼칠 때 이미지를 불러온다.
  // 펼친 상태는 플러그인을 닫을 때까지 유지해 화면을 옮겨 가며 비교할 수 있다.
  function previousThumb(entry: Entry): string {
    const rows = entry.screenId ? state?.gui.get(entry.screenId) ?? [] : [];
    const last = rows[rows.length - 1];
    if (!last || !state) return '';
    const hash = last.thumb?.hash ?? null;
    if (prevThumbOpen) requestThumbs([hash]);
    return `<details class="prev-thumb"${prevThumbOpen ? ' open' : ''}><summary><span>${COPY.uiApp300}</span><small>v${last.version} · ${esc(formatTime(last.committedAt, state.project.utcOffsetMinutes))}</small><span class="dropdown-caret" aria-hidden="true"></span></summary>
      <div class="thumbs">${prevThumbOpen ? thumbImg(hash, formatFrameName(last.code, last.name)) : ''}</div></details>`;
  }

  function renderHistory() {
    const box = root.querySelector('.detail .history');
    const entry = current();
    const id = team() === 'GUI' ? entry?.screenId : entry?.flipbookId;
    if (!box || !id) return;
    if (history?.id !== id) { box.innerHTML = ''; return; }
    box.innerHTML = history.rows.length ? `<h3>${COPY.uiApp071}</h3><table><tbody>${history.rows.slice(0, 8).map(r => `
      <tr><td><span class="team ${r.team}">${r.team}</span></td><td>${esc(r.at)}</td>
      <td><span class="chip" style="--c:${esc(r.tag.color)}">${esc(r.tag.name)}</span></td><td>${esc(r.description)}${r.corrected ? ` <i>${COPY.uiApp072}</i>` : ''}</td><td>${esc(r.worker)}</td></tr>`).join('')}
      </tbody></table>` : '';
  }

  function renderConfirm() {
    const overlay = $('.overlay');
    if (!plan || !state) { overlay.hidden = true; overlay.innerHTML = ''; return; }
    const c = plan.counts;
    const relationLabel = (baseId: string | null) => baseId
      ? `${COPY.uiApp059} (${state!.screens.get(baseId)?.name ?? COPY.coreCompare001})` : COPY.uiApp058;
    const relationNote = (item: Plan['items'][number]) => {
      if (item.team !== 'GUI') return '';
      const before = item.isNew ? null : state!.screens.get(item.screenId)?.baseScreenId ?? null;
      if (!item.isNew && before !== item.baseScreenId)
        return ` <small>${COPY.uiApp057}: ${esc(relationLabel(before))} → ${esc(relationLabel(item.baseScreenId))}</small>`;
      return item.baseScreenId ? ` <small>${COPY.uiApp091} ${esc(state!.screens.get(item.baseScreenId)?.name ?? '')}</small>` : '';
    };
    const summary = plan.team === 'GUI'
      ? `${COPY.uiApp073} ${c.new} ${COPY.uiApp074} ${c.changed} ${COPY.uiApp184} ${c.deleted} ${COPY.uiApp077} ${plan.exclusions.length} ${COPY.uiApp078} ${c.metadata} ${COPY.uiApp079} ${plan.held}`
      : `${COPY.uiApp080} ${c.ui}${COPY.uiApp081} ${COPY.uiApp184} ${c.deleted}${COPY.uiApp081}`;
    overlay.hidden = false;
    overlay.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-label="${COPY.uiApp039}">
      <h2>${plan.team} ${COPY.uiApp082}</h2>
      <p>${esc(summary)}</p>
      ${plan.team === 'GUI' && comment.description.trim() ? `<p class="note">${COPY.uiApp064}: ${esc(comment.description.trim())}</p>` : ''}
      ${plan.blockers.length ? `<div class="blockers"><b>${COPY.uiApp083}</b>${plan.blockers.map(b => `
        <div><button class="link" data-action="goto" data-key="${esc(b.entryKey)}">${esc(b.name || COPY.uiApp084)}</button> ${b.messages.map(esc).join(' · ')}</div>`).join('')}</div>` : ''}
      <table class="items"><thead><tr><th>${COPY.uiApp085}</th><th>${COPY.uiApp086}</th><th>${COPY.uiApp087}</th><th>${COPY.uiApp088}</th><th>${COPY.uiApp089}</th>${plan.team === 'UI' ? `<th>${COPY.uiApp090}</th>` : ''}</tr></thead><tbody>
      ${plan.items.map(i => `<tr>
        <td>${esc(i.name)}${relationNote(i)}${i.isNew && i.newCategoryName ? ` <small>${COPY.uiApp092} ${esc(i.newCategoryName)}</small>` : ''}${!i.isNew && i.fromCategoryId !== i.categoryId ? ` <small>${COPY.uiApp093} ${esc(catName(i.fromCategoryId))} → ${esc(catName(i.categoryId))}</small>` : ''}</td>
        <td>${i.team === 'UI' && i.workType === 'changed' ? 'UI' : i.workType ? WORK_LABEL[i.workType] : 'UI'}</td>
        <td>${i.team} ${i.fromVersion ? `v${i.fromVersion} → ` : ''}v${i.toVersion}</td>
        <td><span class="chip" style="--c:${esc(i.tag.color)}">${esc(i.tag.name)}</span></td>
        <td>${esc(i.worker.name)}</td>${plan!.team === 'UI' ? `<td>${esc(i.description)}</td>` : ''}</tr>`).join('')}
      ${plan.exclusions.map(e => `<tr><td>${esc(e.name)}</td><td>${COPY.uiApp050}</td><td>—</td><td>—</td><td>${esc(e.reason)}</td></tr>`).join('')}
      </tbody></table>
      <p class="note">${COPY.uiApp094}</p>
      <div class="dialog-actions">
        <button data-action="cancel-plan">${COPY.uiApp095}</button>
        <button class="primary" data-action="commit" ${plan.blockers.length ? 'disabled' : ''}>${COPY.uiApp096}</button>
      </div></div>`;
  }

  const scaleOptions = (chosen: FlipbookScale | null) => `${chosen === null ? '<option value="" selected disabled>-</option>' : ''}${([1, 0.5, 0.25] as const)
    .map((value, index) => option(String(value), ['1x', '1/2x', '1/4x'][index], value === chosen)).join('')}`;

  function renderCreateScreenList() {
    const list = root.querySelector<HTMLElement>('.create-screen-list');
    const selectedList = root.querySelector<HTMLElement>('.create-selected-list');
    if (!list || !selectedList) return;
    const row = currentNew();
    if (!row) { list.innerHTML = ''; selectedList.innerHTML = ''; return; }
    const used = new Set([...state!.flipbooks.values()].filter(fb => fb.status === 'active').flatMap(fb => fb.screens.map(screen => screen.uid)));
    const planned = new Set(newFlipbooks.flatMap(item => item.uids));
    const queryText = createQuery.trim().toLocaleLowerCase();
    const screens = activeScreens();
    const selectedScreens = newScreens(row);
    const shown = screens.filter(screen =>
      !row.uids.includes(screen.uid)
      &&
      (!createUncreatedOnly || !used.has(screen.uid) && !planned.has(screen.uid))
      && (!queryText || `${screen.code} ${screen.name}`.toLocaleLowerCase().includes(queryText)));
    const screenOption = (screen: GuiScreenInfo) => {
      const selected = row.uids.includes(screen.uid);
      const inputId = `create-screen-${screen.uid}`;
      return `<div class="create-screen-option" data-thumb="${esc(screen.thumb?.hash ?? '')}">
        <input id="${esc(inputId)}" type="checkbox" data-action="create-screen-toggle" value="${esc(screen.uid)}" ${selected ? 'checked' : ''}>
        <label for="${esc(inputId)}" class="create-screen-label" title="${esc(screen.name)}"><span class="id-tag">${esc(screen.code)}</span><span class="name">${esc(screen.name)}</span></label>
        ${selected ? `<select data-input="create-screen-scale" data-key="${esc(row.key)}" data-uid="${esc(screen.uid)}" aria-label="${esc(screen.name)} 이미지 크기" title="이미지 크기">${scaleOptions(row.scales[screen.uid] ?? row.scale)}</select>` : ''}
        ${used.has(screen.uid) ? '' : planned.has(screen.uid)
          ? '<span class="create-unused-dot planned" title="생성 목록에서 선택됨" aria-label="생성 목록에서 선택됨"></span>'
          : '<span class="create-unused-dot" title="제작된 플립북 없음" aria-label="제작된 플립북 없음"></span>'}
      </div>`;
    };
    selectedList.innerHTML = selectedScreens.map(screenOption).join('') || '<p class="note">선택된 화면이 없습니다.</p>';
    const grouped = new Map<string, { name: string; order: number; screens: GuiScreenInfo[] }>();
    for (const screen of shown) {
      const key = screen.category?.id ?? '';
      const group = grouped.get(key) ?? { name: screen.category?.name ?? '미지정', order: screen.category?.order ?? Number.MAX_SAFE_INTEGER, screens: [] };
      group.screens.push(screen);
      grouped.set(key, group);
    }
    const groups = [...grouped.entries()].sort(([, a], [, b]) => a.order - b.order || a.name.localeCompare(b.name, 'ko'));
    const scrollTop = list.scrollTop;
    list.innerHTML = !groups.length ? `<p class="note">${COPY.uiApp190}</p>`
      : groups.map(([key, group]) => `<div class="create-screen-group"><button class="create-category-heading" data-action="create-category-toggle" data-key="${esc(key)}" aria-expanded="${!createCollapsedCategories.has(key)}"><span class="category-chevron" aria-hidden="true">${createCollapsedCategories.has(key) ? '▸' : '▾'}</span>${esc(group.name)}<span class="create-category-count">${group.screens.length}</span></button>${createCollapsedCategories.has(key) ? '' : group.screens.sort((a, b) => a.code.localeCompare(b.code, 'ko', { numeric: true }) || a.name.localeCompare(b.name, 'ko')).map(screenOption).join('')}</div>`).join('');
    list.scrollTop = scrollTop;
  }

  // 새 플립북 상세: 제목, 놓을 페이지·Section, 위쪽 「선택된 화면」과 아래쪽 화면 선택(카테고리별, 검색, 플립북 없는 화면만).
  // 다시 그려도 화면 목록의 스크롤을 유지한다.
  function renderNewDetail() {
    const detail = $('.detail');
    const n = currentNew();
    if (!n || !state) return;
    detail.classList.add('new-flipbook-detail');
    const listScroll = detail.querySelector<HTMLElement>('.create-screen-list')?.scrollTop ?? 0;
    const selectedScroll = detail.querySelector<HTMLElement>('.create-selected-list')?.scrollTop ?? 0;
    const pageOptions = flipbookPageOptions();
    const chosen = newScreens(n);
    const title = newTitle(n);
    const auto = defaultTitle(newKind(n), chosen);
    const automatic = autoSection(n);
    const choices = sectionChoices(n.pageId).filter(s => s.key !== automatic.key);
    const scales = n.uids.map(uid => n.scales[uid] ?? n.scale);
    const bulkScale = scales.length && scales.every(scale => scale === scales[0]) ? scales[0] : scales.length ? null : n.scale;
    // 제목은 페이지·섹션처럼 늘 입력란이다(2026-10-22 사용자 요청). 지금 쓸 제목(첫 화면 이름 또는 「새 플립북」)을 채워 두며,
    // 직접 고치기 전까지는 화면을 바꾸면 따라 바뀐다. 입력 중에 다시 그려도 값과 커서를 유지한다.
    const typing = detail.querySelector<HTMLInputElement>(`[data-input="new-title"][data-key="${CSS.escape(n.key)}"]`);
    const typed = typing && document.activeElement === typing ? { value: typing.value, start: typing.selectionStart, end: typing.selectionEnd } : null;
    const sectionField = addingSection
      ? `<div class="addable"><input data-input="new-section-name" placeholder="${COPY.uiApp339}" aria-label="${COPY.uiApp339}"><button data-action="new-section-confirm">${COPY.uiApp101}</button><button data-action="new-section-cancel">${COPY.uiApp149}</button></div>`
      : `<div class="addable"><select data-input="new-section" aria-label="${COPY.uiApp340}">
          ${option('', chosen.length ? `${automatic.name} ${COPY.uiApp337}` : automatic.name, !n.section || n.section.key === automatic.key)}
          ${choices.map(s => option(s.key, s.name, !!n.section && n.section.key === s.key)).join('')}
        </select><button class="add-button" data-action="new-section-add">${ADD_LABEL}</button></div>`;
    // 머리는 「플립북 편집」이고, 그 아래 페이지 → 섹션 → 제목을 한 줄씩 둔다(2026-10-22 사용자 요청).
    detail.innerHTML = `<div class="detail-head edit-head"><div class="edit-title"><h2>${COPY.uiApp311}</h2><p class="note">${COPY.uiApp313}</p></div>
        <div class="new-actions">${newActions()}</div></div>
      <div class="new-error">${createError ? `<p class="bad" role="alert">${esc(createError)}</p>` : ''}</div>
      <div class="new-place">
        <div class="field"><div class="field-head"><span>${COPY.uiApp204}</span><button class="link" data-action="create-page-manage" aria-label="페이지 관리">관리${CHEVRON_RIGHT_ICON}</button></div><select data-input="new-page" aria-label="페이지 선택" ${pageOptions.length ? '' : 'disabled'}>${pageOptions.length ? pageOptions.map(pg => option(pg.id, pg.name, pg.id === n.pageId)).join('') : option('', COPY.uiApp106, true)}</select></div>
        <label>${COPY.uiApp338}${sectionField}</label>
        <label>${COPY.uiApp312}<input class="title-input" data-input="new-title" data-key="${esc(n.key)}" value="${esc(title)}" placeholder="${esc(auto)}" aria-label="${COPY.uiApp203}"></label>
      </div>
      <div class="create-browser">
        <section class="create-selected-box"><header><strong>선택된 화면</strong><label class="create-bulk-scale">화면 크기 <select data-input="create-bulk-scale" data-key="${esc(n.key)}" aria-label="화면 크기 일괄 선택" ${n.uids.length ? '' : 'disabled'}>${scaleOptions(bulkScale)}</select></label></header><div class="create-selected-list"></div></section>
        <section class="create-available-box"><header><strong>${COPY.uiApp205} 선택</strong></header><input type="search" data-input="create-query" value="${esc(createQuery)}" placeholder="화면 검색" aria-label="화면 검색"><label class="create-filter create-switch"><input type="checkbox" role="switch" data-action="create-uncreated-only" ${createUncreatedOnly ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span><span>생성된 플립북이 없는 화면</span></label><div class="create-screen-list"></div></section>
      </div>`;
    renderCreateScreenList();
    detail.querySelector<HTMLElement>('.create-screen-list')!.scrollTop = listScroll;
    detail.querySelector<HTMLElement>('.create-selected-list')!.scrollTop = selectedScroll;
    const field = detail.querySelector<HTMLInputElement>('[data-input="new-title"]');
    if (field && typed) { field.value = typed.value; field.focus(); field.setSelectionRange(typed.start, typed.end); }
  }

  // 일괄 만들기 후보: 플립북이 없고 생성 목록에도 고르지 않은 화면
  const bulkCandidates = () => uncreatedScreens(state!, createScreens, newFlipbooks.flatMap(n => n.uids));
  const bulkTargets = () => bulk ? filterScreens(bulkCandidates(), bulk).filter(s => !bulk!.excluded.has(s.uid)) : [];

  function renderBulk() {
    const overlay = $('.bulk-overlay');
    if (!bulk || !state) { overlay.hidden = true; overlay.innerHTML = ''; return; }
    const pageOptions = pages.filter(pg => state!.project.flipbookPageIds.includes(pg.id) && pg.id !== state!.project.dataPageId);
    const candidates = bulkCandidates();
    const planned = uncreatedScreens(state, createScreens).length - candidates.length;
    const categories = new Map<string, { name: string; count: number }>();
    for (const s of candidates) {
      const key = screenCategoryKey(s);
      const c = categories.get(key) ?? { name: s.category?.name ?? '미지정', count: 0 };
      c.count++;
      categories.set(key, c);
    }
    const kinds: [ScreenKind, string][] = [['all', '전체'], ['base', '기본 화면'], ['case', '케이스 화면']];
    overlay.hidden = false;
    overlay.innerHTML = `<div class="dialog bulk-dialog" role="dialog" aria-modal="true" aria-label="플립북 없는 화면 일괄 만들기">
      <h2>플립북 없는 화면 일괄 만들기</h2>
      <label>${COPY.uiApp204}<select data-input="bulk-page" aria-label="페이지 선택">${pageOptions.map(pg => option(pg.id, pg.name, pg.id === bulk!.pageId)).join('')}</select></label>
      <fieldset class="bulk-filter"><legend>카테고리</legend>
        ${categories.size ? `<label class="bulk-check"><input type="checkbox" data-input="bulk-category-all">전체</label>
        ${[...categories].map(([key, c]) => `<label class="bulk-check"><input type="checkbox" data-input="bulk-category" value="${esc(key)}" ${bulk!.categories.has(key) ? 'checked' : ''}>${esc(c.name)}<span class="create-category-count">${c.count}</span></label>`).join('')}`
        : '<span class="note">플립북이 없는 화면이 없습니다.</span>'}
      </fieldset>
      <fieldset class="bulk-filter"><legend>화면 유형</legend>
        ${kinds.map(([value, label]) => `<label class="bulk-check"><input type="radio" name="bulk-kind" data-input="bulk-kind" value="${value}" ${bulk!.kind === value ? 'checked' : ''}>${label}</label>`).join('')}
      </fieldset>
      <input type="search" data-input="bulk-query" value="${esc(bulk.query)}" placeholder="화면 검색" aria-label="화면 검색">
      <div class="bulk-list-head"><label class="bulk-check"><input type="checkbox" data-input="bulk-screen-all">대상 화면</label><span class="bulk-count"></span></div>
      <div class="bulk-screen-list create-screen-list"></div>
      ${planned > 0 ? `<p class="note">생성 목록에서 고른 화면 ${planned}개는 제외했습니다.</p>` : ''}
      ${bulk.error ? `<p class="bad">${esc(bulk.error)}</p>` : ''}
      <div class="dialog-actions"><button data-action="bulk-close">${COPY.uiApp095}</button><button class="primary" data-action="bulk-submit"></button></div>
    </div>`;
    renderBulkList();
  }

  // 범위가 바뀌면 목록·개수·버튼만 다시 그린다(검색 입력의 포커스를 유지한다).
  function renderBulkList() {
    const overlay = $('.bulk-overlay');
    const list = overlay.querySelector<HTMLElement>('.bulk-screen-list');
    if (!bulk || !list) return;
    const candidates = bulkCandidates();
    const shown = filterScreens(candidates, bulk);
    const targets = shown.filter(s => !bulk!.excluded.has(s.uid));
    const scrollTop = list.scrollTop;
    let lastCategory: string | null = null;
    list.innerHTML = shown.map(s => {
      const key = screenCategoryKey(s);
      const heading = key !== lastCategory ? `<div class="create-category-heading">${esc(s.category?.name ?? '미지정')}</div>` : '';
      lastCategory = key;
      const inputId = `bulk-screen-${s.uid}`;
      return `${heading}<div class="create-screen-option" data-thumb="${esc(s.thumb?.hash ?? '')}">
        <input id="${esc(inputId)}" type="checkbox" data-input="bulk-screen" value="${esc(s.uid)}" ${bulk!.excluded.has(s.uid) ? '' : 'checked'}>
        <label for="${esc(inputId)}" class="create-screen-label" title="${esc(s.name)}"><span class="id-tag">${esc(s.code)}</span><span class="name">${esc(s.name)}</span></label>
      </div>`;
    }).join('') || `<p class="note">${candidates.length ? '범위에 맞는 화면이 없습니다.' : '플립북이 없는 화면이 없습니다.'}</p>`;
    list.scrollTop = scrollTop;
    overlay.querySelector('.bulk-count')!.textContent = `${targets.length} / ${shown.length}`;
    const setAll = (input: HTMLInputElement | null, on: number, total: number) => {
      if (!input) return;
      input.checked = total > 0 && on === total;
      input.indeterminate = on > 0 && on < total;
      input.disabled = total === 0;
    };
    const keys = [...new Set(candidates.map(screenCategoryKey))];
    setAll(overlay.querySelector('[data-input="bulk-category-all"]'), keys.filter(k => bulk!.categories.has(k)).length, keys.length);
    setAll(overlay.querySelector('[data-input="bulk-screen-all"]'), targets.length, shown.length);
    const submit = overlay.querySelector<HTMLButtonElement>('[data-action="bulk-submit"]')!;
    submit.textContent = bulk.submitting ? COPY.uiApp330 : `${COPY.uiApp331} ${targets.length}${COPY.uiApp332}`;
    submit.disabled = bulk.submitting || !targets.length || !bulk.pageId;
    if (bulk.submitting) for (const control of overlay.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) control.disabled = true;
  }

  function renderAdmin() {
    if (!state) return;
    const s = state;
    const scopeIds = s.project.scopePageIds;
    const availableScopePages = pages.filter(p => p.id !== s.project.dataPageId && !scopeIds.includes(p.id));
    const uiPageIds = s.project.flipbookPageIds;
    const availableUiPages = pages.filter(p => p.id !== s.project.dataPageId && !uiPageIds.includes(p.id));
    const workers = [...s.workers.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    const pending = [...s.deliveries.values()].filter(d => d.state !== 'done');
    const exclusions = [...s.exclusions.values()].filter(e => e.active);
    // GUI Publish는 원본 범위·제외, UI Flipbook은 템플릿을 설정한다. 작업자·DATA·기록·초기화는 둘 다 쓴다.
    const gui = mode === 'GUI';
    $('.detail').innerHTML = `
      ${gui ? `<section class="admin" data-form="scope"><h3>${COPY.uiApp097}</h3>
        <div class="inline"><select data-f="page" aria-label="${COPY.uiApp098}" ${availableScopePages.length ? '' : 'disabled'}>
          ${option('', availableScopePages.length ? COPY.uiApp099 : COPY.uiApp100, true)}
          ${availableScopePages.map(p => option(p.id, p.name, false)).join('')}
        </select></div>
        <div class="scope-pages" aria-label="${COPY.uiApp102}">
          ${scopeIds.length ? scopeIds.map(id => `<div class="scope-page"><span>${esc(pages.find(p => p.id === id)?.name ?? `${COPY.uiApp103}${id})`)}</span><button class="icon-button" data-action="admin-scope-remove" data-id="${esc(id)}" title="${COPY.uiApp105}" aria-label="${esc(pages.find(p => p.id === id)?.name ?? id)} ${COPY.uiApp104}">${X_ICON}</button></div>`).join('') : `<p class="note">${COPY.uiApp106}</p>`}
        </div>
        </section>` : `<section class="admin" data-form="flipbook"><h3>${COPY.uiApp107}</h3>
        <label>${COPY.uiApp108}</label>
        <div class="inline"><select data-f="page" aria-label="${COPY.uiApp210}" ${availableUiPages.length ? '' : 'disabled'}>
          ${option('', availableUiPages.length ? COPY.uiApp099 : COPY.uiApp100, true)}
          ${availableUiPages.map(p => option(p.id, p.name, false)).join('')}
        </select></div>
        <div class="scope-pages" aria-label="${COPY.uiApp108}">
          ${uiPageIds.length ? uiPageIds.map(id => `<div class="scope-page"><span>${esc(pages.find(p => p.id === id)?.name ?? `${COPY.uiApp103}${id})`)}</span><button class="icon-button" data-action="admin-ui-page-remove" data-id="${esc(id)}" title="${COPY.uiApp105}" aria-label="${esc(pages.find(p => p.id === id)?.name ?? id)} ${COPY.uiApp104}">${X_ICON}</button></div>`).join('') : `<p class="note">${COPY.uiApp106}</p>`}
        </div>
        <p class="note">${COPY.uiApp111} ${s.project.templateNodeId ? esc(s.project.templateName ?? s.project.templateNodeId) : COPY.uiApp112}</p>
        <button data-action="admin-template">${COPY.uiApp113}</button>
        <p class="note">${COPY.uiApp114}</p></section>
      <section class="admin" data-form="gui-width"><h3>${COPY.uiApp225}</h3>
        <label>${COPY.uiApp226}</label>
        <div class="inline"><input type="number" data-f="width" data-input="admin-gui-width" min="${GUI_WIDTH_MIN}" max="${GUI_WIDTH_MAX}" step="1" value="${s.project.guiWidth}" aria-label="${COPY.uiApp226}"><button data-action="admin-gui-width">${COPY.uiApp110}</button></div>
        <p class="note gui-width-sizes">${guiWidthSizes(s.project.guiWidth)}</p>
        <p class="note">${COPY.uiApp227} ${COPY.uiApp228} ${COPY.uiApp265}</p></section>`}
      ${gui ? renderScreenIdSection(s) : ''}
      ${renderDataSection(s)}
      <section class="admin"><h3>${COPY.uiApp089}</h3>
        ${workers.map(w => `<div class="inline" data-form="wrk" data-id="${w.id}"><input data-f="name" value="${esc(w.name)}"><button data-action="admin-wrk-rename">${COPY.uiApp116}</button><button data-action="admin-wrk-active" data-active="${!w.active}">${w.active ? COPY.uiApp117 : COPY.uiApp118}</button></div>`).join('')}
        <div class="inline" data-form="wrk-add"><input data-f="name" placeholder="${COPY.uiApp119}"><button class="add-button" data-action="admin-wrk-add">${ADD_LABEL}</button></div></section>
      ${gui ? `<section class="admin"><h3>${COPY.uiApp120}</h3>
        ${exclusions.length ? exclusions.map(e => `<div class="inline" data-form="exc" data-id="${e.id}"><span>${esc(e.name)}</span><small>${esc(e.reason)}</small><button data-action="admin-unexclude">${COPY.uiApp121}</button></div>`).join('') : `<p class="note">${COPY.uiApp122}</p>`}</section>` : ''}
      <section class="admin"><h3>${COPY.uiApp123}</h3><p>${pending.length}${COPY.uiApp081}</p>${pending.length ? `<button data-action="retry">${COPY.uiApp124}</button>` : ''}</section>
      <section class="admin"><h3>${COPY.uiApp125}</h3>
        ${s.audit.slice(-15).reverse().map(a => `<div class="audit"><small>${esc(new Date(a.at).toLocaleString('ko-KR'))}</small> ${esc(a.actor.name)} · ${esc(a.action)}${a.reason ? ` · ${esc(a.reason)}` : ''}</div>`).join('') || `<p class="note">${COPY.uiApp122}</p>`}</section>
      ${issues.length ? `<section class="admin"><h3>${COPY.uiApp126}</h3>${issues.map(i => `<div class="bad">${esc(i)}</div>`).join('')}</section>` : ''}
      <section class="admin danger-zone"><h3>Danger Zone</h3>
        <p class="note"><b>${COPY.uiApp127}</b>${COPY.uiApp128}
          ${COPY.uiApp129}</p>
        <button class="danger" data-action="reset-data">${resetArmed ? COPY.uiApp130 : COPY.uiApp131}</button>
        ${resetArmed ? `<button data-action="reset-cancel">${COPY.uiApp132}</button>` : ''}</section>`;
    accordion();
  }

  // 설정한 1x 폭에서 계산한 1/2x·1/4x 폭. 입력 중에도 바로 보여 준다.
  function guiWidthSizes(width: number): string {
    if (!validGuiWidth(width)) return COPY.controller067;
    const px = (scale: 0.5 | 0.25) => `${Number(guiTargetWidth(width, scale).toFixed(1))}px`;
    return `1x ${width}px · 1/2x ${px(0.5)} · 1/4x ${px(0.25)}`;
  }

  // 설정의 각 항목을 아코디언으로 바꾼다. 하나를 열면 다른 항목은 접힌다(2026-10-20 사용자 결정).
  // 다시 그려도 열어 둔 항목을 유지하고, 처음에는 첫 항목을 연다.
  function accordion() {
    const sections = [...$('.detail').querySelectorAll<HTMLElement>(':scope > section.admin')];
    const keys = sections.map((section, i) => section.querySelector(':scope > h3')?.textContent?.trim() || String(i));
    const open = adminOpen && keys.includes(adminOpen) ? adminOpen : keys[0];
    sections.forEach((section, i) => {
      const heading = section.querySelector<HTMLElement>(':scope > h3');
      const details = document.createElement('details');
      details.className = `${section.className} accordion`;
      if (section.dataset.form) details.dataset.form = section.dataset.form;
      details.dataset.key = keys[i];
      const summary = document.createElement('summary');
      summary.innerHTML = `<span>${heading?.innerHTML ?? esc(keys[i])}</span><span class="dropdown-caret" aria-hidden="true"></span>`;
      heading?.remove();
      details.append(summary, ...section.childNodes);
      details.open = keys[i] === open;
      section.replaceWith(details);
    });
  }

  // 팔레트 색 고르기. 색만으로 구분하지 않도록 이름을 툴팁·접근 이름으로 붙인다.
  function swatches(group: string, selectedKey: string): string {
    return `<div class="swatches" role="radiogroup" aria-label="${COPY.uiApp133}">${TAG_PALETTE.map(c => `
      <label class="swatch" title="${c.key}" style="--c:${c.hex}"><input type="radio" name="${esc(group)}" value="${c.key}" data-f="color" aria-label="${c.key}" ${c.key === selectedKey ? 'checked' : ''}><span></span></label>`).join('')}</div>`;
  }

  // 새 버전 페이지 전환(2026-10-21 사용자 요청). 다른 파일에서 붙여 넣은 페이지를 화면 내용으로 비교해 연결을 제안하고,
  // 사용자가 확인·수정한 뒤 전환한다. 프레임 이름은 연결에 쓰지 않는다.
  function versionCandidates(s: State): PageInfo[] {
    return pages.filter(p => p.id !== s.project.dataPageId && !s.project.scopePageIds.includes(p.id));
  }

  function currentVersionMatch(): VersionMatchView | null {
    return versionMatch && versionMatch.pageId === versionPageId ? versionMatch : null;
  }

  function versionNodeOf(link: VersionLink): string {
    return versionChoice.get(link.screenId) ?? link.nodeId ?? '';
  }

  function versionLinks(match: VersionMatchView): { screenId: string; nodeId: string }[] {
    return match.links.map(l => ({ screenId: l.screenId, nodeId: versionNodeOf(l) })).filter(l => l.nodeId);
  }

  // none: 연결 안 함, manual: 제안과 다른 프레임을 직접 고름
  function versionKindOf(link: VersionLink, nodeId: string): VersionLink['kind'] {
    return !nodeId ? 'none' : nodeId !== (link.nodeId ?? '') ? 'manual' : link.kind;
  }

  // nodeId: 지금 고른 프레임. 이름이 기존 원본 프레임과 같으면 「이름 같음」을 붙인다.
  function versionLabel(link: VersionLink, kind: VersionLink['kind'], nodeId = ''): string {
    const label = kind === 'same' ? COPY.uiApp253 : kind === 'similar' ? `${COPY.uiApp254} ${Math.round(link.score * 100)}%` : kind === 'manual' ? COPY.uiApp255 : COPY.uiApp256;
    return versionSameName(link, nodeId) ? `${label} · ${COPY.uiApp298}` : label;
  }

  function versionSameName(link: VersionLink, nodeId: string): boolean {
    const name = nodeId ? versionMatch?.frames.find(f => f.nodeId === nodeId)?.name.trim() : '';
    return !!name && name === link.sourceName?.trim();
  }

  // 지금 고른 연결의 프레임별 사용 수. 한 프레임을 두 화면에 연결하면 2 이상이다.
  function versionUses(match: VersionMatchView): Map<string, number> {
    const uses = new Map<string, number>();
    for (const l of versionLinks(match)) uses.set(l.nodeId, (uses.get(l.nodeId) ?? 0) + 1);
    return uses;
  }

  // 새 버전 페이지 탭: 왼쪽은 등록 화면과 연결되지 않은 새 프레임, 오른쪽은 고른 항목의 미리보기·유사도 근거·연결 수정.
  // 플립북 만들기 탭처럼 목록·화면정보·하단 영역을 가리고 자기 화면을 그린다.
  function renderVersion() {
    const open = versionOpen && mode === 'GUI' && tab !== 'ADMIN' && !plan && !!state;
    root.classList.toggle('versioning-mode', open);
    let view = root.querySelector<HTMLElement>('.version-view');
    if (!open) { view?.remove(); return; }
    if (!view) { view = document.createElement('div'); view.className = 'version-view'; root.appendChild(view); }
    const candidates = versionCandidates(state!);
    if (!candidates.some(p => p.id === versionPageId)) versionPageId = candidates[0]?.id ?? '';
    const match = currentVersionMatch();
    view.innerHTML = `<div class="version-dialog" aria-label="${COPY.uiApp248}">
      <div class="version-page-line">${candidates.length
        ? `<label>${COPY.uiApp251}<select data-input="version-page" aria-label="${COPY.uiApp251}">${candidates.map(p => option(p.id, p.name, p.id === versionPageId)).join('')}</select></label>
          <button class="${match ? '' : 'primary'}" data-action="version-match">${match ? COPY.uiApp273 : COPY.uiApp252}</button>
          ${match && match.links.length ? '<div class="version-actions"></div>' : ''}`
        : `<p class="note">${COPY.uiApp263}</p>`}</div>
      <p class="note">${COPY.uiApp249}</p>
      ${match && match.links.length ? '<div class="version-notes"></div>' : ''}
      ${match && match.links.length ? `<div class="version-workspace">
        <section class="version-list">
          <header><span class="version-counts"></span></header>
          <input type="search" data-input="version-query" value="${esc(versionQuery)}" placeholder="${COPY.uiApp020}" aria-label="${COPY.uiApp021}">
          <label class="create-filter create-switch"><input type="checkbox" role="switch" data-action="version-review-only" ${versionHideSame ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span><span>${COPY.uiApp275}</span></label>
          <div class="version-list-box"></div>
        </section>
        <section class="version-detail"></section>
      </div>`
        : `<p class="empty version-empty">${match ? COPY.uiApp264 : candidates.length ? COPY.uiApp274 : ''}</p>`}
    </div>`;
    paintVersionList();
    renderVersionDetail();
    renderVersionActions();
  }

  // 목록만 다시 그린다(검색 입력의 포커스와 스크롤 유지).
  function paintVersionList() {
    const match = currentVersionMatch();
    const box = root.querySelector<HTMLElement>('.version-list-box');
    if (!match || !box) return;
    const uses = versionUses(match);
    const kinds = match.links.map(l => versionKindOf(l, versionNodeOf(l)));
    const count = (k: VersionLink['kind']) => kinds.filter(x => x === k).length;
    root.querySelector<HTMLElement>('.version-counts')!.textContent =
      `${COPY.uiApp253} ${count('same')} · ${COPY.uiApp254} ${count('similar')} · ${COPY.uiApp255} ${count('manual')} · ${COPY.uiApp256} ${count('none')}`;
    const q = versionQuery.trim().toLowerCase();
    const hit = (text: string) => !q || text.toLowerCase().includes(q);
    const screens = match.links.map((l, i) => ({ l, kind: kinds[i], nodeId: versionNodeOf(l) }))
      .filter(r => hit(`${r.l.code} ${r.l.name}`) && !(versionHideSame && r.kind === 'same'));
    const frames = match.frames.map((f, i) => ({ f, i })).filter(r => !uses.has(r.f.nodeId) && hit(`${r.i + 1}. ${r.f.name}`));
    const sel = (kind: string, id: string) => versionSelected?.kind === kind && versionSelected.id === id;
    const scroll = box.scrollTop;
    box.innerHTML = (screens.length ? screens.map(({ l, kind, nodeId }) => {
      const clash = !!nodeId && (uses.get(nodeId) ?? 0) > 1;
      const on = sel('screen', l.screenId);
      return `<div class="row version-row${on ? ' selected' : ''}" data-action="version-select" data-kind="screen" data-id="${esc(l.screenId)}" tabindex="0" aria-selected="${on}">
        <span class="id-tag">${esc(l.code)}</span><span class="name">${esc(l.name)}</span>
        <small class="version-kind ${kind}${clash ? ' bad' : ''}">${esc(versionLabel(l, kind, nodeId))}</small></div>`;
    }).join('') : `<p class="note">${COPY.uiApp028}</p>`) +
      (frames.length ? `<div class="group-bar"><span class="group-head">${COPY.uiApp259}<span class="count">${frames.length}</span></span></div>` +
        frames.map(({ f, i }) => {
          const on = sel('frame', f.nodeId);
          return `<div class="row version-row${on ? ' selected' : ''}" data-action="version-select" data-kind="frame" data-id="${esc(f.nodeId)}" data-thumb="${esc(NODE_PREVIEW + f.nodeId)}" tabindex="0" aria-selected="${on}">
            <span class="name">${i + 1}. ${esc(f.name)}</span></div>`;
        }).join('') : '');
    box.scrollTop = scroll;
  }

  function versionImage(key: string | null, alt: string, empty: string): string {
    const url = key ? thumbUrls.get(key) : null;
    if (url) return `<img src="${url}" alt="${esc(alt)}">`;
    return `<span class="thumb-empty">${!key ? esc(empty) : failedPreviews.has(key) ? COPY.uiApp195 : COPY.uiApp001}</span>`;
  }

  function versionFigure(key: string | null, caption: string, nodeId: string | null, empty: string): string {
    return `<figure${key ? ` data-thumb="${esc(key)}"` : ''}>${versionImage(key, caption, empty)}
      <figcaption><span>${esc(caption)}</span>${nodeId ? `<button class="link" data-action="version-reveal" data-node="${esc(nodeId)}">${COPY.uiApp280}</button>` : ''}</figcaption></figure>`;
  }

  // 유사도 근거: 점수 = 일치한 요소 / 비교한 요소, 종류별 개수, 한쪽에만 있는 글자, 뺀 공통 요소 수
  function evidenceHtml(link: VersionLink, kind: VersionLink['kind'], nodeId: string): string {
    if (kind === 'same') return `<p><b>${COPY.uiApp253}</b> · ${COPY.uiApp281}</p>`;
    if (!link.hasSource) return `<p class="note">${COPY.uiApp282}</p>`;
    if (!nodeId) return `<p class="note">${Math.round(SIMILAR_MIN * 100)}% ${COPY.uiApp283}</p>`;
    const key = `${link.screenId}|${nodeId}`;
    if (!versionEvidence.has(key)) {
      versionEvidence.set(key, undefined);
      bridge.send({ type: 'versionDetail', pageId: versionPageId, screenId: link.screenId, nodeId });
    }
    const ev = versionEvidence.get(key);
    if (ev === undefined) return `<p class="note">${COPY.uiApp001}</p>`;
    if (ev === null) return `<p class="note">${COPY.uiApp284}</p>`;
    const part = (label: string, p: { matched: number; total: number }) => `<tr><th>${label}</th><td>${p.matched} / ${p.total}</td></tr>`;
    const texts = (label: string, list: string[]) => list.length
      ? `<p class="version-texts"><span>${label}</span> ${list.slice(0, 8).map(t => `<q>${esc(t)}</q>`).join(' ')}${list.length > 8 ? ` …` : ''}</p>` : '';
    return `<p class="version-score"><b>${Math.round(ev.score * 100)}%</b> = ${COPY.uiApp285} <b>${ev.matched}</b> / ${COPY.uiApp286} <b>${ev.total}</b></p>
      ${versionSameName(link, nodeId) ? `<p class="version-texts"><span>${COPY.uiApp299}</span> <q>${esc(link.sourceName ?? '')}</q></p>` : ''}
      <table class="version-parts">${part(COPY.uiApp287, ev.parts.text)}${part(COPY.uiApp288, ev.parts.image)}${part(COPY.uiApp289, ev.parts.layer)}</table>
      ${texts(COPY.uiApp290, ev.onlySource)}${texts(COPY.uiApp291, ev.onlyFrame)}
      ${ev.total && ev.matched === ev.total ? `<p class="note">${COPY.uiApp292}</p>` : ''}
      <p class="note">${COPY.uiApp293} ${ev.ignored}${COPY.uiApp294}</p>`;
  }

  // 고른 항목의 화면정보. focus: 다시 그린 뒤 포커스를 돌려줄 드롭다운
  function renderVersionDetail(focus?: string) {
    const match = currentVersionMatch();
    const detail = root.querySelector<HTMLElement>('.version-detail');
    if (!match || !detail || !state) return;
    // 미리보기·근거가 늦게 와서 다시 그려도 쓰던 드롭다운의 포커스를 유지한다.
    const active = document.activeElement as HTMLElement | null;
    focus ??= active && detail.contains(active) ? active.dataset.input : undefined;
    if (versionSelected?.kind === 'frame' && versionUses(match).has(versionSelected.id)) versionSelected = null;
    const sel = versionSelected;
    const scroll = detail.scrollTop;
    const frameLabel = (nodeId: string) => { const i = match.frames.findIndex(f => f.nodeId === nodeId); return i < 0 ? nodeId : `${i + 1}. ${match.frames[i].name}`; };
    const link = sel?.kind === 'screen' ? match.links.find(l => l.screenId === sel.id) : undefined;
    if (link) {
      const nodeId = versionNodeOf(link);
      const kind = versionKindOf(link, nodeId);
      const sourceId = link.hasSource ? state.screens.get(link.screenId)?.source?.nodeId ?? null : null;
      const oldKey = sourceId ? NODE_PREVIEW + sourceId : thumbOf(link.screenId);
      const newKey = nodeId ? NODE_PREVIEW + nodeId : null;
      requestThumbs([oldKey, newKey]);
      const clash = !!nodeId && (versionUses(match).get(nodeId) ?? 0) > 1;
      detail.innerHTML = `<header class="version-detail-head"><span class="id-tag">${esc(link.code)}</span><strong>${esc(link.name)}</strong><small class="version-kind ${kind}">${esc(versionLabel(link, kind, nodeId))}</small></header>
        <label>${COPY.uiApp276}<select data-input="version-link" data-screen="${esc(link.screenId)}" aria-label="${COPY.uiApp276}" class="${clash ? 'input-error' : ''}">${option('', COPY.uiApp256, !nodeId)}${match.frames.map(f => option(f.nodeId, frameLabel(f.nodeId), f.nodeId === nodeId)).join('')}</select></label>
        ${clash ? `<p class="bad" role="status">${COPY.coreVersion003}</p>` : ''}
        <div class="version-compare">${versionFigure(oldKey, sourceId ? COPY.uiApp277 : COPY.uiApp278, sourceId, COPY.uiApp195)}${versionFigure(newKey, nodeId ? `${COPY.uiApp279} · ${frameLabel(nodeId)}` : COPY.uiApp279, nodeId || null, COPY.uiApp256)}</div>
        <div class="version-evidence">${evidenceHtml(link, kind, nodeId)}</div>`;
    } else if (sel?.kind === 'frame') {
      const key = NODE_PREVIEW + sel.id;
      requestThumbs([key]);
      detail.innerHTML = `<header class="version-detail-head"><strong>${esc(frameLabel(sel.id))}</strong><small class="version-kind none">${COPY.uiApp259}</small></header>
        <label>${COPY.uiApp295}<select data-input="version-frame-link" data-node="${esc(sel.id)}" aria-label="${COPY.uiApp295}">${option('', COPY.uiApp256, true)}${match.links.map(l => {
          const current = versionNodeOf(l);
          return option(l.screenId, `${formatFrameName(l.code, l.name)}${current ? ` · ${versionLabel(l, versionKindOf(l, current), current)}` : ''}`, false);
        }).join('')}</select></label>
        <div class="version-compare">${versionFigure(key, COPY.uiApp279, sel.id, '')}</div>
        <p class="note">${COPY.uiApp296}</p>`;
    } else {
      detail.innerHTML = `<p class="empty">${COPY.uiApp297}</p>`;
    }
    detail.scrollTop = scroll;
    if (focus) detail.querySelector<HTMLElement>(`[data-input="${focus}"]`)?.focus();
  }

  function renderVersionActions() {
    const match = currentVersionMatch();
    const box = root.querySelector<HTMLElement>('.version-actions');
    if (!match || !box) return;
    const uses = versionUses(match);
    const duplicate = [...uses.values()].some(n => n > 1);
    const unlinkedScreens = match.links.length - versionLinks(match).length;
    const unlinkedFrames = match.frames.filter(f => !uses.has(f.nodeId)).length;
    // 버튼은 페이지 줄 오른쪽, 안내는 그 아래 줄(2026-10-23 사용자 요청: 하단 오른쪽 버튼을 위 오른쪽으로)
    box.innerHTML = `<div class="dialog-actions">${versionArmed ? `<button data-action="version-cancel">${COPY.uiApp132}</button>` : ''}<button class="danger" data-action="version-switch" ${duplicate ? 'disabled' : ''}>${versionArmed ? COPY.uiApp262 : COPY.uiApp261}</button></div>`;
    const notes = root.querySelector<HTMLElement>('.version-notes');
    if (notes) notes.innerHTML = `${unlinkedScreens ? `<span class="note">${COPY.uiApp257} <b>${unlinkedScreens}</b>${COPY.uiApp258}</span>` : ''}
        ${unlinkedFrames ? `<span class="note">${COPY.uiApp259} <b>${unlinkedFrames}</b>${COPY.uiApp260}</span>` : ''}
        ${duplicate ? `<span class="bad" role="status">${COPY.coreVersion003}</span>` : ''}
        <span class="note">${COPY.uiApp250}</span>`;
  }

  // 연결을 바꾸면 목록·화면정보·하단을 함께 고친다.
  function versionLinkChanged(focus?: string) {
    versionArmed = false;
    paintVersionList();
    renderVersionDetail(focus);
    renderVersionActions();
  }

  // 비교 결과를 받으면 확인이 필요한 첫 화면(동일이 아닌 화면)을 고른다.
  function selectFirstVersionItem(match: VersionMatchView) {
    const first = match.links.find(l => l.kind !== 'same') ?? match.links[0];
    versionSelected = first ? { kind: 'screen', id: first.screenId } : null;
  }

  function openVersion() {
    if (versionOpen) return;
    sizeBeforeVersion = { width: root.offsetWidth, height: root.offsetHeight };
    bridge.send({ type: 'resize', width: Math.max(sizeBeforeVersion.width, 960), height: Math.max(sizeBeforeVersion.height, 720) });
    versionOpen = true;
    // 플러그인을 연 뒤 붙여 넣은 페이지도 고를 수 있게 페이지 목록을 다시 받는다.
    bridge.send({ type: 'pages' });
    renderAll();
  }

  function closeVersion(render = true) {
    if (!versionOpen) return;
    versionOpen = false;
    versionArmed = false;
    hoverThumb = null;
    showHoverThumb();
    if (sizeBeforeVersion) {
      bridge.send({ type: 'resize', ...sizeBeforeVersion });
      sizeBeforeVersion = null;
    }
    if (render) renderAll();
  }

  // 목록에서 위아래 화살표로 항목을 옮긴다.
  function moveVersionSelection(from: HTMLElement, step: number) {
    const rows = [...root.querySelectorAll<HTMLElement>('.version-row')];
    const next = rows[rows.indexOf(from) + step];
    if (!next) return;
    versionSelected = { kind: next.dataset.kind as 'screen' | 'frame', id: next.dataset.id! };
    paintVersionList();
    renderVersionDetail();
    [...root.querySelectorAll<HTMLElement>('.version-row')].find(r => r.dataset.kind === versionSelected!.kind && r.dataset.id === versionSelected!.id)?.focus();
  }

  // Screen ID 자동 입력 규칙: 플랫폼 Prefix와 카테고리별 코드(2026-10-20 사용자 요청). 저장하면 배포 화면의 ID도 바로 바꾼다.
  function renderScreenIdSection(s: State): string {
    const cats = [...s.categories.values()].filter(c => c.active).sort((a, b) => a.order - b.order);
    const prefix = s.project.screenIdPrefix;
    const sample = `${prefix ? `${prefix}_` : ''}${cats.find(c => c.code)?.code ?? 'HO'}_001`;
    return `<section class="admin" data-form="screen-id-prefix"><h3>Screen ID</h3>
      <label>${COPY.uiApp229}</label>
      <div class="inline"><input data-f="prefix" value="${esc(prefix)}" placeholder="STB" aria-label="${COPY.uiApp229}"><button data-action="admin-screen-prefix">${COPY.uiApp110}</button></div>
      <label>${COPY.uiApp230}</label>
      ${cats.length ? cats.map(c => `<div class="inline category-code" data-form="cat-code" data-id="${esc(c.id)}"><span title="${esc(c.name)}">${esc(c.name)}</span><input data-f="code" value="${esc(c.code ?? '')}" aria-label="${esc(c.name)} ${COPY.uiApp230}"><button data-action="admin-cat-code">${COPY.uiApp110}</button></div>`).join('') : `<p class="note">${COPY.uiApp234}</p>`}
      <p class="note">${COPY.uiApp231} ${esc(sample)}</p>
      <p class="note">${COPY.uiApp232} ${COPY.uiApp233}</p>
      <label>${COPY.uiApp245}</label>
      <p class="note">${COPY.uiApp247}</p>
      <div class="inline"><button class="danger" data-action="admin-renumber">${renumberArmed ? COPY.uiApp246 : COPY.uiApp245}</button>${renumberArmed ? `<button data-action="renumber-cancel">${COPY.uiApp132}</button>` : ''}</div></section>`;
  }

  // 공유 DATA 페이지 연결과 표시 갱신 상태. 갱신 실패는 확정 기록과 별개로 표시한다.
  function renderDataSection(s: State): string {
    const pageId = s.project.dataPageId;
    const status = s.dataStatus;
    const offset = s.project.utcOffsetMinutes;
    const name = pageId ? pages.find(p => p.id === pageId)?.name ?? `${COPY.uiApp134} ${pageId}` : null;
    const failed = status?.error && (!status.renderedAt || (status.failedAt ?? 0) > status.renderedAt);
    const lines = [
      name ? `${COPY.uiApp135} ${esc(name)}` : COPY.uiApp136,
      status?.renderedAt ? `${COPY.uiApp137} ${esc(formatTime(status.renderedAt, offset))} · ${esc(status.actor.name)}` : '',
      failed ? `<span class="bad">${COPY.uiApp138} ${esc(formatTime(status!.failedAt!, offset))}: ${esc(status!.error)}</span>` : '',
    ].filter(Boolean);
    return `<section class="admin" data-form="data"><h3>${COPY.uiApp141}</h3>
      ${lines.map(l => `<p class="note">${l}</p>`).join('')}
      <button data-action="data-refresh">${pageId ? COPY.uiApp142 : COPY.uiApp143}</button>
      <div class="inline"><select data-f="page" aria-label="${COPY.uiApp144}">${pages.map(p => option(p.id, p.name, p.id === pageId)).join('')}</select>
        <button data-action="admin-data-connect">${COPY.uiApp145}</button></div>
      <p class="note">${COPY.uiApp146}</p></section>`;
  }

  // 태그: 이 탭(GUI 또는 UI)의 태그를 고르고, 같은 자리에서 추가·이름 변경·색 변경·사용 안 함·다시 사용을 한다.
  function tagField(t: Team, draft: Draft, multi = false, selectedId = draft.tagId ?? '', isMixed = false, label: string = COPY.uiApp088): string {
    const own = [...state!.tags.values()].filter(x => x.team === t);
    const chosen = selectedId ? own.find(x => x.id === selectedId && x.active) ?? null : null;
    const inactive = own.filter(x => !x.active);
    const armed = chosen && tagArmed === chosen.id;
    const pill = (tag: typeof own[number]) => `<span class="chip" style="--c:${esc(tag.color)}">${esc(tag.name)}</span>`;
    const picker = `<details class="tag-picker"><summary aria-label="${COPY.uiApp040}" data-required-field="tagId">${chosen ? pill(chosen) : `<span class="placeholder">${isMixed ? esc(COPY.uiApp175) : COPY.uiApp040}</span>`}<span class="dropdown-caret" aria-hidden="true"></span></summary>
      <div class="tag-options"><button data-action="select-tag" data-id="" class="tag-option">${COPY.uiApp040}</button>
        ${own.filter(x => x.active).map(tag => `<button data-action="select-tag" data-id="${esc(tag.id)}" class="tag-option" aria-pressed="${tag.id === selectedId}">${pill(tag)}</button>`).join('')}
        ${inactive.map(tag => `<button data-action="tag-reactivate" data-id="${esc(tag.id)}" class="tag-option inactive">${pill(tag)} <small>${COPY.uiApp158}</small></button>`).join('')}
      </div></details>`;
    return `<div class="wide"><label>${esc(label)}</label>
      ${addMode === 'tag'
        ? `<div class="addable" data-form="tag-add"><input data-f="name" data-required-field="tagId" placeholder="${COPY.uiApp147}" aria-label="${COPY.uiApp147}"><button data-action="tag-add">${COPY.uiApp148}</button><button data-action="cancel-add">${COPY.uiApp149}</button>${swatches(`tag-color-${t}`, TAG_PALETTE[0].key)}</div>`
        : editMode === 'tag' && chosen
          ? `<div class="addable" data-form="tag-edit"><input data-f="name" value="${esc(chosen.name)}" aria-label="${COPY.uiApp151}"><button data-action="tag-edit">${COPY.uiApp148}</button><button data-action="cancel-add">${COPY.uiApp149}</button>${swatches(`tag-color-${t}`, chosen.colorKey)}<button class="link danger" data-action="tag-deactivate">${armed ? COPY.uiApp155 : COPY.uiApp156}</button></div>`
          : `<div class="addable">${picker}${chosen && !multi && !chosen.system ? `<button data-action="begin-edit" data-kind="tag" aria-label="${COPY.uiApp174}">${COPY.uiApp173}</button>` : ''}<button class="add-button" data-action="begin-add" data-kind="tag">${ADD_LABEL}</button></div>`}
    </div>`;
  }

  function workerField(draft: Draft, selectedId = draft.workerId ?? '', isMixed = false): string {
    return `<div class="wide"><label>${COPY.uiApp089}</label>${addMode === 'worker'
      ? `<div class="addable" data-form="worker-add"><input data-f="name" data-required-field="workerId" placeholder="${COPY.uiApp160}" aria-label="${COPY.uiApp160}"><button data-action="add-worker">${COPY.uiApp148}</button><button data-action="cancel-add">${COPY.uiApp149}</button></div>`
      : `<div class="addable"><select data-field="workerId" data-required-field="workerId">${workerOptions(selectedId, isMixed)}</select><button class="add-button" data-action="begin-add" data-kind="worker">${ADD_LABEL}</button></div>`}</div>`;
  }

  // GUI Publish의 카테고리: 선택하고, 이름을 입력해 추가하거나 선택한 카테고리 이름을 바꾸고, 삭제한다.
  function categoryField(entry: Entry, draft: Draft, multi = false, selectedId = draft.categoryId ?? '', isMixed = false): string {
    const cats = [...state!.categories.values()].filter(c => c.active).sort((a, b) => a.order - b.order);
    const chosen = selectedId && state!.categories.get(selectedId)?.active ? selectedId : '';
    const selectedCategory = chosen ? state!.categories.get(chosen)! : null;
    const inUse = chosen ? [...state!.screens.values()].filter(s => s.categoryId === chosen && s.status === 'active').length : 0;
    const armed = chosen && deleteArmed === chosen;
    return `
      <div class="wide">${entry.categoryMissing ? `<p class="bad">${COPY.uiApp161}</p>` : ''}
      <label>${COPY.uiApp162}</label>${addMode === 'category' ? `<div class="addable"><input data-field="newCategory" data-required-field="categoryId" placeholder="${COPY.uiApp163}" aria-label="${COPY.uiApp163}"><button data-action="add-category">${COPY.uiApp148}</button><button data-action="cancel-add">${COPY.uiApp149}</button></div>`
        : editMode === 'category' && selectedCategory
          ? `<div class="addable" data-form="category-edit"><input data-field="editCategoryName" value="${esc(selectedCategory.name)}" aria-label="${COPY.uiApp162}"><button data-action="rename-category">${COPY.uiApp148}</button><button data-action="cancel-add">${COPY.uiApp149}</button><button class="category-delete" data-action="delete-category">${COPY.uiApp169}</button></div>${armed ? `<p class="bad" role="status">${COPY.uiApp211}${inUse ? ` ${COPY.uiApp167} ${inUse}${COPY.uiApp168}.` : ''}</p>` : ''}`
          : `<div class="addable"><select data-field="categoryId" data-required-field="categoryId">${isMixed ? mixedOption() : ''}${option('', COPY.uiApp164, !chosen && !isMixed)}${cats.map(c => option(c.id, c.name, c.id === chosen)).join('')}</select>${chosen && !multi ? `<button data-action="begin-edit" data-kind="category" aria-label="${COPY.uiApp174}">${COPY.uiApp173}</button>` : ''}<button class="add-button" data-action="begin-add" data-kind="category">${ADD_LABEL}</button></div>`}</div>`;
  }

  // 삭제된 카테고리도 이름을 보여 준다.
  function catName(id: string | null): string {
    return id ? state?.categories.get(id)?.name ?? '-' : COPY.uiApp170;
  }

  function renderToast() {
    const el = $('.toast');
    el.className = `toast${toast ? ' show ' + toast.kind : ''}`;
    el.textContent = toast?.text ?? '';
  }

  function renderAll() {
    renderTabs(); renderToolbar(); renderList(); renderDetail(); renderFooter(); renderConfirm(); renderVersion(); renderToast();
    const textShown = textOpen && mode === 'UI' && tab !== 'ADMIN' && !!state;
    flows.render(flowOpen && mode === 'UI' && tab !== 'ADMIN' && !!state);
    editor.render(textShown);
    if (textShown !== textTabSent) { textTabSent = textShown; bridge.send({ type: 'textTab', open: textShown }); }
    root.classList.toggle('admin-mode', tab === 'ADMIN');
    applyCollapse();
  }

  // 오른쪽 영역 접기: 창 너비를 목록 너비로 줄이고, 펼치면 접기 전 너비로 되돌린다. 설정 화면과 텍스트 편집 탭에서는 펼친 너비로 보여 준다.
  function applyCollapse() {
    const want = detailCollapsed && tab !== 'ADMIN' && team() === 'UI' && !textOpen && !flowOpen;
    if (want && !compactFrom) {
      const listWidth = $('.list').getBoundingClientRect().width;
      compactFrom = { width: root.offsetWidth };
      bridge.send({ type: 'resize', width: listWidth, height: root.offsetHeight, compact: true });
    } else if (!want && compactFrom) {
      bridge.send({ type: 'resize', width: compactFrom.width, height: root.offsetHeight });
      compactFrom = null;
    }
    root.classList.toggle('detail-collapsed', want);
  }

  // 입력 중에는 입력란을 다시 그리지 않아 포커스를 유지한다.
  function refreshAfterInput(fastList = false) {
    if (fastList && team() === 'GUI') { updateVisibleGuiNames(); deferListRebuild(); }
    else renderList();
    renderFooter(); renderValidation();
  }

  function notify(kind: 'info' | 'error', text: string) {
    toast = { kind, text };
    renderToast();
    const shown = toast;
    setTimeout(() => { if (toast === shown) { toast = null; renderToast(); } }, kind === 'error' ? 6000 : 3500);
  }

  // ── 조작 ─────────────────────────────────────────────

  function select(key: string, modifiers?: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
    const t = team();
    // 기존 플립북을 고르면 새 플립북 선택과 제목 입력을 닫는다.
    if (t === 'UI') { selectedNew = null; editingTitle = null; addingSection = false; renderFooter(); }
    if (modifiers?.shiftKey && anchor[t]) {
      const visible = listModel(t).groups.flatMap(g => g.rows.map(r => r.entry.key));
      const start = visible.indexOf(anchor[t]!);
      const end = visible.indexOf(key);
      if (start >= 0 && end >= 0) {
        if (!modifiers.ctrlKey && !modifiers.metaKey) selection[t].clear();
        for (const value of visible.slice(Math.min(start, end), Math.max(start, end) + 1)) selection[t].add(value);
      } else selection[t].add(key);
    } else if (modifiers?.ctrlKey || modifiers?.metaKey) {
      if (selection[t].has(key)) selection[t].delete(key); else selection[t].add(key);
      anchor[t] = key;
    } else {
      selection[t] = new Set([key]);
      anchor[t] = key;
    }
    const remaining = [...selection[t]];
    renderToolbar();
    selected[t] = selection[t].has(key) ? key : remaining[remaining.length - 1] ?? null;
    deleteArmed = null;
    removeAllArmed = false;
    tagArmed = null;
    addMode = null;
    editMode = null;
    const entry = current();
    if (entry && t === 'GUI') draftOf(t, entry);
    if (selected[t]) bridge.send({ type: 'selectFrames', nav: ++navSeq, team: t, entryKeys: selectedKeys(t), lastKey: selected[t]! });
    const historyId = t === 'GUI' ? entry?.screenId : entry?.flipbookId;
    if (selection[t].size === 1 && historyId) bridge.send({ type: 'history', team: t, id: historyId });
    if (t === 'GUI' && $('.list').dataset.team === 'GUI') paintGuiSelection(); else renderList();
    renderDetail();
  }

  // 행 선택만 캔버스를 이동한다. 포함 체크는 이동하지 않는다.
  function navigate(target: NavTarget, entryKey = selected[team()]) {
    if (!entryKey) return;
    bridge.send({ type: 'navigate', nav: ++navSeq, entryKey, target });
  }

  function toggleInclude(key: string, checked: boolean) {
    const t = team();
    const entry = entriesFor(t).find(e => e.key === key);
    if (!entry || entryLocked(t, entry)) return;
    setIncluded(t, entry, checked);
    if (t === 'GUI') renumberCodes();
    renderList(); renderFooter();
    if (selection[t].has(key)) renderDetail();
  }

  function includeVisible(keys: string[], checked: boolean) {
    const t = team();
    const byKey = new Map(entriesFor(t).map(e => [e.key, e]));
    for (const key of keys) { const entry = byKey.get(key); if (entry && !entryLocked(t, entry)) setIncluded(t, entry, checked); }
    if (t === 'GUI') renumberCodes();
    renderList(); renderFooter(); renderDetail();
  }

  // ── 교체 짝(2026-10-20 사용자 결정) ──
  // 신규 후보의 「기존 화면 교체」와 삭제 화면의 「다른 화면으로 교체」는 같은 짝이다. 어느 쪽에서 고르든 두 항목의
  // 포함 여부·등록 방식을 함께 바꾸고, 이전 화면에는 정보를 입력하지 않는다.
  const guiDraft = (key: string): Draft | null => {
    const entry = entries.find(e => e.key === key);
    return entry ? draftOf('GUI', entry) : drafts.GUI[key] ?? null;
  };
  const isMissing = (key: string) => entries.find(e => e.key === key)?.estimate === 'missing';
  const isSystemTag = (tagId: string | undefined) => !!tagId && !!state?.tags.get(tagId)?.system;
  // 기본 태그(추가·삭제)는 상태에 맞춰 바꾼다. 사용자가 고른 다른 태그는 그대로 둔다.
  function defaultTag(d: Draft, kind: SystemTag | null) {
    if (d.tagId && !isSystemTag(d.tagId)) return;
    d.tagId = kind && state ? systemTagId(state, kind) ?? undefined : undefined;
  }
  // 이전 화면 쪽을 짝에서 놓는다. 원본이 사라진 화면은 삭제로 돌린다.
  function releaseScreen(screenKey: string) {
    const d = guiDraft(screenKey);
    if (!d) return;
    d.replacedBy = undefined;
    d.included = false;
    if (isMissing(screenKey)) { d.retire = 'delete'; defaultTag(d, 'delete'); }
  }
  function unpairNew(newKey: string) {
    const n = guiDraft(newKey);
    if (!n?.replaceScreenId) return;
    if (guiDraft(n.replaceScreenId)?.replacedBy === newKey) releaseScreen(n.replaceScreenId);
    const entry = entries.find(e => e.key === newKey);
    if (entry && state) clearFill(state, entry, n, n.replaceScreenId);
    n.replaceScreenId = undefined;
  }
  function unpairScreen(screenKey: string) {
    const d = guiDraft(screenKey);
    if (!d?.replacedBy) return;
    const n = guiDraft(d.replacedBy);
    if (n?.replaceScreenId === screenKey) { n.replaceScreenId = undefined; n.included = false; }
    d.replacedBy = undefined;
  }
  function pair(newKey: string, screenKey: string) {
    const n = guiDraft(newKey), d = guiDraft(screenKey);
    if (!n || !d) return;
    if (n.replaceScreenId !== screenKey) unpairNew(newKey);
    if (d.replacedBy !== newKey) unpairScreen(screenKey);
    Object.assign(n, { included: true, notScreen: false, link: 'replace', replaceScreenId: screenKey });
    // 이전 화면의 Screen ID·카테고리를 채운다.
    if (state) fillFromScreen(state, n, screenKey);
    defaultTag(n, null);
    Object.assign(d, { included: true, notScreen: false, replacedBy: newKey });
    if (isMissing(screenKey)) d.retire = 'replace';
  }
  // 포함을 켜고 끈다. 짝이 있으면 두 항목을 함께 바꾼다. 자동으로 찾은 짝(잘라내 붙인 프레임)은 꺼도 기본값으로 남긴다.
  function setIncluded(t: Team, entry: Entry, checked: boolean) {
    const d = draftOf(t, entry);
    if (t !== 'GUI') { d.included = checked; return; }
    if (!entry.screenId) {
      if (checked && !d.notScreen && d.link === 'replace' && d.replaceScreenId && guiDraft(d.replaceScreenId)) { pair(entry.key, d.replaceScreenId); return; }
      d.included = checked;
      if (checked && d.link === 'new' && !d.notScreen) defaultTag(d, 'add');
      if (!checked && d.link === 'replace' && d.replaceScreenId) {
        const other = guiDraft(d.replaceScreenId);
        if (other?.replacedBy === entry.key) {
          other.included = false;
          if (entries.find(e => e.key === d.replaceScreenId)?.pairKey !== entry.key) releaseScreen(d.replaceScreenId);
        }
      }
      return;
    }
    if (checked && d.replacedBy && guiDraft(d.replacedBy) && (entry.estimate !== 'missing' || d.retire === 'replace')) { pair(d.replacedBy, entry.key); return; }
    d.included = checked;
    if (checked && isDeletion(entry, d)) defaultTag(d, 'delete');
    if (!checked && d.replacedBy) {
      const n = guiDraft(d.replacedBy);
      if (n?.replaceScreenId === entry.key) n.included = false;
      if (entry.pairKey !== d.replacedBy) { d.replacedBy = undefined; if (entry.estimate === 'missing') { d.retire = 'delete'; defaultTag(d, 'delete'); } }
    }
  }

  // 신규 화면의 Screen ID 자동 입력. 카테고리·케이스·포함을 바꿀 때마다 자동 입력한 ID를 캔버스 위치 순서대로 다시 매겨
  // 카테고리마다 번호가 비지 않게 한다. 직접 입력한 ID는 유지하고 그 번호는 건너뛴다.
  function renumberCodes() {
    if (!state) return;
    const s = state;
    const items = entries.filter(entry => drafts.GUI[entry.key]).map(entry => ({ entry, draft: drafts.GUI[entry.key] }));
    renumberAutoCodes(s, items);
  }

  // Prefix·카테고리 코드가 바뀌면 자동 입력한 ID만 새 규칙으로 다시 만든다. 직접 입력한 ID는 유지한다.
  function codeRules(s: State): string {
    return JSON.stringify([s.project.screenIdPrefix, ...[...s.categories.values()].map(c => [c.id, c.active, c.code ?? ''])]);
  }

  // 화면 선택 드롭다운에서 고른 값
  function pick(field: string, value: string) {
    const t = team();
    const entry = current();
    if (!entry || detailLocked(t)) return;
    if (field === 'replaceScreenId') pair(entry.key, value);
    else if (field === 'replaceWith') pair(value, entry.key);
    else if (field === 'baseScreenId') {
      for (const e of selectedEntries(t)) if (registersNew(t, e) || !!e.screenId && e.estimate !== 'missing') {
        const draft = draftOf(t, e);
        if (draft.relation !== 'case') continue;
        if (draft.baseScreenId === value && (draft.code || !registersNew(t, e))) continue;
        draft.baseScreenId = value;
      }
    }
    if (t === 'GUI') renumberCodes();
    renderDetail(); renderList(); renderFooter();
  }

  function admin(action: AdminOp) { bridge.send({ type: 'admin', action }); }

  // 라디오 묶음은 선택한 값을 읽는다.
  function formValue(el: HTMLElement, field: string): string {
    const form = el.closest('[data-form]')!;
    const input = (form.querySelector(`[data-f="${field}"]:checked`) ?? form.querySelector(`[data-f="${field}"]`)) as HTMLInputElement;
    return input.value;
  }

  root.addEventListener('click', ev => {
    const target = ev.target as HTMLElement;
    // 목록 행 안의 제목 입력을 누르면 행을 다시 고르지 않는다(다시 그리면 입력이 사라진다).
    if (target.closest('.list-box .title-input')) return;
    const el = target.closest('[data-action]') as HTMLElement | null;
    if (!el) return;
    const action = el.dataset.action!;
    if (busyLabel && !WHILE_BUSY.has(action)) return;
    if (action.startsWith('flow-') && flows.handle(action, el)) return;
    const t = team();
    if (locked(t) && !BEFORE_CHECK.has(action)) { ev.preventDefault(); return; }
    switch (action) {
      case 'tutorial':
        startTutorial({ mode, actor: actor ?? { id: '', name: '' }, root, startApp, resize: (width, height, compact) => bridge.send({ type: 'resize', width, height, compact }) });
        break;
      case 'settings':
        closeVersion(false);
        tab = tab === 'ADMIN' ? mode : 'ADMIN';
        addMode = null; editMode = null;
        renderAll();
        // 플러그인을 연 뒤 추가한 페이지(새 버전 페이지 등)도 고를 수 있게 페이지 목록을 다시 받는다.
        if (tab === 'ADMIN') bridge.send({ type: 'pages' });
        break;
      // 만들기 전 새 플립북은 설정을 다녀와도 남는다.
      case 'create-page-manage': tab = 'ADMIN'; adminOpen = COPY.uiApp107; renderAll(); break;
      case 'toggle-detail': detailCollapsed = !detailCollapsed; renderAll(); break;
      // 새 플립북은 오른쪽 영역에서 정하므로 접어 두었으면 펼친다.
      case 'new-add': detailCollapsed = false; if (addNew()) { revealSelection = true; renderList(); } applyCollapse(); break;
      case 'new-select': if (target.closest('button')) break; selectNew(el.dataset.key!); break;
      case 'new-remove': ev.stopPropagation(); removeNew(el.dataset.key!); break;
      // 새 플립북 행의 연필: 그 행에서 제목을 고친다. 고치는 중에 다시 누르면 닫는다(입력은 바로 반영되어 있다).
      case 'new-edit-title': {
        const key = el.dataset.key!;
        if (editingAt(key, 'list')) { editingTitle = null; renderList(); renderDetail(); break; }
        if (selectedNew !== key) selectNew(key);
        editTitle(key, 'list');
        break;
      }
      case 'new-section-add':
        addingSection = true;
        renderDetail();
        root.querySelector<HTMLInputElement>('[data-input="new-section-name"]')?.focus();
        break;
      case 'new-section-cancel': addingSection = false; renderDetail(); break;
      case 'new-section-confirm': {
        const n = currentNew();
        const input = root.querySelector<HTMLInputElement>('[data-input="new-section-name"]');
        const name = input?.value.trim() ?? '';
        if (!n || !name) { input?.focus(); break; }
        // 같은 페이지에 같은 이름의 Section이 있으면 그 Section을 쓴다.
        const same = sectionChoices(n.pageId).find(s => s.name.trim() === name);
        relocateNew(n, n.pageId, same ?? customSection(name));
        addingSection = false;
        revealSelection = true;
        renderList(); renderDetail();
        break;
      }
      case 'new-clear':
        if (newSubmitting) break;
        newDialog = 'cancel';
        renderNewDialog();
        break;
      case 'fb-edit-title': {
        const id = el.dataset.id!;
        const open = root.querySelector<HTMLInputElement>('.detail [data-input="fb-title"]');
        if (editingAt(id, 'detail') && open) { renameExisting(id, open.value); break; }
        editTitle(id, 'detail');
        break;
      }
      case 'create-category-toggle': {
        const key = el.dataset.key ?? '';
        if (createCollapsedCategories.has(key)) createCollapsedCategories.delete(key);
        else createCollapsedCategories.add(key);
        renderCreateScreenList(); break;
      }
      case 'create-uncreated-only': createUncreatedOnly = (el as HTMLInputElement).checked; renderCreateScreenList(); break;
      case 'create-screen-toggle': {
        const row = currentNew();
        if (!row) break;
        const uid = (el as HTMLInputElement).value;
        const before = newSection(row).key;
        row.uids = (el as HTMLInputElement).checked ? [...row.uids, uid] : row.uids.filter(value => value !== uid);
        createError = null;
        // 첫 화면이 바뀌어 화면 카테고리 Section(자동)이 바뀌면 그 Section 맨 뒤로 옮긴다.
        if (newSection(row).key !== before) relocateNew(row, row.pageId, row.section);
        else normalizeNew();
        revealSelection = true;
        renderDetail(); renderList(); renderFooter(); break;
      }
      case 'create-submit': submitNew(); break;
      case 'arrange-skip': submitNew(false); break;
      case 'arrange-apply': submitNew(true); break;
      case 'new-dialog-close': newDialog = null; renderNewDialog(); break;
      case 'new-cancel-confirm': finishNew(); renderList(); renderDetail(); renderFooter(); break;
      case 'bulk-open': {
        if (!state) break;
        if (!createScreens.length) bridge.send({ type: 'guiScreens' });
        const options = flipbookPageOptions();
        const pageId = currentNew()?.pageId ?? options.find(pg => pg.id === state!.project.flipbookPageId)?.id ?? options[0]?.id ?? '';
        const categories = new Set(bulkCandidates().map(screenCategoryKey));
        bulk = { pageId, categories, kind: 'all', query: '', excluded: new Set(), submitting: false, error: null };
        renderBulk();
        root.querySelector<HTMLElement>('.bulk-dialog select')?.focus();
        break;
      }
      case 'bulk-close': if (bulk?.submitting) break; bulk = null; renderBulk(); break;
      case 'bulk-submit': {
        if (!bulk || bulk.submitting) break;
        const targets = bulkTargets();
        if (!targets.length) break;
        if (!bulk.pageId || !state?.project.flipbookPageIds.includes(bulk.pageId)) { bulk.error = COPY.uiApp209; renderBulk(); break; }
        bulk.submitting = true; bulk.error = null;
        bridge.send({ type: 'createFlipbooks', request: { pageId: bulk.pageId, rows: targets.map(s => ({ uids: [s.uid], multi: false, scale: 1, title: '' })) } });
        renderBulkList(); break;
      }
      case 'scan': {
        if (checking(t)) break;
        cancelPending[t] = false;
        clearScanFinishTimer(t);
        scanStartedAt[t] = Date.now();
        const startedAt = scanStartedAt[t];
        updateScanStatus(t, { status: 'loading', done: 0, total: 0, checkedAt: null, partialAt: null });
        // 첫 프레임에 진행 표시가 실제로 그려진 다음 본체에 비교를 요청한다.
        // 한 번의 rAF 안에서 보내면 비교 작업이 페인트보다 먼저 시작될 수 있다.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (scanStartedAt[t] === startedAt && checking(t)) bridge.send({ type: t === 'UI' ? 'scanUi' : 'scan' });
          });
        });
        break;
      }
      case 'scan-selected': {
        if (checking(t) || !selection[t].size) break;
        cancelPending[t] = false;
        clearScanFinishTimer(t);
        scanStartedAt[t] = Date.now();
        const startedAt = scanStartedAt[t];
        const keys = selectedKeys(t);
        updateScanStatus(t, { ...check[t], status: 'loading', done: 0, total: 0 });
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (scanStartedAt[t] === startedAt && checking(t)) bridge.send({ type: 'scanSelected', team: t, entryKeys: keys });
          });
        });
        break;
      }
      case 'cancel-scan':
        cancelPending[t] = true;
        clearScanFinishTimer(t);
        scanStartedAt[t] = 0;
        updateScanStatus(t, { status: 'cancelled', done: 0, total: 0, checkedAt: null, partialAt: check[t].partialAt });
        bridge.send({ type: 'cancelScan', team: t });
        break;
      case 'changed-only': changedOnly[t] = (el as HTMLInputElement).checked; renderList(); break;
      case 'group': {
        const g = el.dataset.group!;
        if (expanded[t].has(g)) expanded[t].delete(g); else expanded[t].add(g);
        renderList();
        break;
      }
      case 'page-group': {
        const pageId = el.dataset.page ?? '';
        if (pageOpen(pageId)) { for (const key of [...expanded.UI]) if (pageOfGroup(key) === pageId) expanded.UI.delete(key); }
        else expanded.UI.add(`${pageId}|`);
        renderList();
        break;
      }
      case 'include': ev.stopPropagation(); toggleInclude(el.dataset.key!, (el as HTMLInputElement).checked); break;
      case 'include-all': {
        ev.stopPropagation();
        includeVisible(listModel(t).groups.flatMap(g => g.visibleRows.map(r => r.entry.key)), (el as HTMLInputElement).checked);
        break;
      }
      case 'include-group': {
        ev.stopPropagation();
        const group = listModel(t).groups.find(g => g.key === el.dataset.group);
        if (group) includeVisible(group.visibleRows.map(r => r.entry.key), (el as HTMLInputElement).checked);
        break;
      }
      case 'include-selected': includeVisible(selectedKeys(t), (el as HTMLInputElement).checked); break;
      case 'pick': pick(el.dataset.field!, el.dataset.value!); break;
      case 'mark-reviewed': {
        const requests = selectedEntries('UI').filter(e => !!e.flipbookId).map(e => {
          const d = draftOf('UI', e);
          return { flipbookId: e.flipbookId!, tagId: d.tagId ?? '', comment: d.description ?? '' };
        });
        if (requests.length && requests.every(r => r.tagId)) { bridge.send({ type: 'markReviewed', requests }); el.setAttribute('disabled', ''); }
        break;
      }
      case 'remove-flipbooks': {
        const ids = selectedEntries('UI').filter(e => e.estimate === 'missing').map(e => e.key);
        if (!ids.length) break;
        bridge.send({ type: 'removeFlipbooks', ids });
        el.setAttribute('disabled', '');
        break;
      }
      case 'resize-flipbooks': {
        const ids = state ? resizeTargets(selectedEntries('UI')) : [];
        if (ids.length) { bridge.send({ type: 'resizeFlipbooks', ids }); el.setAttribute('disabled', ''); }
        break;
      }
      case 'remove-all-unlinked': {
        const ids = uiEntries().filter(e => e.estimate === 'missing').map(e => e.key);
        if (!ids.length) break;
        if (!removeAllArmed) { removeAllArmed = true; renderList(); break; }
        removeAllArmed = false;
        bridge.send({ type: 'removeFlipbooks', ids });
        el.setAttribute('disabled', '');
        break;
      }
      case 'ignore-changes': bridge.send({ type: 'ignoreChanges', entryKeys: selectedKeys('GUI') }); break;
      case 'select': if (target.closest('input')) return; select(el.dataset.key!, ev); break;
      case 'nav': navigate(el.dataset.target as NavTarget); break;
      case 'nav-suggested': {
        const s = current()?.suggestedScreenId;
        if (s) navigate('source', s);
        break;
      }
      case 'rename-category': {
        const entry = current();
        const name = (root.querySelector('[data-field="editCategoryName"]') as HTMLInputElement).value.trim();
        const id = entry ? draftOf('GUI', entry).categoryId : undefined;
        if (id && name) { editMode = null; admin({ op: 'renameCategory', id, name }); }
        break;
      }
      case 'delete-category': {
        const entry = current();
        const id = entry ? draftOf('GUI', entry).categoryId : undefined;
        if (!id) break;
        if (deleteArmed !== id) { deleteArmed = id; renderDetail(); break; }
        deleteArmed = null;
        admin({ op: 'setCategoryActive', id, active: false });
        break;
      }
      case 'add-category': {
        const entry = current();
        const name = (root.querySelector('[data-field="newCategory"]') as HTMLInputElement).value.trim();
        if (!entry || !name || !state) break;
        // 이미 있으면 새로 만들지 않고 고른다.
        const found = findCategoryByName(state, name);
        if (found?.active) { for (const e of selectedEntries('GUI')) { const d = draftOf('GUI', e); d.categoryId = found.id; d.newCategoryName = undefined; } renumberCodes(); addMode = null; renderDetail(); refreshAfterInput(); break; }
        pendingCategory = { name, keys: selectedKeys('GUI') };
        admin({ op: 'addCategory', name });
        break;
      }
      case 'begin-add': addMode = el.dataset.kind as typeof addMode; editMode = null; renderDetail(); (root.querySelector('.detail .addable input') as HTMLInputElement | null)?.focus(); break;
      case 'begin-edit': editMode = el.dataset.kind as typeof editMode; addMode = null; renderDetail(); (root.querySelector('.detail .addable input') as HTMLInputElement | null)?.focus(); break;
      case 'cancel-add': addMode = null; editMode = null; renderDetail(); break;
      case 'add-worker': {
        const name = formValue(el, 'name').trim();
        if (!name) break;
        pendingWorker = { name, team: t, keys: selectedKeys(t) };
        admin({ op: 'addWorker', name, alias: '' });
        break;
      }
      case 'first-invalid': {
        const invalid = entriesFor(t).find(e => validation(t, e).status === 'invalid');
        if (invalid) {
          revealed[t].add(invalid.key);
          query[t] = '';
          changedOnly[t] = false;
          $('.list').dataset.team = '';
          for (const g of listModel(t).groups) expanded[t].add(g.key);
          renderToolbar();
          select(invalid.key);
        }
        break;
      }
      case 'prepare': {
        // 전체 확인 전에는 「비교 전」 화면의 입력은 보내지 않는다(배포 대상에서 빠진다).
        const byKey = new Map(entriesFor(t).map(e => [e.key, e]));
        const sendable = Object.fromEntries(Object.entries(drafts[t]).filter(([key]) => { const e = byKey.get(key); return !e || !entryLocked(t, e); }));
        bridge.send({ type: 'prepare', team: t, drafts: sendable, ...(t === 'GUI' ? { comment } : {}) });
        break;
      }
      case 'cancel-plan': if (plan) bridge.send({ type: 'cancelPlan', batchId: plan.batchId }); plan = null; renderConfirm(); break;
      case 'commit': if (plan) { bridge.send({ type: 'commit', batchId: plan.batchId }); el.setAttribute('disabled', ''); } break;
      case 'goto': plan = null; renderConfirm(); if (el.dataset.key) { for (const g of listModel(t).groups) expanded[t].add(g.key); select(el.dataset.key); renderList(); } break;
      case 'retry': bridge.send({ type: 'retry' }); break;
      case 'data-refresh': bridge.send({ type: 'refreshData' }); break;
      case 'reset-data':
        if (!resetArmed) { resetArmed = true; renderDetail(); break; }
        resetArmed = false;
        bridge.send({ type: 'resetData' });
        break;
      case 'reset-cancel': resetArmed = false; renderDetail(); break;
      case 'admin-renumber':
        if (!renumberArmed) { renumberArmed = true; renderDetail(); break; }
        renumberArmed = false;
        admin({ op: 'renumberScreenIds' });
        break;
      case 'renumber-cancel': renumberArmed = false; renderDetail(); break;
      case 'text-open': textOpen = true; flowOpen = false; renderAll(); root.querySelector<HTMLElement>('.text-view .rich-editor')?.focus(); break;
      case 'text-close': textOpen = false; flowOpen = false; renderAll(); break;
      case 'flow-open': flowOpen = true; textOpen = false; renderAll(); bridge.send({ type: 'guiScreens' }); break;
      case 'text-import': bridge.send({ type: 'textImport' }); break;
      case 'text-apply': { const paragraphs = editor.paragraphs(); if (paragraphs.some(p => p.text.trim())) bridge.send({ type: 'textApply', paragraphs }); break; }
      case 'version-open': openVersion(); break;
      case 'version-close': closeVersion(); break;
      case 'version-match':
        if (!versionPageId) break;
        versionArmed = false;
        // 캔버스의 프레임이 그사이 바뀌었을 수 있어 미리보기와 근거를 새로 받는다.
        clearNodePreviews();
        versionEvidence.clear();
        bridge.send({ type: 'matchVersion', pageId: versionPageId });
        break;
      case 'version-select':
        versionSelected = { kind: el.dataset.kind as 'screen' | 'frame', id: el.dataset.id! };
        paintVersionList();
        renderVersionDetail();
        break;
      case 'version-review-only':
        versionHideSame = (el as HTMLInputElement).checked;
        paintVersionList();
        break;
      case 'version-reveal':
        if (el.dataset.node) bridge.send({ type: 'revealNode', nav: ++navSeq, nodeId: el.dataset.node });
        break;
      case 'version-switch': {
        const match = currentVersionMatch();
        if (!match) break;
        if (!versionArmed) { versionArmed = true; renderVersionActions(); break; }
        versionArmed = false;
        bridge.send({ type: 'switchVersion', pageId: match.pageId, links: versionLinks(match) });
        break;
      }
      case 'version-cancel': versionArmed = false; renderVersionActions(); break;
      case 'admin-flipbook-page': {
        const pageId = formValue(el, 'page');
        if (pageId && pageId !== state?.project.flipbookPageId) admin({ op: 'setFlipbookPage', pageId });
        break;
      }
      case 'admin-template': admin({ op: 'setTemplateFromSelection' }); break;
      case 'admin-gui-width': {
        const width = Number(formValue(el, 'width'));
        if (width !== state?.project.guiWidth) admin({ op: 'setGuiWidth', width });
        break;
      }
      case 'admin-screen-prefix': {
        const prefix = formValue(el, 'prefix').trim();
        if (prefix !== state?.project.screenIdPrefix) admin({ op: 'setScreenIdPrefix', prefix });
        break;
      }
      case 'admin-cat-code': {
        const id = el.closest<HTMLElement>('[data-form]')!.dataset.id!;
        const code = formValue(el, 'code').trim();
        if (code !== state?.categories.get(id)?.code) admin({ op: 'setCategoryCode', id, code });
        break;
      }
      case 'admin-data-connect': {
        const pageId = formValue(el, 'page');
        if (pageId && pageId !== state?.project.dataPageId) admin({ op: 'setDataPage', pageId, reason: COPY.uiApp171 });
        break;
      }
      case 'admin-scope-remove': {
        const pageId = el.dataset.id;
        if (pageId && state?.project.scopePageIds.includes(pageId))
          admin({ op: 'setScope', pageIds: state.project.scopePageIds.filter(id => id !== pageId) });
        break;
      }
      case 'admin-ui-page-remove': {
        const pageId = el.dataset.id;
        if (pageId && state?.project.flipbookPageIds.includes(pageId))
          admin({ op: 'setFlipbookPages', pageIds: state.project.flipbookPageIds.filter(id => id !== pageId) });
        break;
      }
      case 'admin-wrk-add': admin({ op: 'addWorker', name: formValue(el, 'name'), alias: '' }); break;
      case 'admin-wrk-rename': {
        const id = el.closest<HTMLElement>('[data-form]')!.dataset.id!;
        admin({ op: 'renameWorker', id, name: formValue(el, 'name'), alias: state?.workers.get(id)?.alias ?? '' });
        break;
      }
      case 'admin-wrk-active': admin({ op: 'setWorkerActive', id: el.closest<HTMLElement>('[data-form]')!.dataset.id!, active: el.dataset.active === 'true' }); break;
      case 'tag-add': {
        const entry = current();
        const name = formValue(el, 'name').trim();
        if (!entry || !name || !state) break;
        // 같은 팀에 같은 이름이 이미 있으면 새로 만들지 않고 고른다.
        const found = [...state.tags.values()].find(x => x.team === t && x.active && x.name === name);
        if (found) { for (const e of selectedEntries(t)) draftOf(t, e).tagId = found.id; addMode = null; renderDetail(); refreshAfterInput(); break; }
        pendingTag = { name, team: t, keys: selectedKeys(t) };
        admin({ op: 'addTag', team: t, name, colorKey: formValue(el, 'color') });
        break;
      }
      case 'select-tag': {
        const tagId = el.dataset.id || undefined;
        for (const e of selectedEntries(t)) draftOf(t, e).tagId = tagId;
        tagArmed = null;
        renderDetail(); refreshAfterInput();
        break;
      }
      case 'tag-edit': {
        const entry = current();
        const id = entry ? draftOf(t, entry).tagId : undefined;
        const name = formValue(el, 'name').trim();
        if (id && name) { editMode = null; admin({ op: 'updateTag', id, name, colorKey: formValue(el, 'color') }); }
        break;
      }
      case 'tag-deactivate': {
        const entry = current();
        const id = entry ? draftOf(t, entry).tagId : undefined;
        if (!id) break;
        if (tagArmed !== id) { tagArmed = id; renderDetail(); break; }
        tagArmed = null;
        editMode = null;
        admin({ op: 'updateTag', id, active: false });
        break;
      }
      case 'tag-reactivate': admin({ op: 'updateTag', id: el.dataset.id!, active: true }); break;
      case 'admin-unexclude': admin({ op: 'unexclude', id: el.closest<HTMLElement>('[data-form]')!.dataset.id! }); break;
    }
  });

  let hoverThumb: { hash: string; x: number; y: number } | null = null;
  function showHoverThumb() {
    let box = root.querySelector<HTMLElement>('.thumb-hover');
    if (!hoverThumb) { box?.remove(); return; }
    const url = thumbUrls.get(hoverThumb.hash);
    if (!url) { box?.remove(); return; }
    if (!box) { box = document.createElement('div'); box.className = 'thumb-hover'; root.appendChild(box); }
    const hash = hoverThumb.hash;
    const rect = root.getBoundingClientRect();
    // 플로우 탭은 작은 카드 위에서 보므로 미리보기를 작게 띄운다(2026-10-23 사용자 요청).
    box.style.width = `${Math.min(root.classList.contains('flowing-mode') ? 160 : 240, rect.width - 16)}px`;
    const img = document.createElement('img');
    img.alt = '';
    img.style.maxHeight = `${Math.max(80, rect.height - 24)}px`;
    const position = () => {
      if (!hoverThumb || hoverThumb.hash !== hash || !box?.isConnected) return;
      const { width, height } = box.getBoundingClientRect();
      box.style.left = `${Math.max(8, Math.min(hoverThumb.x + 16, rect.width - width - 8))}px`;
      const below = hoverThumb.y + 12;
      const top = below + height > rect.height - 8 ? hoverThumb.y - height - 12 : below;
      box.style.top = `${Math.max(8, Math.min(top, rect.height - height - 8))}px`;
    };
    img.addEventListener('load', position, { once: true });
    img.src = url;
    box.replaceChildren(img);
    position();
  }
  root.addEventListener('mouseover', ev => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-thumb]');
    const hash = el?.dataset.thumb;
    if (!hash) { if (hoverThumb) { hoverThumb = null; showHoverThumb(); } return; }
    const r = root.getBoundingClientRect();
    hoverThumb = { hash, x: ev.clientX - r.left, y: ev.clientY - r.top };
    requestThumbs([hash]);
    showHoverThumb();
  });

  // 새 플립북: 화면을 우클릭하면 그 화면 하나로 된 새 플립북을 목록(화면 카테고리 Section 맨 뒤)에 추가한다.
  // 화면·제목이 비어 있는 새 플립북이 있으면 그 항목을 채운다. 현재 고른 항목은 그대로 둔다.
  root.addEventListener('contextmenu', ev => {
    const option = (ev.target as HTMLElement).closest<HTMLElement>('.new-flipbook-detail .create-screen-option');
    const uid = option?.querySelector<HTMLInputElement>('[data-action="create-screen-toggle"]')?.value;
    if (!uid) return;
    ev.preventDefault();
    if (busyLabel) return;
    if (addNew([uid], true)) renderCreateScreenList();
  });

  // 제목을 고치는 중에 연필을 누르면 입력에서 포커스가 빠지지 않게 한다. 확정·닫기는 연필의 클릭이 맡는다.
  root.addEventListener('mousedown', ev => {
    if (editingTitle && (ev.target as HTMLElement).closest('[data-action="fb-edit-title"], [data-action="new-edit-title"]')) ev.preventDefault();
  });

  // 플립북 이름을 더블클릭하면 그 자리(목록 행·오른쪽 영역)에서 제목을 고친다(2026-10-22 사용자 요청).
  // 연결이 끊긴 플립북과 여러 개를 고른 상세 제목에는 data-edit-title을 붙이지 않는다.
  root.addEventListener('dblclick', ev => {
    const name = (ev.target as HTMLElement).closest<HTMLElement>('[data-edit-title]');
    if (!name || busyLabel || newSubmitting) return;
    ev.preventDefault();
    window.getSelection()?.removeAllRanges();
    const id = name.dataset.editTitle!;
    if (isNewKey(id) && selectedNew !== id) selectNew(id);
    editTitle(id, name.closest('.list-box') ? 'list' : 'detail');
  });

  // 새 플립북 드래그로 옮기기: 행 위쪽 절반이면 그 행 앞, 아래쪽 절반이면 뒤, Section 라벨 행이면 그 Section 맨 앞에 놓는다.
  const clearDrop = () => { for (const node of root.querySelectorAll('.drop-before, .drop-after, .drop-into')) node.classList.remove('drop-before', 'drop-after', 'drop-into'); };
  const dropTarget = (ev: DragEvent): { node: HTMLElement; groupKey: string; to: { before?: string; after?: string; start?: boolean } } | null => {
    const node = (ev.target as HTMLElement).closest<HTMLElement>('.list-box .row[data-group], .list-box .section-label[data-group]');
    if (!node || !draggingNew) return null;
    const groupKey = node.dataset.group!;
    if (!arrangement().some(g => g.key === groupKey && placeable(g))) return null;
    if (node.classList.contains('section-label')) return { node, groupKey, to: { start: true } };
    const rect = node.getBoundingClientRect();
    const key = node.dataset.key!;
    return { node, groupKey, to: ev.clientY < rect.top + rect.height / 2 ? { before: key } : { after: key } };
  };
  root.addEventListener('dragstart', ev => {
    const row = (ev.target as HTMLElement).closest<HTMLElement>('.list-box .row[data-group][draggable="true"]');
    if (!row || busyLabel || newSubmitting) { if (row) ev.preventDefault(); return; }
    draggingNew = row.dataset.key!;
    ev.dataTransfer?.setData('text/plain', draggingNew);
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  root.addEventListener('dragover', ev => {
    const target = dropTarget(ev);
    clearDrop();
    if (!target) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    target.node.classList.add(target.to.start ? 'drop-into' : target.to.before ? 'drop-before' : 'drop-after');
  });
  root.addEventListener('drop', ev => {
    const target = dropTarget(ev);
    clearDrop();
    if (!target || !draggingNew) return;
    ev.preventDefault();
    const key = draggingNew;
    draggingNew = null;
    moveItem(key, target.groupKey, target.to);
    if (isNewKey(key)) selectNew(key); else { revealSelection = true; renderList(); }
    renderFooter();
  });
  root.addEventListener('dragend', () => {
    draggingNew = null;
    clearDrop();
    for (const node of root.querySelectorAll('.dragging')) node.classList.remove('dragging');
  });

  // 설정 아코디언: 하나를 열면 나머지를 접는다. toggle 이벤트는 버블링되지 않아 캡처로 받는다.
  root.addEventListener('toggle', ev => {
    const details = ev.target as HTMLDetailsElement;
    if (details.classList?.contains('prev-thumb')) {
      if (prevThumbOpen === details.open) return;
      prevThumbOpen = details.open;
      const entry = current();
      if (prevThumbOpen && entry) details.outerHTML = previousThumb(entry);
      return;
    }
    if (!details.classList?.contains('accordion') || !details.open) return;
    adminOpen = details.dataset.key ?? null;
    for (const other of root.querySelectorAll<HTMLDetailsElement>('details.accordion')) if (other !== details) other.open = false;
  }, true);

  root.addEventListener('keydown', ev => {
    const el = ev.target as HTMLElement;
    if (bulk && ev.key === 'Escape' && !bulk.submitting) { ev.preventDefault(); bulk = null; renderBulk(); return; }
    if (newDialog && ev.key === 'Escape') { ev.preventDefault(); newDialog = null; renderNewDialog(); return; }
    // 새 플립북 행: Enter·Space로 고르고, Alt+↑↓로 자리를 옮기며, Delete로 지운다.
    if (el.classList.contains('new-row')) {
      const key = el.dataset.key!;
      if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
        ev.preventDefault();
        if (newSubmitting) return;
        stepItem(key, ev.key === 'ArrowUp' ? -1 : 1);
        selectNew(key);
        renderFooter();
        root.querySelector<HTMLElement>(`.new-row[data-key="${CSS.escape(key)}"]`)?.focus();
      } else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectNew(key); }
      else if (ev.key === 'Delete' && !newSubmitting) { ev.preventDefault(); removeNew(key); }
      return;
    }
    // 기존 플립북 행: Alt+↑↓로 자리를 옮긴다. Enter·Space는 아래 공통 처리로 고른다.
    if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && el.matches('.list-box .row[data-group][draggable="true"]') && !isNewKey(el.dataset.key ?? '')) {
      ev.preventDefault();
      const key = el.dataset.key!;
      stepItem(key, ev.key === 'ArrowUp' ? -1 : 1);
      renderFooter();
      requestAnimationFrame(() => requestAnimationFrame(() => root.querySelector<HTMLElement>(`.list-box .row[data-key="${CSS.escape(key)}"]`)?.focus()));
      return;
    }
    // 제목 입력: Enter로 확정, Esc로 취소한다. 한글 조합 중의 Enter는 무시한다.
    if ((el.dataset.input === 'new-title' || el.dataset.input === 'fb-title') && !ev.isComposing && ev.keyCode !== 229) {
      if (ev.key === 'Enter' || ev.key === 'Escape') {
        ev.preventDefault();
        if (ev.key === 'Enter' && el.dataset.input === 'fb-title') { renameExisting(el.dataset.id!, (el as HTMLInputElement).value); return; }
        // 오른쪽 새 플립북 제목은 늘 입력란이므로 포커스만 뺀다.
        if (!el.closest('.list-box') && el.dataset.input === 'new-title') el.blur();
        else editingTitle = null;
        renderDetail(); renderList();
      }
      return;
    }
    if (el.dataset.input === 'new-section-name' && ev.key === 'Escape') { ev.preventDefault(); addingSection = false; renderDetail(); return; }
    if (el.classList.contains('version-row')) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); el.click(); }
      else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); moveVersionSelection(el, ev.key === 'ArrowDown' ? 1 : -1); }
      return;
    }
    if ((ev.key === 'Enter' || ev.key === ' ') && el.classList.contains('row')) { ev.preventDefault(); select(el.dataset.key!, ev); return; }
    // 드롭다운의 새 항목 추가·이름 변경 입력란에서 Enter는 확인 버튼을 누른 것과 같다. 한글 조합 중의 Enter는 무시한다.
    if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229 && el.tagName === 'INPUT' && el.parentElement?.classList.contains('addable')) {
      const confirm = el.parentElement.querySelector<HTMLButtonElement>(':scope > button:not([data-action="cancel-add"]):not(.link)');
      if (confirm && !confirm.disabled) { ev.preventDefault(); confirm.click(); }
    }
  });

  root.addEventListener('input', ev => {
    const el = ev.target as HTMLInputElement;
    if (bulk && el.dataset.input?.startsWith('bulk-')) {
      if (bulk.submitting) return;
      switch (el.dataset.input) {
        case 'bulk-page': bulk.pageId = el.value; break;
        case 'bulk-query': bulk.query = el.value; break;
        case 'bulk-kind': bulk.kind = el.value as ScreenKind; break;
        case 'bulk-category': if (el.checked) bulk.categories.add(el.value); else bulk.categories.delete(el.value); break;
        case 'bulk-category-all':
          bulk.categories = new Set(el.checked ? bulkCandidates().map(screenCategoryKey) : []);
          for (const box of root.querySelectorAll<HTMLInputElement>('[data-input="bulk-category"]')) box.checked = el.checked;
          break;
        case 'bulk-screen': if (el.checked) bulk.excluded.delete(el.value); else bulk.excluded.add(el.value); break;
        case 'bulk-screen-all':
          for (const s of filterScreens(bulkCandidates(), bulk)) if (el.checked) bulk.excluded.delete(s.uid); else bulk.excluded.add(s.uid);
          break;
      }
      renderBulkList();
      return;
    }
    if (el.dataset.input === 'new-title') {
      const n = newFlipbooks.find(x => x.key === el.dataset.key);
      if (n) {
        n.title = el.value;
        // 목록에서 고치면 오른쪽 제목 입력을, 오른쪽에서 고치면 목록 행 이름을 맞춘다.
        if (el.closest('.list-box')) {
          const field = root.querySelector<HTMLInputElement>(`.detail [data-input="new-title"][data-key="${CSS.escape(n.key)}"]`);
          if (field) field.value = newTitle(n);
        } else {
          const name = [...root.querySelectorAll<HTMLElement>('.list-box .new-row')].find(row => row.dataset.key === n.key)?.querySelector<HTMLElement>('.name');
          if (name) name.textContent = newTitle(n);
          deferListRebuild();
        }
      }
      return;
    }
    if (el.dataset.input === 'new-page') {
      const n = currentNew();
      // 다른 페이지로 옮기면 그 페이지의 화면 카테고리 Section 맨 뒤에 놓는다.
      if (n && el.value && el.value !== n.pageId) { relocateNew(n, el.value, null); revealSelection = true; renderList(); renderDetail(); }
      return;
    }
    if (el.dataset.input === 'new-section') {
      const n = currentNew();
      if (!n) return;
      const chosen = el.value ? sectionChoices(n.pageId).find(s => s.key === el.value) ?? null : null;
      if ((chosen?.key ?? null) !== (n.section?.key ?? null)) { relocateNew(n, n.pageId, chosen); revealSelection = true; renderList(); renderDetail(); }
      return;
    }
    if (el.dataset.input === 'create-query') { createQuery = el.value; renderCreateScreenList(); return; }
    if (el.dataset.input === 'version-query') { versionQuery = el.value; paintVersionList(); return; }
    if (el.dataset.input === 'admin-gui-width') {
      const sizes = el.closest('[data-form]')?.querySelector('.gui-width-sizes');
      if (sizes) sizes.textContent = guiWidthSizes(Number(el.value));
      return;
    }
    if (el.dataset.input === 'create-bulk-scale') {
      const r = newFlipbooks.find(x => x.key === el.dataset.key);
      if (r) { r.scale = Number(el.value) as FlipbookScale; for (const uid of r.uids) r.scales[uid] = r.scale; renderCreateScreenList(); }
      return;
    }
    if (el.dataset.input === 'create-screen-scale') {
      const r = newFlipbooks.find(x => x.key === el.dataset.key);
      if (r && el.dataset.uid) {
        r.scales[el.dataset.uid] = Number(el.value) as FlipbookScale;
        const values = r.uids.map(uid => r.scales[uid] ?? r.scale);
        const bulk = root.querySelector<HTMLSelectElement>('[data-input="create-bulk-scale"]');
        if (bulk) bulk.innerHTML = scaleOptions(values.every(value => value === values[0]) ? values[0] : null);
      }
      return;
    }
    if (el.dataset.input === 'comment') { comment = { ...comment, description: el.value }; return; }
    if (el.dataset.requiredField && (el.dataset.field === 'newCategory' || el.closest('[data-form="worker-add"], [data-form="tag-add"]'))) { renderFieldErrors(); return; }
    const t = team();
    if (el.dataset.input === 'query') { query[t] = el.value; renderList(); return; }
    const entry = current();
    if (!entry || detailLocked(t)) return;
    const draft = draftOf(t, entry);
    if (el.dataset.extra) {
      for (const selectedEntry of selectedEntries(t)) {
        const targetDraft = draftOf(t, selectedEntry);
        targetDraft.extra = { ...targetDraft.extra, [el.dataset.extra]: el.value };
      }
      refreshAfterInput(); return;
    }
    const field = el.dataset.field;
    if (field === 'description') { for (const selectedEntry of selectedEntries(t)) draftOf(t, selectedEntry).description = el.value; refreshAfterInput(); }
    else if (field === 'name') { for (const selectedEntry of selectedEntries(t)) draftOf(t, selectedEntry).name = el.value; refreshAfterInput(true); }
    else if (field === 'code') { draft.code = el.value; refreshAfterInput(true); }
    else if (field === 'excludeReason') { for (const selectedEntry of selectedEntries(t)) draftOf(t, selectedEntry).excludeReason = el.value; refreshAfterInput(); }
  });

  // 오른쪽 새 플립북 제목: 자동 제목이 채워져 있으면 눌렀을 때 전체를 골라 바로 새로 입력하게 한다.
  root.addEventListener('focusin', ev => {
    const el = ev.target as HTMLInputElement;
    if (el.dataset.input !== 'new-title' || el.closest('.list-box')) return;
    const n = newFlipbooks.find(x => x.key === el.dataset.key);
    if (n && !n.title.trim()) setTimeout(() => { if (document.activeElement === el) el.select(); }, 0);
  });

  root.addEventListener('focusout', ev => {
    const control = ev.target as HTMLElement;
    // 제목 입력에서 벗어나면 확정한다. 새 플립북 제목은 입력할 때마다 반영되어 있다.
    if (control.dataset.input === 'new-title' || control.dataset.input === 'fb-title') {
      const id = control.dataset.input === 'fb-title' ? control.dataset.id! : control.dataset.key!;
      const value = (control as HTMLInputElement).value;
      setTimeout(() => {
        if (editingTitle !== id || root.querySelector(`[data-input="${control.dataset.input}"]:focus`)) return;
        if (control.dataset.input === 'fb-title') renameExisting(id, value);
        else { editingTitle = null; renderDetail(); renderList(); }
      }, 0);
      return;
    }
    const field = control.dataset.requiredField;
    if (!field || !control.closest('.detail') || tab === 'ADMIN') return;
    const picker = control.closest('details');
    if (picker && ev.relatedTarget instanceof Node && picker.contains(ev.relatedTarget)) return;
    touchField(team(), field);
  });

  root.addEventListener('change', ev => {
    const el = ev.target as HTMLInputElement | HTMLSelectElement;
    if (el.dataset.input === 'version-page') { versionPageId = el.value; versionArmed = false; renderVersion(); return; }
    if (el.dataset.input === 'version-link' && el.dataset.screen) {
      versionChoice.set(el.dataset.screen, el.value);
      versionLinkChanged('version-link');
      return;
    }
    // 연결되지 않은 새 프레임에 화면을 고르면 그 화면의 연결을 이 프레임으로 바꾸고 그 화면을 보여 준다.
    if (el.dataset.input === 'version-frame-link' && el.dataset.node && el.value) {
      versionChoice.set(el.value, el.dataset.node);
      versionSelected = { kind: 'screen', id: el.value };
      versionLinkChanged();
      return;
    }
    // GUI 원본 범위: 드롭다운에서 페이지를 고르면 바로 추가한다(따로 추가 버튼 없음).
    if (el.dataset.f === 'page' && el.closest('[data-form="scope"]')) {
      const pageId = el.value;
      if (pageId && state && pages.some(p => p.id === pageId && p.id !== state!.project.dataPageId) && !state.project.scopePageIds.includes(pageId))
        admin({ op: 'setScope', pageIds: [...state.project.scopePageIds, pageId] });
      return;
    }
    if (el.dataset.f === 'page' && el.closest('[data-form="flipbook"]')) {
      const pageId = el.value;
      if (pageId && state && pages.some(p => p.id === pageId && p.id !== state!.project.dataPageId) && !state.project.flipbookPageIds.includes(pageId))
        admin({ op: 'setFlipbookPages', pageIds: [...state.project.flipbookPageIds, pageId] });
      return;
    }
    const field = el.dataset.field;
    const entry = current();
    if (!field || !entry || !state) return;
    const t = team();
    if (detailLocked(t)) return;
    const draft = draftOf(t, entry);
    switch (field) {
      case 'disposition': {
        for (const selectedEntry of selectedEntries(t)) {
          const target = draftOf(t, selectedEntry);
          // 배포한 화면: 화면 수정 또는 화면이 아님
          if (!needsLink(selectedEntry)) {
            if (selectedEntry.frame) target.notScreen = el.value === 'not-screen';
            continue;
          }
          if (el.value === 'replace') {
            target.link = 'replace';
            target.notScreen = false;
            defaultTag(target, null);
            if (target.replaceScreenId) pair(selectedEntry.key, target.replaceScreenId);
            continue;
          }
          unpairNew(selectedEntry.key);
          target.notScreen = el.value === 'not-screen';
          if (!target.notScreen) { target.link = 'new'; defaultTag(target, 'add'); }
        }
        break;
      }
      case 'retire': {
        for (const selectedEntry of selectedEntries(t)) {
          if (selectedEntry.estimate !== 'missing') continue;
          const target = draftOf(t, selectedEntry);
          if (el.value === 'replace') {
            target.retire = 'replace';
            defaultTag(target, null);
            if (target.replacedBy) pair(target.replacedBy, selectedEntry.key);
            continue;
          }
          unpairScreen(selectedEntry.key);
          target.retire = 'delete';
          defaultTag(target, 'delete');
        }
        break;
      }
      case 'workerId': for (const e of selectedEntries(t)) draftOf(t, e).workerId = el.value || undefined; if (el.value) recentWorker[t] = el.value; touchField(t, field); refreshAfterInput(); return;
      case 'tagId': for (const e of selectedEntries(t)) draftOf(t, e).tagId = el.value || undefined; refreshAfterInput(); return;
      case 'categoryId': {
        for (const e of selectedEntries(t)) {
          const d = draftOf(t, e);
          d.categoryId = el.value || undefined;
          d.newCategoryName = undefined;
          const name = d.categoryId ? state.categories.get(d.categoryId)?.name : null;
          if (e.categoryMissing && name && !d.description?.trim()) d.description = `${COPY.uiApp172} ${name}`;
        }
        deleteArmed = null;
        touchField(t, field);
        break;
      }
      case 'relation': for (const e of selectedEntries(t)) if (registersNew(t, e) || !!e.screenId && e.estimate !== 'missing') {
        draftOf(t, e).relation = el.value as Draft['relation'];
      } break;
      default: return;
    }
    if (t === 'GUI') renumberCodes();
    renderDetail(); renderList(); renderFooter();
  });

  // ── 수신 ─────────────────────────────────────────────

  bridge.listen(msg => {
    switch (msg.type) {
      case 'init':
        state = fromWire(msg.state); actor = msg.actor; pages = msg.pages; issues = msg.issues;
        if (mode !== msg.mode || tab !== 'ADMIN') { mode = msg.mode; tab = mode; }
        comment = emptyComment();
        // 초기화 뒤에도 init이 다시 온다. 입력 초안·선택·확인 상태를 비운다.
        for (const t of ['GUI', 'UI'] as Team[]) {
          clearScanFinishTimer(t);
          scanStartedAt[t] = 0;
          cancelPending[t] = false;
          drafts[t] = {};
          touched[t] = {};
          revealed[t].clear();
          selected[t] = null;
          selection[t].clear();
          anchor[t] = null;
          check[t] = idleCheck();
        }
        uiScans = new Map();
        plan = null;
        history = null;
        resetArmed = false;
        renumberArmed = false;
        versionMatch = null;
        versionChoice = new Map();
        versionArmed = false;
        versionSelected = null;
        versionEvidence.clear();
        newSubmitting = false;
        finishNew();
        // 새 플립북의 화면 선택·일괄 만들기에 쓰는 GUI 배포 화면 목록
        if (mode === 'UI') bridge.send({ type: 'guiScreens' });
        // 본체가 응답했으므로 첫 로딩 표시를 닫는다. 비교는 변경사항 확인을 눌러야 시작한다.
        busyLabel = null;
        renderBusy();
        renderAll();
        break;
      case 'state': {
        const previousActiveWorkers = state ? [...state.workers.values()].filter(worker => worker.active).length : 0;
        const previousRules = state ? codeRules(state) : '';
        state = fromWire(msg.state);
        if (previousRules && previousRules !== codeRules(state)) renumberCodes();
        pages = msg.pages;
        for (const key of selection.UI) if (state.flipbooks.get(key)?.status !== 'active') selection.UI.delete(key);
        if (selected.UI && !selection.UI.has(selected.UI)) selected.UI = [...selection.UI][0] ?? null;
        const activeWorkers = [...state.workers.values()].filter(worker => worker.active);
        if (previousActiveWorkers !== 1 && activeWorkers.length === 1) {
          for (const teamDrafts of Object.values(drafts))
            for (const draft of Object.values(teamDrafts)) if (!draft.workerId) draft.workerId = activeWorkers[0].id;
        }
        if (pendingTag) {
          const { name, team: tagTeam, keys } = pendingTag;
          const found = [...state.tags.values()].find(x => x.team === tagTeam && x.active && x.name === name);
          if (found) for (const entry of entriesFor(tagTeam).filter(e => keys.includes(e.key))) draftOf(tagTeam, entry).tagId = found.id;
          pendingTag = null;
          if (found) addMode = null;
        }
        if (pendingCategory) {
          const found = findCategoryByName(state, pendingCategory.name);
          if (found) for (const entry of entries.filter(e => pendingCategory!.keys.includes(e.key))) { const draft = draftOf('GUI', entry); draft.categoryId = found.id; draft.newCategoryName = undefined; }
          if (found) renumberCodes();
          pendingCategory = null;
          if (found) addMode = null;
        }
        if (pendingWorker) {
          const { name, team: workerTeam, keys } = pendingWorker;
          const found = [...state.workers.values()].find(w => w.active && w.name === name && !w.alias);
          if (found) for (const entry of entriesFor(workerTeam).filter(e => keys.includes(e.key))) draftOf(workerTeam, entry).workerId = found.id;
          pendingWorker = null;
          if (found) addMode = null;
        }
        if (tab !== 'ADMIN') { renderList(); renderFooter(); }
        renderDetailKeepingFocus();
        break;
      }
      case 'entries': {
        // 선택한 행의 변경 추정이 바뀌면 입력란 머리의 배지도 다시 그린다.
        const before = entries.find(e => e.key === selected.GUI)?.estimate;
        entries = msg.entries;
        const estimateChanged = tab === 'GUI' && before !== entries.find(e => e.key === selected.GUI)?.estimate;
        for (const e of entries) {
          if (!e.categoryMissing || !state) continue;
          const d = draftOf('GUI', e);
          if (d.categoryId && !state.categories.get(d.categoryId)?.active) d.categoryId = undefined;
        }
        // 다시 읽은 목록과 배포된 화면 기준으로 자동 입력한 ID를 맞춘다.
        renumberCodes();
        // 신규 등록으로 항목 키가 바뀌면 선택을 풀고 남은 입력란을 지운다.
        let cleared = false;
        for (const t of ['GUI', 'UI'] as Team[]) {
          for (const key of selection[t]) if (!entriesFor(t).some(e => e.key === key)) { selection[t].delete(key); cleared = true; }
          if (selected[t] && !selection[t].has(selected[t]!)) selected[t] = [...selection[t]][0] ?? null;
        }
        if (tab !== 'ADMIN') { renderList(); renderFooter(); if (cleared) renderDetail(); else if (estimateChanged) renderDetailKeepingFocus(); else renderValidation(); }
        break;
      }
      case 'uiScan': {
        const previousScans = uiScans;
        const previousEstimate = selected.UI && state ? uiEstimate(state, selected.UI, previousScans.get(selected.UI)) : null;
        uiScans = new Map(msg.scans.map(s => [s.flipbookId, s]));
        if (state) for (const scan of msg.scans) {
          const draft = drafts.UI[scan.flipbookId];
          if (draft?.included && !scan.nodeId && uiEstimate(state, scan.flipbookId, previousScans.get(scan.flipbookId)) !== 'missing') draft.included = false;
        }
        if (tab === 'UI') {
          renderList(); renderFooter();
          if (selected.UI && state && previousEstimate !== uiEstimate(state, selected.UI, uiScans.get(selected.UI))) renderDetailKeepingFocus();
          else renderValidation();
        }
        break;
      }
      case 'scanStatus': {
        const t = msg.team;
        // 취소 클릭 직전에 본체가 보낸 오래된 진행 메시지가 버튼과 상태를 되살리지 않게 한다.
        if (cancelPending[t] && msg.status !== 'cancelled') break;
        if (msg.status === 'cancelled') cancelPending[t] = false;
        if (msg.status === 'loading' && !scanStartedAt[t]) scanStartedAt[t] = Date.now();
        if (msg.status === 'done') {
          const elapsed = scanStartedAt[t] ? Date.now() - scanStartedAt[t] : MIN_SCAN_VISIBLE_MS;
          const remaining = Math.max(0, MIN_SCAN_VISIBLE_MS - elapsed);
          if (remaining) {
            updateScanStatus(t, { status: 'comparing', done: msg.done, total: msg.total, checkedAt: null, partialAt: null });
            clearScanFinishTimer(t);
            scanFinishTimer[t] = setTimeout(() => {
              scanFinishTimer[t] = null;
              scanStartedAt[t] = 0;
              updateScanStatus(t, { status: 'done', done: msg.done, total: msg.total, checkedAt: msg.checkedAt, partialAt: msg.partialAt });
            }, remaining);
            break;
          }
        }
        if (msg.status === 'cancelled' || msg.status === 'failed' || msg.status === 'idle' || msg.status === 'done') {
          clearScanFinishTimer(t);
          scanStartedAt[t] = 0;
        }
        updateScanStatus(t, { status: msg.status, done: msg.done, total: msg.total, checkedAt: msg.checkedAt, partialAt: msg.partialAt });
        break;
      }
      case 'nav':
        if (msg.nav === navSeq && (!msg.ok || msg.message)) notify(msg.ok ? 'info' : 'error', msg.message);
        break;
      case 'canvasSelection': {
        if (!msg.entryKeys.length || !state) break;
        tab = msg.team;
        if (msg.team === 'UI') { selectedNew = null; editingTitle = null; addingSection = false; }
        selection[msg.team] = new Set(msg.entryKeys);
        selected[msg.team] = msg.lastKey;
        anchor[msg.team] = msg.lastKey;
        let selectionModel = listModel(msg.team);
        const shown = new Set(selectionModel.groups.flatMap(group => group.visibleRows.map(row => row.entry.key)));
        if (msg.entryKeys.some(key => !shown.has(key))) {
          query[msg.team] = '';
          changedOnly[msg.team] = false;
          selectionModel = listModel(msg.team);
        }
        for (const group of selectionModel.groups)
          if (group.visibleRows.some(row => selection[msg.team].has(row.entry.key))) expanded[msg.team].add(group.key);
        addMode = null;
        editMode = null;
        renderTabs(); renderToolbar(); renderList(); renderDetail(); renderFooter();
        break;
      }
      case 'plan': plan = msg.plan; renderConfirm(); break;
      case 'committed':
        if (msg.ok && mode === 'GUI') { comment = emptyComment(); renderFooter(); }
        if (msg.ok) {
          // 확정한 화면의 입력만 지운다. 확정하지 못한 화면은 입력을 남겨 다시 Publish할 수 있게 한다.
          const t = plan?.team ?? team();
          for (const entryKey of msg.committed) {
            delete drafts[t][entryKey];
            delete touched[t][entryKey];
            revealed[t].delete(entryKey);
          }
          plan = null;
          renderConfirm();
          notify(msg.conflicts.length ? 'error' : 'info', msg.message);
        } else if (plan) {
          plan = { ...plan, blockers: msg.conflicts };
          renderConfirm();
          notify('error', msg.message);
        }
        break;
      case 'history': history = { id: msg.id, rows: msg.rows }; renderHistory(); break;
      case 'guiScreens':
        createScreens = msg.screens;
        flows.setScreens(createScreens);
        // 화면 목록을 받기 전에 연 일괄 만들기는 카테고리를 모두 고른 상태로 채운다.
        if (bulk && !bulk.submitting && !bulk.categories.size) bulk.categories = new Set(bulkCandidates().map(screenCategoryKey));
        renderBulk();
        if (tab === 'UI') { renderList(); if (currentNew()) renderDetail(); }
        break;
      case 'reviewed':
        // 확인 완료한 플립북은 상태를 기본 「최신」으로, 코멘트를 빈 값으로 돌린다.
        for (const id of msg.ids) delete drafts.UI[id];
        // 상태·코멘트가 이력 한 줄로 남았으므로 열어 둔 이력을 다시 받는다.
        if (selection.UI.size === 1 && selected.UI && msg.ids.includes(selected.UI)) bridge.send({ type: 'history', team: 'UI', id: selected.UI });
        notify('info', msg.message);
        if (tab === 'UI') renderDetail();
        break;
      case 'templateIssues': templateIssues = msg.issues; renderToolbar(); break;
      case 'pages':
        if (pages.length === msg.pages.length && pages.every((p, i) => p.id === msg.pages[i].id && p.name === msg.pages[i].name)) break;
        pages = msg.pages;
        if (tab === 'ADMIN') renderDetail();
        else if (versionOpen) renderVersion();
        break;
      case 'versionMatch':
        versionMatch = msg.match;
        versionChoice = new Map();
        versionArmed = false;
        versionEvidence.clear();
        if (msg.match) { versionPageId = msg.match.pageId; selectFirstVersionItem(msg.match); }
        renderVersion();
        break;
      // 전환한 결과(변경사항 없음·변경 감지·신규·삭제 후보)를 바로 보도록 GUI 목록으로 돌아간다.
      case 'versionSwitched':
        clearNodePreviews();
        closeVersion();
        break;
      case 'versionDetail':
        if (msg.pageId !== versionPageId) break;
        versionEvidence.set(`${msg.screenId}|${msg.nodeId}`, msg.evidence);
        if (versionSelected?.kind === 'screen' && versionSelected.id === msg.screenId) renderVersionDetail();
        break;
      case 'framePreviews':
        for (const item of msg.items) {
          const key = NODE_PREVIEW + item.nodeId;
          if (item.bytes) thumbUrls.set(key, URL.createObjectURL(new Blob([new Uint8Array(item.bytes)], { type: 'image/png' })));
          else { thumbUrls.set(key, ''); failedPreviews.add(key); }
        }
        if (versionOpen) renderVersionDetail();
        showHoverThumb();
        break;
      case 'flipbooksRemoved':
        removeAllArmed = false;
        for (const id of msg.ids) delete drafts.UI[id];
        notify('info', msg.message);
        if (tab === 'UI') { renderList(); renderDetail(); }
        break;
      case 'flipbooksCreated':
        // 일괄 만들기는 목록의 새 플립북(만들기 전)을 그대로 둔다.
        if (bulk?.submitting) { bulk = null; renderBulk(); }
        else if (newSubmitting) { newSubmitting = false; finishNew(); }
        // 만든 플립북이 보이도록 필터를 풀고 그 Section을 펼친다.
        if (state) for (const id of [...msg.ids, ...(msg.moved ?? [])]) {
          const fb = state.flipbooks.get(id);
          if (fb) expanded.UI.add(`${fb.pageId ?? state.project.flipbookPageId ?? ''}|${fb.category.key}`);
        }
        changedOnly.UI = false;
        bridge.send({ type: 'guiScreens' });
        notify('info', msg.message);
        renderList(); renderDetail(); renderFooter();
        break;
      case 'thumbnails':
        for (const item of msg.items) {
          if (item.bytes) thumbUrls.set(item.hash, URL.createObjectURL(new Blob([new Uint8Array(item.bytes)], { type: 'image/jpeg' })));
          else { thumbUrls.set(item.hash, ''); failedPreviews.add(item.hash); }
        }
        // 플립북 만들기 창은 마우스를 올린 미리보기만 쓰므로 다시 그리지 않는다(열린 화면 선택이 닫히지 않게).
        if (versionOpen) renderVersionDetail();
        else if (!currentNew() && tab !== 'ADMIN') renderDetailKeepingFocus();
        showHoverThumb();
        break;
      case 'textImported': editor.setParagraphs(msg.paragraphs); break;
      case 'textTarget': editor.setTarget(msg.target); break;
      case 'notice': notify('info', msg.message); break;
      case 'busy': busyLabel = msg.label; renderBusy(); break;
      case 'error':
        pendingCategory = null; pendingTag = null; pendingWorker = null;
        if (bulk?.submitting) { bulk.submitting = false; bulk.error = msg.message; renderBulk(); }
        else if (newSubmitting) { newSubmitting = false; createError = msg.message; renderFooter(); }
        notify('error', msg.message);
        break;
    }
  });

  // 처리 중인 작업(Publish·저장 등). 변경사항 확인은 탭 맨 위에 진행과 취소를 따로 보여 주며 조작을 막지 않는다.
  function renderBusy() {
    const label = busyLabel;
    const el = $('.busy');
    el.hidden = !label;
    (el.querySelector('.busy-label') as HTMLElement).textContent = label ?? '';
    root.classList.toggle('is-busy', !!busyLabel);
    root.setAttribute('aria-busy', String(!!label));
  }

  // 작업자 추가처럼 상태가 바뀌어도 입력 중인 칸의 포커스를 되살린다.
  function renderDetailKeepingFocus() {
    const active = document.activeElement as HTMLElement | null;
    const field = active?.dataset.field;
    renderDetail();
    if (field) (root.querySelector(`[data-field="${field}"]`) as HTMLElement | null)?.focus();
  }

  renderBusy();
  bridge.send({ type: 'ready' });
}
