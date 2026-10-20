# AGENTS.md (Codex 등 다른 에이전트용)

이 저장소의 규칙은 `CLAUDE.md`에 있다(전역 규칙 + `## 프로젝트 규칙 (lablog-v2)`). **먼저 `CLAUDE.md`와 `docs/HANDOFF.md`를 읽는다.** 아래는 요약이다.

- 작업 폴더/브랜치: 이 폴더(`lablog-v2`)의 **`v2` 브랜치**만. `main`과 `../lab`은 건드리지 않는다.
- 개발 전에 읽을 문서: `docs/Intent.md`, `docs/planning/{문제정의,prd,IA,uj}.md`, `docs/phase9/erd.md`, `GLOSSARY.md`, `docs/adr/`, `docs/specs/NNN-*/{spec,plan}.md`.
- 순서: Intent → Spec → Plan → 사용자 확인 → 구현 → 검증 → 문서 갱신. 지금 대상은 `docs/specs/001-구조-재구성/`(확정 대기).
- 코드: TypeScript strict, 파일 목표 200줄·한도 300줄, 의존 방향 `features → domain`, `data → domain`, domain은 순수. 새 라이브러리 금지(먼저 묻는다).
- 검사 명령: `npm --prefix app run check` (기준: 450 통과, 2 skip), E2E는 `cd app && npx playwright test` (기준: 112 통과, 13 skip).
- 절대 안 한다: 비밀 키(service_role)·비밀번호를 코드·문서·`VITE_` 변수에 넣기, 운영 데이터 삭제 시험, 기존 시험 약화, 강제 push.
- 말투: 한국어, 개발자 용어, 간결하게, 결론 먼저.
