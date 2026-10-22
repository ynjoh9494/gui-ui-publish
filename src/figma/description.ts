import { COPY } from '../core/copy.ts';
import type { SelectionWrite } from '../core/description.ts';
import type { RichParagraph } from '../core/richText.ts';
import { applyRichText, readRichText, textFonts } from './richText.ts';

const BODY_MARKER = 'guiUiPublishDescriptionBody';

// The selected Description is the boundary. Text inside it is user content, not a template to classify.
export function selectedDescriptionRoot(): SceneNode | null {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1) return null;
  for (let node: BaseNode | null = selection[0]; node && node.type !== 'PAGE' && node.type !== 'DOCUMENT'; node = node.parent) {
    if (node.name === 'Description' && (node.type === 'FRAME' || node.type === 'INSTANCE' || node.type === 'GROUP')) return node;
  }
  return null;
}

function bodyArea(root: SceneNode): SlotNode {
  const area = 'findOne' in root ? root.findOne(node => node.type === 'SLOT' && node.name === 'description area') : null;
  if (!area || area.type !== 'SLOT') throw new Error(COPY.figmaText005);
  return area;
}

function managedBody(area: SlotNode): TextNode | null {
  for (let index = area.children.length - 1; index >= 0; index--) {
    const node = area.children[index];
    if (node.type === 'TEXT' && node.visible && node.getPluginData(BODY_MARKER) === '1') return node;
  }
  return null;
}

function blank(): RichParagraph { return { text: '', depth: null, bold: [] }; }

// Reading the initial slot is a plain text read in canvas order. No heading or section names are inferred.
export function readDescription(root: SceneNode): RichParagraph[] {
  const area = bodyArea(root);
  const managed = managedBody(area);
  if (managed) return readRichText(managed);
  const texts = area.findAllWithCriteria({ types: ['TEXT'] })
    .filter(node => {
      for (let current: BaseNode | null = node; current && current.id !== area.id; current = current.parent) {
        if ('visible' in current && !current.visible) return false;
      }
      return true;
    })
    .sort((a, b) => (a.absoluteBoundingBox?.y ?? 0) - (b.absoluteBoundingBox?.y ?? 0)
      || (a.absoluteBoundingBox?.x ?? 0) - (b.absoluteBoundingBox?.x ?? 0));
  const result: RichParagraph[] = [];
  for (const node of texts) {
    if (result.length) result.push(blank());
    result.push(...readRichText(node));
  }
  return result;
}

export async function fillDescription(root: SceneNode, doc: RichParagraph[]): Promise<SelectionWrite> {
  const area = bodyArea(root);
  const prior = managedBody(area);
  // Prepare a replacement before touching the visible content. Figma Undo can restore the previous slot.
  const next = prior ? prior.clone() : figma.createText();
  try {
    next.name = 'Description text';
    next.setPluginData(BODY_MARKER, '1');
    if (!prior) {
      next.fontSize = 14;
      next.lineHeight = { unit: 'PERCENT', value: 130 };
      next.fills = [{ type: 'SOLID', color: { r: 0.12, g: 0.12, b: 0.12 } }];
    }
    next.resize(Math.max(1, area.width - 24), Math.max(1, next.height));
    next.textAutoResize = 'HEIGHT';
    applyRichText(next, doc, await textFonts(next));
    area.appendChild(next);
    for (const node of area.children) if (node.id !== next.id) node.visible = false;
    figma.currentPage.selection = [root];
    return { kind: 'description' };
  } catch (error) {
    if (!next.removed) next.remove();
    throw error;
  }
}
