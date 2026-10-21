# CLAUDE.md

작업 원칙과 확정된 결정은 아래 AGENTS.md를 따른다.

@AGENTS.md

## Claude Code

- 실제 Figma 확인은 Figma MCP(`use_figma`)로 할 수 있다. 쓰기 전에 Figma 플러그인 스킬(figma-use)을 불러오고, 팀이 쓰는 작업 파일이 아니라 시험 파일에서 한다.
- 결과를 보고할 때 로컬 검사로 확인한 것과 실제 Figma에서 확인한 것을 구분해 적는다.
- 사용자 문구·튜토리얼·안내 문서를 고칠 때는 화면에 실제로 보이는 이름(예: 「관리」)과 맞는지 `src/core/copy.ts`에서 확인한다.
