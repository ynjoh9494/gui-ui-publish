import { TemplateMigrationDialog } from './templateMigration.ts';
import { FlowRepairDialog } from './flowRepair.ts';
import { FLOW_REPAIR_COPY } from '../core/flowRepairCopy.ts';
import { TEMPLATE_MIGRATION_COPY } from '../core/templateMigrationCopy.ts';
import { flipbookIdentity, unsavedPolicyIds, withFlipbookId } from '../core/flipbookIdentity.ts';
import { windowCollapse } from './windowCollapse.ts';
import { headerTab } from './headerTab.ts';
import { COPY } from '../core/copy.ts';
import { changeDetected, entryName, ignoreBlock, uiEntries as buildUiEntries, uiEstimate, type Entry, type UiScan } from '../core/compare.ts';
import type { GuiScreenInfo } from '../core/guiScreens.ts';
import { pickerFrameEntries, pickerRegisteredScreens } from '../core/guiPicker.ts';
import { guiStateBadge, unlinkedBadge, unlinkedGroupBadge } from './estimate.ts';
import { placeBubble } from './bubblePosition.ts';
import { needsUpdate, type UpdateInfo } from '../core/update.ts';
import { richEditor } from './richEditor.ts';
import { sameLayout, type TextLayout } from '../core/description.ts';
import { serializeRichText, type RichParagraph } from '../core/richText.ts';
import { flowView } from './flowView.ts';
import { pasteView } from './pasteView.ts';
import { trackListView } from './trackListView.ts';
import { pdfView } from './pdfView.ts';
import { changeReasonLoading, changeReasonNote, changeReasonSection, REASON_PAGE } from './changeReason.ts';
import type { ChangeReason } from '../core/changeDigest.ts';
import { esc } from './html.ts';
import { NODE_PREVIEW, PreviewCache } from './previewCache.ts';
import { pendingRows, retryableDeliveries } from '../core/guiDelivery.ts';
import { clearFill, defaultDraft, draftCode, draftIndex, draftName, fillFromScreen, isDeletion, isOldSide, isPrevious, isUnpublish, mergesInto, needsLink, OPTIONAL_FIELDS, pendingCaseState, pendingScreens, renumberAutoCodes, replaceTarget, STATUS_LABEL, validateDraft, type Draft, type DraftIndex, type InputStatus, type Validation } from '../core/drafts.ts';
import { formatTime, type HistoryRow } from '../core/history.ts';
import type { HistoryNotice } from '../core/historyNotices.ts';
import { arrangeFlipbooks, buildList, guiGroupKey, placeDrafts, savedGuiDisplay, savedGuiPlace, UNCATEGORIZED, type ArrangedGroup, type GuiDisplay, type GuiPlace, type ListModel } from '../core/list.ts';
import { emptyComment, type BatchComment, type Plan } from '../core/publish.ts';
import { customSection, defaultSection, filterScreens, pageSections, rowKind, screenCategoryKey, uncreatedScreens, type FlipbookMove, type FlipbookRequest, type FlipbookRowRequest, type FlipbookSection, type ScreenFilter, type ScreenKind } from '../core/flipbooks.ts';
import { defaultTitle, formatShort, GUI_WIDTH_MAX, GUI_WIDTH_MIN, HISTORY_DATE_FORMATS, isHistoryDateFormat, NO_SECTION_KEY, SMALL_SCALE, validGuiWidth } from '../core/flipbook.ts';
import { TAG_PALETTE } from '../core/palette.ts';
import { TEMPLATE_SECTIONS, TEMPLATE_ITEMS, isFallbackItem, isTemplateItem, type ItemKind, type TemplateInfo, type TemplateItemDef, type TemplateItemState } from '../core/templateParts.ts';
import { templateEntries, type TemplateEntry } from '../core/templateList.ts';
import { findCategoryByName, systemTagId } from '../core/registry.ts';
import { formatFrameName, parseFrameName } from '../core/screenName.ts';
import type { State } from '../core/store.ts';
import type { Actor, Category, Flipbook, SystemTag, Team } from '../core/types.ts';
import { ALL_CATEGORIES, filterPickerScreens, screenCategories, screenLayoutToggle, screenPickerEmpty, screenPickerFilters } from './screenPicker.ts';
import { thumbnailImage, updateThumbnailImages } from './thumbnailImage.ts';
import { SIMILAR_MIN, type VersionEvidence, type VersionLink } from '../core/versionMatch.ts';
import { clampWindow, fromWire, PANE, pasteDropMetadata, type AdminOp, type DescriptionArea, type FlipbookEdit, type NavTarget, type PageInfo, type ManagedPageInfo, type ScanState, type ToMain, type ToUi, type VersionMatchView } from '../core/wire.ts';

export interface Bridge {
  send(message: ToMain): void;
  listen(handler: (message: ToUi) => void): void | (() => void);
  // GUI 붙이기: 창 밖(캔버스)에 놓았을 때 Figma에 알린다(pluginDrop). 미리보기에는 없다.
  drop?(clientX: number, clientY: number, metadata: unknown): void;
}

interface ScreenItem { value: string; code: string; name: string; categoryId?: string | null; entryKey?: string }

export function sortScreenItems(items: ScreenItem[], preferredCategoryId?: string): ScreenItem[] {
  return [...items].sort((a, b) =>
    Number(b.value === '') - Number(a.value === '')
    || (preferredCategoryId ? Number(b.categoryId === preferredCategoryId) - Number(a.categoryId === preferredCategoryId) : 0)
    || a.code.localeCompare(b.code, 'ko', { numeric: true })
    || a.name.localeCompare(b.name, 'ko'));
}

type Tab = Team | 'ADMIN';
// 관리에서 한쪽 모드만 쓰는 항목과 그 제목(첫 항목이 그 모드의 시작 항목). 톱니바퀴로 열면 다른 모드의 항목을 보던 중이었을 때 지금 모드의 첫 항목을 연다.
const ADMIN_MODE_PANELS: Record<Team, [form: string, title: string][]> = {
  GUI: [['scope', COPY.uiApp097], ['screen-id-prefix', COPY.uiApp162], ['exclusions', COPY.uiApp120]],
  UI: [['flipbook', COPY.uiApp107], ['template', COPY.uiApp392], ['gui-width', COPY.uiApp225]],
};

// 처리 중에도 허용하는 조작: 탭 전환과 목록 탐색
const WHILE_BUSY = new Set(['recovery-toggle', 'tab', 'settings', 'admin-nav', 'group', 'page-group', 'select', 'changed-only', 'refresh-list', 'cancel-scan', 'text-close', 'flow-open', 'pdf-open', 'pdf-cancel', 'update-download', 'update-go', 'update-close']);
// 변경사항 확인 전에도 허용하는 조작: 목록 탐색, 캔버스 이동, 변경사항 확인
const BEFORE_CHECK = new Set([...(typeof __PLUGIN_RELEASE__ !== 'boolean' || !__PLUGIN_RELEASE__ ? ['template-migration-find', 'template-migration-close', 'template-migration-toggle', 'template-migration-submit'] : []), ...WHILE_BUSY, 'switch-mode', 'scan', 'scan-selected', 'excluded-unexclude','nav', 'nav-suggested', 'create-page-manage', 'category-manage', 'new-add', 'new-remove', 'new-select', 'new-create-one', 'new-section-add', 'new-section-confirm', 'new-section-cancel', 'new-clear', 'arrange-skip', 'arrange-apply', 'new-dialog-close', 'new-cancel-confirm', 'fb-edit-title', 'fb-identity-save', 'create-layout', 'create-search-all', 'create-screen-add', 'create-screen-remove', 'fb-edit-cancel', 'create-uncreated-only', 'create-submit', 'bulk-open', 'bulk-close', 'bulk-submit', 'pick', 'admin-template', 'admin-template-default', 'admin-template-connect', 'admin-template-disconnect', 'admin-template-show', 'admin-gui-width', 'admin-policy-template', 'admin-flipbook-page',
  'version-open', 'version-close', 'version-match', 'version-select', 'version-review-only', 'version-reveal', 'version-switch', 'version-cancel']);

import { WORK_LABEL } from '../core/copy.ts';


// 지우기(x) 아이콘
const X_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
// 자동으로 넓히는 최소 창 크기: 새 플립북 편집, 새 버전 페이지
const NEW_EDITOR_MIN = { width: 800, height: 640 };
const VERSION_MIN = { width: 960, height: 720 };
const CHEVRON_RIGHT_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
const REFRESH_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
const CURSOR_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m5 3 15 10-7 1-3 7Z"/></svg>';

// 「+ 추가」 버튼 내용. 더하기 아이콘을 글자 앞에 붙인다.
const ADD_LABEL = `<svg class="add-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>${COPY.uiApp101}`;

// 관리의 템플릿 항목 아이콘(2026-11-02 사용자 요청). 상태: 연결됨(파란 원 체크)·연결 필요(빨간 원 느낌표)·필수 아님(회색 점선 원).
const STATE_ICON: Record<'ok' | 'need' | 'optional', string> = {
  ok: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="m7.5 12.5 3 3 6-6.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  need: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 7v6.5M12 17h.01" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>',
  optional: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3.5 3"/></svg>',
};
// 항목이 받는 레이어 형식. 아이콘은 Figma 레이어 패널 모양을 따른다(텍스트 T, 프레임 #, 인스턴스 ◇, 컴포넌트 ❖).
type LayerFormat = 'text' | 'instance' | 'frame' | 'slot' | 'component' | 'layer';
const KIND_FORMATS: Record<ItemKind, LayerFormat[]> = {
  text: ['text'], tag: ['instance', 'text'], team: ['text', 'instance'], area: ['slot', 'frame'], frame: ['frame'], layers: ['layer'], component: ['component'],
};
const FORMAT_LABEL: Record<LayerFormat, string> = {
  text: COPY.uiApp413, instance: COPY.uiApp414, frame: COPY.uiApp415, slot: COPY.uiApp416, component: COPY.uiApp417, layer: COPY.uiApp418,
};
const formatIcon = (body: string) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const FORMAT_ICON: Record<LayerFormat, string> = {
  text: formatIcon('<path d="M5 7V4h14v3M12 4v16M9 20h6"/>'),
  instance: formatIcon('<path d="M12 3 21 12 12 21 3 12Z"/>'),
  frame: formatIcon('<path d="M8 3v18M16 3v18M3 8h18M3 16h18"/>'),
  slot: formatIcon('<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2.6"/>'),
  component: formatIcon('<path d="m12 2.5 3 3-3 3-3-3ZM18.5 9l3 3-3 3-3-3ZM12 15.5l3 3-3 3-3-3ZM5.5 9l3 3-3 3-3-3Z"/>'),
  layer: formatIcon('<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/>'),
};
// 항목 안내를 툴팁으로 보여 주는 작은 회색 물음표(머리 줄 도움말 아이콘과 같은 모양)
const SMALL_HELP_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>';

