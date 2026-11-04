// 업데이트 알림(2026-11-04 사용자 요청): 관리 → 시스템 → 업데이트에 현재·최신 버전과 받기 링크를 보여 주고,
// 배포본이 최신 버전보다 낮으면 관리 아이콘·메뉴에 알림을 띄운다.
// 「최신 버전」은 이 Figma 파일에서 쓰인 가장 높은 배포 버전이다(파일 기록 `ver`). 외부 서버에 묻지 않는다.
// 플러그인을 열 때마다 자기 배포 버전이 기록보다 높으면 기록을 올린다. 개발 빌드는 자기가 포함한 마지막 배포 태그를 남긴다.
// 그 태그의 zip은 이미 있으므로 팀원에게 받을 수 없는 버전을 알리지 않고, 개발자가 배포 뒤 파일을 열면 팀원에게 바로 알린다.

export const RELEASE_REPO = 'ynjoh9494/gui-ui-publish';
// 받기 링크는 README와 같은 최신 zip 주소다. 브라우저로 여는 것이라 플러그인의 네트워크 권한이 필요 없다.
export const DOWNLOAD_URL = `https://github.com/${RELEASE_REPO}/releases/latest/download/GUIUIPublish.zip`;

// current: 이 빌드의 버전(배포본은 태그 v1.2.3, 개발 빌드는 git describe 값).
// release: 태그로 만든 배포본인지. latest: 파일에 기록된 최신 버전(기록이 없으면 null)
export interface UpdateInfo { current: string; release: boolean; latest: string | null }

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

// 개발 빌드는 배포되지 않은 코드라 파일 기록이 더 높아 보여도 알리지 않는다.
export function needsUpdate(info: UpdateInfo | null): boolean {
  if (!info?.release || !info.latest) return false;
  return (compareVersions(info.latest, info.current) ?? 0) > 0;
}

// 파일 기록 `ver`의 값: {"version":"v1.2.3"}. 이전 버전 플러그인도 JSON으로 읽고 모르는 키라 무시한다.
export function readFileVersion(raw: string): string | null {
  try {
    const version = (JSON.parse(raw) as { version?: unknown } | null)?.version;
    return typeof version === 'string' && parseVersion(version) ? version : null;
  } catch { return null; }
}

export function fileVersionRecord(version: string, at: number): string {
  return JSON.stringify({ version, at });
}

// mine(이 빌드가 남길 배포 버전)이 기록보다 높으면 mine, 아니면 null(기록을 바꾸지 않는다).
export function versionToRecord(recorded: string | null, mine: string | null): string | null {
  if (!mine || !parseVersion(mine)) return null;
  return !recorded || (compareVersions(mine, recorded) ?? 0) > 0 ? mine : null;
}
