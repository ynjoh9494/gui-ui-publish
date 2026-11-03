import type { State } from './store.ts';
import type { Flipbook } from './types.ts';

export interface FlipbookIdentity { screenId: string; chapter: string; frameName: string }

function policyStem(state: State, fb: Flipbook): string {
  const category = state.categories.get(fb.category.key)
    ?? [...state.categories.values()].find(c => c.active && c.name === fb.category.name);
  const prefix = state.project.screenIdPrefix;
  return prefix && category?.code ? `${prefix}_${category.code}_POLICY`.toUpperCase() : '';
}

// Allocate against saved IDs and preceding unsaved policies. Reading an older
// file stays deterministic without migrating every flipbook on startup.
export function policyScreenId(state: State, fb: Flipbook): string {
  const stem = policyStem(state, fb);
  if (!stem) return '';
  const taken = new Set([...state.flipbooks.values()].filter(f => f.status === 'active' && f.id !== fb.id && f.screenId).map(f => f.screenId!));
  for (const s of state.screens.values()) if (s.status === 'active') taken.add(s.code);
  const next = () => {
    let last = 0;
    for (const code of taken) {
      if (code === stem) last = Math.max(last, 1);
      else if (code.startsWith(`${stem}_`) && /^\d+$/.test(code.slice(stem.length + 1))) last = Math.max(last, Number(code.slice(stem.length + 1)));
    }
    return last ? `${stem}_${String(last + 1).padStart(2, '0')}` : stem;
  };
  for (const other of state.flipbooks.values()) {
    if (other.id === fb.id) break;
    if (other.status === 'active' && !other.screens.length && !other.screenId && policyStem(state, other) === stem) taken.add(next());
  }
  return next();
}

export function flipbookIdentity(state: State, fb: Flipbook): FlipbookIdentity {
  const screenId = fb.screenId || fb.screens[0]?.code || policyScreenId(state, fb);
  const code = screenId.split('_')[1] ?? '';
  const category = [...state.categories.values()].find(c => c.code?.toUpperCase() === code.toUpperCase());
  return { screenId, chapter: category?.name ?? (code || '-'), frameName: screenId ? `${screenId} · ${fb.title}` : fb.title };
}

// A value matching the first GUI screen remains automatic when GUI renumbers it.
export function withFlipbookId(state: State, fb: Flipbook, input?: string): Flipbook {
  const value = input?.trim().toUpperCase() || (fb.screens.length ? fb.screens[0].code : policyScreenId(state, fb));
  return { ...fb, screenId: fb.screens.length && value === fb.screens[0].code ? undefined : value || undefined };
}
