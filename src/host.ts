import type { FlipbookSpot, ScannedFrame } from './core/compare.ts';
import type { DataModel } from './core/data.ts';
import type { FlipbookView } from './core/flipbook.ts';
import type { CanvasPosition } from './core/screenCode.ts';
import type { KV } from './core/store.ts';
import type { FlowPlan, FlowThumb } from './core/flow.ts';
import type { Actor, FlowRecord, GuiThumb, Team } from './core/types.ts';
import type { SelectionTarget, SelectionWrite } from './core/description.ts';
import type { RichParagraph } from './core/richText.ts';
import type { PdfPage, PdfSelection } from './core/pdf.ts';
import type { PageInfo, ToUi } from './core/wire.ts';

// Controller가 사용하는 환경 경계. Figma 호스트와 브라우저 미리보기가 각각 구현한다.
export interface FingerprintReader {
  fingerprint(nodeId: string, includeLegacy?: boolean): Promise<{ fingerprint: string | null; legacyFingerprint?: string | null; error: string | null }>;
  screenFeatures(nodeId: string, includeLegacy?: boolean): Promise<{ fingerprint: string | null; legacyFingerprint?: string | null; tokens: string[] | null; name?: string; error: string | null }>;
  uiFingerprint(nodeId: string): Promise<{ fingerprint: string | null; error: string | null }>;
}

export interface Host extends FingerprintReader {
  kv: KV;
  actor: Actor;
  mode: Team;
  post(message: ToUi): void;
  resize(width: number, height: number, save?: boolean, compact?: boolean): void;
  pages(): PageInfo[];
  listFrames(pageIds: string[], sectionIds: string[], isCurrent?: () => boolean): Promise<ScannedFrame[]>;
  selectNodes(nodeIds: string[], lastNodeId: string, isLatest: () => boolean): Promise<void>;
  selectionNodeIds(): { nodeId: string; flipbookId: string | null }[] | null;
  createFingerprintReader?(): FingerprintReader;
  makeThumbnail(nodeId: string, label: string): Promise<GuiThumb>;
  placeThumbnails?(updates: { screenId: string; label: string; thumb: GuiThumb }[]): Promise<void>;
  framePreview(nodeId: string): Promise<Uint8Array | null>;
  thumbnailBytes(hash: string): Promise<Uint8Array | null>;
  renameThumbnails(labels: Map<string, string>): Promise<void>;
  canvasPositions(nodeIds: string[]): Promise<Map<string, CanvasPosition>>;
  ensureDataPage(pageId: string | null): Promise<string>;
  clearMarkers(): Promise<number>;
  renderData(pageId: string, model: DataModel, rebuild?: boolean): Promise<void>;
  // expectedScreenId가 있으면 아직 그 화면의 표식일 때만 바꾼다(배포 취소 재시도 중 새 표식을 지우지 않기 위해).
  tagSource(nodeId: string, screenId: string, expectedScreenId?: string): Promise<void>;
  findFlipbook(pageId: string, flipbookId: string): Promise<string | null>;
  listFlipbooks(pageIds: string[]): Promise<Map<string, string>>;
  inspectFlipbooks?(pageIds: string[], originalsOnly?: boolean): Promise<{ found: Map<string, string>; spots: Record<string, FlipbookSpot> }>;
  flipbookSpots?(pageIds: string[]): Promise<Record<string, FlipbookSpot>>;
  templateFromSelection(): Promise<{ id: string; name: string }>;
  templateIssues?(templateId: string | null): Promise<string[]>;
  syncFlipbook(settings: { pageId: string; templateId: string; force?: boolean }, view: FlipbookView): Promise<{ nodeId: string; notes: string[] }>;
  // 플립북의 Chapter만 Section 이름으로 다시 쓴다. 찾지 못한 플립북은 건너뛴다.
  syncChapters?(items: { pageId: string; flipbookId: string; name: string }[]): Promise<void>;
  // 기존 플립북 프레임을 다른 페이지·Section의 정한 자리로 옮긴다. 프레임을 찾지 못하면 false.
  moveFlipbook(move: { flipbookId: string; fromPageId: string; pageId: string; category: { key: string; name: string }; after: string | null }): Promise<boolean>;
  // known: 같은 작업에서 이미 찾은 플립북 프레임(플립북 ID → 노드 ID). 반영할 때 페이지를 다시 훑지 않고 이 노드부터 확인한다.
  beginDelivery?(known?: Map<string, string>): void;
  endDelivery?(): void;
  reveal(nodeId: string, isLatest: () => boolean): Promise<boolean>;
  // 텍스트 편집: Description을 고르면 본문 슬롯의 텍스트 전체를 읽고 쓰며, 아니면 고른 텍스트 레이어 하나를 읽고 쓴다.
  readSelection(): RichParagraph[];
  // 지금 선택에서 불러오기·적용할 대상(플립북의 Description, 텍스트 레이어 하나, 없음, 오류)
  selectionTarget?(): SelectionTarget;
  writeSelection(paragraphs: RichParagraph[]): Promise<SelectionWrite>;
  // 플로우: 지금 보고 있는 페이지에 그룹을 만든다. notes: 썸네일을 찾지 못한 화면 등 알릴 내용
  createFlow?(plan: FlowPlan): Promise<{ nodeId: string; pageId: string; notes: string[] }>;
  // 다시 배포된 화면의 썸네일만 바꾼다. 플로우 그룹을 찾지 못하면 null
  updateFlow?(flow: FlowRecord, thumbs: FlowThumb[]): Promise<number | null>;
  // 플로우 그룹(uid가 있으면 그 화면 칸, 없으면 그룹)의 노드 ID. 그룹을 찾지 못하면 null
  flowNode?(flow: FlowRecord, uid?: string): Promise<string | null>;
  // PDF 저장: 보고 있는 페이지의 선택에서 저장할 프레임 수
  pdfSelection?(): PdfSelection;
  // 고른 프레임을 캔버스 순서대로 내보낸 쪽. pageName: 보고 있는 페이지 이름(파일 이름에 쓴다).
  // progress가 false를 돌려주면(취소) 다음 프레임으로 가지 않고 pages가 null이다.
  exportPdf?(progress: (done: number, total: number) => Promise<boolean>): Promise<{ pageName: string; pages: PdfPage[] | null }>;
}
