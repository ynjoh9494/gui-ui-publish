// 플러그인 샌드박스(main)와 UI iframe 사이의 메시지 형식
import type { Entry, UiScan } from './compare.ts';
import type { Draft } from './drafts.ts';
import { unreviewed, type FlipbookRequest, type ReviewRequest } from './flipbooks.ts';
import type { HistoryRow } from './history.ts';
import type { SelectionTarget } from './description.ts';
import type { RichParagraph } from './richText.ts';
import type { BatchComment, Blocker, Plan } from './publish.ts';
import type { GuiScreenInfo } from './guiScreens.ts';
import type { State } from './store.ts';
import type { Actor, Team } from './types.ts';
import type { VersionEvidence, VersionLink } from './versionMatch.ts';

type Entries<M> = M extends Map<infer K, infer V> ? [K, V][] : never;

// Map은 postMessage로 보낼 수 있지만 순서·형식을 명시하기 위해 배열로 바꾼다.
export type WireState = { [K in keyof State]: State[K] extends Map<string, unknown> ? Entries<State[K]> : State[K] };

export function toWire(state: State): WireState {
  return {
    project: state.project, categories: [...state.categories], workers: [...state.workers], tags: [...state.tags],
    screens: [...state.screens], gui: [...state.gui], flipbooks: [...state.flipbooks], imported: [...state.imported],
    uiStates: [...state.uiStates], uiBaselines: [...state.uiBaselines], ui: [...state.ui], reviews: [...state.reviews],
    batches: [...state.batches], deliveries: [...state.deliveries], exclusions: [...state.exclusions], audit: state.audit,
    dataStatus: state.dataStatus,
  };
}

export function fromWire(w: WireState): State {
  return {
    project: w.project, categories: new Map(w.categories), workers: new Map(w.workers), tags: new Map(w.tags),
    screens: new Map(w.screens), gui: new Map(w.gui), flipbooks: new Map(w.flipbooks), imported: new Map(w.imported),
    uiStates: new Map(w.uiStates), uiBaselines: new Map(w.uiBaselines), ui: new Map(w.ui), reviews: new Map(w.reviews),
    batches: new Map(w.batches), deliveries: new Map(w.deliveries), exclusions: new Map(w.exclusions), audit: w.audit,
    dataStatus: w.dataStatus,
  };
}

// UI는 최신 비교 기준과 최근 감사 기록만 필요하다. 이력은 history 요청으로 별도 조회한다.
// 저장소·확정 로직에는 전체 원기록을 유지하고 메시지 경계에서만 줄인다.
export function toUiWire(state: State): WireState {
  return {
    project: state.project, categories: [...state.categories], workers: [...state.workers], tags: [...state.tags],
    screens: [...state.screens], gui: [...state.gui].map(([id, rows]) => [id, rows.slice(-1)]),
    // 플립북의 「화면이 수정되었습니다」 표시에는 아직 확인하지 않은 GUI 기록만 있으면 된다.
    flipbooks: [...state.flipbooks],
    imported: [...state.imported].map(([id]) => [id, unreviewed(state, id)]),
    uiStates: [...state.uiStates], uiBaselines: [...state.uiBaselines],
    ui: [...state.ui].map(([id, rows]) => [id, rows.slice(-1)]), reviews: [...state.reviews],
    batches: [], deliveries: [...state.deliveries].filter(([, d]) => d.state !== 'done'),
    exclusions: [...state.exclusions], audit: state.audit.slice(-15), dataStatus: state.dataStatus,
  };
}

export interface PageInfo { id: string; name: string }

// 새 버전 페이지 비교 결과. frames: 그 페이지의 화면 프레임(캔버스 순서)
export interface VersionMatchView { pageId: string; links: VersionLink[]; frames: { nodeId: string; name: string }[] }

// 플러그인 창 크기. 오른쪽 아래 손잡이로 바꾸고 마지막 크기를 기억한다(2026-10-20 사용자 요청).
// 기본 크기는 이전(760×760)보다 줄인 640×456(세로는 3/5, 2026-10-20 사용자 요청).
// 최소 크기: 화면 목록 260px + 입력 영역 320px, 세로는 머리·툴바·목록(120px 이상)·추가 설명·하단 줄이 들어가는 높이.
// UI Flipbook 오른쪽 영역을 접으면(compact) 창을 목록 너비로 줄이므로 가로 최소는 목록 최소 너비다(2026-10-21 사용자 요청).
export const WINDOW = { width: 640, height: 456, minWidth: 600, minHeight: 420, minCompactWidth: 260 };
export function clampWindow(width: number, height: number, compact = false): { width: number; height: number } {
  return { width: Math.max(compact ? WINDOW.minCompactWidth : WINDOW.minWidth, Math.round(width)), height: Math.max(WINDOW.minHeight, Math.round(height)) };
}

