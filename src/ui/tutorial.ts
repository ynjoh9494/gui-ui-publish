import { COPY } from '../core/copy.ts';
// 튜토리얼(2026-10-21 사용자 요청): 머리의 도움말을 누르면 예시 화면 위에서 주요 흐름을 단계별로 설명한다.
// 예시 화면은 가짜 환경(demo.ts)에 실제 Controller·UI를 연결해 그리고 단계마다 그 화면을 조작해 다음 상태로 넘긴다.
// 실제 파일 기록·캔버스와 플러그인 창의 상태는 건드리지 않는다(창 크기만 넓혔다가 되돌린다).
// 어디를 눌러도(Enter·Space도) 다음 단계로 가고, 도움말 자리의 X와 Esc는 끝낸다. 마지막 단계에서 넘기면 끝난다.
import type { Entry } from '../core/compare.ts';
import { defaultDraft, type Draft } from '../core/drafts.ts';
import { TAG_PALETTE } from '../core/palette.ts';
import type { Plan } from '../core/publish.ts';
import { Store } from '../core/store.ts';
import type { Actor, Team } from '../core/types.ts';
import type { ToMain, ToUi } from '../core/wire.ts';
import { Controller } from '../controller.ts';
import type { Bridge } from './app.ts';
import { createDemo, DEMO_FLIPBOOK_PAGE, DEMO_PAGE, DEMO_VERSION_PAGE, type Demo } from './demo.ts';

export interface TutorialOptions {
  mode: Team;
  actor: Actor;
  // 실제 플러그인 창의 루트. 예시 화면과 오버레이를 이 자리에 겹친다.
  root: HTMLElement;
  // 실제 플러그인 창 크기를 바꾼다(다음 실행 크기로 기억하지 않는다).
  resize(width: number, height: number, compact: boolean): void;
  startApp(bridge: Bridge, root: HTMLElement): void;
}

// 예시 화면에 필요한 창 크기. 새 플립북·새 버전 페이지가 넓히는 크기와 같다.
const MIN_WIDTH = 960, MIN_HEIGHT = 800;
// 밝게 남길 영역의 여백, 말풍선과 창 가장자리, 꼬리 끝과 영역 사이 간격
const PAD = 4, EDGE = 8, GAP = 4;
// 꼬리 크기와 말풍선 모서리에서 꼬리까지의 거리. styles.css의 .tutorial-bubble::before와 같은 값이다.
const TAIL = { width: 14, height: 7, inset: 14 };

type Spot = Element | (Element | null | undefined)[] | null | undefined;
interface Step {
  title: string;
  body: string;
  // 이 단계를 보여 주기 전에 예시 화면을 조작한다.
  prepare?(d: Driver): Promise<void>;
  // 밝게 남길 영역. 배열은 한 영역으로 합치며 말풍선은 첫 영역을 가리킨다.
  spots(d: Driver): Spot[];
}

interface Rect { left: number; top: number; right: number; bottom: number }

// 예시 화면 조작. 목록은 다음 프레임에 그리고 본체 응답은 비동기로 오므로 원하는 상태가 될 때까지 기다린다.
class Driver {
  readonly app: HTMLElement;
  readonly alive: () => boolean;
  constructor(app: HTMLElement, alive: () => boolean) { this.app = app; this.alive = alive; }
  q<T extends HTMLElement = HTMLElement>(selector: string): T | null { return this.app.querySelector<T>(selector); }
  all(selector: string): HTMLElement[] { return [...this.app.querySelectorAll<HTMLElement>(selector)]; }
  async until<T>(get: () => T | null | undefined | false, timeout = 6000): Promise<T> {
    const end = Date.now() + timeout;
    for (;;) {
      if (!this.alive()) throw new Error('closed');
      const value = get();
      if (value) return value;
      if (Date.now() > end) throw new Error(`timeout: ${get}`);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  }
  // 처리 중에는 예시 화면이 대부분의 조작을 무시하므로 끝날 때까지 기다린다.
  async click(target: string | (() => HTMLElement | null | undefined)): Promise<void> {
    const get = typeof target === 'string' ? () => this.q(target) : target;
    (await this.until(() => { const el = get(); return !this.app.classList.contains('is-busy') && el?.matches(':not(:disabled)') && el; })).click();
  }
  // 목록 행: 화면·플립북 이름으로 찾는다.
  row(name: string): HTMLElement | undefined { return this.all('.list .row').find(r => r.querySelector('.name')?.textContent === name); }
  // 값을 바꾸고 입력 이벤트를 보낸다.
  set(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string, event: 'change' | 'input') {
    el.value = value;
    el.dispatchEvent(new Event(event, { bubbles: true }));
  }
  // 접힌 목록 그룹을 모두 펼친다.
  async expandGroups(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      const head = this.q('.list .group-head[aria-expanded="false"]');
      if (!head) return;
      head.click();
      await this.until(() => !head.isConnected || head.getAttribute('aria-expanded') === 'true');
    }
  }
}

