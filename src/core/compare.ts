import { COPY } from './copy.ts';
import { FINGERPRINT_VERSION, LEGACY_FINGERPRINT_VERSION } from './fingerprint.ts';
import { excludedNodeIds } from './registry.ts';
import { formatFrameName } from './screenName.ts';
import { lastGui, lastUi, type State } from './store.ts';
import type { Screen } from './types.ts';

// figma/scan.ts가 범위 안의 화면 후보 프레임마다 만드는 값
export interface ScannedFrame {
  nodeId: string;
  pageId: string;
  name: string;
  width: number;
  height: number;
  // 프레임에 기록된 화면 ID. 복제하면 함께 복사되므로 연결 판단의 단서로만 쓴다.
  screenTag: string | null;
  // null: 아직 계산 전(error 없음) 또는 계산 실패(error 있음)
  fingerprint: string | null;
  // 1 규칙 지문. 1 규칙으로 저장한 비교 기준과 비교한다.
  legacyFingerprint?: string | null;
  error: string | null;
}

// 변경 추정 결과. 목록의 보조 표시이며 포함 체크·Publish 가능 여부를 결정하지 않는다.
export type Estimate =
  | 'new'        // 신규 후보
  | 'changed'    // 변경 추정
  | 'unchanged'  // 차이 미검출 (변경 없음 보증 아님)
  | 'pending'    // 비교 전
  | 'failed'     // 비교 불가
  | 'no-baseline' // 기준 없음: 등록 화면이지만 비교할 확정 지문이 없음
  | 'stale'      // 기준 버전 불일치: 확정 지문의 정규화 버전이 현재와 다름
  | 'missing'    // 원본 없음
  | 'retired';   // 사용 종료

export { ESTIMATE_LABEL } from './copy.ts';
import { ESTIMATE_LABEL } from './copy.ts';

export interface Entry {
  // 목록·초안의 키. 등록 화면은 화면 ID, 신규 후보는 node:<노드 ID>, UI 목록은 플립북 ID
  key: string;
  screenId: string | null;
  // UI 목록(플립북)일 때만 있다.
  flipbookId?: string | null;
  frame: ScannedFrame | null;
  estimate: Estimate;
  // 배정된 카테고리가 삭제되어 새 카테고리를 지정해야 한다.
  categoryMissing: boolean;
  notes: string[];
  // 복제 의심 신규 후보의 원래 화면(안내용)
  suggestedScreenId: string | null;
  // 자동 교체 짝. 원본을 잘라내 붙이면 등록 화면은 「삭제」, 붙인 프레임은 「신규」로 나오고 서로를 가리킨다.
  // 신규 후보는 화면 ID, 삭제 화면은 신규 후보의 항목 키다.
  pairKey: string | null;
}

// UI Publish의 변경 추정은 GUI 원본이 아니라 플립북의 UI 작성 영역을 이전 UI Publish와 비교한다.
// 제목·상단 Status·GUI 이미지·이력 목록처럼 플러그인이 바꾸는 영역은 비교하지 않는다.
// 비교 범위를 바꾸면 끝 번호를 올린다.
// UI 작성 영역은 1 규칙 지문(legacyFingerprint)을 그대로 쓴다.
export const UI_FINGERPRINT_VERSION = `${LEGACY_FINGERPRINT_VERSION}/ui1`;

// 플립북 프레임의 캔버스 위치: 놓인 Section(플러그인이 만든 Section의 키, 없으면 ''), 페이지 안 Section 순서(위→아래),
// Section 안 순서(위 행부터, 행 안에서는 왼쪽부터)
// sectionName: 캔버스 Section의 지금 이름(Section 이름은 캔버스가 원본이다)
export interface FlipbookSpot { section: string; sectionName?: string; sectionIndex: number; index: number }

// 플립북별 스캔 결과. nodeId가 없으면 플립북 프레임을 찾지 못했다. spot은 목록을 캔버스 순서로 보여 줄 때 쓴다.
export interface UiScan { flipbookId: string; nodeId: string | null; fingerprint: string | null; error: string | null; spot?: FlipbookSpot | null }

export { UI_ESTIMATE_LABEL } from './copy.ts';
import { UI_ESTIMATE_LABEL } from './copy.ts';

