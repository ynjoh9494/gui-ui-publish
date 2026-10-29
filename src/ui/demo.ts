import { COPY } from '../core/copy.ts';
// Figma 없이 실제 Controller와 UI를 돌리는 가짜 환경. 브라우저 미리보기와 튜토리얼의 예시 화면이 함께 쓴다.
// core 로직은 그대로 쓰고 Figma에 닿는 부분(프레임 목록·지문·레이어 복사·캔버스 이동)만 가짜 데이터로 바꾼다.
import { changeDigest } from '../core/changeDigest.ts';
import type { FlipbookSpot, ScannedFrame } from '../core/compare.ts';
import type { NodeSnapshot } from '../core/fingerprint.ts';
import { sha256 } from '../core/hash.ts';
import { parseRichText, type RichParagraph } from '../core/richText.ts';
import { memoryKV, type KV } from '../core/store.ts';
import type { Actor, Team } from '../core/types.ts';
import type { PageInfo, ToUi } from '../core/wire.ts';
import { TEMPLATE_ITEMS, type TemplateItem, type TemplateLayer } from '../core/templateParts.ts';
import type { Host } from '../host.ts';

// body: 화면 고유 내용(새 버전 페이지 비교의 유사도용). 이름을 바꾸거나 다른 페이지에 붙여 넣어도 그대로다.
export interface DemoFrame { nodeId: string; pageId: string; name: string; content: string; body: string; tag: string | null }

export const DEMO_PAGE: PageInfo = { id: '0:1', name: COPY.uiPreview001 };
export const DEMO_FLIPBOOK_PAGE: PageInfo = { id: '0:2', name: COPY.uiPreview014 };
const SECOND_UI_PAGE: PageInfo = { id: '0:3', name: 'UI 두 번째 페이지' };
// 다른 파일에서 페이지째 붙여 넣은 것처럼 만드는 새 버전 페이지
export const DEMO_VERSION_PAGE: PageInfo = { id: '0:5', name: 'GUI 새 버전' };
const DATA_PAGE: PageInfo = { id: '0:4', name: COPY.figmaData001 };

export interface DemoOptions {
  mode: Team;
  actor: Actor;
  // 지문 계산·플립북 반영·캔버스 이동에 걸리는 시간(ms). 미리보기는 Figma처럼 시간을 들이고 튜토리얼은 바로 끝낸다.
  fingerprintMs?: number;
  syncMs?: number;
  revealMs?: number;
  // 원본을 읽는 데 1.5초 걸린다.
  slowLoad?: boolean;
  // 세로로 긴 썸네일을 만든다.
  tallThumb?: boolean;
  // 읽은 프레임·계산한 지문 수를 body의 data 속성에 남긴다(미리보기 확인용).
  instrument?: boolean;
  log?(text: string): void;
  // 가짜 캔버스의 프레임 표식·플립북이 바뀌었다.
  canvasChanged?(): void;
  resize?(width: number, height: number): void;
}

export interface Demo {
  host: Host;
  kv: KV;
  frames: DemoFrame[];
  // 화면 ID → 플립북 프레임
  flipbooks: Map<string, string>;
  // 화면 ID → Description을 고친 횟수
  uiEdits: Map<string, number>;
  // Controller가 보내는 메시지를 받는다.
  listen(handler: (message: ToUi) => void): void;
  hasVersionPage(): boolean;
  // 원본 페이지의 화면을 새 노드·제각각 이름으로 복사하고, 두 번째 화면은 내용을 고치고 새 화면 하나를 더한다. 붙여 넣은 프레임 수를 돌려준다.
  pasteVersionPage(): number;
  // 원본 내용을 고친다(지문이 바뀐다).
  editFrame(frame: DemoFrame): void;
  // 캔버스에서 골라 둔 텍스트 레이어(텍스트 편집 탭). 미리보기 도구에서 내용을 확인한다.
  text: { name: string; paragraphs: RichParagraph[] };
  // 플립북 프레임을 모두 고르거나 선택을 푼다(PDF 저장 탭). 바꾼 뒤 Controller에 캔버스 선택이 바뀌었다고 알린다.
  pickFlipbookFrames(on: boolean): void;
  flipbookFramesPicked(): boolean;
}

