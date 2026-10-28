import type { ChangeReason, DigestGroup, LayerRef } from '../core/changeDigest.ts';
import { COPY } from '../core/copy.ts';
import { esc } from './html.ts';

const GROUP_LABEL: Record<DigestGroup, string> = {
  structure: COPY.uiApp363, display: COPY.uiApp364, geometry: COPY.uiApp365, paint: COPY.uiApp366, effects: COPY.uiApp367,
  shape: COPY.uiApp368, text: COPY.uiApp369, textStyle: COPY.uiApp370, variables: COPY.uiApp371, other: COPY.uiApp372,
};

// 화면 기준 짝이 같을 때의 설명(core/changeDigest.ts COMPANION)
const SAME_LABEL: Partial<Record<DigestGroup, string>> = {
  structure: COPY.uiApp373, geometry: COPY.uiApp374, paint: COPY.uiApp375, effects: COPY.uiApp376, textStyle: COPY.uiApp377, variables: COPY.uiApp378,
};

function layerButton(layer: LayerRef, note = ''): string {
  const name = layer.path.length ? layer.path.join(' › ') : COPY.uiApp383;
  const label = `${esc(name)}${note ? ` <span class="reason-note">· ${esc(note)}</span>` : ''}`;
  return layer.nodeId
    ? `<li><button class="link" data-action="reason-layer" data-node="${esc(layer.nodeId)}" title="${esc(COPY.uiApp384)}">${label}</button></li>`
    : `<li>${label}</li>`;
}

function block(title: string, detail: string[], layers: string[]): string {
  const head = `<p class="reason-head"><strong>${esc(title)}</strong>${detail.map(d => ` · ${esc(d)}`).join('')}</p>`;
  return `<div class="reason-group">${head}${layers.length ? `<ul class="reason-layers">${layers.join('')}</ul>` : ''}</div>`;
}

// GUI 상세 패널의 「변경 근거」. 어느 레이어의 어떤 속성 묶음이 비교 기준과 다른지와, 보이는 값이 같은지를 보여 준다.
export function changeReasonSection(reason: ChangeReason | undefined): string {
  if (!reason) return '';
  let body = '';
  if (reason.status === 'no-record') body = `<p class="note">${esc(COPY.uiApp386)}</p>`;
  else if (reason.status === 'unknown') body = `<p class="note">${esc(COPY.uiApp387)}</p>`;
  else {
    if (!reason.visible) body += `<p class="reason-verdict">${esc(COPY.uiApp362)}</p>`;
    for (const g of reason.groups) {
      const same = SAME_LABEL[g.group];
      const detail = [...(g.sameOnScreen && same ? [same] : []), ...(g.layers.length ? [`${g.layers.length}${COPY.uiApp379}`] : [])];
      // 묶음 안에서 일부 레이어만 보이는 값이 같으면 그 레이어에 표시한다.
      body += block(GROUP_LABEL[g.group], detail, g.layers.map(l => layerButton(l.layer, !g.sameOnScreen && l.sameOnScreen && same ? same : '')));
    }
    if (reason.added.length) body += block(COPY.uiApp380, [`${reason.added.length}${COPY.uiApp379}`], reason.added.map(l => layerButton(l)));
    if (reason.renamed.length) body += block(COPY.uiApp381, [`${reason.renamed.length}${COPY.uiApp379}`], reason.renamed.map(l => layerButton(l)));
    if (reason.removed) body += block(COPY.uiApp382, [`${reason.removed}${COPY.uiApp379}`], []);
    if (reason.status === 'partial') body += `<p class="note">${esc(COPY.uiApp385)}</p>`;
  }
  return `<section class="detail-section change-reason"><h3>${esc(COPY.uiApp361)}</h3>${body}</section>`;
}
