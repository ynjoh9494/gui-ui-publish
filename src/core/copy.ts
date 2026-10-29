import type { Estimate } from './compare.ts';
import type { InputStatus } from './drafts.ts';
import type { WorkType } from './types.ts';

export const ESTIMATE_LABEL: Record<Estimate, string> = {
  new: '추가됨', changed: '수정됨', unchanged: '변경사항 없음', pending: '비교 전', failed: '비교 불가',
  'no-baseline': '이전 화면 없음', stale: '기준 버전 불일치', missing: '원본 화면 없음', retired: '사용하지 않음',
};

export const UI_ESTIMATE_LABEL: Record<Estimate, string> = {
  ...ESTIMATE_LABEL, missing: '플립북 없음', 'no-baseline': '이전 플립북 없음',
};

export const STATUS_LABEL: Record<InputStatus, string> = {
  excluded: '제외', invalid: '필수 정보 확인', ready: '필수 입력 완료', 'ready-plus': '부가정보 입력',
};

export const WORK_LABEL: Record<WorkType, string> = { new: '신규', changed: '변경', deleted: '삭제' };

// GUI 목록의 상태 아이콘(2026-10-20 사용자 결정). 앞의 여섯 개는 변경사항 확인 결과, 나머지는 배포를 켠 뒤의 상태다.
export const GUI_STATE_LABEL = {
  'detected-new': '신규', 'detected-change': '변경 감지', 'detected-delete': '삭제', unchanged: '변경사항 없음', pending: '비교 전', failed: '비교 불가',
  added: '추가됨', replaced: '화면 교체됨', previous: '이전 버전', 'not-screen': '화면이 아님', unpublished: '배포 취소', modified: '수정됨', deleted: '삭제됨',
} as const;
export type GuiState = keyof typeof GUI_STATE_LABEL;
export const UI_STATE_LABEL = {
  'detected-change': '변경 감지', 'detected-delete': '삭제', unchanged: '변경사항 없음', pending: '비교 전', failed: '비교 불가', modified: '수정됨', deleted: '삭제됨',
} as const;
export type UiListState = keyof typeof UI_STATE_LABEL;
export const UI_STATE_HINT: Record<UiListState, string> = {
  'detected-change': '플립북 작성 내용이 이전 UI 배포와 다릅니다.',
  'detected-delete': '등록된 플립북 프레임을 찾지 못했습니다. 배포를 켜면 삭제로 기록합니다.',
  unchanged: '비교에서 차이를 찾지 못했습니다. 필요하면 배포에 포함할 수 있습니다.',
  pending: '변경사항 확인을 누르면 이전 UI 배포와 비교합니다.',
  failed: '플립북을 읽거나 비교하지 못했습니다. 다시 확인하세요.',
  modified: '플립북 작성 내용을 UI 배포합니다.',
  deleted: '배포 뒤 이 플립북은 사용 안 함으로 바뀌고 목록에서 빠집니다.',
};
export const GUI_STATE_HINT: Record<GuiState, string> = {
  'detected-new': '아직 등록되지 않은 프레임입니다. 배포를 켜고 등록 방식을 고르세요.',
  'detected-change': '이전 배포와 다릅니다. 실제로 바뀌었으면 배포하고, 아니면 변경 무시를 누르세요.',
  'detected-delete': '등록된 원본 프레임을 GUI 범위에서 찾지 못했습니다. 배포를 켜고 삭제 또는 다른 화면으로 교체를 고르세요.',
  unchanged: '비교에서 차이를 찾지 못했습니다. 필요하면 배포에 포함할 수 있습니다.',
  pending: '변경사항 확인을 누르면 이전 배포와 비교합니다.',
  failed: 'GUI 원본을 읽거나 비교하지 못했습니다. 다시 확인하세요.',
  added: '새 화면으로 등록합니다.',
  replaced: '기존 화면을 이 프레임으로 교체합니다. 기존 화면의 새 버전으로 기록합니다.',
  previous: '다른 프레임으로 교체됩니다. 배포 뒤 이 프레임은 목록에서 제외합니다.',
  'not-screen': '배포 뒤 이 프레임은 목록에서 제외합니다.',
  unpublished: '배포 뒤 이 화면은 사용 안 함이 되고 원본 연결을 끊습니다. 프레임은 신규로 다시 나옵니다.',
  modified: '변경 내용을 배포합니다.',
  deleted: '배포 뒤 이 화면은 사용 안 함으로 바뀌고 목록에서 빠집니다.',
};

export const INDICATOR_LABEL: Record<'new' | 'changed' | 'unchanged' | 'pending' | 'attention' | 'retired', string> = {
  new: '추가됨', changed: '수정됨', unchanged: '변경사항 없음',
  pending: '비교 전', attention: '확인 필요', retired: '사용하지 않음',
};

