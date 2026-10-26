import { COPY } from '../core/copy.ts';
import type { GuiThumb } from '../core/types.ts';
import { keepModes } from './layers.ts';

// GUI 배포 때 만드는 화면 썸네일(2026-10-20 사용자 결정). 1/4 크기, 투명 대신 검정(#000000) 배경을 깐 JPG이며
// 별도 페이지에 화면마다 최신 썸네일 하나를 이미지 사각형으로 둔다. 플립북 탭의 목록·화면 선택에서 미리보기로 쓴다.
// 기록하는 크기(사각형·플로우 칸)는 1/4이고, 확대해도 깨지지 않게 이미지는 1/2 해상도로 내보낸다(2026-10-26 사용자 결정).

export const THUMB_SCALE = 0.25;
const THUMB_EXPORT_SCALE = 0.5;
const PAGE_ROLE_KEY = 'role';
const PAGE_ROLE = 'thumbs';
const THUMB_KEY = 'thumbOf';
const GAP = 80;

async function thumbPage(ns: string): Promise<PageNode> {
  let page = figma.root.children.find(p => p.getSharedPluginData(ns, PAGE_ROLE_KEY) === PAGE_ROLE) ?? null;
  if (!page) {
    page = figma.createPage();
    page.name = COPY.figmaLayers001;
    page.setSharedPluginData(ns, PAGE_ROLE_KEY, PAGE_ROLE);
  }
  await page.loadAsync();
  return page;
}

// 원본을 검정 배경 프레임에 복제해 1/2 해상도 JPG로 내보내고 크기는 1/4로 기록한다. 확정 뒤 사각형에 반영한다.
export async function makeThumbnail(source: SceneNode, label: string): Promise<GuiThumb> {
  const holder = figma.createFrame();
  holder.name = label;
  holder.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  holder.clipsContent = true;
  holder.resizeWithoutConstraints(Math.max(1, source.width), Math.max(1, source.height));
  try {
    const copy = source.type === 'COMPONENT' ? source.createInstance() : source.clone();
    holder.appendChild(copy);
    copy.x = 0;
    copy.y = 0;
    // 원본이 페이지·Section에서 물려받던 변수 모드를 지정해 같은 색으로 보이게 한다.
    if (copy.type === 'FRAME' || copy.type === 'INSTANCE') await keepModes(source, copy as FrameNode);
    const bytes = await holder.exportAsync({ format: 'JPG', constraint: { type: 'SCALE', value: THUMB_EXPORT_SCALE } });
    const image = figma.createImage(bytes);
    const width = Math.max(1, Math.round(source.width * THUMB_SCALE));
    const height = Math.max(1, Math.round(source.height * THUMB_SCALE));
    return { hash: image.hash, width, height };
  } finally {
    if (!holder.removed) holder.remove();
  }
}

// 확정된 화면만 썸네일 페이지에 반영한다. 한 배포 안에서는 기존 사각형과 끝 위치를 한 번만 읽는다.
export async function placeThumbnails(ns: string, updates: { screenId: string; label: string; thumb: GuiThumb }[]): Promise<void> {
  if (!updates.length) return;
  const page = await thumbPage(ns);
  const hadChildren = page.children.length > 0;
  const byScreen = new Map<string, RectangleNode>();
  let right = 0;
  for (const node of page.children) {
    if (node.type === 'RECTANGLE') {
      const id = node.getSharedPluginData(ns, THUMB_KEY);
      if (id) byScreen.set(id, node);
    }
    right = Math.max(right, node.x + node.width);
  }
  for (const { screenId, label, thumb } of updates) {
    let rect = byScreen.get(screenId);
    if (!rect) {
      rect = figma.createRectangle();
      rect.setSharedPluginData(ns, THUMB_KEY, screenId);
      page.appendChild(rect);
      rect.x = hadChildren || byScreen.size ? right + GAP : 0;
      rect.y = 0;
      byScreen.set(screenId, rect);
    }
    rect.name = label;
    rect.resize(thumb.width, thumb.height);
    rect.fills = [{ type: 'IMAGE', imageHash: thumb.hash, scaleMode: 'FILL' }];
    right = Math.max(right, rect.x + rect.width);
  }
}

// 화면별 썸네일 사각형의 이름을 현재 Screen ID·이름으로 바꾼다. 썸네일 페이지가 없으면 만들지 않는다.
export async function renameThumbnails(ns: string, labels: Map<string, string>): Promise<void> {
  const page = figma.root.children.find(p => p.getSharedPluginData(ns, PAGE_ROLE_KEY) === PAGE_ROLE);
  if (!page || !labels.size) return;
  await page.loadAsync();
  for (const node of page.children) {
    const label = node.type === 'RECTANGLE' ? labels.get(node.getSharedPluginData(ns, THUMB_KEY)) : undefined;
    if (label !== undefined && node.name !== label) node.name = label;
  }
}

// 썸네일 페이지를 불러오지 않으면 그 페이지에만 있는 이미지를 찾지 못한다(dynamic-page). 실행 중 한 번만 불러온다.
let loadedThumbPage: PageNode | null = null;
export async function loadThumbnailPage(ns: string): Promise<void> {
  if (!loadedThumbPage || loadedThumbPage.removed) {
    const page = figma.root.children.find(p => p.getSharedPluginData(ns, PAGE_ROLE_KEY) === PAGE_ROLE) ?? null;
    await page?.loadAsync();
    loadedThumbPage = page;
  }
}

export async function thumbnailBytes(ns: string, hash: string): Promise<Uint8Array | null> {
  await loadThumbnailPage(ns);
  const image = figma.getImageByHash(hash);
  return image ? image.getBytesAsync() : null;
}
