// Kept separate from production copy so release bundles can discard the entire tool.
export const FLOW_REPAIR_COPY = {
  title: '플로우 연결 복구',
  find: '선택한 이미지 확인',
  hint: '캔버스에서 플로우의 이미지 사각형을 선택하세요. 표식이 있으면 화면을 자동 배정하며, 없으면 화면을 선택합니다. 적용하면 최신 배포 썸네일로 동기화합니다.',
  grouping: '플로우 표식이 없는 이미지는 이번 선택을 하나의 플로우로 등록합니다.',
  scanning: '선택한 이미지 확인 중',
  running: '플로우 연결 복구 중',
  empty: '선택한 이미지 사각형이 없습니다.',
  screen: '화면 선택',
  auto: '표식으로 배정',
  manual: '화면 선택 필요',
  submit: '연결 복구 및 동기화',
  close: '닫기',
  done: '연결을 복구하고 동기화한 이미지:',
  changed: '이미지 또는 배포 화면이 변경되었습니다. 선택한 이미지 확인을 다시 실행하세요.',
  missing: '이미지 사각형을 찾을 수 없습니다.',
  unavailable: '선택한 화면의 최신 배포 썸네일이 없어 적용하지 않았습니다.',
} as const;
