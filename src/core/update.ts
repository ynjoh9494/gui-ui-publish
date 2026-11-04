// 업데이트 확인(2026-11-04 사용자 요청): 관리 → 시스템 → 업데이트에 현재·최신 버전과 받기 링크를 보여 주고,
// 배포본이 최신 배포보다 낮으면 관리 아이콘·메뉴에 알림을 띄운다.
// 최신 버전은 공개 레포의 GitHub Release에서 읽는다. 파일 내용이나 사용자 정보는 보내지 않는다.
// 개발 빌드(npm run activate-build)는 배포되지 않은 코드라 알림을 띄우지 않는다.

export const RELEASE_REPO = 'ynjoh9494/gui-ui-publish';
export const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
// 받기 링크는 README와 같은 최신 zip 주소다. 최신 버전을 읽지 못해도 이 링크는 맞다.
export const DOWNLOAD_URL = `https://github.com/${RELEASE_REPO}/releases/latest/download/GUIUIPublish.zip`;
// 인증 없는 GitHub API는 IP마다 시간당 60회라 사용자마다 한 시간에 한 번만 묻는다.
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

// current: 이 빌드의 버전(배포본은 태그 v1.2.3, 개발 빌드는 git describe 값).
// release: 태그로 만든 배포본인지. latest: 최신 배포 태그(읽지 못했으면 null)
export interface UpdateInfo { current: string; release: boolean; latest: string | null }
// 사용자별 마지막 확인 결과(figma.clientStorage)
export interface UpdateCache { latest: string; checkedAt: number }

export function parseVersion(tag: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// a가 b보다 높으면 양수, 같으면 0, 낮으면 음수. 형식이 다르면 비교하지 않는다(null).
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export function needsUpdate(info: UpdateInfo | null): boolean {
  if (!info?.release || !info.latest) return false;
  return (compareVersions(info.latest, info.current) ?? 0) > 0;
}

export function cacheFresh(cache: UpdateCache | null | undefined, now: number): boolean {
  return !!cache && now - cache.checkedAt >= 0 && now - cache.checkedAt < UPDATE_CHECK_INTERVAL_MS;
}

// clientStorage에서 읽은 값. 형식이 다르면 없는 것으로 본다.
export function readCache(value: unknown): UpdateCache | null {
  const v = value as Partial<UpdateCache> | null | undefined;
  return v && typeof v.latest === 'string' && parseVersion(v.latest) && typeof v.checkedAt === 'number' ? { latest: v.latest, checkedAt: v.checkedAt } : null;
}

// GitHub releases/latest 응답의 tag_name
export function latestTag(body: unknown): string | null {
  const tag = (body as { tag_name?: unknown } | null)?.tag_name;
  return typeof tag === 'string' && parseVersion(tag) ? tag : null;
}
