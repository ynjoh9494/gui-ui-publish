import type {
  Actor, AuditEntry, Batch, Category, DataStatus, Delivery, Exclusion, Flipbook, FlipbookReview, FlowRecord, GuiRecord, ImportedGuiRecord, ProjectConfig, Screen, TagDef, UiBaseline, UiRecord, UiState, Worker,
} from './types.ts';

// figma.root의 sharedPluginData 한 네임스페이스에 대응한다. 없는 키는 ''를 반환하고 ''를 쓰면 삭제된다.
export interface KV {
  get(key: string): string;
  set(key: string, value: string): void;
  keys(): string[];
}

// 엔티티마다 키를 나눠 서로 다른 화면의 동시 Publish가 같은 키를 덮어쓰지 않게 한다.
// GUI는 화면(scr·gv), UI는 플립북(fb·fgv·sui·uv·uib·rv)을 쓴다.
export const keys = {
  project: 'project',
  category: (id: string) => `cat:${id}`,
  worker: (id: string) => `wrk:${id}`,
  tag: (id: string) => `tag:${id}`,
  screen: (id: string) => `scr:${id}`,
  gui: (screenId: string, version: number) => `gv:${screenId}:${version}`,
  flipbook: (id: string) => `fb:${id}`,
  imported: (flipbookId: string, uid: string, version: number) => `fgv:${flipbookId}:${uid}:${version}`,
  uiState: (flipbookId: string) => `sui:${flipbookId}`,
  uiBaseline: (flipbookId: string) => `uib:${flipbookId}`,
  ui: (flipbookId: string, version: number) => `uv:${flipbookId}:${version}`,
  review: (flipbookId: string) => `rv:${flipbookId}`,
  batch: (id: string) => `bat:${id}`,
  delivery: (batchId: string, targetId: string) => `dlv:${batchId}:${targetId}`,
  exclusion: (id: string) => `exc:${id}`,
  flow: (id: string) => `flw:${id}`,
  audit: (id: string) => `aud:${id}`,
  dataStatus: 'data',
  // 화면의 변경 근거(core/changeDigest.ts). 비교 기준 하나만 덮어쓰며 State에 넣지 않는다.
  digest: (screenId: string) => `${DIGEST_PREFIX}${screenId}`,
};
export const DIGEST_PREFIX = 'fpd:';

export interface State {
  project: ProjectConfig;
  categories: Map<string, Category>;
  workers: Map<string, Worker>;
  tags: Map<string, TagDef>;
  screens: Map<string, Screen>;
  gui: Map<string, GuiRecord[]>;
  flipbooks: Map<string, Flipbook>;
  // 플립북 ID → 쌓은 GUI 이력 사본(화면·버전 순)
  imported: Map<string, ImportedGuiRecord[]>;
  uiStates: Map<string, UiState>;
  uiBaselines: Map<string, UiBaseline>;
  ui: Map<string, UiRecord[]>;
  // 플립북 ID → 마지막 확인 완료
  reviews: Map<string, FlipbookReview>;
  batches: Map<string, Batch>;
  deliveries: Map<string, Delivery>;
  exclusions: Map<string, Exclusion>;
  flows: Map<string, FlowRecord>;
  audit: AuditEntry[];
  dataStatus: DataStatus | null;
}

export const DEFAULT_PROJECT: ProjectConfig = {
  schema: 1, scopePageIds: [], scopeSectionIds: [], flipbookPageIds: [], flipbookPageId: null, templateNodeId: null, templateName: null,
  policyTemplateNodeId: null, policyTemplateName: null, dataPageId: null, utcOffsetMinutes: 540, guiWidth: 1920,
  screenIdPrefix: '',
};

export interface LoadIssue { key: string; message: string }

function emptyState(): State {
  return {
    project: { ...DEFAULT_PROJECT }, categories: new Map(), workers: new Map(), tags: new Map(), screens: new Map(), gui: new Map(),
    flipbooks: new Map(), imported: new Map(), uiStates: new Map(), uiBaselines: new Map(), ui: new Map(), reviews: new Map(),
    batches: new Map(), deliveries: new Map(), exclusions: new Map(), flows: new Map(), audit: [], dataStatus: null,
  };
}

function pushSorted<T>(map: Map<string, T[]>, id: string, record: T, order: (r: T) => [string, number]) {
  const list = map.get(id) ?? [];
  const [group, version] = order(record);
  const before = (r: T) => { const [g, v] = order(r); return g < group || (g === group && v < version); };
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (before(list[mid])) lo = mid + 1;
    else hi = mid;
  }
  const at = lo;
  const same = at < list.length && order(list[at])[0] === group && order(list[at])[1] === version;
  if (same) list[at] = record;
  else list.splice(at, 0, record);
  map.set(id, list);
}

const byVersion = (r: { version: number }): [string, number] => ['', r.version];
const byScreenVersion = (r: ImportedGuiRecord): [string, number] => [r.uid, r.version];

