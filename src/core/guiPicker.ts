import type { Entry } from './compare.ts';
import { isDeletion, isOldSide, isPrevious, isUnpublish, mergesInto, replaceTarget, type Draft } from './drafts.ts';
import type { State } from './store.ts';
import type { Screen } from './types.ts';

function removed(entry: Entry, draft: Draft | undefined): boolean {
  return !!draft?.included && (draft.notScreen || isUnpublish(entry, draft) || isDeletion(entry, draft));
}

export function pickerFrameEntries(entries: Entry[], drafts: Record<string, Draft>): Entry[] {
  return entries.filter(entry => {
    const draft = drafts[entry.key];
    return !!entry.frame && entry.estimate !== 'retired' && !removed(entry, draft)
      && !(draft?.included && (isPrevious(entry, draft) || isOldSide(entry, draft)));
  });
}

// A replacement keeps the target's persistent screen ID but uses the new frame's
// current display values. The old frame and a merged-away screen are not choices.
export function pickerRegisteredScreens(state: State, entries: Entry[], drafts: Record<string, Draft>): { screen: Screen; entry: Entry | undefined }[] {
  const byScreen = new Map(entries.filter(entry => entry.screenId).map(entry => [entry.screenId!, entry]));
  const replacements = new Map<string, Entry>();
  for (const entry of entries) {
    const draft = drafts[entry.key];
    if (!draft?.included || removed(entry, draft)) continue;
    const target = replaceTarget(entry, draft);
    if (target) replacements.set(target, entry);
  }
  return [...state.screens.values()].flatMap(screen => {
    if (screen.status !== 'active') return [];
    const original = byScreen.get(screen.id);
    const draft = original && drafts[original.key];
    if (original && (removed(original, draft) || (draft?.included && mergesInto(original, draft)))) return [];
    const replacement = replacements.get(screen.id);
    if (!replacement && original && draft?.included && (isPrevious(original, draft) || isOldSide(original, draft))) return [];
    return [{ screen, entry: replacement ?? original }];
  });
}
