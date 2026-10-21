# Plan: 구조 재구성 (클린 아키텍처, feature-first)

- **상태**: 진행(2/5단계 완료)
- **날짜**: 2026-10-20
- **짝 문서**: [spec.md](./spec.md) (요구사항 FR-1~9, 성공 기준 SC-1~9)
- **작업 의도**: `docs/Intent.md`의 "v2 구조 재구성"

> spec 002에서 전용 검색·템플릿 UI를 제거한 현재 코드 기준으로 2~5단계를 다시 썼다. 사용자가 이 재계획을 확인하기 전에는 2단계를 시작하지 않는다.

## 1. 기술과 버전

`app/package.json`에서 읽은 값(설치된 정확한 버전은 `package-lock.json`).

| 이름 | 버전 범위(package.json) | 용도 | 새로 들이나? |
|---|---|---|---|
| TypeScript | ~6.0.2 | 타입, `strict` | 아니오 |
| React / React DOM | ^19.2.8 | 화면 | 아니오 |
| react-router-dom | ^7.18.4 | 라우팅 | 아니오 |
| Vite / @vitejs/plugin-react | ^8.3.0 / ^6.1.1 | 개발 서버·빌드 | 아니오 |
| Dexie | ^4.4.6 | 로컬 저장소(IndexedDB) | 아니오 |
| @supabase/supabase-js | ^2.118.0 | 서버 저장소 | 아니오 |
| MiniSearch | ^7.2.0 | 검색 | 아니오 |
| Vitest / Testing Library / fake-indexeddb / jsdom | ^5.0.5 / ^16.3.3 / ^6.2.6 / ^30.1.3 | 단위·통합 시험 | 아니오 |
| Playwright / @axe-core/playwright | ^1.64.1 / ^4.14.0 | E2E, 접근성 | 아니오 |
| oxlint / prettier | ^1.81.0 / ^3.9.10 | 린트·서식 | 아니오 |

- **새 라이브러리는 들이지 않는다.** 줄 수·import 경계 규칙은 oxlint 설정(`.oxlintrc.json`)으로 한다. oxlint가 `max-lines`와 경로별 `no-restricted-imports`를 지원하는지는 1단계에서 먼저 확인한다(Q-1). 지원하지 않으면 vitest 시험(`src/tests/architecture.test.ts`)이 파일을 읽어 줄 수와 import를 검사한다.
- 서버: Supabase `lablog-v2`(변경 없음). 표·정책 변경 없음(마이그레이션 없음).

## 2. 구조와 파일

**목표 폴더**(의존 방향: `features → domain`, `features → shared`, `data → domain`, `app → 전체`. `domain`은 아무것도 import하지 않는다.)

```text
app/src/
  domain/            순수 모델·규칙·계산(react, data, features를 import하지 않음)
    types.ts rules.ts progress.ts
    stats/ analysis/ insights/ requirements/   ← services의 순수 계산을 옮긴다
  data/              Repository 계약과 어댑터
    repositories/    index.ts(계약)  contract.test.ts(공용 계약 시험)
    local/ remote/ supabase/ seed/
  features/
    experiments/     pages, components, hooks, service (개요·단계·수행·조건결과·편차·새 실험)
    projects/        pages, components, hooks (현황·데이터·분석·요구)
    requirements/    요구 편집·판정
    data-hub/        /data 표·분석·내보내기
    trash/
    home/
    settings/        설정, 백업·가져오기, 이전, 저장 위치
    auth/            로그인, 계정 컨텍스트, SupabaseGate
  shared/            ui(EmptyState, Toast, ConfirmDialog …), hooks(useDebouncedSave …), format, text
  app/               routes, AppShell, BackendContext(구성 지점: 여기서만 data 구현을 만든다)
  styles/ tests/ main.tsx
```

**300줄 초과 파일 10개 분리안**(빈 줄·주석 제외, 공개 export는 유지하고 내부만 나눈다)