// ── 단계 ──────────────────────────────────────────────

const section = (d: Driver, from: number, to?: number) => d.all('.detail .section-body > *').slice(from, to);
const scrollTop = (el: Element | null) => { if (el) el.scrollTop = 0; };

const GUI_STEPS: Step[] = [
  {
    title: COPY.uiTutorial004, body: COPY.uiTutorial005,
    async prepare(d) { await d.until(() => d.q('.toolbar [data-action="scan"]') && !d.app.classList.contains('is-busy')); },
    spots: d => [d.q('.tabs [data-action="settings"]')],
  },
  {
    title: COPY.uiTutorial006, body: COPY.uiTutorial007,
    async prepare(d) { await d.click('.tabs [data-action="settings"]'); await d.until(() => d.q('details[data-form="scope"]')); },
    spots: d => [d.q('details[data-form="scope"]')],
  },
  {
    title: COPY.uiTutorial008, body: COPY.uiTutorial009,
    async prepare(d) { await d.click('.tabs [data-action="settings"]'); await d.until(() => d.q('.toolbar [data-action="scan"]')); },
    spots: d => [[d.q('.toolbar [data-action="scan"]'), d.q('.toolbar [data-action="scan-selected"]')]],
  },
  {
    title: COPY.uiTutorial010, body: COPY.uiTutorial011,
    async prepare(d) {
      await d.click('.toolbar [data-action="scan"]');
      await d.until(() => d.q('.toolbar .progress')?.textContent?.includes(COPY.uiApp014) && d.q('.list .group'));
      await d.expandGroups();
    },
    spots: d => [d.all('.list .group')],
  },
  {
    title: COPY.uiTutorial012, body: COPY.uiTutorial013,
    spots: d => [d.q('.list .list-filters')],
  },
  {
    title: COPY.uiTutorial014, body: COPY.uiTutorial015,
    async prepare(d) {
      await d.click(() => d.row(COPY.uiPreview009));
      await d.click('.detail [data-action="include-selected"]');
      await d.until(() => d.q('.detail input[name="disposition"][value="new"]:checked'));
    },
    spots: d => [d.q('.detail .detail-section')],
  },
  {
    title: COPY.uiTutorial016, body: COPY.uiTutorial017,
    async prepare(d) {
      const select = await d.until(() => d.q<HTMLSelectElement>('.detail [data-field="categoryId"]'));
      const option = [...select.options].find(o => o.textContent === COPY.uiTutorial063);
      if (option) d.set(select, option.value, 'change');
      await d.until(() => d.q<HTMLInputElement>('.detail [data-field="code"]')?.value);
    },
    spots: d => [section(d, 0, -2)],
  },
  {
    title: COPY.uiTutorial018, body: COPY.uiTutorial019,
    spots: d => [section(d, -2)],
  },
  {
    title: COPY.uiTutorial020, body: COPY.uiTutorial021,
    async prepare(d) { d.set(await d.until(() => d.q<HTMLTextAreaElement>('.footer [data-input="comment"]')), COPY.uiTutorial069, 'input'); },
    spots: d => [d.q('.footer .batch-comment')],
  },
  {
    title: COPY.uiTutorial022, body: COPY.uiTutorial023,
    spots: d => [d.q('.footer .footer-line')],
  },
  {
    title: COPY.uiTutorial024, body: COPY.uiTutorial025,
    async prepare(d) { await d.click('.footer [data-action="prepare"]'); await d.until(() => d.q('.overlay:not([hidden]) .dialog')); },
    spots: d => [d.q('.overlay .dialog')],
  },
  {
    title: COPY.uiTutorial026, body: COPY.uiTutorial027,
    async prepare(d) {
      await d.click('.overlay [data-action="cancel-plan"]');
      await d.until(() => d.q('.overlay[hidden]'));
      await d.click(() => d.row(COPY.uiPreview005));
      await d.until(() => d.q('.detail .ignore-row'));
    },
    spots: d => [d.row(COPY.uiPreview005), d.q('.detail .ignore-row')],
  },
  {
    title: COPY.uiTutorial028, body: COPY.uiTutorial029,
    async prepare(d) {
      await d.until(() => {
        const details = d.q<HTMLDetailsElement>('.detail details.prev-thumb');
        if (details && !details.open) details.open = true;
        return d.q('.detail details.prev-thumb[open] img') && d.q('.detail .history table');
      });
    },
    spots: d => [[d.q('.detail details.prev-thumb'), d.q('.detail .history')]],
  },
  {
    title: COPY.uiTutorial030, body: COPY.uiTutorial031,
    async prepare(d) {
      await d.click('.tabs [data-action="version-open"]');
      const page = await d.until(() => d.q<HTMLSelectElement>('.version-view [data-input="version-page"]'));
      if (page.value !== DEMO_VERSION_PAGE.id) d.set(page, DEMO_VERSION_PAGE.id, 'change');
      await d.click('.version-view [data-action="version-match"]');
      await d.until(() => d.q('.version-workspace .version-row'));
    },
    spots: d => [d.q('.version-page-line'), d.q('.tabs [data-action="version-open"]')],
  },
];

