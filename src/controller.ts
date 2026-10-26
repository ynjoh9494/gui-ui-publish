import { COPY } from './core/copy.ts';
import { baseline, changeDetected, classify, ignoreBlock, uiEstimate, uncheckedEntries, uiEntries, UI_FINGERPRINT_VERSION, type Entry, type FlipbookSpot, type ScannedFrame, type UiScan } from './core/compare.ts';
import { LEGACY_FINGERPRINT_VERSION } from './core/fingerprint.ts';
import { dataModel } from './core/data.ts';
import { chapterName, flipbookView, guiKey, validGuiWidth } from './core/flipbook.ts';
import { canvasSections, checkMoves, editFlipbookScreens, followCanvasSections, importGuiUpdates, markReviewed, moveFlipbooks, pageSections, planFlipbooks, removeFlipbooks, renameFlipbook, retireFlipbooks, type FlipbookMove, type FlipbookRequest, type ReviewRequest, type ScreenEditRequest } from './core/flipbooks.ts';
import type { Draft } from './core/drafts.ts';
import type { SelectionWrite } from './core/description.ts';
import { flowList, flowRecord, flowUpdates, planFlow, type FlowRequest } from './core/flow.ts';
import { flipbookHistoryRows, guiHistoryRows } from './core/history.ts';
import { pdfFileName } from './core/pdf.ts';
import { guiRecordInfos, guiScreens } from './core/guiScreens.ts';
import { acknowledgeChange, addDelivery, upgradeBaseline, buildPlan, commitPlan, setDeliveryState, type BatchComment, unfinishedDeliveries, type CommitInput, type Plan } from './core/publish.ts';
import {
  addCategory, addExclusion, addTag, addWorker, correctRecord, ensureScreenIdRules, ensureSystemTags, removeExclusion, renameCategory, renameWorker, setCaseRelation,
  relinkSource, renumberScreenIds, setCategoryActive, setCategoryCode, setScreenCategory, setScreenIdPrefix, setWorkerActive, updateTag,
} from './core/registry.ts';
import type { CodeRename } from './core/screenCode.ts';
import { formatFrameName } from './core/screenName.ts';
import { keys, lastUi, randomId, Store } from './core/store.ts';
import type { DataStatus, FlowRecord, ProjectConfig, Team, UiBaseline } from './core/types.ts';
import { explainMatch, matchVersion, versionCommon, versionLinkErrors, type VersionFrame } from './core/versionMatch.ts';
import { toUiWire, type AdminOp, type NavTarget, type ScanState, type ToMain } from './core/wire.ts';
import type { Host } from './host.ts';
export type { Host, FingerprintReader } from './host.ts';

const PROGRESS_STEP = 5;
// 지문 계산에 쓰는 Figma API는 바로 이행되어 이벤트 루프에 양보하지 않는다. 직접 쉬어 가지 않으면
// 비교가 끝날 때까지 취소(cancelScan) 메시지를 받지 못하고 플러그인 창도 멈춘다.
const YIELD_MS = 50;
function yielder(): () => Promise<void> {
  let last = Date.now();
  return async () => {
    if (Date.now() - last < YIELD_MS) return;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    last = Date.now();
  };
}
const DATA_OPS = new Set<AdminOp['op']>(['renameCategory', 'setCategoryActive', 'setCategoryCode', 'setScreenIdPrefix', 'renumberScreenIds', 'setScreenCategory', 'setCaseRelation', 'correctRecord', 'setDataPage']);
// 오래 걸리는 요청. 처리하는 동안 UI에 진행 표시를 띄우고 중복 조작을 막는다.
const BUSY_LABEL: Partial<Record<ToMain['type'], string>> = {
  prepare: COPY.controller001, commit: COPY.controller002, resetData: COPY.controller003, retry: COPY.controller004, refreshData: COPY.controller005,
  admin: COPY.controller006, createFlipbooks: COPY.controller038, markReviewed: COPY.controller066, removeFlipbooks: COPY.controller068,
  matchVersion: COPY.controller106, switchVersion: COPY.controller107, renameFlipbook: COPY.controller118, editFlipbookScreens: COPY.controller137,
  textApply: COPY.controller120, createFlow: COPY.flow006, exportPdf: COPY.pdf005,
};

// 텍스트 편집 적용 결과 안내.
function writeMessage(result: SelectionWrite): string {
  if (result.kind === 'text') return `${COPY.controller121} ${result.name}`;
  return COPY.controller135;
}

const spotOf = (spots: Record<string, FlipbookSpot>, nodeId: string | null): FlipbookSpot | null => (nodeId ? spots[nodeId] ?? null : null);
const sameSpot = (a: FlipbookSpot | null | undefined, b: FlipbookSpot | null | undefined) =>
  (a ?? null) === (b ?? null) || (!!a && !!b && a.pageId === b.pageId && a.section === b.section && a.sectionName === b.sectionName && a.sectionIndex === b.sectionIndex && a.index === b.index);

export interface DeliveryReport { screens: number; done: number; failed: string[]; notes: string[]; skipped: string | null }
const emptyReport = (): DeliveryReport => ({ screens: 0, done: 0, failed: [], notes: [], skipped: null });

export class Controller {
  readonly host: Host;
  readonly store: Store;
  entries: Entry[] = [];
  frames: ScannedFrame[] = [];
  plans = new Map<string, Plan>();
  navSeq = 0;
  scanSeq = 0;
  uiScans: UiScan[] = [];
  // 플립북 템플릿의 문제. 관리 화면이 아니어도 UI Flipbook 목록 위에 알린다.
  templateIssues: string[] = [];
  uiScanSeq = 0;
  // 변경사항 확인: 원본 목록을 읽었는가, 비교를 끝까지 마친 시각. 실행만 해서는 비교하지 않는다.
  framesLoaded = false;
  checkedAt: number | null = null;
  uiCheckedAt: number | null = null;
  // 선택 화면 확인을 마친 시각. 전체 확인 전에도 판정이 나온 화면(「비교 전」이 아닌 화면)은 Publish할 수 있다.
  partialAt: number | null = null;
  uiPartialAt: number | null = null;
  // 진행 중인 비교가 선택 화면 확인인가. 취소해도 이전 전체 확인 결과를 지우지 않는다.
  private selectedScan: Record<Team, boolean> = { GUI: false, UI: false };
  private previousCanvasIds: string[] = [];
  private canvasSelectionSeq = 0;
  // 텍스트 편집 탭이 보이는 동안만 캔버스 선택마다 대상을 찾는다(선택마다 조상·하위 트리를 읽는 작업이라 탭이 닫혀 있으면 하지 않는다).
  private textTabOpen = false;
  // PDF 저장 탭도 보이는 동안만 캔버스 선택마다 고른 프레임 수를 보낸다.
  private pdfTabOpen = false;
  // PDF 저장 중 취소를 눌렀다. 다음 프레임을 내보내기 전에 멈춘다.
  private pdfCancelled = false;
  private pdfExporting = false;
  // 캔버스를 읽다가 기록과 페이지·Section(키·이름)이 다른 플립북을 찾았다. 반영(기록·Chapter)은 쓰기 순서에서 syncCanvasSections가 한다.
  private canvasSectionsPending = false;
  private scanningGui = false;
  // 새 버전 페이지 비교 결과. 전환은 이 결과의 프레임만 연결하고, 계산한 지문을 그대로 원본 목록으로 쓴다.
  // sources·common: 유사도 근거를 제안 때와 같은 규칙으로 다시 계산하는 데 쓴다.
  private version: { pageId: string; frames: VersionFrame[]; scanned: ScannedFrame[]; sources: Map<string, string[]>; common: Set<string> } | null = null;

  constructor(host: Host) {
    this.host = host;
    this.store = new Store(host.kv);
  }

  private busy(label: string | null) { this.host.post({ type: 'busy', label }); }