| 파일 | 코드 줄 | 나누는 방향 |
|---|---|---|
| `data/local/localBackend.ts` | 438 | 저장소별(projects, experiments, steps, dataItems, templates, deviations, backup) 파일로, 조립은 `localBackend.ts` |
| `pages/SettingsPage.tsx` | 436 | 섹션 컴포넌트(저장 위치, 백업, 사용 기록, 수행 모드, 예시 데이터, 오류 기록)로 |
| `app/phase5.test.tsx` | 398 | 시나리오 책임별 시험 파일로 |
| `tests/contracts/backend.contract.ts` | 397 | 계약 시나리오별 시험 파일로 |
| `data/remote/remoteBackend.ts` | 391 | `modify`·공통, 저장소별, backup으로 (local과 같은 분할) |
| `components/AnalysisView.tsx` | 360 | 컨트롤, 산점도, 추세, 이상치 목록으로 |
| `pages/RunPage.tsx` | 353 | 단계 카드, 진행 헤더, 편차 패널로 |
| `components/DataGrid.tsx` | 316 | 표 본문, 머리글, 필터로 |
| `services/insights.ts` | 311 | 빠짐 점검 규칙별(`gaps/*`)로 |
| `services/phase5.test.ts` | 306 | 서비스 시나리오별 시험 파일로 |

**요구사항 ↔ 파일**

| 요구사항 | 파일 | 단계 |
|---|---|---|
| FR-1, FR-2 | `.oxlintrc.json`(또는 `src/tests/architecture.test.ts`), `CLAUDE.md` | 1, 5 |
| FR-3 | 위 9개 파일과 새 분할 파일 | 2 |
| FR-4 | `src/**` 이동, `tsconfig` paths 없음(상대 경로 유지) | 3 |
| FR-5, FR-6 | `data/repositories/contract.test.ts`(기존 `runBackendContract` 이동·확장), `remote.contract.test.ts` | 4 |
| FR-7 | 기존 시험·E2E (수정 없음) | 매 단계 |
| FR-8 | `src/tests/ia-routes.test.ts` | 4 |
| FR-9 | `services/migrate.test.ts` + 설정의 가져오기 | 5 |

## 3. 단계별 접근

각 단계가 끝나면 `npm run check`와(화면 이동이 있으면) E2E가 통과해야 한다. 단계마다 커밋·push(`v2` 브랜치). 시험 파일은 import 경로 외에는 고치지 않는다. 한 단계 안에서도 파일 한두 개씩 옮기고 시험을 돌린다.

| 단계 | 목표 | 바꾸는 파일 | 끝났는지 확인 | 되돌리는 법 |
|---|---|---|---|---|
| 1 ✔ | 기준선과 규칙 도입(경고 수준) | `.oxlintrc.json`, `docs/specs/001-구조-재구성/baseline.md` | 2026-10-20 완료. `check` 450/2, E2E 112/13, Q-1 해소 | 커밋 되돌리기 |
| 2 ✔ | 300줄 초과 10개 분리 | 위 10개 파일(+새 파일) | 2026-10-21 완료. max-lines 위반 0건, `npm run check` 448 pass/2 skip | 파일별 커밋 되돌리기 |
| 3 | `domain` 순수화와 `features/*`·`shared`로 이동 | `src/**`(기능 하나씩: trash → settings/auth → requirements → data-hub → projects → experiments(목록 검색 포함) → home) | 기능 하나 이동할 때마다 `check` 통과, 마지막에 E2E 112 pass/13 skip, 최상위 `pages/components/services/hooks` 제거(SC-5) | 기능 단위 커밋 되돌리기 |
| 4 | `data` 정리, 계약 시험 단일화, 충돌 시험, IA-라우트 시험 | `data/**`, `contract` 시험, `ia-routes.test.ts` | SC-6, SC-7 통과. 서버(v2 Supabase) 계약·RLS 시험은 시험 계정 있을 때만(Q-3) | 커밋 되돌리기 |
| 5 | 규칙 격상과 마무리 | `.oxlintrc.json`(경고 → 오류), 문서 점검, 가져오기 검증 | SC-1~SC-9 모두 확인(못 돌린 것은 No Run과 이유), PRD KR3~KR5 | 규칙만 경고로 되돌림 |

