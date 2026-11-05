export const HISTORY_ADDED_AT = 'historyAddedAt';
export const HISTORY_LATEST_AT = 'historyLatestAt';
export const HISTORY_DOCUMENT_ID = 'historyDocumentId';

export interface HistoryWindow { since: number | null; until: number }
export interface HistoryNotice {
  key: string; at: string; description: string; worker: string; tag: string;
  screenIds?: string[];
}
export interface LaunchStorage {
  getAsync(key: string): Promise<unknown>;
  setAsync(key: string, value: unknown): Promise<void>;
}

// 실행 시 한 번만 호출한다. 알림을 펼쳐 보거나 GUI/UI를 전환해도 경계는 바뀌지 않는다.
export async function beginHistoryWindow(storage: LaunchStorage, key: string, now: number): Promise<HistoryWindow> {
  const previous = await storage.getAsync(key).catch(() => null);
  const since = typeof previous === 'number' && Number.isFinite(previous) && previous > 0 && previous <= now ? previous : null;
  await storage.setAsync(key, Math.max(since ?? 0, now)).catch(() => {});
  return { since, until: now };
}

export function inHistoryWindow(at: number, window: HistoryWindow): boolean {
  return window.since !== null && Number.isFinite(at) && at > window.since && at <= window.until;
}
