import type { State } from './store.ts';
import type { Flipbook } from './types.ts';

export interface FlipbookIdentity { screenId: string; chapter: string; frameName: string }

function policyStem(state: State, fb: Flipbook): string {
  const category = state.categories.get(fb.category.key)
    ?? [...state.categories.values()].find(c => c.active && c.name === fb.category.name);
  const prefix = state.project.screenIdPrefix;
  return prefix && category?.code ? `${prefix}_${category.code}_POLICY`.toUpperCase() : '';
}

// ID를 저장하지 않은 정책 플립북(화면도 ID도 없다). 처음 반영할 때 ID를 저장한다(controller deliverFlipbooks).
export const unsavedPolicy = (fb: Flipbook) => fb.status === 'active' && !fb.screens.length && !fb.screenId;

// 정책 ID의 번호: 머리 그대로는 1번, `머리_NN`은 NN번, 그 밖은 0
function policyNumber(stem: string, code: string): number {
  if (code === stem) return 1;
  if (!code.startsWith(`${stem}_`)) return 0;
  const rest = code.slice(stem.length + 1);
  return /^\d+$/.test(rest) ? Number(rest) : 0;
}
const policyCode = (stem: string, n: number) => (n <= 1 ? stem : `${stem}_${String(n).padStart(2, '0')}`);

// 저장한 플립북 ID·화면 ID 중 그 머리의 마지막 번호. exceptId의 저장 ID는 뺀다(자기 ID를 다시 정할 때).
function lastPolicyNumber(state: State, stem: string, exceptId?: string): number {
  let last = 0;
  for (const f of state.flipbooks.values()) if (f.status === 'active' && f.id !== exceptId && f.screenId) last = Math.max(last, policyNumber(stem, f.screenId));
  for (const s of state.screens.values()) if (s.status === 'active') last = Math.max(last, policyNumber(stem, s.code));
  return last;
}

// Allocate against saved IDs and preceding unsaved policies. Reading an older
// file stays deterministic without migrating every flipbook on startup.
export function policyScreenId(state: State, fb: Flipbook): string {
  const stem = policyStem(state, fb);
  if (!stem) return '';
  let last = lastPolicyNumber(state, stem, fb.id);
  for (const other of state.flipbooks.values()) {
    if (other.id === fb.id) break;
    if (unsavedPolicy(other) && policyStem(state, other) === stem) last++;
  }
  return policyCode(stem, last + 1);
}

// 저장하지 않은 정책 플립북 모두의 ID를 한 번에 정한다(policyScreenId와 같은 결과). 목록처럼 플립북마다 부를 때 쓴다.
export function unsavedPolicyIds(state: State): Map<string, string> {
  const out = new Map<string, string>();
  const last = new Map<string, number>();
  for (const fb of state.flipbooks.values()) {
    if (!unsavedPolicy(fb)) continue;
    const stem = policyStem(state, fb);
    if (!stem) continue;
    const n = (last.get(stem) ?? lastPolicyNumber(state, stem)) + 1;
    last.set(stem, n);
    out.set(fb.id, policyCode(stem, n));
  }
  return out;
}

// policies: unsavedPolicyIds 결과. 여러 플립북을 차례로 볼 때 넘기면 정책 ID를 플립북마다 다시 계산하지 않는다.
export function flipbookIdentity(state: State, fb: Flipbook, policies?: ReadonlyMap<string, string>): FlipbookIdentity {
  const screenId = fb.screenId || fb.screens[0]?.code || policies?.get(fb.id) || policyScreenId(state, fb);
  const code = screenId.split('_')[1] ?? '';
  const category = code ? [...state.categories.values()].find(c => c.code?.toUpperCase() === code.toUpperCase()) : undefined;
  return { screenId, chapter: category?.name ?? (code || '-'), frameName: screenId ? `${screenId} · ${fb.title}` : fb.title };
}

// A value matching the first GUI screen remains automatic when GUI renumbers it.
// 입력한 대소문자를 그대로 저장한다(2026-11-04 사용자 요청: 대문자로 바꾸는 규칙 없앰).
export function withFlipbookId(state: State, fb: Flipbook, input?: string): Flipbook {
  const value = input?.trim() || (fb.screens.length ? fb.screens[0].code : policyScreenId(state, fb));
  return { ...fb, screenId: fb.screens.length && value === fb.screens[0].code ? undefined : value || undefined };
}