- 위험이 큰 단계는 3(이동 범위가 크다). 기능 하나 단위로 나눠서 오류가 나면 바로 그 기능만 되돌린다.
- `domain`으로 옮길 때 React·`data` import가 있는 계산 파일은 순수 부분과 연결 부분으로 나눈다(예: `useDataHub`는 features, 계산은 domain).

## 4. 테스트 전략

**실행 명령**

```bash
npm --prefix app run check          # 린트 + 타입 + 단위·통합 시험 (기준: 450 통과, 2 skip)
(cd app && npx playwright test)      # E2E (기준: 112 통과, 13 skip), 단계 3·5 필수
npm --prefix app run test:supabase   # 진짜 서버 계약·RLS (v2 시험 계정이 있을 때만, 운영 데이터 삭제 금지)
```

| 성공 기준 | 방법 | 위치 |
|---|---|---|
| SC-1 | 린트 `max-lines` 또는 구조 시험 | `.oxlintrc.json` / `src/tests/architecture.test.ts` |
| SC-2 | 린트 import 경계. 위반 샘플이 실제로 걸리는지 확인하는 시험 1개 | 같은 곳 |
| SC-3 | 기존 vitest 전체 | 기존 `*.test.ts(x)` |
| SC-4 | 기존 Playwright 전체 | `app/e2e/*` |
| SC-5 | 폴더 구조 확인 | `architecture.test.ts`(최상위 폴더 목록) |
| SC-6 | 공용 계약 시험 + 충돌 시나리오(두 클라이언트로 같은 행 수정) | `data/repositories/contract.test.ts` |
| SC-7 | IA 주소 목록(문서)과 `routes.tsx` 비교 | `src/tests/ia-routes.test.ts` |
| SC-8 | 이전·가져오기 시험(메모리 서버) + v2 서버 수동 | `services/migrate.test.ts`, QA 시트 |
| SC-9 | 직접 QA 시트(`docs/phase9/03-QA-체크리스트.md` 형식)로 화면 확인 | QA 시트 |

- 기존 시험을 약하게 고치지 않는다. 시험이 실패하면 코드를 되돌린다.
- 못 돌린 것은 "No Run"과 이유를 보고한다(진짜 서버 시험은 계정이 없으면 No Run).

## 5. 제약과 주의점

| 구분 | 내용 |
|---|---|
| **항상 한다** | 단계마다 `npm run check`, 화면 이동 단계는 E2E, 커밋·push(`v2`), 문서(IA·Intent·baseline) 갱신 |
| **먼저 묻는다** | 새 라이브러리, 표 구조 변경, 사용자에게 보이는 동작·문구 변경, spec 밖의 정리(겸사겸사 리팩터링) |
| **절대 안 한다** | `main`·`../lab` 변경, 기존 시험 약화, 운영 데이터 삭제 시험, 비밀 키를 코드·문서에 넣기, 강제 push |

- **비밀 키**: `.env.local`(git 제외)에만 공개용 키를 둔다. service_role 금지.
- **속도**: 번들 크기·초기 로딩은 v1보다 나빠지지 않는다(단계 3 후 `npm run build`의 청크 크기 비교, 메인 약 321 KB 기준).
- **지금 돌아가는 기능을 깨지 않기**: 공개 동작은 시험 450개·E2E 112개가 지킨다. 이동은 `git mv`로 이력을 보존한다.
- **되돌리기**: 단계·기능 단위 커밋이라 `git revert`로 되돌린다. 마이그레이션이 없어 데이터는 영향 없다.
- **끝나면**: Intent 상태 갱신, IA(Component Reuse Map)·PRD KR 갱신, `docs/specs/001/baseline.md`에 전후 비교 기록.
