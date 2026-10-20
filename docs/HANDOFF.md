# 인수인계 (2026-10-20)

다른 에이전트(Codex 등)로 이어서 작업하기 위한 현재 상태.

## 한 줄 상태
구조 재구성 1단계는 완료. spec/plan 002를 확정해 “편리한 실험 등록·한눈에 보는 기록”을 구현했고 Chromium 핵심 회귀까지 통과했다. Firefox/WebKit·접근성 전체 재검증과 직접 QA가 남았다.

## 저장소·환경
- GitHub `jgi0117/lablog`(PUBLIC), 브랜치 `v2`. 로컬 폴더 `…\DAY2\lablog-v2`(clone). `main`은 lablog 운영(Vercel `lablog-kgt8`이 배포).
- v2용 Supabase: 프로젝트 `lablog-v2`, ref `wqemjezcdakwrjuztdlt`, 서울. 표 7개·RLS·프로필 트리거 적용 완료, 보안 점검 0건. 운영자 계정은 아직 없음(사용자가 대시보드에서 만들어야 함). `app/.env.local`(git 제외)에 공개용 키 설정됨.
- 앱 동작 코드는 lablog v1 복사본(변경 없음). 기준: `npm --prefix app run check` 450 통과·2 skip, E2E 112 통과·13 skip. 빈 줄·주석 제외 300줄 초과 파일 10개.

## 문서 현황 (모두 `v2` 브랜치에 있음)
| 문서 | 상태 |
|---|---|
| `docs/planning/문제정의.md` | 완료(v2 목표·성공 기준 SC-A~F) |
| `docs/planning/prd.md` | v2로 다시 씀 |
| `docs/planning/uj.md` | Journey 5~7 추가 |
| `docs/planning/IA.md` | 데이터 허브·로그인·이전·내비 6개 반영 |
| `docs/phase9/erd.md` | v2 메모 추가(표 구조 변경 없음) |
| `GLOSSARY.md`, `docs/adr/0001~0003` | 완료 |
| `docs/Intent.md` | v2 구조 재구성 항목 추가 |
| `docs/specs/001-구조-재구성/{spec,plan}.md` | 1단계 완료, spec 002 확정 전까지 후속 단계 보류 |
| `docs/specs/001-구조-재구성/baseline.md` | 1단계 기준선·위반 목록 기록 완료 |
| `docs/specs/002-핵심-실험-경험/spec.md` | 확정 |
| `docs/specs/002-핵심-실험-경험/plan.md` | 확정, 구현 진행(교차 브라우저 QA 대기) |
| `docs/qa/QA-002-핵심-실험-경험.md` | Chromium 중간 결과 기록, 최종 QA 대기 |
| 남음 | 접근성 전체 재실행, Firefox/WebKit 전체 회귀, 직접 30초/10초 QA, 001 후속 재계획 |

## 사용자가 해야 하는 것 (에이전트가 못 함)
1. Supabase 대시보드: `lablog-v2`에 운영자 계정 만들기(Auto Confirm), Confirm email 끄기, 가입 닫기, Site URL/Redirect URLs 등록.
2. Vercel 대시보드: v2 전용 프로젝트(Root `app`, Production Branch `v2`, 환경 변수 `VITE_DATA_BACKEND=supabase`, `VITE_SUPABASE_URL=https://wqemjezcdakwrjuztdlt.supabase.co`, `VITE_SUPABASE_ANON_KEY=`(공개용 publishable 키)).
3. 기관 보안 정책 확인(외부 클라우드 저장).

## 열린 질문
- oxlint 1.81.0이 `max-lines`와 경로별 `no-restricted-imports`를 지원함(1단계에서 확인·경고 적용).
- QA 13번(두 탭 충돌 안내 없음) 원인 미확인 → v2 계약 시험으로 재현.
- lablog `main`의 unpushed 문서 커밋이 `v2`에 포함되어 공개됨(저장소 PUBLIC).

## 다음 작업
1. `npm run check` 재확인 후 Chromium 전체 접근성 검사를 완료한다.
2. Firefox/WebKit 전체 Playwright를 브라우저별로 실행하고 환경 실패와 코드 실패를 분리한다.
3. 직접 30초 등록·10초 파악 QA 후 QA-002를 완료 처리한다.
4. 001의 2~5단계를 줄어든 제품 범위에 맞춰 재계획한다.

## 에이전트 간 차이
- Claude의 전역 스킬(`~/.claude/skills`: grill-with-docs, write-spec-plan 등)은 Codex에서 자동으로 안 보인다. 같은 절차는 `.claude/skills/write-spec-plan/`(저장소 안)의 SKILL.md와 템플릿을 읽고 따라 하면 된다.
