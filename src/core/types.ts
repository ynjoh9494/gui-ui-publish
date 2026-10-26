// 파일 내부 저장 데이터 모델. 서버 없이 Figma 파일의 sharedPluginData를 단일원본으로 사용한다.

export type Team = 'GUI' | 'UI';

// GUI와 UI는 한 Figma 파일에서 작업한다(플러그인 명령 GUI Publish·UI Flipbook). 플립북에는 GUI 원본의 레이어 복사본
// (컴포넌트 연결을 끊은 복제, 스타일·변수 연결 유지)을 넣는다. 복사본은 따로 보관하지 않고 플립북을 만들거나 GUI를
// 반영할 때 원본에서 바로 복사한다(2026-10-20 사용자 결정).
// GUI 배포 때 화면별 썸네일(1/4 크기, 검정 배경 JPG)을 별도 페이지에 남긴다. hash: Figma 이미지 해시(3/4 해상도),
// width·height: 캔버스에 놓는 1/4 크기
export interface GuiThumb { hash: string; width: number; height: number }
// 작업 종류: 신규(새 화면), 변경(수정·화면 교체), 삭제(원본이 사라진 화면을 사용 안 함으로 기록). 2026-10-20 사용자 결정으로 삭제를 다시 둔다.
export type WorkType = 'new' | 'changed' | 'deleted';

// Publish 실행 계정(figma.currentUser). 목록에서 지정하는 작업자와 구분한다.
export interface Actor { id: string; name: string }
// 과거 이력에 당시 이름을 보존하기 위한 사본
export interface Snapshot { id: string; name: string }
// color: 표시용 hex, colorKey: 팔레트 색(플립북 태그가 연결할 색 변수 color/<colorKey>)
export interface TagSnapshot { id: string; name: string; color: string; colorKey: string }

export interface ProjectConfig {
  schema: 1;
  // GUI 원본 페이지
  scopePageIds: string[];
  // 비어 있으면 범위 페이지의 최상위 Frame 전체를 후보로 본다.
  scopeSectionIds: string[];
  // 설정에서 지정한 UI 플립북 페이지. 만들기 모달에는 이 페이지들만 표시한다.
  flipbookPageIds: string[];
  // 플립북을 만드는 페이지와 템플릿(단일·여러 화면), 정책 템플릿(화면 없음). 확정 GUI 복사본도 플립북 페이지에 보관한다.
  // 마지막으로 플립북을 만든 페이지(다음 만들기의 기본 선택값). 기존 데이터의 페이지 이전에도 쓴다.
  flipbookPageId: string | null;
  templateNodeId: string | null;
  templateName: string | null;
  policyTemplateNodeId: string | null;
  policyTemplateName: string | null;
  // 모든 작업자가 기록을 열람하는 공유 DATA 페이지. 이름이 아닌 페이지 ID로 연결한다.
  dataPageId: string | null;
  // 표시 시간대. 540 = Asia/Seoul
  utcOffsetMinutes: number;
  // 플립북 GUI 영역에 놓는 1x 화면의 가로 크기(px). GUI 영역 폭도 이 값이며 1/2x·1/4x는 이 값에서 계산한다.
  guiWidth: number;
  // Screen ID 자동 입력의 플랫폼 Prefix(예: STB → STB_HO_001). 비어 있으면 `HO_001`로 만든다.
  screenIdPrefix: string;
}

// DATA 페이지 표시의 갱신 상태. 원기록과 별도로 두며, 표시 실패가 Publish 기록을 바꾸지 않는다.
export interface DataStatus {
  pageId: string | null; renderedAt: number | null; failedAt: number | null; error: string | null; actor: Actor;
}

