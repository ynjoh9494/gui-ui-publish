import { COPY_KEY } from './layers.ts';

// 추적 GUI의 「화면 정보 + 화면」 묶음(GUI 붙이기와 새 플립북 GUI 영역이 같이 쓴다).

export const PASTE_LAYOUT_KEY = 'pasteLayout';
export const PASTE_SCREEN_KEY = 'pasteScreen';
export const PASTE_GUI_KEY = 'pasteGui';
export const LABELED_LAYOUT = 'labeled-v2';
export const PREVIOUS_LAYOUT = 'mobile-v1';
const TRACKED_PREFIX = '🔗 ';
let labelFonts: Promise<void> | null = null;

function loadLabelFonts(): Promise<void> {
  if (!labelFonts) {
    labelFonts = Promise.all([
      figma.loadFontAsync({ family: 'Inter', style: 'Bold' }),
      figma.loadFontAsync({ family: 'Inter', style: 'Medium' }),
    ]).then(() => {}).catch(error => { labelFonts = null; throw error; });
  }
  return labelFonts;
}

export function trackedName(name: string): string {
  return name.startsWith(TRACKED_PREFIX) ? name : `${TRACKED_PREFIX}${name}`;
}

// GUI 자체는 다시 배포할 수 있게 두고, 붙인 화면의 제목과 숨긴 Screen ID는 별도 레이어로 둔다.
export async function labeledCopy(ns: string, gui: FrameNode, holder: FrameNode, code: string, name: string, key: string): Promise<FrameNode> {
  await loadLabelFonts();
  const root = figma.createFrame();
  holder.appendChild(root);
  root.name = trackedName('GUI · 자동 업데이트');
  root.fills = [];
  root.clipsContent = false;
  root.resize(gui.width, gui.height + 41);
  root.layoutMode = 'VERTICAL';
  root.itemSpacing = 16;
  root.primaryAxisAlignItems = 'MAX';
  root.counterAxisAlignItems = 'MIN';

  const label = figma.createFrame();
  root.appendChild(label);
  label.name = 'Label';
  label.fills = [];
  label.clipsContent = false;
  label.resize(gui.width, 25);
  label.layoutMode = 'VERTICAL';
  label.itemSpacing = 4;
  label.primaryAxisAlignItems = 'CENTER';
  label.counterAxisAlignItems = 'MIN';
  label.primaryAxisSizingMode = 'AUTO';
  label.counterAxisSizingMode = 'FIXED';
  label.layoutSizingHorizontal = 'FILL';
  label.layoutSizingVertical = 'HUG';

  const id = figma.createFrame();
  label.appendChild(id);
  id.name = 'Screen ID';
  id.fills = [];
  id.clipsContent = false;
  id.resize(Math.max(81, code.length * 8 + 10), 22);
  id.layoutMode = 'HORIZONTAL';
  id.paddingLeft = 5;
  id.paddingRight = 5;
  id.primaryAxisAlignItems = 'CENTER';
  id.counterAxisAlignItems = 'CENTER';
  id.primaryAxisSizingMode = 'AUTO';
  id.counterAxisSizingMode = 'AUTO';
  id.layoutSizingHorizontal = 'HUG';
  id.layoutSizingVertical = 'HUG';
  const bg = figma.createRectangle();
  id.appendChild(bg);
  bg.name = 'bg';
  bg.resize(id.width, 22);
  bg.layoutPositioning = 'ABSOLUTE';
  bg.cornerRadius = 6;
  bg.fills = [{ type: 'SOLID', color: { r: 242 / 255, g: 242 / 255, b: 245 / 255 } }];
  const idText = figma.createText();
  id.appendChild(idText);
  idText.name = 'text';
  idText.fontName = { family: 'Inter', style: 'Medium' };
  idText.fontSize = 14;
  idText.lineHeight = { unit: 'PERCENT', value: 160 };
  idText.fills = [{ type: 'SOLID', color: { r: 115 / 255, g: 115 / 255, b: 122 / 255 } }];
  idText.characters = code;
  idText.textAutoResize = 'WIDTH_AND_HEIGHT';
  idText.layoutSizingHorizontal = 'HUG';
  idText.layoutSizingVertical = 'HUG';
  bg.resize(id.width, id.height);
  id.visible = false;

  const title = figma.createText();
  label.appendChild(title);
  title.name = 'Screen Title';
  title.fontName = { family: 'Inter', style: 'Bold' };
  title.fontSize = 18;
  title.lineHeight = { unit: 'PERCENT', value: 140 };
  title.fills = [{ type: 'SOLID', color: { r: 51 / 255, g: 51 / 255, b: 51 / 255 } }];
  title.characters = name;
  title.resize(gui.width, 25);
  title.textAutoResize = 'HEIGHT';
  title.layoutSizingHorizontal = 'FILL';
  title.layoutSizingVertical = 'HUG';

  const screen = figma.createFrame();
  root.appendChild(screen);
  screen.name = 'Screen';
  screen.setSharedPluginData(ns, PASTE_SCREEN_KEY, 'true');
  screen.fills = [];
  screen.clipsContent = true;
  screen.resize(gui.width, gui.height);
  screen.layoutMode = 'VERTICAL';
  screen.primaryAxisAlignItems = 'MIN';
  screen.counterAxisAlignItems = 'MIN';
  screen.appendChild(gui);
  gui.name = 'GUI';
  gui.setSharedPluginData(ns, PASTE_GUI_KEY, 'true');
  gui.layoutSizingHorizontal = 'FIXED';
  gui.layoutSizingVertical = 'FIXED';
  gui.setSharedPluginData(ns, COPY_KEY, '');
  screen.primaryAxisSizingMode = 'AUTO';
  screen.counterAxisSizingMode = 'AUTO';
  screen.layoutSizingHorizontal = 'HUG';
  screen.layoutSizingVertical = 'HUG';
  root.primaryAxisSizingMode = 'AUTO';
  root.counterAxisSizingMode = 'AUTO';
  root.layoutSizingHorizontal = 'HUG';
  root.layoutSizingVertical = 'HUG';
  root.setSharedPluginData(ns, COPY_KEY, key);
  root.setSharedPluginData(ns, PASTE_LAYOUT_KEY, LABELED_LAYOUT);
  return root;
}
