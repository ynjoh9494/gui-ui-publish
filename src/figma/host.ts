import { COPY } from '../core/copy.ts';
import type { ScannedFrame } from '../core/compare.ts';
import { canvasOrder } from '../core/screenCode.ts';
import type { KV } from '../core/store.ts';
import { clampWindow } from '../core/wire.ts';
import type { Host } from '../host.ts';
import { ensureDataPage, renderDataPage } from './data.ts';
import { createFingerprintReader } from './fingerprints.ts';
import { NS, findFlipbook, flipbookSpots, inspectFlipbooks, listFlipbooks, loadPages, moveFlipbookFrame, syncChapters, syncFlipbook, templateFromSelection, templateIssues, flipbookSession, type FlipbookSession } from './flipbook.ts';
import { addTextFrame, fillDescription, readDescription, selectedDescriptionRoot, selectedFrame, selectionTarget } from './description.ts';
import { createFlow, flowNode, updateFlow } from './flow.ts';
import { exportPdfPages, pdfSelection } from './pdf.ts';
import { readRichText, selectedTextNode, writeRichText } from './richText.ts';
import { connectTemplateItem, describeTemplate, disconnectTemplateItem, templateItemNodes } from './template.ts';
import { createDefaultTemplate } from './templateDefault.ts';
import { makeThumbnail, placeThumbnails, renameThumbnails, thumbnailBytes } from './thumbs.ts';

// 사용자별 플러그인 창 크기(figma.clientStorage)
export const WINDOW_KEY = 'windowSize';
const SCREEN_KEY = 'screenId';
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
  let programmedSelection: string[] | null = null;
  let programmedUntil = 0;

  async function sceneNode(nodeId: string): Promise<SceneNode | null> {
    const node = await figma.getNodeByIdAsync(nodeId);
    return node && 'visible' in node ? node as SceneNode : null;
  }

  return {
    kv,
    mode,
    actor: { id: user?.id ?? 'unknown', name: user?.name ?? COPY.figmaHost004 },
    post: message => figma.ui.postMessage(message),
    resize(width, height, save, compact) {
      const size = clampWindow(mode, width, height, compact);
      figma.ui.resize(size.width, size.height);
      if (save) void figma.clientStorage.setAsync(WINDOW_KEY, size);
    },
    // 썸네일 페이지는 플러그인이 관리하므로 페이지 선택지에서 뺀다.
    pages: () => root.children.filter(p => p.getSharedPluginData(NS, 'role') !== 'thumbs').map(p => ({ id: p.id, name: p.name, ...(p === figma.currentPage ? { current: true } : {}) })),

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
      return figma.currentPage.selection.map(node => ({ nodeId: node.id, flipbookId: node.getSharedPluginData(NS, 'flipbookOf') || null }));
    },

    createFingerprintReader: () => createFingerprintReader(sceneNode),
    fingerprint: (nodeId, includeLegacy, digest) => createFingerprintReader(sceneNode).fingerprint(nodeId, includeLegacy, digest),
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

    ensureDataPage: pageId => ensureDataPage(NS, pageId),

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
    renderData: (pageId, model, rebuild) => renderDataPage(NS, pageId, model, rebuild),

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
    templateFromSelection,
    templateIssues,
    describeTemplate: id => describeTemplate(id, NS),
    connectTemplateItem: (id, key) => connectTemplateItem(id, key, NS),
    disconnectTemplateItem: (id, key) => disconnectTemplateItem(id, key, NS),
    templateItemNodes: (id, key) => templateItemNodes(id, key, NS),
    createDefaultTemplate: maxWidth => createDefaultTemplate(maxWidth, NS),
    beginDelivery: known => { deliverySession = flipbookSession(known); },
    endDelivery: () => { deliverySession = undefined; },
    syncFlipbook: (settings, view) => syncFlipbook(NS, settings, view, deliverySession),
    syncChapters: items => syncChapters(NS, items),
    moveFlipbook: move => moveFlipbookFrame(NS, move),

    async reveal(nodeId, isLatest) {
      const node = await sceneNode(nodeId);
      if (!node || !isLatest()) return false;
      const page = pageOf(node);
      const samePage = !page || figma.currentPage === page;
      if (page && !samePage) await figma.setCurrentPageAsync(page);
      // 페이지 로드가 늦게 끝나도 이전 행으로 화면을 되돌리지 않는다.
      if (!isLatest()) return false;
      const box = node.absoluteBoundingBox;
      if (!samePage || !box || !box.width || !box.height) {
        figma.viewport.scrollAndZoomIntoView([node]);
        return true;
      }
      const viewport = figma.viewport;
      const startCenter = viewport.center;
      const startZoom = viewport.zoom;
      const bounds = viewport.bounds;
      const targetCenter = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const targetZoom = Math.max(0.02, Math.min(16, startZoom * Math.min(bounds.width / box.width, bounds.height / box.height) * 0.82));
      const start = Date.now();
      while (isLatest()) {
        const progress = Math.min(1, (Date.now() - start) / 240);
        const eased = 1 - (1 - progress) ** 3;
        viewport.zoom = startZoom + (targetZoom - startZoom) * eased;
        viewport.center = { x: startCenter.x + (targetCenter.x - startCenter.x) * eased, y: startCenter.y + (targetCenter.y - startCenter.y) * eased };
        if (progress === 1) return true;
        await new Promise(resolve => setTimeout(resolve, 16));
      }
      return false;
    },

    selectionTarget,
    readSelection() {
      const root = selectedDescriptionRoot();
      if (root) return readDescription(root);
      // 프레임에는 적용할 때마다 새로 추가하므로 불러올 내용이 정해지지 않는다(BEHAVIOR.md 「확인 필요」).
      if (selectedFrame()) throw new Error(COPY.figmaText010);
      return readRichText(selectedTextNode());
    },
    async writeSelection(paragraphs) {
      const root = selectedDescriptionRoot();
      if (root) return fillDescription(root, paragraphs);
      const frame = selectedFrame();
      if (frame) return addTextFrame(frame, paragraphs);
      const node = selectedTextNode();
      await writeRichText(node, paragraphs);
      return { kind: 'text' };
    },
    createFlow: plan => createFlow(NS, plan),
    updateFlow: (flow, thumbs) => updateFlow(NS, flow, thumbs),
    flowNode: (flow, uid) => flowNode(NS, flow, uid),
    pdfSelection,
    async exportPdf(progress) {
      const pageName = figma.currentPage.name;
      return { pageName, pages: await exportPdfPages(progress) };
    },
  };
}
