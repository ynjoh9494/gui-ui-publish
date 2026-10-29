import { COPY } from './copy.ts';
import { formerUids } from './guiScreens.ts';
import { flipbookHistoryRows, type HistoryRow } from './history.ts';
import { systemTagId } from './registry.ts';
import type { State } from './store.ts';
import type { Flipbook, FlipbookKind, FlipbookScale, TagSnapshot, Team } from './types.ts';

// 플립북 페이지에 반영할 내용. 전달 작업마다 따로 적용하지 않고 플립북의 현재 상태로 맞추므로
// 같은 전달을 다시 실행하거나 여러 건이 밀려 있어도 이미지·이력 행이 중복되지 않는다.

// 이력 행. Screen ID·버전은 표시하지 않는다(2026-10-20 사용자 결정).
export interface FlipbookRow {
  // 이력 행을 다시 찾는 표식(팀·배포 작업 ID). 같은 배포의 여러 화면은 한 줄이다.
  key: string;
  team: Team;
  tag: TagSnapshot;
  // 태그에 연결할 팔레트 색. 태그 컴포넌트에 이 색 변수와 태그 이름을 넣는다.
  colorKey: string;
  description: string;
  worker: string;
  at: string;
}

// 플립북에 놓을 GUI. 원본 프레임을 바로 복사해 넣는다. key가 GUI 영역의 표식과 같으면 다시 복사하지 않는다.
// formerUids: 이 화면이 이어받은(교체해 사용 안 함이 된) 화면. 그 화면의 이전 복사본 위 마커는 이 화면을 따라간다.
export interface FlipbookGui { uid: string; code: string; version: number; key: string; sourceNodeId: string | null; scale?: FlipbookScale; formerUids?: string[] }

export interface FlipbookView {
  flipbookId: string;
  kind: FlipbookKind;
  name: string;
  // 플러그인이 제목에 쓴 적 있는 이름. 제목이 이 중 하나일 때만 현재 이름으로 바꾸고, 사용자가 고친 제목은 둔다.
  titleNames: string[];
  category: { key: string; name: string; order: number };
  // 큰 제목 위 Chapter 글자(chapterName)
  chapter: string;
  // 플립북 프레임이 있는(만들) 페이지
  pageId: string | null;
  // 선택한 순서. 정책은 비어 있다. 상단 input-cell-id에 이 순서로 Screen ID 태그를 넣는다.
  gui: FlipbookGui[];
  scale: FlipbookScale;
  // 1x 화면의 가로 크기(설정). GUI 영역 폭이기도 하다.
  guiWidth: number;
  // 상단 Status: GUI·UI 구분 없이 마지막 기록의 태그. 새 템플릿 플립북은 만든 뒤 받은 기록이 없으면 「작성 전」이다.
  status: FlipbookRow | null;
  // 최신순. 첫 행은 최신 영역, 나머지는 Previous 영역에 놓는다.
  rows: FlipbookRow[];
  // 새로 만들 때 Section 안에서 놓을 자리: 이 플립북 바로 다음(null이면 맨 앞, 없으면 맨 뒤)
  after?: string | null;
  // 플러그인에서 제목을 바꿨다. 캔버스에서 고친 제목도 새 제목으로 바꾼다.
  retitle?: boolean;
  // 「만들기」로 새로 만드는 플립북이다. 이때만 프레임을 만든다. 프레임이 지워진 기존 플립북은 다시 만들지 않는다(2026-10-23 사용자 결정).
  create?: boolean;
}

// 1x 화면 가로 크기(2026-10-20 사용자 결정): 설정한 1x 폭이 GUI 영역 폭이고,
// 1/2x는 간격을 포함해 두 장, 1/4x는 네 장이 1x 폭에 꼭 들어가는 크기다.
export const GUI_GAP = 12;
export const GUI_WIDTH_MIN = 200;
export const GUI_WIDTH_MAX = 3840;
export function guiTargetWidth(width: number, scale: FlipbookScale): number {
  const count = Math.round(1 / scale);
  return (width - GUI_GAP * (count - 1)) / count;
}
// 새 템플릿(연결 기록이 있는 템플릿)의 화면 크기(2026-10-29 사용자 결정): GUI 원본 폭은 정해져 있지 않다.
// 「기본」은 원본 폭을 설정한 화면 크기(최대 폭)로 줄인 크기(작은 화면은 원래 크기), 「작게」는 그 SMALL_SCALE배다.
// 1/4은 없앴고, 저장된 1/2(0.5)은 「작게」다. 이전 1/4(0.25) 값도 「작게」로 본다.
export const SMALL_SCALE = 0.49;
// 화면 복사본을 GUI 영역 왼쪽 위에서 띄우는 여백. 넘친 영역을 늘릴 때도 이만큼 둔다(구현 기본값).
export const FREE_MARGIN = 24;
export function freeGuiWidth(maxWidth: number, scale: FlipbookScale, sourceWidth: number): number {
  const base = Math.min(sourceWidth, maxWidth);
  return scale === 1 ? base : base * SMALL_SCALE;
}
// 화면 크기 선택지에서 보일 값: 1(기본) 아니면 0.5(작게)
export const displayScale = (scale: FlipbookScale): 1 | 0.5 => (scale === 1 ? 1 : 0.5);
export function validGuiWidth(width: number): boolean {
  return Number.isInteger(width) && width >= GUI_WIDTH_MIN && width <= GUI_WIDTH_MAX;
}