export type AdminOp =
  | { op: 'addCategory'; name: string }
  | { op: 'renameCategory'; id: string; name: string }
  | { op: 'setCategoryActive'; id: string; active: boolean }
  | { op: 'setCategoryCode'; id: string; code: string }
  | { op: 'setScreenIdPrefix'; prefix: string }
  | { op: 'renumberScreenIds' }
  | { op: 'addWorker'; name: string; alias: string }
  | { op: 'renameWorker'; id: string; name: string; alias: string }
  | { op: 'setWorkerActive'; id: string; active: boolean }
  | { op: 'addTag'; team: Team; name: string; colorKey: string }
  | { op: 'updateTag'; id: string; name?: string; colorKey?: string; active?: boolean }
  | { op: 'exclude'; nodeId: string; name: string; reason: string }
  | { op: 'unexclude'; id: string }
  | { op: 'setScope'; pageIds: string[] }
  | { op: 'setDataPage'; pageId: string; reason: string }
  | { op: 'setFlipbookPage'; pageId: string }
  | { op: 'setFlipbookPages'; pageIds: string[] }
  | { op: 'setTemplateFromSelection'; policy?: boolean }
  | { op: 'setGuiWidth'; width: number }
  | { op: 'setCaseRelation'; screenId: string; baseId: string | null; reason: string }
  | { op: 'setScreenCategory'; screenId: string; categoryId: string | null; reason: string }
  | { op: 'correctRecord'; team: Team; screenId: string; version: number; description: string; reason: string };

export type NavTarget = 'source' | 'flipbook' | 'history';

// idle: 확인 전, loading: 원본·플립북 읽는 중, comparing: 지문 비교 중
export type ScanState = 'idle' | 'loading' | 'comparing' | 'done' | 'cancelled' | 'failed';

export type ToMain =
  | { type: 'ready' }
  | { type: 'scan' }
  // UI 목록: 아직 반영하지 않은 GUI 갱신을 플립북에 반영한 뒤 UI 작성 영역을 비교
  | { type: 'scanUi' }
  // 선택 화면 변경사항 확인: 목록은 전체를 다시 읽고 고른 화면만 비교한다.
  | { type: 'scanSelected'; team: Team; entryKeys: string[] }
  | { type: 'cancelScan'; team: Team }
  // 변경 무시: 변경 감지된 GUI 화면의 현재 지문을 비교 기준으로 저장한다(최종 확인 없음).
  | { type: 'ignoreChanges'; entryKeys: string[] }
  | { type: 'navigate'; nav: number; entryKey: string; target: NavTarget }
  | { type: 'selectFrames'; nav: number; team: Team; entryKeys: string[]; lastKey: string }
  // GUI는 배포 한 번에 하나인 추가 설명(comment)을 함께 보낸다.
  | { type: 'prepare'; team: Team; drafts: Record<string, Draft>; comment?: BatchComment }
  // 썸네일 이미지 바이트 요청(플립북 목록·화면 선택 미리보기)
  | { type: 'thumbnails'; hashes: string[] }
  | { type: 'commit'; batchId: string }
  | { type: 'cancelPlan'; batchId: string }
  | { type: 'retry'; batchId?: string }
  | { type: 'refreshData' }
  // 플러그인 데이터 전체 초기화(관리 탭 Danger Zone)
  | { type: 'resetData' }
  | { type: 'admin'; action: AdminOp }
  // GUI: 화면 ID, UI: 플립북 ID
  | { type: 'history'; team: Team; id: string }
  // 플립북 만들기: GUI 배포한 화면 목록을 받고, 고른 화면으로 만든다.
  | { type: 'guiScreens' }
  | { type: 'createFlipbooks'; request: FlipbookRequest }
  // 플립북 제목 변경. 비우면 첫 화면 이름(자동 제목)으로 돌아간다.
  | { type: 'renameFlipbook'; id: string; title: string }
  // 플립북 확인 완료: 상태·코멘트를 남기고 「화면이 수정되었습니다」 표시를 푼다.
  | { type: 'markReviewed'; requests: ReviewRequest[] }
  // 연결이 끊긴 플립북을 목록에서 삭제한다. 프레임이 남은 플립북은 건너뛴다.
  | { type: 'removeFlipbooks'; ids: string[] }
  // 고른 플립북을 설정한 1x 화면 크기로 다시 반영한다. 마커는 크기를 두고 화면을 따라간다.
  | { type: 'resizeFlipbooks'; ids: string[] }
  // 새 버전 페이지: 붙여 넣은 페이지의 프레임을 등록 화면과 화면 내용으로 비교하고, 확인한 연결로 원본을 옮긴다.
  // 설정을 열 때 페이지 목록을 다시 받는다(플러그인을 연 뒤 추가한 페이지).
  | { type: 'pages' }
  | { type: 'matchVersion'; pageId: string }
  | { type: 'switchVersion'; pageId: string; links: { screenId: string; nodeId: string }[] }
  // 화면과 연결할 프레임의 유사도 근거. 사용자가 고친 연결도 같은 규칙으로 계산한다.
  | { type: 'versionDetail'; pageId: string; screenId: string; nodeId: string }
  // 프레임 미리보기 이미지(새 버전 페이지의 기존 원본·새 프레임 비교)
  | { type: 'framePreviews'; nodeIds: string[] }
  | { type: 'revealNode'; nav: number; nodeId: string }
  // 텍스트 편집: 캔버스에서 고른 텍스트 레이어 하나의 문단(본문·목록 단계·굵기)을 읽거나, 편집한 문단을 그 레이어에 쓴다.
  | { type: 'textImport' }
  | { type: 'textApply'; paragraphs: RichParagraph[] }
  // save: 손잡이를 놓았을 때. 다음 실행 때 이 크기로 연다.
  | { type: 'resize'; width: number; height: number; save?: boolean; compact?: boolean };