  // 레이어·이미지 처리는 거의 동기 API라 이벤트 루프에 양보하지 않으면 UI에 진행 표시가 전달되지 않는다.
  private async progress(label: string) {
    this.busy(label);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  async handle(msg: ToMain): Promise<void> {
    const label = BUSY_LABEL[msg.type];
    if (label) await this.progress(label);
    try {
      switch (msg.type) {
        case 'ready':
          this.store.reload();
          // 기본 태그(추가·삭제)가 없으면 만든다.
          if (ensureSystemTags(this.store, this.host.actor)) this.store.reload();
          // Screen ID 자동 입력 전에 만든 프로젝트는 기존 화면 ID에서 Prefix·카테고리 코드를 읽고, 없으면 카테고리 이름으로 코드를 만든다.
          if (ensureScreenIdRules(this.store, this.host.actor)) this.store.reload();
          this.host.post({ type: 'init', mode: this.host.mode, state: toUiWire(this.store.state), actor: this.host.actor, pages: this.host.pages(), issues: this.store.issues.map(i => `${i.key}: ${i.message}`) });
          this.postEntries();
          if (this.host.mode === 'UI' && this.textTabOpen) this.postTextTarget();
          if (this.host.mode === 'UI' && this.pdfTabOpen) this.postPdfSelection();
          // UI Flipbook 목록은 프레임이 캔버스에 있는지 바로 보여 준다(연결 끊김 표시).
          // 플립북 페이지를 불러오는 동안은 Figma가 입력을 받지 못하므로 아무 표시가 없으면 오류처럼 보인다. 그동안 「불러오는 중」을 띄운다.
          if (this.host.mode === 'UI') {
            await this.progress(COPY.controller136);
            // 템플릿 페이지와 플립북 페이지는 서로 기다리지 않고 함께 불러온다.
            const [, canvas] = await Promise.all([this.checkTemplate(), this.linkFlipbooks()]);
            await this.syncCanvasSections(canvas);
          }
          break;
        case 'scan': await this.scan(); break;
        case 'scanUi': await this.scanUi(); break;
        case 'scanSelected': await (msg.team === 'GUI' ? this.scanSelectedGui(msg.entryKeys) : this.scanSelectedUi(msg.entryKeys)); break;
        case 'cancelScan': this.cancelScan(msg.team); break;
        case 'ignoreChanges': this.ignoreChanges(msg.entryKeys); break;
        case 'navigate': await this.navigate(msg.nav, msg.entryKey, msg.target); break;
        case 'selectFrames': await this.selectFrames(msg.nav, msg.team, msg.entryKeys, msg.lastKey); break;
        case 'prepare': await this.prepare(msg.team, msg.drafts, msg.comment); break;
        case 'thumbnails': {
          const items: { hash: string; bytes: Uint8Array | null }[] = [];
          for (const hash of msg.hashes) items.push({ hash, bytes: await this.host.thumbnailBytes(hash).catch(() => null) });
          this.host.post({ type: 'thumbnails', items });
          break;
        }
        case 'commit': await this.commit(msg.batchId); break;
        case 'cancelPlan': this.plans.delete(msg.batchId); break;
        case 'retry': {
          const report = await this.deliverFlipbooks({}, { force: true });
          if (report.screens) await this.refreshData();
          this.postState();
          this.host.post({ type: report.failed.length || report.skipped ? 'error' : 'notice', message: deliveryMessage(report) || COPY.controller007 });
          break;
        }
        case 'refreshData': {
          const ok = await this.refreshData(true);
          const status = this.store.state.dataStatus;
          this.postState();
          if (ok) this.host.post({ type: 'notice', message: COPY.controller010 });
          else this.host.post({ type: 'error', message: `${COPY.controller011} ${status?.error ?? ''}` });
          break;
        }
        case 'admin': await this.admin(msg.action); break;
        case 'resetData': await this.resetData(); break;
        case 'history': {
          const rows = msg.team === 'GUI' ? guiHistoryRows(this.store.state, msg.id) : flipbookHistoryRows(this.store.state, msg.id);
          this.host.post({ type: 'history', id: msg.id, rows });
          break;
        }
        case 'guiScreens':
          this.store.reload();
          this.host.post({ type: 'guiScreens', screens: [...guiScreens(this.store.state).values()] });
          break;
        case 'createFlipbooks': await this.createFlipbooks(msg.request); break;
        case 'renameFlipbook': await this.renameFlipbook(msg.id, msg.title); break;
        case 'editFlipbookScreens': await this.editFlipbookScreens(msg.request); break;
        case 'markReviewed': await this.markReviewed(msg.requests); break;
        case 'removeFlipbooks': await this.removeFlipbooks(msg.ids); break;
        case 'matchVersion': await this.matchVersion(msg.pageId); break;
        case 'switchVersion': await this.switchVersion(msg.pageId, msg.links); break;
        case 'versionDetail': {
          const v = this.version;
          if (!v || v.pageId !== msg.pageId) break;
          const source = v.sources.get(msg.screenId);
          const frame = v.frames.find(f => f.nodeId === msg.nodeId)?.tokens;
          const evidence = source && frame ? explainMatch(source, frame, v.common) : null;
          this.host.post({ type: 'versionDetail', pageId: msg.pageId, screenId: msg.screenId, nodeId: msg.nodeId, evidence });
          break;
        }
        case 'framePreviews': {
          const items: { nodeId: string; bytes: Uint8Array | null }[] = [];
          for (const nodeId of msg.nodeIds) items.push({ nodeId, bytes: await this.host.framePreview(nodeId).catch(() => null) });
          this.host.post({ type: 'framePreviews', items });
          break;
        }
        case 'revealNode': {
          this.navSeq = msg.nav;
          const latest = () => msg.nav === this.navSeq;
          const ok = await this.host.reveal(msg.nodeId, latest);
          if (latest()) this.host.post({ type: 'nav', nav: msg.nav, ok, message: ok ? '' : COPY.controller016 });
          break;
        }
        case 'refreshList':
          if (this.host.mode !== 'UI') break;
          {
            const [, canvas] = await Promise.all([this.checkTemplate(), this.linkFlipbooks()]);
            await this.syncCanvasSections(canvas);
          }
          break;
        case 'textTab':
          this.textTabOpen = msg.open;
          if (msg.open && this.host.mode === 'UI') this.postTextTarget();
          break;
        case 'textImport': this.host.post({ type: 'textImported', paragraphs: this.host.readSelection() }); break;
        case 'textApply': {
          this.host.post({ type: 'notice', message: writeMessage(await this.host.writeSelection(msg.paragraphs)) });
          break;
        }
        case 'pdfTab':
          this.pdfTabOpen = msg.open;
          if (msg.open && this.host.mode === 'UI') this.postPdfSelection();
          break;
        case 'exportPdf': {
          if (!this.host.exportPdf) break;
          this.pdfCancelled = false;
          this.pdfExporting = true;
          try {
            const { pageName, pages } = await this.host.exportPdf(async (done, total) => {
              if (this.pdfCancelled) return false;
              await this.progress(`${COPY.pdf005} (${done + 1}/${total})`);
              return true;
            });
            if (!pages || this.pdfCancelled) this.host.post({ type: 'pdfCancelled' });
            else this.host.post({ type: 'pdfPages', fileName: pdfFileName(pageName), pages });
          } finally {
            this.pdfExporting = false;
          }
          break;
        }
        // 쪽을 다 보낸 뒤(UI가 PDF로 묶는 중)의 취소는 UI가 처리한다.
        case 'cancelPdf':
          if (!this.pdfExporting) break;
          this.pdfCancelled = true;
          this.busy(COPY.pdf014);
          break;
        case 'createFlow': await this.createFlow(msg.request); break;
        case 'flows': await this.postFlows(); break;
        case 'revealFlow': {
          this.navSeq = msg.nav;
          const latest = () => msg.nav === this.navSeq;
          this.store.reload();
          const flow = this.store.state.flows.get(msg.flowId);
          const nodeId = flow && this.host.flowNode ? await this.host.flowNode(flow, msg.uid) : null;
          // 캔버스에서 지운 플로우는 묻지 않고 목록에서 뺀다(2026-10-23 사용자 결정).
          if (!nodeId) {
            if (flow) this.forgetFlow(flow);
            await this.postFlows(false);
            if (latest()) this.host.post({ type: 'nav', nav: msg.nav, ok: false, message: COPY.flow048 });
            break;
          }
          const ok = await this.host.reveal(nodeId, latest);
          if (latest()) this.host.post({ type: 'nav', nav: msg.nav, ok, message: ok ? '' : COPY.controller016 });
          break;
        }
        case 'resize': this.host.resize(msg.width, msg.height, msg.save, msg.compact); break;
        case 'pages': this.host.post({ type: 'pages', pages: this.host.pages() }); break;
      }
    } catch (e) {
      this.host.post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      if (label) this.busy(null);
      if (msg.type === 'ready') {
        this.busy(null);
        this.host.post({ type: 'startupReady' });
      }
    }
  }

  // DATA 페이지가 새로 생길 수 있으므로 페이지 목록도 함께 보낸다.
  private postState() {
    this.host.post({ type: 'state', state: toUiWire(this.store.state), pages: this.host.pages() });
  }

  // 원본 목록을 읽기 전에는 저장된 등록 화면을 「비교 전」으로 보여 준다.
  // 1 규칙 비교 기준을 2 규칙으로 옮긴다. 원본이 기준과 같은(변경사항 없음) 화면만 옮기므로 판정은 바뀌지 않는다.
  private upgradeBaselines(): void {
    let changed = false;
    for (const e of classify(this.store.state, this.frames)) {
      const f = e.frame;
      if (e.screenId && e.estimate === 'unchanged' && f?.fingerprint && f.legacyFingerprint)
        changed = upgradeBaseline(this.store, e.screenId, f.legacyFingerprint, f.fingerprint, this.host.actor) || changed;
    }
    if (changed) { this.store.reload(); this.postState(); }
  }

  private postEntries() {
    this.entries = this.framesLoaded ? classify(this.store.state, this.frames) : uncheckedEntries(this.store.state);
    this.host.post({ type: 'entries', entries: this.entries });
  }

  private legacySources(): Set<string> {
    const out = new Set<string>();
    for (const screen of this.store.state.screens.values()) {
      if (!screen.source || screen.status !== 'active') continue;
      const base = baseline(this.store.state, screen);
      if (base?.fingerprint && (base.fpVersion ?? 1) === LEGACY_FINGERPRINT_VERSION) out.add(screen.source.nodeId);
    }
    return out;
  }

  private scanStatus(team: Team, status: ScanState, done = 0, total = 0) {
    if (team === 'GUI') this.scanningGui = status === 'loading' || status === 'comparing';
    this.host.post({
      type: 'scanStatus', team, status, done, total,
      checkedAt: team === 'GUI' ? this.checkedAt : this.uiCheckedAt, partialAt: team === 'GUI' ? this.partialAt : this.uiPartialAt,
    });
  }

  // ── 변경사항 확인 ───────────────────────────────────────

  // 변경사항 확인(GUI): 범위 페이지를 읽어 목록을 만들고 지문을 비교한다. 끝까지 마쳐야 GUI Publish를 할 수 있다.
  async scan(): Promise<void> {
    const seq = ++this.scanSeq;
    this.selectedScan.GUI = false;
    this.checkedAt = null;
    this.partialAt = null;
    this.store.reload();
    const legacy = this.legacySources();
    const reader = this.host.createFingerprintReader?.() ?? this.host;
    const { scopePageIds, scopeSectionIds } = this.store.state.project;
    this.scanStatus('GUI', 'loading');
    let frames: ScannedFrame[];
    try { frames = await this.host.listFrames(scopePageIds, scopeSectionIds, () => seq === this.scanSeq); }
    catch (e) { if (seq !== this.scanSeq) return; this.scanStatus('GUI', 'failed'); throw e; }
    if (seq !== this.scanSeq) return;
    this.frames = frames;
    this.framesLoaded = true;
    this.postEntries();
    this.scanStatus('GUI', 'comparing', 0, frames.length);
    let lastListPost = Date.now();
    const pause = yielder();
    for (let i = 0; i < frames.length; i++) {
      const result = await reader.fingerprint(frames[i].nodeId, legacy.has(frames[i].nodeId));
      await pause();
      if (seq !== this.scanSeq) return;
      this.frames[i] = { ...frames[i], ...result };
      if ((i + 1) % PROGRESS_STEP === 0 && i < frames.length - 1) {
        if (Date.now() - lastListPost >= 100) { this.postEntries(); lastListPost = Date.now(); }
        this.scanStatus('GUI', 'comparing', i + 1, frames.length);
      }
    }
    this.checkedAt = this.store.now();
    this.upgradeBaselines();
    this.postEntries();
    this.scanStatus('GUI', 'done', frames.length, frames.length);
  }

  // 변경사항 확인(UI): 아직 반영하지 않은 GUI 갱신을 모든 플립북에 반영한 뒤,
  // 플립북 UI 작성 영역을 이전 UI Publish와 비교한다. 끝까지 마쳐야 UI Publish를 할 수 있다.
  async scanUi(): Promise<void> {
    const seq = ++this.uiScanSeq;
    this.selectedScan.UI = false;
    this.uiCheckedAt = null;
    this.uiPartialAt = null;
    this.store.reload();
    this.scanStatus('UI', 'loading');
    const pulled = await this.pullGui(() => seq === this.uiScanSeq);
    if (seq !== this.uiScanSeq) return;
    if (pulled) this.host.post({ type: pulled.failed ? 'error' : 'notice', message: pulled.message });
    const flipbooks = [...this.store.state.flipbooks.values()];
    let inspected: { found: Map<string, string>; spots: Record<string, FlipbookSpot> };
    try { inspected = await this.inspectFlipbooks(); }
    catch (e) { if (seq !== this.uiScanSeq) return; this.scanStatus('UI', 'failed'); throw e; }
    if (seq !== this.uiScanSeq) return;
    const { found, spots } = inspected;
    this.uiScans = flipbooks.map(fb => { const nodeId = found.get(fb.id) ?? null; return { flipbookId: fb.id, nodeId, fingerprint: null, error: null, spot: spotOf(spots, nodeId) }; });
    const targets = this.uiScans.filter(u => u.nodeId && this.store.state.flipbooks.get(u.flipbookId)?.status !== 'deleted');
    this.postUiScans();
    this.scanStatus('UI', 'comparing', 0, targets.length);
    let lastListPost = Date.now();
    const pause = yielder();
    for (let i = 0; i < targets.length; i++) {
      const result = await this.host.uiFingerprint(targets[i].nodeId!);
      await pause();
      if (seq !== this.uiScanSeq) return;
      Object.assign(targets[i], result);
      if ((i + 1) % PROGRESS_STEP === 0 && i < targets.length - 1) {
        if (Date.now() - lastListPost >= 100) { this.postUiScans(); lastListPost = Date.now(); }
        this.scanStatus('UI', 'comparing', i + 1, targets.length);
      }
    }
    this.uiCheckedAt = this.store.now();
    this.postUiScans();
    this.scanStatus('UI', 'done', targets.length, targets.length);
  }

  private postUiScans() {
    this.host.post({ type: 'uiScan', scans: this.uiScans });
    this.host.post({ type: 'listSynced', at: this.store.now() });
  }

  // 템플릿을 다시 확인하고 결과가 바뀌면 UI에 알린다. 템플릿 컴포넌트는 플러그인 밖에서 바뀌므로 만들기·반영 직전에도 확인한다.
  private async checkTemplate(): Promise<string[]> {
    const issues = await this.host.templateIssues?.(this.store.state.project.templateNodeId) ?? [];
    if (issues.join('\n') !== this.templateIssues.join('\n')) {
      this.templateIssues = issues;
      this.host.post({ type: 'templateIssues', issues });
    }
    return issues;
  }

  // GUI 배포 기록을 그 화면을 쓰는 플립북마다 반영한다. GUI Publish 직후, UI 변경사항 확인, 관리 정정 뒤에 실행한다.
  // 이미 반영한 버전은 건너뛰므로 여러 번 실행해도 같은 결과가 된다.
  private async pullGui(isCurrent: () => boolean = () => true): Promise<{ message: string; failed: boolean } | null> {
    const s = this.store;
    s.reload();
    const active = [...s.state.flipbooks.values()].filter(fb => fb.status === 'active' && fb.screens.length);
    if (!active.length || !isCurrent()) return null;
    const screens = guiScreens(s.state);
    const records = guiRecordInfos(s.state, new Set(active.flatMap(fb => fb.screens.map(x => x.uid))));
    const batchId = `gui:${randomId()}`;
    let added = 0;
    const missing = new Set<string>();
    for (const fb of active) {
      const result = importGuiUpdates(s, fb.id, screens, records);
      result.missing.forEach(code => missing.add(code));
      if (!result.changed) continue;
      added += result.added;
      addDelivery(s, batchId, 'flipbook', 'GUI', fb.id, 0);
    }
    const changed = unfinishedDeliveries(s.state, { batchId }).length;
    const report = changed ? await this.deliverFlipbooks({ batchId }) : emptyReport();
    if (changed) await this.refreshData();
    this.postState();
    const parts = [
      changed ? `${COPY.controller043} ${changed}${COPY.controller044} ${added}${COPY.controller045}` : '',
      changed ? deliveryMessage(report) : '',
      missing.size ? `${COPY.controller046} ${[...missing].join(', ')}` : '',
    ].filter(Boolean);
    if (!parts.length) return null;
    return { message: parts.join(' '), failed: report.failed.length > 0 || !!report.skipped };
  }

  // GUI를 다시 배포하면 그 화면이 든 플로우의 썸네일만 바꾼다(2026-10-23 사용자 결정). 그룹이 지워진 플로우는 위치 기록도 지운다.
  // 플로우 실패는 배포 결과와 따로 알린다.
  private async updateFlows(uids: Set<string>): Promise<string | null> {
    if (!this.host.updateFlow || !uids.size) return null;
    const s = this.store;
    s.reload();
    const { flows, thumbs } = flowUpdates(s.state, uids);
    let updated = 0;
    const failed: string[] = [];
    for (const flow of flows) {
      try {
        const changed = await this.host.updateFlow(flow, thumbs);
        if (changed === null) this.forgetFlow(flow);
        else if (changed) updated++;
      } catch (e) {
        failed.push(`${flow.title}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return [updated ? `${COPY.flow008} ${updated}${COPY.flow009}` : '', failed.length ? `${COPY.flow010} ${failed.join('; ')}` : ''].filter(Boolean).join(' ') || null;
  }

  // 플로우 만들기: 배포된 화면만 넣는다. 위치를 기록하고(플로우 목록) 이력 행은 남기지 않는다. 감사 기록은 다른 기록과 같이 남긴다.
  private async createFlow(request: FlowRequest): Promise<void> {
    if (!this.host.createFlow) return;
    const s = this.store;
    s.reload();
    const plan = planFlow(s.state, request, s.newId);
    const placed = await this.host.createFlow(plan);
    const record = flowRecord(plan, placed, this.host.actor, s.now());
    s.put(keys.flow(plan.id), record);
    s.audit(this.host.actor, 'flow.create', plan.id, null, { title: record.title, pageId: record.pageId, screens: record.uids });
    this.host.post({ type: 'notice', message: [`${COPY.flow007} ${plan.title}`, ...placed.notes].join(' ') });
  }

  // 캔버스에서 그룹을 지운 플로우의 기록을 뺀다.
  private forgetFlow(flow: FlowRecord): void {
    this.store.remove(keys.flow(flow.id));
    this.store.audit(this.host.actor, 'flow.remove', flow.id, { title: flow.title, pageId: flow.pageId }, null);
  }

  // 플로우 목록. check: 캔버스에서 그룹이 지워진 플로우를 찾아 기록에서 뺀다(그 플로우가 있는 페이지를 불러온다).
  private async postFlows(check = true): Promise<void> {
    const s = this.store;
    s.reload();
    if (check && this.host.flowNode) {
      for (const flow of [...s.state.flows.values()]) if (!(await this.host.flowNode(flow))) this.forgetFlow(flow);
    }
    this.host.post({ type: 'flows', flows: flowList(s.state, new Map(this.host.pages().map(p => [p.id, p.name]))) });
  }

  // 선택 화면 확인(GUI): 원본 목록은 전체를 다시 읽고(신규 후보·복제 의심·원본 없음 판단) 지문은 고른 화면만 계산한다.
  // 이미 계산한 다른 화면의 지문은 이어 쓴다. 그 사이 화면이 바뀌었으면 확정 직전 검사가 다시 잡는다.
  async scanSelectedGui(entryKeys: string[]): Promise<void> {
    const seq = ++this.scanSeq;
    this.selectedScan.GUI = true;
    this.store.reload();
    const legacy = this.legacySources();
    const reader = this.host.createFingerprintReader?.() ?? this.host;
    const keys = new Set(entryKeys);
    const wanted = new Set([
      ...this.entries.filter(e => keys.has(e.key) && e.frame).map(e => e.frame!.nodeId),
      ...entryKeys.filter(key => key.startsWith('node:')).map(key => key.slice(5)),
    ]);
    const { scopePageIds, scopeSectionIds } = this.store.state.project;
    this.scanStatus('GUI', 'loading');
    let frames: ScannedFrame[];
    try { frames = await this.host.listFrames(scopePageIds, scopeSectionIds, () => seq === this.scanSeq); }
    catch (e) { if (seq !== this.scanSeq) return; this.scanStatus('GUI', 'failed'); throw e; }
    if (seq !== this.scanSeq) return;
    const known = new Map(this.frames.map(f => [f.nodeId, f]));
    this.frames = frames.map(f => {
      const before = known.get(f.nodeId);
      return before && !wanted.has(f.nodeId) ? { ...f, fingerprint: before.fingerprint, legacyFingerprint: before.legacyFingerprint, error: before.error } : f;
    });
    this.framesLoaded = true;
    this.postEntries();
    const targets = this.frames.map((f, i) => (wanted.has(f.nodeId) ? i : -1)).filter(i => i >= 0);
    this.scanStatus('GUI', 'comparing', 0, targets.length);
    const pause = yielder();
    for (const [n, i] of targets.entries()) {
      const result = await reader.fingerprint(this.frames[i].nodeId, legacy.has(this.frames[i].nodeId));
      await pause();
      if (seq !== this.scanSeq) return;
      this.frames[i] = { ...this.frames[i], ...result };
      if ((n + 1) % PROGRESS_STEP === 0 && n < targets.length - 1) this.scanStatus('GUI', 'comparing', n + 1, targets.length);
    }
    this.partialAt = this.store.now();
    this.selectedScan.GUI = false;
    this.upgradeBaselines();
    this.postEntries();
    this.scanStatus('GUI', 'done', targets.length, targets.length);
  }

  // 선택 화면 확인(UI): 플립북 목록은 다시 읽고 고른 플립북의 UI 작성 영역만 비교한다. GUI 갱신은 전체 확인에서 반영한다.
  async scanSelectedUi(flipbookIds: string[]): Promise<void> {
    const seq = ++this.uiScanSeq;
    this.selectedScan.UI = true;
    this.store.reload();
    const wanted = new Set(flipbookIds);
    this.scanStatus('UI', 'loading');
    let inspected: { found: Map<string, string>; spots: Record<string, FlipbookSpot> };
    try { inspected = await this.inspectFlipbooks(); }
    catch (e) { if (seq !== this.uiScanSeq) return; this.scanStatus('UI', 'failed'); throw e; }
    if (seq !== this.uiScanSeq) return;
    const { found, spots } = inspected;
    const known = new Map(this.uiScans.map(u => [u.flipbookId, u]));
    this.uiScans = [...this.store.state.flipbooks.values()].map(fb => {
      const nodeId = found.get(fb.id) ?? null;
      const before = known.get(fb.id);
      return before && before.nodeId === nodeId && !wanted.has(fb.id) ? { ...before, spot: spotOf(spots, nodeId) } : { flipbookId: fb.id, nodeId, fingerprint: null, error: null, spot: spotOf(spots, nodeId) };
    });
    const targets = this.uiScans.filter(u => wanted.has(u.flipbookId) && u.nodeId && this.store.state.flipbooks.get(u.flipbookId)?.status !== 'deleted');
    this.postUiScans();
    this.scanStatus('UI', 'comparing', 0, targets.length);
    const pause = yielder();
    for (const [n, scan] of targets.entries()) {
      const result = await this.host.uiFingerprint(scan.nodeId!);
      await pause();
      if (seq !== this.uiScanSeq) return;
      Object.assign(scan, result);
      if ((n + 1) % PROGRESS_STEP === 0 && n < targets.length - 1) this.scanStatus('UI', 'comparing', n + 1, targets.length);
    }
    this.uiPartialAt = this.store.now();
    this.selectedScan.UI = false;
    this.postUiScans();
    this.scanStatus('UI', 'done', targets.length, targets.length);
  }

  // 진행 중인 비교를 멈춘다. 읽은 원본 목록과 계산한 지문은 남기지만, 끝까지 마치지 않았으므로 확인 전으로 본다.
  // 선택 화면 확인을 멈출 때는 이전 확인 결과를 그대로 둔다.
  private cancelScan(team: Team) {
    const selected = this.selectedScan[team];
    this.selectedScan[team] = false;
    if (team === 'GUI') {
      this.scanSeq++;
      if (!selected) this.checkedAt = null;
      this.postEntries();
    } else {
      this.uiScanSeq++;
      if (!selected) this.uiCheckedAt = null;
      this.postUiScans();
    }
    this.scanStatus(team, 'cancelled');
  }

  // ── 새 버전 페이지 ───────────────────────────────────────

  // 다른 파일에서 붙여 넣은 페이지의 프레임을 등록 화면과 비교한다. 프레임 이름은 보지 않는다(2026-10-21 사용자 결정).
  // 새 프레임의 지문을 비교 기준과 맞춰 보고, 남은 화면은 현재 원본 프레임과 내용 유사도로 짝을 제안한다. 기록은 바꾸지 않는다.
  private async matchVersion(pageId: string): Promise<void> {
    this.version = null;
    this.store.reload();
    const { project } = this.store.state;
    if (!pageId || pageId === project.dataPageId || project.scopePageIds.includes(pageId) || !this.host.pages().some(p => p.id === pageId))
      throw new Error(COPY.controller108);
    const listed = await this.host.listFrames([pageId], []);
    const screens = [...this.store.state.screens.values()].filter(x => x.status === 'active' && x.source);
    const legacy = this.legacySources();
    const reader = this.host.createFingerprintReader?.() ?? this.host;
    const total = listed.length + screens.length;
    let done = 0;
    const step = async () => { if (++done % PROGRESS_STEP === 0) await this.progress(`${COPY.controller106} ${done}/${total}`); };
    const frames: VersionFrame[] = [];
    for (const f of listed) {
      frames.push({ nodeId: f.nodeId, ...await reader.screenFeatures(f.nodeId, legacy.size > 0), name: f.name });
      await step();
    }
    const sources = new Map<string, string[]>();
    const sourceNames = new Map<string, string>();
    let upgraded = false;
    for (const screen of screens) {
      const { tokens, fingerprint, legacyFingerprint, name } = await reader.screenFeatures(screen.source!.nodeId, legacy.has(screen.source!.nodeId));
      if (tokens) sources.set(screen.id, tokens);
      if (name !== undefined) sourceNames.set(screen.id, name);
      // 원본이 1 규칙 기준과 같으면 기준을 2 규칙으로 옮겨, 붙여 넣으며 소수점이 흔들린 프레임도 「동일」로 맞춘다.
      if (fingerprint && legacyFingerprint) upgraded = upgradeBaseline(this.store, screen.id, legacyFingerprint, fingerprint, this.host.actor) || upgraded;
      await step();
    }
    if (upgraded) { this.store.reload(); this.postState(); }
    const links = matchVersion(this.store.state, frames, sources, sourceNames);
    this.version = {
      pageId, frames, sources, common: versionCommon(frames, links),
      scanned: listed.map((f, i) => ({ ...f, fingerprint: frames[i].fingerprint, legacyFingerprint: frames[i].legacyFingerprint, error: frames[i].error })),
    };
    this.host.post({ type: 'versionMatch', match: { pageId, links, frames: frames.map(f => ({ nodeId: f.nodeId, name: f.name })) } });
  }

  // 확인한 연결로 원본을 옮긴다. 연결한 프레임에 화면 표식을 남기고 이름을 `[Screen ID] 이름`으로 바꾸며,
  // 그 페이지만 GUI 원본 범위로 둔다. 버전은 만들지 않고 기존 페이지는 바꾸지 않는다.
  // 비교 때 계산한 지문으로 목록을 바로 분류한다: 같은 화면은 변경사항 없음, 바뀐 화면은 변경 감지,
  // 연결하지 않은 프레임은 신규, 연결하지 않은 화면은 원본 없음(삭제 후보).
  private async switchVersion(pageId: string, links: { screenId: string; nodeId: string }[]): Promise<void> {
    const version = this.version;
    if (!version || version.pageId !== pageId) throw new Error(COPY.controller109);
    const s = this.store, a = this.host.actor;
    s.reload();
    const errors = versionLinkErrors(s.state, links, new Set(version.frames.map(f => f.nodeId)));
    if (errors.length) throw new Error(errors.join(' / '));
    for (const link of links) relinkSource(s, link.screenId, link.nodeId, pageId, a, COPY.coreVersion004);
    const before = s.state.project;
    s.saveProject({ ...before, scopePageIds: [pageId], scopeSectionIds: [] });
    s.audit(a, 'project.scope', 'project', before.scopePageIds, [pageId], COPY.coreVersion004);
    this.version = null;
    // 프레임 이름은 바꾸지 않는다. 화면 이름·Screen ID는 기록에만 둔다(2026-10-21 사용자 결정).
    const failed: string[] = [];
    for (const link of links) {
      try { await this.host.tagSource(link.nodeId, link.screenId); }
      catch { failed.push(s.state.screens.get(link.screenId)!.code); }
    }
    const tags = new Map(links.map(link => [link.nodeId, link.screenId]));
    this.scanSeq++;
    this.frames = version.scanned.map(f => ({ ...f, screenTag: tags.get(f.nodeId) ?? f.screenTag }));
    this.framesLoaded = true;
    this.checkedAt = s.now();
    this.partialAt = null;
    s.reload();
    this.postState();
    this.postEntries();
    this.scanStatus('GUI', 'done', this.frames.length, this.frames.length);
    const count = (pick: (e: Entry) => boolean) => this.entries.filter(pick).length;
    const summary = [
      `${COPY.controller111} ${count(e => !!e.screenId && e.estimate === 'unchanged' && !changeDetected(e))}`,
      `${COPY.controller112} ${count(changeDetected)}`,
      `${COPY.controller113} ${count(e => !e.screenId)}`,
      `${COPY.controller114} ${count(e => e.estimate === 'missing')}`,
    ].join(' · ');
    this.host.post({ type: 'versionMatch', match: null });
    this.host.post({ type: 'versionSwitched' });
    this.host.post({ type: failed.length ? 'error' : 'notice', message: [COPY.controller110, summary, failed.length ? `${COPY.controller115} ${failed.join(', ')}` : ''].filter(Boolean).join(' ') });
  }

  // ── 캔버스 이동·선택 ─────────────────────────────────────

  private async navigate(nav: number, entryKey: string, target: NavTarget): Promise<void> {
    this.navSeq = nav;
    const latest = () => nav === this.navSeq;
    let nodeId: string | null = null;
    if (target === 'source') nodeId = this.entries.find(e => e.key === entryKey)?.frame?.nodeId ?? null;
    else nodeId = await this.findFlipbook(entryKey);
    if (!latest()) return;
    if (!nodeId) {
      this.host.post({ type: 'nav', nav, ok: false, message: target === 'flipbook' ? COPY.controller014 : COPY.controller015 });
      return;
    }
    const ok = await this.host.reveal(nodeId, latest);
    if (latest()) this.host.post({ type: 'nav', nav, ok, message: ok ? '' : COPY.controller016 });
  }

  private async selectFrames(nav: number, team: Team, entryKeys: string[], lastKey: string): Promise<void> {
    this.navSeq = nav;
    const latest = () => nav === this.navSeq;
    let ids: string[];
    let lastId: string | null;
    if (team === 'GUI') {
      const selected = this.entries.filter(e => entryKeys.includes(e.key));
      lastId = this.entries.find(e => e.key === lastKey)?.frame?.nodeId ?? null;
      ids = selected.map(e => e.frame?.nodeId).filter((id): id is string => !!id);
    } else {
      // UI 목록의 항목 키는 플립북 ID다.
      let flipbooks = new Map(this.uiScans.filter(scan => scan.nodeId).map(scan => [scan.flipbookId, scan.nodeId!]));
      if (entryKeys.some(id => !flipbooks.has(id))) flipbooks = await this.host.listFlipbooks(this.flipbookPages());
      lastId = flipbooks.get(lastKey) ?? null;
      ids = entryKeys.map(id => flipbooks.get(id)).filter((id): id is string => !!id);
    }
    if (!lastId || !latest()) return;
    await this.host.selectNodes(ids, lastId, latest);
    if (!latest()) return;
    this.previousCanvasIds = ids;
    if (latest()) await this.host.reveal(lastId, latest);
  }

  // 텍스트 편집 대상(2026-10-22 사용자 요청: 어느 플립북을 골랐는지 알려 준다). 플립북 표식이 있으면 기록의 제목을 쓴다.
  private postTextTarget(): void {
    const target = this.host.selectionTarget?.();
    if (!target) return;
    const title = target.kind === 'description' && target.flipbookId ? this.store.state.flipbooks.get(target.flipbookId)?.title : undefined;
    this.host.post({ type: 'textTarget', target: target.kind === 'description' && title ? { ...target, name: title } : target });
  }

  private postPdfSelection(): void {
    const selection = this.host.pdfSelection?.();
    if (selection) this.host.post({ type: 'pdfSelection', selection });
  }

  async canvasSelectionChanged(): Promise<void> {
    if (this.host.mode === 'UI' && this.textTabOpen) this.postTextTarget();
    if (this.host.mode === 'UI' && this.pdfTabOpen) this.postPdfSelection();
    const nodes = this.host.selectionNodeIds();
    if (nodes === null) return;
    const canvasSeq = ++this.canvasSelectionSeq;
    const ids = nodes.map(node => node.nodeId);
    const selectedIds = new Set(ids);
    const previousIds = new Set(this.previousCanvasIds);
    let entryByNode = new Map(this.entries.filter(entry => entry.frame).map(entry => [entry.frame!.nodeId, entry]));
    const lastId = ids.find(id => !previousIds.has(id)) ?? ids[ids.length - 1];
    this.previousCanvasIds = ids;
    // 처음 확인하기 전의 신규 프레임도 캔버스 선택으로 목록에 올려 선택 확인을 할 수 있게 한다.
    if (this.host.mode === 'GUI' && !this.scanningGui && nodes.some(node => !node.flipbookId && !entryByNode.has(node.nodeId))) {
      const scanSeq = this.scanSeq;
      this.store.reload();
      const { scopePageIds, scopeSectionIds } = this.store.state.project;
      try {
        const frames = await this.host.listFrames(scopePageIds, scopeSectionIds, () => scanSeq === this.scanSeq && canvasSeq === this.canvasSelectionSeq);
        if (scanSeq !== this.scanSeq || canvasSeq !== this.canvasSelectionSeq) return;
        const known = new Map(this.frames.map(frame => [frame.nodeId, frame]));
        this.frames = frames.map(frame => {
          const before = known.get(frame.nodeId);
          return before ? { ...frame, fingerprint: before.fingerprint, legacyFingerprint: before.legacyFingerprint, error: before.error } : frame;
        });
        this.framesLoaded = true;
        this.postEntries();
        entryByNode = new Map(this.entries.filter(entry => entry.frame).map(entry => [entry.frame!.nodeId, entry]));
      } catch (error) {
        if (canvasSeq === this.canvasSelectionSeq) this.host.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    }
    const gui = this.entries.filter(e => !!e.frame && selectedIds.has(e.frame.nodeId)).map(e => e.key);
    // 캔버스에서 복제한 플립북 프레임도 같은 플립북 ID를 가진다. 찾아 둔 플립북 프레임이 따로 있으면 복사본은 목록에서 고르지 않는다.
    const linked = new Map(this.uiScans.filter(scan => scan.nodeId).map(scan => [scan.flipbookId, scan.nodeId]));
    const ui = nodes.filter(node => !node.flipbookId || !linked.has(node.flipbookId) || linked.get(node.flipbookId) === node.nodeId)
      .map(node => node.flipbookId).filter((id): id is string => !!id && this.store.state.flipbooks.has(id));
    // 실행한 명령의 목록에서만 고른다. GUI Publish에서 플립북 프레임을, UI Flipbook에서 GUI 원본을 골라도
    // 다른 명령의 화면으로 넘어가지 않는다(두 명령은 2026-10-20부터 따로 연다).
    const team: Team = this.host.mode;
    const keys = team === 'GUI' ? gui : [...new Set(ui)];
    const lastNode = nodes.find(node => node.nodeId === lastId);
    const lastKey = team === 'GUI'
      ? entryByNode.get(lastId)?.key
      : lastNode?.flipbookId ?? undefined;
    this.host.post({ type: 'canvasSelection', team, entryKeys: keys, lastKey: lastKey && keys.includes(lastKey) ? lastKey : keys[keys.length - 1] ?? null });
    // UI Flipbook은 캔버스 선택마다 플립북 페이지를 다시 읽지 않는다(캔버스 작업이 느려져서, 2026-10-23 사용자 요청).
    // 연결 상태·순서·Section은 목록 새로고침(refreshList)과 플러그인 작업 뒤에 맞춘다.
  }

  // 캔버스에서 옮기거나 이름을 바꾼 Section을 그 플립북의 기록과 Chapter에 반영한다(플립북의 페이지·Section은 캔버스가 원본).
  // 캔버스를 쓰므로 main.ts가 쓰기 순서에 넣어 부른다. 기록과 다른 플립북을 찾았을 때만 반영한다.
  // canvas: 바로 앞 linkFlipbooks가 읽은 캔버스(다시 읽지 않는다). 없으면 다시 읽는다.
  async syncCanvasSections(canvas?: { found: Map<string, string>; spots: Record<string, FlipbookSpot> }): Promise<void> {
    if (this.host.mode !== 'UI' || !this.canvasSectionsPending) return;
    this.canvasSectionsPending = false;
    let delivered = false;
    try {
      const changed = await this.followCanvas(canvas);
      if (!changed.length) return;
      // 바뀐 것은 Section뿐이므로 Chapter만 다시 쓴다. Host가 지원하지 않으면 플립북 전체를 반영한다.
      const s = this.store.state;
      if (this.host.syncChapters) {
        await this.host.syncChapters(changed.flatMap(id => {
          const fb = s.flipbooks.get(id);
          const pageId = fb?.pageId ?? s.project.flipbookPageId;
          return fb && pageId ? [{ pageId, flipbookId: id, name: chapterName(fb) }] : [];
        }));
      } else {
        delivered = true;
        await this.deliverFlipbooks({}, { targets: changed, canvasFollowed: true });
      }
      this.postState();
      await this.refreshData();
    } catch (e) {
      this.host.post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      // 버튼 요청이 아니라 캔버스 선택에서 부르므로 반영 중 표시를 여기서 닫는다.
      if (delivered) this.busy(null);
    }
  }

  // 기록을 캔버스의 페이지·Section으로 맞추고 바뀐 플립북 ID를 돌려준다. canvas: 같은 작업에서 이미 읽은 캔버스(다시 읽지 않는다).
  private async followCanvas(canvas?: { found: Map<string, string>; spots: Record<string, FlipbookSpot> }): Promise<string[]> {
    const s = this.store;
    s.reload();
    const { found, spots } = canvas ?? await this.inspectFlipbooks();
    return followCanvasSections(s, canvasSections(s.state, found, spots), this.host.actor).map(fb => fb.id);
  }

  // UI Flipbook: 플립북 프레임이 캔버스에 있는지만 다시 찾는다(지문 비교 없음). 찾지 못한 플립북은 목록에 연결 끊김으로 표시한다.
  // 읽은 캔버스를 돌려주어 이어지는 Section 맞추기가 다시 읽지 않게 한다.
  private async linkFlipbooks(isLatest: () => boolean = () => true): Promise<{ found: Map<string, string>; spots: Record<string, FlipbookSpot> } | undefined> {
    const canvas = await this.inspectFlipbooks();
    if (!isLatest()) return undefined;
    this.applyLinks(canvas.found, canvas.spots);
    return canvas;
  }

  private async inspectFlipbooks(pageIds = this.flipbookPages()): Promise<{ found: Map<string, string>; spots: Record<string, FlipbookSpot> }> {
    if (this.host.inspectFlipbooks) return this.host.inspectFlipbooks(pageIds);
    const found = await this.host.listFlipbooks(pageIds);
    return { found, spots: await this.spots(pageIds) };
  }

  // 플립북 프레임의 캔버스 위치. 목록 순서에만 쓰므로 읽지 못하면 위치 없이 둔다(Screen ID 순).
  private async spots(pageIds = this.flipbookPages()): Promise<Record<string, FlipbookSpot>> {
    if (!this.host.flipbookSpots) return {};
    return this.host.flipbookSpots(pageIds).catch(() => ({}));
  }

  // 찾은 플립북 프레임(플립북 ID → 노드 ID)과 캔버스 위치로 목록의 연결 상태·순서를 갱신한다.
  private applyLinks(found: Map<string, string>, spots: Record<string, FlipbookSpot> = {}): void {
    if (canvasSections(this.store.state, found, spots).length) this.canvasSectionsPending = true;
    const known = new Map(this.uiScans.map(u => [u.flipbookId, u]));
    const next = [...this.store.state.flipbooks.values()].map(fb => {
      const nodeId = found.get(fb.id) ?? null;
      const spot = spotOf(spots, nodeId);
      const before = known.get(fb.id);
      if (before && before.nodeId === nodeId) return sameSpot(before.spot, spot) ? before : { ...before, spot };
      return { flipbookId: fb.id, nodeId, fingerprint: null, error: null, spot };
    });
    // 바뀐 것이 없어도 다시 읽은 시각은 알린다(목록 새로고침이 끝났다는 신호이기도 하다).
    if (next.length === this.uiScans.length && next.every((u, i) => u === this.uiScans[i])) { this.host.post({ type: 'listSynced', at: this.store.now() }); return; }
    this.uiScans = next;
    this.postUiScans();
  }

  // 연결이 끊긴 플립북을 목록에서 삭제한다. 삭제 직전에 플립북 페이지에서 다시 찾고, 프레임이 있으면 지우지 않는다.
  // 파일 전체 페이지를 불러오면 삭제가 너무 느려서 플립북 페이지만 찾는다(2026-10-21 사용자 결정). 플립북 페이지가 아닌 곳으로 직접 옮긴 프레임은 찾지 못한다.
  private async removeFlipbooks(ids: string[]): Promise<void> {
    const s = this.store;
    s.reload();
    const { found, spots } = await this.inspectFlipbooks();
    const removed = removeFlipbooks(s, ids, new Set(found.keys()), this.host.actor);
    const kept = ids.filter(id => found.has(id)).map(id => s.state.flipbooks.get(id)?.title ?? id);
    if (removed.length) await this.refreshData(false, false);
    this.postState();
    this.applyLinks(found, spots);
    const message = [`${removed.length}${COPY.controller069}`, kept.length ? `${COPY.controller070} ${kept.join(', ')}` : ''].filter(Boolean).join(' ');
    this.host.post({ type: 'flipbooksRemoved', ids: removed, message });
  }

  private async findFlipbook(flipbookId: string): Promise<string | null> {
    const fb = this.store.state.flipbooks.get(flipbookId);
    const pageId = fb?.pageId ?? this.store.state.project.flipbookPageId;
    return pageId ? this.host.findFlipbook(pageId, flipbookId) : null;
  }

  // 플립북이 있는 페이지. 한 파일의 여러 페이지에 플립북을 만들 수 있다.
  // 목록에서 삭제한 플립북만 남은 페이지는 찾을 것이 없으므로 불러오지 않는다(처음 불러오는 페이지는 시간이 오래 걸린다).
  private flipbookPages(): string[] {
    const s = this.store.state;
    const ids = [...s.flipbooks.values()].filter(fb => fb.status === 'active').map(fb => fb.pageId ?? s.project.flipbookPageId).filter((id): id is string => !!id);
    return [...new Set(ids)];
  }

  // ── 배포 ──────────────────────────────────────────────

  private async prepare(team: Plan['team'], drafts: Record<string, Draft>, comment?: BatchComment): Promise<void> {
    // GUI·UI Publish 모두 그 탭의 변경사항 확인을 끝까지 마친 뒤에만 연다.
    // GUI는 신규 후보·원본 없음·복제 여부를, UI는 플립북 UI 작성 영역 변경을 확인해야 알 수 있다.
    // 선택 화면 확인만 했으면 판정이 나온 화면(「비교 전」이 아닌 화면)만 포함할 수 있다.
    const full = team === 'GUI' ? this.checkedAt : this.uiCheckedAt;
    const partial = team === 'GUI' ? this.partialAt : this.uiPartialAt;
    if (!full && !partial) throw new Error(COPY.controller017);
    if (!full) {
      const estimateOf = (key: string) => team === 'GUI'
        ? this.entries.find(e => e.key === key)?.estimate
        : uiEstimate(this.store.state, key, this.uiScans.find(u => u.flipbookId === key));
      if (Object.entries(drafts).some(([key, d]) => d.included && estimateOf(key) === 'pending')) throw new Error(COPY.controller037);
    }
    this.store.reload();
    let entries: Entry[];
    if (team === 'GUI') {
      // 아직 지문을 계산하지 못한 포함 항목은 지금 계산한다.
      const entriesByNode = new Map(this.entries.filter(e => e.frame).map(e => [e.frame!.nodeId, e]));
      const legacy = this.legacySources();
      const reader = this.host.createFingerprintReader?.() ?? this.host;
      for (let i = 0; i < this.frames.length; i++) {
        const f = this.frames[i];
        const entry = entriesByNode.get(f.nodeId);
        if (f.fingerprint === null && !f.error && entry && drafts[entry.key]?.included && !drafts[entry.key]?.notScreen)
          this.frames[i] = { ...f, ...await reader.fingerprint(f.nodeId, legacy.has(f.nodeId)) };
      }
      this.entries = classify(this.store.state, this.frames);
      entries = this.entries;
    } else {
      entries = uiEntries(this.store.state, new Map(this.uiScans.map(u => [u.flipbookId, u])));
    }
    const plan = buildPlan(team, this.store.state, entries, drafts, this.host.actor, randomId(), comment);
    this.plans.clear();
    this.plans.set(plan.batchId, plan);
    this.host.post({ type: 'plan', plan });
  }

  private async commit(batchId: string): Promise<void> {
    const plan = this.plans.get(batchId);
    if (!plan) throw new Error(COPY.controller018);
    const input: CommitInput = { fingerprints: {}, thumbs: {} };
    // 신규·변경 GUI는 확정 직전 썸네일을 만든다. 썸네일을 만들지 못해도 확정하고 알린다.
    const thumbErrors: string[] = [];
    for (const [i, item] of plan.items.entries()) {
      if (!item.frame) continue;
      if (item.needsThumb) await this.progress(`${COPY.controller019} ${i + 1}/${plan.items.length}`);
      const fresh = await this.host.fingerprint(item.frame.nodeId, false);
      input.fingerprints[item.entryKey] = fresh.fingerprint;
      // 확인한 내용과 같을 때만 썸네일을 만든다. 다르면 commitPlan이 충돌로 돌려준다.
      if (!item.needsThumb || fresh.fingerprint !== item.frame.fingerprint) continue;
      try { input.thumbs[item.entryKey] = await this.host.makeThumbnail(item.frame.nodeId, formatFrameName(item.code, item.name)); }
      catch (e) { thumbErrors.push(`${item.name}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    if (plan.team === 'UI') {
      input.uiFingerprints = {};
      input.uiNodeIds = {};
      const flipbooks = await this.host.listFlipbooks(this.flipbookPages());
      for (const item of plan.items) {
        const nodeId = flipbooks.get(item.screenId) ?? null;
        input.uiNodeIds[item.entryKey] = nodeId;
        input.uiFingerprints[item.entryKey] = nodeId ? (await this.host.uiFingerprint(nodeId)).fingerprint : null;
      }
    }
    const result = commitPlan(this.store, plan, input);
    const done = new Set(result.committed);
    const items = plan.items.filter(item => done.has(item.entryKey));
    const exclusions = plan.exclusions.filter(item => done.has(item.entryKey));
    const thumbnails = items.flatMap(item => {
      const thumb = input.thumbs[item.entryKey];
      return item.team === 'GUI' && thumb ? [{ screenId: item.screenId, label: formatFrameName(item.code, item.name), thumb }] : [];
    });
    if (thumbnails.length) {
      try { await this.host.placeThumbnails?.(thumbnails); }
      catch (e) { thumbErrors.push(`${COPY.controller062} ${e instanceof Error ? e.message : String(e)}`); }
    }
    if (result.ok) {
      // 원본 프레임에는 화면 표식만 남기고 이름은 그대로 둔다. 화면 이름·Screen ID는 기록에만 둔다(2026-10-21 사용자 결정).
      for (const item of items) {
        if (item.team !== 'GUI' || !item.frame) continue;
        await this.host.tagSource(item.frame.nodeId, item.screenId);
      }
      this.plans.delete(batchId);
    }
    // 확정 뒤의 플립북·DATA 실패는 확정 기록과 구분해 알린다. GUI는 그 화면을 쓰는 플립북에 바로 반영한다.
    // 삭제나 화면이 아님으로 배포해 화면이 모두 사용 안 함이 된 플립북도 사용 안 함으로 바꾼다.
    const retired = exclusions.some(item => item.screenId);
    if (result.ok && plan.team === 'GUI' && (retired || items.some(item => item.workType === 'deleted'))) retireFlipbooks(this.store, this.host.actor);
    let report: string | null = null;
    if (result.ok && items.length) {
      report = plan.team === 'GUI'
        ? [(await this.pullGui())?.message, await this.updateFlows(new Set(items.filter(i => i.workType !== 'deleted').map(i => i.screenId)))].filter(Boolean).join(' ') || null
        : deliveryMessage(await this.deliverFlipbooks({ batchId }));
      await this.progress(COPY.controller005);
    }
    const data = result.ok && (items.length || retired) ? await this.refreshData() : true;
    const pending = unfinishedDeliveries(this.store.state, { batchId }).length;
    const failed = result.conflicts.length ? `${COPY.controller035} ${result.conflicts.length}${COPY.controller036} ${result.conflicts.map(c => `${c.name}: ${c.messages.join(', ')}`).join('; ')}` : '';
    this.host.post({
      type: 'committed', ok: result.ok, committed: result.committed, conflicts: result.conflicts, batchId, pending,
      message: result.ok
        ? [items.length ? `${items.length}${COPY.controller020}` : '', thumbErrors.length ? `${COPY.controller062} ${thumbErrors.join('; ')}` : '', exclusions.length ? `${exclusions.length}${COPY.controller021}` : '', failed, report, data ? '' : COPY.controller022].filter(Boolean).join(' ')
        : COPY.controller023,
    });
    this.postState();
    // 전체를 다시 비교하지 않는다. 확정한 화면은 방금 계산한 지문이 새 기준이므로 목록만 다시 분류한다.
    if (result.ok) {
      if (plan.team === 'GUI') {
        // 표식을 남겼으므로 읽어 둔 원본 목록의 표식도 맞춘다.
        const tagged = new Map(items.filter(i => i.frame).map(i => [i.frame!.nodeId, i.screenId]));
        this.frames = this.frames.map(f => tagged.has(f.nodeId) ? { ...f, screenTag: tagged.get(f.nodeId)! } : f);
      }
      this.refreshEstimates({ ...plan, items });
    }
  }

  // 변경 무시: 변경 감지된 화면의 현재 지문을 비교 기준으로 바로 저장한다. 프레임 이름·카테고리가 바뀐 화면은 무시할 수 없다.
  private ignoreChanges(entryKeys: string[]): void {
    this.store.reload();
    const wanted = new Set(entryKeys);
    const blocked: string[] = [];
    let done = 0;
    for (const entry of this.entries) {
      if (!wanted.has(entry.key)) continue;
      const why = ignoreBlock(this.store.state, entry);
      if (why || !entry.screenId || !entry.frame?.fingerprint) { blocked.push(`${entry.frame?.name ?? entry.key}: ${why ?? ''}`); continue; }
      acknowledgeChange(this.store, entry.screenId, entry.frame.fingerprint, this.host.actor);
      done++;
    }
    this.store.reload();
    this.postState();
    this.postEntries();
    const parts = [done ? `${done}${COPY.controller060}` : '', blocked.length ? `${COPY.controller061} ${blocked.join('; ')}` : ''].filter(Boolean);
    this.host.post({ type: blocked.length ? 'error' : 'notice', message: parts.join(' ') });
  }

  private refreshEstimates(plan: Plan): void {
    this.store.reload();
    this.postEntries();
    if (plan.team !== 'UI' || !this.uiScans.length) return;
    // UI Publish: 확정 시점 지문이 기준이 된다.
    const scans = new Map(this.uiScans.map(scan => [scan.flipbookId, scan]));
    for (const item of plan.items) {
      const scan = scans.get(item.screenId);
      if (scan) scan.fingerprint = lastUi(this.store.state, item.screenId)?.fingerprint ?? scan.fingerprint;
    }
    this.postUiScans();
  }

  // ── 플립북 ─────────────────────────────────────────────

  private async createFlipbooks(request: FlipbookRequest): Promise<void> {
    const s = this.store;
    s.reload();
    if (!s.state.project.templateNodeId) throw new Error(COPY.controller053);
    // 템플릿에 문제가 있으면 시스템 영역을 채우다 멈춰 빈 플립북이 남으므로 만들지 않는다.
    const issues = await this.checkTemplate();
    if (issues.length) throw new Error(`${COPY.controller103} ${issues.join(' / ')}`);
    // 항목마다 페이지를 고를 수 있다(2026-10-21 사용자 요청). 모든 페이지가 설정에서 지정한 UI 페이지여야 한다.
    const moves = request.moves ?? [];
    const pageIds = [...new Set([...request.rows.map(row => row.pageId || request.pageId), ...moves.map(m => m.pageId)])];
    const usable = (pageId: string) => !!pageId && pageId !== s.state.project.dataPageId && s.state.project.flipbookPageIds.includes(pageId) && this.host.pages().some(p => p.id === pageId);
    if (!pageIds.length || pageIds.some(pageId => !usable(pageId))) throw new Error(COPY.controller063);
    // 새 행은 기록만 읽어 검사하므로 옮기기 전에 확인한다. 잘못된 행이 있으면 기존 플립북도 옮기지 않는다.
    const made = request.rows.length ? planFlipbooks(request, guiScreens(s.state), this.host.actor, s.now(), s.newId, pageId => pageSections(s.state, pageId)) : [];
    // 기존 플립북 옮기기(2026-10-22 사용자 요청)를 먼저 반영한다. 새 플립북의 자리(앞 항목)가 옮긴 플립북일 수 있다.
    const moved = moves.length ? await this.moveFlipbooks(moves) : [];
    if (!request.rows.length) {
      this.host.post({ type: 'flipbooksCreated', ids: [], moved, message: `${COPY.controller133} ${moved.length}${COPY.controller134}` });
      return;
    }
    // 다음 만들기의 기본 페이지로 남긴다.
    if (request.pageId && pageIds.includes(request.pageId) && s.state.project.flipbookPageId !== request.pageId) s.saveProject({ ...s.state.project, flipbookPageId: request.pageId });
    // 정한 자리: 기존 플립북 ID는 그대로, `row:N`은 같은 요청에서 먼저 만드는 N번째 행의 플립북이다.
    const after = new Map<string, string | null>();
    request.rows.forEach((row, i) => {
      if (row.after === undefined) return;
      const ref = row.after?.startsWith('row:') ? made[Number(row.after.slice(4))]?.id : row.after;
      if (ref !== undefined) after.set(made[i].id, ref);
    });
    const batchId = `create:${randomId()}`;
    for (const fb of made) {
      s.put(keys.flipbook(fb.id), fb);
      s.audit(this.host.actor, 'flipbook.create', fb.id, null, { kind: fb.kind, title: fb.title, screens: fb.screens.map(x => x.code) });
      addDelivery(s, batchId, 'flipbook', 'UI', fb.id, 0);
    }
    // 새 플립북은 아직 프레임이 없고 옮긴 플립북은 방금 기록을 맞췄으므로 캔버스를 다시 읽지 않는다.
    const report = await this.deliverFlipbooks({ batchId }, { targets: made.map(fb => fb.id), baseline: new Set(made.map(fb => fb.id)), create: new Set(made.map(fb => fb.id)), after, canvasFollowed: true });
    await this.refreshData();
    this.postState();
    // 새 플립북은 UI 목록에서 「비교 전」이다. 만든 직후 지문을 기준으로 저장했으므로 바로 차이 없음으로 보이게 한다.
    // 새 플립북이 들어가며 같은 Section의 기존 플립북 자리도 바뀌므로 위치는 모든 플립북에 다시 붙인다.
    const { found, spots } = await this.inspectFlipbooks();
    for (const fb of made) {
      const baseline = s.state.uiBaselines.get(fb.id);
      const scan: UiScan = { flipbookId: fb.id, nodeId: found.get(fb.id) ?? null, fingerprint: baseline?.fingerprint ?? null, error: null };
      const at = this.uiScans.findIndex(u => u.flipbookId === fb.id);
      if (at >= 0) this.uiScans[at] = scan; else this.uiScans.push(scan);
    }
    this.uiScans = this.uiScans.map(u => ({ ...u, spot: spotOf(spots, u.nodeId) }));
    this.postUiScans();
    const message = [`${COPY.controller054} ${made.length}${COPY.controller055}`, moved.length ? `${COPY.controller133} ${moved.length}${COPY.controller134}` : '', report.failed.length || report.notes.length || report.skipped ? deliveryMessage(report) : ''].filter(Boolean).join(' ');
    this.host.post({ type: 'flipbooksCreated', ids: made.map(fb => fb.id), moved, message });
  }

  // 목록에서 옮긴 기존 플립북을 기록과 캔버스에 반영하고 옮긴 플립북 ID를 돌려준다. 목록 순서대로 옮겨야 앞 항목이 이미 제자리에 있다.
  // Section이 바뀐 플립북은 Chapter도 새 Section 이름으로 맞춘다. 캔버스에서 프레임을 찾지 못한 플립북은 기록만 바꾸지 않고 건너뛴다.
  private async moveFlipbooks(moves: FlipbookMove[]): Promise<string[]> {
    const s = this.store;
    const fromPage = new Map(moves.map(m => { const fb = s.state.flipbooks.get(m.flipbookId); return [m.flipbookId, fb?.pageId ?? s.state.project.flipbookPageId ?? '']; }));
    const sections = new Map(moves.map(m => [m.flipbookId, s.state.flipbooks.get(m.flipbookId)?.category.key]));
    checkMoves(s.state, moves, s.state.project.flipbookPageIds);
    const done: FlipbookMove[] = [];
    // 중간에 실패해도 이미 옮긴 프레임은 기록에 남긴 뒤 오류를 낸다. 기록이 옛 자리로 남으면 다음 반영에서 프레임이 되돌아가고,
    // 다른 페이지로 옮긴 플립북은 옛 페이지에서 찾지 못해 연결이 끊긴 것으로 보인다.
    let failed = false, failure: unknown = null;
    for (const move of moves) {
      try {
        const ok = await this.host.moveFlipbook({ flipbookId: move.flipbookId, fromPageId: fromPage.get(move.flipbookId)!, pageId: move.pageId, category: move.section, after: move.after });
        if (ok) done.push(move);
      } catch (error) {
        failed = true; failure = error;
        break;
      }
    }
    const changed = moveFlipbooks(s, done, s.state.project.flipbookPageIds, this.host.actor);
    const retitled = changed.filter(fb => sections.get(fb.id) !== fb.category.key || fromPage.get(fb.id) !== fb.pageId).map(fb => fb.id);
    if (retitled.length) await this.deliverFlipbooks({}, { targets: retitled, canvasFollowed: true });
    if (done.length) {
      await this.refreshData();
      this.postState();
      const { found, spots } = await this.inspectFlipbooks();
      this.uiScans = this.uiScans.map(u => ({ ...u, nodeId: found.get(u.flipbookId) ?? u.nodeId, spot: spotOf(spots, found.get(u.flipbookId) ?? u.nodeId) }));
      this.postUiScans();
    }
    if (failed) throw failure;
    return done.map(m => m.flipbookId);
  }

  // 플립북 제목 변경(2026-10-21 사용자 요청): 기록을 바꾸고 큰 제목·Page title·프레임 이름을 새 제목으로 맞춘다.
  private async renameFlipbook(id: string, title: string): Promise<void> {
    const s = this.store;
    s.reload();
    const fb = renameFlipbook(s, id, title, this.host.actor);
    const report = await this.deliverFlipbooks({}, { targets: [id], retitle: new Set([id]) });
    await this.refreshData();
    this.postState();
    const failed = report.failed.length || report.skipped;
    this.host.post({ type: failed ? 'error' : 'notice', message: failed ? deliveryMessage(report) : `${COPY.controller119} ${fb.title}` });
  }

  // 화면 편집(2026-10-26 사용자 요청): 기록의 화면 목록을 바꾸고 GUI 영역·Screen ID·자동 제목을 다시 반영한다.
  // 프레임이 없는(연결이 끊긴) 플립북은 반영할 수 없으므로 기록도 바꾸지 않는다. 반영에 실패하면 미완료로 남아 재시도로 맞춘다.
  private async editFlipbookScreens(request: ScreenEditRequest): Promise<void> {
    const s = this.store;
    s.reload();
    const canvas = await this.inspectFlipbooks();
    if (s.state.flipbooks.get(request.flipbookId)?.status !== 'active') throw new Error(COPY.coreFlipbook002);
    if (!canvas.found.has(request.flipbookId)) throw new Error(COPY.figmaFlipbook027);
    const before = s.state.flipbooks.get(request.flipbookId)!;
    const fb = editFlipbookScreens(s, request, guiScreens(s.state), this.host.actor, s.now());
    let report = emptyReport();
    if (fb !== before) {
      const batchId = `screens:${randomId()}`;
      addDelivery(s, batchId, 'flipbook', 'UI', fb.id, s.state.uiStates.get(fb.id)?.version ?? 0);
      report = await this.deliverFlipbooks({ batchId }, { canvas });
      await this.refreshData();
    }
    this.postState();
    // 화면 수가 바뀌면 프레임 크기가 바뀌어 Section 안 배치가 달라질 수 있다.
    this.applyLinks(canvas.found, await this.spots());
    const failed = !!(report.failed.length || report.skipped);
    const latest = s.state.flipbooks.get(fb.id) ?? fb;
    const message = [`${COPY.controller138} ${latest.title}`, failed || report.notes.length ? deliveryMessage(report) : ''].filter(Boolean).join(' ');
    this.host.post({ type: 'flipbookScreensEdited', id: fb.id, failed, message });
  }

  // 확인 완료: 상태·코멘트를 기록한 뒤 그 플립북의 Status와 이력 행을 맞춘다.
  private async markReviewed(requests: ReviewRequest[]): Promise<void> {
    const s = this.store;
    s.reload();
    const batchId = `review:${randomId()}`;
    const ids = markReviewed(s, requests, this.host.actor, batchId);
    for (const id of ids) addDelivery(s, batchId, 'flipbook', 'UI', id, s.state.uiStates.get(id)?.version ?? 0);
    const report = ids.length ? await this.deliverFlipbooks({ batchId }) : emptyReport();
    if (ids.length) await this.refreshData();
    this.postState();
    const message = [`${ids.length}${COPY.controller064}`, report.failed.length || report.notes.length || report.skipped ? deliveryMessage(report) : ''].filter(Boolean).join(' ');
    this.host.post({ type: 'reviewed', ids, message });
  }

  // 반영이 끝나지 않은 플립북을 현재 기록으로 맞춘다. 플립북 단위로 실패를 기록하고 나머지는 계속한다.
  // baseline: 새로 만든 플립북. 만든 직후의 UI 작성 영역을 첫 UI Publish 전 비교 기준으로 저장한다.
  // after: 새로 만들 플립북을 Section 안에 놓을 자리. retitle: 플러그인에서 제목을 바꾼 플립북.
  async deliverFlipbooks(filter: { batchId?: string } = {}, options: { force?: boolean; targets?: string[]; baseline?: Set<string>; create?: Set<string>; after?: Map<string, string | null>; retitle?: Set<string>; canvasFollowed?: boolean; canvas?: { found: Map<string, string>; spots: Record<string, FlipbookSpot> } } = {}): Promise<DeliveryReport> {
    const s = this.store;
    s.reload();
    const active = (id: string) => s.state.flipbooks.get(id)?.status === 'active';
    const requested = [...(options.targets ?? []), ...unfinishedDeliveries(s.state, { ...filter, kind: 'flipbook' }).map(d => d.targetId)].filter(active);
    const report = emptyReport();
    if (!requested.length) return report;
    // 플립북을 기록의 페이지에서 찾으므로 캔버스에서 옮긴 플립북의 기록부터 맞춘다. 맞춘 플립북은 Chapter도 다시 반영한다.
    // canvasFollowed: 부른 쪽이 방금 기록을 캔버스와 맞췄다(목록에서 옮기기·새 플립북·Section 따라가기). canvas: 이미 읽은 캔버스.
    // 읽지 못하면 기록대로 반영한다(2026-10-23 사용자 승인).
    const followed = options.canvasFollowed ? [] : await this.followCanvas(options.canvas).catch(() => []);
    const targets = [...new Set([...requested, ...followed])].filter(active);
    const { templateNodeId } = s.state.project;
    if (!templateNodeId) return { ...report, skipped: `${COPY.controller027} ${targets.length}${COPY.controller028}` };
    // 템플릿에 문제가 있으면 반영하지 않고 대기로 둔다. 템플릿을 고친 뒤 다시 시도하면 반영된다.
    const issues = await this.checkTemplate();
    if (issues.length) return { ...report, skipped: `${COPY.controller027} ${targets.length}${COPY.controller033} ${COPY.controller103} ${issues.join(' / ')}` };
    report.screens = targets.length;
    const byFlipbook = groupBy(unfinishedDeliveries(s.state, { kind: 'flipbook' }), d => d.targetId);
    this.host.beginDelivery?.();
    try {
      for (const [i, flipbookId] of targets.entries()) {
        await this.progress(`${COPY.controller029} ${i + 1}/${targets.length}`);
        const pending = byFlipbook.get(flipbookId) ?? [];
        for (const d of pending) setDeliveryState(s, d.batchId, d.targetId, 'applying');
        const fb = s.state.flipbooks.get(flipbookId)!;
        try {
          const view = flipbookView(s.state, flipbookId);
          if (!view.pageId) throw new Error(COPY.controller063);
          if (options.after?.has(flipbookId)) view.after = options.after.get(flipbookId);
          if (options.retitle?.has(flipbookId)) view.retitle = true;
          if (options.create?.has(flipbookId)) view.create = true;
          const result = await this.host.syncFlipbook({ pageId: view.pageId, templateId: templateNodeId, force: options.force }, view);
          for (const d of pending) setDeliveryState(s, d.batchId, d.targetId, 'done');
          // 반영한 1x 화면 크기를 남긴다.
          const latest = s.state.flipbooks.get(flipbookId);
          if (latest && latest.guiWidth !== view.guiWidth) s.put(keys.flipbook(flipbookId), { ...latest, rev: latest.rev + 1, guiWidth: view.guiWidth });
          if (options.baseline?.has(flipbookId) && !lastUi(s.state, flipbookId)?.fingerprint && !s.state.uiBaselines.has(flipbookId)) {
            const ui = await this.host.uiFingerprint(result.nodeId);
            if (ui.fingerprint) {
              s.put(keys.uiBaseline(flipbookId), {
                flipbookId, fingerprint: ui.fingerprint, fpVersion: UI_FINGERPRINT_VERSION, nodeId: result.nodeId, createdAt: s.now(),
              } satisfies UiBaseline);
            }
          }
          report.done++;
          report.notes.push(...result.notes.map(n => `${fb.title}: ${n}`));
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          for (const d of pending) setDeliveryState(s, d.batchId, d.targetId, 'failed', message);
          report.failed.push(`${fb.title}: ${message}`);
        }
      }
    } finally { this.host.endDelivery?.(); }
    return report;
  }

  // ── 관리 ──────────────────────────────────────────────

  // 파일 내부 기록·설정과 노드의 연결 표식을 모두 지운다. 캔버스의 페이지·프레임은 지우지 않는다.
  // Figma 버전 기록으로 되돌릴 수 있다.
  private async resetData(): Promise<void> {
    this.scanSeq++;
    this.uiScanSeq++;
    const markers = await this.host.clearMarkers();
    const keys = this.store.kv.keys();
    for (const key of keys) this.store.kv.set(key, '');
    this.frames = [];
    this.framesLoaded = false;
    this.checkedAt = null;
    this.partialAt = null;
    this.uiScans = [];
    this.uiCheckedAt = null;
    this.uiPartialAt = null;
    this.plans.clear();
    this.version = null;
    this.store.reload();
    // 처음 실행과 같은 상태로 다시 보낸다. 플러그인 창은 입력 초안·선택을 비운다.
    this.host.post({ type: 'init', mode: this.host.mode, state: toUiWire(this.store.state), actor: this.host.actor, pages: this.host.pages(), issues: [] });
    this.postEntries();
    this.host.post({ type: 'notice', message: `${COPY.controller024} ${keys.length}${COPY.controller025} ${markers}${COPY.controller026}` });
  }

  // 저장된 DATA 페이지를 다시 연결하거나 만든다. 연결이 바뀌면 프로젝트 설정에 남긴다.
  private async ensureDataPage(): Promise<string> {
    const project = this.store.readFresh<ProjectConfig>(keys.project) ?? this.store.state.project;
    const pageId = await this.host.ensureDataPage(project.dataPageId ?? null);
    if (pageId !== project.dataPageId) {
      this.store.saveProject({ ...this.store.state.project, ...project, dataPageId: pageId });
      this.store.audit(this.host.actor, 'project.dataPage', 'project', project.dataPageId ?? null, pageId);
    }
    return pageId;
  }

  // 최신 원기록을 다시 읽어 DATA 페이지를 그린다. 업무 기록·버전은 만들지 않는다.
  // reload: 호출하기 직전에 원기록을 이미 다시 읽었으면 false로 넘겨 한 번 더 읽지 않는다.
  async refreshData(rebuild = false, reload = true): Promise<boolean> {
    const s = this.store;
    if (reload) s.reload();
    const before = s.state.dataStatus;
    const base = { actor: this.host.actor, renderedAt: before?.renderedAt ?? null };
    let pageId: string | null = s.state.project.dataPageId;
    try {
      pageId = await this.ensureDataPage();
      await this.host.renderData(pageId, dataModel(s.state, this.host.actor, s.now()), rebuild);
      s.put(keys.dataStatus, { ...base, pageId, renderedAt: s.now(), failedAt: null, error: null } satisfies DataStatus);
      return true;
    } catch (e) {
      s.put(keys.dataStatus, { ...base, pageId, failedAt: s.now(), error: e instanceof Error ? e.message : String(e) } satisfies DataStatus);
      return false;
    }
  }

  // 썸네일 이름과 그 화면을 쓰는 플립북의 Screen ID를 갱신한다. 원본 프레임 이름은 바꾸지 않는다(2026-10-21 사용자 결정).
  private async applyCodeRenames(renames: CodeRename[]): Promise<void> {
    // 썸네일 페이지의 화면별 썸네일 이름도 현재 Screen ID로 맞춘다. 썸네일은 배포마다 덮어쓰는 현재 화면이다.
    const labels = new Map(renames.map(r => [r.screenId, formatFrameName(r.to, this.store.state.screens.get(r.screenId)?.name ?? '')]));
    const thumbsFailed = await this.host.renameThumbnails(labels).then(() => false, () => true);
    const pulled = await this.pullGui();
    const message = [
      `${renames.length}${COPY.controller101}`,
      thumbsFailed ? COPY.controller105 : '',
      pulled?.message ?? '',
    ].filter(Boolean).join(' ');
    this.host.post({ type: thumbsFailed || pulled?.failed ? 'error' : 'notice', message });
  }

  private async admin(action: AdminOp): Promise<void> {
    const s = this.store, a = this.host.actor;
    let renames: CodeRename[] = [];
    switch (action.op) {
      case 'addCategory': addCategory(s, action.name, a); break;
      case 'renameCategory': renameCategory(s, action.id, action.name, a); break;
      case 'setCategoryActive': setCategoryActive(s, action.id, action.active, a); break;
      case 'setCategoryCode': renames = setCategoryCode(s, action.id, action.code, a); break;
      case 'setScreenIdPrefix': renames = setScreenIdPrefix(s, action.prefix, a); break;
      case 'renumberScreenIds': {
        s.reload();
        const sources = [...s.state.screens.values()].filter(x => x.status === 'active' && x.source).map(x => [x.id, x.source!.nodeId] as const);
        const found = await this.host.canvasPositions(sources.map(([, nodeId]) => nodeId));
        const positions = new Map(sources.filter(([, nodeId]) => found.has(nodeId)).map(([id, nodeId]) => [id, found.get(nodeId)!]));
        renames = renumberScreenIds(s, positions, a);
        if (!renames.length) this.host.post({ type: 'notice', message: COPY.controller104 });
        break;
      }
      case 'addWorker': addWorker(s, action.name, action.alias, a); break;
      case 'renameWorker': renameWorker(s, action.id, action.name, action.alias, a); break;
      case 'setWorkerActive': setWorkerActive(s, action.id, action.active, a); break;
      case 'addTag': addTag(s, action.team, action.name, action.colorKey, a); break;
      case 'updateTag': updateTag(s, action.id, action, a); break;
      case 'exclude': addExclusion(s, action.nodeId, action.name, action.reason, a); break;
      case 'unexclude': removeExclusion(s, action.id, a); break;
      case 'setCaseRelation': setCaseRelation(s, action.screenId, action.baseId, a, action.reason); break;
      case 'setScreenCategory': setScreenCategory(s, action.screenId, action.categoryId, a, action.reason); break;
      case 'correctRecord': correctRecord(s, action.team, action.screenId, action.version, action.description, action.reason, a); break;
      case 'setScope': {
        const before = s.state.project;
        s.saveProject({ ...before, scopePageIds: action.pageIds });
        s.audit(a, 'project.scope', 'project', before.scopePageIds, action.pageIds);
        break;
      }
      case 'setFlipbookPage': {
        const before = s.state.project;
        s.saveProject({ ...before, flipbookPageIds: [action.pageId], flipbookPageId: action.pageId });
        s.audit(a, 'project.flipbookPage', 'project', before.flipbookPageId, action.pageId);
        break;
      }
      case 'setFlipbookPages': {
        const before = s.state.project;
        const valid = new Set(this.host.pages().filter(p => p.id !== before.dataPageId).map(p => p.id));
        if (action.pageIds.some(id => !valid.has(id))) throw new Error(COPY.controller063);
        const pageIds = [...new Set(action.pageIds)];
        const flipbookPageId = before.flipbookPageId && pageIds.includes(before.flipbookPageId) ? before.flipbookPageId : pageIds[0] ?? null;
        s.saveProject({ ...before, flipbookPageIds: pageIds, flipbookPageId });
        s.audit(a, 'project.flipbookPages', 'project', before.flipbookPageIds, pageIds);
        break;
      }
      case 'setTemplateFromSelection': {
        const template = await this.host.templateFromSelection();
        const before = s.state.project;
        s.saveProject({ ...before, templateNodeId: template.id, templateName: template.name });
        s.audit(a, 'project.template', 'project', before.templateNodeId, template.id);
        await this.checkTemplate();
        break;
      }
      case 'setGuiWidth': {
        if (!validGuiWidth(action.width)) throw new Error(COPY.controller067);
        const before = s.state.project;
        s.saveProject({ ...before, guiWidth: action.width });
        s.audit(a, 'project.guiWidth', 'project', before.guiWidth, action.width);
        break;
      }
      // 기존 페이지를 DATA 페이지로 연결한다. 그 페이지에 표시를 새로 그리며 기존 내용은 지우지 않는다.
      case 'setDataPage': {
        const before = s.state.project;
        const flipbookPageIds = before.flipbookPageIds.filter(id => id !== action.pageId);
        const flipbookPageId = before.flipbookPageId && flipbookPageIds.includes(before.flipbookPageId) ? before.flipbookPageId : flipbookPageIds[0] ?? null;
        s.saveProject({ ...before, dataPageId: action.pageId, flipbookPageIds, flipbookPageId });
        s.audit(a, 'project.dataPage', 'project', before.dataPageId, action.pageId, action.reason);
        break;
      }
    }
    // Prefix·카테고리 코드로 Screen ID가 바뀐 화면은 원본 프레임 이름과 플립북도 바로 맞춘다(2026-10-20 사용자 결정).
    if (renames.length) await this.applyCodeRenames(renames);
    // 정정한 UI 설명은 그 플립북 이력에도 반영한다.
    if (action.op === 'correctRecord' && action.team === 'UI' && await this.findFlipbook(action.screenId)) {
      const report = await this.deliverFlipbooks({}, { targets: [action.screenId] });
      if (report.failed.length) this.host.post({ type: 'error', message: deliveryMessage(report) });
    }
    // 정정한 GUI 설명은 그 화면을 쓰는 플립북의 쌓은 기록에도 반영한다.
    if (action.op === 'correctRecord' && action.team === 'GUI') {
      const pulled = await this.pullGui();
      if (pulled?.failed) this.host.post({ type: 'error', message: pulled.message });
    }
    // 현재 분류·관계·설명이 바뀌는 조작은 DATA 페이지가 있을 때 표시를 다시 그린다.
    if (DATA_OPS.has(action.op) && s.state.project.dataPageId) await this.refreshData();
    this.postState();
    // 범위가 바뀌면 읽은 원본 목록이 맞지 않으므로 확인 전으로 돌린다. 그 밖에는 이미 읽은 결과로 다시 분류한다.
    if (action.op === 'setScope') {
      // 비교한 새 버전 페이지가 범위에 들어갔을 수 있으므로 비교 결과도 버린다.
      this.version = null;
      this.host.post({ type: 'versionMatch', match: null });
      this.scanSeq++;
      this.frames = [];
      this.framesLoaded = false;
      this.checkedAt = null;
      this.partialAt = null;
      this.scanStatus('GUI', 'idle');
    }
    // 플립북 페이지가 바뀌면 UI 비교 결과도 맞지 않으므로 확인 전으로 돌린다.
    if (action.op === 'setFlipbookPage' || action.op === 'setFlipbookPages') {
      this.uiScanSeq++;
      this.uiCheckedAt = null;
      this.uiPartialAt = null;
      this.scanStatus('UI', 'idle');
    }
    this.postEntries();
  }
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k) ?? [];
    bucket.push(item);
    out.set(k, bucket);
  }
  return out;
}

export function deliveryMessage(r: DeliveryReport): string {
  if (r.skipped) return r.skipped;
  if (!r.screens) return '';
  const parts = [`${COPY.controller030} ${r.done}${COPY.controller031}`];
  if (r.failed.length) parts.push(`${COPY.controller032} ${r.failed.length}${COPY.controller033} ${r.failed.join('; ')}`);
  if (r.notes.length) parts.push(`${COPY.controller034} ${r.notes.join('; ')}`);
  return parts.join(' ');
}
