// Screen ID 자동 입력 규칙: `{플랫폼 Prefix}_{카테고리 코드}_{번호 3자리}`(예: STB_HO_001), 케이스는 기본 화면 ID 뒤에 `-01`.
// 카테고리 코드는 카테고리를 만들 때 이름에서 두 글자로 만들고, 설정에서 고칠 수 있다(2026-10-20 사용자 요청).
// 설정에서 Prefix·코드를 고치면 그 규칙으로 만든 배포 화면의 Screen ID를 바로 바꾼다(2026-10-20 사용자 결정).
import type { State } from './store.ts';
import type { Category, Screen } from './types.ts';

// 한글 음절은 국어의 로마자 표기법(음운 변화 없이 글자 단위)으로 읽는다.
const INITIALS = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const MEDIALS = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const FINALS = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];

// 이름의 영문·숫자와 한글 로마자를 대문자로 이어 붙인다. 그 밖의 문자는 뺀다.
export function codeLetters(name: string): string {
  let out = '';
  for (const ch of name) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0xac00 && cp <= 0xd7a3) {
      const n = cp - 0xac00;
      out += INITIALS[Math.floor(n / 588)] + MEDIALS[Math.floor((n % 588) / 28)] + FINALS[n % 28];
    } else if (/[A-Za-z0-9]/.test(ch)) out += ch;
  }
  return out.toUpperCase();
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// 이름에서 두 글자 코드를 만든다. 앞 두 글자 → 첫 글자와 뒤 글자의 조합 → 첫 글자 + A~Z → AA~ZZ 순으로 쓰이지 않은 코드를 고른다.
export function generateCategoryCode(name: string, used: Iterable<string>): string {
  const taken = new Set([...used].map(code => code.toUpperCase()));
  const letters = codeLetters(name);
  const candidates: string[] = [];
  if (letters.length >= 2) candidates.push(letters.slice(0, 2));
  for (let i = 2; i < letters.length; i++) candidates.push(letters[0] + letters[i]);
  if (letters) for (const c of ALPHABET) candidates.push(letters[0] + c);
  for (const a of ALPHABET) for (const b of ALPHABET) candidates.push(a + b);
  return candidates.find(code => !taken.has(code)) ?? '';
}

// 카테고리 코드: 영문·숫자. Prefix: 영문·숫자·하이픈이며 비울 수 있다. 밑줄은 ID 구분자라 쓰지 않는다.
export const CATEGORY_CODE_PATTERN = /^[A-Za-z0-9]{1,10}$/;
export const SCREEN_ID_PREFIX_PATTERN = /^[A-Za-z0-9-]{0,20}$/;

export function activeCategoryCodes(state: State, exceptId?: string): string[] {
  return [...state.categories.values()].filter(c => c.active && c.id !== exceptId && c.code).map(c => c.code!);
}

