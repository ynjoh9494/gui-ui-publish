import { findTemplateMigrations, migrateFlipbookTemplate } from './templateMigration.ts';
import { selectedFlowRepairImages, flowRepairCells, restoreFlowImage } from './flowRepair.ts';
import { thumbPage } from './thumbs.ts';
import { managedPages, normalizeManagedPageNames } from './managedPages.ts';
import { COPY } from '../core/copy.ts';
import type { ScannedFrame } from '../core/compare.ts';
import { canvasOrder } from '../core/screenCode.ts';
import { randomId, type KV } from '../core/store.ts';
import { beginHistoryWindow, HISTORY_DOCUMENT_ID } from '../core/historyNotices.ts';
import { readHistoryNotices } from './historyNotices.ts';
import { COLLAPSED_WINDOW, clampWindow } from '../core/wire.ts';
import type { Host } from '../host.ts';
import { createFingerprintReader } from './fingerprints.ts';
import { selectedFlipbooks, markExistingFlipbooks } from './registerFlipbooks.ts';
import { FLIPBOOK_KEY, NS, prepareFlipbookTitle, findFlipbook, flipbookSpots, inspectFlipbooks, listFlipbooks, loadPages, moveFlipbookFrame, syncChapters, syncFlipbook, templateFromSelection, templateIssues, flipbookSession, type FlipbookSession } from './flipbook.ts';
import { addTextFrame, fillDescription, flipbookDescriptionRoot, readDescription, readDescriptionLayout, readTextNodeLayout, selectedDescriptionRoot, selectedFrame, selectionTarget } from './description.ts';
import { createFlow, createdFlowCells, scanFlowCells, updateFlowCells } from './flow.ts';
import { SCREEN_KEY } from './layers.ts';
import { exportPdfPages, pdfSelection } from './pdf.ts';
import { readRichText, selectedTextNode, writeRichText } from './richText.ts';
import { connectTemplateItem, describeTemplate, disconnectTemplateItem, markedPart, templateItemNodes } from './template.ts';
import { convertLegacyFlipbooks } from './legacyConvert.ts';
import { createDefaultTemplate } from './templateDefault.ts';
import { createdCopies, markTracked, nodePlaces, pasteCopy, retagCopies, scanCopies, updateCopies } from './tracked.ts';
import { makeThumbnail, placeThumbnails, renameThumbnails, thumbnailBytes } from './thumbs.ts';

// 사용자별 플러그인 창 크기(figma.clientStorage)
export const WINDOW_KEY = 'windowSize';
// 새 버전 페이지 비교 미리보기 폭(px). 확대 미리보기(240px)를 고해상도 화면에서도 선명하게 보이는 크기
const PREVIEW_WIDTH = 480;

const SCREEN_TYPES = new Set(['FRAME', 'COMPONENT', 'INSTANCE']);

function pageOf(node: BaseNode): PageNode | null {
  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE') current = current.parent;
  return current as PageNode | null;
}

// 화면 루트 규칙: 페이지 또는 중첩 Section 바로 아래의 프레임. 프레임 내부의 버튼·아이콘은 후보로 보지 않는다.
export function* screenRoots(page: PageNode, sectionIds: Set<string>): Generator<SceneNode> {
  function* walk(children: readonly SceneNode[], inScope: boolean): Generator<SceneNode> {
    for (const child of children) {
      if (child.type === 'SECTION') {
        yield* walk(child.children, inScope || sectionIds.has(child.id));
      } else if (inScope && SCREEN_TYPES.has(child.type)) {
        yield child;
      }
    }
  }
  yield* walk(page.children, sectionIds.size === 0);
}