function option(value: string, label: string, selected: boolean): string {
  return `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
}

// 여러 화면의 값이 서로 다를 때 표시한다. 이 항목은 고를 수 없고, 다른 값을 고르면 선택한 화면 전체에 적용한다.
function mixedMark(mixed: boolean): string {
  return mixed ? ` <span class="mixed">${esc(COPY.uiApp175)}</span>` : '';
}

function mixedOption(): string {
  return `<option value="" selected disabled>${esc(COPY.uiApp175)}</option>`;
}


export function startApp(bridge: Bridge, root: HTMLElement): () => void {
  let disposed = false;
  const cleanups: (() => void)[] = [];
  const events = new AbortController();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  function later(callback: () => void, delay = 0) {
    const timer = globalThis.setTimeout(() => {
      timers.delete(timer);
      if (!disposed) callback();
    }, delay);
    timers.add(timer);
    return timer;
  }
  function cancelLater(timer: ReturnType<typeof setTimeout>) {
    globalThis.clearTimeout(timer);
    timers.delete(timer);
  }
  function on<K extends keyof HTMLElementEventMap>(type: K, listener: (event: HTMLElementEventMap[K]) => void, capture = false) {
    root.addEventListener(type, listener, { signal: events.signal, capture });
  }
  let state: State | null = null;
  let actor: Actor | null = null;
  let pages: PageInfo[] = [];
  let managedPages: ManagedPageInfo[] = [];
  let issues: string[] = [];
  // 플립북 템플릿의 문제. UI Flipbook 목록 위에 경고로 보여 준다(관리 화면이 아니어도).
  let templateIssues: string[] = [];
  // 관리의 템플릿에 보여 줄 한 템플릿의 항목별 연결 상태. 관리를 열 때, 목록에서 템플릿을 고를 때, 템플릿을 바꾼 뒤 받는다.
  let templateInfo: TemplateInfo | null = null;
  // 관리의 템플릿 목록에서 고른 템플릿. 없거나 목록에 없으면 대표 템플릿을 보여 준다.
  let templatePick: string | null = null;
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
  let newHistory = new Map<string, HistoryNotice[]>();
  const hasNewHistory = (id: string) => !!newHistory.get(id)?.length;
  // 실행한 플러그인 명령(GUI Publish·UI Flipbook). 설정(⚙)을 열면 tab이 ADMIN이 된다.
  let mode: Team = 'GUI';
  let tab: Tab = 'GUI';
  // GUI 배포의 추가 설명. 배포 한 번에 하나(2026-10-20 사용자 결정)
  let comment: BatchComment = emptyComment();
  // GUI 배포 작업자 이름(아래 줄 입력란). 처음에는 Figma 계정 이름, 배포한 뒤에는 그때 쓴 이름을 기본으로 쓴다(2026-11-03 사용자 요청).
  let workerName = '';
  let workerTyped = false;
  let workerAsked = false;
  // 새 플립북(2026-10-21 사용자 요청: 플립북 만들기 탭을 플립북 목록에 합친다). 「새 플립북」을 누르면 목록에 바로 들어가는 미리보기이며,
  // 만들기를 누르기 전에는 저장하지 않는다. 목록에서 드래그하거나 Alt+↑↓로 자리를, 오른쪽에서 페이지·Section을 정한다.
  // section: null이면 첫 화면의 카테고리 Section(화면이 없으면 그 페이지 맨 아래 Section). after: Section 안에서 바로 앞 항목(기존 플립북 ID 또는 새 플립북 키, null이면 맨 앞, 없으면 맨 뒤).
  // 배열 순서는 목록 순서와 같게 유지한다(normalizeNew).
  // seq: 목록에 끼워 넣는 순서(앞 항목이 먼저 놓이게 목록 순서대로 매긴다). 옮긴 기존 플립북과 함께 센다.
  type NewFlipbook = { key: string; uids: string[]; title: string; screenId?: string; pageId: string; section: FlipbookSection | null; after?: string | null; seq: number };
  // 목록에서 옮긴 기존 플립북(2026-10-22 사용자 요청). 키는 플립북 ID다. 만들기(새 플립북이 없으면 배치 반영)를 누르면 캔버스에 반영할지 묻는다.
  type MovedFlipbook = { key: string; pageId: string; section: FlipbookSection; after?: string | null; seq: number };
  let movedFlipbooks: MovedFlipbook[] = [];
  function updateNewIdentity(n: NewFlipbook) {
    const info = newIdentity(n);
    const chapter = root.querySelector<HTMLInputElement>('.new-place [data-identity-chapter]');
    if (chapter) chapter.value = info.chapter;
    const row = root.querySelector<HTMLElement>(`.list-box .new-row[data-key="${CSS.escape(n.key)}"] .name`);
    if (row) row.textContent = info.frameName;
  }

  function newIdentities() {
    const identities = new Map<string, ReturnType<typeof flipbookIdentity>>();
    if (!newFlipbooks.length) return identities;
    const preview = { ...state!, flipbooks: new Map(state!.flipbooks) };
    for (const row of newFlipbooks) {
      const screens = newScreens(row);
      const fb: Flipbook = { id: row.key, rev: 1, kind: newKind(row), title: newTitle(row), autoTitle: !row.title.trim(), titleNames: [], scale: 1,
        category: newSection(row), screens, pageId: row.pageId, status: 'active', createdAt: 0, actor: { id: '', name: '' } };
      const next = withFlipbookId(preview, fb, row.screenId);
      preview.flipbooks.set(next.id, next);
      identities.set(row.key, flipbookIdentity(preview, next));
    }
    return identities;
  }

  function newIdentity(n: NewFlipbook) {
    return newIdentities().get(n.key) ?? { screenId: '', chapter: '-', frameName: newTitle(n) };
  }

  // 「선택된 화면」에서 드래그 중인 화면의 자리(같은 화면이 여러 번 들어갈 수 있어 화면이 아니라 자리로 구분한다)
  let draggingScreen: number | null = null;
  let floatSeq = 0;
  // 새 플립북 확인 모달: 캔버스 배치 반영 여부(arrange), 만들기 취소 확인(cancel)
  let newDialog: 'arrange' | 'cancel' | null = null;
  const NEW_PREFIX = 'new:';
  const isNewKey = (key: string) => key.startsWith(NEW_PREFIX);
  let newFlipbooks: NewFlipbook[] = [];
  const identityDrafts = new Map<string, { rev: number; title: string; screenId: string }>();
  // 기존 플립북 상세의 Description 영역(2026-11-04 사용자 요청). 고르면 캔버스의 내용을 불러오고, 고친 내용은 플립북마다 남는다.
  // 캔버스에서 다시 읽을 때는 고치지 않은 항목을 최신 값으로 갱신하고, 사용자가 바꾼 항목만 초안으로 유지한다.
  // Description 토글(2026-11-05 사용자 결정): area는 캔버스의 Description 영역 상태다(none: 영역 표식이 없어 토글 없음).
  // ready는 토글이 켜진 상태, off는 꺼진 상태로 내용을 불러오지 않는다. 토글이 area와 다르면(보이는 영역을 끔, 숨긴 영역을 켬) 수정이다.
  // loading의 area: 토글을 켜서 다시 읽는 중이면 토글을 계속 보여 준다.
  type DescDraft = { status: 'loading'; area?: DescriptionArea } | { status: 'error'; message: string } | { status: 'off'; area: DescriptionArea }
    | { status: 'ready'; refreshing: boolean; error?: string; area: DescriptionArea; saved: string; savedDoc: RichParagraph[]; savedLayout: TextLayout; doc: RichParagraph[]; layout: TextLayout };
  const descDrafts = new Map<string, DescDraft>();
  let descriptionViewed: string | null = null;
  // Description 영역 편집기에 지금 들어 있는 플립북
  let descEditorFor: string | null = null;
  const descEditor = richEditor({ label: COPY.fbDescription, onChange: descChanged });
  // 「모두 적용하기」 중인가(상세의 「적용하기」 하나만 반영할 때는 아니다)
  let applyingAll = false;
  // 상세의 「만들기」로 만드는 중인 새 플립북 키
  let creatingOne: string | null = null;
  // 마지막으로 그린 수정 중 플립북 목록. 바뀔 때만 목록·하단 줄을 다시 그린다(글자를 칠 때마다 목록을 다시 그리지 않는다).
  let shownEdited = '';
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
  let draggingCategory: string | null = null;
  // 플립북 만들기의 화면 선택: 카테고리(처음은 전체)와 후보 목록 보기 방식.
  let createCategory = ALL_CATEGORIES;
  let createLayout: 'list' | 'grid' = 'list';
  let createQuery = '';
  let createUncreatedOnly = false;
  let createScreens: GuiScreenInfo[] = [];
  let createError: string | null = null;
  // 플립북 없는 화면 일괄 만들기 모달. 범위 안의 화면마다 단일 플립북을 하나씩 만든다.
  // excluded: 범위 안에서 체크를 푼 화면. submitting: 만들기 요청 중(완료·오류 메시지를 이 모달이 받는다).
  let bulk: (ScreenFilter & { pageId: string; categories: Set<string>; excluded: Set<string>; submitting: boolean; error: string | null }) | null = null;
  // 목록을 플립북 페이지와 마지막으로 맞춘 시각과, 새로고침을 누른 뒤 응답을 기다리는 중인지
  let listSyncedAt: number | null = null;
  let refreshingList = false;
  // 썸네일 이미지: 해시 → blob URL(불러오는 중이면 '')
  const previewCache = new PreviewCache(message => bridge.send(message));
  const thumbUrls = previewCache.urls;
  // 읽지 못한 썸네일(해시)과 내보내지 못한 프레임 미리보기(`node:` 키). 다시 요청하지 않고 「썸네일 없음」으로 보여 준다.
  const failedPreviews = previewCache.failed;
  const drafts: Record<Team, Record<string, Draft>> = { GUI: {}, UI: {} };
  // 필수 입력 테두리는 해당 입력에서 벗어난 뒤 또는 미충족 항목으로 이동한 뒤에만 표시한다.
  const touched: Record<Team, Record<string, Set<string>>> = { GUI: {}, UI: {} };
  const revealed: Record<Team, Set<string>> = { GUI: new Set(), UI: new Set() };
  const selected: Record<Team, string | null> = { GUI: null, UI: null };
  const selection: Record<Team, Set<string>> = { GUI: new Set(), UI: new Set() };
  let canvasPick: { field: string; keys: string[]; current: string | null } | null = null;
  const anchor: Record<Team, string | null> = { GUI: null, UI: null };
  // 캔버스에서 고른 숨긴 프레임(exclusions ID). 목록 선택이 없을 때 상세 가운데에 숨긴 화면 안내와 「다시 표시」 버튼을 보인다(2026-11-05 사용자 요청).
  // unexcludedNodes: 다시 표시한 프레임. 신규 후보로 목록에 다시 나오면 그 행을 고른다.
  let excludedPick: string[] = [];
  let unexcludedNodes = new Set<string>();
  let addMode: 'tag' | null = null;
  let editMode: 'tag' | null = null;
  // 그룹은 접힌 상태가 기본이다. 펼친 그룹만 기억한다.
  const expanded: Record<Team, Set<string>> = { GUI: new Set(), UI: new Set() };
  const query: Record<Team, string> = { GUI: '', UI: '' };
  // UI는 만든 플립북 전체를 먼저 보여 준다.
  const changedOnly: Record<Team, boolean> = { GUI: true, UI: false };
  let plan: Plan | null = null;
  let quietPublish = false;
  // 화면 반영 건너뛰기: 원본 변경이 없는 GUI 배포에서만 보이고 처음에는 켜져 있다(2026-11-03 사용자 요청).
  let skipLayers = true;
  let toast: { kind: 'info' | 'error'; text: string } | null = null;
  // 상단 미완료 반영 배너의 목록을 펼쳤는지.
  let recoveryOpen = false;
  let navSeq = 0;
  let history: { id: string; rows: HistoryRow[] } | null = null;
  // GUI Publish에서 추가한 카테고리. 상태가 돌아오면 해당 화면의 카테고리로 선택한다.
  let pendingCategory: { name: string; keys: string[] } | null = null;
  let categoryManageKeys: string[] = [];
  // 태그 입력란: 추가 후 선택할 태그와 사용 안 함을 한 번 누른 태그
  let pendingTag: { name: string; team: Team; keys: string[] } | null = null;
  let tagArmed: string | null = null;
  // 데이터 초기화를 한 번 눌렀는가. 한 번 더 누르면 초기화한다.
  let resetArmed = false;
  // Screen ID 번호 다시 매기기를 한 번 눌렀는가. 한 번 더 누르면 다시 매긴다.
  let renumberArmed = false;
  // 설정에서 열어 둔 아코디언 항목(제목)
  let adminOpen: string | null = null;
  // 업데이트(관리 → 시스템 → 업데이트, 2026-11-04 사용자 요청). 이 빌드의 버전은 build.mjs가 넣는다.
  // 최신 버전(파일 기록)은 실제 플러그인 창에서만 묻는다(미리보기·튜토리얼 예시 화면은 묻지 않는다). update: 응답을 받은 뒤의 비교 정보
  const build = {
    current: typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : 'dev',
    release: typeof __PLUGIN_RELEASE__ === 'boolean' && __PLUGIN_RELEASE__,
  };
  let update: UpdateInfo | null = null;
  let updateAsked = false;
  // 업데이트 안내 말풍선. 닫거나 관리를 열면 이번 실행 동안 다시 띄우지 않는다(알림 점은 업데이트할 때까지 남는다).
  let updateBubble: HTMLElement | null = null;
  let updateBubbleClosed = false;
  const UPDATE_BADGE = '<span class="update-badge" aria-hidden="true"></span>';
  // 새 버전 페이지 탭(2026-10-21 사용자 요청: 설정 안이 아니라 GUI Publish 머리의 탭으로 연다).
  // 비교할 페이지, 비교 결과, 사용자가 고친 연결(화면 ID → 노드 ID, ''는 연결 안 함), 전환을 한 번 눌렀는가
  let versionOpen = false;
  // UI Flipbook의 플로우 탭(2026-10-23 사용자 결정). 다른 탭과 같이 하나만 열린다.
  let flowOpen = false;
  // UI Flipbook의 PDF 저장 탭(2026-10-26 사용자 요청). 다른 탭과 같이 하나만 열린다.
  let pdfOpen = false;
  // GUI 붙이기는 다른 편집 탭과 같이 하나만 열고 현재 창 크기를 유지한다.
  let pasteOpen = false;
  // 화면 목록을 캔버스에서 읽은 마지막 플립북(상세를 다시 그릴 때마다 읽지 않게)
  let followed: string | null = null;
  // 플로우·PDF·붙이기 탭은 UI Flipbook에만 있다. GUI Publish에서는 그 탭을 열어 둔 채 넘어와도 목록 화면이 열려 있다
  // (2026-11-05 회귀: GUI 붙이기 탭을 연 채 GUI Publish로 바꾸면 History 썸네일이 「불러오는 중」에서 바뀌지 않았다).
  const listTabOpen = () => mode !== 'UI' || (!flowOpen && !pdfOpen && !pasteOpen);
  let pdfTabSent = false;
  // PDF를 합쳐 저장하는 동안의 진행 표시. 본체의 진행 표시(busyLabel)가 끝난 뒤에도 이어서 보여 준다.
  let pdfBusy: string | null = null;
  // History를 펼친 화면 ID. 보고 있는 화면이 바뀌면 잊어서, 다른 화면이나 관리·UI Flipbook에 갔다가 같은 화면으로 돌아와도 접힌 채로 시작한다
  // (2026-11-05 사용자 요청: 펼친 상태를 기억하지 않는다). 같은 화면을 다시 그릴 때(히스토리 도착 등)는 펼친 채로 둔다.
  let historyOpenId: string | null = null;
  let historyShownId: string | null = null;
  const forgetHistoryFold = () => { historyOpenId = null; historyShownId = null; };
  // UI Flipbook 상세의 「화면 N개」 펼침. 기본은 접힘이고 펼친 상태는 기억하지 않는다(2026-11-05 사용자 요청): 다른 플립북이나 관리·GUI·새 플립북·
  // 다른 탭에 갔다가 돌아오면 접힌 채로 시작한다. 같은 플립북을 다시 그릴 때(상태 갱신 등)는 펼친 채로 둔다.
  let fbScreensOpen = false;
  let fbScreensShownId: string | null = null;
  const forgetScreensFold = () => { fbScreensOpen = false; fbScreensShownId = null; };
  // 히스토리 모달 표시(2026-11-03 사용자 요청)
  // 마지막으로 히스토리를 요청한 화면·플립북 ID. 같은 ID를 거듭 요청하지 않는다.
  let historyAsked: string | null = null;
  // 「변경 사항」에서 펼쳐 보인, 보이는 값이 같은 변경의 줄 수. 지금 고른 화면에만 두고 기억하지 않는다:
  // 다른 화면을 고르거나 변경사항 확인을 다시 하면 접힌 상태로 돌아간다.
  let reasonShown: { key: string; count: number } | null = null;
  // 기존 화면 교체의 변경 사항. 키: 항목 키|교체할 화면 ID|프레임 지문, 값: 받은 결과(요청 중이면 null). 목록을 다시 받으면 비운다.
  const replaceReasons = new Map<string, { same: boolean; reason: ChangeReason | null } | null>();
  const replaceReasonKey = (entry: Entry, screenId: string) => `${entry.key}|${screenId}|${entry.frame?.fingerprint ?? ''}`;
  // 근거를 먼저 계산해 달라고 요청한 프레임(노드 ID|지문). 같은 상태로 다시 그릴 때 거듭 요청하지 않는다.
  const reasonAsked = new Set<string>();
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
  // 플러그인 본체가 처리 중인 작업. 처리 중에는 목록 탐색 외의 조작을 막는다.
  // 처음에는 본체의 첫 응답을 기다리는 중이다.
  let busyLabel: string | null = COPY.uiApp001;
  let startupPending = true;

  root.innerHTML = `
    <div class="startup-overlay" role="status" aria-live="polite"><div class="startup-content"><div class="startup-label">${COPY.uiApp001}</div><div class="startup-progress" role="progressbar" aria-label="${COPY.uiApp001}"><span></span></div></div></div>
    <div class="busy" role="status" aria-live="polite" hidden><span class="spinner" aria-hidden="true"></span><span class="busy-label"></span></div>
    <header class="tabs" role="tablist"></header>
    <div class="recovery-status template-warning" role="status" hidden></div>
    <div class="toolbar"></div>
    <section class="list" aria-label="${COPY.uiApp002}"></section>
    <div class="pane-divider" role="separator" aria-orientation="vertical" aria-label="목록과 화면정보 너비 조절" tabindex="0"></div>
    <section class="detail" aria-label="${COPY.uiApp003}"></section>
    <footer class="footer"></footer>
    <div class="toast" role="status" aria-live="polite"></div>
    <div class="overlay" hidden></div>
    ${typeof __PLUGIN_RELEASE__ !== 'boolean' || !__PLUGIN_RELEASE__ ? '<div class="overlay template-migration-overlay" hidden></div>' : ''}
    ${typeof __PLUGIN_RELEASE__ !== 'boolean' || !__PLUGIN_RELEASE__ ? '<div class="overlay flow-repair-overlay" hidden></div>' : ''}
    <div class="overlay bulk-overlay" hidden></div>
    <div class="overlay arrange-overlay" hidden></div>
    <div class="resize-handle" title="${COPY.uiApp208}" aria-label="${COPY.uiApp208}"></div>`;
  const $ = (sel: string) => root.querySelector(sel) as HTMLElement;
  bridge = windowCollapse(bridge, root, () => mode, events.signal);
  // 창 크기를 바꾸거나 접었다 펼치면 업데이트 안내 말풍선을 관리 아이콘에 다시 맞춘다.
  window.addEventListener('resize', () => placeUpdateBubble(), { signal: events.signal });
  const pdf = pdfView(root);
  const flows = flowView(root, {
    track: (uid, name) => trackList.open(uid, name),
    create: request => bridge.send({ type: 'createFlow', request }),
    thumb: hash => thumbUrls.get(hash) || null,
  });
  // 추적 목록 팝업: GUI 붙이기 탭의 화면 줄에서 연다. 화면(추적 GUI)은 그 레이어를, 플로우는 그 화면의 썸네일 칸을 골라 간다.
  const trackList = trackListView(root, {
    load: uid => bridge.send({ type: 'trackList', uid }),
    reveal: (item, uid) => bridge.send(item.kind === 'screen' ? { type: 'revealTrack', nav: ++navSeq, uid, trackId: item.id } : { type: 'revealFlow', nav: ++navSeq, flowId: item.id, uid }),
  });
  const paste = pasteView(root, {
    paste: (uid, scale) => bridge.send({ type: 'pasteGui', uid, scale }),
    track: (uid, name) => trackList.open(uid, name),
    drop: (uid, scale, x, y) => bridge.drop?.(x, y, pasteDropMetadata(uid, scale)),
    thumb: hash => thumbUrls.get(hash) || null,
  });

  // 두 영역 구분선: 현재 창 너비에서 목록과 화면정보의 최소 너비(PANE)를 확보한다.
  {
    const divider = $('.pane-divider');
    const list = $('.list');
    const { minList, minDetail, divider: dividerWidth } = PANE;
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
    const observer = new ResizeObserver(sync);
    observer.observe(root);
    cleanups.push(() => observer.disconnect());
  }

  // 창 크기 손잡이: 끄는 동안 프레임마다 크기를 보내고, 놓으면 그 크기를 기억한다.
  // 플러그인 창(iframe) 밖으로 나간 동안에는 포인터 이벤트가 오지 않아 크기도 따라가지 않는다. 밖에서 버튼을 놓으면 pointerup이 오지 않으므로,
  // 다시 들어온 첫 움직임에서 버튼이 떼어져 있으면 마지막으로 반영한 크기로 끝낸다(2026-10-22 사용자 보고: 놓은 뒤에도 창 크기가 따라 움직임).
  {
    const handle = $('.resize-handle');
    let start: { x: number; y: number; width: number; height: number } | null = null;
    let pending: { width: number; height: number } | null = null;
    let frame = 0;
    cleanups.push(() => { if (frame) cancelAnimationFrame(frame); });
    const send = (save = false) => {
      frame = 0;
      if (pending) bridge.send({ type: 'resize', ...pending, save });
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
      pending = clampWindow(mode, start.width + ev.screenX - start.x, start.height + ev.screenY - start.y);
      if (!frame) frame = requestAnimationFrame(() => send());
    });
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    handle.addEventListener('lostpointercapture', stop);
  }

  // ── 상태 계산 ─────────────────────────────────────────

  const team = (): Team => (tab === 'ADMIN' ? mode : tab);
  function draftOf(t: Team, entry: Entry): Draft {
    if (!drafts[t][entry.key]) drafts[t][entry.key] = defaultDraft(t, state!, entry);
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
    return draft?.included && !draft.notScreen && !isUnpublish(entry, draft) && !isDeletion(entry, draft) && !isOldSide(entry, draft) ? draft : null;
  }

  // GUI 목록에 보이는 이름·Screen ID. 배포 전이라도 배포할 값(draftName·draftCode)을 쓴다. 화면 선택 드롭다운도 같은 값을 쓴다.
  // 기존 화면을 교체하는 신규 후보는 그 화면의 자리에 이어받을 Screen ID로 보인다.
  // mark: 배포하면 ID가 생기거나 바뀌는 화면. 신규 등록은 'new'(파랑), 이어받을 화면의 ID와 다르면 'changed'(청록)로 ID 태그에 표시한다(2026-11-03 사용자 요청).
  function guiDisplay(entry: Entry, saved = savedGuiDisplay(state!, entry)): GuiDisplay {
    const draft = shownDraft(entry);
    if (!draft) return saved;
    const name = draftName(state!, entry, draft) || saved.name;
    const code = draftCode(state!, entry, draft);
    const owner = replaceTarget(entry, draft) ?? entry.screenId;
    if (!owner) return code ? { name, code, mark: 'new' } : { name, code };
    return code && code !== state!.screens.get(owner)?.code ? { name, code, mark: 'changed' } : { name, code };
  }

  // 교체 짝이 정해진 이전 화면은 숨기지 않고 새 버전 바로 아래에 둔다(2026-11-03 사용자 요청). 새 버전이 이 화면을 가리킬 때만 따라간다.
  function previousOf(entry: Entry): string | null {
    const draft = drafts.GUI[entry.key];
    if (!draft?.included || !isPrevious(entry, draft)) return null;
    const lead = drafts.GUI[draft.replacedBy!];
    return lead?.included && lead.replaceScreenId === entry.key ? draft.replacedBy! : null;
  }

  // GUI 목록의 카테고리 그룹·케이스 위치. 배포할 값과 같은 규칙(publish.ts guiItem)으로 입력 중인 값을 쓴다(2026-10-21 사용자 요청).
  function guiPlace(entry: Entry, saved = savedGuiPlace(state!, entry.screenId)): GuiPlace {
    const draft = shownDraft(entry);
    if (!draft) return saved;
    const relation = (target: GuiPlace) => draft.relation === 'case' ? draft.baseScreenId ?? null : draft.relation === 'standalone' ? null : target.baseScreenId;
    if (registersNew('GUI', entry)) return { categoryId: draft.categoryId ?? null, baseScreenId: relation(savedGuiPlace(state!, null)) };
    // 기존 화면 교체는 이전 화면의 카테고리를 기준으로 하고 화면 관계는 그대로 둔다. 배포 화면으로 교체할 때도 같다.
    // 화면 관계는 입력한 값을 따른다(2026-11-03 사용자 요청: 새 버전의 관계도 고칠 수 있게).
    if (!entry.screenId || mergesInto(entry, draft)) { const target = savedGuiPlace(state!, draft.replaceScreenId ?? entry.screenId); return { categoryId: draft.categoryId ?? target.categoryId, baseScreenId: relation(target) }; }
    return { categoryId: draft.categoryId ?? saved.categoryId, baseScreenId: relation(saved) };
  }

  // 입력으로 선택한 화면의 그룹·기본 화면이 바뀌면 옮겨 간 그룹을 펼치고 행을 보이게 한다.
  const shownPlace = new Map<string, string>();
  let revealSelection = false;
  function followSelection() {
    const live = new Set(entriesFor('GUI').map(entry => entry.key));
    for (const key of shownPlace.keys()) if (!live.has(key)) shownPlace.delete(key);
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
      changed: t === 'UI' ? e => !!e.flipbookId && hasNewHistory(e.flipbookId) : undefined,
      spots: t === 'UI' ? id => uiScans.get(id)?.spot : undefined,
      guiDisplay, guiPlace, follows: t === 'GUI' ? previousOf : undefined,
      bottom: t === 'GUI' ? entry => !!drafts.GUI[entry.key]?.included && (!!drafts.GUI[entry.key].notScreen || isUnpublish(entry, drafts.GUI[entry.key])) : undefined,
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
  // 선택된 화면과 그 자리(n.uids 안의 번호). 같은 화면을 여러 번 넣을 수 있으므로 빼기·옮기기는 자리로 한다.
  function newPicks(n: NewFlipbook): { screen: GuiScreenInfo; at: number }[] {
    const screens = activeScreens();
    return n.uids.flatMap((uid, at) => {
      const screen = screens.find(s => s.uid === uid);
      return screen ? [{ screen, at }] : [];
    });
  }
  function newScreens(n: NewFlipbook): GuiScreenInfo[] {
    return newPicks(n).map(p => p.screen);
  }
  const newKind = (n: NewFlipbook) => rowKind({ uids: n.uids, multi: n.uids.length > 1, scale: 1 });
  const newByKey = (key: string | undefined): NewFlipbook | undefined => newFlipbooks.find(n => n.key === key);
  // 선택된 화면(목록·순서)을 바꾼 뒤 다시 그린다. 첫 화면이 바뀌어 화면 카테고리 Section(자동)이 바뀌면 그 Section 맨 뒤로 옮긴다.
  function screensChanged(row: NewFlipbook, change: () => void) {
    const before = newSection(row).key;
    change();
    createError = null;
    if (newSection(row).key !== before) relocateNew(row, row.pageId, row.section);
    else normalizeNew();
    revealSelection = true;
    renderDetail(); renderList(); renderFooter();
  }
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
  // 새 플립북을 처음 넣을 때 창이 편집에 필요한 최소 크기보다 작으면 넓히고, 모두 만들거나 지우면 되돌린다
  // (2026-11-04 사용자 결정: 자동 크기 조절은 유지하되 최소 크기는 쾌적한 한도에서 가장 작게).
  let sizeBeforeCreate: { width: number; height: number } | null = null;
  function widenForEditor() {
    if (sizeBeforeCreate) return;
    sizeBeforeCreate = { width: root.offsetWidth, height: root.offsetHeight };
    const { width, height } = NEW_EDITOR_MIN;
    if (sizeBeforeCreate.width < width || sizeBeforeCreate.height < height) bridge.send({ type: 'resize', width: Math.max(sizeBeforeCreate.width, width), height: Math.max(sizeBeforeCreate.height, height) });
  }
  function restoreEditorSize() {
    if (!sizeBeforeCreate || newFlipbooks.length || movedFlipbooks.length) return;
    bridge.send({ type: 'resize', ...sizeBeforeCreate });
    sizeBeforeCreate = null;
  }
  function addNew(uids: string[] = [], quiet = false): boolean {
    const options = flipbookPageOptions();
    if (!state || !options.length) { notify('error', COPY.uiApp209); return false; }
    if (!createScreens.length) bridge.send({ type: 'guiScreens' });
    if (quiet) {
      const empty = newFlipbooks.find(n => !n.uids.length && !n.title.trim());
      if (empty) { empty.uids = uids; normalizeNew(); expanded.UI.add(`${empty.pageId}|${newSection(empty).key}`); renderList(); renderFooter(); return true; }
    }
    // 지금 보고 있는 플립북 페이지에 넣는다(2026-10-23 사용자 요청). 플립북 페이지가 아니면 기본 플립북 페이지다.
    if (!newFlipbooks.length) widenForEditor();
    const pageId = options.find(pg => pg.current)?.id ?? options.find(pg => pg.id === state!.project.flipbookPageId)?.id ?? options[0].id;
    const n: NewFlipbook = { key: `${NEW_PREFIX}${++newSeq}`, uids, title: '', pageId, section: null, seq: ++floatSeq };
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
    restoreEditorSize();
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
  // 새 플립북 상세의 「만들기」(2026-11-04 사용자 요청): 고른 새 플립북 하나만 만든다. 다른 새 플립북·옮긴 플립북·수정은 그대로 남는다.
  // 앞이 아직 만들지 않은 새 플립북이면 그 앞의 기존 플립북(없으면 Section 맨 앞) 다음에 놓는다.
  function submitOne(key: string) {
    const n = newByKey(key);
    if (!state || !n || newSubmitting) return;
    if (!flipbookPageOptions().some(p => p.id === n.pageId)) { createError = COPY.uiApp209; renderFooter(); return; }
    normalizeNew();
    let after = n.after;
    while (after && isNewKey(after)) after = newByKey(after)?.after ?? null;
    const row: FlipbookRowRequest = { uids: n.uids, multi: n.uids.length > 1, scale: 1, title: n.title.trim(), screenId: n.screenId, pageId: n.pageId, section: newSection(n), after };
    newSubmitting = true;
    creatingOne = key;
    createError = null;
    bridge.send({ type: 'createFlipbooks', request: { pageId: n.pageId, rows: [row], moves: [] } });
    renderDetail(); renderFooter();
  }

  // 「모두 적용하기」(2026-11-04 사용자 요청): 기존 플립북의 수정(제목·ID·Description)을 반영하고, 새 플립북을 만들고, 옮긴 플립북을 옮긴다.
  // 옮긴 기존 플립북이 있으면 캔버스 배치에 반영할지 먼저 묻는다(2026-10-22 사용자 요청).
  // reflect: 모달에서 고른 답. 반영하지 않으면 기존 플립북은 캔버스 순서로 돌아가고 새 플립북만 만든다.
  function submitAll(reflect?: boolean) {
    if (!state || newSubmitting) return;
    const edits = [...editedIds()].map(editOf).filter((e): e is FlipbookEdit => !!e);
    if (!newFlipbooks.length && !movedFlipbooks.length && !edits.length) return;
    const options = flipbookPageOptions();
    normalizeNew();
    pruneMoved();
    if (movedFlipbooks.length && reflect === undefined) { newDialog = 'arrange'; renderNewDialog(); return; }
    newDialog = null;
    renderNewDialog();
    if (!reflect && movedFlipbooks.length) { movedFlipbooks = []; normalizeNew(); }
    let create: FlipbookRequest | undefined;
    if (newFlipbooks.length || movedFlipbooks.length) {
      if (newFlipbooks.some(n => !options.some(p => p.id === n.pageId))) { createError = COPY.uiApp209; renderFooter(); return; }
      const moves = plannedMoves();
      const index = new Map(newFlipbooks.map((n, i) => [n.key, i]));
      const rows: FlipbookRowRequest[] = newFlipbooks.map(n => ({
        uids: n.uids, multi: n.uids.length > 1, scale: 1, title: n.title.trim(), screenId: n.screenId, pageId: n.pageId, section: newSection(n),
        after: n.after === undefined || n.after === null ? n.after : isNewKey(n.after) ? `row:${index.get(n.after)}` : n.after,
      }));
      create = { pageId: options.find(pg => pg.id === state!.project.flipbookPageId)?.id ?? newFlipbooks[0]?.pageId ?? moves[0].pageId, rows, moves };
    }
    if (!create && !edits.length) { finishNew(); renderList(); renderDetail(); renderFooter(); return; }
    newSubmitting = true;
    applyingAll = true;
    createError = null;
    bridge.send({ type: 'applyFlipbookEdits', edits, ...(create ? { create } : {}) });
    renderList(); renderDetail(); renderFooter();
  }

  // ── 기존 플립북 수정(제목·ID·Description) ─────────────────────

  function identityEdited(id: string): boolean {
    const fb = state?.flipbooks.get(id);
    const draft = identityDrafts.get(id);
    return !!fb && !!draft && draft.rev === fb.rev && identityDirty(fb, draft);
  }
  function descEdited(id: string): boolean {
    const d = descDrafts.get(id);
    return descShownChange(d) !== undefined || d?.status === 'ready' && descContentEdited(d);
  }
  function descContentEdited(d: Extract<DescDraft, { status: 'ready' }>): boolean { return descEditedText(d) || descEditedLayout(d); }
  // 토글로 바꾼 Description 영역 보이기. 바꾸지 않았으면 undefined
  function descShownChange(d: DescDraft | undefined): boolean | undefined {
    if (d?.status === 'off' && d.area === 'shown') return false;
    if (d?.status === 'ready' && d.area === 'hidden') return true;
    return undefined;
  }
  function descEditedText(d: Extract<DescDraft, { status: 'ready' }>): boolean { return serializeRichText(d.doc) !== d.saved; }
  function descEditedLayout(d: Extract<DescDraft, { status: 'ready' }>): boolean { return !sameLayout(d.layout, d.savedLayout); }
  // 저장하지 않은 수정이 있는 기존 플립북(연결이 끊긴 플립북은 반영할 수 없어 뺀다)
  function editedIds(): Set<string> {
    const out = new Set<string>();
    if (!state) return out;
    const missing = new Set(uiEntries().filter(e => e.estimate === 'missing').map(e => e.key));
    for (const id of new Set([...identityDrafts.keys(), ...descDrafts.keys()])) {
      if (state.flipbooks.get(id)?.status === 'active' && !missing.has(id) && (identityEdited(id) || descEdited(id))) out.add(id);
    }
    return out;
  }
  // 목록에 「수정 중」으로 보이는 플립북: 고친 플립북과 목록에서 옮긴 플립북
  const changedIds = (): Set<string> => new Set([...editedIds(), ...movedFlipbooks.map(m => m.key)]);
  function editOf(id: string): FlipbookEdit | null {
    const fb = state?.flipbooks.get(id);
    if (!fb) return null;
    const edit: FlipbookEdit = { id, rev: fb.rev };
    const draft = identityDrafts.get(id);
    if (draft && identityEdited(id)) edit.identity = { title: draft.title, screenId: draft.screenId };
    const d = descDrafts.get(id);
    if (d?.status === 'ready' && descContentEdited(d)) edit.description = { paragraphs: d.doc, layout: d.layout, before: { paragraphs: d.savedDoc, layout: d.savedLayout } };
    const shown = descShownChange(d);
    if (shown !== undefined) edit.descriptionShown = shown;
    return edit.identity || edit.description || edit.descriptionShown !== undefined ? edit : null;
  }
  // 수정 여부가 바뀌면 상세의 「적용하기」, 목록의 「수정 중」, 하단 줄을 맞춘다.
  // 상세 제목 줄 버튼: renderFlipbookDetail이 그 플립북에 맞게 정한다(고치는 중인지에 따라 다른 버튼).
  let titleActionsOf: ((editing: boolean) => string) | null = null;
  function paintEditState() {
    const fb = current()?.flipbookId;
    const actions = root.querySelector<HTMLElement>('.detail .title-actions[data-editing]');
    if (actions && fb && titleActionsOf) {
      const editing = identityEdited(fb) || descEdited(fb);
      // 입력 중인 Page title·Screen ID·Description의 포커스를 지키도록 버튼만 바꾼다.
      if (String(editing) !== actions.dataset.editing) { actions.dataset.editing = String(editing); actions.innerHTML = titleActionsOf(editing); }
    }
    const headTag = root.querySelector<HTMLElement>('.detail .title-head .head-state.edit-state');
    if (headTag && fb) headTag.hidden = !changedIds().has(fb);
    const signature = [...editedIds()].sort().join('|');
    if (signature === shownEdited) return;
    shownEdited = signature;
    renderList(); renderFooter();
  }
  function descChanged() {
    const d = descEditorFor ? descDrafts.get(descEditorFor) : undefined;
    if (d?.status !== 'ready') return;
    d.doc = descEditor.paragraphs();
    d.layout = descEditor.layout();
    paintEditState();
  }
  function leaveDescription() {
    if (descriptionViewed === null) return;
    descriptionViewed = null;
    for (const id of descDrafts.keys()) if (!descEdited(id)) descDrafts.delete(id);
    if (descEditorFor && !descDrafts.has(descEditorFor)) {
      descEditorFor = null;
      descEditor.setParagraphs([], true);
    }
  }
  // Description 영역: 처음 고르면 불러오고, 불러온 플립북은 편집기를 붙인다. 다시 그려도 편집기 요소를 옮겨 붙여 입력·되돌리기를 유지한다.
  function mountDescription(id: string) {
    const slot = root.querySelector<HTMLElement>('.detail .fb-desc-body');
    if (!slot) return;
    // A selection change invalidates read values; retain only actual unsaved edits.
    const selectedNow = descriptionViewed !== id;
    descriptionViewed = id;
    if (selectedNow) for (const otherId of [...descDrafts.keys()]) if (otherId !== id && !descEdited(otherId)) descDrafts.delete(otherId);
    let d = descDrafts.get(id);
    // 숨긴 Description 영역은 본문을 읽지 않는다(force 없이 보내면 영역 상태만 온다). 토글을 켠 초안은 숨긴 영역이어도 읽는다.
    if (!d) { d = { status: 'loading' }; descDrafts.set(id, d); bridge.send({ type: 'flipbookDescription', id }); }
    else if (selectedNow && d.status === 'ready' && !d.refreshing) { d.refreshing = true; bridge.send({ type: 'flipbookDescription', id, force: true }); }
    else if (selectedNow && d.status === 'error') { d = { status: 'loading' }; descDrafts.set(id, d); bridge.send({ type: 'flipbookDescription', id }); }
    paintDescriptionHead(id, d);
    if (d.status === 'off') { slot.replaceChildren(); return; }
    if (d.status === 'loading' || d.status === 'ready' && d.refreshing) { slot.innerHTML = `<p class="note">${COPY.fbDescriptionLoading}</p>`; return; }
    if (d.status === 'error') { slot.innerHTML = `<p class="note bad">${esc(d.message)}</p>`; return; }
    const focused = descEditor.el.contains(document.activeElement);
    const range = focused ? document.getSelection()?.getRangeAt(0)?.cloneRange() : null;
    if (descEditorFor !== id) {
      // 불러온 내용을 그리는 동안에는 어떤 플립북의 사용자 수정으로도 기록하지 않는다.
      descEditorFor = null;
      descEditor.setLayout(d.layout);
      descEditor.setParagraphs(d.doc, true);
      descEditorFor = id;
    }
    if (d.error) slot.innerHTML = `<p class="note bad">${esc(d.error)}</p>`;
    slot.appendChild(descEditor.el);
    if (range) { descEditor.el.querySelector<HTMLElement>('.rich-editor')?.focus(); document.getSelection()?.removeAllRanges(); document.getSelection()?.addRange(range); }
  }
  // Description 머리: 이름과 오른쪽 토글. 영역 표식이 있는 플립북만 토글을 둔다. 꺼지면 영역이 남은 높이를 채우지 않는다.
  function paintDescriptionHead(id: string, d: DescDraft) {
    const section = root.querySelector<HTMLElement>('.detail .fb-description');
    const head = section?.querySelector<HTMLElement>('.fb-description-head');
    if (!section || !head) return;
    const area = d.status === 'error' ? undefined : d.area;
    const on = d.status !== 'off';
    head.innerHTML = `<span>${COPY.fbDescription}</span>${area && area !== 'none'
      ? `<label class="switch fb-desc-switch"><input type="checkbox" role="switch" data-action="fb-desc-toggle" data-id="${esc(id)}" aria-label="${COPY.fbDescription}" ${on ? 'checked' : ''}></label>` : ''}`;
    section.classList.toggle('off', !on);
  }
  // Description 토글: 끄면 불러온 내용과 고친 본문을 버리고 편집 영역을 숨긴다. 켜면 그때 캔버스에서 다시 읽는다(숨긴 영역도 읽는다).
  // 캔버스의 영역 보이기는 「적용하기」 때 바꾼다.
  function toggleDescription(id: string, on: boolean) {
    const d = descDrafts.get(id);
    if (on && d?.status === 'off') {
      descDrafts.set(id, { status: 'loading', area: d.area });
      bridge.send({ type: 'flipbookDescription', id, force: true });
    } else if (!on && d?.status === 'ready') {
      descDrafts.set(id, { status: 'off', area: d.area });
      if (descEditorFor === id) { descEditorFor = null; descEditor.setParagraphs([], true); }
    } else return;
    renderDetail();
    paintEditState();
  }
  // 상세의 「취소」: 그 플립북의 고친 제목·ID·Description을 불러온 내용으로 되돌린다. 토글도 캔버스 상태로 되돌린다
  // (숨긴 영역을 켰으면 다시 끄고, 보이는 영역을 껐으면 다시 불러온다).
  function discardEditsOf(id: string) {
    identityDrafts.delete(id);
    const d = descDrafts.get(id);
    if (d?.status === 'ready' && d.area === 'hidden') {
      descDrafts.set(id, { status: 'off', area: 'hidden' });
      if (descEditorFor === id) descEditor.setParagraphs([], true);
    } else if (d?.status === 'off' && d.area === 'shown') descDrafts.delete(id);
    else if (d?.status === 'ready') { d.doc = d.savedDoc.map(p => ({ ...p, bold: p.bold.map(b => ({ ...b })), ...(p.red ? { red: p.red.map(r => ({ ...r })) } : {}) })); d.layout = { ...d.savedLayout, padding: [...d.savedLayout.padding] as TextLayout['padding'] }; }
    if (descEditorFor === id) descEditorFor = null;
    renderDetail();
    paintEditState();
  }
  // 「전체 취소」: 고친 제목·ID·Description을 버린다. Description은 다시 불러온다.
  function discardEdits() {
    identityDrafts.clear();
    descDrafts.clear();
    descriptionViewed = null;
    descEditorFor = null;
    shownEdited = '';
  }
  // 새 플립북 확인 모달. 배치 반영 여부는 「반영하지 않음」·「반영함」, 만들기 취소는 「계속 편집」·「모두 취소」 두 버튼이다.
  // 두 번 눌러 실행하는 버튼은 누적 데이터 삭제처럼 중요한 동작에만 쓰고, 만들기 중 취소는 모달로 확인한다(2026-10-22 사용자 요청).
  const templateMigration = typeof __PLUGIN_RELEASE__ !== 'boolean' || !__PLUGIN_RELEASE__ ? new TemplateMigrationDialog($('.template-migration-overlay'), msg => bridge.send(msg), ids => {
    for (const id of ids) if (!editedIds().has(id)) descDrafts.delete(id);
    descriptionViewed = null; descEditorFor = null;
    renderDetail();
  }) : null;
  const flowRepair = typeof __PLUGIN_RELEASE__ !== 'boolean' || !__PLUGIN_RELEASE__ ? new FlowRepairDialog($('.flow-repair-overlay'), msg => bridge.send(msg), (field, uid, disabled) =>
    screenPicker(field, registeredItems(id => state?.screens.get(id)?.status === 'active'), uid, FLOW_REPAIR_COPY.screen, { disabled, hideCanvas: true })) : null;
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
  // 하단 줄 오른쪽의 「전체 취소」·「모두 적용하기」(2026-11-04 사용자 요청). 모두 적용하기는 일반 버튼에 파란 글자다.
  function newActions(): string {
    return `<button data-action="new-clear" ${newSubmitting ? 'disabled' : ''}>${COPY.applyAllCancel}</button>
      <button class="apply-all" data-action="create-submit" ${newSubmitting || (newFlipbooks.length && !flipbookPageOptions().length) ? 'disabled' : ''}>${newSubmitting ? COPY.applyAllRunning : COPY.applyAll}</button>`;
  }
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
  function renderTabs() {
    const settings = tab === 'ADMIN';
    // 머리에는 명령 이름(GUI Publish·UI Flipbook)을 쓰지 않고 탭만 둔다(2026-10-22 사용자 요청). 탭이 없는 관리 화면만 「관리」를 쓴다.
    $('.tabs').classList.toggle('ui-tabs', mode === 'UI');
    $('.tabs').innerHTML = `${settings ? `<span class="app-title">${COPY.uiApp004}</span>` : ''}` +
      `${mode === 'GUI' && !settings ? `<div class="create-tabs" role="tablist">${headerTab('version-close', COPY.uiApp272, !versionOpen, 'list')}${headerTab('version-open', COPY.uiApp248, versionOpen, 'versions')}</div>` : ''}` +
      `${mode === 'UI' && !settings ? `<div class="create-tabs" role="tablist">${headerTab('text-close', COPY.uiApp302, listTabOpen(), 'book')}${headerTab('paste-open', COPY.paste001, pasteOpen, 'paste')}<span class="tab-separator tab-group-separator" aria-hidden="true"></span>${headerTab('flow-open', COPY.flow020, flowOpen, 'flow')}${headerTab('pdf-open', COPY.pdf001, pdfOpen, 'pdf')}</div>` : ''}` +
      `<div class="tab-tools"><button class="mode-switch" data-action="switch-mode" title="${mode === 'GUI' ? COPY.modeUi : COPY.modeGui}" ${busyLabel || pdfBusy ? 'disabled' : ''}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10V5h16l-4-4M21 14v5H5l4 4M19 5l-4 4M5 19l4-4"/></svg><span>${mode === 'GUI' ? COPY.modeUi : COPY.modeGui}</span></button><span class="tab-separator" aria-hidden="true"></span>` +
      `<button class="icon-button settings-button" data-action="settings" aria-pressed="${settings}" title="${COPY.uiApp004}" aria-label="${needsUpdate(update) ? `${COPY.uiApp004} · ${COPY.updateAvailable}` : COPY.uiApp004}">${GEAR}${needsUpdate(update) ? UPDATE_BADGE : ''}</button>` +
      `<button class="icon-button" data-action="collapse-window" title="${COPY.windowCollapse}" aria-label="${COPY.windowCollapse}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/><path d="M3 15v6h6M3 21l9-9"/></svg></button>` +
      `</div>`;
    placeUpdateBubble();
  }

  // 업데이트 안내: 튜토리얼과 같은 흰 말풍선을 관리 아이콘 아래에 단다. 관리 화면에서는 띄우지 않는다.
  function placeUpdateBubble() {
    const gear = root.querySelector<HTMLElement>('.tabs [data-action="settings"]');
    if (!gear || !needsUpdate(update) || updateBubbleClosed || tab === 'ADMIN') {
      if (updateBubble) updateBubble.hidden = true;
      return;
    }
    if (!updateBubble) {
      updateBubble = document.createElement('div');
      updateBubble.className = 'update-bubble';
      updateBubble.setAttribute('role', 'status');
      updateBubble.innerHTML = `<strong>${COPY.updateAvailable}</strong><p><button class="link" data-action="update-go">${COPY.updateGo}</button></p>` +
        `<button class="icon-button update-bubble-close" data-action="update-close" title="${COPY.updateClose}" aria-label="${COPY.updateClose}">${X_ICON}</button>`;
      root.append(updateBubble);
    }
    updateBubble.hidden = false;
    const base = root.getBoundingClientRect(), at = gear.getBoundingClientRect();
    const spot = { left: at.left - base.left - 4, top: at.top - base.top - 4, right: at.right - base.left + 4, bottom: at.bottom - base.top + 4 };
    const place = placeBubble(spot, updateBubble.offsetWidth, updateBubble.offsetHeight, root.clientWidth, root.clientHeight);
    Object.assign(updateBubble.style, { left: `${place.left}px`, top: `${place.top}px` });
    updateBubble.style.setProperty('--tail-x', `${place.tailX}px`);
    updateBubble.dataset.tail = place.tail;
  }

  function renderToolbar() {
    if (tab === 'ADMIN' || team() === 'UI') {
      $('.toolbar').innerHTML = (tab !== 'ADMIN' && templateIssues.length
        ? `<div class="template-warning" role="alert"><b class="bad">${COPY.uiApp239}</b>${templateIssues.map(i => `<span class="bad">${esc(i)}</span>`).join('')}</div>` : '');
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
    if (scanFinishTimer[t]) cancelLater(scanFinishTimer[t]);
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
    if (listRebuildTimer) cancelLater(listRebuildTimer);
    listRebuildTimer = later(() => { listRebuildTimer = null; renderList(); }, 120);
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
  // 행 선택만 바뀌면 목록을 다시 만들지 않고 행의 선택 표시만 바꾼다(GUI·UI 목록 공통).
  function paintRowSelection(t: Team) {
    for (const row of root.querySelectorAll<HTMLElement>('.list-box .row[data-action="select"]')) {
      const selected = selection[t].has(row.dataset.key ?? '');
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
    // 사용 중인 카테고리 묶음은 머리를 드래그해서 카테고리 순서를 바꾼다(2026-10-28 사용자 요청). 미분류·사용 안 함 묶음은 옮기지 않는다.
    const movable = (key: string) => !!state!.categories.get(key)?.active;
    box.innerHTML = model.groups.map(g => `
      <div class="group"${movable(g.key) ? ` data-category="${esc(g.key)}"` : ''}>
        ${g.trailing ? '' : `<div class="group-bar"${movable(g.key) ? ` draggable="true" title="${COPY.uiApp391}"` : ''}>${movable(g.key) ? '<span class="drag-handle" aria-hidden="true">⠿</span>' : ''}<input type="checkbox" data-action="include-group" data-group="${esc(g.key)}" ${g.visibleRows.length && g.visibleRows.every(r => draftOf(t, r.entry).included) ? 'checked' : ''} ${g.visibleRows.length && !lock ? '' : 'disabled'} aria-label="${esc(g.name)}${COPY.uiApp032}">
        <button class="group-head" data-action="group" data-group="${esc(g.key)}" aria-expanded="${g.expanded}">
          <span class="caret">${g.expanded ? '▾' : '▸'}</span> ${esc(g.name)}
          <span class="count">${g.total}${COPY.uiApp033} <span class="${g.included ? 'count-on' : ''}">${g.included}</span></span>
        </button></div>`}
        ${g.rows.map(r => {
          const draft = drafts[t][r.entry.key];
          const sel = selection[t].has(r.entry.key);
          return `<div class="row${sel ? ' selected' : ''}${r.depth ? ' case' : ''}${r.previous ? ' previous' : ''}" data-action="select" data-key="${esc(r.entry.key)}" tabindex="0" aria-selected="${sel}">
            ${r.depth ? '<span class="case-indent" aria-hidden="true">└</span>' : ''}
            ${dot(r.status)}
            <input type="checkbox" data-action="include" data-key="${esc(r.entry.key)}" ${draft?.included ? 'checked' : ''} ${entryLocked(t, r.entry) ? 'disabled' : ''} aria-label="${esc(r.name)} ${COPY.uiApp034}">
            ${r.code ? `<span class="id-tag${r.codeMark ? ` code-${r.codeMark}` : ''}">${esc(r.code)}</span>` : ''}
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
      list.innerHTML = `<div class="list-filters"><div class="review-line"><p class="review-count" aria-live="polite"></p></div><div class="list-actions"><button class="add-button" data-action="new-add" title="고른 플립북 다음에 새 플립북을 넣습니다. 만들기를 누르기 전에는 저장하지 않습니다.">${ADD_LABEL.replace(COPY.uiApp101, '새 플립북')}</button><button data-action="register-existing" title="${COPY.registerExistingHint}">${COPY.registerExisting}</button><button data-action="bulk-open">플립북 없는 화면 일괄 만들기</button></div><input type="search" placeholder="${COPY.uiApp020}" value="${esc(query.UI)}" data-input="query" aria-label="${COPY.uiApp021}"><div class="filter-line"><span class="sync-status"></span><label class="switch"><span>${COPY.uiApp301}</span><input type="checkbox" role="switch" data-action="changed-only" ${changedOnly.UI ? 'checked' : ''}></label></div></div><div class="list-body"><div class="list-box"></div><div class="unlinked-all"></div></div>`;
    }
    const canCreate = flipbookPageOptions().length > 0;
    for (const button of list.querySelectorAll<HTMLButtonElement>('.list-actions button')) {
      button.disabled = !canCreate;
      button.title = canCreate ? button.title : COPY.uiApp209;
    }
    const count = [...state!.flipbooks.values()].filter(fb => fb.status === 'active' && hasNewHistory(fb.id)).length;
    list.querySelector<HTMLElement>('.review-count')!.textContent = COPY.newHistoryBooks + ' ' + count + COPY.uiApp015;
    list.querySelector<HTMLInputElement>('[data-action="changed-only"]')!.checked = changedOnly.UI;
    paintSyncStatus();
    const box = list.querySelector<HTMLElement>('.list-box')!;
    const made = [...state!.flipbooks.values()].some(fb => fb.status === 'active');
    // 목록 하단: 연결 끊긴 플립북 전체 삭제(두 번 눌러 삭제). 검색·필터와 관계없이 연결이 끊긴 플립북 전체가 대상이다.
    // 한 번 누르면 버튼 글자만 「한 번 더 눌러 삭제하세요」로 바꾼다. 버튼 밖에 안내 줄을 더하지 않아 버튼 위치가 그대로다.
    const unlinkedKeys = new Set(uiEntries().filter(e => e.estimate === 'missing').map(e => e.key));
    const unlinkedCount = unlinkedKeys.size;
    if (!unlinkedCount) removeAllArmed = false;
    list.querySelector<HTMLElement>('.unlinked-all')!.innerHTML = unlinkedCount
      ? `<p class="note">${unlinkedBadge()}<span>${COPY.uiApp240} <b>${unlinkedCount}</b>${COPY.uiApp241}</span></p><button class="danger" data-action="remove-all-unlinked" aria-live="polite">${removeAllArmed ? COPY.uiApp242Armed : COPY.uiApp242}</button>`
      : '';
    const scrollTop = box.scrollTop;
    const shown = new Map(model.groups.map(g => [g.key, g]));
    const moving = new Set(movedFlipbooks.map(m => m.key));
    const rows = new Map(model.groups.flatMap(g => g.rows).map(r => [r.entry.key, r]));
    // ID를 저장하지 않은 정책 플립북의 ID는 목록을 그릴 때 한 번에 정한다(행마다 전체 화면·플립북을 다시 보지 않는다).
    const policies = unsavedPolicyIds(state!);
    const groups = arrangement().filter(g => shown.has(g.key) || g.items.some(item => isNewKey(item) || moving.has(item)));
    if (!groups.length) {
      box.innerHTML = `<p class="empty">${!made ? COPY.uiApp218 : query.UI ? COPY.uiApp028 : changedOnly.UI ? COPY.uiApp222 : COPY.uiApp029}</p>`;
      return;
    }
    const byKey = new Map(newFlipbooks.map(n => [n.key, n]));
    const identities = newIdentities();
    // 새로 만드는 플립북과 고치거나 옮긴 기존 플립북은 행에 상태 태그를 붙인다(2026-11-04 사용자 요청).
    const changedRows = changedIds();
    shownEdited = [...editedIds()].sort().join('|');
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
      const flagged = !open && all.some(item => !isNewKey(item) && (hasNewHistory(item) || !!state!.flipbooks.get(item)?.deletedAlert));
      // 접힌 페이지에 연결이 끊긴 플립북이 있으면 빨간 점 왼쪽(행과 같은 순서)에 연결 끊김 아이콘을 둔다(2026-11-05 사용자 요청).
      const unlinked = !open && all.some(item => unlinkedKeys.has(item));
      const name = pages.find(p => p.id === pageId)?.name ?? sections[0].name;
      return `<div class="group">
        <div class="group-bar"><button class="group-head flipbook-head" data-action="page-group" data-page="${esc(pageId)}" aria-expanded="${open}">
          <span class="caret">${open ? '▾' : '▸'}</span><span class="group-name">${esc(name)}</span>
          <span class="count">${all.length - drafts}${drafts ? ` <b class="new-count" title="${COPY.uiApp333}">+${drafts}</b>` : ''}</span>
          ${unlinked ? unlinkedGroupBadge() : ''}
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
            const title = identities.get(n.key)!.frameName;
            const editing = editingAt(n.key, 'list');
            const name = editing
              ? `<input class="title-input" data-input="new-title" data-key="${esc(n.key)}" value="${esc(n.title)}" placeholder="${esc(defaultTitle(newKind(n), newScreens(n)))}" aria-label="${COPY.uiApp203}">`
              : `<span class="name" data-edit-title="${esc(n.key)}" title="${COPY.uiApp314}">${esc(title)}</span>`;
            // 드래그 표시는 이름을 밀지 않고 행의 왼쪽 여백에 둔다. 제목은 이름을 더블클릭해 고친다(연필 없음, 2026-11-04 사용자 요청).
            return `<div class="row new-row${sel ? ' selected' : ''}" data-action="new-select" data-key="${esc(n.key)}" data-group="${esc(g.key)}" draggable="${!editing}" tabindex="0" aria-selected="${sel}" title="${COPY.uiApp334}">
              <span class="drag-handle" aria-hidden="true">⠿</span>
              <span class="name-wrap">${name}${editing ? '' : `<span class="row-state new-state">${COPY.rowStateNew}</span>`}</span>
              <button class="icon-button" data-action="new-remove" data-key="${esc(n.key)}" title="${COPY.uiApp105}" aria-label="${esc(title)} ${COPY.uiApp105}">${X_ICON}</button>
            </div>`;
          }
          const r = rows.get(item)!;
          const sel = selection.UI.has(r.entry.key);
          const flagged = !!r.entry.flipbookId && hasNewHistory(r.entry.flipbookId);
          // 들어 있던 화면이 사용 안 함이 된 새 템플릿 플립북도 알림 뱃지를 붙인다(상세의 경고에서 확인하면 지운다).
          const alerted = !!r.entry.flipbookId && !!state!.flipbooks.get(r.entry.flipbookId)?.deletedAlert;
          // 연결이 끊긴 플립북은 프레임이 없어 반영할 수 없으므로 제목을 고치지 않는다(오른쪽 영역의 연필과 같다).
          const record = r.entry.flipbookId ? state!.flipbooks.get(r.entry.flipbookId) : undefined;
          const fb = r.entry.estimate !== 'missing' ? record : undefined;
          const frameName = record ? flipbookIdentity(state!, record, policies).frameName : r.name;
          const name = fb && editingAt(fb.id, 'list')
            ? `<input class="title-input" data-input="fb-title" data-id="${esc(fb.id)}" value="${esc(fb.title)}" placeholder="${esc(defaultTitle(fb.kind, fb.screens))}" aria-label="${COPY.uiApp203}">`
            : `<span class="name"${fb ? ` data-edit-title="${esc(fb.id)}" title="${COPY.uiApp314}"` : ''}>${esc(frameName)}</span>`;
          // 기존 플립북도 드래그하거나 Alt+↑↓로 자리를 옮긴다(2026-10-22 사용자 요청). 연결이 끊긴 플립북은 캔버스에 프레임이 없어 옮기지 않는다.
          const movable = !!fb && movablePage && !editingAt(fb.id, 'list') && !newSubmitting;
          return `<div class="row${sel ? ' selected' : ''}" data-action="select" data-key="${esc(r.entry.key)}" data-group="${esc(g.key)}" draggable="${movable}" tabindex="0" aria-selected="${sel}">
            <span class="name-wrap">${name}${changedRows.has(r.entry.key) ? `<span class="row-state edit-state">${COPY.rowStateEdited}</span>` : ''}</span>
            ${r.entry.estimate === 'missing' ? unlinkedBadge() : ''}
            ${flagged || alerted ? `<span class="review-dot" role="img" title="${flagged ? COPY.newHistory : COPY.uiApp407}" aria-label="${flagged ? COPY.newHistory : COPY.uiApp407}"></span>` : ''}
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

  // 목록 새로고침(2026-10-23 사용자 요청): 캔버스 선택마다 목록을 맞추지 않으므로 회색 새로고침 아이콘과 마지막 동기화 시각을 보여 준다.
  function paintSyncStatus() {
    const el = root.querySelector<HTMLElement>('.list .sync-status');
    if (!el) return;
    // 좁은 목록에서도 한 줄에 들어가게 시:분만 쓰고, 날짜까지는 마우스를 올리면 보인다.
    const full = listSyncedAt && state ? formatTime(listSyncedAt, state.project.utcOffsetMinutes) : '';
    const time = full.slice(11, 16);
    el.innerHTML = `<button class="icon-button${refreshingList ? ' spinning' : ''}" data-action="refresh-list" title="${COPY.uiApp342}" aria-label="${COPY.uiApp342}">${REFRESH_ICON}</button><span${full ? ` title="${COPY.uiApp341} ${esc(full)}"` : ''}>${refreshingList ? COPY.uiApp343 : time ? `${COPY.uiApp344} ${esc(time)}` : ''}</span>`;
  }

  // 새로 만드는·고친·옮긴 플립북이 있으면 맨 아래 줄 오른쪽에 개수와 「전체 취소」·「모두 적용하기」를 둔다(2026-11-04 사용자 요청).
  function paintNewFooter() {
    $('.footer').innerHTML = pendingLine();
    renderToolbar();
  }
  function pendingLine(): string {
    const changed = changedIds().size;
    if (!newFlipbooks.length && !changed) return '';
    const counts = [newFlipbooks.length ? `${COPY.pendingNew} <b>${newFlipbooks.length}</b>${COPY.uiApp015}` : '', changed ? `${COPY.pendingEdited} <b>${changed}</b>${COPY.uiApp015}` : ''].filter(Boolean).join(' · ');
    return `<div class="pending-line">${createError ? `<span class="bad" role="alert">${esc(createError)}</span>` : ''}<span class="pending-counts">${counts}</span><span class="new-actions">${newActions()}</span></div>`;
  }

  function paintFooter(sharedModel?: ListModel) {
    if (tab !== 'ADMIN' && state && team() === 'UI') { paintNewFooter(); return; }
    if (tab === 'ADMIN' || !state) { $('.footer').innerHTML = ''; return; }
    const model = sharedModel ?? listModel(team());
    const unchecked = locked(team());
    // 누락이 있어도 최종 확인을 누를 수 있고, 누르면 첫 누락 항목으로 간다(2026-11-03 사용자 요청).
    const blocked = model.included === 0 || unchecked;
    const commentArea = team() === 'GUI' ? `<div class="batch-comment">
        <textarea data-input="comment" rows="2" placeholder="${COPY.commentPlaceholder}" aria-label="${COPY.uiApp064}" ${unchecked ? 'disabled' : ''}>${esc(comment.description)}</textarea></div>` : '';
    // 추가 설명을 입력하는 동안에는 하단을 다시 그리지 않는다(포커스 유지).
    const focused = document.activeElement as HTMLElement | null;
    if (focused?.closest('.batch-comment, .worker-field') && $('.footer').querySelector('.footer-status')) {
      $('.footer .footer-status').innerHTML = footerStatus(model, unchecked);
      $('.footer [data-action="prepare"]').toggleAttribute('disabled', blocked);
      return;
    }
    $('.footer').innerHTML = commentArea + `<div class="footer-line">${footerLine(model, unchecked, blocked)}</div>`;
  }

  // 아래 줄(2026-11-03 사용자 요청): 왼쪽 작업자 입력, 오른쪽 「배포 n · 필수 정보 누락 n」과 최종 확인.
  function footerLine(model: ListModel, unchecked: boolean, blocked: boolean): string {
    return `<label class="worker-field"><span>${COPY.coreDrafts003}</span><input data-input="worker" data-required-field="worker" value="${esc(workerName)}" aria-label="${COPY.coreDrafts003}" ${unchecked ? 'disabled' : ''}></label>
      <span class="footer-status">${footerStatus(model, unchecked)}</span>
      <button class="primary" data-action="prepare" ${blocked ? 'disabled' : ''}>${COPY.uiApp039}</button>`;
  }
  function footerStatus(model: ListModel, unchecked: boolean): string {
    return unchecked ? `<span class="note">${COPY.uiApp035}</span>`
      : `${COPY.uiApp036} <b class="${model.included ? 'count-on' : ''}">${model.included}</b> ${COPY.uiApp037} <b class="${model.invalid ? 'bad' : ''}">${model.invalid}</b>`;
  }


  // GUI Publish에서 새 화면으로 등록하는 항목. 이름·화면 관계를 입력한다.
  function registersNew(t: Team, entry: Entry): boolean {
    const draft = draftOf(t, entry);
    return t === 'GUI' && needsLink(entry) && draft.link !== 'replace' && !draft.notScreen;
  }

  // 화면 관계를 입력받는 항목: 신규 등록, 화면 바꾸기의 새 버전(신규 후보·배포 화면), 원본이 있는 배포 화면
  function relationEditable(t: Team, entry: Entry): boolean {
    if (registersNew(t, entry)) return true;
    const d = draftOf(t, entry);
    if (needsLink(entry)) return t === 'GUI' && d.link === 'replace' && !d.notScreen;
    return !!entry.screenId && entry.estimate !== 'missing';
  }

  // 화면 선택 드롭다운: 회색 ID 태그 + 이름, ID 순(2026-10-20 사용자 결정)
  // 「화면 없음」(값 '')은 맨 위에 두고, 케이스 기본 화면은 선택한 카테고리를 먼저 보여 준다.
  // 펼치면 머리 자리에 검색 입력이 겹쳐 나오고, Screen ID·이름으로 목록을 거른다(2026-10-27 사용자 요청).
  // suggested: 플러그인이 찾은 교체 짝. 목록 맨 위에 두고 오른쪽에 노란 「제안」 태그를 붙이며, 고른 값이면 머리에도 붙인다(2026-11-02 사용자 요청).
  function screenLabel(item: { code: string; name: string }, suggested = false): string {
    return `<span class="screen-option">${item.code ? `<span class="id-tag">${esc(item.code)}</span>` : ''}<span class="label">${esc(item.name)}</span>${suggested ? `<span class="suggest-tag">${COPY.uiApp419}</span>` : ''}</span>`;
  }
  function screenPicker(field: string, items: ScreenItem[], selectedValue: string | undefined, placeholder: string, opts: { disabled?: boolean; mixed?: boolean; thumbs?: Map<string, string | null>; preferredCategoryId?: string; suggested?: string | null; hideCanvas?: boolean } = {}): string {
    const ordered = sortScreenItems(items, opts.preferredCategoryId);
    const top = opts.suggested ? ordered.find(i => i.value === opts.suggested) : undefined;
    const sorted = top ? [top, ...ordered.filter(i => i !== top)] : ordered;
    const chosen = opts.mixed ? null : sorted.find(i => i.value === selectedValue);
    const head = chosen ? screenLabel(chosen, chosen === top) : `<span class="placeholder">${esc(opts.mixed ? COPY.uiApp175 : placeholder)}</span>`;
    return `<div class="screen-picker-control"><details class="tag-picker screen-picker${opts.disabled ? ' disabled' : ''}"><summary aria-label="${esc(placeholder)}" data-required-field="${esc(field)}">${head}<span class="dropdown-caret" aria-hidden="true"></span></summary>
      <input type="search" class="picker-search" placeholder="${COPY.uiApp358}" aria-label="${COPY.uiApp358}" autocomplete="off">
      <div class="tag-options">${sorted.length ? sorted.map(i => `<button data-action="pick" data-field="${field}" data-value="${esc(i.value)}" data-entry-key="${esc(i.entryKey ?? i.value)}" data-search="${esc(`${i.code} ${i.name}`.toLowerCase())}" class="tag-option" aria-pressed="${i.value === selectedValue}"${opts.thumbs?.get(i.value) ? ` data-thumb="${esc(opts.thumbs.get(i.value)!)}"` : ''}>${screenLabel(i, i === top)}</button>`).join('') + `<p class="note picker-empty" hidden>${COPY.uiApp028}</p>` : `<p class="note">${COPY.uiApp190}</p>`}</div></details>
      ${opts.hideCanvas ? '' : `<button class="icon-button canvas-pick" data-action="canvas-pick" data-field="${esc(field)}" aria-label="${COPY.canvasPickScreen}" aria-pressed="${!opts.disabled && canvasPick?.field === field}"${opts.disabled ? ' disabled' : ''}>${CURSOR_ICON}</button>`}</div>`;
  }
  function filterScreenPicker(picker: HTMLElement, query: string) {
    const q = query.trim().toLowerCase();
    let shown = 0;
    for (const option of picker.querySelectorAll<HTMLElement>('.tag-option')) {
      option.hidden = !!q && !option.dataset.search!.includes(q);
      if (!option.hidden) shown++;
    }
    const empty = picker.querySelector<HTMLElement>('.picker-empty');
    if (empty) empty.hidden = shown > 0;
  }
  // 등록된 화면은 왼쪽 목록과 같은 이름·Screen ID로 보여 준다(배포 전 수정값 포함, 2026-10-21 사용자 요청).
  const registeredItems = (filter: (id: string) => boolean = () => true): ScreenItem[] => {
    return pickerRegisteredScreens(state!, entries, drafts.GUI).filter(({ screen }) => filter(screen.id)).map(({ screen, entry }) => {
      const shown = entry ? guiDisplay(entry) : screen;
      return { value: screen.id, entryKey: entry?.key, code: shown.code, name: shown.name, categoryId: entry ? guiPlace(entry).categoryId : screen.categoryId };
    });
  };
  // 교체에 쓸 프레임: 신규 후보와 원본이 있는 다른 배포 화면(2026-10-27 사용자 요청: 잘못 배포한 화면으로도 교체).
  // 이름·ID·카테고리는 왼쪽 목록과 같은 입력 중인 값을 쓴다.
  const candidateItems = (self: string): ScreenItem[] => pickerFrameEntries(entries, drafts.GUI).filter(e => e.key !== self).map(e => ({
    value: e.key, entryKey: e.key, ...guiDisplay(e), categoryId: guiPlace(e).categoryId,
  }));

  // 등록 방식: 왼쪽에 선택 체크가 있는 아코디언(2026-11-03 사용자 요청). 이름 옆에 설명을 두고, 고른 항목만 펼쳐 그 메뉴를 보여 준다.
  interface Choice { value: string; label: string; hint: string; checked: boolean; body?: () => string }
  function choiceField(field: string, choices: Choice[], mixed: boolean): string {
    return `<div class="choices" role="radiogroup" aria-label="${esc(COPY.uiApp047)}"><h3 class="choices-title">${COPY.uiApp047}${mixedMark(mixed)}</h3>${choices.map(c => {
      const body = c.checked && c.body ? c.body() : '';
      return `<div class="choice${c.checked ? ' open' : ''}"><label class="choice-head"><input type="radio" name="${field}" value="${c.value}" data-field="${field}" ${c.checked ? 'checked' : ''}><span class="choice-label">${esc(c.label)}</span><span class="choice-hint" title="${esc(c.hint)}">${esc(c.hint)}</span></label>${body ? `<div class="choice-body">${body}</div>` : ''}</div>`;
    }).join('')}</div>`;
  }
  // 화면 바꾸기: 이 화면이 새 버전인지 두 버튼으로 고르고, 그 아래에서 짝이 될 화면을 고른다.
  // only: 고를 수 있는 한쪽(신규 후보는 새 버전, 원본이 없는 화면은 구 버전). 다른 쪽 버튼은 비활성화한다.
  function replaceSides(side: 'new' | 'old' | null, only: 'new' | 'old' | null, picker: string): string {
    const button = (value: 'new' | 'old', title: string, hint: string) =>
      `<button type="button" class="side-button" data-action="replace-side" data-side="${value}" aria-pressed="${side === value}"${only && only !== value ? ' disabled' : ''}><b>${esc(title)}</b><small>${esc(hint)}</small></button>`;
    return `<p class="choice-question">${COPY.replaceSideQuestion}</p><div class="side-buttons">${button('new', COPY.replaceSideNew, COPY.replaceSideNewHint)}${button('old', COPY.replaceSideOld, COPY.replaceSideOldHint)}</div>${picker}`;
  }
  // 구 버전 쪽에서 새 화면 드롭다운에 「제안」으로 둘 항목: 원본이 없는 화면은 교체 제안, 원본이 있으면 이 화면을 교체하도록 제안된 프레임
  function newVersionSuggestion(entry: Entry): string | null {
    if (entry.estimate === 'missing') return entry.pairKey;
    return entries.find(e => e.key !== entry.key && e.pairKey === entry.screenId)?.key ?? null;
  }

  // 처음 보이는 교체는 본체에 비교를 요청하고, 받으면 상세 패널을 다시 그린다.
  function replaceReasonSection(entry: Entry, screenId: string): string {
    const key = replaceReasonKey(entry, screenId);
    if (!replaceReasons.has(key)) { replaceReasons.set(key, null); bridge.send({ type: 'replaceReason', entryKey: entry.key, screenId }); }
    const got = replaceReasons.get(key);
    if (!got) return changeReasonNote(COPY.uiApp422);
    if (got.same) return changeReasonNote(COPY.uiApp421);
    return changeReasonSection(got.reason ?? undefined, reasonShown?.count ?? 0);
  }
  // 변경 감지된 화면의 근거. 확인 뒤에 계산 중이면 로딩을 보여 주고 그 화면을 먼저 계산하게 한다.
  function detectedReasonSection(entry: Entry): string {
    const frame = entry.frame;
    if (!frame?.reasonPending) return changeReasonSection(frame?.reason, reasonShown?.count ?? 0);
    const key = `${frame.nodeId}|${frame.fingerprint ?? ''}`;
    if (!reasonAsked.has(key)) { reasonAsked.add(key); bridge.send({ type: 'needReason', nodeId: frame.nodeId }); }
    return changeReasonLoading();
  }
  // 상세 패널의 「변경 사항」에 쓰는 근거: 기존 화면 교체는 교체할 화면과 비교한 결과, 그 밖에는 지난 배포와 비교한 결과
  function shownReason(entry: Entry): ChangeReason | undefined {
    const draft = drafts.GUI[entry.key];
    const target = draft && entry.frame ? replaceTarget(entry, draft) : null;
    return target ? replaceReasons.get(replaceReasonKey(entry, target))?.reason ?? undefined : entry.frame?.reason;
  }


  // 고른 행이 검색·변경된 화면만 보기에 가려 있으면 걸러내기를 풀고, 고른 행이 있는 묶음을 펼친다.
  function showSelectedRows(t: Team) {
    let model = listModel(t);
    const shown = new Set(model.groups.flatMap(group => group.visibleRows.map(row => row.entry.key)));
    if ([...selection[t]].some(key => !shown.has(key))) {
      query[t] = '';
      changedOnly[t] = false;
      model = listModel(t);
    }
    for (const group of model.groups)
      if (group.visibleRows.some(row => selection[t].has(row.entry.key))) expanded[t].add(group.key);
  }

  // 고른 제외 프레임 중 아직 제외 설정에 남은 것(관리에서 해제했으면 빠진다).
  function excludedPicked(): string[] {
    return state ? excludedPick.filter(id => state!.exclusions.get(id)?.active) : [];
  }

  function renderDetail() {
    if (canvasPick && (busyLabel || pdfBusy || tab !== 'GUI' || detailLocked('GUI') || selected.GUI !== canvasPick.current ||
        selection.GUI.size !== canvasPick.keys.length || canvasPick.keys.some(key => !selection.GUI.has(key)))) canvasPick = null;
    renderDetailContent();
    if (canvasPick && !root.querySelector('.canvas-pick[aria-pressed="true"]:enabled')) cancelCanvasPick();
  }

  function renderDetailContent() {
    if (team() !== 'UI' || currentNew() || !listTabOpen()) {
      leaveDescription();
      for (const id of identityDrafts.keys()) if (!identityEdited(id)) identityDrafts.delete(id);
    }
    if (tab === 'ADMIN' || team() !== 'UI' || currentNew() || !listTabOpen()) forgetScreensFold();
    $('.detail').classList.toggle('locked', tab !== 'ADMIN' && detailLocked(team()));
    $('.detail').classList.remove('flipbook-detail', 'new-flipbook-detail');
    if (tab === 'ADMIN') { forgetHistoryFold(); renderAdmin(); return; }
    if (team() === 'UI') { forgetHistoryFold(); if (currentNew()) renderNewDetail(); else renderFlipbookDetail(); return; }
    const t = team();
    // 캔버스에서 제외 프레임만 골랐으면 확인 전후와 관계없이 제외 안내와 해제 버튼을 가운데에 보인다.
    const picked = excludedPicked();
    if (picked.length && !selection[t].size) {
      $('.detail').innerHTML = `<div class="detail-hint excluded-hint"><div><p>${COPY.excludedScreenHint}</p><button data-action="excluded-unexclude">${COPY.uiApp121}</button></div></div>`;
      return;
    }
    // 변경사항 확인 전에는 안내 문구만 가운데에 보여 주고 입력은 숨긴다. 고른 배포 화면의 History는 아래에서 볼 수 있다(2026-11-03 사용자 요청).
    if (state && locked(t)) {
      const only = selectedEntries(t).length === 1 ? current() : null;
      const hint = `<div class="detail-hint"><p>${COPY.uiApp023}</p></div>`;
      $('.detail').innerHTML = only?.screenId ? `<div class="detail-main">${hint}</div><div class="detail-foot"><div class="history"></div></div>` : hint;
      if (only?.screenId) renderHistory();
      return;
    }
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
    // 제목은 Screen ID 없이 화면 이름만 한 줄로, 길면 말줄임한다. 「외 n개」는 줄이지 않는다(2026-11-03 사용자 요청).
    const title = guiDisplay(entry).name || parseFrameName(name).name;
    // 배포 스위치는 위쪽 고정 제목 줄 오른쪽에 둔다(2026-11-03 사용자 요청). 「변경된 화면만 보기」와 같은 스위치다.
    const includeSwitch = `<label class="switch include-switch"><span>${COPY.uiApp034}</span><input type="checkbox" role="switch" data-action="include-selected" aria-label="${COPY.uiApp034}" ${allIncluded ? 'checked' : ''}></label>`;
    let html = `<div class="detail-head"><div class="detail-title"><h2 title="${esc(title)}"><span class="title-name">${esc(title)}</span>${multi ? `<span class="title-more"> ${COPY.uiApp046} ${chosen.length - 1}${COPY.uiApp015}</span>` : ''}</h2>${includeSwitch}</div><div class="validation" aria-live="polite"></div></div>`;
    // 「비교 전」 화면을 골랐으면 안내를 상세 영역 가운데에 둔다(2026-11-03 사용자 요청).
    if (detailLocked(t)) html += locked(t) ? `<p class="note">${COPY.uiApp176}</p>` : `<div class="detail-hint entry-hint"><p>${COPY.uiApp181}</p></div>`;
    if (!multi) html += entry.notes.map(n => `<p class="note">${esc(n)}</p>`).join('');
    // 변경사항(변경 감지 이유)은 「변경 무시」를 고르기 전에 본다. 한 화면을 골랐을 때만 보여 준다.
    if (reasonShown?.key !== entry.key) reasonShown = null;
    // 기존 화면 교체(제안 포함)는 이 프레임을 교체할 화면의 지난 배포와 비교한 변경 사항을 보여 준다(2026-11-02 사용자 요청).
    const replacing = t === 'GUI' && !multi && entry.frame ? replaceTarget(entry, draft) : null;
    if (replacing) html += replaceReasonSection(entry, replacing);
    else if (t === 'GUI' && !multi && entry.estimate === 'changed' && changeDetected(entry)) html += detectedReasonSection(entry);
    // 변경 감지: 배포 토글 위에 「변경 무시」. 프레임 이름·카테고리가 바뀐 화면은 무시할 수 없다.
    // 배포를 켜 수정됨·이전 버전으로 정해진 화면은 변경 상태가 해결되었으므로 누를 수 없다.
    if (t === 'GUI' && chosen.every(e => changeDetected(e))) {
      const blocked = chosen.map(e => [e, ignoreBlock(state!, e)] as const).filter(([, why]) => why);
      const resolved = chosen.some(e => draftOf(t, e).included);
      html += `<div class="ignore-row"><button data-action="ignore-changes" title="${esc(COPY.uiApp183)}" ${blocked.length || resolved ? 'disabled' : ''}>${COPY.uiApp182}</button>${blocked.map(([e, why]) => `<p class="note">${multi ? `${esc(entryName(state!, e))}: ` : ''}${esc(why!)}</p>`).join('')}</div>`;
    }
    html += `<section class="detail-section disposition-section">`;
    // GUI는 배포를 켠 뒤에만 등록 방식과 입력 영역을 보여 준다(2026-10-20 사용자 결정).
    const showInputs = allIncluded;
    if (t === 'GUI' && allIncluded) {
      const excludeReason = `<label>${COPY.uiApp053}<input data-field="excludeReason" value="${esc(common(d => d.excludeReason))}" placeholder="${mixed(d => d.excludeReason) ? esc(COPY.uiApp175) : ''}"></label>`;
      // 여러 화면을 골라도 화면 바꾸기를 고를 수 있다(2026-11-02 사용자 요청). 짝이 될 화면은 화면마다 다르므로 드롭다운은 하나만 골랐을 때 보이고,
      // 여러 개일 때는 화면마다 고른 화면이나 교체 제안을 쓴다. 정해지지 않은 화면은 입력 검사(필수 정보)로만 알린다.
      // 등록 방식에는 요청받은 설명 외의 안내 문구를 붙이지 않는다(2026-11-03 사용자 요청).
      // 화면 바꾸기의 두 쪽. 새 버전은 이 화면이 이전 화면을 이어받고, 구 버전은 고른 새 화면이 이 화면을 이어받는다.
      const newSide = () => !multi ? screenPicker('replaceScreenId', registeredItems(id => id !== entry.screenId), draft.replaceScreenId, COPY.uiApp052, { suggested: entry.pairKey }) : '';
      const oldSide = () => !multi ? screenPicker('replaceWith', candidateItems(entry.key), draft.replacedBy, COPY.uiApp187, { suggested: newVersionSuggestion(entry) }) : '';
      if (chosen.every(e => needsLink(e))) {
        const allNew = chosen.every(e => { const d = draftOf(t, e); return d.link === 'new' && !d.notScreen; });
        const allReplace = chosen.every(e => { const d = draftOf(t, e); return d.link === 'replace' && !d.notScreen; });
        const allNotScreen = chosen.every(e => draftOf(t, e).notScreen);
        // 아직 배포하지 않은 화면은 이어받을 히스토리가 없으므로 구 버전 쪽은 비활성화한다(2026-11-03 사용자 결정).
        html += choiceField('disposition', [
          { value: 'new', label: COPY.uiApp048, hint: COPY.dispositionNewHint, checked: allNew },
          { value: 'replace', label: COPY.uiApp049, hint: COPY.dispositionReplaceHint, checked: allReplace, body: () => replaceSides('new', 'new', newSide()) },
          { value: 'not-screen', label: COPY.uiApp050, hint: COPY.dispositionNotScreenHint, checked: allNotScreen, body: () => excludeReason },
        ], multi && !allNew && !allReplace && !allNotScreen);
      } else if (chosen.every(e => e.estimate === 'missing')) {
        const allDelete = chosen.every(e => draftOf(t, e).retire !== 'replace');
        const allReplace = chosen.every(e => draftOf(t, e).retire === 'replace');
        // 원본 프레임이 없으므로 새 버전 쪽은 비활성화한다.
        html += choiceField('retire', [
          { value: 'delete', label: COPY.uiApp185, hint: COPY.dispositionDeleteHint, checked: allDelete },
          { value: 'replace', label: COPY.uiApp049, hint: COPY.dispositionReplaceHint, checked: allReplace, body: () => replaceSides('old', 'old', oldSide()) },
        ], multi && !allDelete && !allReplace);
      } else if (chosen.every(e => !!e.screenId && !!e.frame)) {
        // 이미 배포한 화면도 화면이 아님으로 고를 수 있다. 프레임은 제외 목록에 넣고 화면은 사용 안 함으로 바꾼다.
        // 화면 바꾸기: 새 버전이면 그 원본으로 다른 화면을 교체하고(2026-10-27 사용자 요청: 잘못 신규로 배포한 화면 바로잡기),
        // 구 버전이면 고른 새 화면이 이 화면을 이어받는다(2026-11-03 사용자 요청).
        // 배포 취소는 화면을 사용 안 함으로 바꾸고 프레임을 신규 후보로 돌린다(2026-10-27 사용자 요청).
        const allNotScreen = chosen.every(e => draftOf(t, e).notScreen);
        const allMerge = chosen.every(e => mergesInto(e, draftOf(t, e)));
        const allOld = chosen.every(e => isOldSide(e, draftOf(t, e)));
        const allReplace = chosen.every(e => { const d = draftOf(t, e); return mergesInto(e, d) || isOldSide(e, d); });
        const allUnpublish = chosen.every(e => isUnpublish(e, draftOf(t, e)));
        const allModify = chosen.every(e => { const d = draftOf(t, e); return !d.notScreen && !d.unpublish && !mergesInto(e, d) && !isOldSide(e, d); });
        const side = allMerge ? 'new' : allOld ? 'old' : null;
        html += choiceField('disposition', [
          { value: 'modify', label: COPY.uiApp243, hint: COPY.dispositionModifyHint, checked: allModify },
          { value: 'replace', label: COPY.uiApp049, hint: COPY.dispositionReplaceHint, checked: allReplace, body: () => replaceSides(side, null, side === 'new' ? newSide() : side === 'old' ? oldSide() : '') },
          { value: 'not-screen', label: COPY.uiApp050, hint: COPY.dispositionNotScreenHint, checked: allNotScreen, body: () => excludeReason },
          { value: 'unpublish', label: COPY.uiApp355, hint: COPY.dispositionUnpublishHint, checked: allUnpublish },
        ], multi && !allModify && !allNotScreen && !allReplace && !allUnpublish);
      }
    }
    html += '</section>';
    // 화면이 아님·교체 짝의 이전 화면은 정보를 입력하지 않는다.
    const inputs = showInputs && chosen.every(e => {
      const d = draftOf(t, e);
      return !d.notScreen && !d.unpublish && !isPrevious(e, d) && !(t === 'GUI' && isOldSide(e, d));
    });
    if (inputs) {
      const deleting = t === 'GUI' && chosen.every(e => isDeletion(e, draftOf(t, e)));
      void deleting;
      html += `<section class="detail-section"><h3>${COPY.uiApp055}</h3><div class="section-body">`;
      if (t === 'GUI' && !deleting && chosen.every(e => {
        const d = draftOf(t, e);
        return e.estimate !== 'missing' && !d.notScreen;
      })) html += categoryField(entry, draft, common(d => d.categoryId), mixed(d => d.categoryId));
      if (t === 'GUI' && chosen.every(e => !isDeletion(e, draftOf(t, e)))) {
        const names = chosen.map(e => draftName(state!, e, draftOf(t, e)));
        const nameMixed = multi && names.some(value => value !== names[0]);
        html += `<label class="wide">${COPY.uiApp056}<input data-field="name" data-required-field="name" value="${esc(nameMixed ? '' : names[0])}" placeholder="${nameMixed ? '-' : ''}"></label>`;
      }
      // 화면 관계는 Screen ID 위에 둔다(2026-11-03 사용자 요청). 화면 바꾸기의 새 버전도 입력받고, 처음 값은 교체할 화면의 관계다.
      if (t === 'GUI' && chosen.every(e => relationEditable(t, e))) {
        const relation = common(d => d.relation);
        const allCase = relation === 'case';
        const baseMixed = allCase && mixed(d => d.baseScreenId);
        // 기본 화면 후보는 입력 중인 관계로 거른다. 케이스였어도 같은 배포에서 독립으로 바꾸면 고를 수 있다(2026-11-03 사용자 요청).
        const planned = pendingCaseState(state!, entriesFor('GUI'), drafts.GUI);
        html += `<fieldset class="wide"><legend>${COPY.uiApp057}</legend>
        <label class="check"><input type="radio" name="relation" value="standalone" data-field="relation" ${relation === 'standalone' ? 'checked' : ''}> ${COPY.uiApp058}</label>
        <label class="check"><input type="radio" name="relation" value="case" data-field="relation" ${allCase ? 'checked' : ''}> ${COPY.uiApp059}</label>
        ${screenPicker('baseScreenId', [...registeredItems(id => !planned.screens.get(id)?.baseScreenId && id !== entry.screenId && id !== replaceTarget(entry, draft)), ...pendingScreens(state!, entriesFor('GUI'), drafts.GUI).filter(s => drafts.GUI[s.id]?.relation !== 'case' && s.id !== entry.key).map(s => ({ value: s.id, code: s.code, name: s.name, categoryId: s.categoryId ?? undefined }))], allCase ? common(d => d.baseScreenId) || undefined : undefined, COPY.uiApp061, { disabled: !allCase, mixed: baseMixed, preferredCategoryId: common(d => d.categoryId) })}</fieldset>`;
      }

      // 여러 화면의 Screen ID도 한 번에 바꾼다(2026-11-02 사용자 요청). 값이 서로 다르면 비워 두고 「-」로 표시한다.
      // 겹치는 ID는 입력 검사(등록 화면과 중복)와 배포 계획(같은 배포 안 중복)이 막는다.
      if (t === 'GUI' && chosen.every(e => !isDeletion(e, draftOf(t, e)))) {
        const codes = chosen.map(e => draftCode(state!, e, draftOf(t, e)));
        const codeMixed = multi && codes.some(value => value !== codes[0]);
        html += `<label class="wide">Screen ID<input data-field="code" data-required-field="code" value="${esc(codeMixed ? '' : codes[0])}"${codeMixed ? ' placeholder="-"' : ''} required></label>`;
      }
      html += tagField(t, draft, multi, common(d => d.tagId), mixed(d => d.tagId));
      html += '</div></section>';
    }
    // History(지난 배포 썸네일 + 히스토리)는 접어서 아래쪽에 고정한다(2026-11-03 사용자 요청: 위의 제목처럼 스크롤해도 남게).
    // 상세는 위(입력)·아래(History) 두 영역으로 나눠 각자 스크롤한다(2026-11-03 사용자 요청: 스크롤이 두 겹이 되지 않게).
    // 다시 그려도 두 영역의 스크롤 위치를 유지한다.
    const detailBox = $('.detail');
    const scrolled = { main: detailBox.querySelector('.detail-main')?.scrollTop ?? 0, foot: detailBox.querySelector('.detail-foot')?.scrollTop ?? 0 };
    detailBox.innerHTML = `<div class="detail-main">${html}</div>${multi ? '' : '<div class="detail-foot"><div class="history"></div></div>'}`;
    const main = detailBox.querySelector<HTMLElement>('.detail-main')!;
    main.scrollTop = scrolled.main;
    if (detailLocked(t)) {
      for (const control of root.querySelectorAll<HTMLInputElement>('.detail input, .detail select, .detail textarea, .detail button')) control.disabled = true;
      for (const summary of root.querySelectorAll<HTMLElement>('.detail summary')) { summary.tabIndex = -1; summary.setAttribute('aria-disabled', 'true'); }
    }
    const include = root.querySelector<HTMLInputElement>('.detail [data-action="include-selected"]');
    if (include) include.indeterminate = chosen.some(e => draftOf(t, e).included) && !allIncluded;
    renderValidation();
    renderHistory();
    const foot = detailBox.querySelector<HTMLElement>('.detail-foot');
    if (foot) foot.scrollTop = scrolled.foot;
  }

  // ── 썸네일 ──
  function thumbOf(uid: string): string | null {
    const rows = state?.gui.get(uid) ?? [];
    return rows[rows.length - 1]?.thumb?.hash ?? null;
  }
  // `node:` 키는 썸네일이 아니라 캔버스 프레임을 바로 내보낸 미리보기다(새 버전 페이지 비교).
  function requestThumbs(hashes: (string | null)[]) {
    previewCache.request(hashes);
  }
  // 그리드 카드의 이미지는 화면에 들어온 동안만 읽고 보관한다.
  const visibleImages = new Set<Element>();
  const observedImages = new Set<Element>();
  const lazyHashes = new Set<string>();
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  const releaseUnused = () => {
    if (releaseTimer) cancelLater(releaseTimer);
    releaseTimer = later(() => {
      releaseTimer = null;
      const visible = new Set([...visibleImages].map(el => (el as HTMLElement).dataset.imageHash));
      const unused = [...lazyHashes].filter(hash => !visible.has(hash));
      previewCache.drop(unused);
      for (const hash of unused) lazyHashes.delete(hash);
    }, 100);
  };
  const imageObserver = new IntersectionObserver(changes => {
    for (const change of changes) {
      if (change.isIntersecting) visibleImages.add(change.target);
      else visibleImages.delete(change.target);
    }
    const visible = new Set([...visibleImages].map(el => (el as HTMLElement).dataset.imageHash).filter((hash): hash is string => !!hash));
    for (const hash of visible) { lazyHashes.add(hash); requestThumbs([hash]); }
    const unused = [...lazyHashes].filter(hash => !visible.has(hash));
    for (const el of observedImages) if (el instanceof HTMLImageElement && unused.includes(el.dataset.imageHash ?? '') && !visibleImages.has(el)) {
      const empty = document.createElement('span');
      empty.dataset.imageHash = el.dataset.imageHash;
      empty.className = el.closest('.flow-card') ? 'flow-card-empty' : 'paste-thumb-empty';
      el.replaceWith(empty);
    }
    if (unused.length) releaseUnused();
  });
  const imageNodes = new MutationObserver(() => {
    const current = new Set(root.querySelectorAll('[data-image-hash]'));
    for (const el of observedImages) if (!current.has(el)) {
      imageObserver.unobserve(el);
      observedImages.delete(el);
      visibleImages.delete(el);
    }
    for (const el of current) if (!observedImages.has(el)) {
      observedImages.add(el);
      imageObserver.observe(el);
    }
    const present = new Set([...visibleImages].map(el => (el as HTMLElement).dataset.imageHash));
    const unused = [...lazyHashes].filter(hash => !present.has(hash));
    if (unused.length) releaseUnused();
  });
  imageNodes.observe(root, { childList: true, subtree: true });
  cleanups.push(() => { imageNodes.disconnect(); imageObserver.disconnect(); if (releaseTimer) cancelLater(releaseTimer); });
  function clearNodePreviews() {
    previewCache.clearNodes();
  }
  function retainThumbs() {
    const hashes = new Set<string>();
    for (const records of state?.gui.values() ?? []) {
      const hash = records[records.length - 1]?.thumb?.hash;
      if (hash) hashes.add(hash);
    }
    previewCache.retain(hashes);
  }
  function thumbImg(hash: string | null, alt: string): string {
    const url = hash ? thumbUrls.get(hash) : null;
    return url ? `<img src="${url}" alt="${esc(alt)}">`
      : `<span class="thumb-empty"${hash ? ` data-thumb-hash="${esc(hash)}" data-thumb-alt="${esc(alt)}"` : ''}>${hash && !failedPreviews.has(hash) ? COPY.uiApp001 : COPY.uiApp195}</span>`;
  }
  function updateDetailThumbs(hashes: string[]) {
    const changed = new Set(hashes);
    for (const placeholder of root.querySelectorAll<HTMLElement>('.detail .thumb-empty[data-thumb-hash]')) {
      const hash = placeholder.dataset.thumbHash;
      if (!hash || !changed.has(hash)) continue;
      const url = thumbUrls.get(hash);
      if (!url) { placeholder.textContent = COPY.uiApp195; continue; }
      const img = document.createElement('img');
      img.src = url;
      img.alt = placeholder.dataset.thumbAlt ?? '';
      placeholder.replaceWith(img);
    }
  }
  // 플립북에 들어 있는 화면 목록(2026-11-03 사용자 요청: 썸네일 그리드 대신 목록). 한 줄에 Screen ID·이름, 오른쪽에 상태 태그와 확인이 필요한 화면의 빨간 점을 둔다.
  // 상태 태그는 플립북이 가장 최근에 받은 태그를 만든 화면에만 붙인다(PRD §4.7). 마우스를 올리면 GUI 썸네일을 띄우고, 누르면 그 화면의 GUI 원본 프레임으로 이동한다(2026-11-03 사용자 요청: 화살표 왼쪽에 「GUI 보기」).
  function flipbookScreenList(flipbookId: string, changed = new Set<string>()): string {
    const fb = state?.flipbooks.get(flipbookId);
    if (!fb?.screens.length) return '';
    return `<ul class="fb-screen-list">${fb.screens.map(s => {
      const tag = state!.screens.get(s.uid)?.guiTag;
      const hash = thumbOf(s.uid);
      return `<li class="fb-screen" data-action="fb-screen-gui" data-uid="${esc(s.uid)}"${hash ? ` data-thumb="${esc(hash)}"` : ''}><span class="id-tag">${esc(s.code)}</span><span class="name">${esc(s.name)}</span>${tag ? `<span class="chip" style="--c:${esc(tag.color)}">${esc(tag.name)}</span>` : ''}${changed.has(s.uid) ? `<span class="review-dot" role="img" title="${COPY.newHistory}" aria-label="${COPY.newHistory}"></span>` : ''}<span class="fb-screen-go">${COPY.fbScreenGui}</span>${CHEVRON_RIGHT_ICON}</li>`;
    }).join('')}</ul>`;
  }

  // 고른 플립북 중 이전 형식 플립북(목록에 있고 프레임이 연결된, 화면 목록을 추적 GUI로 읽지 않는 플립북) ID
  function legacyChosen(chosen: Entry[]): string[] {
    return chosen.filter(e => {
      const fb = e.flipbookId ? state?.flipbooks.get(e.flipbookId) : undefined;
      return e.estimate !== 'missing' && !!fb && !fb.tracked;
    }).map(e => e.flipbookId!);
  }

  // UI Flipbook 상세(2026-11-03 사용자 요청): 제목 줄 오른쪽에 [히스토리] [목록에서 삭제] [적용하기], 그 아래 Page title, Screen ID·Chapter, 들어 있는 화면 목록.
  function renderFlipbookDetail() {
    const detail = $('.detail');
    const chosen = selectedEntries('UI').filter(e => !!e.flipbookId);
    const entry = current();
    detail.classList.toggle('flipbook-detail', !!state && !!entry?.flipbookId && !!chosen.length);
    if (!state || !entry?.flipbookId || !chosen.length) {
      forgetScreensFold();
      leaveDescription();
      for (const id of identityDrafts.keys()) if (!identityEdited(id)) identityDrafts.delete(id);
      detail.innerHTML = `<p class="empty">${COPY.uiApp217}</p>`; return;
    }
    const multi = chosen.length > 1;
    const notices = !multi ? newHistory.get(entry.flipbookId) ?? [] : [];
    const changed = new Set(notices.flatMap(row => row.screenIds ?? []));
    // 연결이 끊긴 플립북은 프레임이 없어 반영할 수 없으므로 제목·ID를 바꾸지 않는다.
    const fb = state.flipbooks.get(entry.flipbookId);
    const renamable = !multi && !!fb && entry.estimate !== 'missing';
    if (!renamable) leaveDescription();
    for (const id of identityDrafts.keys()) if (id !== (renamable ? fb.id : null) && !identityEdited(id)) identityDrafts.delete(id);
    // 제목 오른쪽에 목록과 같은 「수정 중」 태그(2026-11-04 사용자 요청). 고치는 동안 paintEditState가 켜고 끈다.
    const headTag = multi ? '' : `<span class="row-state edit-state head-state"${changedIds().has(entry.flipbookId) ? '' : ' hidden'}>${COPY.rowStateEdited}</span>`;
    // 제목은 지금 입력한 Page title을 그대로 보여 준다(비우면 자동 제목, 2026-11-04 사용자 요청).
    const typedTitle = !multi && fb ? identityDrafts.get(fb.id) : undefined;
    const headName = typedTitle && typedTitle.rev === fb!.rev ? typedTitle.title.trim() || defaultTitle(fb!.kind, fb!.screens) : entryName(state, entry);
    const heading = `<h2><span class="head-name">${esc(headName)}${multi ? ` ${COPY.uiApp046} ${chosen.length - 1}${COPY.uiApp015}` : ''}</span>${headTag}</h2>`;
    // 새 템플릿 플립북을 고르면 캔버스에서 화면 목록을 읽는다(PRD 1.1). 같은 플립북을 다시 그릴 때는 다시 읽지 않는다.
    if (!multi && fb?.tracked && followed !== fb.id) { followed = fb.id; bridge.send({ type: 'followFlipbook', id: fb.id }); }
    const deletedAlert = !multi && fb?.deletedAlert ? `<div class="deleted-alert" role="alert"><p>${COPY.uiApp405}</p><button data-action="fb-dismiss-deleted" data-id="${esc(fb.id)}">${COPY.uiApp406}</button></div>` : '';
    // 이전 형식 플립북(2026-11-02 사용자 결정: 플립북별로 변환): 화면 목록을 추적 GUI로 읽지 않는(tracked가 아닌) 플립북은 반영되지 않으므로
    // 맨 위에 안내와 「새 형식으로 변환」을 둔다. 여러 개를 고르면 고른 것 중 이전 형식 플립북만 함께 바꾼다.
    const legacy = legacyChosen(chosen);
    const legacyAlert = legacy.length ? `<div class="legacy-alert" role="alert"><p>${multi ? `${COPY.legacyAlertMulti} <b>${legacy.length}</b>${COPY.uiApp015}` : COPY.legacyAlert}</p><button data-action="fb-convert-legacy" title="${esc(COPY.legacyConvertHint)}">${COPY.legacyConvert}</button></div>` : '';
    // 목록에서 삭제(2026-11-02 사용자 결정): 빨간 글자, 한 번 누르면 고른 플립북을 모두 뺀다. 캔버스 프레임은 남는다.
    // 고른 플립북이 모두 연결 끊김이면 아래 연결 끊김 안내의 「목록에서 삭제」만 둔다.
    const removable = chosen.some(e => e.estimate !== 'missing');
    const removeButton = removable ? `<button class="remove-text" data-action="fb-remove-list" title="${esc(COPY.flipbookRemoveHint)}">${COPY.uiApp237}</button>` : '';
    let draft: { rev: number; title: string; screenId: string } | undefined;
    if (renamable) {
      draft = identityDrafts.get(fb.id);
      if (!draft || draft.rev !== fb.rev) {
        draft = { rev: fb.rev, title: fb.title, screenId: flipbookIdentity(state, fb).screenId };
        identityDrafts.set(fb.id, draft);
      }
    }
    // 고치는 중이면 「취소」·「적용하기」만, 아니면 「목록에서 삭제」만 둔다(2026-11-04 사용자 요청).
    titleActionsOf = editing => editing && renamable
      ? `<button data-action="fb-edit-cancel" data-id="${esc(fb!.id)}">${COPY.uiApp149}</button><button class="primary" data-action="fb-identity-save" data-id="${esc(fb!.id)}">${COPY.fbIdentitySave}</button>`
      : removeButton;
    const editing = renamable && (identityEdited(fb.id) || descEdited(fb.id));
    let top = `${legacyAlert}${deletedAlert}<div class="detail-head title-head">${heading}<div class="title-actions" data-editing="${editing}">${titleActionsOf(editing)}</div></div>`;
    if (renamable && draft) {
      const info = flipbookIdentity(state, { ...fb, title: draft.title, screenId: draft.screenId });
      top += `<div class="fb-identity props" data-id="${esc(fb.id)}">
        ${prop(COPY.fbPageTitle, `<input data-input="fb-page-title" value="${esc(draft.title)}" aria-label="${COPY.fbPageTitle}">`, true)}
        ${identityPair(`<input data-input="fb-screen-id" value="${esc(draft.screenId)}" placeholder="${esc(COPY.fbIdPlaceholder)}" aria-label="${COPY.fbScreenId}">`, info.chapter)}
      </div>
      <section class="fb-description" aria-label="${COPY.fbDescription}"><div class="fb-description-head">${COPY.fbDescription}</div><div class="fb-desc-body"></div></section>`;
    }
    // 연결이 끊긴 플립북은 목록에서 삭제할 수 있다. 한 번 누르면 삭제한다(2026-10-20 사용자 결정).
    const unlinked = chosen.filter(e => e.estimate === 'missing');
    if (unlinked.length) {
      top += `<div class="unlinked">${unlinkedBadge()}<p class="note">${multi ? `${COPY.uiApp238} <b>${unlinked.length}</b>${COPY.uiApp015}` : COPY.uiApp236}</p><button class="danger" data-action="remove-flipbooks">${COPY.uiApp237}</button></div>`;
    }
    // 들어 있는 화면 목록은 처음에 접어 두고, 보이는 플립북이 바뀌면 다시 접는다(2026-11-05 사용자 요청).
    // GUI 상세의 History처럼 아래쪽에 따로 고정한 영역에 두고, 위(관리 정보)와 각자 스크롤한다(2026-11-04 사용자 요청).
    let foot = '';
    if (multi || !fb || entry.estimate === 'missing') forgetScreensFold();
    else {
      if (fbScreensShownId !== fb.id) { fbScreensOpen = false; fbScreensShownId = fb.id; }
      const dot = notices.length ? `<span class="review-dot" role="img" title="${COPY.newHistory}" aria-label="${COPY.newHistory}"></span>` : '';
      foot = `<details class="history-fold fb-fold" data-fold="screens"${fbScreensOpen ? ' open' : ''}><summary class="fb-screens-head"><span class="dropdown-caret" aria-hidden="true"></span><span>${COPY.uiApp205} ${fb.screens.length}${COPY.uiApp015}</span>${dot}</summary>
        ${renderNewHistory(notices)}${fb.screens.length ? flipbookScreenList(entry.flipbookId, changed) : `<p class="note">${COPY.uiApp221}</p>`}</details>`;
    }
    // 같은 플립북을 다시 그릴 때(상태 갱신 등)는 두 영역의 스크롤 위치를 유지한다.
    const same = detail.querySelector<HTMLElement>(`.fb-top[data-id="${CSS.escape(entry.flipbookId)}"]`);
    const prevTop = same?.scrollTop ?? 0;
    const prevFoot = same ? detail.querySelector<HTMLElement>('.fb-foot')?.scrollTop ?? 0 : 0;
    detail.innerHTML = `<div class="fb-top" data-id="${esc(entry.flipbookId)}">${top}</div>${foot ? `<div class="detail-foot fb-foot">${foot}</div>` : ''}`;
    detail.querySelector<HTMLElement>('.fb-top')!.scrollTop = prevTop;
    const footBox = detail.querySelector<HTMLElement>('.fb-foot');
    if (footBox) footBox.scrollTop = prevFoot;
    if (renamable && listTabOpen()) mountDescription(fb.id);
  }

  function renderNewHistory(rows: HistoryNotice[]): string {
    if (!rows.length) return '';
    return '<section class="history fb-new-history" aria-label="' + COPY.newHistory + '"><h3>' + COPY.newHistory + ' ' + rows.length + COPY.uiApp015 + '</h3><table><tbody>'
      + rows.map(row => '<tr><td>' + esc(row.at) + '</td><td>' + esc(row.tag) + '</td><td>' + esc(row.description) + '</td><td>' + esc(row.worker) + '</td></tr>').join('')
      + '</tbody></table></section>';
  }

  // 플립북 Screen ID 입력과 그 ID에서 정해지는 Chapter(바꿀 수 없음)를 한 줄에 둔다. 기존 플립북 상세와 새 플립북 편집이 같이 쓴다.
  // Figma 속성 패널처럼 이름을 왼쪽에 붙인 한 줄 입력(2026-11-04 사용자 요청: 입력란 공간을 줄인다). 두 칸씩 한 줄, wide는 한 줄 전체.
  // side: 오른쪽 칸(이름 폭을 글자만큼만 쓴다)
  function prop(label: string, control: string, wide = false, tag: 'label' | 'div' = 'label', side = false): string {
    return `<${tag} class="prop${wide ? ' wide' : ''}${side ? ' side' : ''}"><span class="prop-label">${label}</span>${control}</${tag}>`;
  }
  function identityPair(screenIdInput: string, chapter: string): string {
    return prop(COPY.fbScreenId, screenIdInput) + prop(COPY.fbChapter, `<input data-identity-chapter value="${esc(chapter)}" disabled title="${esc(COPY.fbChapterAuto)}">`, false, 'label', true);
  }
  // 저장하지 않은 Page title·Screen ID 입력이 있는지. ID는 적용할 때와 같은 규칙(앞뒤 공백 제거, 대문자, 비우면 자동)으로 비교한다.
  function identityDirty(fb: Flipbook, draft: { title: string; screenId: string }): boolean {
    return draft.title.trim() !== fb.title.trim()
      || flipbookIdentity(state!, withFlipbookId(state!, fb, draft.screenId)).screenId !== flipbookIdentity(state!, fb).screenId;
  }

  // 필수 정보 확인 줄은 누락이 있을 때만 보인다. 배포를 끈(제외)·입력을 마친 화면에서는 숨긴다(2026-11-03 사용자 요청).
  function renderValidation() {
    const box = root.querySelector<HTMLElement>('.detail .validation');
    const entry = current();
    if (!box || !entry || !state) return;
    const chosen = selectedEntries();
    if (chosen.length > 1) {
      const checks = chosen.map(e => validation(team(), e));
      const invalid = checks.some(v => v.status === 'invalid');
      const included = chosen.filter(e => draftOf(team(), e).included).length;
      const status = invalid ? STATUS_LABEL.invalid : included ? STATUS_LABEL.ready : STATUS_LABEL.excluded;
      const details = [...new Set(checks.flatMap(v => [...v.missing, ...v.errors]))];
      box.hidden = !invalid;
      box.innerHTML = `<b class="${invalid ? 'bad' : ''}">${esc(status)}</b>${details.length ? ` - ${details.map(esc).join(', ')}` : ''} ${COPY.uiApp069} ${included}/${chosen.length}${COPY.uiApp015}`;
      renderFieldErrors();
      return;
    }
    const v = validation(team(), entry);
    const details = [...v.missing, ...v.errors];
    box.hidden = v.status !== 'invalid';
    box.innerHTML = `<b class="${v.status === 'invalid' ? 'bad' : ''}">${esc(STATUS_LABEL[v.status])}</b>${details.length ? ` - ${details.map(esc).join(', ')}` : ''}`;
    renderFieldErrors();
  }

  function missingRequired(t: Team, entry: Entry, field: string): boolean {
    const draft = draftOf(t, entry);
    if (!draft.included || draft.notScreen || draft.unpublish || isPrevious(entry, draft)) return false;
    if (t === 'GUI' && isOldSide(entry, draft)) return field === 'replaceWith' && !draft.replacedBy;
    if (field === 'tagId') return !draft.tagId;
    if (t !== 'GUI' || isDeletion(entry, draft)) return false;
    if (field === 'code') return !draftCode(state!, entry, draft).trim();
    if (field === 'replaceScreenId') return ((needsLink(entry) && draft.link === 'replace') || mergesInto(entry, draft)) && !draft.replaceScreenId;
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
      const filledNewItem = !!control.closest('[data-form="tag-add"]')
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

  // History 안 맨 위의 지난 배포 썸네일(2026-11-03 사용자 요청: 따로 접지 않고 제목 없이, 버전·시각을 캡션으로).
  // History를 펼칠 때 이미지를 불러온다.
  function historyThumb(entry: Entry): string {
    const rows = entry.screenId ? state?.gui.get(entry.screenId) ?? [] : [];
    const last = rows[rows.length - 1];
    if (!last || !state) return '';
    const hash = last.thumb?.hash ?? null;
    const open = historyOpenId === entry.screenId;
    if (open) requestThumbs([hash]);
    return `<figure class="history-thumb"><div class="thumbs">${open ? thumbImg(hash, formatFrameName(last.code, last.name)) : ''}</div>
      <figcaption>v${last.version} · ${esc(formatTime(last.committedAt, state.project.utcOffsetMinutes))}</figcaption></figure>`;
  }

  function renderHistory() {
    // GUI 화면의 배포 히스토리만 조회한다.
    const box = team() === 'GUI' ? root.querySelector('.detail .history') : null;
    const entry = current();
    const id = team() === 'GUI' ? entry?.screenId : entry?.flipbookId;
    if (!box || !entry || !id) { forgetHistoryFold(); return; }
    if (team() === 'GUI' && historyShownId !== id) { historyOpenId = null; historyShownId = id; }
    // 히스토리를 아직 받지 않았으면 여기서 요청한다. 목록 클릭뿐 아니라 캔버스에서 골라 선택이 바뀐 때도 보이게 한다(2026-11-03 회귀).
    // 같은 화면은 한 번만 요청하고, 받기 전에도 GUI는 지난 배포 썸네일로 History를 보여 준다.
    if (history?.id !== id && historyAsked !== id) { historyAsked = id; bridge.send({ type: 'history', team: team(), id }); }
    const rows = history?.id === id ? history.rows : [];
    const table = rows.length ? `<table><tbody>${rows.slice(0, 8).map(r => `
      <tr><td><span class="team ${r.team}">${r.team}</span></td><td>${esc(r.at)}</td>
      <td><span class="chip" style="--c:${esc(r.tag.color)}">${esc(r.tag.name)}</span></td><td>${esc(r.description)}${r.corrected ? ` <i>${COPY.uiApp072}</i>` : ''}</td><td>${esc(r.worker)}</td></tr>`).join('')}
      </tbody></table>` : '';
    if (team() !== 'GUI') { box.innerHTML = table; return; }
    // GUI 화면의 History는 접어서 상세 아래쪽에 고정하고, 펼치면 지난 배포 썸네일 → 히스토리 목록 순으로 보인다(2026-11-03 사용자 요청).
    const thumb = historyThumb(entry);
    box.innerHTML = thumb || table
      ? `<details class="history-fold"${historyOpenId === id ? ' open' : ''}><summary><span class="dropdown-caret" aria-hidden="true"></span><span>${COPY.uiApp071}</span></summary>${thumb}${table}</details>`
      : '';
  }

  function renderConfirm() {
    const overlay = $('.overlay');
    if (!plan || !state) { overlay.hidden = true; overlay.innerHTML = ''; return; }
    const c = plan.counts;
    const baseName = (id: string) => plan!.items.find(item => item.screenId === id)?.name ?? state!.screens.get(id)?.name ?? COPY.coreCompare001;
    const relationLabel = (baseId: string | null) => baseId
      ? `${COPY.uiApp059} (${baseName(baseId)})` : COPY.uiApp058;
    const relationNote = (item: Plan['items'][number]) => {
      if (item.team !== 'GUI') return '';
      const before = item.isNew ? null : state!.screens.get(item.screenId)?.baseScreenId ?? null;
      if (!item.isNew && before !== item.baseScreenId)
        return ` <small>${COPY.uiApp057}: ${esc(relationLabel(before))} → ${esc(relationLabel(item.baseScreenId))}</small>`;
      return item.baseScreenId ? ` <small>${COPY.uiApp091} ${esc(baseName(item.baseScreenId))}</small>` : '';
    };
    // 다른 화면을 교체해 사용 안 함이 되는 배포 화면
    const mergeNote = (item: Plan['items'][number]) => {
      const from = item.mergeFrom ? state!.screens.get(item.mergeFrom.screenId) : null;
      return from ? ` <small>${COPY.uiApp354} ${esc([from.code, from.name].filter(Boolean).join(' '))}</small>` : '';
    };
    const summary = plan.team === 'GUI'
      ? `${COPY.uiApp073} ${c.new} ${COPY.uiApp074} ${c.changed} ${COPY.uiApp184} ${c.deleted} ${COPY.uiApp077} ${plan.exclusions.length} ${COPY.uiApp356} ${plan.unpublished.length} ${COPY.uiApp078} ${c.metadata} ${COPY.uiApp079} ${plan.held}`
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
        <td>${esc(i.name)}${relationNote(i)}${mergeNote(i)}${i.isNew && i.newCategoryName ? ` <small>${COPY.uiApp092} ${esc(i.newCategoryName)}</small>` : ''}${!i.isNew && i.fromCategoryId !== i.categoryId ? ` <small>${COPY.uiApp093} ${esc(catName(i.fromCategoryId))} → ${esc(catName(i.categoryId))}</small>` : ''}</td>
        <td>${i.team === 'UI' && i.workType === 'changed' ? 'UI' : i.workType ? WORK_LABEL[i.workType] : 'UI'}</td>
        <td>${i.team} ${i.fromVersion ? `v${i.fromVersion} → ` : ''}v${i.toVersion}</td>
        <td><span class="chip" style="--c:${esc(i.tag.color)}">${esc(i.tag.name)}</span></td>
        <td>${esc(i.worker.name)}</td>${plan!.team === 'UI' ? `<td>${esc(i.description)}</td>` : ''}</tr>`).join('')}
      ${plan.exclusions.map(e => `<tr><td>${esc(e.name)}</td><td>${COPY.uiApp050}</td><td>—</td><td>—</td><td>${esc(e.reason)}</td></tr>`).join('')}
      ${plan.unpublished.map(e => `<tr><td>${esc(e.name)}</td><td>${COPY.uiApp355}</td><td>—</td><td>—</td><td>—</td></tr>`).join('')}
      </tbody></table>
      <div class="dialog-actions">
        ${plan.team === 'GUI' ? `<label class="switch publish-option quiet-publish" title="${COPY.quietPublishHint}"><span>${COPY.quietPublish}</span><input type="checkbox" role="switch" data-action="quiet-publish" aria-label="${COPY.quietPublish}" aria-description="${COPY.quietPublishHint}" ${quietPublish ? 'checked' : ''}></label>` : ''}
        ${plan.team === 'GUI' && plan.layersUnchanged ? `<label class="switch publish-option skip-layers"><span>${COPY.skipLayers}</span><input type="checkbox" role="switch" data-action="skip-layers" aria-label="${COPY.skipLayers}" ${skipLayers ? 'checked' : ''}></label>` : ''}
        <button data-action="cancel-plan">${COPY.uiApp095}</button>
        <button class="primary" data-action="commit" ${plan.blockers.length ? 'disabled' : ''}>${COPY.uiApp096}</button>
      </div></div>`;
  }

  function renderCreateScreenList() {
    const list = root.querySelector<HTMLElement>('.create-screen-list');
    const selectedList = root.querySelector<HTMLElement>('.create-selected-list');
    if (!list || !selectedList) return;
    const row = currentNew();
    if (!row) { list.innerHTML = ''; selectedList.innerHTML = ''; return; }
    const used = new Set([...state!.flipbooks.values()].filter(fb => fb.status === 'active').flatMap(fb => fb.screens.map(screen => screen.uid)));
    const planned = new Set(newFlipbooks.flatMap(item => item.uids));
    const screens = activeScreens();
    const picks = newPicks(row);
    const available = screens.filter(screen => !createUncreatedOnly || !used.has(screen.uid) && !planned.has(screen.uid));
    // 선택한 화면도 후보 목록에 남겨 같은 플립북·여러 플립북에서 반복해서 고를 수 있다.
    const cats = screenCategories(screens);
    if (createCategory !== ALL_CATEGORIES && !cats.some(([key]) => key === createCategory)) createCategory = ALL_CATEGORIES;
    const select = root.querySelector<HTMLSelectElement>('.new-flipbook-detail [data-create="category"]');
    if (select) {
      select.innerHTML = [[ALL_CATEGORIES, COPY.paste009], ...cats].map(([key, name]) => option(key, name, key === createCategory)).join('');
      select.disabled = !screens.length;
    }
    for (const button of root.querySelectorAll<HTMLElement>('.new-flipbook-detail [data-action="create-layout"]')) button.setAttribute('aria-pressed', String(button.dataset.layout === createLayout));
    const grid = createLayout === 'grid';
    list.classList.toggle('grid', grid);
    const shown = filterPickerScreens(available, createCategory, createQuery);
    // 후보는 목록/그리드, 선택한 화면은 항상 아래의 가로 썸네일 열이다.
    const candidate = (screen: GuiScreenInfo) => {
      const selected = row.uids.includes(screen.uid);
      const dot = used.has(screen.uid) ? '' : planned.has(screen.uid)
        ? '<span class="create-unused-dot planned" title="생성 목록에서 선택됨" aria-label="생성 목록에서 선택됨"></span>'
        : '<span class="create-unused-dot" title="제작된 플립북 없음" aria-label="제작된 플립북 없음"></span>';
      const attrs = ` data-uid="${esc(screen.uid)}" data-action="create-screen-add" tabindex="0" title="${esc(screen.name)}" aria-label="${esc(screen.name)} 선택"`;
      const label = (withId: boolean) => `<span class="create-screen-label">${withId ? `<span class="id-tag">${esc(screen.code)}</span>` : ''}<span class="name">${esc(screen.name)}</span></span>`;
      if (!grid) return `<div class="create-screen-option${selected ? ' is-selected' : ''}" data-thumb="${esc(screen.thumb?.hash ?? '')}"${attrs}>${label(true)}${dot}</div>`;
      const hash = screen.thumb?.hash;
      const url = hash ? thumbUrls.get(hash) ?? null : null;
      return `<div class="create-screen-option create-card${selected ? ' is-selected' : ''}"${attrs}>
        <span class="paste-thumb">${thumbnailImage(hash, url, hash && !failedPreviews.has(hash) ? '' : COPY.flow005, 'paste-thumb-empty')}<span class="id-tag picker-thumb-id">${esc(screen.code)}</span></span>
        <div class="paste-card-meta">${label(false)}${dot}</div>
      </div>`;
    };
    const selectedScroll = selectedList.scrollLeft;
    selectedList.innerHTML = picks.map(({ screen, at }, index) => {
      const hash = screen.thumb?.hash;
      const url = hash ? thumbUrls.get(hash) ?? null : null;
      return `<div class="create-selected-card create-screen-option" data-uid="${esc(screen.uid)}" data-index="${at}" draggable="true" tabindex="0" title="${esc(COPY.uiApp349)}" aria-label="${index + 1}. ${esc(screen.name)}">
        <span class="paste-thumb">${thumbnailImage(hash, url, hash && !failedPreviews.has(hash) ? '' : COPY.flow005, 'paste-thumb-empty')}<span class="id-tag picker-thumb-id">${esc(screen.code)}</span><button class="icon-button create-remove" data-action="create-screen-remove" data-index="${at}" title="${COPY.uiApp105}" aria-label="${esc(screen.name)} ${COPY.uiApp105}" draggable="false">${X_ICON}</button></span>
        <span class="create-selected-name"><span class="create-selected-order">${index + 1}</span><span class="name">${esc(screen.name)}</span></span>
      </div>`;
    }).join('') || '<p class="note">선택된 화면이 없습니다.</p>';
    selectedList.scrollLeft = selectedScroll;
    const count = root.querySelector<HTMLElement>('.new-flipbook-detail .create-selected-count');
    if (count) count.textContent = String(picks.length);
    const scrollTop = list.scrollTop;
    list.innerHTML = !available.length ? `<p class="note">${COPY.uiApp190}</p>`
      : shown.length ? shown.map(candidate).join('') : screenPickerEmpty('create', createCategory, createQuery);
    list.scrollTop = scrollTop;
    // 새 카드의 data-image-hash는 화면에 보일 때만 관찰자가 요청한다.
  }

  // 새 플립북 상세: 제목, 놓을 페이지·Section, 그 아래 화면 선택과 선택된 화면.
  // 다시 그려도 화면 목록의 스크롤을 유지한다.
  function renderNewDetail() {
    const detail = $('.detail');
    const n = currentNew();
    if (!n || !state) return;
    detail.classList.add('new-flipbook-detail');
    const listScroll = detail.querySelector<HTMLElement>('.create-screen-list')?.scrollTop ?? 0;
    const selectedScroll = detail.querySelector<HTMLElement>('.create-selected-list')?.scrollLeft ?? 0;
    const pageOptions = flipbookPageOptions();
    const chosen = newScreens(n);
    const title = newTitle(n);
    const identity = newIdentity(n);
    const auto = defaultTitle(newKind(n), chosen);
    const automatic = autoSection(n);
    const choices = sectionChoices(n.pageId).filter(s => s.key !== automatic.key);
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
    // 페이지와 섹션은 한 줄에 2열로 둔다(2026-11-04 사용자 요청). 버튼은 맨 아래 줄에 있다.
    // 머리는 기존 플립북 상세처럼 제목과 오른쪽 위 「만들기」(그 새 플립북 하나만 만든다). 그 아래 속성 줄: 페이지·섹션, 제목, Screen ID·Chapter.
    // 「취소」는 목록의 X와 같다(그 새 플립북을 목록에서 지운다, 2026-11-04 사용자 요청).
    detail.innerHTML = `<div class="detail-head title-head"><h2><span class="head-name">${esc(title)}</span><span class="row-state new-state head-state">${COPY.rowStateNew}</span></h2><div class="title-actions"><button data-action="new-remove" data-key="${esc(n.key)}" ${newSubmitting ? 'disabled' : ''}>${COPY.uiApp149}</button><button class="primary" data-action="new-create-one" data-key="${esc(n.key)}" ${newSubmitting || !pageOptions.length ? 'disabled' : ''}>${COPY.uiApp207}</button></div></div>
      <div class="new-place props">
        ${prop(COPY.newPageLabel, `<select data-input="new-page" aria-label="${COPY.newPageLabel}" ${pageOptions.length ? '' : 'disabled'}>${pageOptions.length ? pageOptions.map(pg => option(pg.id, pg.name, pg.id === n.pageId)).join('') : option('', COPY.uiApp106, true)}</select><button class="prop-button" data-action="create-page-manage" title="${COPY.createPageManage}" aria-label="${COPY.createPageManage}">${COPY.categoryManageShort}${CHEVRON_RIGHT_ICON}</button>`, false, 'div')}
        ${prop(COPY.uiApp338, sectionField, false, 'div', true)}
        ${prop(COPY.fbPageTitle, `<input class="title-input" data-input="new-title" data-key="${esc(n.key)}" value="${esc(title)}" placeholder="${esc(auto)}" aria-label="${COPY.fbPageTitle}">`, true)}
        ${identityPair(`<input data-input="new-screen-id" data-key="${esc(n.key)}" value="${esc(identity.screenId)}" placeholder="${esc(COPY.fbIdPlaceholder)}" aria-label="${COPY.fbScreenId}">`, identity.chapter)}
      </div>
      ${screenBrowser(n)}`;
    renderCreateScreenList();
    detail.querySelector<HTMLElement>('.create-screen-list')!.scrollTop = listScroll;
    detail.querySelector<HTMLElement>('.create-selected-list')!.scrollLeft = selectedScroll;
    const field = detail.querySelector<HTMLInputElement>('[data-input="new-title"]');
    if (field && typed) { field.value = typed.value; field.focus(); field.setSelectionRange(typed.start, typed.end); }
  }

  // 후보 목록 아래에 선택한 화면을 한 줄의 가로 썸네일로 둔다.
  function screenBrowser(row: NewFlipbook): string {
    return `<div class="create-browser">
        <div class="create-browser-head"><strong>${COPY.uiApp205} 선택</strong>${helpTip(COPY.createRightClickHint)}<span class="create-view">${screenLayoutToggle('create')}</span></div>
        <div class="create-columns">
          <div class="create-picker">${screenPickerFilters('create', createQuery)}</div>
          <label class="create-filter create-switch"><input type="checkbox" role="switch" data-action="create-uncreated-only" ${createUncreatedOnly ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span><span>생성된 플립북이 없는 화면</span></label>
          <div class="create-screen-list"></div>
          <div class="create-selected-head">${COPY.uiApp359} <b class="create-selected-count">${row.uids.length}</b></div>
          <div class="create-selected-list"></div>
        </div>
      </div>`;
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
    const pending = retryableDeliveries(s);
    const exclusions = [...s.exclusions.values()].filter(e => e.active);
    // GUI Publish와 UI Flipbook의 관리는 한 화면이다(2026-11-03 사용자 요청). 어느 쪽에서 열어도 모든 항목을 보여 준다.
    // 다시 그려도(템플릿 연결 뒤 등) 보던 자리를 지킨다. 메뉴와 내용은 따로 스크롤한다.
    const scrolled = { nav: root.querySelector('.admin-nav')?.scrollTop ?? 0, panels: root.querySelector('.admin-panels')?.scrollTop ?? 0 };
    $('.detail').innerHTML = `
      <section class="admin" data-form="scope"><h3>${COPY.uiApp097}</h3>
        <div class="inline"><select data-f="page" aria-label="${COPY.uiApp098}" ${availableScopePages.length ? '' : 'disabled'}>
          ${option('', availableScopePages.length ? COPY.uiApp099 : COPY.uiApp100, true)}
          ${availableScopePages.map(p => option(p.id, p.name, false)).join('')}
        </select></div>
        <div class="scope-pages" aria-label="${COPY.uiApp102}">
          ${scopeIds.length ? scopeIds.map(id => `<div class="scope-page"><span>${esc(pages.find(p => p.id === id)?.name ?? `${COPY.uiApp103}${id})`)}</span><button class="icon-button" data-action="admin-scope-remove" data-id="${esc(id)}" title="${COPY.uiApp105}" aria-label="${esc(pages.find(p => p.id === id)?.name ?? id)} ${COPY.uiApp104}">${X_ICON}</button></div>`).join('') : `<p class="note">${COPY.uiApp106}</p>`}
        </div>
        </section>
      ${renderScreenIdSection(s)}
      <section class="admin" data-form="flipbook"><h3>${COPY.uiApp107}</h3>
        <label>${COPY.uiApp108}</label>
        <div class="inline"><select data-f="page" aria-label="${COPY.uiApp210}" ${availableUiPages.length ? '' : 'disabled'}>
          ${option('', availableUiPages.length ? COPY.uiApp099 : COPY.uiApp100, true)}
          ${availableUiPages.map(p => option(p.id, p.name, false)).join('')}
        </select></div>
        <div class="scope-pages" aria-label="${COPY.uiApp108}">
          ${uiPageIds.length ? uiPageIds.map(id => `<div class="scope-page"><span>${esc(pages.find(p => p.id === id)?.name ?? `${COPY.uiApp103}${id})`)}</span><button class="icon-button" data-action="admin-ui-page-remove" data-id="${esc(id)}" title="${COPY.uiApp105}" aria-label="${esc(pages.find(p => p.id === id)?.name ?? id)} ${COPY.uiApp104}">${X_ICON}</button></div>`).join('') : `<p class="note">${COPY.uiApp106}</p>`}
        </div>
        </section>
      ${renderTemplateSection(s)}
      <section class="admin" data-form="history-date"><h3>${COPY.historyDateMenu}</h3>
        <label for="history-date-format">${COPY.historyDateLabel}</label>
        <div class="inline"><select id="history-date-format" data-f="format" aria-label="${COPY.historyDateLabel}">
          ${HISTORY_DATE_FORMATS.map(format => option(format, `${format} · ${formatShort(Date.now(), s.project.utcOffsetMinutes, format)}`, format === s.project.historyDateFormat)).join('')}
        </select><button data-action="admin-history-date">${COPY.uiApp110}</button></div></section>
      <section class="admin" data-form="gui-width"><h3>${COPY.uiApp225}</h3>
        <label>${COPY.uiApp226}</label>
        <div class="inline"><input type="number" data-f="width" data-input="admin-gui-width" min="${GUI_WIDTH_MIN}" max="${GUI_WIDTH_MAX}" step="1" value="${s.project.guiWidth}" aria-label="${COPY.uiApp226}"><button data-action="admin-gui-width">${COPY.uiApp110}</button></div>
        <p class="note gui-width-sizes">${guiWidthSizes(s.project.guiWidth)}</p>
        <p class="note">${COPY.uiApp227} ${COPY.uiApp228}</p></section>
      ${renderAutomaticPages()}
      ${renderUpdateSection()}
      <section class="admin" data-form="exclusions"><h3>${COPY.uiApp120}</h3>
        ${exclusions.length ? exclusions.map(e => `<div class="inline" data-form="exc" data-id="${e.id}"><span>${esc(e.name)}</span><small>${esc(e.reason)}</small><button data-action="admin-unexclude">${COPY.uiApp121}</button></div>`).join('') : `<p class="note">${COPY.uiApp122}</p>`}</section>
      <section class="admin" data-form="pending"><h3>${COPY.adminPending}</h3><p>${pending.length}${COPY.uiApp081}</p>${pending.length ? recoveryList(s) : ''}<p class="note">${COPY.recoveryRetryHint}</p><button data-action="retry" data-reconcile="1">${COPY.uiApp124}</button></section>
      <section class="admin" data-form="audit"><h3>${COPY.uiApp125}</h3>
        ${s.audit.slice(-15).reverse().map(a => `<div class="audit"><small>${esc(new Date(a.at).toLocaleString('ko-KR'))}</small> ${esc(a.actor.name)} · ${esc(a.action)}${a.reason ? ` · ${esc(a.reason)}` : ''}</div>`).join('') || `<p class="note">${COPY.uiApp122}</p>`}</section>
      ${issues.length ? `<section class="admin" data-form="issues"><h3>${COPY.uiApp126}</h3>${issues.map(i => `<div class="bad">${esc(i)}</div>`).join('')}</section>` : ''}
      <section class="admin danger-zone" data-form="reset"><h3>${COPY.adminDanger}</h3>
        <p class="note"><b>${COPY.uiApp127}</b>${COPY.uiApp128}
          ${COPY.uiApp129}</p>
        <button class="danger" data-action="reset-data">${resetArmed ? COPY.uiApp130 : COPY.uiApp131}</button>
        ${resetArmed ? `<button data-action="reset-cancel">${COPY.uiApp132}</button>` : ''}</section>`;
    // 메뉴를 왼쪽에 모으고 고른 항목만 오른쪽에 보여 준다(2026-11-02 사용자 요청). 관리자 메뉴는 반영 상태·감사 기록·진단·
    // 데이터 초기화를 한 화면에 함께 보여 준다.
    const detail = $('.detail');
    const sections = [...detail.querySelectorAll<HTMLElement>(':scope > section.admin')];
    // 메뉴는 넘긴 순서대로 놓는다.
    const pick = (forms: string[]) => forms.flatMap(form => sections.filter(section => section.dataset.form === form));
    const maintenance = document.createElement('section');
    maintenance.className = 'admin'; maintenance.dataset.form = 'maintenance';
    const maintenanceHeading = document.createElement('h3');
    maintenanceHeading.textContent = COPY.adminMaintenance;
    maintenance.append(maintenanceHeading, ...pick(['pending', 'audit', 'issues', 'reset']));
    if (typeof __PLUGIN_RELEASE__ !== 'boolean' || !__PLUGIN_RELEASE__) {
      const tools = document.createElement('section');
      tools.className = 'admin'; tools.dataset.form = 'template-migration';
      tools.innerHTML = `<h3>${TEMPLATE_MIGRATION_COPY.templateMigrationTitle}</h3><button data-action="template-migration-find">${TEMPLATE_MIGRATION_COPY.templateMigrationFind}</button>`;
      maintenance.insertBefore(tools, maintenance.children[1] ?? null);
      const repair = document.createElement('section');
      repair.className = 'admin'; repair.dataset.form = 'flow-repair';
      repair.innerHTML = `<h3>${FLOW_REPAIR_COPY.title}</h3><p class="note">${FLOW_REPAIR_COPY.hint}</p><button data-action="flow-repair-find">${FLOW_REPAIR_COPY.find}</button>`;
      maintenance.insertBefore(repair, tools.nextSibling);
    }
    // 묶음 이름이 null이면 이름 없이 구분선으로 나눈다(2026-11-03 사용자 요청: 작업 환경·템플릿·시스템, 구분선 아래 관리자).
    const groups: [string | null, HTMLElement[]][] = [
      [COPY.adminWorkSetup, pick(['scope', 'flipbook', 'screen-id-prefix'])],
      [COPY.adminTemplateGroup, pick(['template', 'history-date', 'gui-width'])],
      [COPY.adminSystem, pick(['exclusions', 'automatic-pages', 'update'])],
      [null, [maintenance]],
    ];
    const nav = document.createElement('nav');
    nav.className = 'admin-nav'; nav.setAttribute('aria-label', COPY.uiApp004);
    const panels = document.createElement('div');
    panels.className = 'admin-panels';
    panels.append(...groups.flatMap(([, items]) => items));
    detail.replaceChildren(nav, panels);
    accordion(panels);
    for (const [label, items] of groups) {
      if (!items.length) continue;
      const head = document.createElement(label ? 'h2' : 'div');
      head.className = label ? 'admin-group-label' : 'admin-nav-separator';
      if (label) head.textContent = label;
      nav.append(head);
      for (const item of items) {
        const form = item.dataset.form;
        const panel = panels.querySelector<HTMLDetailsElement>(`:scope > details[data-form="${form}"]`);
        if (!panel) continue;
        const button = document.createElement('button');
        button.className = 'admin-nav-item'; button.dataset.action = 'admin-nav'; button.dataset.key = panel.dataset.key ?? '';
        button.textContent = panel.querySelector(':scope > summary')?.textContent?.trim() ?? '';
        if (form === 'update' && needsUpdate(update)) button.insertAdjacentHTML('beforeend', UPDATE_BADGE);
        nav.append(button);
      }
    }
    syncAdminNav();
    nav.scrollTop = scrolled.nav;
    panels.scrollTop = scrolled.panels;
  }

  // 업데이트: 현재 버전 · 최신 버전 · 받기 링크. 최신 버전을 묻지 않는 창(미리보기·예시 화면)에는 최신 버전 줄이 없다.
  function renderUpdateSection(): string {
    return `<section class="admin" data-form="update"><h3>${COPY.adminUpdate}</h3>
        <div class="update-version"><span>${COPY.updateCurrent}</span><span>${esc(build.current)}</span></div>
        ${updateAsked ? `<div class="update-version"><span>${COPY.updateLatest}</span><span class="update-latest">${esc(update ? update.latest ?? COPY.updateUnknown : COPY.updateChecking)}</span></div>` : ''}
        <button class="link" data-action="update-download">${COPY.updateDownload}</button></section>`;
  }

  // 응답이 오면 관리의 업데이트 칸과 메뉴 알림 점만 고친다. 관리를 통째로 다시 그리면 입력 중인 값이 사라진다.
  function refreshUpdateSection() {
    const latest = root.querySelector('.update-latest');
    if (latest) latest.textContent = update ? update.latest ?? COPY.updateUnknown : COPY.updateChecking;
    const item = root.querySelector<HTMLElement>(`.admin-nav-item[data-key="${COPY.adminUpdate}"]`);
    if (item && needsUpdate(update) && !item.querySelector('.update-badge')) item.insertAdjacentHTML('beforeend', UPDATE_BADGE);
  }

  // 관리를 연다. panel: 펼칠 항목(제목). 관리를 열면 업데이트 안내 말풍선은 닫는다(알림 점은 남는다).
  function openAdmin(panel: string) {
    categoryManageKeys = [];
    closeVersion(false);
    tab = 'ADMIN';
    addMode = null; editMode = null;
    adminOpen = panel;
    updateBubbleClosed = true;
    renderAll();
    // 플러그인을 연 뒤 추가한 페이지(새 버전 페이지 등)도 고를 수 있게 페이지 목록을 다시 받는다.
    bridge.send({ type: 'pages' });
    bridge.send({ type: 'templateInfo', templateId: templatePick ?? undefined });
  }

  // 톱니바퀴로 관리를 열 때 펼칠 항목: 공통 항목이나 지금 모드의 항목을 보던 중이면 그대로, 아니면 지금 모드의 첫 항목.
  function adminPanelFor(m: Team, current: string | null): string {
    const other = ADMIN_MODE_PANELS[m === 'GUI' ? 'UI' : 'GUI'].map(([, title]) => title);
    return current && !other.includes(current) ? current : ADMIN_MODE_PANELS[m][0][1];
  }

  // 관리 메뉴: 고른 항목만 오른쪽에 펼치고 다른 항목은 접는다. 내용은 맨 위부터 보여 준다.
  function openAdminPanel(key: string) {
    const panels = root.querySelector<HTMLElement>('.admin-panels');
    if (!panels) return;
    adminOpen = key;
    for (const panel of panels.querySelectorAll<HTMLDetailsElement>(':scope > details.accordion')) panel.open = panel.dataset.key === key;
    panels.scrollTop = 0;
    syncAdminNav();
  }

  function syncAdminNav() {
    const open = root.querySelector<HTMLElement>('.admin-panels > details.accordion[open]')?.dataset.key;
    for (const item of root.querySelectorAll<HTMLElement>('.admin-nav-item')) item.setAttribute('aria-current', String(item.dataset.key === open));
  }

  // 목록에서 고른 템플릿. 고른 템플릿이 없거나 목록에 없으면 대표, 목록이 비었으면 null이다.
  function pickedTemplate(s: State): string | null {
    const entries = templateEntries(s.project);
    return (entries.find(t => t.nodeId === templatePick) ?? entries[0])?.nodeId ?? null;
  }

  // 관리의 템플릿(2026-10-28 사용자 결정, 2026-11-02 목록·대표): 템플릿 목록(대표 지정·삭제), 기본 템플릿 만들기,
  // 캔버스에서 고른 프레임 추가, 목록에서 고른 템플릿의 항목별 연결 상태와 다시 연결.
  function renderTemplateSection(s: State): string {
    const entries = templateEntries(s.project);
    const id = pickedTemplate(s);
    const picked = entries.find(t => t.nodeId === id);
    const info = templateInfo && templateInfo.id === id ? templateInfo : null;
    // 대표가 아닌 템플릿은 이미 있는 플립북을 반영할 때 쓰는 항목만 보여 준다(2026-11-02 사용자 결정).
    const defs = TEMPLATE_ITEMS.filter(d => picked?.representative || isFallbackItem(d.key));
    // 의미 단위 묶음(2026-11-05 사용자 결정). 부모 칸 안에 들어가거나 부모가 있어야 쓰이는 항목은 부모 아래에 들여쓴다.
    // 깊이는 지금 보이는 조상만 센다(대표가 아닌 템플릿에서 숨은 부모 때문에 홀로 들여써지지 않게).
    const shown = new Set(defs.map(d => d.key));
    const depthOf = (d: TemplateItemDef) => {
      let depth = 0;
      for (let key = d.parent; key; key = TEMPLATE_ITEMS.find(x => x.key === key)?.parent) if (shown.has(key)) depth++;
      return depth;
    };
    const groups = info && !info.error ? TEMPLATE_SECTIONS.map(g => ({ label: g.label, items: defs.filter(d => d.section === g.section) })).filter(g => g.items.length).map(g => `
        <h4 class="template-group">${esc(g.label)}</h4>
        <div class="template-items">${g.items.map(d => templateRow(d, info.items.find(i => i.key === d.key), depthOf(d))).join('')}</div>`).join('') : '';
    const name = picked ? esc(info?.name || picked.name || picked.nodeId) : '';
    return `<section class="admin" data-form="template"><h3>${COPY.uiApp392}</h3>
        <p class="note">${COPY.uiApp114}</p>
        <h4 class="template-group">${COPY.templateList} <span class="template-help" role="img" title="${esc(COPY.templateListHint)}" aria-label="${esc(COPY.templateListHint)}">${SMALL_HELP_ICON}</span></h4>
        <div class="template-items template-list">${entries.length ? entries.map(t => templateEntry(t, t.nodeId === id)).join('') : `<p class="note">${COPY.templateListEmpty}</p>`}</div>
        <div class="inline template-actions"><button data-action="admin-template-default">${COPY.uiApp393}</button><button data-action="admin-template-add">${COPY.templateAdd}</button></div>
        ${picked ? `<p class="note template-picked">${COPY.templateItemsOf} ${name}${info?.pageName ? ` · ${esc(info.pageName)}` : ''}</p>` : ''}
        ${picked && !picked.representative ? `<p class="note">${COPY.templateFallbackItems}</p>` : ''}
        ${info?.error ? `<p class="bad">${esc(info.error)}</p>` : ''}
        ${groups}</section>`;
  }

  // 템플릿 목록 한 줄(2026-11-02 사용자 결정): 이름 · 대표 표시나 「대표로 지정」 · 삭제(빨간 글자, 대표는 뺄 수 없어 없음).
  // 줄을 누르면(Enter·Space도 같다) 그 템플릿의 연결 항목을 아래에 보여 준다.
  function templateEntry(t: TemplateEntry, picked: boolean): string {
    const actions = t.representative
      ? `<span class="template-representative" title="${COPY.templateRepresentativeHint}">${COPY.templateRepresentative}</span>`
      : `<button data-action="admin-template-representative" data-node="${esc(t.nodeId)}" title="${COPY.templateSetRepresentativeHint}">${COPY.templateSetRepresentative}</button><button class="disconnect" data-action="admin-template-remove" data-node="${esc(t.nodeId)}" title="${COPY.templateRemoveHint}">${COPY.templateRemove}</button>`;
    return `<div class="template-item template-entry" data-action="admin-template-pick" data-node="${esc(t.nodeId)}" tabindex="0" aria-selected="${picked}" title="${COPY.templatePickHint}">
          <span class="template-item-name">${esc(t.name || t.nodeId)}</span>
          <span class="template-item-actions">${actions}</span></div>`;
  }

  // 템플릿 항목 한 줄(2026-11-02 사용자 요청): 상태 아이콘 · 항목 이름 · 받는 레이어 형식 아이콘 · 안내(?) · 연결/재연결·해제.
  // 연결된 레이어 이름은 보여 주지 않고, 연결된 항목을 누르면 그 레이어를 캔버스에서 고른다. 문제는 상태 아이콘 툴팁에 둔다.
  // depth: 들여쓰기 단계(부모 아래 항목)
  function templateRow(def: TemplateItemDef, item: TemplateItemState | undefined, depth = 0): string {
    const connected = !!item?.layers.length;
    const status = item?.problem || (def.required && !connected) ? 'need' : connected ? 'ok' : 'optional';
    const statusLabel = status === 'need' ? (item?.problem ? `${COPY.uiApp411} · ${item.problem}` : COPY.uiApp411) : status === 'ok' ? COPY.uiApp410 : COPY.uiApp412;
    const formats = KIND_FORMATS[def.kind].map(f => `<span class="format-${f}" title="${esc(FORMAT_LABEL[f])}" role="img" aria-label="${esc(FORMAT_LABEL[f])}">${FORMAT_ICON[f]}</span>`).join('');
    return `<div class="template-item" data-key="${def.key}"${depth ? ` style="--depth:${depth}"` : ''}${connected ? ` data-action="admin-template-show" tabindex="0" title="${COPY.uiApp400}"` : ''}>
        <span class="template-state ${status}" role="img" title="${esc(statusLabel)}" aria-label="${esc(statusLabel)}">${STATE_ICON[status]}</span>
        <span class="template-item-name">${esc(def.label)}</span>
        <span class="template-formats">${formats}</span>
        <span class="template-help" role="img" title="${esc(def.hint)}" aria-label="${esc(def.hint)}">${SMALL_HELP_ICON}</span>
        <span class="template-item-actions">
          <button ${connected ? '' : 'class="connect" '}data-action="admin-template-connect" data-key="${def.key}" title="${connected ? COPY.uiApp409 : COPY.uiApp401}">${connected ? COPY.uiApp408 : COPY.uiApp398}</button>
          ${def.required ? '' : `<button class="disconnect" data-action="admin-template-disconnect" data-key="${def.key}" title="${COPY.uiApp402}" ${connected ? '' : 'disabled'}>${COPY.uiApp399}</button>`}
        </span></div>`;
  }

  // 설정한 최대 폭에서 계산한 기본·작게의 최대 폭. 입력 중에도 바로 보여 준다.
  function guiWidthSizes(width: number): string {
    if (!validGuiWidth(width)) return COPY.controller067;
    return `${COPY.uiApp403} ${width}px · ${COPY.uiApp404} ${Number((width * SMALL_SCALE).toFixed(1))}px`;
  }

  // 설정의 각 항목을 펼침 칸으로 바꾼다. 하나만 열리고, 왼쪽 메뉴가 어느 칸을 열지 고른다(2026-11-02 사용자 요청).
  // 칸 머리는 오른쪽 내용의 제목으로만 쓴다. 다시 그려도 열어 둔 항목을 유지하고, 처음에는 첫 항목을 연다.
  function accordion(container: HTMLElement) {
    const sections = [...container.querySelectorAll<HTMLElement>(':scope > section.admin')];
    const keys = sections.map((section, i) => section.querySelector(':scope > h3')?.textContent?.trim() || String(i));
    const open = adminOpen && keys.includes(adminOpen) ? adminOpen : keys[0];
    sections.forEach((section, i) => {
      const heading = section.querySelector<HTMLElement>(':scope > h3');
      const details = document.createElement('details');
      details.className = `${section.className} accordion`;
      if (section.dataset.form) details.dataset.form = section.dataset.form;
      details.dataset.key = keys[i];
      const summary = document.createElement('summary');
      summary.tabIndex = -1;
      summary.innerHTML = `<span>${heading?.innerHTML ?? esc(keys[i])}</span>`;
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

  let sizeBeforeVersion: { width: number; height: number } | null = null;
  function openVersion() {
    if (versionOpen) return;
    sizeBeforeVersion = { width: root.offsetWidth, height: root.offsetHeight };
    bridge.send({ type: 'resize', width: Math.max(sizeBeforeVersion.width, VERSION_MIN.width), height: Math.max(sizeBeforeVersion.height, VERSION_MIN.height) });
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

  // 관리의 카테고리: 플랫폼 Prefix와 카테고리 이름·코드(2026-10-20 사용자 요청, 2026-11-03 관리로 모음). 저장하면 배포 화면의 ID도 바로 바꾼다.
  // 카테고리 하나를 한 줄(이름 · 코드 · 삭제)로 보여 주고, 고친 줄에만 저장을 띄운다. 안내는 ? 툴팁에 둔다.
  function renderScreenIdSection(s: State): string {
    const cats = [...s.categories.values()].filter(c => c.active).sort((a, b) => a.order - b.order);
    const prefix = s.project.screenIdPrefix;
    const sample = `${prefix ? `${prefix}_` : ''}${cats.find(c => c.code)?.code ?? 'HO'}_001`;
    const row = (c: Category) => {
      const armed = deleteArmed === c.id;
      return `<div class="category-row" data-form="cat-code" data-id="${esc(c.id)}">
        <input data-f="name" value="${esc(c.name)}" aria-label="${esc(c.name)} ${COPY.categoryNameLabel}">
        <input data-f="code" value="${esc(c.code ?? '')}" aria-label="${esc(c.name)} ${COPY.uiApp230}">
        <button class="category-save" data-action="admin-cat-save">${COPY.uiApp110}</button>
        <button class="icon-button${armed ? ' armed' : ''}" data-action="admin-cat-delete" title="${COPY.uiApp169}" aria-label="${esc(c.name)} ${COPY.uiApp169}">${X_ICON}</button>
        ${armed ? categoryDeleteNote(s, c.id) : ''}</div>`;
    };
    return `<section class="admin" data-form="screen-id-prefix"><h3>${COPY.uiApp162}</h3>
      <label class="help-label">${COPY.uiApp229}${helpTip(COPY.uiApp233)}</label>
      <div class="inline"><input data-f="prefix" value="${esc(prefix)}" placeholder="STB" aria-label="${COPY.uiApp229}"><button data-action="admin-screen-prefix">${COPY.uiApp110}</button></div>
      <p class="note">${COPY.uiApp231} ${esc(sample)}</p>
      <div class="category-row category-head"><span>${COPY.categoryNameLabel}</span><span>${COPY.uiApp230}</span>${helpTip(`${COPY.categoryManageHint} ${COPY.uiApp232}`)}</div>
      ${cats.length ? cats.map(row).join('') : `<p class="note">${COPY.uiApp234}</p>`}
      <div class="category-row category-add" data-form="cat-add">
        <input data-f="name" placeholder="${COPY.uiApp163}" aria-label="${COPY.uiApp163}">
        <input data-f="code" placeholder="${COPY.categoryCodeAuto}" aria-label="${COPY.uiApp230}">
        <button class="add-button" data-action="admin-cat-add">${ADD_LABEL}</button>
      </div>
      <div class="inline category-renumber"><button class="danger" data-action="admin-renumber">${renumberArmed ? COPY.uiApp246 : COPY.uiApp245}</button>${renumberArmed ? `<button data-action="renumber-cancel">${COPY.uiApp132}</button>` : ''}${helpTip(COPY.uiApp247)}</div></section>`;
  }

  // 카테고리 삭제를 한 번 누른 뒤의 안내. 사용 중인 화면이 있으면 그 수도 알린다.
  function categoryDeleteNote(s: State, id: string): string {
    const inUse = [...s.screens.values()].filter(x => x.categoryId === id && x.status === 'active').length;
    return `<p class="bad" role="status">${COPY.uiApp211}${inUse ? ` ${COPY.uiApp167} ${inUse}${COPY.uiApp168}.` : ''}</p>`;
  }

  // 관리 항목 옆의 회색 ? 아이콘. 안내 문구는 툴팁으로만 보여 준다.
  function helpTip(text: string): string {
    return `<span class="template-help" role="img" title="${esc(text)}" aria-label="${esc(text)}">${SMALL_HELP_ICON}</span>`;
  }

  // 관리 카테고리 줄: 이름이나 코드를 저장된 값과 다르게 고친 줄에만 저장을 보인다.
  function syncCategoryRow(row: HTMLElement) {
    const c = state?.categories.get(row.dataset.id ?? '');
    const name = row.querySelector<HTMLInputElement>('[data-f="name"]')!;
    const code = row.querySelector<HTMLInputElement>('[data-f="code"]')!;
    row.classList.toggle('dirty', !!c && (name.value.trim() !== c.name || code.value.trim() !== (c.code ?? '')));
  }

  // GUI 썸네일 보관 페이지를 만들거나 연다.
  function renderAutomaticPages(): string {
    return `<section class="admin" data-form="automatic-pages"><h3>${COPY.adminAutoPages}</h3>
      <div class="managed-page-card" data-form="thumbnails"><h4>${COPY.adminThumbTitle}</h4><p class="note">${COPY.adminThumbHint}</p>
      ${(() => { const page = managedPages.find(p => p.kind === 'thumbs'); return page ? `<p class="managed-page-name">${esc(page.name)}</p><button data-action="managed-page-open" data-id="${esc(page.id)}">${COPY.adminPageOpen}</button>` : `<p class="note">${COPY.adminNotCreated}</p><button data-action="thumb-page-create">${COPY.adminThumbCreate}</button>`; })()}</div></section>`;
  }

  // 태그: 이 탭(GUI 또는 UI)의 태그를 고르고, 같은 자리에서 추가·이름 변경·색 변경·사용 안 함을 한다.
  // 사용 안 함으로 바꾼 태그는 드롭다운에 보이지 않는다(2026-10-27 사용자 요청: 다시 사용하지 않는다).
  function tagField(t: Team, draft: Draft, multi = false, selectedId = draft.tagId ?? '', isMixed = false, label: string = COPY.uiApp088): string {
    const own = [...state!.tags.values()].filter(x => x.team === t);
    const chosen = selectedId ? own.find(x => x.id === selectedId && x.active) ?? null : null;
    const armed = chosen && tagArmed === chosen.id;
    const pill = (tag: typeof own[number]) => `<span class="chip" style="--c:${esc(tag.color)}">${esc(tag.name)}</span>`;
    const picker = `<details class="tag-picker"><summary aria-label="${COPY.uiApp040}" data-required-field="tagId">${chosen ? pill(chosen) : `<span class="placeholder">${isMixed ? esc(COPY.uiApp175) : COPY.uiApp040}</span>`}<span class="dropdown-caret" aria-hidden="true"></span></summary>
      <div class="tag-options"><button data-action="select-tag" data-id="" class="tag-option">${COPY.uiApp040}</button>
        ${own.filter(x => x.active).map(tag => `<button data-action="select-tag" data-id="${esc(tag.id)}" class="tag-option" aria-pressed="${tag.id === selectedId}">${pill(tag)}</button>`).join('')}
      </div></details>`;
    return `<div class="wide"><label>${esc(label)}</label>
      ${addMode === 'tag'
        ? `<div class="addable" data-form="tag-add"><input data-f="name" data-required-field="tagId" placeholder="${COPY.uiApp147}" aria-label="${COPY.uiApp147}"><button data-action="tag-add">${COPY.uiApp148}</button><button data-action="cancel-add">${COPY.uiApp149}</button>${swatches(`tag-color-${t}`, TAG_PALETTE[0].key)}</div>`
        : editMode === 'tag' && chosen
          ? `<div class="addable" data-form="tag-edit"><input data-f="name" value="${esc(chosen.name)}" aria-label="${COPY.uiApp151}"><button data-action="tag-edit">${COPY.uiApp148}</button><button data-action="cancel-add">${COPY.uiApp149}</button>${swatches(`tag-color-${t}`, chosen.colorKey)}<button class="link danger" data-action="tag-deactivate">${armed ? COPY.uiApp155 : COPY.uiApp156}</button></div>`
          : `<div class="addable">${picker}${chosen && !multi && !chosen.system ? `<button data-action="begin-edit" data-kind="tag" aria-label="${COPY.uiApp174}">${COPY.uiApp173}</button>` : ''}<button class="add-button" data-action="begin-add" data-kind="tag">${ADD_LABEL}</button></div>`}
    </div>`;
  }


  // GUI Publish의 카테고리: 선택만 한다. 추가·이름 변경·코드 변경·삭제는 「관리」 링크로 여는 관리의 카테고리에서 한다.
  function categoryField(entry: Entry, draft: Draft, selectedId = draft.categoryId ?? '', isMixed = false): string {
    const cats = [...state!.categories.values()].filter(c => c.active).sort((a, b) => a.order - b.order);
    const chosen = selectedId && state!.categories.get(selectedId)?.active ? selectedId : '';
    return `<div class="wide category-field">${entry.categoryMissing ? `<p class="bad">${COPY.uiApp161}</p>` : ''}
      <div class="field-head"><span>${COPY.uiApp162}</span><button class="link" data-action="category-manage">${COPY.categoryManage}${CHEVRON_RIGHT_ICON}</button></div>
      <select data-field="categoryId" data-required-field="categoryId" aria-label="${COPY.uiApp164}">${isMixed ? mixedOption() : ''}${option('', COPY.uiApp164, !chosen && !isMixed)}${cats.map(c => option(c.id, c.name, c.id === chosen)).join('')}</select></div>`;
  }

  // 삭제된 카테고리도 이름을 보여 준다.
  function catName(id: string | null): string {
    return id ? state?.categories.get(id)?.name ?? '-' : COPY.uiApp170;
  }

  // 토스트는 창 맨 아래에 띄운다. 하단 바(.footer)가 보이면 그 바로 위에 둔다. 하단 바가 비었거나 숨은 화면에서 높이를 고정값으로 비워 두면 토스트가 위로 떠 보였다.
  function renderToast() {
    const el = $('.toast');
    if (toast) el.style.bottom = `${$('.footer').offsetHeight + 8}px`;
    el.className = `toast${toast ? ' show ' + toast.kind : ''}`;
    el.textContent = toast?.text ?? '';
  }

  function renderAll() {
    renderRecovery();
    renderTabs(); renderToolbar(); renderList(); renderDetail(); renderFooter(); renderConfirm(); renderVersion(); renderToast();
    flows.render(flowOpen && mode === 'UI' && tab !== 'ADMIN' && !!state);
    paste.render(pasteOpen && mode === 'UI' && tab !== 'ADMIN' && !!state);
    const pdfShown = pdfOpen && mode === 'UI' && tab !== 'ADMIN' && !!state;
    pdf.render(pdfShown);
    if (pdfShown !== pdfTabSent) { pdfTabSent = pdfShown; bridge.send({ type: 'pdfTab', open: pdfShown }); }
    root.classList.toggle('admin-mode', tab === 'ADMIN');
  }

  function renderRecovery() {
    const count = state ? retryableDeliveries(state).length : 0;
    const warning = $('.recovery-status');
    root.classList.toggle('has-recovery', count > 0);
    warning.hidden = !count;
    if (!count) recoveryOpen = false;
    warning.innerHTML = count && state ? `<button class="recovery-toggle" data-action="recovery-toggle" aria-expanded="${recoveryOpen}"><span class="category-chevron" aria-hidden="true">${recoveryOpen ? '▾' : '▸'}</span>${COPY.recoveryAvailable} ${count}${COPY.uiApp081}</button><button data-action="retry">${COPY.uiApp124}</button>${recoveryOpen ? recoveryList(state) : ''}` : '';
  }

  // 미완료 반영 목록: 대상 종류·이름·이유를 한 줄로 보여 준다. 이유가 길면 줄임표로 자르고 툴팁에 전체를 둔다.
  function recoveryList(s: State): string {
    return `<ul class="recovery-list">${pendingRows(s).map(row => `<li class="recovery-item">
      <span class="recovery-kind">${row.kind === 'flipbook' ? COPY.recoveryKindFlipbook : COPY.recoveryKindGui}</span>
      <span class="recovery-name" title="${esc(row.name)}">${esc(row.name)}${row.count > 1 ? ` <span class="recovery-count">${row.count}${COPY.uiApp081}</span>` : ''}</span>
      <span class="recovery-reason" title="${esc(row.reason)}">${esc(row.reason)}</span></li>`).join('')}</ul>`;
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
    later(() => { if (toast === shown) { toast = null; renderToast(); } }, kind === 'error' ? 6000 : 3500);
  }

  // ── 조작 ─────────────────────────────────────────────

  function select(key: string, modifiers?: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
    const t = team();
    // UI 목록: 새 플립북을 고르거나 제목·Section을 입력하던 중이 아니면 목록 구성이 그대로이므로 선택 표시만 바꾼다.
    const uiSelectOnly = t === 'UI' && selectedNew === null && editingTitle === null && !addingSection && $('.list').dataset.team === 'UI';
    // 기존 플립북을 고르면 새 플립북 선택과 제목 입력을 닫는다.
    if (t === 'UI') { selectedNew = null; editingTitle = null; addingSection = false; renderFooter(); }
    else { excludedPick = []; unexcludedNodes.clear(); }
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
    const historyId = t === 'GUI' ? entry?.screenId : null;
    if (selection[t].size === 1 && historyId) { historyAsked = historyId; bridge.send({ type: 'history', team: t, id: historyId }); }
    if ((t === 'GUI' && $('.list').dataset.team === 'GUI') || uiSelectOnly) paintRowSelection(t); else renderList();
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

  // 여러 화면을 한 번에 켜고 끄는 컨트롤(「모두 배포하기」·묶음 체크·상세 배포 스위치). 바꿀 수 있는 화면 중
  // 하나라도 켜져 있으면(일부 선택 포함) 모두 끄고, 하나도 없을 때만 모두 켠다(2026-11-03 사용자 요청).
  function toggleIncluded(keys: string[]) {
    const t = team();
    const byKey = new Map(entriesFor(t).map(e => [e.key, e]));
    const anyOn = keys.some(key => { const entry = byKey.get(key); return !!entry && !entryLocked(t, entry) && draftOf(t, entry).included; });
    includeVisible(keys, !anyOn);
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
    else d.retire = undefined;
  }
  function unpairNew(newKey: string) {
    const n = guiDraft(newKey);
    if (!n?.replaceScreenId) return;
    if (guiDraft(n.replaceScreenId)?.replacedBy === newKey) releaseScreen(n.replaceScreenId);
    const entry = entries.find(e => e.key === newKey);
    if (entry && state) clearFill(state, entry, n, n.replaceScreenId);
    n.replaceScreenId = undefined;
    // 배포 화면은 비운 카테고리 입력을 자기 카테고리로 되돌린다(Screen ID는 비우면 저장값을 쓴다).
    const own = entry?.screenId ? state?.screens.get(entry.screenId) : null;
    if (own && n.categoryId === undefined && !entry!.categoryMissing) n.categoryId = own.categoryId ?? undefined;
  }
  function unpairScreen(screenKey: string) {
    const d = guiDraft(screenKey);
    if (!d?.replacedBy) return;
    const n = guiDraft(d.replacedBy);
    if (n?.replaceScreenId === screenKey) { n.replaceScreenId = undefined; n.included = false; }
    d.replacedBy = undefined;
  }
  // newKey는 신규 후보 또는 다른 화면을 교체하는 배포 화면이다. 교체하는 화면은 교체될 수 없고 교체될 화면은 다른 화면을 교체할 수 없으므로
  // 양쪽의 반대 짝은 먼저 푼다. 교체될 배포 화면은 「화면 수정」으로 돌린다.
  function pair(newKey: string, screenKey: string) {
    const n = guiDraft(newKey), d = guiDraft(screenKey);
    if (!n || !d) return;
    if (n.replaceScreenId !== screenKey) unpairNew(newKey);
    if (d.replacedBy !== newKey) unpairScreen(screenKey);
    if (n.replacedBy) unpairScreen(newKey);
    if (d.link === 'replace') { unpairNew(screenKey); d.link = undefined; }
    Object.assign(n, { included: true, notScreen: false, unpublish: false, link: 'replace', replaceScreenId: screenKey, retire: undefined });
    // 이전 화면의 Screen ID·카테고리를 채운다.
    if (state) fillFromScreen(state, n, screenKey);
    defaultTag(n, null);
    // 이전 화면은 화면 바꾸기의 구 버전 쪽이 된다. 목록에서 새 버전 아래에 남으므로 고르고 있던 행의 선택은 그대로 둔다(2026-11-03 사용자 요청).
    Object.assign(d, { included: true, notScreen: false, unpublish: false, replacedBy: newKey, retire: 'replace' });
  }
  // 원본이 있는 배포 화면의 화면 바꾸기 쪽을 고른다(2026-11-03 사용자 요청).
  // 새 버전: 이 원본으로 고른 이전 화면을 교체한다(교체 제안이 있으면 그 화면). 구 버전: 고른 새 화면이 이 화면을 이어받는다(이 화면을 교체하도록 제안된 프레임이 있으면 그 프레임).
  function setReplaceSide(entry: Entry, side: 'new' | 'old') {
    const d = guiDraft(entry.key);
    if (!d) return;
    d.notScreen = false;
    d.unpublish = false;
    defaultTag(d, null);
    if (side === 'new') {
      unpairScreen(entry.key);
      d.retire = undefined;
      d.link = 'replace';
      d.replaceScreenId ??= entry.pairKey ?? undefined;
      if (d.replaceScreenId) pair(entry.key, d.replaceScreenId);
      return;
    }
    unpairNew(entry.key);
    d.link = undefined;
    d.retire = 'replace';
    d.replacedBy ??= newVersionSuggestion(entry) ?? undefined;
    if (d.replacedBy) pair(d.replacedBy, entry.key);
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
    // 다른 화면을 교체하는 배포 화면은 신규 후보의 교체처럼 짝을 함께 켜고 끈다. 끄면 교체할 화면은 짝에서 놓되 고른 화면은 기억한다.
    if (mergesInto(entry, d) && d.replaceScreenId) {
      if (checked && guiDraft(d.replaceScreenId)) { pair(entry.key, d.replaceScreenId); return; }
      d.included = checked;
      if (!checked && guiDraft(d.replaceScreenId)?.replacedBy === entry.key) {
        const other = guiDraft(d.replaceScreenId)!;
        other.included = false;
        if (entries.find(e => e.key === d.replaceScreenId)?.pairKey !== entry.key) releaseScreen(d.replaceScreenId);
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
  function cancelCanvasPick() {
    canvasPick = null;
    for (const button of root.querySelectorAll<HTMLElement>('.canvas-pick')) button.setAttribute('aria-pressed', 'false');
  }

  function pick(field: string, value: string) {
    const t = team();
    const entry = current();
    if (!entry || detailLocked(t)) return;
    canvasPick = null;
    if (field === 'replaceScreenId') pair(entry.key, value);
    else if (field === 'replaceWith') pair(value, entry.key);
    else if (field === 'baseScreenId') {
      for (const e of selectedEntries(t)) if (relationEditable(t, e)) {
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

  on('click', ev => {
    const target = ev.target as HTMLElement;
    // 목록 행 안의 제목 입력을 누르면 행을 다시 고르지 않는다(다시 그리면 입력이 사라진다).
    if (target.closest('.list-box .title-input')) return;
    const el = target.closest('[data-action]') as HTMLElement | null;
    if (!el) return;
    const action = el.dataset.action!;
    if ((busyLabel || pdfBusy) && !WHILE_BUSY.has(action)) return;
    if (action.startsWith('flow-') && flows.handle(action, el)) return;
    if (action.startsWith('paste-') && paste.handle(action, el)) return;
    if (action.startsWith('track-') && trackList.handle(action, el)) return;
    const t = team();
    if (locked(t) && !BEFORE_CHECK.has(action)) { ev.preventDefault(); return; }
    if (canvasPick && action !== 'canvas-pick' && action !== 'pick') cancelCanvasPick();
    if ((typeof __PLUGIN_RELEASE__ !== 'boolean' || !__PLUGIN_RELEASE__) && templateMigration?.action(action, el)) return;
    if ((typeof __PLUGIN_RELEASE__ !== 'boolean' || !__PLUGIN_RELEASE__) && flowRepair?.action(action, el)) return;
    switch (action) {
      case 'switch-mode':
        closeVersion(false);
        mode = mode === 'GUI' ? 'UI' : 'GUI';
        tab = mode;
        addMode = null; editMode = null;
        bridge.send({ type: 'switchMode', mode });
        if (mode === 'UI') bridge.send({ type: 'guiScreens' });
        if (mode === 'GUI' && !workerAsked) { workerAsked = true; bridge.send({ type: 'workerNameGet' }); }
        renderAll();
        break;
      case 'settings':
        if (tab !== 'ADMIN') { openAdmin(adminPanelFor(mode, adminOpen)); break; }
        categoryManageKeys = [];
        closeVersion(false);
        tab = mode;
        addMode = null; editMode = null;
        renderAll();
        break;
      case 'update-go': openAdmin(COPY.adminUpdate); break;
      case 'update-close': updateBubbleClosed = true; placeUpdateBubble(); break;
      case 'update-download': bridge.send({ type: 'updateDownload' }); break;
      // 만들기 전 새 플립북은 설정을 다녀와도 남는다.
      case 'category-manage':
        categoryManageKeys = selectedKeys('GUI');
        tab = 'ADMIN'; adminOpen = COPY.uiApp162; addMode = null; editMode = null; renderAll();
        break;
      case 'create-page-manage': tab = 'ADMIN'; adminOpen = COPY.uiApp107; renderAll(); bridge.send({ type: 'templateInfo', templateId: templatePick ?? undefined }); break;
      case 'register-existing': bridge.send({ type: 'registerFlipbooks' }); break;
      // 상세의 「적용하기」: 이 플립북의 제목·ID·Description 수정만 반영한다.
      case 'fb-identity-save': {
        const edit = editOf(el.dataset.id!);
        if (edit) bridge.send({ type: 'applyFlipbookEdits', edits: [edit] });
        break;
      }
      case 'new-add': if (addNew()) { revealSelection = true; renderList(); } break;
      case 'new-select': if (target.closest('button')) break; selectNew(el.dataset.key!); break;
      case 'new-remove': ev.stopPropagation(); removeNew(el.dataset.key!); break;
      // 새 플립북 상세의 「만들기」: 그 새 플립북 하나만 만든다(2026-11-04 사용자 요청).
      case 'new-create-one': submitOne(el.dataset.key!); break;
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
      case 'create-layout': createLayout = el.dataset.layout === 'grid' ? 'grid' : 'list'; renderCreateScreenList(); break;
      case 'create-search-all': createCategory = ALL_CATEGORIES; renderCreateScreenList(); break;
      case 'create-uncreated-only': createUncreatedOnly = (el as HTMLInputElement).checked; renderCreateScreenList(); break;
      // 같은 화면을 다시 누르면 한 번 더 넣는다(2026-11-05 사용자 요청). 빼기는 그 자리 하나만 뺀다.
      case 'create-screen-add': {
        const row = currentNew();
        const uid = el.dataset.uid;
        if (!row || !uid) break;
        screensChanged(row, () => { row.uids = [...row.uids, uid]; });
        break;
      }
      case 'create-screen-remove': {
        const row = currentNew();
        const at = Number(el.dataset.index);
        if (!row || !Number.isInteger(at) || at < 0 || at >= row.uids.length) break;
        screensChanged(row, () => { row.uids = row.uids.filter((_, i) => i !== at); });
        break;
      }
      // 기존 플립북 상세의 「취소」: 이 플립북의 제목·ID·Description 수정을 버린다.
      case 'fb-edit-cancel': discardEditsOf(el.dataset.id!); break;
      case 'fb-desc-toggle': toggleDescription(el.dataset.id!, (el as HTMLInputElement).checked); break;
      case 'create-submit': submitAll(); break;
      case 'arrange-skip': submitAll(false); break;
      case 'arrange-apply': submitAll(true); break;
      case 'new-dialog-close': newDialog = null; renderNewDialog(); break;
      case 'new-cancel-confirm': finishNew(); discardEdits(); renderList(); renderDetail(); renderFooter(); break;
      case 'bulk-open': {
        if (!state) break;
        if (!createScreens.length) bridge.send({ type: 'guiScreens' });
        const options = flipbookPageOptions();
        // 지금 보고 있는 플립북 페이지(2026-10-23 사용자 요청). 플립북 페이지가 아니면 고른 새 플립북의 페이지, 기본 플립북 페이지 순이다.
        const pageId = options.find(pg => pg.current)?.id ?? currentNew()?.pageId ?? options.find(pg => pg.id === state!.project.flipbookPageId)?.id ?? options[0]?.id ?? '';
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
      case 'refresh-list':
        if (refreshingList) break;
        refreshingList = true;
        paintSyncStatus();
        bridge.send({ type: 'refreshList' });
        break;
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
        toggleIncluded(listModel(t).groups.flatMap(g => g.visibleRows.map(r => r.entry.key)));
        break;
      }
      case 'include-group': {
        ev.stopPropagation();
        const group = listModel(t).groups.find(g => g.key === el.dataset.group);
        if (group) toggleIncluded(group.visibleRows.map(r => r.entry.key));
        break;
      }
      case 'include-selected': toggleIncluded(selectedKeys(t)); break;
      case 'canvas-pick':
        if (detailLocked(t) || el.matches(':disabled')) break;
        canvasPick = canvasPick?.field === el.dataset.field ? null : { field: el.dataset.field!, keys: selectedKeys('GUI'), current: selected.GUI };
        for (const button of root.querySelectorAll<HTMLElement>('.canvas-pick')) button.setAttribute('aria-pressed', String(button.dataset.field === canvasPick?.field));
        break;
      case 'pick': pick(el.dataset.field!, el.dataset.value!); break;
      case 'fb-remove-list': {
        const ids = selectedEntries('UI').filter(e => !!e.flipbookId).map(e => e.key);
        if (!ids.length) break;
        bridge.send({ type: 'removeFlipbooks', ids, withFrames: true });
        el.setAttribute('disabled', '');
        break;
      }
      case 'remove-flipbooks': {
        const ids = selectedEntries('UI').filter(e => e.estimate === 'missing').map(e => e.key);
        if (!ids.length) break;
        bridge.send({ type: 'removeFlipbooks', ids });
        el.setAttribute('disabled', '');
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
      case 'replace-side': {
        if (team() !== 'GUI' || detailLocked('GUI')) break;
        const side = el.dataset.side === 'old' ? 'old' : 'new';
        for (const e of selectedEntries('GUI')) if (e.screenId && e.frame && e.estimate !== 'missing' && e.estimate !== 'retired') setReplaceSide(e, side);
        renumberCodes(); renderDetail(); renderList(); renderFooter();
        break;
      }
      case 'select': if (target.closest('input')) return; select(el.dataset.key!, ev); break;
      // 캔버스에서 고른 제외 프레임의 제외를 푼다. 신규 후보로 목록에 다시 나오면 그 행을 고른다(아래 'entries').
      case 'excluded-unexclude': {
        const ids = excludedPicked();
        unexcludedNodes = new Set(ids.map(id => state!.exclusions.get(id)!.nodeId));
        for (const id of ids) admin({ op: 'unexclude', id });
        break;
      }
      case 'nav': navigate(el.dataset.target as NavTarget); break;
      case 'nav-suggested': {
        const s = current()?.suggestedScreenId;
        if (s) navigate('source', s);
        break;
      }
      case 'begin-add': addMode = el.dataset.kind as typeof addMode; editMode = null; renderDetail(); (root.querySelector('.detail .addable input') as HTMLInputElement | null)?.focus(); break;
      case 'begin-edit': editMode = el.dataset.kind as typeof editMode; addMode = null; renderDetail(); (root.querySelector('.detail .addable input') as HTMLInputElement | null)?.focus(); break;
      case 'cancel-add': addMode = null; editMode = null; renderDetail(); break;
      case 'prepare': {
        // 누락이 있으면 확인 창 대신 첫 누락 항목으로 간다. GUI 작업자가 비었으면 그 입력란으로 간다(2026-11-03 사용자 요청).
        const invalid = entriesFor(t).find(e => validation(t, e).status === 'invalid');
        if (invalid) {
          revealed[t].add(invalid.key);
          query[t] = '';
          changedOnly[t] = false;
          $('.list').dataset.team = '';
          for (const g of listModel(t).groups) expanded[t].add(g.key);
          renderToolbar();
          select(invalid.key);
          break;
        }
        if (t === 'GUI' && !workerName.trim()) {
          const input = root.querySelector<HTMLInputElement>('.footer [data-input="worker"]');
          input?.classList.add('input-error');
          input?.focus();
          break;
        }
        // 전체 확인 전에는 「비교 전」 화면의 입력은 보내지 않는다(배포 대상에서 빠진다).
        const byKey = new Map(entriesFor(t).map(e => [e.key, e]));
        const sendable = Object.fromEntries(Object.entries(drafts[t]).filter(([key]) => { const e = byKey.get(key); return !e || !entryLocked(t, e); }));
        bridge.send({ type: 'prepare', team: t, drafts: sendable, ...(t === 'GUI' ? { comment: { ...comment, worker: workerName.trim() } } : {}) });
        break;
      }
      case 'cancel-plan': if (plan) bridge.send({ type: 'cancelPlan', batchId: plan.batchId }); plan = null; quietPublish = false; skipLayers = true; renderConfirm(); break;
      case 'quiet-publish': quietPublish = (el as HTMLInputElement).checked; break;
      case 'skip-layers': skipLayers = (el as HTMLInputElement).checked; break;
      case 'commit': if (plan) { bridge.send({ type: 'commit', batchId: plan.batchId, quiet: plan.team === 'GUI' && quietPublish, skipLayers: plan.team === 'GUI' && !!plan.layersUnchanged && skipLayers }); el.setAttribute('disabled', ''); } break;
      case 'goto': plan = null; renderConfirm(); if (el.dataset.key) { for (const g of listModel(t).groups) expanded[t].add(g.key); select(el.dataset.key); renderList(); } break;
      case 'retry': bridge.send({ type: 'retry', ...(el.dataset.reconcile ? { reconcile: true } : {}) }); break;
      case 'recovery-toggle': recoveryOpen = !recoveryOpen; renderRecovery(); break;
      case 'managed-page-open': if (el.dataset.id) bridge.send({ type: 'revealNode', nav: ++navSeq, nodeId: el.dataset.id }); break;
      case 'thumb-page-create': bridge.send({ type: 'createThumbnailPage' }); break;
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
      case 'text-close': flowOpen = false; pdfOpen = false; pasteOpen = false; renderAll(); break;
      case 'fb-screen-gui': {
        const source = el.dataset.uid ? state?.screens.get(el.dataset.uid)?.source : null;
        if (source) bridge.send({ type: 'revealNode', nav: ++navSeq, nodeId: source.nodeId });
        else notify('error', COPY.controller015);
        break;
      }
      case 'fb-dismiss-deleted': if (el.dataset.id) bridge.send({ type: 'dismissDeletedAlert', id: el.dataset.id }); break;
      case 'fb-convert-legacy': {
        const ids = legacyChosen(selectedEntries('UI'));
        if (ids.length) bridge.send({ type: 'convertLegacyFlipbooks', ids });
        break;
      }
      case 'paste-open': pasteOpen = true; flowOpen = false; pdfOpen = false; renderAll(); bridge.send({ type: 'guiScreens' }); break;
      case 'flow-open': flowOpen = true; pdfOpen = false; pasteOpen = false; renderAll(); bridge.send({ type: 'guiScreens' }); break;
      case 'pdf-open': pdfOpen = true; flowOpen = false; pasteOpen = false; renderAll(); break;
      case 'pdf-export': pdf.setRunning(true); bridge.send({ type: 'exportPdf' }); break;
      case 'pdf-cancel': pdf.cancel(); bridge.send({ type: 'cancelPdf' }); break;
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
      case 'reason-layer':
        if (el.dataset.node) bridge.send({ type: 'revealNode', nav: ++navSeq, nodeId: el.dataset.node, select: true });
        break;
      case 'reason-more':
      case 'reason-less': {
        // 상세 패널 전체를 다시 그리지 않고 「변경 사항」 상자만 바꾼다.
        const entry = current();
        const box = el.closest('.change-reason');
        if (!entry || !box) break;
        reasonShown = { key: entry.key, count: action === 'reason-less' ? 0 : (reasonShown?.key === entry.key ? reasonShown.count : 0) + REASON_PAGE };
        box.outerHTML = changeReasonSection(shownReason(entry), reasonShown.count);
        break;
      }
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
      case 'admin-nav': openAdminPanel(el.dataset.key ?? ''); break;
      case 'admin-template-default': admin({ op: 'createDefaultTemplate' }); break;
      case 'admin-template-add': admin({ op: 'addTemplate' }); break;
      // 템플릿 목록: 줄을 누르면 그 템플릿의 연결 항목을 받는다. 줄 안의 버튼은 각자 처리한다.
      case 'admin-template-pick': {
        const nodeId = el.dataset.node ?? '';
        if (!nodeId || target.closest('button')) break;
        templatePick = nodeId;
        renderDetail();
        bridge.send({ type: 'templateInfo', templateId: nodeId });
        break;
      }
      case 'admin-template-representative': {
        const nodeId = el.dataset.node ?? '';
        if (nodeId) admin({ op: 'setRepresentativeTemplate', nodeId });
        break;
      }
      case 'admin-template-remove': {
        const nodeId = el.dataset.node ?? '';
        if (!nodeId) break;
        // 보고 있던 템플릿을 빼면 대표 템플릿의 연결 항목으로 돌아간다.
        const showing = !!state && pickedTemplate(state) === nodeId;
        admin({ op: 'removeTemplate', nodeId });
        if (showing) { templatePick = null; bridge.send({ type: 'templateInfo' }); }
        break;
      }
      case 'admin-template-connect':
      case 'admin-template-disconnect': {
        const key = el.dataset.key ?? '';
        const templateId = state ? pickedTemplate(state) : null;
        if (isTemplateItem(key) && templateId) admin({ op: action === 'admin-template-connect' ? 'connectTemplateItem' : 'disconnectTemplateItem', templateId, key });
        break;
      }
      case 'admin-template-show': {
        const key = el.dataset.key ?? '';
        const templateId = state ? pickedTemplate(state) : null;
        if (isTemplateItem(key) && templateId) bridge.send({ type: 'revealTemplateItem', nav: ++navSeq, templateId, key });
        break;
      }
      case 'admin-gui-width': {
        const width = Number(formValue(el, 'width'));
        if (width !== state?.project.guiWidth) admin({ op: 'setGuiWidth', width });
        break;
      }
      case 'admin-history-date': {
        const format = formValue(el, 'format');
        if (isHistoryDateFormat(format) && format !== state?.project.historyDateFormat) admin({ op: 'setHistoryDateFormat', format });
        break;
      }
      case 'admin-screen-prefix': {
        const prefix = formValue(el, 'prefix').trim();
        if (prefix !== state?.project.screenIdPrefix) admin({ op: 'setScreenIdPrefix', prefix });
        break;
      }
      case 'admin-cat-add': {
        const name = formValue(el, 'name').trim();
        const code = formValue(el, 'code').trim();
        if (!name) break;
        pendingCategory = { name, keys: [...categoryManageKeys] };
        admin({ op: 'addCategory', name, code: code || undefined });
        break;
      }
      case 'admin-cat-save': {
        const row = el.closest<HTMLElement>('[data-form]')!;
        const id = row.dataset.id!;
        syncCategoryRow(row);
        if (!row.classList.contains('dirty')) break;
        admin({ op: 'updateCategory', id, name: formValue(el, 'name').trim(), code: formValue(el, 'code').trim() });
        break;
      }
      case 'admin-cat-delete': {
        const row = el.closest<HTMLElement>('[data-form]')!;
        const id = row.dataset.id!;
        // 다시 그리지 않고 표시만 바꿔 다른 줄에서 고치던 값을 지킨다.
        if (deleteArmed !== id) {
          deleteArmed = id;
          for (const other of root.querySelectorAll<HTMLElement>('[data-form="cat-code"]')) {
            other.querySelector('[data-action="admin-cat-delete"]')!.classList.toggle('armed', other === row);
            other.querySelector(':scope > p')?.remove();
          }
          if (state) row.insertAdjacentHTML('beforeend', categoryDeleteNote(state, id));
          break;
        }
        deleteArmed = null;
        admin({ op: 'setCategoryActive', id, active: false });
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
    box.style.maxWidth = `${Math.min(240, rect.width - 16)}px`;
    const img = document.createElement('img');
    img.alt = '';
    img.style.maxWidth = '100%';
    img.style.maxHeight = `${Math.min(320, Math.max(80, rect.height - 24))}px`;
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
  on('pointerover', ev => {
    const target = ev.target as HTMLElement;
    const el = target.closest('button, [role="button"]') ? null : target.closest<HTMLElement>('[data-thumb]');
    const hash = el?.dataset.thumb;
    if (!hash) { if (hoverThumb) { hoverThumb = null; showHoverThumb(); } return; }
    const r = root.getBoundingClientRect();
    hoverThumb = { hash, x: ev.clientX - r.left, y: ev.clientY - r.top };
    requestThumbs([hash]);
    showHoverThumb();
  });

  // 새 플립북: 화면을 우클릭하면 그 화면 하나로 된 새 플립북을 목록(화면 카테고리 Section 맨 뒤)에 추가한다.
  // 화면·제목이 비어 있는 새 플립북이 있으면 그 항목을 채운다. 현재 고른 항목은 그대로 둔다.
  on('contextmenu', ev => {
    const option = (ev.target as HTMLElement).closest<HTMLElement>('.new-flipbook-detail .create-screen-list .create-screen-option');
    const uid = option?.dataset.uid;
    if (!uid) return;
    ev.preventDefault();
    if (busyLabel) return;
    if (addNew([uid], true)) renderCreateScreenList();
  });

  // 제목을 고치는 중에 연필을 누르면 입력에서 포커스가 빠지지 않게 한다. 확정·닫기는 연필의 클릭이 맡는다.
  on('mousedown', ev => {
    if (editingTitle && (ev.target as HTMLElement).closest('[data-action="fb-edit-title"]')) ev.preventDefault();
  });

  // 플립북 이름을 더블클릭하면 그 자리(목록 행·오른쪽 영역)에서 제목을 고친다(2026-10-22 사용자 요청).
  // 연결이 끊긴 플립북과 여러 개를 고른 상세 제목에는 data-edit-title을 붙이지 않는다.
  on('dblclick', ev => {
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
  // 「선택된 화면」은 가로로 놓이므로 카드의 왼쪽·오른쪽 절반으로 앞·뒤를 정한다.
  const screenDrop = (ev: DragEvent): { node: HTMLElement; at: number; before: boolean } | null => {
    if (draggingScreen === null) return null;
    const node = (ev.target as HTMLElement).closest<HTMLElement>('.create-selected-list .create-screen-option[data-index]');
    if (!node || Number(node.dataset.index) === draggingScreen) return null;
    const rect = node.getBoundingClientRect();
    const before = ev.clientX < rect.left + rect.width / 2;
    return { node, at: Number(node.dataset.index), before };
  };
  // GUI 목록의 카테고리 묶음 옮기기: 묶음 머리의 위쪽 절반이면 그 묶음 앞, 아래쪽 절반이나 그 묶음의 화면 행이면 뒤에 놓는다.
  const categoryDrop = (ev: DragEvent): { node: HTMLElement; id: string; before: boolean } | null => {
    if (!draggingCategory) return null;
    const node = (ev.target as HTMLElement).closest<HTMLElement>('.list-box .group[data-category]');
    if (!node || node.dataset.category === draggingCategory) return null;
    const bar = node.querySelector('.group-bar')!.getBoundingClientRect();
    return { node, id: node.dataset.category!, before: ev.clientY < bar.top + bar.height / 2 };
  };
  // 놓은 순서는 바로 저장한다. 목록에 없는 카테고리(화면이 없거나 걸러진 카테고리)는 서로의 순서를 지키고,
  // 사용 안 함 카테고리의 자리는 core(reorderCategories)가 지킨다.
  function moveCategory(id: string, to: { id: string; before: boolean }) {
    if (!state || busyLabel) return;
    const ids = [...state.categories.values()].filter(c => c.active).sort((a, b) => a.order - b.order).map(c => c.id);
    const rest = ids.filter(value => value !== id);
    if (rest.length === ids.length || !rest.includes(to.id)) return;
    rest.splice(rest.indexOf(to.id) + (to.before ? 0 : 1), 0, id);
    if (rest.every((value, i) => value === ids[i])) return;
    admin({ op: 'reorderCategories', ids: rest });
  }
  // 선택된 화면의 from 자리를 옮기고 옮긴 뒤의 자리를 돌려준다(못 옮기면 null). 같은 화면이 여러 번 있어도 그 자리 하나만 옮긴다.
  function moveScreen(from: number, to: { at: number; before: boolean } | { step: -1 | 1 }): number | null {
    const row = currentNew();
    if (!row || from < 0 || from >= row.uids.length) return null;
    const uid = row.uids[from];
    const rest = row.uids.filter((_, i) => i !== from);
    const at = 'step' in to ? Math.max(0, Math.min(rest.length, from + to.step))
      : (to.at > from ? to.at - 1 : to.at) + (to.before ? 0 : 1);
    if (at === from) return from;
    screensChanged(row, () => {
      rest.splice(at, 0, uid);
      row.uids = rest;
    });
    return at;
  }
  on('dragstart', ev => {
    const category = (ev.target as HTMLElement).closest<HTMLElement>('.list-box .group-bar[draggable="true"]')?.closest<HTMLElement>('.group[data-category]');
    if (category) {
      if (busyLabel) { ev.preventDefault(); return; }
      draggingCategory = category.dataset.category!;
      ev.dataTransfer?.setData('text/plain', draggingCategory);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
      category.classList.add('dragging');
      return;
    }
    const option = (ev.target as HTMLElement).closest<HTMLElement>('.create-selected-list .create-screen-option[data-index]');
    if (option) {
      if (busyLabel || newSubmitting) { ev.preventDefault(); return; }
      draggingScreen = Number(option.dataset.index);
      ev.dataTransfer?.setData('text/plain', option.dataset.uid ?? '');
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
      option.classList.add('dragging');
      return;
    }
    const row = (ev.target as HTMLElement).closest<HTMLElement>('.list-box .row[data-group][draggable="true"]');
    if (!row || busyLabel || newSubmitting) { if (row) ev.preventDefault(); return; }
    draggingNew = row.dataset.key!;
    ev.dataTransfer?.setData('text/plain', draggingNew);
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  on('dragover', ev => {
    if (draggingCategory) {
      const drop = categoryDrop(ev);
      clearDrop();
      if (!drop) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
      drop.node.classList.add(drop.before ? 'drop-before' : 'drop-after');
      return;
    }
    if (draggingScreen !== null) {
      const drop = screenDrop(ev);
      clearDrop();
      if (!drop) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
      drop.node.classList.add(drop.before ? 'drop-before' : 'drop-after');
      return;
    }
    const target = dropTarget(ev);
    clearDrop();
    if (!target) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    target.node.classList.add(target.to.start ? 'drop-into' : target.to.before ? 'drop-before' : 'drop-after');
  });
  on('drop', ev => {
    if (draggingCategory) {
      const drop = categoryDrop(ev);
      const id = draggingCategory;
      draggingCategory = null;
      clearDrop();
      if (!drop) return;
      ev.preventDefault();
      moveCategory(id, drop);
      return;
    }
    if (draggingScreen !== null) {
      const drop = screenDrop(ev);
      const from = draggingScreen;
      draggingScreen = null;
      clearDrop();
      if (!drop) return;
      ev.preventDefault();
      moveScreen(from, drop);
      return;
    }
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
  on('dragend', () => {
    draggingNew = null;
    draggingScreen = null;
    draggingCategory = null;
    clearDrop();
    for (const node of root.querySelectorAll('.dragging')) node.classList.remove('dragging');
  });

  // 설정 아코디언: 하나를 열면 나머지를 접는다. toggle 이벤트는 버블링되지 않아 캡처로 받는다.
  on('toggle', ev => {
    const details = ev.target as HTMLDetailsElement;
    // UI Flipbook 상세의 화면 목록 접기: 펼친 상태만 기억한다(내용은 이미 그려져 있다).
    const fold = details.classList?.contains('fb-fold') ? details.dataset.fold : undefined;
    if (fold === 'screens') { fbScreensOpen = details.open; return; }
    // History: 처음 펼칠 때 썸네일 이미지를 넣으려고 다시 그린다.
    if (details.classList?.contains('history-fold')) {
      const shownId = team() === 'GUI' ? current()?.screenId : current()?.flipbookId;
      const next = details.open ? shownId ?? null : null;
      if (historyOpenId === next) return;
      historyOpenId = next;
      if (next) renderHistory();
      return;
    }
    // 화면 선택 드롭다운: 펼치면 검색 입력에 포커스를 두고, 접으면 검색어를 비운다.
    if (details.classList?.contains('screen-picker')) {
      const search = details.querySelector<HTMLInputElement>('.picker-search');
      if (!search) return;
      search.value = '';
      filterScreenPicker(details, '');
      if (details.open) search.focus();
      return;
    }
    if (!details.classList?.contains('accordion') || !details.open) return;
    adminOpen = details.dataset.key ?? null;
    for (const other of root.querySelectorAll<HTMLDetailsElement>('details.accordion')) if (other !== details) other.open = false;
    // 튜토리얼처럼 칸을 직접 열어도 왼쪽 메뉴의 선택을 맞춘다.
    syncAdminNav();
  }, true);

  on('keydown', ev => {
    const el = ev.target as HTMLElement;
    if (canvasPick && ev.key === 'Escape') {
      ev.preventDefault();
      cancelCanvasPick();
      return;
    }
    if ((typeof __PLUGIN_RELEASE__ !== 'boolean' || !__PLUGIN_RELEASE__) && ev.key === 'Escape' && templateMigration?.close()) { ev.preventDefault(); return; }
    if ((typeof __PLUGIN_RELEASE__ !== 'boolean' || !__PLUGIN_RELEASE__) && ev.key === 'Escape' && !el.closest('.screen-picker[open]') && flowRepair?.close()) { ev.preventDefault(); return; }
    if (bulk && ev.key === 'Escape' && !bulk.submitting) { ev.preventDefault(); bulk = null; renderBulk(); return; }
    if (newDialog && ev.key === 'Escape') { ev.preventDefault(); newDialog = null; renderNewDialog(); return; }
    // 관리의 템플릿: 연결된 항목 줄은 Enter·Space로도 연결된 레이어를 보여 준다.
    if (el.classList.contains('template-item') && el.dataset.action && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); el.click(); return; }
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
    // 「선택된 화면」: 행에서 Alt+↑↓로 순서를 바꾸고 Delete로 뺀다. 「화면 선택」 행은 Enter·Space로 더한다.
    if (el.matches('.create-selected-list .create-screen-option[data-index]')) {
      const from = Number(el.dataset.index);
      if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
        ev.preventDefault();
        if (busyLabel || newSubmitting) return;
        const at = moveScreen(from, { step: ev.key === 'ArrowUp' ? -1 : 1 });
        if (at !== null) root.querySelector<HTMLElement>(`.create-selected-list .create-screen-option[data-index="${at}"]`)?.focus();
        return;
      }
      if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); el.querySelector<HTMLElement>('[data-action="create-screen-remove"]')?.click(); return; }
    }
    if (el.matches('.create-screen-list .create-screen-option[data-action]') && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); el.click(); return; }
    // 기존 플립북 행: Alt+↑↓로 자리를 옮긴다. Enter·Space는 아래 공통 처리로 고른다.
    if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && el.matches('.list-box .row[data-group][draggable="true"]') && !isNewKey(el.dataset.key ?? '')) {
      ev.preventDefault();
      const key = el.dataset.key!;
      stepItem(key, ev.key === 'ArrowUp' ? -1 : 1);
      renderFooter();
      requestAnimationFrame(() => requestAnimationFrame(() => root.querySelector<HTMLElement>(`.list-box .row[data-key="${CSS.escape(key)}"]`)?.focus()));
      return;
    }
    // 관리 카테고리 줄: Esc는 고친 이름·코드를 저장된 값으로 되돌린다.
    if (tab === 'ADMIN' && ev.key === 'Escape' && !ev.isComposing) {
      const row = el.closest<HTMLElement>('[data-form="cat-code"]');
      const c = row && state?.categories.get(row.dataset.id ?? '');
      if (row && c) {
        row.querySelector<HTMLInputElement>('[data-f="name"]')!.value = c.name;
        row.querySelector<HTMLInputElement>('[data-f="code"]')!.value = c.code ?? '';
        syncCategoryRow(row);
        return;
      }
    }
    if (tab === 'ADMIN' && ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229) {
      const form = el.closest<HTMLElement>('[data-form="cat-add"], [data-form="cat-code"]');
      if (form && el instanceof HTMLInputElement) {
        ev.preventDefault();
        form.querySelector<HTMLButtonElement>('[data-action="admin-cat-add"], [data-action="admin-cat-save"]')?.click();
        return;
      }
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
    // 화면 선택 드롭다운: ↑↓로 검색 입력과 결과 사이를 옮기고, 검색 입력의 Enter는 첫 결과를 고르며, Esc로 접는다.
    const screenPick = el.closest<HTMLDetailsElement>('.screen-picker[open]');
    if (screenPick && (el.classList.contains('picker-search') || el.classList.contains('tag-option'))) {
      const search = screenPick.querySelector<HTMLInputElement>('.picker-search')!;
      const stops = [search, ...screenPick.querySelectorAll<HTMLElement>('.tag-option:not([hidden])')];
      if (ev.key === 'Escape') { ev.preventDefault(); screenPick.open = false; screenPick.querySelector('summary')!.focus(); return; }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        const at = stops.indexOf(el) + (ev.key === 'ArrowDown' ? 1 : -1);
        stops[Math.max(0, Math.min(stops.length - 1, at))].focus();
        return;
      }
      if (el === search && ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229) {
        ev.preventDefault();
        if (search.value.trim()) stops[1]?.click();
        return;
      }
    }
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

  on('input', ev => {
    const el = ev.target as HTMLInputElement;
    const categoryRow = el.closest<HTMLElement>('[data-form="cat-code"]');
    if (categoryRow) { syncCategoryRow(categoryRow); return; }
    if (el.classList.contains('picker-search')) { filterScreenPicker(el.closest('details')!, el.value); return; }
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
    if (el.dataset.input === 'fb-page-title' || el.dataset.input === 'fb-screen-id') {
      const id = el.closest<HTMLElement>('.fb-identity')?.dataset.id;
      const fb = id && state?.flipbooks.get(id);
      const draft = id && identityDrafts.get(id);
      if (fb && draft) {
        if (el.dataset.input === 'fb-page-title') {
          draft.title = el.value;
          const head = root.querySelector<HTMLElement>('.detail .title-head .head-name');
          if (head) head.textContent = draft.title.trim() || defaultTitle(fb.kind, fb.screens);
        } else draft.screenId = el.value;
        const info = flipbookIdentity(state!, { ...fb, title: draft.title, screenId: draft.screenId.trim() });
        const chapter = root.querySelector<HTMLInputElement>('[data-identity-chapter]');
        if (chapter) chapter.value = info.chapter;
        paintEditState();
      }
      return;
    }
    if (el.dataset.input === 'new-screen-id') {
      const n = currentNew();
      if (n) { n.screenId = el.value; updateNewIdentity(n); }
      return;
    }
    if (el.dataset.input === 'new-title') {
      const n = newFlipbooks.find(x => x.key === el.dataset.key);
      if (n) {
        n.title = el.value;
        updateNewIdentity(n);
        const head = root.querySelector<HTMLElement>('.new-flipbook-detail .title-head .head-name');
        if (head && selectedNew === n.key) head.textContent = newTitle(n);
        // 목록에서 고치면 오른쪽 제목 입력을, 오른쪽에서 고치면 목록 행 이름을 맞춘다.
        if (el.closest('.list-box')) {
          const field = root.querySelector<HTMLInputElement>(`.detail [data-input="new-title"][data-key="${CSS.escape(n.key)}"]`);
          if (field) field.value = newTitle(n);
        } else {
          const row = [...root.querySelectorAll<HTMLElement>('.list-box .new-row')].find(item => item.dataset.key === n.key);
          const title = newIdentity(n).frameName;
          const name = row?.querySelector<HTMLElement>('.name');
          if (name) name.textContent = title;
          row?.querySelector('[data-action="new-remove"]')?.setAttribute('aria-label', `${title} ${COPY.uiApp105}`);
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
    if (el.dataset.create === 'search') { createQuery = el.value; renderCreateScreenList(); return; }
    if (el.dataset.input === 'version-query') { versionQuery = el.value; paintVersionList(); return; }
    if (el.dataset.input === 'admin-gui-width') {
      const sizes = el.closest('[data-form]')?.querySelector('.gui-width-sizes');
      if (sizes) sizes.textContent = guiWidthSizes(Number(el.value));
      return;
    }
    if (el.dataset.input === 'comment') { comment = { ...comment, description: el.value }; return; }
    if (el.dataset.input === 'worker') { workerName = el.value; workerTyped = true; el.classList.toggle('input-error', !el.value.trim()); return; }
    if (el.dataset.requiredField && el.closest('[data-form="tag-add"]')) { renderFieldErrors(); return; }
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
    // GUI 설명·제외 사유는 선택 입력이며 목록 상태나 검증 결과를 바꾸지 않는다.
    if (field === 'description') { for (const selectedEntry of selectedEntries(t)) draftOf(t, selectedEntry).description = el.value; if (t === 'UI') refreshAfterInput(); }
    else if (field === 'name') { for (const selectedEntry of selectedEntries(t)) draftOf(t, selectedEntry).name = el.value; refreshAfterInput(true); }
    else if (field === 'code') { for (const selectedEntry of selectedEntries(t)) draftOf(t, selectedEntry).code = el.value; refreshAfterInput(true); }
    else if (field === 'excludeReason') { for (const selectedEntry of selectedEntries(t)) draftOf(t, selectedEntry).excludeReason = el.value; }
  });

  // 오른쪽 새 플립북 제목: 자동 제목이 채워져 있으면 눌렀을 때 전체를 골라 바로 새로 입력하게 한다.
  on('focusin', ev => {
    const el = ev.target as HTMLInputElement;
    if (el.dataset.input !== 'new-title' || el.closest('.list-box')) return;
    const n = newFlipbooks.find(x => x.key === el.dataset.key);
    if (n && !n.title.trim()) later(() => { if (document.activeElement === el) el.select(); }, 0);
  });

  on('focusout', ev => {
    const control = ev.target as HTMLElement;
    // 제목 입력에서 벗어나면 확정한다. 새 플립북 제목은 입력할 때마다 반영되어 있다.
    if (control.dataset.input === 'new-title' || control.dataset.input === 'fb-title') {
      const id = control.dataset.input === 'fb-title' ? control.dataset.id! : control.dataset.key!;
      const value = (control as HTMLInputElement).value;
      later(() => {
        if (editingTitle !== id || root.querySelector(`[data-input="${control.dataset.input}"]:focus`)) return;
        if (control.dataset.input === 'fb-title') renameExisting(id, value);
        else { editingTitle = null; renderDetail(); renderList(); }
      }, 0);
      return;
    }
    // 화면 선택 드롭다운의 검색 입력은 그 드롭다운의 필수 입력으로 본다.
    const field = control.dataset.requiredField
      ?? (control.classList.contains('picker-search') ? control.closest('details')?.querySelector<HTMLElement>(':scope > summary')?.dataset.requiredField : undefined);
    if (!field || !control.closest('.detail') || tab === 'ADMIN') return;
    const picker = control.closest('details');
    if (picker && ev.relatedTarget instanceof Node && picker.contains(ev.relatedTarget)) return;
    touchField(team(), field);
  });

  on('change', ev => {
    const el = ev.target as HTMLInputElement | HTMLSelectElement;
    if (el.dataset.create === 'category') { createCategory = el.value; renderCreateScreenList(); return; }
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
          // 배포한 화면: 화면 수정, 화면 바꾸기(처음에는 새 버전 쪽), 화면이 아님 또는 배포 취소
          if (!needsLink(selectedEntry)) {
            if (!selectedEntry.frame) continue;
            if (el.value === 'replace') {
              if (mergesInto(selectedEntry, target) || isOldSide(selectedEntry, target)) continue;
              setReplaceSide(selectedEntry, 'new');
              continue;
            }
            unpairNew(selectedEntry.key);
            unpairScreen(selectedEntry.key);
            target.retire = undefined;
            target.link = undefined;
            target.notScreen = el.value === 'not-screen';
            target.unpublish = el.value === 'unpublish';
            continue;
          }
          if (el.value === 'replace') {
            target.link = 'replace';
            target.notScreen = false;
            defaultTag(target, null);
            // 신규 등록으로 바꿨다가 다시 고르면 교체 제안을 다시 쓴다.
            target.replaceScreenId ??= selectedEntry.pairKey ?? undefined;
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
            target.replacedBy ??= selectedEntry.pairKey ?? undefined;
            if (target.replacedBy) pair(target.replacedBy, selectedEntry.key);
            continue;
          }
          unpairScreen(selectedEntry.key);
          target.retire = 'delete';
          defaultTag(target, 'delete');
        }
        break;
      }
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
      case 'relation': for (const e of selectedEntries(t)) if (relationEditable(t, e)) {
        draftOf(t, e).relation = el.value as Draft['relation'];
      } break;
      default: return;
    }
    if (t === 'GUI') renumberCodes();
    renderDetail(); renderList(); renderFooter();
  });

  // ── 수신 ─────────────────────────────────────────────

  const unlisten = bridge.listen(msg => {
    if (disposed) return;
    if ('managedPages' in msg && msg.managedPages) managedPages = msg.managedPages;
    if (typeof __PLUGIN_RELEASE__ !== 'boolean' || !__PLUGIN_RELEASE__) templateMigration?.message(msg);
    if (typeof __PLUGIN_RELEASE__ !== 'boolean' || !__PLUGIN_RELEASE__) flowRepair?.message(msg);
    switch (msg.type) {
      case 'init':
        newHistory.clear();
        categoryManageKeys = [];
        discardEdits();
        applyingAll = false;
        previewCache.clear();
        state = fromWire(msg.state); actor = msg.actor; pages = msg.pages; issues = msg.issues;
        // 작업자 이름: 처음에는 계정 이름을 넣고, 마지막으로 배포한 이름이 저장돼 있으면 그 이름으로 바꾼다.
        if (!workerTyped && !workerName && msg.actor?.name) workerName = msg.actor.name;
        if (!workerAsked && msg.mode === 'GUI') { workerAsked = true; bridge.send({ type: 'workerNameGet' }); }
        if (mode !== msg.mode || tab !== 'ADMIN') { mode = msg.mode; tab = mode; }
        // GUI Publish는 플립북 페이지를 확인하지 않으므로 초기 데이터가 오면 바로 연다.
        if (mode === 'GUI') startupPending = false;
        renderStartup();
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
        historyAsked = null;
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
        if (!updateAsked && root.id === 'app' && window.parent !== window) { updateAsked = true; bridge.send({ type: 'updateCheck' }); }
        break;
      case 'updateLatest':
        update = { ...build, latest: msg.latest };
        renderTabs();
        refreshUpdateSection();
        break;
      case 'workerNameResult':
        if (msg.name && !workerTyped) { workerName = msg.name; renderFooter(); }
        break;
      case 'startupReady':
        startupPending = false;
        renderStartup();
        break;
      case 'state': {
        const previousRules = state ? codeRules(state) : '';
        state = fromWire(msg.state);
        replaceReasons.clear();
        renderRecovery();
        retainThumbs();
        if (previousRules && previousRules !== codeRules(state)) renumberCodes();
        pages = msg.pages;
        for (const key of selection.UI) if (state.flipbooks.get(key)?.status !== 'active') selection.UI.delete(key);
        if (selected.UI && !selection.UI.has(selected.UI)) selected.UI = [...selection.UI][0] ?? null;
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
        if (tab === 'ADMIN') renderDetailKeepingFocus();
        else if (listTabOpen()) { renderList(); renderFooter(); renderDetailKeepingFocus(); }
        break;
      }
      case 'entries': {
        // 선택한 행의 변경 추정이 바뀌면 입력란 머리의 배지도 다시 그린다.
        const before = entries.find(e => e.key === selected.GUI)?.estimate;
        const pairsBefore = new Map(entries.map(e => [e.key, e.pairKey]));
        entries = msg.entries;
        // 교체 비교 결과는 프레임 지문을 키에 넣어 두므로 목록을 다시 받을 때마다 비우지 않는다(확인 중 같은 프레임을 다시 읽지 않게).
        // 비교 기준(지난 배포·변경 무시)이 바뀌는 기록 변경 때만 비운다(아래 'state').
        // 교체 제안은 변경사항 확인이 끝나야 나온다. 제안이 생기거나 바뀐 항목은 배포를 켜지 않았으면 기본값(교체 짝)을 다시 채운다.
        // 배포를 켠 항목은 사용자가 정한 값을 둔다.
        for (const e of entries) {
          const d = drafts.GUI[e.key];
          if (d && !d.included && pairsBefore.has(e.key) && (pairsBefore.get(e.key) ?? null) !== e.pairKey) delete drafts.GUI[e.key];
        }
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
        // 제외를 푼 프레임이 신규 후보로 돌아오면 그 행을 고르고 보이게 한다.
        const returned = unexcludedNodes.size ? entries.filter(e => e.frame && unexcludedNodes.has(e.frame.nodeId)).map(e => e.key) : [];
        if (returned.length) {
          selection.GUI = new Set(returned);
          selected.GUI = anchor.GUI = returned[returned.length - 1];
          if (returned.length === unexcludedNodes.size) { excludedPick = []; unexcludedNodes.clear(); }
          showSelectedRows('GUI');
          revealSelection = true;
          cleared = true;
        }
        if (tab !== 'ADMIN') { renderList(); renderFooter(); if (cleared) renderDetail(); else if (estimateChanged) renderDetailKeepingFocus(); else renderValidation(); }
        break;
      }
      case 'listSynced':
        listSyncedAt = msg.at;
        refreshingList = false;
        paintSyncStatus();
        break;
      case 'uiScan': {
        const previousScans = uiScans;
        const previousEstimate = selected.UI && state ? uiEstimate(state, selected.UI, previousScans.get(selected.UI)) : null;
        uiScans = new Map(msg.scans.map(s => [s.flipbookId, s]));
        if (state) for (const scan of msg.scans) {
          const draft = drafts.UI[scan.flipbookId];
          if (draft?.included && !scan.nodeId && uiEstimate(state, scan.flipbookId, previousScans.get(scan.flipbookId)) !== 'missing') draft.included = false;
        }
        if (tab === 'UI' && listTabOpen()) {
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
        if (msg.status === 'loading' && t === 'GUI') reasonShown = null;
        if (msg.status === 'done') {
          const elapsed = scanStartedAt[t] ? Date.now() - scanStartedAt[t] : MIN_SCAN_VISIBLE_MS;
          const remaining = Math.max(0, MIN_SCAN_VISIBLE_MS - elapsed);
          if (remaining) {
            updateScanStatus(t, { status: 'comparing', done: msg.done, total: msg.total, checkedAt: null, partialAt: null });
            clearScanFinishTimer(t);
            scanFinishTimer[t] = later(() => {
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
        // 실행한 명령과 다른 목록의 선택으로는 화면을 바꾸지 않는다.
        if (!state || msg.team !== mode) break;
        if (canvasPick && msg.team === 'GUI') {
          // 후보 목록의 허용 범위를 그대로 사용한다. 검색어로 숨은 후보도 캔버스로 고를 수 있다.
          const button = root.querySelector<HTMLButtonElement>('.canvas-pick[aria-pressed="true"]');
          if (busyLabel || pdfBusy || tab !== 'GUI' || detailLocked('GUI') || !button || button.matches(':disabled')) { cancelCanvasPick(); break; }
          if (msg.entryKeys.length === 1 && !canvasPick.keys.includes(msg.entryKeys[0])) {
            const field = canvasPick.field;
            const option = [...button.closest('.screen-picker-control')!.querySelectorAll<HTMLElement>('.tag-option')].find(item => item.dataset.entryKey === msg.entryKeys[0]);
            if (option) pick(field, option.dataset.value!);
          }
          break;
        }
        if (!msg.entryKeys.length) {
          // 목록에 없는 제외 프레임만 골랐으면 목록 선택을 풀고 상세에 제외 안내를 보인다. 안내를 보던 중 다른 곳을 고르면 안내를 거둔다.
          if (msg.team !== 'GUI' || (!msg.excludedIds.length && !excludedPick.length)) break;
          excludedPick = msg.excludedIds;
          unexcludedNodes.clear();
          if (!excludedPick.length) { if (tab === 'GUI' && listTabOpen()) renderDetail(); break; }
          const fromAdmin = tab === 'ADMIN';
          tab = 'GUI';
          selection.GUI = new Set();
          selected.GUI = null;
          addMode = null;
          editMode = null;
          if (fromAdmin) { renderAll(); break; }
          if (!listTabOpen()) break;
          renderTabs(); renderToolbar(); renderList(); renderDetail(); renderFooter();
          break;
        }
        if (msg.team === 'GUI') { excludedPick = []; unexcludedNodes.clear(); }
        // 다른 하위 레이어를 골라도 목록에서 가리키는 화면이 같으면 입력 영역을 다시 만들지 않는다.
        if (tab === msg.team && selectedNew === null && !editingTitle && !addingSection && !addMode && !editMode &&
            !query[msg.team] && !changedOnly[msg.team] &&
            selected[msg.team] === msg.lastKey && selection[msg.team].size === msg.entryKeys.length &&
            msg.entryKeys.every(key => selection[msg.team].has(key))) break;
        const fromAdmin = tab === 'ADMIN';
        tab = msg.team;
        if (msg.team === 'UI') { selectedNew = null; editingTitle = null; addingSection = false; }
        selection[msg.team] = new Set(msg.entryKeys);
        selected[msg.team] = msg.lastKey;
        anchor[msg.team] = msg.lastKey;
        showSelectedRows(msg.team);
        addMode = null;
        editMode = null;
        // 관리에서 나오면 화면 틀(관리 전용 배치, 플로우·PDF·붙이기 탭)까지 다시 그린다. 일부만 그리면 관리 배치가 남아
        // 목록 칸이 숨은 채 상세만 보인다.
        if (fromAdmin) { renderAll(); break; }
        if (!listTabOpen()) break;
        renderTabs(); renderToolbar(); renderList(); renderDetail(); renderFooter();
        break;
      }
      case 'plan': plan = msg.plan; quietPublish = false; skipLayers = true; renderConfirm(); break;
      case 'committed':
        // 배포한 작업자 이름을 다음에 기본으로 쓴다(사용자별 clientStorage).
        if (msg.ok && mode === 'GUI') { comment = emptyComment(); if (workerName.trim()) bridge.send({ type: 'workerNameSet', name: workerName.trim() }); renderFooter(); }
        if (msg.ok) {
          // 확정한 화면의 입력만 지운다. 확정하지 못한 화면은 입력을 남겨 다시 Publish할 수 있게 한다.
          const t = plan?.team ?? team();
          if (t === 'GUI' && plan) {
            const committed = new Set(msg.committed);
            const ids = new Map(plan.items.filter(item => item.isNew && committed.has(item.entryKey)).map(item => [item.entryKey, item.screenId]));
            for (const draft of Object.values(drafts.GUI))
              if (draft.baseScreenId && ids.has(draft.baseScreenId)) draft.baseScreenId = ids.get(draft.baseScreenId)!;
          }
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
      case 'historyNotices':
        newHistory = new Map(msg.items);
        if (tab === 'UI') { renderList(); renderDetailKeepingFocus(); }
        break;
      case 'history': history = { id: msg.id, rows: msg.rows }; renderHistory(); break;
      case 'trackList': trackList.set(msg.uid, msg.items); break;
      case 'guiScreens':
        createScreens = msg.screens;
        flows.setScreens(createScreens, new Map(msg.counts));
        paste.setScreens(createScreens, new Map(msg.counts));
        // 화면 목록을 받기 전에 연 일괄 만들기는 카테고리를 모두 고른 상태로 채운다.
        if (bulk && !bulk.submitting && !bulk.categories.size) bulk.categories = new Set(bulkCandidates().map(screenCategoryKey));
        renderBulk();
        if (tab === 'UI' && listTabOpen()) { renderList(); if (currentNew()) renderDetail(); }
        break;
      case 'templateIssues': templateIssues = msg.issues; renderToolbar(); break;
      case 'templateInfo':
        templateInfo = msg.info;
        // 받은 템플릿을 목록에서 고른 것으로 둔다(고른 템플릿, 더하거나 대표로 지정하거나 연결을 바꾼 템플릿).
        if (msg.info) templatePick = msg.info.id;
        if (tab === 'ADMIN') renderDetail();
        break;
      case 'pages':
        if (pages.length === msg.pages.length && pages.every((p, i) => p.id === msg.pages[i].id && p.name === msg.pages[i].name && !p.current === !msg.pages[i].current)) break;
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
      case 'changeReason': {
        const entry = entries.find(e => e.frame?.nodeId === msg.nodeId && e.frame.fingerprint === msg.fingerprint);
        if (!entry?.frame) break;
        entry.frame = { ...entry.frame, reason: msg.reason, reasonPending: undefined };
        if (tab === 'GUI' && current()?.key === entry.key) renderDetailKeepingFocus();
        break;
      }
      case 'replaceReason': {
        const entry = entries.find(e => e.key === msg.entryKey);
        if (!entry) break;
        const key = replaceReasonKey(entry, msg.screenId);
        if (!replaceReasons.has(key)) break;
        replaceReasons.set(key, { same: msg.same, reason: msg.reason });
        if (tab === 'GUI' && current()?.key === msg.entryKey) renderDetailKeepingFocus();
        break;
      }
      case 'versionDetail':
        if (msg.pageId !== versionPageId) break;
        versionEvidence.set(`${msg.screenId}|${msg.nodeId}`, msg.evidence);
        if (versionSelected?.kind === 'screen' && versionSelected.id === msg.screenId) renderVersionDetail();
        break;
      case 'framePreviews':
        for (const item of msg.items) {
          const key = NODE_PREVIEW + item.nodeId;
          previewCache.receive(key, item.bytes, 'image/png');
        }
        if (versionOpen) renderVersionDetail();
        showHoverThumb();
        break;
      case 'flipbooksRemoved':
        removeAllArmed = false;
        for (const id of msg.ids) delete drafts.UI[id];
        if (msg.message) notify('info', msg.message);
        if (tab === 'UI') { renderList(); renderDetail(); }
        break;
      case 'flipbooksCreated':
        // 일괄 만들기는 목록의 새 플립북(만들기 전)을 그대로 둔다.
        if (bulk?.submitting) { bulk = null; renderBulk(); }
        else if (creatingOne) {
          // 하나만 만들었다: 그 행만 지우고, 그 뒤에 붙어 있던 새 플립북은 만든 플립북 뒤로 잇는다. 만든 플립북을 고른다.
          const key = creatingOne, made = msg.ids[0];
          newSubmitting = false; creatingOne = null;
          for (const other of newFlipbooks) if (other.after === key) other.after = made ?? null;
          newFlipbooks = newFlipbooks.filter(other => other.key !== key);
          if (selectedNew === key) selectedNew = null;
          if (made) { selection.UI = new Set([made]); selected.UI = made; anchor.UI = made; revealSelection = true; }
          normalizeNew();
          if (!newFlipbooks.length && !movedFlipbooks.length) finishNew();
        }
        else if (newSubmitting) { newSubmitting = false; applyingAll = false; finishNew(); }
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
          previewCache.receive(item.hash, item.bytes, 'image/jpeg');
        }
        // 플립북 만들기·화면 편집 창은 다시 그리지 않는다(열린 화면 선택이 닫히지 않게). 플립북 만들기의 그리드 썸네일은 그 자리에서 이미지만 바꾼다.
        if (versionOpen) renderVersionDetail();
        else if (listTabOpen()) {
          updateDetailThumbs(msg.items.map(item => item.hash));
          updateThumbnailImages(root.querySelector<HTMLElement>('.new-flipbook-detail'), msg.items.map(item => item.hash), hash => thumbUrls.get(hash) ?? null);
        }
        flows.thumbsLoaded(msg.items.map(item => item.hash));
        paste.thumbsLoaded(msg.items.map(item => item.hash));
        if (hoverThumb && msg.items.some(item => item.hash === hoverThumb?.hash)) showHoverThumb();
        break;
      case 'flipbookDescription': {
        // 다시 불러오기를 요청한 뒤의 응답만 받는다.
        const previous = descDrafts.get(msg.id);
        if (!previous || previous.status === 'off' || previous.status === 'ready' && !previous.refreshing) break;
        // 숨긴 Description 영역은 본문을 읽지 않고 영역 상태만 온다. 토글이 꺼진 채로 둔다.
        if (!msg.error && msg.area === 'hidden' && !msg.paragraphs && previous.status === 'loading') {
          descDrafts.set(msg.id, { status: 'off', area: 'hidden' });
          if (descEditorFor === msg.id) descEditorFor = null;
          if (tab === 'UI' && listTabOpen() && current()?.flipbookId === msg.id) renderDetail();
          break;
        }
        if (msg.error || !msg.paragraphs || !msg.layout) {
          if (previous.status === 'ready') { previous.refreshing = false; previous.error = msg.error ?? COPY.figmaText006; }
          else descDrafts.set(msg.id, { status: 'error', message: msg.error ?? COPY.figmaText006 });
          if (tab === 'UI' && listTabOpen() && current()?.flipbookId === msg.id) renderDetail();
          break;
        }
        const dirtyText = previous.status === 'ready' && descEditedText(previous);
        const dirtyLayout = previous.status === 'ready' && descEditedLayout(previous);
        const oldEditor = descEditorFor === msg.id ? descEditor.paragraphs() : null;
        const oldLayout = descEditorFor === msg.id ? descEditor.layout() : null;
        const nextDoc = dirtyText && previous.status === 'ready' ? previous.doc : msg.paragraphs;
        const nextLayout = dirtyLayout && previous.status === 'ready' ? previous.layout : msg.layout;
        descDrafts.set(msg.id, { status: 'ready', refreshing: false, area: msg.area ?? 'none', saved: serializeRichText(msg.paragraphs), savedDoc: msg.paragraphs, savedLayout: msg.layout,
          doc: nextDoc, layout: nextLayout });
        if (descEditorFor === msg.id) {
          descEditorFor = null;
          // Keep unsaved DOM input while rebasing its untouched fields to the newly read canvas value.
          const rebased = descDrafts.get(msg.id) as Extract<DescDraft, { status: 'ready' }>;
          if (dirtyText && oldEditor) rebased.doc = oldEditor;
          if (dirtyLayout && oldLayout) rebased.layout = oldLayout;
        }
        if (tab === 'UI' && listTabOpen() && current()?.flipbookId === msg.id) renderDetail();
        break;
      }
      // 반영한 플립북은 수정을 비우고 Description을 다시 불러온다. 실패한 플립북은 수정을 남긴다.
      case 'flipbookEditsApplied': {
        for (const id of msg.applied) {
          identityDrafts.delete(id);
          descDrafts.delete(id);
          if (descEditorFor === id) descEditorFor = null;
        }
        if (!msg.creating) {
          if (applyingAll && !newFlipbooks.length && !movedFlipbooks.length) finishNew();
          newSubmitting = false;
          applyingAll = false;
        }
        // 연결 끊긴 플립북에 반영하지 못한 것은 실패로 알리지 않는다(본체가 메시지에서도 뺀다).
        {
          const failures = msg.failed.filter(f => f.message !== COPY.figmaFlipbook027).length;
          if (msg.message && (!msg.creating || failures)) notify(failures ? 'error' : 'info', msg.message);
        }
        if (tab === 'UI') { renderList(); renderDetail(); renderFooter(); }
        break;
      }
      case 'pdfSelection': pdf.setSelection(msg.selection); break;
      case 'pdfCancelled': pdf.setRunning(false); notify('info', COPY.pdf015); break;
      case 'pdfPages': {
        const { fileName, pages } = msg;
        pdfBusy = COPY.pdf006; renderBusy();
        pdf.save(fileName, pages)
          .then(saved => notify('info', saved ? `${COPY.pdf010} ${fileName} (${pages.length}${COPY.pdf011})` : COPY.pdf015))
          .catch(error => notify('error', `${COPY.pdf012} ${error instanceof Error ? error.message : String(error)}`))
          .finally(() => { pdfBusy = null; renderBusy(); pdf.setRunning(false); });
        break;
      }
      case 'notice': notify('info', msg.message); break;
      case 'busy': busyLabel = msg.label; if (busyLabel) cancelCanvasPick(); renderBusy(); break;
      case 'error':
        pendingCategory = null; pendingTag = null;
        // 목록 새로고침이 실패해도 아이콘이 계속 돌지 않게 한다.
        if (refreshingList) { refreshingList = false; paintSyncStatus(); }
        // PDF 저장이 실패하면 취소 버튼을 저장 버튼으로 되돌린다.
        pdf.setRunning(false);
        if (bulk?.submitting) { bulk.submitting = false; bulk.error = msg.message; renderBulk(); }
        else if (newSubmitting) { newSubmitting = false; applyingAll = false; creatingOne = null; createError = msg.message; renderFooter(); renderDetail(); }
        // 프레임이 지워진(연결 끊김) 플립북이라 하지 못한 일은 토스트로 알리지 않는다. 목록에 「연결 끊김」으로 보인다(2026-11-04 사용자 요청).
        if (msg.message !== COPY.figmaFlipbook027) notify('error', msg.message);
        break;
    }
  });

  // 처리 중인 작업(Publish·저장 등). 변경사항 확인은 탭 맨 위에 진행과 취소를 따로 보여 주며 조작을 막지 않는다.
  function renderBusy() {
    const label = busyLabel ?? pdfBusy;
    const el = $('.busy');
    el.hidden = !label;
    (el.querySelector('.busy-label') as HTMLElement).textContent = label ?? '';
    root.classList.toggle('is-busy', !!label);
    root.setAttribute('aria-busy', String(startupPending || !!label));
    // 모드 전환 버튼은 탭을 그릴 때의 상태로 막힌다. 처리 중에 탭을 다시 그린 뒤 처리가 끝나면 막힌 채 남으므로 여기서도 맞춘다.
    root.querySelector('.tabs .mode-switch')?.toggleAttribute('disabled', !!label);
  }

  function renderStartup() {
    const overlay = $('.startup-overlay');
    const label = mode === 'UI' ? COPY.uiApp345 : COPY.uiApp001;
    (overlay.querySelector('.startup-label') as HTMLElement).textContent = label;
    (overlay.querySelector('.startup-progress') as HTMLElement).setAttribute('aria-label', label);
    overlay.hidden = !startupPending;
    root.setAttribute('aria-busy', String(startupPending || !!busyLabel));
  }

  // 작업자 추가처럼 상태가 바뀌어도 입력 중인 칸의 포커스를 되살린다.
  function renderDetailKeepingFocus() {
    const active = document.activeElement as HTMLElement | null;
    const field = active?.dataset.field;
    renderDetail();
    if (field) (root.querySelector(`[data-field="${field}"]`) as HTMLElement | null)?.focus();
  }

  renderBusy();
  renderStartup();
  bridge.send({ type: 'ready' });
  return () => {
    if (disposed) return;
    disposed = true;
    events.abort();
    unlisten?.();
    for (const cleanup of cleanups) cleanup();
    flows.dispose();
    trackList.dispose();
    previewCache.clear();
    if (renderFrame) cancelAnimationFrame(renderFrame);
    if (listRebuildTimer) cancelLater(listRebuildTimer);
    for (const t of ['GUI', 'UI'] as Team[]) clearScanFinishTimer(t);
    for (const timer of timers) globalThis.clearTimeout(timer);
    timers.clear();
  };
}
