// build.mjs가 esbuild define으로 넣는 빌드 정보. 테스트처럼 번들 없이 실행하면 없으므로 typeof로 확인하고 쓴다.
declare const __PLUGIN_VERSION__: string;
declare const __PLUGIN_RELEASE__: boolean;
// 파일 기록에 남길 배포 버전(배포본은 태그, 개발 빌드는 포함한 마지막 배포 태그, 없으면 '')
declare const __PLUGIN_BASE__: string;