export function uiEstimate(state: State, flipbookId: string, scan: UiScan | undefined): Estimate {
  if (state.flipbooks.get(flipbookId)?.status === 'deleted') return 'retired';
  if (!scan) return 'pending';
  if (!scan.nodeId) return 'missing';
  if (scan.error) return 'failed';
  if (scan.fingerprint === null) return 'pending';
  // 첫 UI Publish 전에는 플립북을 만든 직후의 상태가 기준이다.
  const last = lastUi(state, flipbookId);
  const base = last?.fingerprint ? last : state.uiBaselines.get(flipbookId);
  if (!base?.fingerprint) return 'no-baseline';
  if (base.fpVersion !== UI_FINGERPRINT_VERSION) return 'stale';
  return base.fingerprint === scan.fingerprint ? 'unchanged' : 'changed';
}

// UI 목록: 플립북마다 한 항목. 변경 추정은 플립북 UI 작성 영역 비교 결과다.
export function uiEntries(state: State, scans: Map<string, UiScan>): Entry[] {
  return [...state.flipbooks.values()].map(fb => ({
    key: fb.id, screenId: null, flipbookId: fb.id, frame: null, estimate: uiEstimate(state, fb.id, scans.get(fb.id)),
    categoryMissing: false, notes: [], suggestedScreenId: null, pairKey: null,
  }));
}

export function entryName(state: State, entry: Entry): string {
  if (entry.flipbookId) return state.flipbooks.get(entry.flipbookId)?.title ?? COPY.coreCompare001;
  // 등록 화면의 이름·Screen ID는 기록에만 있다. 원본 프레임 이름은 바꾸지 않는다(2026-10-21 사용자 결정).
  const screen = entry.screenId ? state.screens.get(entry.screenId) : null;
  if (screen) return formatFrameName(screen.code, screen.name);
  return entry.frame?.name ?? COPY.coreCompare001;
}

// 화면의 비교 기준. 「변경사항 없음」으로 등록한 지문이 현재 버전의 기준이면 그것을 쓴다.
export function baseline(state: State, screen: Screen): { fingerprint: string | null; fpVersion?: number } | null {
  const ack = screen.ack && screen.ack.version === screen.guiVersion ? screen.ack : null;
  return ack ?? lastGui(state, screen.id);
}

function visualEstimate(state: State, screen: Screen, frame: ScannedFrame): Estimate {
  if (frame.error) return 'failed';
  if (frame.fingerprint === null) return 'pending';
  const base = baseline(state, screen);
  if (!base?.fingerprint) return 'no-baseline';
  // 1 규칙 기준은 1 규칙 지문으로 비교한다. 같으면 본체가 기준을 2 규칙으로 옮긴다(upgradeBaselines).
  if ((base.fpVersion ?? 1) === LEGACY_FINGERPRINT_VERSION && frame.legacyFingerprint) return base.fingerprint === frame.legacyFingerprint ? 'unchanged' : 'changed';
  // 정규화 규칙이 다른 지문은 같아도 다르다고 단정할 수 없다. 기존 기준을 덮어쓰지 않고 표시만 한다.
  if ((base.fpVersion ?? 1) !== FINGERPRINT_VERSION) return 'stale';
  return base.fingerprint === frame.fingerprint ? 'unchanged' : 'changed';
}

// 변경 감지: 등록 화면의 지문 차이, 삭제된 카테고리, 비교 기준 없음·기준 버전 불일치(2026-10-20 사용자 결정)
// 프레임 이름은 화면 이름이 아니므로 보지 않는다(2026-10-21 사용자 결정).
export function changeDetected(entry: Entry): boolean {
  if (!entry.screenId || entry.flipbookId) return false;
  if (entry.estimate === 'changed' || entry.estimate === 'stale' || entry.estimate === 'no-baseline') return true;
  return entry.estimate === 'unchanged' && entry.categoryMissing;
}

// 「변경 무시」를 쓸 수 없는 이유. 카테고리는 화면 표시와 관련 있어 무시하지 않는다.
export function ignoreBlock(state: State, entry: Entry): string | null {
  const screen = entry.screenId ? state.screens.get(entry.screenId) : null;
  if (!screen || !changeDetected(entry)) return null;
  if (entry.categoryMissing) return COPY.coreDrafts034;
  if (!entry.frame?.fingerprint) return COPY.coreDrafts035;
  return null;
}

// 배정된 카테고리가 삭제된 화면. 안내는 입력란의 카테고리 항목에서 보여 준다.
function categoryMissing(state: State, screen: Screen): boolean {
  return screen.status !== 'deleted' && !(screen.categoryId && state.categories.get(screen.categoryId)?.active);
}

