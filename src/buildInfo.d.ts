// build.mjs가 esbuild define으로 넣는 빌드 정보. 테스트처럼 번들 없이 실행하면 없으므로 typeof로 확인하고 쓴다.
declare const __PLUGIN_VERSION__: string;
declare const __PLUGIN_RELEASE__: boolean;