const UI_STEPS: Step[] = [
  {
    title: COPY.uiTutorial032, body: COPY.uiTutorial033,
    async prepare(d) { await d.until(() => d.q('.list .group') && !d.app.classList.contains('is-busy')); },
    spots: d => [d.q('.tabs [data-action="settings"]')],
  },
  {
    title: COPY.uiTutorial034, body: COPY.uiTutorial035,
    async prepare(d) { await d.click('.tabs [data-action="settings"]'); await d.until(() => d.q('details[data-form="flipbook"][open]')); },
    spots: d => [d.q('details[data-form="flipbook"]')],
  },
  {
    title: COPY.uiTutorial036, body: COPY.uiTutorial037,
    // 설정을 연 뒤 받은 페이지 목록으로 설정을 다시 그리면 펼친 항목이 돌아갈 수 있어 펼쳐질 때까지 다시 연다.
    async prepare(d) {
      await d.until(() => {
        const size = d.q<HTMLDetailsElement>('details[data-form="gui-width"]');
        if (size && !size.open) size.open = true;
        return size?.open && !d.q('details[data-form="flipbook"][open]');
      });
    },
    spots: d => [d.q('details[data-form="gui-width"]')],
  },
  {
    title: COPY.uiTutorial038, body: COPY.uiTutorial039,
    // 고른 플립북 다음 자리에 들어가도록 플립북 하나를 골라 둔다.
    async prepare(d) {
      await d.click('.tabs [data-action="settings"]');
      await d.until(() => d.q('.list [data-action="new-add"]:not(:disabled)'));
      await d.expandGroups();
      await d.click(() => d.row(COPY.uiPreview007));
      await d.until(() => d.q('.detail .fb-top'));
    },
    spots: d => [d.q('.list [data-action="new-add"]')],
  },
  {
    title: COPY.uiTutorial040, body: COPY.uiTutorial041,
    async prepare(d) { await d.click('.list [data-action="new-add"]'); await d.until(() => d.q('.list .new-row') && d.q('.detail .new-place')); },
    spots: d => [d.q('.list .new-row')],
  },
  {
    title: COPY.uiTutorial042, body: COPY.uiTutorial043,
    spots: d => [[d.q('.detail .title-head'), d.q('.detail .new-place')]],
  },
  {
    title: COPY.uiTutorial044, body: COPY.uiTutorial045,
    async prepare(d) {
      // 검색 결과는 플립북 없는 화면 일괄 만들기의 대상으로 남겨 둔다.
      for (const name of [COPY.uiPreview007, COPY.uiPreview008]) {
        await d.click(() => d.all('.create-screen-list .create-screen-option').find(o => o.querySelector('.name')?.textContent === name)?.querySelector<HTMLInputElement>('[data-action="create-screen-toggle"]'));
        await d.until(() => d.all('.create-selected-list .create-screen-option').some(o => o.querySelector('.name')?.textContent === name));
      }
      scrollTop(d.q('.create-screen-list'));
    },
    spots: d => [d.q('.detail .create-selected-box')],
  },
  {
    title: COPY.uiTutorial046, body: COPY.uiTutorial047,
    spots: d => [d.q('.detail .create-available-box')],
  },
  {
    title: COPY.uiTutorial048, body: COPY.uiTutorial049,
    spots: d => [d.q('.footer .footer-line')],
  },
  {
    title: COPY.uiTutorial050, body: COPY.uiTutorial051,
    async prepare(d) { await d.click('.list [data-action="bulk-open"]'); await d.until(() => d.q('.bulk-overlay:not([hidden]) .bulk-dialog .create-screen-option')); },
    spots: d => [d.q('.bulk-overlay .bulk-dialog')],
  },
  {
    title: COPY.uiTutorial052, body: COPY.uiTutorial053,
    async prepare(d) {
      await d.click('.bulk-overlay [data-action="bulk-close"]');
      await d.click('.list .new-row [data-action="new-remove"]');
      await d.until(() => !d.q('.list .new-row') && d.q('.bulk-overlay[hidden]'));
      await d.expandGroups();
      scrollTop(d.q('.list .list-box'));
    },
    spots: d => [d.all('.list .group')],
  },
  {
    title: COPY.uiTutorial054, body: COPY.uiTutorial055,
    spots: d => [d.q('.list .list-filters')],
  },
  {
    title: COPY.uiTutorial056, body: COPY.uiTutorial057,
    async prepare(d) {
      await d.click(() => d.all('.list .row').find(r => r.querySelector('.review-dot')));
      await d.until(() => d.q('.detail .fb-top .thumbs img') && d.q('.detail .fb-top .history table'));
    },
    spots: d => [d.q('.detail .fb-top')],
  },
  {
    title: COPY.uiTutorial058, body: COPY.uiTutorial059,
    spots: d => [d.q('.detail .fb-bottom')],
  },
  {
    title: COPY.uiTutorial070, body: COPY.uiTutorial071,
    async prepare(d) {
      await d.click('.tabs [data-action="text-open"]');
      await d.click('.text-view [data-action="text-import"]');
      await d.until(() => d.q('.text-view .rich-editor')?.textContent);
    },
    spots: d => [d.q('.tabs .create-tabs'), d.q('.text-view')],
  },
];

