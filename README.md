# GUI·UI Publish

GUI팀과 UI팀이 한 Figma 파일에서 함께 쓰는 플러그인입니다. GUI팀이 원본 화면을 고쳐 배포하면 그 화면을 쓰는 UI팀의 플립북(화면설계서 페이지)에 최신 GUI가 바로 들어가고, 어떤 화면이 언제 바뀌었는지 기록으로 남습니다. 외부 서버 없이 모든 기록을 Figma 파일 안에 저장합니다.

- **GUI Publish** (GUI 담당): 원본 화면을 지난 배포와 비교해 바뀐 화면을 찾고, 화면 이름·Screen ID·카테고리를 정해 배포합니다.
- **UI Flipbook** (UI 담당): 화면을 골라 플립북을 만들고, GUI가 다시 배포된 플립북을 확인해 상태·코멘트를 남깁니다.

## 최신 버전 받기

**[GUIUIPublish.zip 받기](https://github.com/ynjoh9494/gui-ui-publish/releases/latest/download/GUIUIPublish.zip)**

항상 가장 최근 버전을 받는 링크입니다. 버전별 내용은 [Releases](https://github.com/ynjoh9494/gui-ui-publish/releases)에 있습니다.

### 설치 (Figma 데스크톱 앱에서 한 번만)

1. zip 압축을 풀고, 지우지 않을 폴더에 둡니다(예: `문서\FigmaPlugins\GUIUIPublish`).
2. Figma 데스크톱 앱 메뉴에서 **Plugins → Development → Import plugin from manifest…** 를 누릅니다.
3. 압축을 푼 폴더 안의 `manifest.json`을 고릅니다.

실행은 **Plugins → Development → GUI·UI Publish** 에서 **GUI Publish** 또는 **UI Flipbook**을 고릅니다.

### 사용법과 업데이트

- 머리의 「창 접기」 버튼으로 작은 바만 남길 수 있습니다. 「창 펼치기」로 이전 크기와 작업 화면으로 돌아옵니다.

- zip 안의 `GUIUIPublish-Guide.html`을 브라우저로 열면 용도, 전체 흐름, 초기 세팅, 기능별 사용법을 그림과 함께 볼 수 있습니다. 플러그인 창 오른쪽 위의 파란 물음표 버튼은 튜토리얼입니다.
- 새 버전은 zip을 받아 처음 설치한 폴더에 덮어쓰고 플러그인을 다시 실행하면 됩니다.

---

## 개발·인계

이 레포에 플러그인의 소스, 문서, 배포 설정이 모두 있습니다. 처음 맡는 사람은 아래 순서로 읽습니다.

1. [AGENTS.md](AGENTS.md): 작업 원칙과 지켜 온 결정(사람·AI 공통). Claude Code는 [CLAUDE.md](CLAUDE.md)로 같은 내용을 읽습니다.
2. [BEHAVIOR.md](BEHAVIOR.md): 사용자가 보는 동작과 확정된 화면 정책
3. [ARCHITECTURE.md](ARCHITECTURE.md): 코드 경계와 데이터 흐름
4. [CONVENTION.md](CONVENTION.md): 코드를 바꿀 때 지킬 기준
5. [PERFORMANCE_REVIEW.md](PERFORMANCE_REVIEW.md): 측정된 병목과 개선 근거

### 화면 추적과 GUI 목록

UI Flipbook은 플립북 목록 · GUI 목록 · 텍스트 편집기 · 플로우 편집기 · PDF 저장 탭으로 구성됩니다. GUI 목록에서 캔버스에 놓은 화면은 플립북 밖에서도 GUI 배포를 따라갑니다. 새 템플릿 플립북의 화면 목록은 캔버스의 실제 소속으로 읽으며, 화면을 넣고 빼는 일은 이력을 만들지 않습니다. 화면별 추적 목록에서 붙인 GUI와 플로우의 위치를 찾습니다. 상세 정책과 이전 STB 템플릿 호환 범위는 [BEHAVIOR.md](BEHAVIOR.md)의 「추적 GUI」를 확인합니다.

### 준비

Node.js 22.18 이상이 필요합니다(TypeScript 테스트를 Node로 바로 실행). 실행 의존성은 PDF 저장 탭에서 쪽 이미지를 한 PDF로 묶는 `pdf-lib` 하나이며 `dist/ui.html`에 함께 묶입니다(네트워크를 쓰지 않음). 브라우저 미리보기 조작 스크립트는 Chrome을 씁니다(`CHROME_PATH`로 경로 지정).

```sh
npm install
npm run check
```

### 명령

| 명령 | 하는 일 |
|---|---|
| `npm run check` | 타입 검사, 테스트, 빌드. 커밋 전에 실행하고, GitHub에서도 main push·PR마다 실행됩니다 |
| `npm run build` | `dist/code.js`, `dist/ui.html`(Figma용)과 `dist/preview.html`(브라우저 미리보기)을 만듭니다 |
| `npm run walkthrough` | 미리보기에서 GUI 배포 → 플립북 만들기 → GUI 재배포 반영 흐름과 튜토리얼을 자동 조작합니다 |
| `npm run benchmark` | Node 쪽 목록·저장소 계산 성능을 측정합니다 |
| `npm run guide-screens` | 사용 안내 그림(`release/screens/`)을 미리보기 예시 데이터로 다시 찍습니다 |
| `npm run release` | 팀 배포. 아래 「배포」 참고 |

### Figma에서 개발 중인 버전 실행

`npm run build` 후 Figma 데스크톱 앱에서 이 폴더의 `manifest.json`을 불러옵니다(Import plugin from manifest). `dist/`는 git에 올리지 않는 생성물이므로, 다른 브랜치·worktree에서 작업했다면 Figma가 읽는 폴더에서 다시 빌드해야 반영됩니다. 팀원용 zip과 플러그인 ID가 같으므로 둘 중 하나만 불러와 두는 편이 헷갈리지 않습니다.

미리보기와 테스트는 Figma API를 흉내 냅니다. 플러그인 메뉴의 두 명령, 템플릿 복제와 인스턴스 교체, 슬롯(List·input-cell-id) 삽입, 썸네일 JPG 출력, GUI 복사와 1/2x·1/4x 축소, 라이브러리 변수 모드 유지, 큰 화면의 복사 시간과 메모리는 **실제 Figma 시험 파일에서 확인**해야 합니다.

### 폴더 구조

| 경로 | 내용 |
|---|---|
| `manifest.json` | Figma 플러그인 정의(두 명령 `gui`·`ui`, 플러그인 ID) |
| `src/main.ts` | 플러그인 시작점. 메시지를 받아 Controller에 전달하고 파일 쓰기를 순서대로 처리 |
| `src/controller.ts` | 스캔·배포·플립북·관리 작업의 순서와 실패 보고 |
| `src/core/` | Figma와 무관한 판정·계획·기록 모델(저장 키, 지문 비교, 배포 계획, 플립북·이력). 사용자 문구는 `copy.ts` |
| `src/figma/` | Figma API 어댑터(레이어 복사, 썸네일, 지문 판독, 플립북 반영, DATA 페이지) |
| `src/host.ts` | Controller가 쓰는 환경 계약. 실제 Figma와 미리보기용 가짜 환경이 이 계약을 구현 |
| `src/ui/` | 플러그인 창. `demo.ts`는 미리보기·튜토리얼용 가짜 Figma 환경, `tutorial.ts`는 튜토리얼, `fonts/`는 Screen ID 표시 글꼴(Roboto Condensed, SIL OFL 1.1) |
| `test/` | Node 테스트(`npm test`) |
| `scripts/` | 배포(`release.mjs`), 안내 그림 캡처, 미리보기 조작, 성능 측정, 문구 시트 Apps Script(`CopySync.gs`) |
| `release/` | 팀원용 사용 안내 원본(`guide.html`)과 그림 |
| `.github/workflows/` | 검사(`check.yml`)와 배포(`release.yml`) |

### 배포

```sh
npm run release -- --dry-run          # 검사·빌드 후 dist/GUIUIPublish.zip만 만들어 확인
npm run release                       # 다음 패치 버전(v1.0.1 …) 태그를 만들어 push
npm run release -- 1.2.0 --notes "…"  # 버전과 한 줄 릴리스 설명 지정
npm run release -- 1.2.0 --notes-file notes.md  # 여러 줄 설명은 파일로(Windows의 npm은 인자의 첫 줄만 넘깁니다)
```

`npm run release`는 main이 깨끗하고 origin과 같은지 확인하고 `npm run check`를 통과하면 버전 태그를 push합니다. 그러면 GitHub Actions가 그 태그의 코드로 다시 검사·빌드해 zip(`manifest.json`, `dist/code.js`, `dist/ui.html`, 사용 안내 HTML)을 Release에 올립니다. 팀원용 링크(`releases/latest/download/GUIUIPublish.zip`)는 바뀌지 않습니다.

화면이나 흐름이 바뀌면 배포 전에 `release/guide.html` 문구와 `npm run guide-screens` 그림도 함께 고칩니다.

### 문구 관리

사용자에게 보이는 문구는 `src/core/copy.ts`에 모여 있고, Google 시트에서 관리합니다. 시트에 [scripts/CopySync.gs](scripts/CopySync.gs)를 Apps Script로 설치해 씁니다. 시트 주소와 권한은 이전 담당자에게 받습니다(공개 레포라 주소를 적지 않습니다).

### 저장 데이터 호환

기록은 Figma 파일의 `sharedPluginData`(네임스페이스 `guiuipublish`)와 `[자동 관리] DATA` 페이지에 있습니다. 이미 쓰고 있는 파일의 기록이 계약이므로 키·지문 형식을 바꿀 때는 [CONVENTION.md](CONVENTION.md)의 「기록·동시 작업·호환성」을 따릅니다. 이전 버전 데이터는 전체 자동 이관하지 않고 읽기 호환으로 처리합니다. 관리의 「자동 관리 페이지」에서 DATA 연결·갱신과 `[자동 관리] GUI 썸네일` 페이지 생성·이동을 할 수 있습니다. 관리의 「데이터 초기화」는 파일의 기록과 연결 표식을 모두 지웁니다.