export function figmaHost(mode: Host['mode']): Host {
  const root = figma.root;
  const kv: KV = {
    get: key => root.getSharedPluginData(NS, key),
    set: (key, value) => root.setSharedPluginData(NS, key, value),
    keys: () => root.getSharedPluginDataKeys(NS),
  };
  let deliverySession: FlipbookSession | undefined;
  const user = figma.currentUser;
  let documentId: string | null = null;
  try { const value = JSON.parse(root.getSharedPluginData(NS, HISTORY_DOCUMENT_ID)); if (typeof value === 'string') documentId = value; } catch { /* 처음 사용하는 파일 */ }
  if (!documentId) { documentId = randomId(); root.setSharedPluginData(NS, HISTORY_DOCUMENT_ID, JSON.stringify(documentId)); }
  const historyWindow = beginHistoryWindow(figma.clientStorage, `historyLaunch:${user?.id ?? 'unknown'}:${documentId}`, Date.now());
  let programmedSelection: string[] | null = null;
  let programmedUntil = 0;

  async function sceneNode(nodeId: string): Promise<SceneNode | null> {
    const node = await figma.getNodeByIdAsync(nodeId);
    return node && 'visible' in node ? node as SceneNode : null;
  }

  return {
    kv,
    get mode() { return mode; },
    set mode(value) { mode = value; },
    actor: { id: user?.id ?? 'unknown', name: user?.name ?? COPY.figmaHost004 },
    post: message => figma.ui.postMessage(message),
    historyWindow: () => historyWindow,
    historyNotices: readHistoryNotices,
    resize(width, height, save, collapsed) {
      const size = collapsed ? COLLAPSED_WINDOW : clampWindow(mode, width, height);
      figma.ui.resize(size.width, size.height);
      if (save && !collapsed) void figma.clientStorage.setAsync(WINDOW_KEY, size);
    },
    // 실제 작업 페이지가 아닌 Figma 디바이더와 자동 관리 썸네일 페이지는 선택지에서 뺀다.
    managedPages: () => managedPages(NS),
    normalizeManagedPageNames: () => normalizeManagedPageNames(NS),
    ensureThumbnailPage: async () => (await thumbPage(NS)).id,
    pages: () => root.children.filter(p => !p.isPageDivider && p.getSharedPluginData(NS, 'role') !== 'thumbs').map(p => ({ id: p.id, name: p.name, ...(p === figma.currentPage ? { current: true } : {}) })),

    async listFrames(pageIds, sectionIds, isCurrent = () => true) {
      const sections = new Set(sectionIds);
      const frames: ScannedFrame[] = [];
      const pageOrder = new Map(root.children.map((page, index) => [page.id, index]));
      const pages = await loadPages([...pageIds].sort((a, b) => (pageOrder.get(a) ?? Infinity) - (pageOrder.get(b) ?? Infinity)));
      for (const page of pages) {
        if (!isCurrent()) return frames;
        const roots = [...screenRoots(page, sections)];
        const placed = roots.filter(node => !!node.absoluteBoundingBox);
        const unplaced = roots.filter(node => !node.absoluteBoundingBox);
        for (const node of [...canvasOrder(placed, item => {
          const box = item.absoluteBoundingBox!;
          return { page: 0, x: box.x, y: box.y, height: box.height };
        }), ...unplaced]) {
          if (!isCurrent()) return frames;
          frames.push({
            nodeId: node.id, pageId: page.id, name: node.name, width: node.width, height: node.height,
            screenTag: node.getSharedPluginData(NS, SCREEN_KEY) || null, fingerprint: null, error: null,
          });
          if (frames.length % 100 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      return frames;
    },

    async selectNodes(nodeIds, lastNodeId, isLatest) {
      const last = await sceneNode(lastNodeId);
      if (!last || !isLatest()) return;
      const page = pageOf(last);
      if (!page) return;
      const intended = nodeIds;
      programmedSelection = intended;
      programmedUntil = Date.now() + 2000;
      if (figma.currentPage !== page) await figma.setCurrentPageAsync(page);
      if (!isLatest()) { if (programmedSelection === intended) programmedSelection = null; return; }
      const nodes = (await Promise.all(nodeIds.map(sceneNode))).filter((node): node is SceneNode => !!node && pageOf(node) === page);
      if (!isLatest()) { if (programmedSelection === intended) programmedSelection = null; return; }
      const visible = nodes.length ? nodes : [last];
      programmedSelection = visible.map(node => node.id);
      figma.currentPage.selection = visible;
    },
    selectionNodeIds() {
      const ids = figma.currentPage.selection.map(node => node.id);
      if (programmedSelection && Date.now() <= programmedUntil &&
          (!ids.length || ids.length === programmedSelection.length && ids.every(id => programmedSelection!.includes(id)))) return null;
      programmedSelection = null;
      const pageId = figma.currentPage.id;
      // screenRoots와 같은 규칙: 위로 Section만 있는 프레임·컴포넌트·인스턴스
      const screenRoot = (node: SceneNode) => {
        if (!SCREEN_TYPES.has(node.type)) return false;
        for (let p = node.parent; p && p.type !== 'PAGE'; p = p.parent) if (p.type !== 'SECTION') return false;
        return true;
      };
      // 플립북 프레임 안의 레이어를 골라도 그 플립북으로 본다(2026-11-04 사용자 요청: 목록 선택이 따라가게). 가장 가까운 플립북 프레임을 쓴다.
      const flipbookOf = (node: SceneNode): { id: string; nodeId: string } | null => {
        for (let n: BaseNode | null = node; n && n.type !== 'PAGE' && n.type !== 'DOCUMENT'; n = n.parent) {
          const id = 'getSharedPluginData' in n ? n.getSharedPluginData(NS, FLIPBOOK_KEY) : '';
          if (id) return { id, nodeId: n.id };
        }
        return null;
      };
      return figma.currentPage.selection.map(node => {
        const flipbook = flipbookOf(node);
        return { nodeId: node.id, flipbookId: flipbook?.id ?? null, flipbookNodeId: flipbook?.nodeId, screenRoot: screenRoot(node), pageId };
      });
    },

    createFingerprintReader: () => createFingerprintReader(sceneNode),
    fingerprint: (nodeId, includeLegacy, digest, withTokens) => createFingerprintReader(sceneNode).fingerprint(nodeId, includeLegacy, digest, withTokens),
    screenFeatures: (nodeId, includeLegacy) => createFingerprintReader(sceneNode).screenFeatures(nodeId, includeLegacy),

    // 제자리에서 내보내므로 페이지·Section에서 물려받은 변수 모드도 캔버스와 같게 보인다.
    async framePreview(nodeId) {
      const node = await sceneNode(nodeId);
      if (!node) return null;
      await pageOf(node)?.loadAsync();
      return node.exportAsync({ format: 'PNG', constraint: { type: 'WIDTH', value: PREVIEW_WIDTH } });
    },

    async makeThumbnail(nodeId, label) {
      const node = await sceneNode(nodeId);
      if (!node) throw new Error(COPY.figmaHost005);
      return makeThumbnail(node, label);
    },
    placeThumbnails: updates => placeThumbnails(NS, updates),
    thumbnailBytes: hash => thumbnailBytes(NS, hash),
    renameThumbnails: labels => renameThumbnails(NS, labels),
    // 페이지 순서와 절대 위치. 찾지 못했거나 위치가 없는 프레임은 빠진다.
    async canvasPositions(nodeIds) {
      const pageIndex = new Map(figma.root.children.map((p, i) => [p.id, i]));
      const out = new Map<string, { page: number; x: number; y: number; height: number }>();
      const nodes = await Promise.all(nodeIds.map(sceneNode));
      for (const [i, nodeId] of nodeIds.entries()) {
        const node = nodes[i];
        const box = node?.absoluteBoundingBox;
        let page: BaseNode | null = node;
        while (page && page.type !== 'PAGE') page = page.parent;
        if (node && box && page) out.set(nodeId, { page: pageIndex.get(page.id) ?? 0, x: box.x, y: box.y, height: box.height });
      }
      return out;
    },


    // 모든 페이지를 읽어 이 플러그인의 표식을 지운다. 노드 자체는 남긴다.
    async clearMarkers() {
      let count = 0;
      const clear = (node: BaseNode) => {
        for (const key of node.getSharedPluginDataKeys(NS)) {
          try { node.setSharedPluginData(NS, key, ''); count++; } catch { /* 지울 수 없는 노드는 건너뛴다 */ }
        }
      };
      for (const page of root.children) {
        await page.loadAsync();
        clear(page);
        for (const node of page.findAllWithCriteria({ sharedPluginData: { namespace: NS } })) clear(node);
      }
      return count;
    },

    async tagSource(nodeId, screenId, expectedScreenId) {
      const node = await sceneNode(nodeId);
      if (expectedScreenId && node?.getSharedPluginData(NS, SCREEN_KEY) !== expectedScreenId) return;
      node?.setSharedPluginData(NS, SCREEN_KEY, screenId);
    },

    findFlipbook: async (pageId, screenId) => (await findFlipbook(NS, pageId, screenId))?.id ?? null,
    listFlipbooks: pageIds => listFlipbooks(NS, pageIds),
    inspectFlipbooks: (pageIds, originalsOnly) => inspectFlipbooks(NS, pageIds, originalsOnly),
    flipbookSpots: pageIds => flipbookSpots(NS, pageIds),
    uiFingerprint: nodeId => createFingerprintReader(sceneNode).uiFingerprint(nodeId),
    selectedFlipbooks, markExistingFlipbooks,
    templateFromSelection,
    templateIssues,
    describeTemplate: id => describeTemplate(id, NS),
    connectTemplateItem: (id, key) => connectTemplateItem(id, key, NS),
    disconnectTemplateItem: (id, key) => disconnectTemplateItem(id, key, NS),
    templateItemNodes: (id, key) => templateItemNodes(id, key, NS),
    createDefaultTemplate: maxWidth => createDefaultTemplate(maxWidth, NS),
    ...(typeof __PLUGIN_RELEASE__ !== 'boolean' || !__PLUGIN_RELEASE__ ? { findTemplateMigrations, migrateFlipbookTemplate } : {}),
    ...(typeof __PLUGIN_RELEASE__ !== 'boolean' || !__PLUGIN_RELEASE__ ? { selectedFlowRepairImages, flowRepairCells, restoreFlowImage } : {}),
    convertLegacyFlipbooks: input => convertLegacyFlipbooks(input, NS),
    scanCopies: (pageIds, uids) => scanCopies(NS, pageIds, uids),
    updateCopies: items => updateCopies(NS, items),
    retagCopies: items => retagCopies(NS, items),
    markTracked: items => markTracked(NS, items),
    pasteGui: (item, at) => pasteCopy(NS, item, at),
    nodePlaces: items => nodePlaces(NS, items),
    createdCopies: nodeIds => createdCopies(NS, nodeIds),
    prepareFlipbookTitle: item => prepareFlipbookTitle(NS, item),
    beginDelivery: known => { deliverySession = flipbookSession(known); },
    endDelivery: () => { deliverySession = undefined; },
    syncFlipbook: (settings, view) => syncFlipbook(NS, settings, view, deliverySession),
    syncChapters: items => syncChapters(NS, items),
    moveFlipbook: move => moveFlipbookFrame(NS, move),

    async reveal(nodeId, isLatest) {
      const raw = await figma.getNodeByIdAsync(nodeId);
      if (raw?.type === 'PAGE') {
        if (!isLatest() || raw.isPageDivider) return false;
        await figma.setCurrentPageAsync(raw);
        return isLatest();
      }
      const node = raw && 'visible' in raw ? raw as SceneNode : null;
      if (!node || !isLatest()) return false;
      const page = pageOf(node);
      const samePage = !page || figma.currentPage === page;
      if (page && !samePage) await figma.setCurrentPageAsync(page);
      // 페이지 로드가 늦게 끝나도 이전 행으로 화면을 되돌리지 않는다.
      if (!isLatest()) return false;
      // 확대·축소는 그대로 두고 레이어 가운데로 이동만 한다(2026-11-03 사용자 요청).
      const box = node.absoluteBoundingBox;
      const viewport = figma.viewport;
      const targetCenter = box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : { x: node.absoluteTransform[0][2], y: node.absoluteTransform[1][2] };
      if (!samePage) {
        viewport.center = targetCenter;
        return true;
      }
      const startCenter = viewport.center;
      const start = Date.now();
      while (isLatest()) {
        const progress = Math.min(1, (Date.now() - start) / 240);
        const eased = 1 - (1 - progress) ** 3;
        viewport.center = { x: startCenter.x + (targetCenter.x - startCenter.x) * eased, y: startCenter.y + (targetCenter.y - startCenter.y) * eased };
        if (progress === 1) return true;
        await new Promise(resolve => setTimeout(resolve, 16));
      }
      return false;
    },

    selectionTarget,
    readSelection() {
      const root = selectedDescriptionRoot();
      if (root) return { paragraphs: readDescription(root), layout: readDescriptionLayout(root) };
      // 프레임에는 적용할 때마다 새로 추가하므로 불러올 내용이 정해지지 않는다(BEHAVIOR.md 「확인 필요」).
      if (selectedFrame()) throw new Error(COPY.figmaText010);
      const node = selectedTextNode();
      return { paragraphs: readRichText(node), layout: readTextNodeLayout(node) };
    },
    async writeSelection(paragraphs, layout) {
      const root = selectedDescriptionRoot();
      if (root) return fillDescription(root, paragraphs, layout);
      const frame = selectedFrame();
      if (frame) return addTextFrame(frame, paragraphs, layout);
      const node = selectedTextNode();
      await writeRichText(node, paragraphs, layout);
      return { kind: 'text' };
    },
    async readFlipbookDescription(item) {
      const root = flipbookDescriptionRoot(await flipbookFrame(item));
      return { paragraphs: readDescription(root), layout: readDescriptionLayout(root) };
    },
    async writeFlipbookDescription(item, paragraphs, layout) {
      await fillDescription(flipbookDescriptionRoot(await flipbookFrame(item)), paragraphs, layout, false);
    },
    async flipbookDescriptionArea(item) {
      const area = markedPart(await flipbookFrame(item), 'descriptionArea', NS);
      return !area ? 'none' : area.visible ? 'shown' : 'hidden';
    },
    // 영역 레이어의 보이기만 바꾼다. 본문 내용은 건드리지 않는다.
    async setFlipbookDescriptionShown(item, shown) {
      const area = markedPart(await flipbookFrame(item), 'descriptionArea', NS);
      if (!area) throw new Error(COPY.figmaTemplate041);
      if (area.visible !== shown) area.visible = shown;
    },
    createFlow: plan => createFlow(NS, plan),
    flowCells: pageIds => scanFlowCells(NS, pageIds),
    createdFlowCells: nodeIds => createdFlowCells(NS, nodeIds),
    updateFlowCells: (cellIds, thumbs) => updateFlowCells(NS, cellIds, thumbs),
    pdfSelection,
    async exportPdf(progress) {
      const pageName = figma.currentPage.name;
      return { pageName, pages: await exportPdfPages(progress) };
    },
  };
}

// 플립북 프레임: 알려진 노드 ID를 먼저 보고, 없으면 기록된 페이지에서 찾는다.
async function flipbookFrame(item: { flipbookId: string; pageId: string; nodeId?: string }): Promise<FrameNode> {
  const known = item.nodeId ? await figma.getNodeByIdAsync(item.nodeId) : null;
  const frame = known?.type === 'FRAME' && known.getSharedPluginData(NS, FLIPBOOK_KEY) === item.flipbookId ? known : await findFlipbook(NS, item.pageId, item.flipbookId);
  if (!frame) throw new Error(COPY.figmaFlipbook027);
  return frame;
}