// code: Screen ID 자동 입력의 카테고리 코드(예: HO). 카테고리를 만들 때 이름에서 만들고 설정에서 고칠 수 있다.
export interface Category { id: string; name: string; order: number; active: boolean; code?: string }
// alias: 동명이인 구분명
export interface Worker { id: string; name: string; alias: string; active: boolean }
// system: 플러그인이 넣는 기본 태그(GUI 추가·삭제, UI 최신). 이름·색을 바꾸거나 사용 중지할 수 없다(2026-10-20 사용자 결정).
export type SystemTag = 'add' | 'delete' | 'latest';
export interface TagDef { id: string; team: Team; name: string; colorKey: string; color: string; active: boolean; system?: SystemTag }

export interface ScreenSource { nodeId: string; pageId: string }

// 「변경 무시」로 등록한 비교 기준. 버전·기록을 만들지 않으며, version이 화면의 현재 GUI 버전과 같을 때만 쓴다.
export interface GuiAck { version: number; fingerprint: string; fpVersion: number; actor: Actor; at: number }

// 화면 레지스트리와 GUI 상태. GUI Publish와 관리 기능만 쓴다.
export interface Screen {
  // 내부 ID. 바뀌지 않으며 플립북에서는 uid로 쓴다.
  id: string;
  // GUI·관리 쪽 동시 작업 검사용 리비전. 화면 레코드를 쓸 때마다 증가한다.
  rev: number;
  // 사람용 Screen ID(예: STB_HO_001). 프레임 이름 `[ID] 이름`의 대괄호 안이다.
  code: string;
  name: string;
  categoryId: string | null;
  baseScreenId: string | null;
  status: 'active' | 'deleted';
  source: ScreenSource | null;
  guiVersion: number;
  guiTag: TagSnapshot | null;
  // 「변경 무시」로 등록한 비교 기준. 다음 GUI 버전을 확정하면 지운다.
  ack?: GuiAck | null;
  createdAt: number;
}

// 플립북의 UI 상태. 같은 플립북의 동시 UI Publish를 검사한다.
export interface UiState {
  flipbookId: string;
  rev: number;
  version: number;
  tag: TagSnapshot | null;
}

export interface Correction { at: number; actor: Actor; description: string; reason: string }

export interface GuiRecord {
  screenId: string;
  version: number;
  batchId: string;
  workType: WorkType;
  fingerprint: string | null;
  // 지문을 계산한 정규화 버전. 이 필드가 생기기 전의 기록은 1로 본다.
  fpVersion?: number;
  // 확정 시점의 썸네일. 만들지 못했으면 null
  thumb: GuiThumb | null;
  width: number;
  height: number;
  // 확정 당시 Screen ID
  code: string;
  name: string;
  category: Snapshot | null;
  base: Snapshot | null;
  tag: TagSnapshot;
  description: string;
  worker: Snapshot;
  actor: Actor;
  committedAt: number;
  extra: Record<string, string>;
  corrections: Correction[];
}

export interface UiRecord {
  flipbookId: string;
  version: number;
  batchId: string;
  // 플립북 프레임이 사라진 경우 삭제로 배포한다. 이전 기록은 변경으로 읽는다.
  workType?: 'changed' | 'deleted';
  // 확정 시점 플립북 UI 작성 영역(Description·마커·콜아웃)의 지문. 다음 UI Publish의 변경 추정 기준이다.
  fingerprint?: string | null;
  fpVersion?: string;
  tag: TagSnapshot;
  description: string;
  worker: Snapshot;
  actor: Actor;
  committedAt: number;
  extra: Record<string, string>;
  corrections: Correction[];
}

// 새로 만든 플립북의 UI 작성 영역 지문. 만든 직후 상태를 UI 최초 배포 완료로 보고,
// 첫 UI Publish 전 변경 추정의 기준으로 쓴다. UI 버전·이력은 만들지 않는다.
export interface UiBaseline { flipbookId: string; fingerprint: string; fpVersion: string; nodeId: string; createdAt: number }

// GUI Publish의 items.screenId는 화면 ID, UI Publish는 플립북 ID다.
export interface Batch { id: string; team: Team; actor: Actor; committedAt: number; items: { screenId: string; version: number }[] }