// 변경사항 확인 전 목록. GUI 원본을 읽지 않고 저장된 등록 화면만 「비교 전」으로 보여 준다.
// 신규 후보·복제 의심·원본 없음은 원본을 읽어야 알 수 있으므로 여기에는 없다.
export function uncheckedEntries(state: State): Entry[] {
  return [...state.screens.values()].map(screen => {
    const last = lastGui(state, screen.id);
    const frame: ScannedFrame | null = screen.source
      ? { nodeId: screen.source.nodeId, pageId: screen.source.pageId, name: formatFrameName(screen.code, screen.name), width: last?.width ?? 0, height: last?.height ?? 0, screenTag: screen.id, fingerprint: null, error: null }
      : null;
    return {
      key: screen.id, screenId: screen.id, frame, estimate: screen.status === 'deleted' ? 'retired' : 'pending',
      categoryMissing: categoryMissing(state, screen), notes: [], suggestedScreenId: null, pairKey: null,
    };
  });
}

export function classify(state: State, frames: ScannedFrame[]): Entry[] {
  const excluded = excludedNodeIds(state);
  const visible = frames.filter(f => !excluded.has(f.nodeId));
  const byNode = new Map(visible.map(f => [f.nodeId, f]));
  const byTag = new Map<string, ScannedFrame[]>();
  for (const frame of visible) {
    if (!frame.screenTag) continue;
    const bucket = byTag.get(frame.screenTag) ?? [];
    bucket.push(frame);
    byTag.set(frame.screenTag, bucket);
  }
  const bySource = new Map<string, Screen>();
  for (const screen of state.screens.values()) if (screen.source) bySource.set(screen.source.nodeId, screen);
  const claimed = new Set<string>();
  // 이동으로 보이는 프레임 → 원래 화면 ID
  const moved = new Map<string, string>();
  const entries: Entry[] = [];

  for (const screen of state.screens.values()) {
    const primary = screen.source ? byNode.get(screen.source.nodeId) ?? null : null;
    if (primary) claimed.add(primary.nodeId);
    const tagged = (byTag.get(screen.id) ?? []).filter(f => f !== primary && !bySource.has(f.nodeId));
    const entry: Entry = {
      key: screen.id, screenId: screen.id, frame: primary, estimate: 'pending',
      categoryMissing: categoryMissing(state, screen), notes: [], suggestedScreenId: null, pairKey: null,
    };

    if (screen.status === 'deleted') {
      entry.estimate = 'retired';
    } else if (primary) {
      // 프레임 이름을 바꿔도 화면 이름이 바뀌지 않으므로 변경으로 보지 않는다.
      entry.estimate = visualEstimate(state, screen, primary);
      if (primary.error) entry.notes.push(primary.error);
    } else {
      entry.estimate = 'missing';
      // 원본 노드는 없고 화면 ID가 기록된 프레임 하나만 있음: 잘라내기·붙여넣기 이동 또는 원본 삭제 후 사본.
      // 그 프레임은 신규 후보로 두고 서로 교체 짝으로 잇는다(2026-10-20 사용자 결정).
      if (tagged.length === 1) {
        entry.pairKey = `node:${tagged[0].nodeId}`;
        moved.set(tagged[0].nodeId, screen.id);
      }
    }
    entries.push(entry);
  }

  for (const frame of visible) {
    if (claimed.has(frame.nodeId) || bySource.has(frame.nodeId)) continue;
    const tagOwner = frame.screenTag ? state.screens.get(frame.screenTag) ?? null : null;
    const entry: Entry = { key: `node:${frame.nodeId}`, screenId: null, frame, estimate: 'new', categoryMissing: false, notes: [], suggestedScreenId: null, pairKey: moved.get(frame.nodeId) ?? null };
    if (entry.pairKey) entry.notes.push(COPY.coreCompare002);
    else if (tagOwner) {
      // 복제로 화면 ID까지 복사된 프레임. 기존 화면을 덮어쓰지 않도록 신규 후보로 두고 관계 확인을 요청한다.
      entry.notes.push(`${COPY.coreCompare003} ${tagOwner.name}`);
      entry.suggestedScreenId = tagOwner.id;
    }
    entries.push(entry);
  }
  return entries;
}

// 같은 화면을 두 프레임이 동시에 대표하는지 검사한다.
export function sourceConflicts(state: State): string[] {
  const seen = new Map<string, string>();
  const out: string[] = [];
  for (const screen of state.screens.values()) {
    if (!screen.source || screen.status !== 'active') continue;
    const other = seen.get(screen.source.nodeId);
    if (other) out.push(`${other}, ${screen.id}`);
    else seen.set(screen.source.nodeId, screen.id);
  }
  return out;
}