// 키 하나를 상태에 반영한다. 알 수 없는 키는 무시하고, 파싱 실패는 진단 목록으로 돌려준다.
function apply(state: State, key: string, raw: string): void {
  const value = JSON.parse(raw);
  const [kind] = key.split(':', 1);
  switch (kind) {
    case 'project': state.project = {
      ...DEFAULT_PROJECT, ...value,
      // 이전 버전의 단일 UI 페이지 설정을 처음 읽을 때 다중 페이지 설정으로 가져온다.
      flipbookPageIds: Array.isArray(value.flipbookPageIds) ? value.flipbookPageIds : value.flipbookPageId ? [value.flipbookPageId] : [],
    }; break;
    case 'cat': state.categories.set(value.id, value); break;
    case 'wrk': state.workers.set(value.id, value); break;
    case 'tag': state.tags.set(value.id, value); break;
    case 'scr': state.screens.set(value.id, value); break;
    case 'gv': pushSorted(state.gui, value.screenId, value, byVersion); break;
    case 'fb': state.flipbooks.set(value.id, value); break;
    case 'fgv': pushSorted(state.imported, value.flipbookId, value, byScreenVersion); break;
    case 'sui': state.uiStates.set(value.flipbookId, value); break;
    case 'uib': state.uiBaselines.set(value.flipbookId, value); break;
    case 'uv': pushSorted(state.ui, value.flipbookId, value, byVersion); break;
    case 'rv': state.reviews.set(value.flipbookId, value); break;
    case 'bat': state.batches.set(value.id, value); break;
    case 'dlv': state.deliveries.set(key, value); break;
    case 'exc': state.exclusions.set(value.id, value); break;
    case 'flw': state.flows.set(value.id, value); break;
    case 'aud': state.audit.push(value); break;
    case 'data': state.dataStatus = value; break;
  }
}

export class Store {
  state: State = emptyState();
  issues: LoadIssue[] = [];
  private rawCache = new Map<string, string>();
  readonly kv: KV;
  readonly now: () => number;
  readonly newId: () => string;

  constructor(kv: KV, now: () => number = Date.now, newId: () => string = randomId) {
    this.kv = kv;
    this.now = now;
    this.newId = newId;
    this.reload();
  }

  reload(): void {
    const raws = new Map<string, string>();
    let changed = false;
    for (const key of this.kv.keys()) {
      // 변경 근거는 변경 감지된 화면을 설명할 때만 읽는다. 자주 부르는 reload에서 화면 수만큼 읽지 않는다.
      if (key.startsWith(DIGEST_PREFIX)) continue;
      const raw = this.kv.get(key);
      if (!raw) continue;
      raws.set(key, raw);
      if (this.rawCache.get(key) !== raw) changed = true;
    }
    if (!changed && raws.size === this.rawCache.size) return;
    const state = emptyState();
    const issues: LoadIssue[] = [];
    for (const [key, raw] of raws) {
      try { apply(state, key, raw); } catch (e) { issues.push({ key, message: String(e) }); }
    }
    state.audit.sort((a, b) => a.at - b.at);
    this.state = state;
    this.issues = issues;
    this.rawCache = raws;
  }

  // 다른 사용자의 기록이 멀티플레이로 들어왔을 수 있으므로 확정 직전에는 메모리 대신 KV를 다시 읽는다.
  readFresh<T>(key: string): T | null {
    const raw = this.kv.get(key);
    return raw ? JSON.parse(raw) as T : null;
  }

  put(key: string, value: unknown): void {
    const raw = JSON.stringify(value);
    this.kv.set(key, raw);
    apply(this.state, key, raw);
    this.rawCache.set(key, raw);
  }

  audit(actor: Actor, action: string, target: string, before: unknown, after: unknown, reason = ''): void {
    const entry: AuditEntry = { id: this.newId(), at: this.now(), actor, action, target, before, after, reason };
    this.put(keys.audit(entry.id), entry);
  }

  // 키를 지우고 상태를 다시 만든다. 여러 키는 한 번에 지워 상태를 한 번만 다시 만든다.
  remove(...keys: string[]): void {
    if (!keys.length) return;
    for (const key of keys) this.kv.set(key, '');
    this.reload();
  }

  saveProject(project: ProjectConfig): void { this.put(keys.project, project); }
}

export function randomId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function memoryKV(initial?: Record<string, string>): KV & { data: Map<string, string> } {
  const data = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    data,
    get: key => data.get(key) ?? '',
    set: (key, value) => { if (value) data.set(key, value); else data.delete(key); },
    keys: () => [...data.keys()],
  };
}

export function lastGui(state: State, screenId: string): GuiRecord | null {
  const list = state.gui.get(screenId);
  return list && list.length ? list[list.length - 1] : null;
}

export function lastUi(state: State, flipbookId: string): UiRecord | null {
  const list = state.ui.get(flipbookId);
  return list && list.length ? list[list.length - 1] : null;
}