export type ToUi =
  // mode: 실행한 플러그인 명령(GUI Publish·UI Flipbook)
  | { type: 'init'; mode: Team; state: WireState; actor: Actor; pages: PageInfo[]; issues: string[] }
  | { type: 'state'; state: WireState; pages: PageInfo[] }
  | { type: 'entries'; entries: Entry[] }
  | { type: 'uiScan'; scans: UiScan[] }
  // 변경사항 확인 진행. checkedAt: 비교를 끝까지 마친 시각(없으면 아직 확인 전)
  // partialAt: 선택 화면 확인을 마친 시각. 전체 확인 전에도 판정이 나온 화면은 배포할 수 있다.
  | { type: 'scanStatus'; team: Team; status: ScanState; done: number; total: number; checkedAt: number | null; partialAt: number | null }
  | { type: 'nav'; nav: number; ok: boolean; message: string }
  | { type: 'canvasSelection'; team: Team; entryKeys: string[]; lastKey: string | null }
  | { type: 'plan'; plan: Plan }
  // ok: 한 건 이상 확정했다. committed: 확정한 항목의 entryKey, conflicts: 확정하지 못한 항목과 이유
  | { type: 'committed'; ok: boolean; committed: string[]; conflicts: Blocker[]; batchId: string; pending: number; message: string }
  | { type: 'history'; id: string; rows: HistoryRow[] }
  | { type: 'guiScreens'; screens: GuiScreenInfo[] }
  // 플립북을 만들었다. ids: 새 플립북 ID
  | { type: 'flipbooksCreated'; ids: string[]; moved?: string[]; message: string }
  // 확인 완료를 기록했다. ids: 기록한 플립북 ID
  | { type: 'reviewed'; ids: string[]; message: string }
  // 목록에서 삭제했다. ids: 삭제한 플립북 ID
  | { type: 'flipbooksRemoved'; ids: string[]; message: string }
  // 플립북 템플릿의 문제(없으면 빈 목록). UI Flipbook 목록 위에 경고로 보여 준다.
  | { type: 'templateIssues'; issues: string[] }
  // 새 버전 페이지 비교 결과. 전환했거나 비교 결과가 맞지 않게 되면 null
  | { type: 'versionMatch'; match: VersionMatchView | null }
  | { type: 'versionSwitched' }
  // evidence: 원본이나 프레임을 읽지 못해 내용 비교를 못 하면 null
  | { type: 'versionDetail'; pageId: string; screenId: string; nodeId: string; evidence: VersionEvidence | null }
  | { type: 'framePreviews'; items: { nodeId: string; bytes: Uint8Array | null }[] }
  | { type: 'pages'; pages: PageInfo[] }
  | { type: 'thumbnails'; items: { hash: string; bytes: Uint8Array | null }[] }
  | { type: 'textImported'; paragraphs: RichParagraph[] }
  // 텍스트 편집 대상. 캔버스 선택이 바뀔 때와 처음 열 때 보낸다.
  | { type: 'textTarget'; target: SelectionTarget }
  | { type: 'notice'; message: string }
  // 진행 중인 작업. null이면 끝났다.
  | { type: 'busy'; label: string | null }
  | { type: 'error'; message: string };