function stem(prefix: string, code: string): string {
  return prefix ? `${prefix}_${code}_` : `${code}_`;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 케이스의 Screen ID는 기본 화면에서 이어지므로 기본 화면의 카테고리 코드를 따른다.
function codeCategory(state: State, screen: Screen): Category | null {
  const owner = (screen.baseScreenId ? state.screens.get(screen.baseScreenId) : null) ?? screen;
  const category = owner.categoryId ? state.categories.get(owner.categoryId) : null;
  return category?.active && category.code ? category : null;
}

export interface CodeRename { screenId: string; from: string; to: string }

// Prefix 또는 한 카테고리의 코드를 바꿀 때 Screen ID가 바뀌는 배포 화면. 현재 규칙(`{Prefix}_{코드}_{번호}`, 케이스 `-NN`)을
// 따르는 ID만 바꾸고, 직접 정한 다른 형식의 ID와 사용 안 함 화면은 그대로 둔다.
export function codeRenames(state: State, change: { prefix?: string; categoryId?: string; code?: string }): CodeRename[] {
  const prefix = state.project.screenIdPrefix ?? '';
  const out: CodeRename[] = [];
  for (const screen of state.screens.values()) {
    const category = screen.status === 'active' ? codeCategory(state, screen) : null;
    if (!category) continue;
    const from = stem(prefix, category.code!);
    const to = stem(change.prefix ?? prefix, category.id === change.categoryId && change.code ? change.code : category.code!);
    if (from === to) continue;
    const match = new RegExp(`^${escape(from)}(\\d+(?:-\\d+)?)$`).exec(screen.code);
    if (match) out.push({ screenId: screen.id, from: screen.code, to: `${to}${match[1]}` });
  }
  return out;
}

// 바꾼 뒤 다른 사용 중 화면과 같아지는 Screen ID
export function renameConflicts(state: State, renames: CodeRename[]): string[] {
  const next = new Map(renames.map(r => [r.screenId, r.to]));
  const owners = new Map<string, number>();
  for (const screen of state.screens.values()) {
    if (screen.status !== 'active') continue;
    const code = next.get(screen.id) ?? screen.code;
    owners.set(code, (owners.get(code) ?? 0) + 1);
  }
  return [...new Set(renames.map(r => r.to).filter(code => (owners.get(code) ?? 0) > 1))];
}

// 원본 프레임의 캔버스 위치. page는 파일의 페이지 순서다.
export interface CanvasPosition { page: number; x: number; y: number; height: number }

// 캔버스 배치 순서: 페이지 → 위→아래 → 왼쪽→오른쪽. 위쪽 차이가 줄 첫 프레임과 이 프레임 중 낮은 높이의 절반보다 작으면 같은 줄로 본다.
// 세로로 긴 프레임 옆 아래쪽 줄이 같은 줄로 묶이지 않게 낮은 높이를 쓴다.
export function canvasOrder<T>(items: T[], at: (item: T) => CanvasPosition): T[] {
  const sorted = [...items].sort((a, b) => at(a).page - at(b).page || at(a).y - at(b).y || at(a).x - at(b).x);
  const rows: T[][] = [];
  for (const item of sorted) {
    const row = rows[rows.length - 1];
    const head = row ? at(row[0]) : null;
    const here = at(item);
    if (head && head.page === here.page && here.y - head.y < Math.min(head.height, here.height) / 2) row.push(item);
    else rows.push([item]);
  }
  return rows.flatMap(row => row.sort((a, b) => at(a).x - at(b).x));
}

// 배포 화면의 Screen ID 번호를 카테고리마다 001부터 다시 매긴다(2026-10-21 사용자 결정). 현재 규칙(`{Prefix}_{코드}_{번호}`)을 따르는
// 사용 중 기본 화면을 원본 프레임의 캔버스 배치 순서로 매기고, 케이스는 기본 화면의 새 번호 뒤에 케이스 번호를 그대로 붙인다.
// 원본 프레임을 찾지 못한 화면은 그 카테고리 끝에 지금 번호 순으로 둔다. 다른 화면(사용 안 함 포함)이 가진 번호는 건너뛰고,
// 직접 정한 다른 형식의 ID는 그대로 둔다.
export function renumberRenames(state: State, positions: Map<string, CanvasPosition>): CodeRename[] {
  const prefix = state.project.screenIdPrefix ?? '';
  const out: CodeRename[] = [];
  for (const category of state.categories.values()) {
    if (!category.active || !category.code) continue;
    const head = stem(prefix, category.code);
    const basePattern = new RegExp(`^${escape(head)}(\\d+)$`);
    const bases = [...state.screens.values()].filter(s => s.status === 'active' && !s.baseScreenId && s.categoryId === category.id && basePattern.test(s.code));
    if (!bases.length) continue;
    const baseIds = new Set(bases.map(s => s.id));
    const cases = [...state.screens.values()].filter(s => s.status === 'active' && s.baseScreenId && baseIds.has(s.baseScreenId));
    const moving = new Set([...baseIds, ...cases.map(s => s.id)]);
    const anyPattern = new RegExp(`^${escape(head)}(\\d+)(?:-\\d+)?$`);
    const taken = new Set<number>();
    for (const s of state.screens.values()) {
      const match = moving.has(s.id) ? null : anyPattern.exec(s.code);
      if (match) taken.add(Number(match[1]));
    }
    const number = (s: Screen) => Number(basePattern.exec(s.code)![1]);
    const placed = canvasOrder(bases.filter(s => positions.has(s.id)), s => positions.get(s.id)!);
    const rest = bases.filter(s => !positions.has(s.id)).sort((a, b) => number(a) - number(b));
    const next = new Map<string, string>();
    let n = 0;
    for (const screen of [...placed, ...rest]) {
      do n++; while (taken.has(n));
      next.set(screen.id, `${head}${String(n).padStart(3, '0')}`);
    }
    for (const screen of bases) if (next.get(screen.id) !== screen.code) out.push({ screenId: screen.id, from: screen.code, to: next.get(screen.id)! });
    for (const screen of cases) {
      const base = state.screens.get(screen.baseScreenId!)!;
      const suffix = screen.code.startsWith(`${base.code}-`) ? screen.code.slice(base.code.length + 1) : null;
      if (suffix === null || !/^\d+$/.test(suffix)) continue;
      const to = `${next.get(base.id)}-${suffix}`;
      if (to !== screen.code) out.push({ screenId: screen.id, from: screen.code, to });
    }
  }
  return out;
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  for (const [value, count] of counts) if (best === null || count > counts.get(best)!) best = value;
  return best;
}

// 기존 배포 화면의 Screen ID에서 가장 많이 쓴 Prefix(Prefix 없는 `HO_001` 형식은 빈 값). 규칙을 따르는 ID가 없으면 null.
// Prefix를 정하지 않은 채 직접 `STB_HO_001`처럼 배포한 파일의 규칙을 이어받는다(2026-10-21 사용자 요청).
export function inferScreenIdPrefix(state: State): string | null {
  const prefixes: string[] = [];
  for (const screen of state.screens.values()) {
    const match = screen.status === 'active' ? /^(?:([A-Za-z0-9-]{1,20})_)?[A-Za-z0-9]{1,10}_\d+(?:-\d+)?$/.exec(screen.code) : null;
    if (match) prefixes.push(match[1] ?? '');
  }
  return mostCommon(prefixes);
}

// 카테고리의 기존 배포 화면(케이스는 기본 화면의 카테고리) Screen ID에서 가장 많이 쓴 카테고리 코드. 없으면 null
export function inferCategoryCode(state: State, categoryId: string): string | null {
  const head = new RegExp(`^${escape(state.project.screenIdPrefix ? `${state.project.screenIdPrefix}_` : '')}([A-Za-z0-9]{1,10})_\\d+(?:-\\d+)?$`);
  const codes: string[] = [];
  for (const screen of state.screens.values()) {
    const owner = (screen.baseScreenId ? state.screens.get(screen.baseScreenId) : null) ?? screen;
    const match = screen.status === 'active' && owner.categoryId === categoryId ? head.exec(screen.code) : null;
    if (match) codes.push(match[1].toUpperCase());
  }
  return mostCommon(codes);
}

// 카테고리의 다음 Screen ID. 배포 화면(사용 안 함 포함)과 같은 배포의 입력값(reserved)에서 가장 큰 번호 + 1.
export function nextScreenCode(state: State, categoryId: string | undefined, reserved: Iterable<string> = []): string {
  const category = categoryId ? state.categories.get(categoryId) : null;
  if (!category?.active || !category.code) return '';
  const head = stem(state.project.screenIdPrefix ?? '', category.code);
  const pattern = new RegExp(`^${escape(head)}(\\d+)(?:-\\d+)?$`);
  let max = 0;
  for (const code of [...[...state.screens.values()].map(screen => screen.code), ...reserved]) {
    const match = pattern.exec(code);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${head}${String(max + 1).padStart(3, '0')}`;
}