// 화면·안내·오류 문구. 각 항목의 주석은 문구가 처음 표시되던 코드의 행이다.
// 문구를 바꿀 때 HTML 태그·동적 값은 사용처에 두고 여기의 텍스트만 수정한다.
export const COPY = {
  windowCollapse: '창 접기',
  windowExpand: '창 펼치기',
  // 화면 상단·변경사항 확인 — src/ui/app.ts
  uiApp001: '불러오는 중', // 78
  uiApp002: "화면 목록", // 84
  uiApp003: "입력", // 85
  uiApp004: '관리', // 135
  uiApp005: "배포 계정", // 138
  uiApp006: '플립북 작성 내용을 이전 배포와 비교합니다', // 144
  uiApp007: 'GUI 변경사항을 확인합니다', // 144
  uiApp008: "변경사항 확인", // 147
  uiApp009: '취소', // 150
  uiApp010: '플립북 페이지 미지정', // 178
  uiApp011: '플립북 찾는 중', // 179
  uiApp012: 'GUI 불러오는 중', // 179
  uiApp013: "변경사항 비교하는 중", // 180
  uiApp014: "마지막 검토중", // 181
  uiApp015: "개", // 181
  uiApp016: '취소됨 · 다시 시도하세요', // 182
  uiApp017: '확인 실패 · 다시 시도하세요', // 183
  uiApp018: '', // 184
  uiApp019: '배포됨', // 195
  // 화면 목록·배포 요약 — src/ui/app.ts
  uiApp020: "화면명 검색 (전체 카테고리)", // 224
  uiApp021: "화면명 검색", // 224
  uiApp022: "변경된 화면만 보기", // 224
  uiApp023: '이전에 배포한 화면만 표시됩니다.<br><b>변경사항 확인</b>을 눌러 목록을 업데이트해 주세요.', // 228
  uiApp024: '이전에 배포한 플립북만 표시됩니다.<br><b>변경사항 확인</b>을 눌러 목록을 업데이트해 주세요.', // 230
  uiApp025: "GUI 페이지가 없습니다.", // 233
  uiApp026: "관리", // 233
  uiApp027: "에서 페이지를 지정하세요.", // 233
  uiApp028: '검색 결과가 없습니다.', // 236
  uiApp029: '표시할 화면이 없습니다.', // 236
  uiApp030: "모두 배포하기", // 239
  uiApp032: "의 표시된 화면 배포", // 241
  uiApp033: "개 · 포함", // 244
  uiApp034: "배포", // 251
  uiApp035: '변경사항 확인 후 배포할 수 있습니다.', // 273
  uiApp036: "포함", // 274
  uiApp037: "· 필수 정보 미충족", // 274
  uiApp038: '미충족 항목으로', // 275
  uiApp039: "최종 확인", // 276
  uiApp040: '태그 선택', // 281
  uiApp041: '작업자 선택', // 286
  // 선택 화면의 입력·이력 — src/ui/app.ts
  uiApp042: '화면을 선택하세요. Ctrl로 개별 선택, Shift로 범위를 선택할 수 있습니다.', // 300
  uiApp043: '화면 목적·설명 (선택)', // 306
  uiApp044: '변경 내용·이유 (선택)', // 306
  uiApp045: '변경 내용·이유', // 306
  uiApp046: "외", // 312
  uiApp047: "등록 방식", // 316
  uiApp048: "신규 화면 등록", // 317
  uiApp049: "기존 화면 교체", // 318
  uiApp050: "화면이 아님", // 319
  uiApp051: "교체할 이전 화면", // 320
  uiApp052: '이전 화면 선택', // 320
  uiApp053: "제외 사유 (선택)", // 321
  uiApp054: "작업 종류", // 324
  uiApp055: '화면 정보', // 329
  uiApp056: "화면 이름", // 330
  uiApp057: "화면 관계", // 335
  uiApp058: "독립 화면", // 336
  uiApp059: "케이스", // 337
  uiApp060: "기본 화면", // 338
  uiApp061: '기본 화면 선택', // 338
  uiApp062: "현재 UI 태그:", // 341
  uiApp063: '없음 · 플립북을 만들 때 배포됨', // 341
  uiApp064: "추가 설명", // 346
  uiApp065: '입력하면 선택한 화면 전체에 적용', // 347
  uiApp069: "· 배포", // 365
  uiApp071: "배포 이력", // 379
  uiApp072: '(정정)', // 381
  // 최종 확인 — src/ui/app.ts
  uiApp073: "신규", // 390
  uiApp074: "· 변경", // 390
  uiApp077: "· 화면 아님", // 390
  uiApp078: "· 이름 변경", // 390
  uiApp079: "· 이번에 보류", // 390
  uiApp080: "UI 기록", // 391
  uiApp081: "건", // 391
  uiApp082: "배포 최종 확인", // 394
  uiApp083: "해결이 필요한 항목", // 396
  uiApp084: '전체', // 397
  uiApp085: "화면", // 398
  uiApp086: "작업", // 398
  uiApp087: "버전", // 398
  uiApp088: "태그", // 398
  uiApp089: "작업자", // 398
  uiApp090: "설명", // 398
  uiApp091: "케이스:", // 400
  uiApp092: "새 카테고리:", // 400
  uiApp093: "카테고리:", // 400
  uiApp094: "전후 화면은 캔버스에서 확인합니다. 행의 이전 확정본 버튼으로 DATA 페이지에 보존된 확정 이미지를 볼 수 있습니다. 확정하면 플립북 페이지에 바로 반영합니다.", // 407
  uiApp095: "돌아가기", // 409
  uiApp096: "배포 확정", // 410
  // 관리 — src/ui/app.ts
  uiApp097: "GUI 원본 범위", // 423
  uiApp098: "추가할 GUI 원본 페이지", // 424
  uiApp099: '추가할 페이지 선택', // 425
  uiApp100: '추가할 페이지 없음', // 425
  uiApp101: "추가", // 427
  uiApp102: "GUI 원본 페이지", // 428
  uiApp103: "찾을 수 없는 페이지 (", // 429
  uiApp104: "제거", // 429
  uiApp105: "삭제", // 429
  uiApp106: '추가된 페이지가 없습니다.', // 429
  uiApp107: "플립북", // 432
  uiApp108: "플립북 페이지", // 433
  uiApp209: '설정에서 UI 페이지를 지정하세요.',
  uiApp210: '추가할 UI 페이지',
  uiApp109: '선택', // 433
  uiApp110: "저장", // 434
  uiApp111: "템플릿:", // 435
  uiApp112: '지정 안 됨', // 435
  uiApp113: "캔버스에서 선택한 템플릿 프레임을 템플릿으로 지정", // 436
  uiApp114: "템플릿 프레임을 복제해 플립북을 만듭니다. 아래 항목에 연결한 칸에만 제목·Chapter·상태·Screen ID·GUI·이력을 넣고, Description 내용과 콜아웃은 건드리지 않습니다. 다시 연결하려면 캔버스에서 레이어를 고른 뒤 그 항목의 「연결」을 누르세요.", // 437
  uiApp116: "변경", // 440
  uiApp117: '비활성화', // 440
  uiApp118: '활성화', // 440
  uiApp119: "이름", // 441
  uiApp120: "제외 설정", // 442
  uiApp121: "제외 해제", // 443
  uiApp122: '없음', // 443
  uiApp123: "플립북 반영 대기", // 444
  uiApp124: '재시도', // 444
  uiApp125: "최근 감사 기록", // 445
  uiApp126: "진단", // 447
  uiApp127: "데이터 초기화", // 449
  uiApp128: ": 이 파일의 화면 등록·GUI/UI 배포 기록·카테고리·작업자·태그·관리 설정과, 페이지·프레임에 남긴 연결 표식을 모두 지웁니다.", // 449
  uiApp129: "캔버스의 페이지·프레임·플립북·DATA 페이지는 지우지 않으니 필요하면 직접 지우세요. 되돌리려면 Figma 버전 기록을 사용합니다.", // 450
  uiApp130: '정말 초기화합니다 · 한 번 더 누르세요', // 451
  uiApp131: '데이터 초기화', // 451
  uiApp132: '취소', // 452
  uiApp133: "색상", // 457
  uiApp134: "페이지", // 466
  uiApp135: "연결:", // 469
  uiApp136: '아직 없음. 첫 GUI 배포 또는 아래 버튼으로 만듭니다.', // 469
  uiApp137: "마지막 갱신:", // 470
  uiApp138: "갱신 실패", // 471
  uiApp139: "복구하지 못한 이미지", // 472
  uiApp140: "개:", // 472
  uiApp141: "공유 DATA 페이지", // 474
  uiApp142: '원기록에서 다시 그리기', // 476
  uiApp143: 'DATA 페이지 만들기', // 476
  uiApp144: "연결할 페이지", // 477
  uiApp145: "이 페이지로 연결", // 478
  uiApp146: "표시는 파일 내부 기록에서 다시 만듭니다. 페이지를 직접 고쳐도 기록은 바뀌지 않습니다.", // 479
  // 태그·작업자·카테고리 입력 — src/ui/app.ts
  uiApp147: "새 태그 이름", // 489
  uiApp148: "확인", // 489
  uiApp149: "취소", // 489
  uiApp151: "태그 이름", // 491
  uiApp155: '사용 안 함 확인: 한 번 더 누르세요', // 494
  uiApp156: '선택한 태그 사용 안 함', // 494
  uiApp160: "새 작업자명", // 502
  uiApp161: '배정된 카테고리가 삭제되었습니다. 새 카테고리를 지정하세요.', // 513
  uiApp162: "카테고리", // 514
  uiApp163: "새 카테고리 이름", // 514
  uiApp164: '카테고리 선택', // 515
  uiApp167: "사용 중인 화면", // 516
  uiApp168: "개에 새 카테고리를 지정해야 합니다", // 516
  uiApp169: '삭제', // 516
  uiApp211: '삭제하려면 한 번 더 누르세요.',
  uiApp170: '없음', // 521
  uiApp171: '관리 화면에서 연결', // 739
  uiApp172: "카테고리 변경:", // 848
  uiApp173: '편집',
  uiApp174: '선택한 항목 편집',
  uiApp175: '—',
  uiApp176: '변경사항 확인을 마친 뒤 배포 여부와 정보를 입력할 수 있습니다.',
  uiApp177: '선택 화면 변경사항 확인',
  uiApp178: '선택한 화면의 플립북 작성 내용만 이전 배포와 비교합니다',
  uiApp179: '선택한 화면만 비교합니다. 원본 목록은 다시 읽어 신규·복제·원본 없음도 함께 표시합니다',
  uiApp180: '선택 화면 확인',
  uiApp182: '변경 무시',
  uiApp183: '지금 화면을 비교 기준으로 저장하고 변경사항 없음으로 바꿉니다. 버전·플립북·이력은 바꾸지 않습니다.',
  uiApp184: '· 삭제',
  uiApp185: '삭제',
  uiApp212: '플립북 프레임이 없습니다. 배포하면 이 플립북을 삭제로 기록하고 목록에서 제외합니다.',
  uiApp186: '다른 화면으로 교체',
  uiApp187: '교체할 화면 선택',
  uiApp188: '이 화면은 다른 프레임으로 교체됩니다:',
  uiApp189: '이 화면에는 정보를 입력하지 않습니다.',
  uiApp190: '목록에 없음',
  uiApp191: '플립북 만들기',
  uiApp192: '확인이 필요한 플립북',
  uiApp193: '화면이 수정되었습니다',
  uiApp195: '썸네일 없음',
  uiApp196: '이미지 크기',
  uiApp198: '화면 선택',
  uiApp203: '플립북 제목',
  uiApp204: '페이지 선택',
  uiApp205: '화면',
  uiApp207: '만들기',
  uiApp208: '드래그해서 창 크기 조절',
  // UI Flipbook 목록·상세(2026-10-20 사용자 결정: 배포하지 않고 수정된 화면만 알린다)
  uiApp213: '플립북 목록',
  uiApp214: '확인 완료',
  uiApp215: '이 플립북의 GUI가 다시 배포되었습니다. Description·콜아웃을 확인한 뒤 확인 완료를 누르세요.',
  uiApp216: '수정된 화면',
  uiApp217: '플립북을 선택하세요. Ctrl로 개별 선택, Shift로 범위를 선택할 수 있습니다.',
  uiApp218: '만든 플립북이 없습니다.',
  uiApp219: '플립북 이력',
  uiApp220: '선택한 플립북 중 확인이 필요한 플립북',
  uiApp221: '화면이 없는 플립북입니다.',
  uiApp222: '확인이 필요한 플립북이 없습니다.',
  uiApp223: '상태',
  uiApp224: '코멘트',
  uiApp225: '화면 크기',
  uiApp226: '화면 최대 가로 크기(px)',
  uiApp227: '「기본」은 GUI 원본 폭이 이 값보다 크면 이 값으로 줄이고 작으면 원래 크기로, 「작게」는 그 0.49배로 넣습니다. 이전 템플릿(GUI Image Slot) 플립북은 이 값을 GUI 영역 폭으로 씁니다.',
  uiApp228: '바꾼 크기는 이후 만들거나 GUI 갱신이 반영되는 플립북부터 적용됩니다.',
  uiApp229: '플랫폼 Prefix',
  uiApp230: '카테고리 코드',
  uiApp231: '예:',
  uiApp232: '신규 기본 화면은 카테고리를 고르면 Screen ID를 자동 입력합니다. 카테고리 코드는 카테고리를 만들 때 이름에서 두 글자로 만듭니다.',
  uiApp233: 'Prefix나 코드를 저장하면 이 규칙으로 만든 배포 화면의 Screen ID와 원본 프레임 이름, 플립북의 Screen ID를 바로 바꿉니다. 과거 기록은 당시 ID를 유지합니다.',
  uiApp234: '카테고리가 없습니다. GUI Publish의 카테고리 입력란에서 추가합니다.',
  uiApp235: '연결 끊김',
  uiApp236: '캔버스에 프레임이 없습니다.',
  uiApp237: '목록에서 삭제',
  uiApp238: '연결이 끊긴 플립북',
  uiApp240: '연결이 끊긴 플립북',
  uiApp241: '개',
  uiApp242: '전체 삭제',
  uiApp239: '플립북 템플릿에 문제가 있어 플립북을 만들거나 반영할 수 없습니다. 템플릿을 고치거나 관리의 템플릿에서 다시 연결하세요.',
  uiApp243: '화면 수정',
  uiApp244: '이미 배포한 화면은 사용 안 함으로 바뀌고 목록에서 빠집니다. 이 화면만 쓰던 플립북도 사용 안 함이 됩니다.',
  uiApp245: '번호 다시 매기기',
  uiApp246: '정말 다시 매깁니다 · 한 번 더 누르세요',
  uiApp247: '배포 화면의 번호를 카테고리마다 001부터 원본 프레임의 캔버스 배치 순서(위→아래, 왼쪽→오른쪽)로 다시 매깁니다. 케이스는 기본 화면 번호를 따라가고, 직접 정한 다른 형식의 ID는 그대로 둡니다. 원본 프레임 이름과 플립북의 Screen ID도 바로 바꾸며 과거 기록은 당시 ID를 유지합니다.',
  uiApp181: '「비교 전」 화면이 선택되어 있습니다. 내용을 입력하려면 ‘변경사항 확인’을 먼저 실행해 주세요.',
  // 새 버전 페이지 전환(2026-10-21 사용자 결정: 프레임 이름이 아닌 화면 내용으로 연결)
  uiApp248: '새 버전 페이지',
  uiApp249: '다른 파일에서 붙여 넣은 페이지를 등록 화면과 비교해 연결합니다. 화면 내용으로 비교하고, 프레임 이름이 기존 원본과 같으면 단서로 씁니다. 지난 배포와 같은 화면은 「동일」, 기존 원본과 내용이 비슷한 화면은 「유사」로 제안하며, 연결은 직접 바꿀 수 있습니다.',
  uiApp250: '전환하면 연결한 프레임이 그 화면의 원본이 되고(프레임 이름은 그대로), 이 페이지가 GUI 원본 범위가 됩니다. 기존 페이지는 바꾸지 않습니다. 버전은 만들지 않으며, 내용이 바뀐 화면은 변경 감지로 나와 평소처럼 배포합니다.',
  uiApp251: '비교할 페이지',
  uiApp252: '비교',
  uiApp253: '동일',
  uiApp254: '유사',
  uiApp255: '직접 선택',
  uiApp256: '연결 안 함',
  uiApp257: '연결하지 않은 화면',
  uiApp258: '개는 전환 후 삭제 후보로 나옵니다.',
  uiApp259: '연결되지 않은 새 프레임',
  uiApp260: '개는 전환 후 신규 후보로 나옵니다.',
  uiApp261: '전환',
  uiApp262: '정말 전환합니다 · 한 번 더 누르세요',
  uiApp263: '비교할 페이지가 없습니다. GUI 원본 범위와 DATA 페이지가 아닌 페이지에 붙여 넣으세요.',
  uiApp264: '등록된 화면이 없습니다.',
  // 새 버전 페이지 탭 — src/ui/app.ts
  uiApp272: '화면 목록',
  uiApp273: '다시 비교',
  uiApp274: '비교할 페이지를 고르고 비교를 누르세요. 등록된 화면마다 연결할 프레임을 제안합니다.',
  uiApp275: '동일 화면 숨기기',
  uiApp276: '연결할 프레임',
  uiApp277: '기존 원본',
  uiApp278: '지난 배포 썸네일',
  uiApp279: '새 프레임',
  uiApp280: '캔버스에서 보기',
  uiApp281: '지난 배포 화면과 화면 지문(레이어 속성 전체)이 같습니다. 내용이 완전히 같아 그대로 연결했습니다.',
  uiApp282: '기존 원본 프레임을 찾지 못해 내용으로 비교하지 못했습니다. 지난 배포와 지문이 같은 프레임만 「동일」로 연결합니다.',
  uiApp283: '이상 비슷한 프레임이 없어 연결하지 않았습니다. 같은 화면이 있으면 직접 고르세요.',
  uiApp284: '프레임을 읽지 못해 내용을 비교하지 못했습니다.',
  uiApp285: '일치한 요소',
  uiApp286: '비교한 요소',
  uiApp287: '글자',
  uiApp288: '이미지',
  uiApp289: '레이어(종류·크기·위치)',
  uiApp290: '기존 원본에만 있는 글자',
  uiApp291: '새 프레임에만 있는 글자',
  uiApp292: '비교한 요소는 기존 원본과 모두 같지만 화면 지문이 지난 배포와 달라 「동일」로 보지 않았습니다. 지난 배포 뒤 원본을 고쳤거나, 색·효과 같은 세부 속성이나 소수점 위치가 다를 수 있습니다.',
  uiApp293: '양쪽 요소를 합친 수 중 같은 요소의 비율입니다. 레이어는 종류·크기·위치(1px 단위)가 모두 같아야 일치로 셉니다. 배경·GNB처럼 새 버전 페이지 대부분의 프레임에 있는 요소',
  uiApp294: '개는 화면을 구분하지 못해 빼고 계산했습니다.',
  uiApp295: '연결할 화면',
  uiApp296: '연결하지 않으면 전환 후 신규 후보로 나옵니다.',
  uiApp297: '왼쪽 목록에서 화면이나 프레임을 선택하세요.',
  uiApp298: '이름 같음',
  uiApp299: '프레임 이름이 기존 원본과 같습니다. 이름이 같으면 유사도가 낮아도 먼저 연결합니다.',
  uiApp300: '이전 배포 썸네일',
  uiApp301: '업데이트된 화면만 보기',
  // 텍스트 편집 탭(UI Flipbook) — src/ui/textEditor.ts
  uiApp302: "플립북 목록",
  uiApp303: "텍스트 편집기",
  uiApp304: "Tab/Shift+Tab: 목록 깊이 · Ctrl+B: 굵게",
  uiApp305: "선택 영역 불러오기",
  uiApp306: "선택 영역에 적용",
  uiApp307: "플립북, 텍스트 또는 프레임 선택",
  uiApp308: "텍스트 입력",
  uiApp309: "굵게",
  uiApp310: "목록",
  // 새 플립북 오른쪽 영역(2026-10-22 사용자 요청)
  uiApp311: "플립북 편집",
  uiApp312: "제목",
  uiApp313: "만들기 전까지 저장 안 함 · 드래그 / Alt+↑↓: 자리 이동",
  uiApp314: "더블클릭하거나 연필을 눌러 제목을 고칩니다.",
  // 기존 플립북 옮기기(2026-10-22 사용자 요청)
  uiApp315: "옮긴 플립북",
  uiApp316: "배치 반영",
  uiApp317: "플립북 배치",
  uiApp318: "목록에서 옮긴 기존 플립북",
  uiApp319: "개를 캔버스의 플립북 배치에도 반영할까요?",
  uiApp320: "반영하지 않음: 기존 플립북은 원래 순서로 돌아감",
  uiApp321: "반영하지 않음",
  uiApp322: "반영함",
  uiApp323: "만들기 취소",
  uiApp324: "만들기 전 새 플립북을 모두 지우고, 옮긴 플립북은 원래 순서로 되돌립니다.",
  uiApp325: "계속 편집",
  uiApp326: "모두 취소",
  // 텍스트 편집 대상(2026-10-22 사용자 요청)
  uiApp327: "대상:",
  uiApp328: "플립북",
  uiApp329: "텍스트 레이어",
  uiApp360: "프레임",
  // 새 플립북 만들기 버튼·목록 행(2026-10-22)
  uiApp330: "만드는 중…",
  uiApp331: "플립북",
  uiApp332: "개 만들기",
  uiApp333: "만들 플립북",
  uiApp334: "드래그하거나 Alt+↑↓로 자리를 옮깁니다.",
  uiApp335: "제목 수정",
  uiApp336: "플립북 제목 수정",
  uiApp337: "(화면 카테고리)",
  uiApp338: "섹션",
  uiApp339: "새 섹션 이름",
  uiApp340: "섹션 선택",
  uiApp341: '마지막 동기화',
  uiApp342: '목록 새로고침',
  uiApp343: '동기화 중',
  uiApp344: '동기화',
  uiApp345: '플립북을 동기화하고 있습니다',
  uiApp349: '드래그하거나 Alt+↑↓로 순서를 바꿉니다.',
  uiApp353: '배포하면 이전 화면이 이 원본으로 새 버전이 되고, 이 화면은 사용 안 함이 됩니다. 이 화면이 든 플립북·플로우와 케이스는 이전 화면으로 옮기고, 지난 이력은 이 화면에 남습니다.',
  uiApp354: '사용 안 함으로 바꿀 화면:',
  uiApp355: '배포 취소',
  uiApp356: '· 배포 취소',
  uiApp357: '지난 이력은 이 화면에 남고, 이 화면만 쓰던 플립북은 사용 안 함이 됩니다. 프레임은 신규 후보로 다시 등록할 수 있습니다.',
  uiApp358: '화면 검색',
  uiApp359: '선택된 화면',
  // GUI 상세 패널의 변경사항(변경 감지 이유) — src/ui/changeReason.ts
  uiApp361: '변경 사항',
  uiApp362: '변경된 내용은 있지만, 화면에 보이는 모습은 이전 배포와 같습니다.',
  uiApp363: '구조',
  uiApp364: '표시',
  uiApp365: '위치·크기',
  uiApp366: '칠·선',
  uiApp367: '효과',
  uiApp368: '모양',
  uiApp369: '텍스트 내용',
  uiApp370: '텍스트 스타일',
  uiApp371: 'Variable',
  uiApp372: '기타',
  uiApp373: '레이어 종류만 다름',
  uiApp374: '1px 이내',
  uiApp375: '보이는 모습은 동일함',
  uiApp380: '추가',
  uiApp381: '레이어 이름',
  uiApp382: '삭제',
  uiApp383: '화면 프레임',
  uiApp386: '이전 배포 때의 기록이 없어 바뀐 레이어를 알 수 없습니다. 다음 배포나 변경 무시 뒤부터 보입니다.',
  uiApp387: '변경은 감지됐지만 바뀐 레이어를 찾지 못했습니다.',
  uiApp388: '전체 보기',
  uiApp389: '개 더 보기',
  uiApp390: '숨기기',
  uiApp391: '드래그해서 카테고리 순서를 바꿉니다.',
  // 관리의 템플릿 — 항목별 연결(2026-10-28)
  uiApp392: '템플릿',
  uiApp393: '기본 템플릿 만들기',
  uiApp394: '이 템플릿은 레이어 이름으로 칸을 찾고 있습니다. 항목 하나를 연결하거나 풀면 이름으로 찾은 칸을 모두 연결로 바꿉니다. 이미 만든 플립북은 계속 이름으로 찾습니다.',
  uiApp395: '연결 안 됨',
  uiApp396: '이름으로 찾지 못함',
  uiApp397: '보기',
  uiApp398: '연결',
  uiApp399: '해제',
  uiApp400: '연결된 레이어를 캔버스에서 선택해 보여 줍니다.',
  uiApp401: '캔버스에서 선택한 레이어를 이 항목에 연결합니다.',
  uiApp402: '이 항목의 연결을 풉니다. 연결하지 않은 칸에는 정보를 넣지 않습니다.',
  // 화면 크기 선택(2026-10-29)
  uiApp403: '기본',
  uiApp404: '작게',
  uiApp405: '이 플립북에는 삭제된 화면이 포함되어 있습니다.',
  uiApp406: '확인',
  uiApp407: '삭제된 화면이 포함되어 있습니다',
  // 튜토리얼 — src/ui/tutorial.ts. 단계마다 말풍선 제목·설명 순서다.
  uiTutorial001: '도움말',
  uiTutorial002: '튜토리얼 종료',
  uiTutorial003: '튜토리얼',
  uiTutorial004: '관리',
  uiTutorial005: 'GUI 원본 범위, Screen ID 규칙, 작업자, 제외한 화면, DATA 페이지를 관리합니다.',
  uiTutorial006: 'GUI 원본 범위',
  uiTutorial007: '변경사항을 확인할 원본 페이지를 추가합니다. 화면 프레임은 페이지 최상위나 Section 안에 둡니다.',
  uiTutorial008: '변경사항 확인',
  uiTutorial009: '원본 화면을 지난 배포와 비교합니다. 확인을 마쳐야 배포할 화면을 고를 수 있으며, 옆 버튼은 캔버스에서 고른 화면만 비교합니다.',
  uiTutorial010: '화면 목록',
  uiTutorial011: '카테고리별로 화면과 상태 아이콘(신규·변경 감지·삭제 등)을 보여 줍니다. 화면을 누르면 캔버스의 원본으로 이동하고, Shift·Ctrl로 여러 화면을 고릅니다. 카테고리 이름 줄을 드래그하면 카테고리 순서를 바꿉니다.',
  uiTutorial012: '검색·필터',
  uiTutorial013: '화면 이름으로 찾고, 보이는 화면을 모두 배포에 넣거나 변경된 화면만 볼 수 있습니다.',
  uiTutorial014: '배포',
  uiTutorial015: '켜면 이번 배포에 포함됩니다. 새 화면으로 등록할지, 기존 화면을 교체할지, 화면이 아닌지 고릅니다. 이미 배포한 화면은 배포를 취소할 수도 있습니다.',
  uiTutorial016: '화면 정보',
  uiTutorial017: '화면 이름, Screen ID, 카테고리, 독립·케이스 관계를 정합니다. Screen ID는 관리에서 정한 규칙대로 자동 입력되며 직접 고칠 수 있습니다.',
  uiTutorial018: '태그·작업자',
  uiTutorial019: '배포 이력에 남는 태그와 작업자입니다. 목록에 없으면 바로 추가합니다.',
  uiTutorial020: '추가 설명',
  uiTutorial021: '이번 배포의 설명을 남깁니다. 배포 한 번에 하나이며 선택 입력입니다.',
  uiTutorial022: '최종 확인',
  uiTutorial023: '포함한 화면과 필수 정보 미충족 개수를 보여 줍니다. 미충족이 없으면 최종 확인을 누릅니다.',
  uiTutorial024: '배포 확인',
  uiTutorial025: '신규·변경·삭제할 화면을 요약합니다. 확정하면 썸네일을 남기고, 그 화면을 쓰는 플립북에 바로 반영합니다.',
  uiTutorial026: '변경 감지',
  uiTutorial027: '배포한 원본이 바뀌면 다시 확인할 때 변경 감지로 표시합니다. 실제로 바뀐 것이 없으면 변경 무시를 누릅니다.',
  uiTutorial028: '배포 이력',
  uiTutorial029: '이전 배포 썸네일과 그동안의 배포 기록을 봅니다.',
  uiTutorial030: '새 버전 페이지',
  uiTutorial031: '다른 파일에서 GUI 페이지를 통째로 복사해 왔을 때, 화면 내용으로 기존 화면과 연결한 뒤 원본으로 전환합니다.',
  uiTutorial032: '관리',
  uiTutorial033: '플립북 페이지와 템플릿, 화면 크기, 작업자를 관리합니다.',
  uiTutorial034: '플립북 페이지·템플릿',
  uiTutorial035: '플립북을 둘 페이지를 추가하고, 캔버스에서 고른 템플릿 프레임을 템플릿으로 지정합니다.',
  uiTutorial036: '화면 크기',
  uiTutorial037: '플립북에 넣는 1x 화면의 가로 크기입니다. 1/2x·1/4x 크기는 이 값으로 계산합니다.',
  uiTutorial038: '새 플립북',
  uiTutorial039: '고른 플립북 다음 자리에 새 플립북을 넣습니다. 만들기를 누르기 전에는 저장하지 않습니다.',
  uiTutorial040: '자리 옮기기',
  uiTutorial041: '새 플립북은 드래그하거나 Alt+↑↓로 자리를 옮기고, X로 지웁니다.',
  uiTutorial042: '위치·제목',
  uiTutorial043: '플립북을 놓을 페이지와 Section을 고르고 제목을 입력합니다. 새 Section도 추가할 수 있습니다. 목록에서는 이름을 더블클릭하거나 연필을 눌러 고칩니다.',
  uiTutorial044: '선택된 화면',
  uiTutorial045: '플립북에 넣을 화면과 화면 크기(1x·1/2x·1/4x)입니다. 크기는 화면마다 또는 한 번에 바꾸고, 드래그하거나 Alt+↑↓로 순서를 바꿉니다.',
  uiTutorial046: '화면 선택',
  uiTutorial047: '카테고리별 목록에서 화면을 고릅니다. 노란 점은 플립북이 없는 화면이고, 우클릭하면 그 화면 하나로 새 플립북을 추가합니다.',
  uiTutorial048: '만들기',
  uiTutorial049: '목록 순서대로 캔버스에 만듭니다. 취소: 확인 후 새 플립북을 모두 지움',
  uiTutorial050: '플립북 없는 화면 일괄 만들기',
  uiTutorial051: '페이지와 범위를 정해 플립북이 없는 화면마다 플립북을 하나씩 만듭니다.',
  uiTutorial052: '플립북 목록',
  uiTutorial053: '페이지 → Section → 캔버스 순서로 보여 줍니다. 빨간 점은 GUI가 다시 배포된 플립북, 연결 끊김 아이콘은 캔버스에서 찾지 못한 플립북입니다.',
  uiTutorial054: '확인이 필요한 플립북',
  uiTutorial055: 'GUI가 다시 배포되어 확인할 플립북 수입니다. 업데이트된 화면만 보기로 그 플립북만 남길 수 있습니다.',
  uiTutorial056: '플립북 상세',
  uiTutorial057: '제목을 바꾸고 GUI 썸네일과 배포 이력을 봅니다. 썸네일의 빨간 점은 수정된 화면입니다.',
  uiTutorial058: '확인 완료',
  uiTutorial059: '수정된 화면을 확인한 뒤 상태와 코멘트를 남기고 확인 완료를 누르면 빨간 점이 풀립니다. 여러 플립북을 한 번에 처리할 수 있습니다.',
  // 튜토리얼 예시 화면의 데이터(카테고리, 작업자, 태그, 배포 설명)
  uiTutorial060: '홈',
  uiTutorial061: 'VOD 상세',
  uiTutorial062: 'EPG',
  uiTutorial063: '검색',
  uiTutorial064: '예시 작업자',
  uiTutorial065: '수정',
  uiTutorial066: '홈·VOD·EPG 화면 첫 배포',
  uiTutorial067: '케이스 화면 추가',
  uiTutorial068: 'VOD 상세 버튼 위치 수정',
  uiTutorial069: '검색 결과 화면 추가',
  uiTutorial070: "텍스트 편집기",
  uiTutorial071: "플립북이나 텍스트를 골라 불러오고 적용합니다. 플립북 밖 프레임에는 텍스트를 추가합니다.",
  uiTutorial072: "플로우 편집기",
  uiTutorial073: "배포된 화면을 썸네일로 추가하고, 썸네일 가장자리 점을 다른 썸네일로 드래그해 연결합니다. GUI를 다시 배포하면 썸네일만 바뀝니다.",
  uiTutorial074: "새 기능",
  uiTutorial075: "소속 화면",
  uiTutorial076: "캔버스에서 이 플립북 안에 놓은 화면입니다. 화면을 누르면 추적 목록에서 붙인 자리와 플로우를 찾습니다.",
  uiTutorial081: "GUI 목록",
  uiTutorial082: "카테고리를 고르고 화면을 클릭하거나 캔버스로 드래그합니다. GUI 재배포를 따라가며, 목록 아이콘으로 붙인 자리와 플로우를 찾습니다.",
  uiTutorial077: "PDF 저장",
  uiTutorial078: "지금 보고 있는 페이지에서 캔버스로 고른 프레임을 왼쪽 위에서 오른쪽 아래 순서로 한 PDF에 저장합니다. UI Title·Update History List는 저장하는 동안만 숨깁니다.",
  uiTutorial079: "변경 사항",
  uiTutorial080: "지난 배포나 변경 무시 이후 바뀐 레이어를 종류와 함께 한 줄씩 보여 줍니다. 줄을 누르면 캔버스에서 그 레이어를 선택하고, 보이는 모습은 같은 변경은 전체 보기로 펼칩니다.",
  // 변경 상태의 설명·툴팁 — src/ui/estimate.ts
  uiEstimate001: '플립북 UI 작성 영역', // 26
  uiEstimate003: '아직 등록되지 않은 프레임입니다. 신규 등록 또는 기존 화면 교체를 선택하세요.', // 28
  uiEstimate004: "이 이 화면의 이전 확정 기준과 다릅니다. 실제 변경 내용을 확인하세요.", // 29
  uiEstimate005: '비교에서 차이를 찾지 못했습니다. 변경이 없음을 보증하지 않으며 필요하면 배포에 포함할 수 있습니다.', // 30
  uiEstimate006: '변경사항 확인을 누르면 화면별 이전 확정 기준과 비교합니다.', // 31
  uiEstimate007: "을 읽거나 비교하지 못했습니다. 다시 확인하세요.", // 32
  uiEstimate008: '비교할 이전 확정 기준이 없습니다. 화면을 직접 확인하세요.', // 33
  uiEstimate009: '비교 방식이 바뀌어 이전 기준과 직접 비교할 수 없습니다. 화면을 직접 확인하세요.', // 34
  uiEstimate011: '이 화면에 연결된 플립북을 찾지 못했습니다.', // 36
  uiEstimate013: '삭제로 배포하여 사용 종료로 기록한 화면입니다.', // 37
  // 비교 결과 안내 — src/core/compare.ts
  coreCompare001: '(이름 없음)', // 75
  coreCompare002: '기존 화면을 잘라내 붙인 프레임으로 보입니다. 배포하면 기존 화면 교체로 연결합니다.', // 144
  coreCompare003: "복제된 프레임일 수 있습니다:", // 158
  // 필수 입력·유효성 검사 — src/core/drafts.ts
  coreDrafts003: '작업자', // 98
  coreDrafts004: '비활성화된 작업자입니다.', // 99
  coreDrafts005: '태그', // 102
  coreDrafts006: "태그를 선택하세요.", // 103
  coreDrafts007: '사용하지 않는 태그입니다.', // 104
  coreDrafts008: '변경 내용·이유', // 108
  coreDrafts009: '플립북을 찾을 수 없습니다.', // 111
  coreDrafts010: "형식:", // 118
  coreDrafts011: '확인 필요', // 118
  coreDrafts012: '사용 종료된 화면입니다.', // 128
  coreDrafts013: '등록 방식', // 132
  coreDrafts014: '교체할 이전 화면', // 135
  coreDrafts015: '사용 종료된 화면은 교체할 수 없습니다.', // 136
  coreDrafts016: "이전 화면의 원본 프레임이 아직 연결되어 있습니다:", // 139
  coreDrafts017: '기존 화면 교체는 변경으로 배포합니다.', // 140
  coreDrafts018: '신규 등록은 신규로 배포합니다.', // 143
  coreDrafts019: '화면 이름', // 144
  coreDrafts020: '카테고리', // 145
  coreDrafts021: '카테고리를 다시 선택하세요.', // 146
  coreDrafts022: '이미 있는 카테고리입니다. 목록에서 선택하세요.', // 147
  coreDrafts023: '독립 화면 / 케이스', // 148
  coreDrafts024: '기본 화면', // 150
  coreDrafts025: '이미 등록된 화면입니다. 변경·메모·삭제 중에서 선택하세요.', // 158
  coreDrafts026: '원본 화면이 없어 배포할 수 없습니다. 원본을 다시 연결하거나, 쓰지 않는 화면이면 태그로 표시하세요.', // 159
  coreDrafts027: "화면 출력을 확인할 수 없습니다:", // 160
  coreDrafts028: '화면을 찾을 수 없습니다.', // 161
  coreDrafts029: 'Screen ID',
  coreDrafts030: '다른 화면이 같은 Screen ID를 씁니다:',
  coreDrafts031: '교체할 화면',
  coreDrafts032: '교체 짝이 맞지 않습니다. 교체할 화면을 다시 고르세요.',
  coreDrafts034: '카테고리가 삭제되어 새 카테고리를 지정해야 합니다.',
  coreDrafts035: '지문을 계산하지 못해 변경을 무시할 수 없습니다.',
  coreDrafts036: '케이스가 연결된 화면으로는 케이스 화면을 교체할 수 없습니다. 케이스의 기본 화면을 먼저 바꾸세요.',
  // 목록의 분류 표시 — src/core/list.ts
  coreList001: '미분류', // 104
  coreList002: ' (사용 안 함)', // 104
  // 최종 확인·확정 오류 — src/core/publish.ts
  corePublish001: "누락", // 95
  corePublish002: "같은 화면을 두 항목이 대상으로 선택했습니다:", // 101
  corePublish003: '배포할 화면이 없습니다.', // 110
  corePublish004: "이미 다른 화면에 연결된 프레임입니다:", // 196
  corePublish005: '화면을 찾을 수 없습니다.', // 199
  corePublish006: '다른 작업이 먼저 이 화면을 갱신했습니다. 다시 확인하세요.', // 200
  corePublish007: '카테고리가 삭제되었습니다. 다시 선택하세요.', // 203
  corePublish008: '원본 프레임이 없습니다.', // 205
  corePublish009: '최종 확인 이후 화면이 바뀌었습니다. 다시 확인하세요.', // 206
  corePublish010: "화면 레이어를 플립북 페이지로 복사하지 못했습니다.", // 209
  corePublish011: '다른 UI 배포가 먼저 이 화면을 갱신했습니다. 다시 확인하세요.', // 214
  corePublish012: "이미 등록된 화면의 원본입니다:", // 237
  corePublish013: '전달 기록을 찾을 수 없습니다.', // 323
  corePublish014: '관리 탭에서 플립북 페이지를 먼저 지정하세요. 확정 GUI 복사본을 플립북 페이지에 보관합니다.',
  corePublish015: '이번 배포에서 두 화면이 같은 Screen ID를 씁니다:',
  corePublish016: '다른 화면으로 교체됨',
  corePublish017: '최종 확인 이후 플립북 프레임의 존재 상태가 바뀌었습니다. 다시 확인하세요.',
  // 관리 입력 오류 — src/core/registry.ts
  coreRegistry001: "을(를) 입력하세요.", // 9
  coreRegistry002: '카테고리 이름', // 26
  coreRegistry003: "이미 있는 카테고리입니다:", // 27
  coreRegistry004: '카테고리를 찾을 수 없습니다.', // 37
  coreRegistry005: '작업자 이름', // 58
  coreRegistry006: '이미 등록된 작업자 이름입니다. 다른 이름을 입력하세요.', // 62
  coreRegistry008: '작업자를 찾을 수 없습니다.', // 71
  coreRegistry009: '이미 등록된 작업자 이름입니다. 다른 이름을 입력하세요.', // 75
  coreRegistry010: '태그 이름', // 93
  coreRegistry011: '색상은 팔레트에서 고르세요.', // 94
  coreRegistry012: "이미 있는", // 96
  coreRegistry013: "태그입니다:", // 96
  coreRegistry014: '태그를 찾을 수 없습니다.', // 105
  coreRegistry015: '자기 자신을 기본 화면으로 지정할 수 없습니다.', // 123
  coreRegistry016: '기본 화면을 찾을 수 없습니다.', // 125
  coreRegistry017: '사용 종료된 화면은 기본 화면으로 지정할 수 없습니다.', // 126
  coreRegistry018: '케이스 화면을 기본 화면으로 지정할 수 없습니다.', // 127
  coreRegistry019: '케이스가 연결된 기본 화면은 다른 화면의 케이스가 될 수 없습니다.', // 129
  coreRegistry020: '화면을 찾을 수 없습니다.', // 135
  coreRegistry021: '연결 정정 사유를 입력하세요.', // 157
  coreRegistry022: "이미 다른 화면에 연결된 프레임입니다:", // 160
  coreRegistry023: '제외 설정을 찾을 수 없습니다.', // 177
  coreRegistry024: '정정 설명', // 192
  coreRegistry025: '정정 사유를 입력하세요.', // 193
  coreRegistry026: '이력을 찾을 수 없습니다.', // 196
  coreRegistry027: '기본 태그는 이름·색을 바꾸거나 사용 중지할 수 없습니다.',
  coreRegistry028: '추가',
  coreRegistry029: '삭제',
  coreRegistry030: '현행',
  coreRegistry031: '카테고리 코드는 영문·숫자 10자 이내로 입력하세요.',
  coreRegistry032: '다른 카테고리가 쓰는 코드입니다:',
  coreRegistry033: '플랫폼 Prefix는 영문·숫자·하이픈(-) 20자 이내로 입력하세요.',
  coreRegistry034: '바꾸면 다른 화면과 Screen ID가 겹칩니다:',
  coreRegistry035: '카테고리가 추가되거나 삭제되어 순서를 저장하지 않았습니다. 바뀐 목록에서 다시 옮기세요.',
  coreRegistry036: '작성 전',
  // 새 버전 페이지 전환 — src/core/versionMatch.ts
  coreVersion001: '사용할 수 없는 화면입니다:',
  coreVersion002: '새 버전 페이지에 없는 프레임입니다:',
  coreVersion003: '한 프레임을 여러 화면에 연결했습니다:',
  coreVersion004: '새 버전 페이지 전환',
  // DATA 페이지 상태 — src/core/data.ts
  coreData001: '반영 대기', // 35
  coreData002: '반영 중', // 35
  coreData003: '반영 완료', // 35
  coreData004: '반영 실패', // 35
  coreData005: '미분류', // 59
  coreData006: '사용 종료', // 61
  coreData007: '사용', // 61
  coreData008: '배포됨', // 65
  coreData009: '단일 화면',
  coreData010: '여러 화면',
  coreData011: '화면 없음',
  // 플립북 연결 상태 — src/core/flipbook.ts
  coreFlipbook001: '화면 이름', // 37
  coreFlipbook002: '플립북을 찾을 수 없습니다.', // 50
  coreFlipbook003: '미분류', // 72
  coreFlipbook004: '새 플립북',
  // 템플릿 연결 항목 — src/core/templateParts.ts
  coreTemplate001: '제목',
  coreTemplate002: '텍스트 · 여러 개 가능. 플립북 제목을 넣습니다.',
  coreTemplate003: 'Chapter',
  coreTemplate004: '텍스트. 플립북이 놓인 Section 이름을 넣습니다.',
  coreTemplate005: '상태',
  coreTemplate006: '태그 인스턴스나 텍스트. 확인 완료 때 고른 상태를 넣습니다.',
  coreTemplate007: 'Screen ID 칸',
  coreTemplate008: '슬롯이나 인스턴스 밖 프레임. 화면마다 Screen ID 태그를 넣습니다.',
  coreTemplate009: 'GUI 영역',
  coreTemplate010: '인스턴스 밖 프레임 · 필수. 이 프레임 왼쪽 위(여백 24)부터 GUI 화면 복사본을 플립북 위에 얹고, 넘치면 이 프레임을 늘립니다.',
  coreTemplate011: 'Description 본문',
  coreTemplate012: '슬롯이나 인스턴스 밖 프레임. 텍스트 편집 탭이 이 칸에 넣습니다.',
  coreTemplate013: '이력 목록',
  coreTemplate014: '슬롯이나 인스턴스 밖 프레임. 최신 이력 행을 넣습니다.',
  coreTemplate015: '이전 이력 칸',
  coreTemplate016: '슬롯이나 인스턴스 밖 프레임. 두 번째 이력부터 넣습니다. 연결하지 않으면 모든 이력을 이력 목록에 넣습니다.',
  coreTemplate017: 'PDF에서 숨김',
  coreTemplate018: '레이어 · 여러 개 가능. PDF로 저장하는 동안 숨깁니다.',
  coreTemplate019: 'Screen ID 태그',
  coreTemplate020: '컴포넌트. Screen ID 칸에 화면마다 하나씩 넣고 안의 첫 텍스트에 Screen ID를 씁니다.',
  coreTemplate021: '이력 행',
  coreTemplate022: '컴포넌트. 이력 한 줄마다 인스턴스를 만들어 이력 목록에 넣습니다.',
  coreTemplate023: '상태 태그',
  coreTemplate024: '컴포넌트 · 선택. 연결하면 상태 칸의 인스턴스를 이 컴포넌트로 바꿉니다.',
  coreTemplate025: '이력 상태 태그',
  coreTemplate026: '컴포넌트 · 선택. 연결하면 이력 행의 상태 인스턴스를 이 컴포넌트로 바꿉니다.',
  coreTemplate027: '상태',
  coreTemplate028: '태그 인스턴스나 텍스트. 그 이력의 상태를 넣습니다.',
  coreTemplate029: '코멘트',
  coreTemplate030: '텍스트. 배포·확인 때 남긴 코멘트를 넣습니다.',
  coreTemplate031: '작업자',
  coreTemplate032: '텍스트. 작업자 이름을 넣습니다.',
  coreTemplate033: '날짜',
  coreTemplate034: '텍스트. 기록 시각을 넣습니다.',
  coreTemplate035: '팀',
  coreTemplate036: '텍스트면 GUI·UI를 쓰고, 인스턴스면 값이 GUI·UI인 변형을 고릅니다.',
  coreTemplate037: '플립북 칸',
  coreTemplate038: '컴포넌트',
  coreTemplate039: '이력 행 안의 칸',
  // 플립북 만들기 — src/core/flipbooks.ts
  coreFlipbooks002: 'GUI 배포 기록에 없는 화면입니다. 목록을 다시 불러오세요.',
  coreFlipbooks003: '사용 종료된 화면입니다:',
  coreFlipbooks004: 'GUI 원본 프레임을 찾을 수 없는 화면입니다:',
  coreFlipbooks005: '화면을 고르세요.',
  coreFlipbooks006: '같은 화면을 두 번 선택했습니다.',
  coreFlipbooks007: '화면 크기는 기본이나 작게 중에서 고르세요.',
  coreFlipbooks009: '번째 행:',
  coreFlipbooks010: '상태를 고르세요.',
  coreFlipbooks011: '섹션 이름을 입력하세요.',
  coreFlipbooks012: '설정에서 지정한 플립북 페이지로만 옮길 수 있습니다.',
  coreFlipbooks013: '(섹션 없음)',
  coreFlipbooks014: '「(섹션 없음)」에는 만들거나 옮길 수 없습니다. 캔버스에서 섹션 밖으로 옮기세요.',
  // 실행 중 안내·결과 알림 — src/controller.ts
  controller001: '최종 확인 준비 중', // 56
  controller002: '배포 중', // 56
  controller003: '데이터 초기화 중', // 56
  controller004: 'UI 반영 중', // 56
  controller005: 'DATA 페이지 갱신 중', // 56
  controller006: '저장 중', // 56
  controller007: '반영 대기 항목이 없습니다.', // 104
  controller008: "DATA 페이지를 갱신했습니다. 복구하지 못한 이미지", // 112
  controller009: "개", // 112
  controller010: 'DATA 페이지를 갱신했습니다.', // 112
  controller011: "DATA 페이지 갱신 실패:", // 113
  controller012: '원본이 없어 마지막 전달 화면으로 이동했습니다.', // 232
  controller013: '보관된 이전 확정본이 없습니다.', // 239
  controller014: '플립북 페이지가 아직 없습니다.', // 239
  controller015: '이동할 프레임이 없습니다.', // 239
  controller016: '프레임을 찾을 수 없습니다.', // 244
  controller017: '변경사항 확인을 먼저 마치세요.', // 261
  controller018: '최종 확인 정보가 만료되었습니다. 다시 확인하세요.', // 279
  controller019: "썸네일 저장 중", // 286
  controller020: "개 화면을 배포했습니다.", // 318
  controller021: "개 항목을 화면이 아님으로 확정했습니다.", // 318
  controller022: 'DATA 페이지 갱신 실패: 관리 탭에서 다시 갱신하세요.', // 318
  controller023: '충돌을 해결한 뒤 다시 확인하세요.', // 319
  controller024: "데이터를 초기화했습니다. 기록", // 368
  controller025: "개, 연결 표식", // 368
  controller026: "개를 지웠습니다.", // 368
  controller027: "플립북 반영 대기", // 409
  controller028: "건: 설정에서 플립북 템플릿을 지정하세요.", // 409
  controller029: "UI 반영 중", // 420
  controller030: "플립북", // 512
  controller031: "개 화면 반영.", // 512
  controller032: "실패", // 513
  controller033: "건:", // 513
  controller034: "확인 필요:", // 514
  controller035: "확정하지 못한 화면",
  controller036: "개:",
  controller037: '「비교 전」 화면이 포함되어 있습니다. 선택 화면 변경사항 확인이나 변경사항 확인을 먼저 하세요.',
  controller038: '플립북 만드는 중',
  controller039: 'GUI 화면 목록 불러오는 중',
  controller042: 'GUI 갱신을 확인하지 못했습니다:',
  controller043: 'GUI 갱신: 플립북',
  controller044: '개, 새 기록',
  controller045: '건.',
  controller046: '기록에 없거나 사용 종료된 화면:',
  controller060: "개 화면의 변경을 무시했습니다.",
  controller061: "변경을 무시할 수 없는 화면:",
  controller062: "썸네일을 만들지 못한 화면(배포는 완료):",
  controller063: '플립북을 만들 페이지를 고르세요.',
  controller064: '개 플립북을 확인 완료로 표시했습니다.',
  controller066: '확인 완료 반영 중',
  controller067: '화면 최대 가로 크기는 200~3840 사이의 정수로 입력하세요.',
  controller101: '개 화면의 Screen ID를 바꿨습니다.',
  controller102: '원본 프레임 이름을 바꾸지 못한 화면:',
  controller103: '플립북 템플릿을 고친 뒤 다시 시도하세요:',
  controller104: '다시 매길 Screen ID가 없습니다. 이미 카테고리마다 배치 순서대로 매겨져 있습니다.',
  controller105: 'GUI 썸네일 이름을 바꾸지 못했습니다.',
  controller106: '새 버전 페이지 비교 중',
  controller107: '새 버전 페이지 전환 중',
  controller108: 'GUI 원본 범위와 DATA 페이지가 아닌 페이지를 고르세요.',
  controller109: '새 버전 페이지를 다시 비교한 뒤 전환하세요.',
  controller110: '새 버전 페이지로 전환했습니다.',
  controller111: '변경사항 없음',
  controller112: '변경 감지',
  controller113: '신규',
  controller114: '삭제 후보',
  controller115: '표식·이름을 바꾸지 못한 프레임:',
  controller118: '플립북 제목 바꾸는 중',
  controller119: '플립북 제목을 바꿨습니다:',
  controller139: '개 화면의 배포를 취소했습니다.',
  controller120: "텍스트 적용 중",
  controller135: "선택한 Description에 텍스트를 적용했습니다.",
  controller121: "선택한 텍스트 레이어에 텍스트를 적용했습니다.",
  controller140: "선택한 프레임에 텍스트를 추가했습니다.",
  controller141: '레이어를 찾을 수 없습니다. 변경사항을 다시 확인하세요.',
  controller142: '연결된 레이어를 찾을 수 없습니다. 관리의 템플릿에서 다시 연결하세요.',
  controller143: '기본 템플릿 만들기',
  controller133: '기존 플립북',
  controller134: '개를 옮겼습니다.',
  controller136: '불러오는 중',
  controller068: '플립북 삭제 중',
  controller069: '개 플립북을 목록에서 삭제했습니다.',
  controller070: '프레임이 있어 삭제하지 않은 플립북:',
  controller053: '관리에서 플립북 템플릿을 먼저 지정하세요.',
  controller054: '플립북',
  controller055: '개를 만들었습니다.',
  // Figma 파일·선택 화면 오류 — src/figma/host.ts
  figmaHost004: '알 수 없는 사용자', // 84
  figmaHost005: '프레임을 찾을 수 없습니다.', // 109
  figmaHost006: "지문 계산 실패:", // 112
  figmaHost007: '플립북 프레임을 찾을 수 없습니다.', // 168
  // 플로우 — src/core/flow.ts, src/figma/flow.ts, src/ui/flowView.ts
  flow001: '플로우',
  flow002: '화면을 2개 이상 추가하세요.',
  flow003: '배포된 화면이 아닙니다:',
  flow004: '화면 위치가 올바르지 않습니다.',
  flow005: '썸네일 없음',
  flow006: '플로우 만드는 중',
  flow007: '플로우를 만들었습니다:',
  flow008: '플로우',
  flow009: '개의 썸네일을 바꿨습니다.',
  flow010: '썸네일을 바꾸지 못한 플로우:',
  flow011: '썸네일 이미지를 파일에서 찾지 못한 화면:',
  // 플로우 프레임 안 레이어 이름이자 빨간 더미 글자
  flow012: '화면 제목 입력',
  flow013: '화면 설명 입력',
  flow014: '조건',
  flow015: 'Arrow',
  flow016: 'IMAGE',
  flow020: '플로우 편집기',
  flow021: '배포된 화면',
  flow022: '화면 검색',
  flow023: '플로우 구성',
  flow024: '추가: 화면 클릭 또는 판으로 드래그(격자에 맞춰 놓임)',
  flow029: '빼기',
  flow030: '플로우 제목',
  flow032: '플로우 만들기',
  flow033: '모두 지우기',
  flow034: '현재 페이지에 만듭니다. GUI를 다시 배포하면 썸네일만 바뀝니다.',
  flow035: '배포된 화면이 없습니다.',
  flow036: '찾는 화면이 없습니다.',
  flow037: '연결: 썸네일 가장자리 점을 다른 썸네일로 드래그',
  flow046: '이동: 썸네일 드래그 · 확대·축소: Ctrl+휠 · 삭제: 선택 후 Delete',
  flow041: 'Title',
  flow042: 'Caption',
  flow043: 'Action',
  flow044: 'Connector',
  flow045: 'Flow Title',
  flow048: '캔버스에서 삭제된 플로우입니다. 목록에서 제거했습니다.',
  flow053: '개',
  // 추적 GUI — src/trackController.ts
  track001: '붙인 화면',
  track002: '개를 새 버전으로 바꿨습니다.',
  track003: '배포된 GUI가 없는 화면이라 붙이지 못했습니다. GUI 목록 탭을 다시 열어 목록을 새로 받으세요.',
  track004: '화면 붙이는 중',
  track005: '캔버스에서 삭제된 화면입니다. 목록에서 제거했습니다.',
  // 추적 목록 팝업 — src/ui/trackListView.ts
  trackList001: '화면',
  trackList002: '플로우',
  trackList003: '캔버스에 붙인 화면이 없습니다.',
  trackList004: '이 화면이 든 플로우가 없습니다.',
  trackList005: '닫기',
  trackList006: '추적 목록',
  // GUI 목록 탭 — src/ui/pasteView.ts
  paste001: 'GUI 목록',
  paste002: '카테고리',
  paste003: '목록 보기',
  paste004: '그리드 보기',
  paste005: '화면 크기',
  paste006: 'K 단축키로 캔버스에 배치한 화면의 크기를 바꿀 수 있습니다.',
  paste007: '캔버스로 드래그 혹은 클릭하여 GUI를 배치할 수 있습니다.',
  paste008: '붙인 화면·플로우',
  paste009: '전체',
  paste010: 'Screen ID·화면 이름 검색',
  paste011: '전체 카테고리에서 검색하기',
  paste012: '검색 결과가 없습니다.',
  paste013: 'TIP',
  // PDF 저장 — src/ui/pdfView.ts, src/figma/pdf.ts
  pdf001: 'PDF 저장',
  pdf002: '선택한 프레임',
  pdf003: '개',
  pdf004: '저장할 프레임을 캔버스에서 선택하세요.',
  pdf005: '쪽 이미지 만드는 중',
  pdf006: 'PDF 파일로 묶는 중',
  pdf007: '프레임이 아닌 레이어',
  pdf008: '개는 제외',
  pdf009: '지금 보고 있는 페이지에서 선택한 프레임을 왼쪽 위에서 오른쪽 아래 순서로 한 PDF에 저장합니다. UI Title·Update History List가 있으면 저장하는 동안만 숨겼다가 다시 보이게 합니다. 한 쪽은 프레임을 2배 해상도로 찍은 이미지라 PDF에서 글자를 선택할 수는 없습니다.',
  pdf010: 'PDF를 저장했습니다:',
  pdf011: '쪽',
  pdf012: 'PDF를 만들지 못했습니다:',
  pdf013: '취소',
  pdf014: '취소하는 중…',
  pdf015: 'PDF 저장을 취소했습니다.',
  // 텍스트 편집 — src/figma/richText.ts
  figmaText001: "플립북이나 텍스트, 프레임을 선택하세요.",
  figmaText002: "선택한 텍스트에 없는 글꼴이 있습니다. 글꼴을 바꾼 뒤 다시 시도하세요.",
  figmaText003: "글꼴을 불러오지 못했습니다:",
  figmaText004: "굵은 글씨로 쓸 Bold 스타일이 없는 글꼴입니다:",
  // Description 채우기 — src/figma/description.ts
  figmaText005: "선택한 Description에서 본문 영역을 찾지 못했습니다.",
  figmaText006: "플립북에서 Description을 찾지 못했습니다.",
  figmaText007: "한 플립북만 선택하세요.",
  // 적용할 때 만드는 본문 레이어와 제목 없는 묶음의 이름
  figmaText008: "본문",
  // 플립북 밖 프레임에 추가하기
  figmaText009: "인스턴스 안의 프레임에는 텍스트를 추가할 수 없습니다.",
  figmaText010: "프레임에서는 불러올 수 없습니다. 플립북이나 텍스트를 선택하세요.",
  // 프레임에 추가할 때 묶음들을 감싸는 오토 레이아웃 프레임의 이름
  figmaText011: "텍스트",
  // 생성되는 플립북 문구 — src/figma/flipbook.ts
  figmaFlipbook001: '플립북 페이지를 찾을 수 없습니다.', // 37
  figmaFlipbook002: '플립북 템플릿 프레임을 찾을 수 없습니다. 관리에서 다시 지정하세요.', // 49
  figmaFlipbook003: 'UI Title 제목 텍스트', // 58
  figmaFlipbook004: 'UI Title 안의 Status', // 59
  figmaFlipbook005: 'GUI Image Slot 프레임', // 60
  figmaFlipbook006: 'Update History List 안의 List', // 61
  figmaFlipbook007: '캔버스에서 플립북 템플릿 프레임을 선택하세요.', // 68
  figmaFlipbook008: '선택한 노드가 플립북 템플릿 프레임이 아닙니다.', // 70
  figmaFlipbook009: "템플릿에 필요한 영역이 없습니다:", // 72
  figmaFlipbook010: "태그 컴포넌트(", // 95
  figmaFlipbook011: ")를 템플릿과 같은 페이지(", // 95
  figmaFlipbook012: ")에서 찾을 수 없습니다.", // 95
  figmaFlipbook015: 'GUI Image Slot이 없습니다.', // 276
  figmaFlipbook016: '확정 이미지가 파일에 없습니다. DATA 페이지 보존 노드를 확인하세요.', // 279
  figmaFlipbook017: '이력 행(Update History) 컴포넌트를 찾을 수 없습니다.', // 296
  figmaFlipbook018: "팀 표시 variant 「", // 309
  figmaFlipbook019: "」가 없습니다.", // 309
  figmaFlipbook020: 'List 슬롯이 없습니다.', // 315
  figmaFlipbook021: '플립북의 시스템 영역(UI Title·Update History List·GUI Image Slot)이 지워졌거나 바뀌었습니다. 복구한 뒤 다시 시도하세요.', // 368
  figmaFlipbook022: 'GUI 이미지 비율이 바뀌었습니다. 콜아웃·레이아웃을 확인하세요.', // 381
  figmaFlipbook023: 'GUI 원본 프레임을 찾을 수 없습니다:',
  figmaFlipbook024: 'Flipbook-Title 안의 Chapter·Page title 칸',
  figmaFlipbook025: '을(를) 슬롯으로 바꿔 주세요',
  figmaFlipbook026: 'GUI 글꼴을 불러오지 못해 글자를 줄이지 못했습니다. 글꼴을 설치한 뒤 다시 반영하세요:',
  figmaFlipbook027: '프레임이 없어 반영하지 않았습니다. 목록에서 삭제하세요.',
  figmaFlipbook028: '플립북에서 GUI 영역으로 연결한 프레임이 지워졌거나 바뀌었습니다. 복구한 뒤 다시 시도하세요.',
  // 템플릿 연결 — src/figma/template.ts
  figmaTemplate001: '연결한 컴포넌트를 찾을 수 없습니다. 다시 연결하세요.',
  figmaTemplate002: '텍스트 레이어를 연결하세요.',
  figmaTemplate003: '태그 인스턴스나 텍스트를 연결하세요.',
  figmaTemplate004: '레이어를 넣을 수 없는 칸입니다. 슬롯이나 인스턴스 밖 프레임을 연결하세요.',
  figmaTemplate005: '인스턴스 밖 프레임을 연결하세요.',
  figmaTemplate006: '인스턴스나 텍스트를 연결하세요.',
  figmaTemplate007: '연결해야 플립북을 만들 수 있습니다.',
  figmaTemplate008: '「Screen ID 칸」을 연결했으면 이 컴포넌트도 연결해야 합니다.',
  figmaTemplate009: '「이력 목록」을 연결했으면 이 컴포넌트도 연결해야 합니다.',
  figmaTemplate010: '「이력 목록」도 연결해야 이 칸에 이력을 넣습니다.',
  figmaTemplate011: '컴포넌트 안에 글자를 넣을 텍스트 레이어가 없습니다.',
  figmaTemplate012: '레이어 이름 규칙으로 찾지 못했습니다.',
  figmaTemplate013: '캔버스에서 연결할 레이어를 선택하세요.',
  figmaTemplate014: '이 항목에는 레이어를 하나만 연결합니다. 하나만 선택하세요.',
  figmaTemplate015: '템플릿 프레임 안의 레이어를 선택하세요.',
  figmaTemplate016: 'GUI 영역·Description 본문·Screen ID 칸 안의 레이어는 연결할 수 없습니다.',
  figmaTemplate017: '먼저 「이력 행」 컴포넌트를 연결하세요.',
  figmaTemplate018: '이력 행 컴포넌트 안의 레이어를 선택하세요. 템플릿에 놓인 이력 행 인스턴스 안에서 골라도 됩니다.',
  figmaTemplate019: '라이브러리 컴포넌트는 이력 행으로 연결할 수 없습니다. 이 파일의 컴포넌트를 선택하세요.',
  figmaTemplate020: '컴포넌트나 인스턴스를 선택하세요.',
  figmaTemplate021: 'GUI 영역은 필수라 연결을 풀 수 없습니다.',
  figmaTemplate022: '이력 행 안의 레이어는 「이력 행 안의 칸」 항목에 연결하세요.',
  figmaTemplate023: '이력 행 컴포넌트가 연결되지 않아 이력을 넣지 않았습니다. 관리의 템플릿에서 「이력 행」을 연결하세요.',
  // 기본 템플릿 — src/figma/templateDefault.ts (페이지·레이어 이름과 템플릿에 적힌 글자)
  figmaTemplate024: '기본 템플릿 글꼴(Inter Regular·Medium·Bold)을 불러오지 못했습니다. 글꼴을 확인한 뒤 다시 시도하세요.',
  figmaTemplate025: 'Flipbook Template',
  figmaTemplate026: 'Flipbook Template',
  figmaTemplate027: 'Tag',
  figmaTemplate028: 'Status',
  figmaTemplate029: 'Screen ID Tag',
  figmaTemplate030: 'SCREEN_ID',
  figmaTemplate031: 'History Row',
  figmaTemplate032: 'Comment',
  figmaTemplate033: 'Name',
  figmaTemplate034: 'GUI',
  figmaTemplate035: 'MM/DD HH:mm',
  figmaTemplate036: 'Chapter',
  figmaTemplate037: 'Flipbook Title',
  figmaTemplate038: 'Description',
  figmaTemplate039: 'Update History',
  // GUI 레이어 복사 — src/figma/layers.ts
  figmaLayers001: 'GUI 썸네일 (자동 관리)',
  figmaLayers002: '컴포넌트 연결을 모두 끊지 못했습니다. 중첩이 너무 깊습니다.',
  figmaLayers003: '프레임·컴포넌트·인스턴스만 복사할 수 있습니다.',
  // 생성되는 DATA 페이지 문구 — src/figma/data.ts
  figmaData001: '[DATA] GUI·UI 배포 기록', // 15
  figmaData002: '표시용 글꼴을 불러오지 못했습니다.', // 41
  figmaData003: '기록 없음', // 132
  figmaData004: '화면', // 145
  figmaData005: '카테고리', // 145
  figmaData006: '기본 화면', // 145
  figmaData007: '사용', // 145
  figmaData008: 'GUI 버전', // 146
  figmaData009: 'GUI 태그', // 146
  figmaData010: 'UI 버전', // 146
  figmaData011: 'UI 태그', // 146
  figmaData012: '플립북 반영', // 147
  figmaData013: '내부 ID', // 147
  figmaData014: '구분', // 151
  figmaData015: '날짜·시각', // 151
  figmaData016: '버전', // 151
  figmaData017: '상태 태그', // 152
  figmaData018: '설명', // 152
  figmaData019: '작업자', // 152
  figmaData020: '화면 현황', // 213
  figmaData021: "파일 내부 기록에서 자동 생성 · 마지막 갱신", // 213
  figmaData022: ". 이 표를 직접 고쳐도 기록은 바뀌지 않습니다.", // 213
  figmaData023: '배포 이력', // 224
  figmaData024: 'GUI·UI 기록을 합치거나 대응시키지 않고 각각 별도 행으로 최신순 표시합니다. 정렬 순서는 GUI 변경의 UI 반영 여부를 뜻하지 않습니다.', // 224
  figmaData025: "(정정됨 · 원문:", // 228
  figmaData026: 'DATA 페이지를 찾을 수 없습니다.', // 236
  figmaData027: '이미지 보존', // 264
  figmaData028: '확정 이미지 보존', // 267
  figmaData029: '배포한 GUI 이미지를 파일에 남기기 위한 노드입니다. 지우면 해당 이미지가 파일에서 사라질 수 있습니다.', // 268
  figmaData030: "조각", // 282

  // src/ui/preview.ts
  uiPreview001: 'GUI 원본', // 12
  uiPreview002: '홈 메인', // 14
  uiPreview003: '홈 메인 - 프로필 선택', // 14
  uiPreview004: 'GNB 펼침', // 14
  uiPreview005: 'VOD 상세', // 14
  uiPreview006: 'VOD 상세 - 시즌 선택', // 14
  uiPreview007: 'EPG 전체 편성표', // 15
  uiPreview008: 'EPG 채널 상세', // 15
  uiPreview009: '검색 결과', // 15
  uiPreview010: '앱 목록', // 15
  uiPreview011: '버튼 모음 (화면 아님)', // 15
  uiPreview012: '[DATA] GUI·UI 배포 기록', // 18
  uiPreview013: '미리보기 사용자', // 39
  uiPreview014: 'UI 플립북', // 42
  uiPreview015: '프레임을 찾을 수 없습니다.', // 50
  uiPreview016: "GUI 레이어 복사 →", // 55
  uiPreview017: "연결 표식", // 65
  uiPreview018: "개 지움", // 65
  uiPreview019: 'DATA 페이지 생성', // 70
  uiPreview020: "DATA 페이지 갱신: 화면", // 74
  uiPreview021: "개 · 이력", // 74
  uiPreview022: "행 · 보존 이미지", // 74
  uiPreview023: "개", // 74
  uiPreview024: "플립북 Section 이름 변경 →", // 88
  uiPreview025: "플립북 반영 →", // 93
  uiPreview026: "· 상단", // 93
  uiPreview027: "· 최신", // 93
  uiPreview028: "· 이전", // 93
  uiPreview029: "행", // 93
  uiPreview030: "캔버스 이동 →", // 99
  uiPreview031: "가짜 GUI 원본", // 114
  uiPreview032: ' · 연결됨', // 115
  uiPreview033: "수정", // 116
  uiPreview034: "이름", // 116
  uiPreview035: "복제", // 117
  uiPreview036: "삭제", // 117
  uiPreview037: "가짜 플립북", // 118
  uiPreview038: "Description 수정", // 119
  uiPreview039: "회", // 119
  uiPreview040: "조작 후 플러그인의", // 121
  uiPreview041: "변경사항 확인", // 121
  uiPreview042: "을 누르세요.", // 121
  uiPreview043: "저장 데이터 초기화", // 121
  uiPreview044: "내용 수정 (", // 128
  uiPreview045: ' (신)', // 129
  uiPreview046: "이름 변경", // 129
  uiPreview047: "사본", // 130
  uiPreview048: "복제 (화면 ID까지 복사됨)", // 130
  uiPreview049: "플립북 Description 수정 (", // 132
  uiPreview050: "회)", // 132
  // 가짜 캔버스에서 골라 둔 텍스트 레이어의 처음 내용(텍스트 편집 탭)
  uiPreview051: "**Policy**\n- 채널 목록은 번호 순서로 보여 줍니다.\n\t- 시청 중인 채널에 **포커스**를 둡니다.\n- 좌우 키로 날짜를 바꿉니다.",
  uiPreview052: "가짜 텍스트 레이어",
  uiPreview053: "플러그인 명령",
  uiPreview054: "플립북 옮김:",
  uiPreview055: "플립북 화면 구성:",
  // 미리보기 도구: 가짜 캔버스에서 플립북 프레임을 모두 고르거나 선택을 푼다(PDF 저장 탭 확인용)
  uiPreview056: "플립북 프레임 모두 선택",
  uiPreview057: "선택 해제",
  uiPreview058: "선택한 레이어",
  uiPreview059: "템플릿 연결:",
  uiPreview060: "기본 템플릿을 만들었습니다.",
} as const;

// 화면·안내·오류 문구. 원본 파일과 행은 추출 당시 위치다.