// ── 예시 데이터 ──────────────────────────────────────────

// 예시 화면의 첫 상태: 화면 일부를 배포해 둔다. GUI는 배포한 화면 하나를 고쳐 변경 감지로 두고 새 버전 페이지를 붙여 넣는다.
// UI는 플립북을 만든 뒤 화면 하나를 고쳐 다시 배포해 확인이 필요한 플립북을 만든다.
// 화면을 실제로 다루는 것처럼 본체 메시지로 기록을 쌓으므로 저장 형식이 바뀌어도 예시가 따라간다.
async function seed(demo: Demo, mode: Team, alive: () => boolean): Promise<void> {
  const controller = new Controller(demo.host);
  const store = new Store(demo.kv);
  let inbox: ToUi[] = [];
  demo.listen(message => inbox.push(message));
  const call = async (message: ToMain): Promise<ToUi[]> => {
    // 준비 중에 끝내면 남은 기록을 쌓지 않는다.
    if (!alive()) throw new Error('closed');
    inbox = [];
    await controller.handle(message);
    const error = inbox.find(m => m.type === 'error');
    if (error?.type === 'error') throw new Error(error.message);
    return inbox;
  };
  const state = () => { store.reload(); return store.state; };
  const categoryId = (name: string) => [...state().categories.values()].find(c => c.name === name && c.active)!.id;
  const screenId = (name: string) => [...state().screens.values()].find(s => s.name === name && s.status === 'active')!.id;
  const frame = (name: string) => demo.frames.find(f => f.name === name)!;

  await call({ type: 'ready' });
  await call({ type: 'admin', action: { op: 'setScope', pageIds: [DEMO_PAGE.id] } });
  await call({ type: 'admin', action: { op: 'setFlipbookPages', pageIds: [DEMO_FLIPBOOK_PAGE.id] } });
  await call({ type: 'admin', action: { op: 'setTemplateFromSelection' } });
  const categories: [string, string][] = [[COPY.uiTutorial060, 'HO'], [COPY.uiTutorial061, 'DE'], [COPY.uiTutorial062, 'LI'], [COPY.uiTutorial063, 'SE']];
  for (const [name, code] of categories) {
    await call({ type: 'admin', action: { op: 'addCategory', name } });
    await call({ type: 'admin', action: { op: 'setCategoryCode', id: categoryId(name), code } });
  }
  await call({ type: 'admin', action: { op: 'setScreenIdPrefix', prefix: 'STB' } });
  await call({ type: 'admin', action: { op: 'addWorker', name: COPY.uiTutorial064, alias: '' } });
  await call({ type: 'admin', action: { op: 'addTag', team: 'GUI', name: COPY.uiTutorial065, colorKey: TAG_PALETTE[0].key } });

  type Item = { name: string; category?: string; code?: string; base?: string; tag?: string };
  const publish = async (items: Item[], description: string) => {
    const scanned = await call({ type: 'scan' });
    const entries = scanned.flatMap(m => m.type === 'entries' ? [m.entries] : []).pop() ?? [];
    const s = state();
    const drafts: Record<string, Draft> = {};
    for (const item of items) {
      const entry = entries.find((e: Entry) => e.frame?.name === item.name)!;
      const draft = defaultDraft('GUI', s, entry);
      draft.included = true;
      if (item.category) { draft.name = item.name; draft.code = item.code; draft.categoryId = categoryId(item.category); }
      if (item.base) { draft.relation = 'case'; draft.baseScreenId = screenId(item.base); }
      if (item.tag) draft.tagId = [...s.tags.values()].find(t => t.team === 'GUI' && t.name === item.tag)!.id;
      drafts[entry.key] = draft;
    }
    const plan = (await call({ type: 'prepare', team: 'GUI', drafts, comment: { description, extra: {} } }))
      .flatMap(m => m.type === 'plan' ? [m.plan] : [])[0] as Plan;
    if (plan.blockers.length) throw new Error(plan.blockers.map(b => `${b.name}: ${b.messages.join(', ')}`).join(' / '));
    await call({ type: 'commit', batchId: plan.batchId });
  };

  const [HOME, PROFILE, VOD, SEASON, EPG, CHANNEL, SEARCH] = [COPY.uiPreview002, COPY.uiPreview003, COPY.uiPreview005, COPY.uiPreview006, COPY.uiPreview007, COPY.uiPreview008, COPY.uiPreview009];
  await publish([
    { name: HOME, category: COPY.uiTutorial060, code: 'STB_HO_001' },
    { name: VOD, category: COPY.uiTutorial061, code: 'STB_DE_001' },
    { name: EPG, category: COPY.uiTutorial062, code: 'STB_LI_001' },
    ...mode === 'UI' ? [
      { name: CHANNEL, category: COPY.uiTutorial062, code: 'STB_LI_002' },
      { name: SEARCH, category: COPY.uiTutorial063, code: 'STB_SE_001' },
    ] : [],
  ], COPY.uiTutorial066);
  await publish([
    { name: PROFILE, category: COPY.uiTutorial060, code: 'STB_HO_002', base: HOME },
    { name: SEASON, category: COPY.uiTutorial061, code: 'STB_DE_002', base: VOD },
  ], COPY.uiTutorial067);

  if (mode === 'GUI') {
    demo.editFrame(frame(VOD));
    demo.pasteVersionPage();
    return;
  }
  const row = (names: string[]) => ({ uids: names.map(screenId), multi: names.length > 1, scale: 1 as const });
  await call({ type: 'createFlipbooks', request: { pageId: DEMO_FLIPBOOK_PAGE.id, rows: [row([HOME, PROFILE]), row([VOD]), row([SEASON]), row([EPG])] } });
  demo.editFrame(frame(VOD));
  await publish([{ name: VOD, tag: COPY.uiTutorial065 }], COPY.uiTutorial068);
}

