import type { FlipbookSpot, ScannedFrame } from './core/compare.ts';
import type { DataModel } from './core/data.ts';
import type { FlipbookView } from './core/flipbook.ts';
import type { CanvasPosition } from './core/screenCode.ts';
import type { KV } from './core/store.ts';
import type { Actor, GuiThumb, Team } from './core/types.ts';
import type { SelectionTarget, SelectionWrite } from './core/description.ts';
import type { RichParagraph } from './core/richText.ts';
import type { PageInfo, ToUi } from './core/wire.ts';

// Controller가 사용하는 환경 경계. Figma 호스트와 브라우저 미리보기가 각각 구현한다.
export interface FingerprintReader {
  fingerprint(nodeId: string, includeLegacy?: boolean): Promise<{ fingerprint: string | null; legacyFingerprint?: string | null; error: string | null }>;
  screenFeatures(nodeId: string, includeLegacy?: boolean): Promise<{ fingerprint: string | null; legacyFingerprint?: string | null; tokens: string[] | null; name?: string; error: string | null }>;
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
  tagSource(nodeId: string, screenId: string): Promise<void>;
  findFlipbook(pageId: string, flipbookId: string): Promise<string | null>;
  listFlipbooks(pageIds: string[]): Promise<Map<string, string>>;
  inspectFlipbooks?(pageIds: string[]): Promise<{ found: Map<string, string>; spots: Record<string, FlipbookSpot> }>;
  flipbookSpots?(pageIds: string[]): Promise<Record<string, FlipbookSpot>>;
  uiFingerprint(nodeId: string): Promise<{ fingerprint: string | null; error: string | null }>;
  templateFromSelection(): Promise<{ id: string; name: string }>;
  templateIssues?(templateId: string | null): Promise<string[]>;
  syncFlipbook(settings: { pageId: string; templateId: string; force?: boolean }, view: FlipbookView): Promise<{ nodeId: string; notes: string[] }>;
  // 기존 플립북 프레임을 다른 페이지·Section의 정한 자리로 옮긴다. 프레임을 찾지 못하면 false.
  moveFlipbook(move: { flipbookId: string; fromPageId: string; pageId: string; category: { key: string; name: string }; after: string | null }): Promise<boolean>;
  beginDelivery?(): void;
  endDelivery?(): void;
  reveal(nodeId: string, isLatest: () => boolean): Promise<boolean>;
  // 텍스트 편집: Description을 고르면 본문 슬롯의 텍스트 전체를 읽고 쓰며, 아니면 고른 텍스트 레이어 하나를 읽고 쓴다.
  readSelection(): RichParagraph[];
  // 지금 선택에서 불러오기·적용할 대상(플립북의 Description, 텍스트 레이어 하나, 없음, 오류)
  selectionTarget?(): SelectionTarget;
  writeSelection(paragraphs: RichParagraph[]): Promise<SelectionWrite>;
}
