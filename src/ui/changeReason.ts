import type { ChangeReason, DigestGroup, LayerRef } from '../core/changeDigest.ts';
import { COPY } from '../core/copy.ts';
import { esc } from './html.ts';

const GROUP_LABEL: Record<DigestGroup, string> = {
  structure: COPY.uiApp363, display: COPY.uiApp364, geometry: COPY.uiApp365, paint: COPY.uiApp366, effects: COPY.uiApp367,
  shape: COPY.uiApp368, text: COPY.uiApp369, textStyle: COPY.uiApp370, variables: COPY.uiApp371, other: COPY.uiApp372,
};

// 화면 기준 짝이 같을 때의 사유(core/changeDigest.ts COMPANION)
const SAME_LABEL: Partial<Record<DigestGroup, string>> = {
  structure: COPY.uiApp373, geometry: COPY.uiApp374, paint: COPY.uiApp375, effects: COPY.uiApp375, textStyle: COPY.uiApp375, variables: COPY.uiApp375,
};

// 「전체 보기」·「더 보기」를 누를 때마다 더 보여 주는 줄 수
export const REASON_PAGE = 10;

const NOTICE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/></svg>';

// 한 줄에 들어가도록 상위 레이어 하나와 레이어 이름만 보여 주고, 전체 경로는 툴팁으로 보여 준다.
function paths(layer: LayerRef): { short: string; full: string } {
  if (!layer.path.length) return { short: COPY.uiApp383, full: COPY.uiApp383 };
  return { short: layer.path.slice(-2).join(' › '), full: layer.path.join(' › ') };
}

// 변경 하나를 한 줄로 보여 준다: 종류 · 레이어 (보이는 값이 같은 사유). 지금 화면에 있는 레이어는 누르면 캔버스에서 고른다.
function line(kind: string, layer: LayerRef | null, why = '', count = ''): string {
  const path = layer ? paths(layer) : null;
  const text = `<span>${esc(kind)}</span>${path ? `<span class="reason-path">${esc(path.short)}</span>` : ''}${count ? `<span>${esc(count)}</span>` : ''}${why ? `<span class="reason-why">(${esc(why)})</span>` : ''}`;
  const title = path ? ` title="${esc(path.full)}"` : '';
  if (layer?.nodeId) return `<li><button class="reason-line" data-action="reason-layer" data-node="${esc(layer.nodeId)}"${title}>${text}</button></li>`;
  return `<li><span class="reason-line"${title}>${text}</span></li>`;
}

// GUI 상세 패널의 「변경 사항」: 비교 기준과 다른 점을 한 줄씩 보여 준다. 보이는 값이 같은 변경은 아래에 모아
// 「전체 보기」로 열고 REASON_PAGE개씩 더 보여 주며, 다 펼치면 「숨기기」로 접는다. shown: 지금 펼쳐 보인 그런 줄 수
// 차이가 많아 일부만 풀렸으면(status partial) 풀린 줄만 보여 주고 따로 알리지 않는다.
export function changeReasonSection(reason: ChangeReason | undefined, shown = 0): string {
  if (!reason) return '';
  let body = '';
  if (reason.status === 'no-record') body = `<p class="note">${esc(COPY.uiApp386)}</p>`;
  else if (reason.status === 'unknown') body = `<p class="note">${esc(COPY.uiApp387)}</p>`;
  else {
    const lines: string[] = [];
    const quiet: string[] = [];
    for (const g of reason.groups) {
      const same = SAME_LABEL[g.group];
      // 차이가 많아 이 묶음의 레이어를 풀지 못했으면 묶음만 한 줄로 보여 준다.
      if (!g.layers.length) (g.sameOnScreen && same ? quiet : lines).push(line(GROUP_LABEL[g.group], null, g.sameOnScreen && same ? same : ''));
      for (const l of g.layers) {
        const isSame = !!((l.sameOnScreen ?? g.sameOnScreen) && same);
        (isSame ? quiet : lines).push(line(GROUP_LABEL[g.group], l.layer, isSame ? same : ''));
      }
    }
    for (const l of reason.added) lines.push(line(COPY.uiApp380, l));
    for (const l of reason.renamed) lines.push(line(COPY.uiApp381, l));
    if (reason.removed) lines.push(line(COPY.uiApp382, null, '', `${reason.removed}${COPY.uiApp015}`));
    if (!reason.visible) body += `<p class="reason-same">${NOTICE_ICON}<span>${esc(COPY.uiApp362)}</span></p>`;
    if (lines.length) body += `<ul class="reason-lines">${lines.join('')}</ul>`;
    if (quiet.length) {
      const visible = Math.min(shown, quiet.length);
      if (visible) body += `<ul class="reason-lines quiet">${quiet.slice(0, visible).join('')}</ul>`;
      const next = Math.min(REASON_PAGE, quiet.length - visible);
      // 다 펼치면 「숨기기」로 다시 접는다.
      body += next
        ? `<button class="link reason-more" data-action="reason-more">${visible ? `${next}${COPY.uiApp389}` : COPY.uiApp388}</button>`
        : `<button class="link reason-more" data-action="reason-less">${COPY.uiApp390}</button>`;
    }
  }
  return `<section class="change-reason"><h3>${esc(COPY.uiApp361)}</h3>${body}</section>`;
}
