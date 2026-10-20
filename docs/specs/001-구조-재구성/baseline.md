# 구조 재구성 기준선

- **날짜**: 2026-10-20
- **브랜치**: `v2`
- **범위**: plan 1단계(기준선과 구조 규칙 도입)
- **코드 변경**: 없음. oxlint 설정과 문서만 변경.

## 검사 기준선

| 검사 | 명령 | 결과 |
|---|---|---|
| 의존성 설치 | `cd app && npm ci` | Pass. 128 packages 설치, 취약점 경고 없음 |
| 린트·타입·단위·통합 | `npm run check` | Pass. 450 passed, 2 skipped |
| E2E | `npx playwright test` | Pass. 112 passed, 13 skipped(16.3분) |

## oxlint 지원 확인

설치된 oxlint 1.81.0의 `configuration_schema.json`과 실제 실행으로 확인했다.

- `max-lines`: 지원. `{ "max": 300, "skipBlankLines": true, "skipComments": true }`를 경고 수준으로 적용했다.
- 경로별 import 제한: `overrides.files`와 `no-restricted-imports`를 함께 지원한다.
- domain: React·React DOM·Dexie·Supabase와 `data/features/app` 경로 import를 경고한다.
- features: `data/local`, `data/remote`, `data/supabase` 구현 import를 경고한다. Repository 계약 import는 허용한다.
- 실제 위반 probe를 임시로 만들어 domain의 React/data import와 feature의 data 구현 import가 모두 경고되는 것을 확인하고 probe는 제거했다.

현재 import 경계 위반은 0건이다.

## 300줄 초과 목록

빈 줄과 주석을 제외한 oxlint `max-lines` 기준이다. 총 10개(제품 코드 7개, 시험 3개)다.

| 파일 | 원본 줄 | 코드 줄 | 구분 | plan 2단계 분리 방향 |
|---|---:|---:|---|---|
| `src/data/local/localBackend.ts` | 471 | 438 | 제품 | 저장소별 구현과 backup 분리 |
| `src/pages/SettingsPage.tsx` | 466 | 436 | 제품 | 설정 섹션 컴포넌트 분리 |
| `src/app/phase5.test.tsx` | 441 | 398 | 시험 | 시나리오 책임별 분리 |
| `src/tests/contracts/backend.contract.ts` | 450 | 397 | 시험 | 계약 시나리오별 분리 |
| `src/data/remote/remoteBackend.ts` | 431 | 391 | 제품 | 공통 modify·저장소별 구현·backup 분리 |
| `src/components/AnalysisView.tsx` | 384 | 360 | 제품 | 컨트롤·차트·이상치 목록 분리 |
| `src/pages/RunPage.tsx` | 381 | 353 | 제품 | 진행 헤더·단계 카드·편차 패널 분리 |
| `src/components/DataGrid.tsx` | 339 | 316 | 제품 | 머리글·필터·표 본문 분리 |
| `src/services/insights.ts` | 382 | 311 | 제품 | 빠짐 점검 규칙별 분리 |
| `src/services/phase5.test.ts` | 332 | 306 | 시험 | 서비스 시나리오별 분리 |

`analysis.ts`와 `stats.ts`는 원본 줄 수는 300을 넘지만 빈 줄·주석 제외 기준으로는 300 이하라 위반이 아니다.

## 현재 구조

`src` 최상위에 `app`, `components`, `data`, `domain`, `hooks`, `pages`, `services`, `styles`, `tests`가 있다. 목표 구조의 `features`, `shared`는 아직 없고 `pages/components/services/hooks` 제거는 plan 3단계 대상이다.

## 1단계 결론

- Q-1 해소: oxlint만으로 줄 수와 경로별 import 제한을 구현할 수 있어 별도 architecture 시험이나 새 라이브러리가 필요 없다.
- 규칙은 기존 위반 때문에 계획대로 `warn`이며 plan 5단계에서 위반 0건 확인 후 `error`로 올린다.
- plan 문서의 “300줄 초과 9개”는 QA-001 측정 결과에 따라 10개로 정정한다.
- `npm run check`와 전체 E2E가 기존 기준선 수치 그대로 통과해 사용자 동작 변경은 확인되지 않았다.