export const NO_CATEGORY_KEY = '__none__';
export const POLICY_CATEGORY_KEY = '__policy__';
// Section 밖(페이지 바로 아래)에 둔 플립북의 Section 키(2026-10-23 사용자 결정). 목록에서는 그 페이지 맨 위에 라벨 행 없이 모은다.
export const NO_SECTION_KEY = '__nosection__';

// Chapter 글자: Section 이름. Section 밖(「(섹션 없음)」) 플립북은 「-」다(2026-10-23 사용자 결정).
export function chapterName(fb: Flipbook): string {
  return fb.category.key === NO_SECTION_KEY ? '-' : fb.category.name;
}
// 템플릿 원본 컴포넌트의 제목 기본값
export const TEMPLATE_TITLE = COPY.coreFlipbook001;

function pad(n: number): string { return String(n).padStart(2, '0'); }

// 템플릿 이력 행의 날짜 형식(MM/DD HH:mm)
export function formatShort(ms: number, utcOffsetMinutes: number): string {
  const d = new Date(ms + utcOffsetMinutes * 60000);
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function guiKey(uid: string, version: number): string {
  return `${uid}@${version}`;
}

// 화면이 여러 개여도 첫 번째로 선택한 화면의 이름만 자동 제목으로 쓴다. 화면이 없으면 「새 플립북」이다(2026-10-22 사용자 요청).
export function defaultTitle(kind: FlipbookKind, screens: { name: string }[]): string {
  if (!screens.length) return COPY.coreFlipbook004;
  return screens[0].name;
}

// 플립북이 가장 최근에 받은 기록(2026-10-29 사용자 결정, PRD §4.7). 새 템플릿 플립북은 만든 뒤 받은 기록만 본다(없으면 null = 「작성 전」).
// 이전 템플릿 플립북은 지금처럼 마지막 기록이다.
function latestRecord(fb: Flipbook, history: HistoryRow[]): HistoryRow | null {
  const [latest] = history;
  return latest && (!fb.tracked || latest.committedAt >= fb.createdAt) ? latest : null;
}

// 화면 목록의 상태 태그(2026-10-29 사용자 결정, PRD §4.7): 플립북이 가장 최근에 받은 태그를 만든 화면에만 붙인다(같은 배포로 바뀐 화면이 여럿이면 모두).
// 가장 최근 태그가 UI 상태 태그(확인 완료·작성 전)면 화면에는 붙이지 않는다. 화면 ID → 태그
export function screenTags(state: State, flipbookId: string): Map<string, TagSnapshot> {
  const fb = state.flipbooks.get(flipbookId);
  const latest = fb ? latestRecord(fb, flipbookHistoryRows(state, flipbookId)) : null;
  if (!latest || latest.team !== 'GUI') return new Map();
  return new Map((state.imported.get(flipbookId) ?? []).filter(r => (r.batchId ?? `${r.uid}@${r.version}`) === latest.batchId).map(r => [r.uid, latest.tag]));
}

export function flipbookView(state: State, flipbookId: string): FlipbookView {
  const fb: Flipbook | undefined = state.flipbooks.get(flipbookId);
  if (!fb) throw new Error(COPY.coreFlipbook002);
  const offset = state.project.utcOffsetMinutes;
  const former = formerUids(state);
  const history = flipbookHistoryRows(state, flipbookId);
  const rows: FlipbookRow[] = history.map(r => ({
    key: `${r.team}:${r.batchId}`, team: r.team, tag: r.tag, colorKey: r.tag.colorKey, description: r.description,
    worker: r.worker, at: formatShort(r.committedAt, offset),
  }));
  return {
    flipbookId, kind: fb.kind, name: fb.title, titleNames: [TEMPLATE_TITLE, ...fb.titleNames],
    category: fb.category, chapter: chapterName(fb), pageId: fb.pageId ?? state.project.flipbookPageId,
    gui: fb.screens.map(s => ({
      uid: s.uid, code: s.code, version: s.version, key: guiKey(s.uid, s.version), sourceNodeId: state.screens.get(s.uid)?.source?.nodeId ?? null, scale: s.scale ?? fb.scale,
      ...(former.has(s.uid) ? { formerUids: former.get(s.uid) } : {}),
    })),
    scale: fb.scale, guiWidth: state.project.guiWidth, status: fb.tracked && !latestRecord(fb, history) ? draftRow(state, fb, offset) ?? rows[0] ?? null : rows[0] ?? null, rows,
  };
}

// 「작성 전」 상태(기록 없이 상단 Status에만 쓴다). 기본 태그가 없으면 null
function draftRow(state: State, fb: Flipbook, offset: number): FlipbookRow | null {
  const id = systemTagId(state, 'draft');
  const tag = id ? state.tags.get(id) : undefined;
  if (!tag) return null;
  return { key: 'UI:draft', team: 'UI', tag: { id: tag.id, name: tag.name, color: tag.color, colorKey: tag.colorKey }, colorKey: tag.colorKey, description: '', worker: fb.actor.name, at: formatShort(fb.createdAt, offset) };
}
