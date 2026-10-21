# 인수인계 (2026-10-21)

다른 에이전트(Codex 등)로 이어서 작업하기 위한 현재 상태.

## 한 줄 상태
구조 재구성 1단계와 spec/plan 002 구현·자동 QA는 완료. “편리한 실험 등록·한눈에 보는 기록”이 Chromium·Firefox·WebKit 기준선(112 pass/13 skip)을 유지하며, 직접 사용성 QA만 남았다.

## 저장소·환경
- GitHub `jgi0117/lablog`(PUBLIC), 브랜치 `v2`. 로컬 폴더 `…\DAY2\lablog-v2`(clone). `main`은 lablog 운영(Vercel `lablog-kgt8`이 배포).
- v2용 Supabase: 프로젝트 `lablog-v2`, ref `wqemjezcdakwrjuztdlt`, 서울. 표 7개·RLS·프로필 트리거 적용 완료, 보안 점검 0건. 운영자 계정은 아직 없음(사용자가 대시보드에서 만들어야 함). `app/.env.local`(git 제외)에 공개용 키 설정됨.
- 앱은 spec 002 기준으로 등록·목록·개요·프로젝트 현황·내비게이션을 재구성했다. 현재 기준: `npm run check` 448 pass·2 skip(총 450), E2E 112 pass·13 skip. 전용 검색·템플릿 UI는 제거했지만 기존 데이터·백업 계약은 유지한다.

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
| `docs/specs/001-구조-재구성/{spec,plan}.md` | 1단계 완료, 2~5단계 재계획 완료·사용자 재확인 대기 |
| `docs/specs/001-구조-재구성/baseline.md` | 1단계 기준선·위반 목록 기록 완료 |
| `docs/specs/002-핵심-실험-경험/spec.md` | 확정 |
| `docs/specs/002-핵심-실험-경험/plan.md` | 구현·자동 QA 완료, 직접 사용성 QA 대기 |
| `docs/qa/QA-002-핵심-실험-경험.md` | 자동 QA 완료(112 pass/13 skip), 직접 QA 대기 |
| 남음 | 직접 30초/10초·실기기 태블릿 QA, 001 재계획 사용자 확인 |

## 사용자가 해야 하는 것 (에이전트가 못 함)
1. QA-002 직접 측정: 준비 실험 저장 30초, 최근 10건 파악 10초, 가능하면 실제 태블릿·장갑 조작.
2. 재작성한 spec 001 plan의 2~5단계 재개 여부 확인.
3. Supabase 대시보드: `lablog-v2`에 운영자 계정 만들기(Auto Confirm), Confirm email 끄기, 가입 닫기, Site URL/Redirect URLs 등록.
4. Vercel 대시보드: v2 전용 프로젝트(Root `app`, Production Branch `v2`, 환경 변수 `VITE_DATA_BACKEND=supabase`, `VITE_SUPABASE_URL=https://wqemjezcdakwrjuztdlt.supabase.co`, `VITE_SUPABASE_ANON_KEY=`(공개용 publishable 키)).
5. 기관 보안 정책 확인(외부 클라우드 저장).

## 열린 질문
- oxlint 1.81.0이 `max-lines`와 경로별 `no-restricted-imports`를 지원함(1단계에서 확인·경고 적용).
- QA 13번(두 탭 충돌 안내 없음) 원인 미확인 → v2 계약 시험으로 재현.
- lablog `main`의 unpushed 문서 커밋이 `v2`에 포함되어 공개됨(저장소 PUBLIC).

## 다음 작업
1. 사용자가 직접 30초 등록·10초 파악·실기기 태블릿 QA를 수행한다.
2. 재작성한 001의 2~5단계 계획을 사용자가 확인한다.
3. 확인 뒤 001의 2단계(300줄 초과 파일 분리)부터 다시 시작한다.

## 에이전트 간 차이
- Claude의 전역 스킬(`~/.claude/skills`: grill-with-docs, write-spec-plan 등)은 Codex에서 자동으로 안 보인다. 같은 절차는 `.claude/skills/write-spec-plan/`(저장소 안)의 SKILL.md와 템플릿을 읽고 따라 하면 된다.