// 지문은 화면마다 다르고(body), 이름·노드와 관계없이 내용이 같으면 같다.
const fakeFingerprint = (f: DemoFrame) => sha256(`${f.body}:${f.content}`);
// 변경 근거는 가짜 원본을 제목 텍스트 레이어 하나로 보고 실제 계산(core/changeDigest.ts)을 쓴다.
const fakeSnapshot = (f: DemoFrame): NodeSnapshot => ({
  type: 'FRAME', name: f.name, id: f.nodeId, props: { width: 1920, height: 1080 },
  children: [{ type: 'TEXT', name: 'Title', id: f.nodeId, props: { characters: `${f.body} ${f.content}` } }],
});
// 같은 화면이면 토큰 대부분이 같고, 내용(content)을 고친 만큼만 다르다.
const fakeTokens = (f: DemoFrame) => ['g:FRAME:1920x1080', ...Array.from({ length: 10 }, (_, i) => `t:${f.body}:${i}`), `t:${f.content}`];
const wait = (ms: number) => ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();

export function createDemo(options: DemoOptions): Demo {
  const log = options.log ?? (() => {});
  const changed = () => options.canvasChanged?.();
  const frames: DemoFrame[] = [
    ['10:1', COPY.uiPreview002], ['10:2', COPY.uiPreview003], ['10:3', COPY.uiPreview004], ['10:4', COPY.uiPreview005], ['10:5', COPY.uiPreview006],
    ['10:6', COPY.uiPreview007], ['10:7', COPY.uiPreview008], ['10:8', COPY.uiPreview009], ['10:9', COPY.uiPreview010], ['10:10', COPY.uiPreview011],
  ].map(([nodeId, name]) => ({ nodeId, pageId: DEMO_PAGE.id, name, content: 'v1', body: name, tag: null }));
  let versionPageMade = false;
  let dataPageMade = false;
  let thumbPageMade = false;
  // 썸네일 해시 → JPG 바이트
  const thumbs = new Map<string, Uint8Array>();
  let thumbSeq = 0;
  const flipbooks = new Map<string, string>();
  // 플립북마다 마지막으로 반영한 GUI 영역(Screen ID@크기). 화면 편집을 로그로 보여 준다.
  const shownGui = new Map<string, string>();
  // 플립북 프레임의 캔버스 배치. 같은 페이지·Section끼리 배열 순서가 Section 안 순서이고, Section은 처음 나온 순서다.
  const placed: { flipbookId: string; pageId: string; section: string; sectionName: string }[] = [];
  const uiEdits = new Map<string, number>();
  // 플로우 프레임 → 화면별 썸네일 버전
  const flows = new Map<string, Map<string, number>>();
  // 가짜 캔버스에서 플립북 프레임을 모두 골랐다(PDF 저장 탭).
  let framesPicked = false;
  let deliver: (message: ToUi) => void = () => {};
  const text = { name: 'Description', paragraphs: parseRichText(COPY.uiPreview051) };
  // 관리의 템플릿: 예시 템플릿(기본 템플릿과 같은 구성)의 항목별 연결. 연결하면 「선택한 레이어」로, 풀면 비운다.
  const templateDefaults = (): Map<TemplateItem, TemplateLayer[]> => new Map(([
    ['title', 'Title Row › Title'], ['chapter', 'Header › Chapter'], ['status', 'Title Row › Status'], ['ids', 'Header › Screen IDs'],
    ['gui', 'Body › GUI Area'], ['description', 'Description › Description Body'], ['history', 'History › History List'], ['pdfHidden', 'History'],
    ['idTag', 'Screen ID Tag'], ['row', 'History Row'], ['rowStatus', 'History Row › Status'], ['rowComment', 'History Row › Comment'],
    ['rowWorker', 'History Row › Worker'], ['rowDate', 'History Row › Date'], ['rowTeam', 'History Row › Team'],
  ] as [TemplateItem, string][]).map(([key, name]) => [key, [{ id: `tpl:${key}`, name }]]));
  let templateLayers = templateDefaults();

  // 검정 배경에 화면 이름을 쓴 1/4 크기 썸네일을 흉내 낸다.
  async function fakeThumb(label: string, version: string): Promise<Uint8Array> {
    const canvas = document.createElement('canvas');
    canvas.width = 480; canvas.height = options.tallThumb ? 1600 : 270;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 480, 270);
    ctx.fillStyle = '#4dabf7'; ctx.fillRect(24, 24, 432, 40);
    ctx.fillStyle = '#fff'; ctx.font = '24px sans-serif'; ctx.fillText(label, 24, 120); ctx.fillText(version, 24, 160);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/jpeg', 0.8));
    return new Uint8Array(await blob.arrayBuffer());
  }

  const kv = memoryKV();
  const host: Host = {
    kv,
    mode: options.mode,
    actor: options.actor,
    post: message => deliver(message),
    resize(width, height) { options.resize?.(width, height); },
    pages: () => [DEMO_PAGE, DEMO_FLIPBOOK_PAGE, SECOND_UI_PAGE, ...(versionPageMade ? [DEMO_VERSION_PAGE] : []), ...(dataPageMade ? [DATA_PAGE] : [])],
    managedPages: () => [...(dataPageMade ? [{ id: DATA_PAGE.id, name: COPY.figmaData001, kind: 'data' as const }] : []), ...(thumbPageMade ? [{ id: '0:thumbs', name: COPY.figmaLayers001, kind: 'thumbs' as const }] : [])],
    async ensureThumbnailPage() { thumbPageMade = true; return '0:thumbs'; },
    async placeThumbnails() { thumbPageMade = true; },
    async selectNodes(nodeIds) { log(`프레임 선택: ${nodeIds.join(', ')}`); },
    selectionNodeIds: () => [],
    async listFrames(pageIds) {
      if (options.slowLoad) {
        document.body.dataset.previewLoading = 'true';
        await wait(1500);
        delete document.body.dataset.previewLoading;
      }
      const listed = frames.filter(f => pageIds.includes(f.pageId));
      if (options.instrument) {
        document.body.dataset.previewFingerprints = '0';
        document.body.dataset.previewFrames = String(listed.length);
      }
      return listed.map((f): ScannedFrame => ({ nodeId: f.nodeId, pageId: f.pageId, name: f.name, width: 1920, height: 1080, screenTag: f.tag, fingerprint: null, error: null }));
    },
    // Figma처럼 쉬지 않고 계산한다. 이벤트 루프 양보는 본체 비교 루프가 맡는다.
    async fingerprint(nodeId, _legacy, digest) {
      const until = Date.now() + (options.fingerprintMs ?? 0);
      while (Date.now() < until) { /* 지문 계산 */ }
      if (options.instrument) document.body.dataset.previewFingerprints = String(Number(document.body.dataset.previewFingerprints ?? 0) + 1);
      const f = frames.find(x => x.nodeId === nodeId);
      if (!f) return { fingerprint: null, error: COPY.uiPreview015 };
      const fingerprint = fakeFingerprint(f);
      return { fingerprint, ...changeDigest(fingerprint, digest, () => fakeSnapshot(f)), error: null };
    },
    async screenFeatures(nodeId) {
      const f = frames.find(x => x.nodeId === nodeId);
      return f ? { fingerprint: fakeFingerprint(f), tokens: fakeTokens(f), name: f.name, error: null } : { fingerprint: null, tokens: null, error: COPY.uiPreview015 };
    },
    async makeThumbnail(nodeId, label) {
      const f = frames.find(x => x.nodeId === nodeId);
      if (!f) throw new Error(COPY.uiPreview015);
      const hash = `thumb-${++thumbSeq}`;
      thumbs.set(hash, await fakeThumb(label, f.content));
      log(`GUI 썸네일: ${label}`);
      return { hash, width: 480, height: 270 };
    },
    async thumbnailBytes(hash) { return thumbs.get(hash) ?? null; },
    async framePreview(nodeId) {
      const f = frames.find(x => x.nodeId === nodeId);
      return f ? fakeThumb(f.name, f.content) : null;
    },
    // 가짜 환경에는 썸네일 페이지가 없다.
    async renameThumbnails() {},
    // 목록 순서를 세로 배치로 본다.
    async canvasPositions(nodeIds) {
      const wanted = new Set(nodeIds);
      return new Map(frames.flatMap((f, i) => wanted.has(f.nodeId) ? [[f.nodeId, { page: 0, x: 0, y: i * 100, height: 50 }] as const] : []));
    },
    async clearMarkers() {
      const n = frames.filter(f => f.tag).length + flipbooks.size + (dataPageMade ? 1 : 0);
      frames.forEach(f => (f.tag = null));
      flipbooks.clear();
      placed.length = 0;
      dataPageMade = false;
      thumbPageMade = false;
      changed();
      log(`${COPY.uiPreview017} ${n}${COPY.uiPreview018}`);
      return n;
    },
    async ensureDataPage(pageId) {
      if (pageId && pageId === DATA_PAGE.id && dataPageMade) return pageId;
      if (!dataPageMade) { dataPageMade = true; log(COPY.uiPreview019); }
      return DATA_PAGE.id;
    },
    async renderData(_pageId, model) {
      log(`${COPY.uiPreview020} ${model.screens.length}${COPY.uiPreview021} ${model.history.length}`);
    },
    async tagSource(nodeId, screenId, expectedScreenId) {
      const f = frames.find(x => x.nodeId === nodeId);
      if (expectedScreenId && f?.tag !== expectedScreenId) return;
      if (f) f.tag = screenId;
    },
    async findFlipbook(_pageId, screenId) { return flipbooks.get(screenId) ?? null; },
    async listFlipbooks() { return new Map(flipbooks); },
    async flipbookSpots(pageIds) {
      const out: Record<string, FlipbookSpot> = {};
      for (const pageId of pageIds) {
        const onPage = placed.filter(p => p.pageId === pageId);
        const sections = [...new Set(onPage.map(p => p.section))];
        for (const [sectionIndex, section] of sections.entries())
          onPage.filter(p => p.section === section).forEach((p, index) => { const nodeId = flipbooks.get(p.flipbookId); if (nodeId) out[nodeId] = { pageId, section, sectionName: p.sectionName, sectionIndex, index }; });
      }
      return out;
    },
    async uiFingerprint(nodeId) {
      const screenId = [...flipbooks].find(([, id]) => id === nodeId)?.[0];
      return { fingerprint: sha256(`ui:${uiEdits.get(screenId ?? '') ?? 0}`), error: null };
    },
    async templateFromSelection() { return { id: 'tpl', name: 'Flipbook-Template' }; },
    async describeTemplate(id) {
      const items = TEMPLATE_ITEMS.map(d => {
        const layers = templateLayers.get(d.key) ?? [];
        return { key: d.key, layers, problem: d.required && !layers.length ? COPY.figmaTemplate007 : null };
      });
      return { id, name: 'Flipbook-Template', pageName: COPY.figmaTemplate025, linked: true, items, error: null };
    },
    async connectTemplateItem(_, key) {
      templateLayers.set(key, [{ id: `tpl:${key}`, name: COPY.uiPreview058 }]);
      log(`${COPY.uiPreview059} ${key}`);
    },
    async disconnectTemplateItem(_, key) { templateLayers.delete(key); },
    async templateItemNodes(_, key) { return (templateLayers.get(key) ?? []).map(l => l.id); },
    async createDefaultTemplate() {
      templateLayers = templateDefaults();
      log(COPY.uiPreview060);
      return { id: 'tpl', name: 'Flipbook-Template', pageId: '0:9' };
    },
    async syncFlipbook(settings, view) {
      await wait(options.syncMs ?? 0);
      // GUI는 원본에서 바로 복사한다. 원본 프레임이 없으면 실패한다.
      const missing = view.gui.find(gui => !frames.some(f => f.nodeId === gui.sourceNodeId));
      if (missing) throw new Error(`${COPY.figmaFlipbook023} ${missing.code}`);
      if (!flipbooks.has(view.flipbookId) && !view.create) throw new Error(COPY.figmaFlipbook027);
      if (!flipbooks.has(view.flipbookId)) {
        flipbooks.set(view.flipbookId, `fb:${view.flipbookId}`);
        // 정한 자리(그 플립북 바로 다음, null이면 Section 맨 앞, 없으면 맨 뒤)에 놓는다.
        const same = placed.filter(p => p.pageId === settings.pageId && p.section === view.category.key);
        const anchor = view.after ? same.findIndex(p => p.flipbookId === view.after) : -1;
        const before = view.after === null ? same[0] : anchor >= 0 ? same[anchor + 1] : undefined;
        const item = { flipbookId: view.flipbookId, pageId: settings.pageId, section: view.category.key, sectionName: view.category.name };
        if (before) placed.splice(placed.indexOf(before), 0, item);
        else if (same.length) placed.splice(placed.indexOf(same[same.length - 1]) + 1, 0, item);
        else placed.push(item);
        changed();
      }
      if (view.retitle) log(`제목 변경: ${view.name}`);
      // 화면 편집으로 GUI 영역의 화면·순서·크기가 바뀌었다.
      const gui = view.gui.map(g => `${g.code}@${g.scale ?? view.scale}`).join(', ');
      if (shownGui.has(view.flipbookId) && shownGui.get(view.flipbookId) !== gui) log(`${COPY.uiPreview055} ${gui || '-'}`);
      shownGui.set(view.flipbookId, gui);
      log(`${COPY.uiPreview025} ${view.category.name} / ${view.name} ${COPY.uiPreview026} ${view.status ? `${view.status.tag.name}(${view.status.colorKey})` : '-'} ${COPY.uiPreview027} ${view.rows[0]?.at ?? '-'} ${COPY.uiPreview028} ${Math.max(0, view.rows.length - 1)}${COPY.uiPreview029}`);
      return { nodeId: flipbooks.get(view.flipbookId)!, notes: [] };
    },
    async syncChapters(items) {
      for (const item of items) log(`${COPY.uiPreview025} ${item.name} / ${item.flipbookId}`);
    },
    // 기존 플립북 옮기기: 정한 플립북 바로 다음(null이면 Section 맨 앞, 없으면 맨 뒤)으로 옮긴다.
    async moveFlipbook(move) {
      const from = placed.findIndex(p => p.flipbookId === move.flipbookId);
      if (from < 0) return false;
      const [item] = placed.splice(from, 1);
      const moved = { ...item, pageId: move.pageId, section: move.category.key, sectionName: move.category.name };
      const same = placed.filter(p => p.pageId === move.pageId && p.section === move.category.key);
      const anchor = move.after ? same.findIndex(p => p.flipbookId === move.after) : -1;
      const before = move.after === null ? same[0] : anchor >= 0 ? same[anchor + 1] : undefined;
      if (before) placed.splice(placed.indexOf(before), 0, moved);
      else if (same.length) placed.splice(placed.indexOf(same[same.length - 1]) + 1, 0, moved);
      else placed.push(moved);
      log(`${COPY.uiPreview054} ${move.category.name} / ${move.flipbookId}`);
      changed();
      return true;
    },
    async reveal(nodeId, isLatest) {
      await wait(options.revealMs ?? 0);
      if (!isLatest()) return false;
      log(`${COPY.uiPreview030} ${frames.find(f => f.nodeId === nodeId)?.name ?? nodeId}`);
      return true;
    },
    selectionTarget: () => ({ kind: 'text', name: text.name }),
    readSelection: () => text.paragraphs.map(p => ({ ...p, bold: p.bold.map(b => ({ ...b })) })),
    async writeSelection(paragraphs) {
      text.paragraphs = paragraphs;
      changed();
      return { kind: 'text' };
    },
    async createFlow(plan) {
      const nodeId = `flow:${plan.id}`;
      flows.set(nodeId, new Map(plan.cells.map(c => [c.uid, c.version])));
      const at = new Map(plan.cells.map(c => [c.key, `${c.code}(${c.x},${c.y})`]));
      log(`${COPY.flow001}: ${plan.title} / ${[...at.values()].join(' ')} / ${plan.links.map(l => `${at.get(l.from)}.${l.fromSide}→${at.get(l.to)}.${l.toSide}`).join(' ')}`);
      return { nodeId, pageId: DEMO_FLIPBOOK_PAGE.id, notes: [] };
    },
    async updateFlow(flow, latest) {
      const versions = flows.get(flow.nodeId);
      if (!versions) return null;
      let n = 0;
      for (const t of latest) if (versions.has(t.uid) && versions.get(t.uid)! < t.version) { versions.set(t.uid, t.version); n++; }
      if (n) log(`${COPY.flow001} ${flow.title}: ${n}`);
      return n;
    },
    async flowNode(flow, uid) {
      if (!flows.has(flow.nodeId)) return null;
      return uid ? `${flow.nodeId}/${uid}` : flow.nodeId;
    },
    // GUI 붙이기: 붙인 화면·크기·자리(창 밖에 놓은 좌표, 없으면 보고 있는 화면 가운데)를 알린다. 원본 프레임이 없으면 실패한다.
    async pasteGui(item, at) {
      if (!frames.some(f => f.nodeId === item.sourceNodeId)) throw new Error(`${COPY.figmaFlipbook023} ${item.code}`);
      log(`${COPY.paste001}: ${item.code} ${item.scale === 1 ? COPY.uiApp403 : COPY.uiApp404}${at ? ` (${Math.round(at.x)}, ${Math.round(at.y)})` : ''}`);
      return { nodeId: `paste:${item.trackId}`, pageId: DEMO_FLIPBOOK_PAGE.id, flipbookId: null, notes: [] };
    },
    // 추적 목록: 붙인 화면과 플로우(셀 포함)는 플립북 페이지에 있다고 본다.
    async nodePlaces(items) {
      return items.map(({ nodeId }) => (nodeId.startsWith('paste:') || flows.has(nodeId.split('/')[0])
        ? { pageId: DEMO_FLIPBOOK_PAGE.id, pageName: DEMO_FLIPBOOK_PAGE.name, sections: [], flipbook: null } : null));
    },
    // PDF 저장: 미리보기 도구로 플립북 프레임을 모두 골랐을 때만 저장할 수 있다. 프레임마다 가짜 JPG 한 장을 만든다
    // (취소를 볼 수 있게 한 장씩 조금 기다린다).
    pdfSelection: () => ({ frames: framesPicked ? flipbooks.size : 0, others: 0 }),
    async exportPdf(progress) {
      const ids = framesPicked ? [...flipbooks.keys()] : [];
      if (!ids.length) throw new Error(COPY.pdf004);
      const pages = [];
      for (const [index, id] of ids.entries()) {
        if (!await progress(index, ids.length)) return { pageName: DEMO_FLIPBOOK_PAGE.name, pages: null };
        await wait(300);
        pages.push({ name: id, bytes: await fakeThumb(id, 'PDF'), width: 480, height: options.tallThumb ? 1600 : 270 });
      }
      log(`PDF: ${ids.length}`);
      return { pageName: DEMO_FLIPBOOK_PAGE.name, pages };
    },
  };

  return {
    host, kv, frames, flipbooks, uiEdits, text,
    listen(handler) { deliver = handler; },
    hasVersionPage: () => versionPageMade,
    pasteVersionPage() {
      if (versionPageMade) return 0;
      versionPageMade = true;
      const copies = frames.filter(x => x.pageId === DEMO_PAGE.id).map((x, i): DemoFrame => ({
        ...x, nodeId: `20:${i + 1}`, pageId: DEMO_VERSION_PAGE.id, name: `Frame ${100 + i}`, tag: null,
        content: i === 1 ? `v${Number(x.content.slice(1)) + 1}` : x.content,
      }));
      frames.push(...copies, { nodeId: '20:99', pageId: DEMO_VERSION_PAGE.id, name: 'Frame 999', content: 'v1', body: '새 화면', tag: null });
      return copies.length + 1;
    },
    editFrame(frame) { frame.content = `v${Number(frame.content.slice(1)) + 1}`; },
    pickFlipbookFrames(on) { framesPicked = on; },
    flipbookFramesPicked: () => framesPicked,
  };
}
