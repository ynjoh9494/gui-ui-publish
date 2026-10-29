import { COPY } from '../core/copy.ts';
import type { FoundCopy } from '../core/tracks.ts';
import type { CopyUpdate } from '../host.ts';
import { COPY_SCALE_KEY, FLIPBOOK_KEY, loadPages, NODE_KEY } from './flipbook.ts';
import { COPY_KEY, copyLayers, rescaleExact } from './layers.ts';
import { linksOf } from './template.ts';

// 추적 GUI(core/tracks.ts)의 캔버스 쪽: 페이지에서 GUI 복사본을 찾고, 새 버전으로 바꾸고, 추적 기록 ID를 적는다.

// 복사본 노드에 적는 추적 기록 ID. 캔버스에서 복제한 복사본도 같은 값을 가진다.
export const TRACK_KEY = 'trackOf';

// 복사본을 품은 플립북: 새 템플릿 플립북(원본 프레임)이면 그 ID, 이전 템플릿 플립북 안이면 'legacy'(그 플립북이 GUI를 맞춘다),
// 밖이거나 캔버스에서 복제한 플립북 프레임 안이면 null.
function owner(ns: string, node: BaseNode): string | null | 'legacy' {
  for (let n = node.parent; n && n.type !== 'PAGE'; n = n.parent) {
    const id = n.getSharedPluginData(ns, FLIPBOOK_KEY);
    if (!id) continue;
    if (!linksOf(n, ns)) return 'legacy';
    return n.getSharedPluginData(ns, NODE_KEY) === n.id ? id : null;
  }
  return null;
}

// 페이지들에서 GUI 복사본(복사본 표식이 있는 노드)을 찾는다. uids가 있으면 그 화면의 복사본만. 이전 템플릿 플립북 안의 복사본은 뺀다.
export async function scanCopies(ns: string, pageIds: string[], uids?: string[]): Promise<FoundCopy[]> {
  const wanted = uids ? new Set(uids) : null;
  const out: FoundCopy[] = [];
  for (const page of await loadPages(pageIds)) {
    for (const node of page.findAllWithCriteria({ sharedPluginData: { namespace: ns, keys: [COPY_KEY] } })) {
      const key = node.getSharedPluginData(ns, COPY_KEY);
      const at = key.lastIndexOf('@');
      const uid = key.slice(0, at), version = Number(key.slice(at + 1));
      if (at <= 0 || !Number.isFinite(version) || (wanted && !wanted.has(uid))) continue;
      const flipbook = owner(ns, node);
      if (flipbook === 'legacy') continue;
      out.push({ nodeId: node.id, pageId: page.id, uid, version, trackId: node.getSharedPluginData(ns, TRACK_KEY), flipbookId: flipbook });
    }
  }
  return out;
}

export async function markTracked(ns: string, items: { nodeId: string; trackId: string }[]): Promise<void> {
  for (const { nodeId, trackId } of items) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (node && !node.removed && 'setSharedPluginData' in node) node.setSharedPluginData(ns, TRACK_KEY, trackId);
  }
}


// 추적 GUI를 새 버전으로 바꾼다(2026-10-29 사용자 결정). 자리·레이어 순서·이름·잠금과 지금 폭(사용자가 K로 바꾼 크기)을 지킨다.
// 원본은 화면마다 한 번만 복사하고, 폭이 같은 자리는 한 번 맞춘 복사본을 복제해 쓴다. 원본을 찾지 못한 화면은 이전 복사본을 둔다.
export async function updateCopies(ns: string, items: CopyUpdate[]): Promise<{ updated: { trackId: string; nodeId: string }[]; notes: string[] }> {
  const updated: { trackId: string; nodeId: string }[] = [];
  const notes = new Set<string>();
  for (const item of items) {
    const source = item.sourceNodeId ? await figma.getNodeByIdAsync(item.sourceNodeId) : null;
    if (!source || !('visible' in source)) { notes.add(`${COPY.figmaFlipbook023} ${item.code}`); continue; }
    const staging = figma.createFrame();
    try {
      const base = await copyLayers(ns, source as SceneNode, staging, item.key, `${item.code} GUI`);
      const byWidth = new Map<number, SceneNode>();
      for (const target of item.copies) {
        const old = await figma.getNodeByIdAsync(target.nodeId) as SceneNode | null;
        if (!old || old.removed || !old.parent) continue;
        const width = Math.round(old.width * 100) / 100;
        let prepared = byWidth.get(width);
        if (!prepared) {
          prepared = base.clone();
          const factor = old.width / prepared.width;
          if (Math.abs(factor - 1) > 1e-6) for (const font of await rescaleExact(prepared, factor)) notes.add(`${COPY.figmaFlipbook026} ${font}`);
          byWidth.set(width, prepared);
        }
        const copy = prepared.clone();
        const parent = old.parent as BaseNode & ChildrenMixin;
        parent.insertChild(parent.children.indexOf(old), copy);
        // 오토 레이아웃 부모에서 떼어 낸 복제본은 부모가 바뀌어도 ABSOLUTE로 남아 있어, 지금 부모가 오토 레이아웃일 때만 옮긴다.
        if ('layoutPositioning' in old && old.layoutPositioning === 'ABSOLUTE' && 'layoutMode' in parent && parent.layoutMode !== 'NONE') (copy as FrameNode).layoutPositioning = 'ABSOLUTE';
        copy.x = old.x;
        copy.y = old.y;
        copy.name = old.name;
        copy.locked = old.locked;
        copy.setSharedPluginData(ns, TRACK_KEY, target.trackId);
        const scale = old.getSharedPluginData(ns, COPY_SCALE_KEY);
        if (scale) copy.setSharedPluginData(ns, COPY_SCALE_KEY, scale);
        old.remove();
        updated.push({ trackId: target.trackId, nodeId: copy.id });
      }
    } finally {
      staging.remove();
    }
  }
  return { updated, notes: [...notes] };
}