// ── 화면 ──────────────────────────────────────────────

const HELP_CLOSE_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';

function roundRect(r: Rect, radius: number): string {
  const w = r.right - r.left, h = r.bottom - r.top, k = Math.min(radius, w / 2, h / 2);
  return `M${r.left + k} ${r.top}H${r.right - k}A${k} ${k} 0 0 1 ${r.right} ${r.top + k}V${r.bottom - k}A${k} ${k} 0 0 1 ${r.right - k} ${r.bottom}H${r.left + k}A${k} ${k} 0 0 1 ${r.left} ${r.bottom - k}V${r.top + k}A${k} ${k} 0 0 1 ${r.left + k} ${r.top}Z`;
}

// 겹치는 영역은 하나로 합친다(구멍을 짝홀 규칙으로 뚫으므로 겹치면 다시 어두워진다).
function merge(rects: Rect[]): Rect[] {
  const out = [...rects];
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
    const a = out[i], b = out[j];
    if (a.left > b.right || b.left > a.right || a.top > b.bottom || b.top > a.bottom) continue;
    out[i] = { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) };
    out.splice(j, 1);
    return merge(out);
  }
  return out;
}

// 말풍선 자리: 기본은 영역 아래에 왼쪽 위 꼬리. 오른쪽이 모자라면 오른쪽 위 꼬리, 아래가 모자라면 영역 위에 왼쪽·오른쪽 아래 꼬리를 쓴다.
// 꼬리 끝은 영역의 왼쪽(오른쪽) 끝에서 조금 안쪽을 가리킨다.
function placeBubble(anchor: Rect, w: number, h: number, W: number, H: number): { left: number; top: number; tail: string; tailX: number } {
  const reach = Math.min((anchor.right - anchor.left) / 2, 24);
  const tipLeft = anchor.left + reach, tipRight = anchor.right - reach;
  const fromTip = TAIL.inset + TAIL.width / 2;
  const leftX = tipLeft - fromTip, rightX = tipRight + fromTip - w;
  const below = anchor.bottom + GAP + TAIL.height, above = anchor.top - GAP - TAIL.height - h;
  const fitsBelow = below + h <= H - EDGE, fitsAbove = above >= EDGE;
  const fitsLeft = leftX + w <= W - EDGE, fitsRight = rightX >= EDGE;
  const vertical = fitsBelow ? 'top' : fitsAbove ? 'bottom' : H - anchor.bottom >= anchor.top ? 'top' : 'bottom';
  const side = fitsLeft || !fitsRight ? 'left' : 'right';
  const left = Math.max(EDGE, Math.min(side === 'left' ? leftX : rightX, W - EDGE - w));
  const top = Math.max(EDGE, Math.min(vertical === 'top' ? below : above, H - EDGE - h));
  const tip = side === 'left' ? tipLeft : tipRight;
  const tailX = Math.max(10, Math.min(tip - left - TAIL.width / 2, w - 10 - TAIL.width));
  return { left, top, tail: `${vertical}-${side}`, tailX };
}