// 확정 뒤에 하는 플립북 반영. GUI Publish는 그 화면을 쓰는 플립북, UI Publish는 그 플립북을 맞춘다.
export type DeliveryKind = 'flipbook';
export type DeliveryState = 'pending' | 'applying' | 'done' | 'failed';
export interface Delivery {
  batchId: string; kind: DeliveryKind; targetId: string; team: Team; version: number;
  state: DeliveryState; error: string | null; updatedAt: number;
}

// ── 플립북 ─────────────────────────────────────────────

// single: 페이지당 화면 하나, multi: 한 페이지에 여러 화면, policy: 화면 없는 정책 템플릿
export type FlipbookKind = 'single' | 'multi' | 'policy';
export type FlipbookScale = 1 | 0.5 | 0.25;

// 플립북에 넣은 GUI 화면. version은 플립북에 반영한 GUI 버전이다.
export interface FlipbookScreen { uid: string; code: string; name: string; version: number; scale?: FlipbookScale }

export interface Flipbook {
  id: string;
  rev: number;
  kind: FlipbookKind;
  title: string;
  // 제목을 화면 이름에서 자동으로 만들었는가. 화면 이름이 바뀌면 함께 바꾼다.
  autoTitle: boolean;
  // 플러그인이 제목에 쓴 적 있는 값. 플립북 제목이 이 중 하나일 때만 바꾼다.
  titleNames: string[];
  scale: FlipbookScale;
  // 배치할 Section. 만들 때 첫 화면의 GUI 카테고리를 따르고, 정책은 「정책」이다.
  category: { key: string; name: string; order: number };
  screens: FlipbookScreen[];
  // 플립북 프레임이 있는 페이지. 한 파일의 여러 페이지에 플립북을 만들 수 있다.
  pageId: string | null;
  status: 'active' | 'deleted';
  createdAt: number;
  actor: Actor;
  // 마지막으로 반영한 1x 화면 가로 크기. 이 값을 남기기 전에 반영한 플립북에는 없다.
  guiWidth?: number;
}

// 플립북에 쌓은 GUI 이력 사본. 플립북을 만든 뒤 배포된 버전만 쌓는다(2026-10-19 사용자 결정).
export interface ImportedGuiRecord {
  flipbookId: string;
  // 같은 배포에서 바뀐 화면은 플립북 이력 한 줄로 합친다(2026-10-20 사용자 결정).
  batchId?: string;
  uid: string;
  version: number;
  code: string;
  name: string;
  workType: WorkType;
  tag: TagSnapshot;
  description: string;
  original: string;
  corrected: boolean;
  worker: string;
  committedAt: number;
}

// 플립북 확인 완료. versions는 확인할 때 이 플립북에 쌓여 있던 화면별 최신 GUI 버전이다.
// UI Flipbook은 배포하지 않고 수정된 화면만 알린다. 확인 완료를 누르면 그 버전까지의 「화면이 수정되었습니다」를 푼다(2026-10-20 사용자 결정).
export interface FlipbookReview { flipbookId: string; versions: Record<string, number>; actor: Actor; reviewedAt: number }

// 플로우의 위치. GUI를 다시 배포하면 그 화면의 썸네일을 바꾸려고 찾는 데만 쓰며 이력은 남기지 않는다(2026-10-23 사용자 결정).
// uids: 들어 있는 화면(겹치지 않게). 썸네일마다의 화면·버전은 프레임 안 이미지의 표식에 둔다.
export interface FlowRecord { id: string; nodeId: string; pageId: string; title: string; uids: string[]; createdAt: number; actor: Actor }

export interface Exclusion { id: string; nodeId: string; name: string; reason: string; createdAt: number; active: boolean }

export interface AuditEntry { id: string; at: number; actor: Actor; action: string; target: string; before: unknown; after: unknown; reason: string }