export function startTutorial(options: TutorialOptions): void {
  const { root, mode } = options;
  const steps = mode === 'UI' ? UI_STEPS : GUI_STEPS;
  let closed = false;
  // shown: 보여 주는 단계. 다음 단계를 준비하는 동안에는 앞 단계 그림을 그대로 둔다.
  let shown = -1;
  let preparing = false;

  const container = document.createElement('div');
  container.className = 'tutorial';
  const app = document.createElement('div');
  app.className = 'tutorial-app';
  const layer = document.createElement('div');
  layer.className = 'tutorial-layer';
  layer.tabIndex = -1;
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-label', COPY.uiTutorial003);
  layer.innerHTML = `<svg class="tutorial-dim" aria-hidden="true"><path fill-rule="evenodd"/></svg>
    <div class="tutorial-bubble" hidden aria-live="polite"><span class="tutorial-progress"></span><strong></strong><p></p></div>
    <button class="tutorial-close" aria-label="${COPY.uiTutorial002}">${HELP_CLOSE_ICON}</button>`;
  container.append(app, layer);
  document.body.append(container);
  const dim = layer.querySelector<SVGSVGElement>('.tutorial-dim')!;
  const bubble = layer.querySelector<HTMLElement>('.tutorial-bubble')!;
  const close = layer.querySelector<HTMLElement>('.tutorial-close')!;
  const driver = new Driver(app, () => !closed);

  // 실제 창은 가려 두고 포커스·클릭을 받지 않게 한다.
  const before = { width: root.offsetWidth, height: root.offsetHeight };
  const widened = before.width < MIN_WIDTH || before.height < MIN_HEIGHT;
  root.inert = true;
  if (widened) options.resize(Math.max(before.width, MIN_WIDTH), Math.max(before.height, MIN_HEIGHT), false);

  const demo = createDemo({ mode, actor: options.actor });

  // 실제 창의 테두리 안쪽에 맞춘다.
  function follow() {
    const r = root.getBoundingClientRect();
    Object.assign(container.style, { left: `${r.left + root.clientLeft}px`, top: `${r.top + root.clientTop}px`, width: `${root.clientWidth}px`, height: `${root.clientHeight}px` });
    schedule();
  }

  // 스크롤 영역 밖으로 나간 부분은 보이지 않으므로 스크롤 영역에 맞춰 자른다.
  function visibleRect(el: Element): Rect {
    const r = el.getBoundingClientRect();
    let out: Rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (let node = el.parentElement; node && node !== app; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const c = node.getBoundingClientRect();
      out = { left: Math.max(out.left, c.left), top: Math.max(out.top, c.top), right: Math.min(out.right, c.right), bottom: Math.min(out.bottom, c.bottom) };
    }
    return out;
  }

  function rectOf(spot: Spot, base: DOMRect): Rect | null {
    const els = (Array.isArray(spot) ? spot : [spot]).filter((el): el is Element => !!el && el.isConnected);
    const rects = els.map(visibleRect).filter(r => r.right > r.left && r.bottom > r.top);
    if (!rects.length) return null;
    const W = base.width, H = base.height;
    const r = {
      left: Math.max(0, Math.min(...rects.map(x => x.left)) - base.left - PAD),
      top: Math.max(0, Math.min(...rects.map(x => x.top)) - base.top - PAD),
      right: Math.min(W, Math.max(...rects.map(x => x.right)) - base.left + PAD),
      bottom: Math.min(H, Math.max(...rects.map(x => x.bottom)) - base.top + PAD),
    };
    return r.right > r.left && r.bottom > r.top ? r : null;
  }

  function paint() {
    const base = container.getBoundingClientRect();
    const W = base.width, H = base.height;
    // 도움말 버튼 자리에 X를 놓는다. 예시 화면이 그려지기 전에는 실제 창의 도움말 버튼 자리를 쓴다.
    const help = (app.querySelector('.tabs [data-action="tutorial"]') ?? root.querySelector('.tabs [data-action="tutorial"]'))?.getBoundingClientRect();
    if (help) Object.assign(close.style, { left: `${help.left - base.left + help.width / 2}px`, top: `${help.top - base.top + help.height / 2}px` });
    dim.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const step = steps[shown];
    const spots = step ? step.spots(driver) : [];
    const anchor = spots.length ? rectOf(spots[0], base) : null;
    const holes = merge(spots.map(s => rectOf(s, base)).filter((r): r is Rect => !!r));
    dim.querySelector('path')!.setAttribute('d', `M0 0H${W}V${H}H0Z${holes.map(r => roundRect(r, 6)).join('')}`);
    layer.dataset.step = String(shown + 1);
    // 확인용: 찾지 못한 영역 수
    layer.dataset.missing = String(spots.filter(s => !rectOf(s, base)).length);
    if (!step) { bubble.hidden = true; return; }
    bubble.hidden = false;
    bubble.querySelector('.tutorial-progress')!.textContent = `${shown + 1}/${steps.length}`;
    bubble.querySelector('strong')!.textContent = step.title;
    bubble.querySelector('p')!.textContent = step.body;
    const w = bubble.offsetWidth, h = bubble.offsetHeight;
    // 영역을 찾지 못하면 가운데에 꼬리 없이 둔다.
    if (!anchor) {
      Object.assign(bubble.style, { left: `${(W - w) / 2}px`, top: `${(H - h) / 2}px` });
      bubble.dataset.tail = '';
      return;
    }
    const at = placeBubble(anchor, w, h, W, H);
    Object.assign(bubble.style, { left: `${at.left}px`, top: `${at.top}px` });
    bubble.style.setProperty('--tail-x', `${at.tailX}px`);
    bubble.dataset.tail = at.tail;
  }

  // 예시 화면은 응답·썸네일이 늦게 와서 다시 그려지므로 바뀔 때마다 영역을 다시 잰다.
  let frame = 0;
  function schedule() {
    if (frame || closed) return;
    frame = requestAnimationFrame(() => { frame = 0; if (!preparing && !closed) paint(); });
  }
  const mutations = new MutationObserver(schedule);
  mutations.observe(app, { subtree: true, childList: true, attributes: true, characterData: true });
  const resized = new ResizeObserver(follow);
  resized.observe(root);
  app.addEventListener('load', schedule, true);
  window.addEventListener('resize', follow);
  window.addEventListener('scroll', follow, true);

  async function go(index: number) {
    if (preparing || closed) return;
    if (index >= steps.length) { exit(); return; }
    preparing = true;
    try { await steps[index].prepare?.(driver); }
    catch (error) { if (!closed) console.warn('tutorial', index + 1, error); }
    if (closed) return;
    // 예시 화면이 포커스를 가져가면 키 입력이 그 입력란으로 가므로 오버레이로 되돌린다.
    (document.activeElement as HTMLElement | null)?.blur?.();
    layer.focus({ preventScroll: true });
    shown = index;
    preparing = false;
    // 말풍선이 가리킬 영역이 스크롤 밖이면 끝부터 처음 순서로 보이게 해 영역 전체가 보이게 한다.
    const first = steps[index].spots(driver)[0];
    for (const el of (Array.isArray(first) ? first : [first]).reverse()) el?.scrollIntoView({ block: 'nearest' });
    paint();
  }

  function onKey(ev: KeyboardEvent) {
    // 예시 화면과 실제 창은 키를 받지 않는다.
    ev.stopPropagation();
    if (ev.key === 'Escape') { ev.preventDefault(); exit(); return; }
    if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Tab') {
      ev.preventDefault();
      if (ev.key !== 'Tab' && !ev.repeat) void go(shown + 1);
    }
  }
  window.addEventListener('keydown', onKey, true);
  layer.addEventListener('mousedown', ev => ev.preventDefault());
  layer.addEventListener('click', ev => {
    if ((ev.target as Element).closest('.tutorial-close')) exit();
    else void go(shown + 1);
  });

  function exit() {
    if (closed) return;
    closed = true;
    if (frame) cancelAnimationFrame(frame);
    mutations.disconnect();
    resized.disconnect();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', follow);
    window.removeEventListener('scroll', follow, true);
    demo.listen(() => {});
    container.remove();
    root.inert = false;
    if (widened) options.resize(before.width, before.height, root.classList.contains('detail-collapsed'));
    root.querySelector<HTMLElement>('.tabs [data-action="tutorial"]')?.focus();
  }

  follow();
  // 예시 화면을 준비하는 동안에도 어둡게 덮고 X로 끝낼 수 있게 한다.
  paint();
  layer.focus({ preventScroll: true });
  void (async () => {
    preparing = true;
    try { await seed(demo, mode, () => !closed); }
    catch (error) { if (!closed) console.warn('tutorial seed', error); }
    if (closed) return;
    const controller = new Controller(demo.host);
    options.startApp({
      send: message => { void controller.handle(message); },
      listen: handler => demo.listen(message => setTimeout(() => { if (!closed) handler(message); }, 0)),
    }, app);
    preparing = false;
    await go(0);
  })();
}
