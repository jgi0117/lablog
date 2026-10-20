# Intent (작업 의도 기록)

작업 하나마다 아래 다섯 항목을 먼저 쓰고, 그 내용으로 개발한다. 새 작업은 **맨 위에** 추가하고 지난 작업은 지우지 않는다.
작성할 때는 기획 문서를 먼저 읽고 어느 부분에 해당하는지 "참조"에 적는다. 문서와 다르게 만들게 되면 그 차이를 "열린 질문"에 적고, 작업이 끝나면 문서도 고친다.

| 문서 | 위치 | 무엇을 보나 |
|---|---|---|
| PRD | `docs/planning/prd.md` | 목표(KR), 기능 범위(s1~s4), 하지 않음, 가정과 열린 질문 |
| IA | `docs/planning/IA.md` | 화면 구조, 주소, 내비게이션, 화면별 내용 순서 |
| UJ | `docs/planning/uj.md` | 4개 사용자 여정, 단계별 감정, 오류 처리 |
| ERD | `docs/phase9/erd.md` | 서버 표 구조, 보안(RLS), 로그인 설계 |
| 데이터 모델 | `docs/phase1/01-데이터-모델.md` | 앱의 도메인 모델과 규칙 |
| 계획·기록 | `docs/planning/devplan.md`, `docs/phaseN/` | 단계별 체크리스트와 완료 기록 |
| Spec / Plan | `docs/specs/NNN-이름/spec.md`, `plan.md` | 이 작업의 요구사항(무엇·왜)과 구현 계획(어떻게). 틀과 절차는 `.claude/skills/write-spec-plan/` |

## 작성 틀

```markdown
## YYYY-MM-DD 작업 이름 (상태: 계획 / 진행 / 완료 / 보류)

**Spec / Plan**: `docs/specs/NNN-이름/spec.md`, `plan.md` (없으면 "생략: 사유")
**참조**: PRD §번호, IA(화면·주소), UJ(Journey 번호), ERD(표 이름) — 어느 문장·화면에 해당하는지

- **문제(Problem)**: 지금 무엇이 불편하거나 되지 않는지
- **기대 결과(Proposed outcome)**: 해결되면 무엇이 어떻게 달라지는지 (확인하는 방법 포함)
- **영향 범위(Affected users and systems)**: 누가 쓰고 어떤 화면·표·서비스가 건드려지는지
- **제약(Constraints)**: 예산, 기한, 지켜야 할 정책, 쓰지 말아야 할 것
- **열린 질문(Open questions)**: 아직 정하지 못한 것 (누가 정하는지)
- **문서 갱신**: 이 작업으로 고쳐야 하는 문서 (고쳤으면 ✔)
```

---

## 2026-10-20 전역 하네스(Global CLAUDE.md)와 스킬 세트 (상태: 완료)

**Spec / Plan**: 생략(개인 설정 작업, 앱 코드 변경 없음)
**참조**: `docs/Intent.md` 워크플로, `write-spec-plan` 스킬, grill-with-docs(mattpocock/skills)

- **문제(Problem)**: 프로젝트를 시작할 때마다 규칙·문서 체계를 다시 설명해야 하고, 긴 지시문에 의존한다.
- **기대 결과(Proposed outcome)**: 새 프로젝트를 열면 먼저 "새 하네스를 만들까요?"를 묻고, 스킬을 불러 문제 정의(grill-with-docs)와 PRD·UJ·IA·ERD·Intent·Spec·Plan을 만든다. 코드 규칙(파일 목표 200줄/한도 300줄 등)이 전역에서 적용된다.
- **영향 범위(Affected users and systems)**: 사용자의 모든 Claude Code 프로젝트. `~/.claude/CLAUDE.md`, `~/.claude/skills/`(grill-with-docs, grilling, domain-modeling, project-kickoff, write-intent, design-erd, write-spec-plan, create-prd, information-architecture, user-journeys). 이 저장소에는 참고용 사본 `docs/harness-global-CLAUDE.md`.
- **제약(Constraints)**: 외부 스킬은 읽은 뒤 설치(마크다운만, 스크립트 없음). 전역 CLAUDE.md는 200줄 이하. 강제가 필요한 규칙은 린터·훅으로 옮긴다.
- **열린 질문(Open questions)**: ① 전역은 "알아서 커밋·push"인데 이 저장소의 CLAUDE.md는 "push는 사용자가 말할 때만"이다. lablog도 자동 push로 바꿀지(사용자). ② 파일 300줄 한도를 lablog 린터(oxlint)에 켤지: 현재 300줄 초과 파일이 9개 있어 먼저 분리가 필요하다(사용자). ③ 한도 강제를 훅으로도 걸지(사용자).
- **문서 갱신**: 전역 CLAUDE.md ✔

---

## 2026-10-20 Spec·Plan 작성 절차 만들기 (상태: 완료)

**Spec / Plan**: 생략(문서 틀 작업)
**참조**: PRD §7.1(문서 구성), 사용자 지시(Intent → Spec → Plan → 개발), Spec Kit·Osmani 방식

- **문제(Problem)**: 작업을 시작할 때 요구사항(무엇·왜)과 구현 계획(어떻게)이 매번 다른 모양으로 쓰이거나 빠져서, 개발이 문서를 근거로 하지 못한다.
- **기대 결과(Proposed outcome)**: 모든 기능 작업이 같은 여섯 칸 spec과 다섯 칸 plan을 쓰고, 사용자 확인 뒤에 개발한다. 요구사항 번호(FR)→성공 기준(SC)→시험이 끊기지 않고 이어진다.
- **영향 범위(Affected users and systems)**: 개발 절차(이후 모든 작업), `.claude/skills/write-spec-plan/`(SKILL.md, spec-template.md, plan-template.md), `CLAUDE.md`, `docs/specs/`. 앱 코드 변경 없음.
- **제약(Constraints)**: 칸 이름과 순서는 사용자 지정 그대로. 쉬운 한국어. 새 라이브러리 금지가 기본. 작은 수정에는 절차를 강요하지 않는다.
- **열린 질문(Open questions)**: ① 첫 적용 대상(두 탭 충돌 안내 / PRD·IA·UJ 정리 / 시험용 프로젝트 중 무엇부터)은 사용자가 정한다. ② 앞선 작업(서버 저장소 전환 등)의 spec/plan을 나중에 소급해서 쓸지(사용자).
- **문서 갱신**: CLAUDE.md ✔, Intent.md 틀 ✔

## 2026-10-20 Vercel 자동 배포 (상태: 진행)

**참조**: PRD §8 출시(첫 버전 범위), PRD §7.4 가정 4(외부 클라우드 저장), devplan Phase 7(가벼운 배포), ERD "로그인 설계"

- **문제(Problem)**: 배포가 GitHub Pages(로그인 없는 로컬 저장소 빌드 또는 변수 설정 필요)뿐이라, 서버 저장소(Supabase)로 도는 최신 앱을 다른 기기에서 열어 볼 주소가 없다.
- **기대 결과(Proposed outcome)**: `main`에 push하면 Vercel이 자동으로 빌드·배포하고, 그 주소에서 로그인하면 서버 저장소의 같은 데이터가 보인다.
- **영향 범위(Affected users and systems)**: 파일럿 사용자 1명(개발팀 개인). Vercel(프로젝트 `lablog`, 루트 `app`), GitHub 저장소 `jgi0117/lablog`, Supabase의 Site URL·Redirect URLs, `app/vercel.json`(새로고침 시 index.html).
- **제약(Constraints)**: 무료(Hobby) 플랜. 공개용(anon/publishable) 키만 환경 변수에 둔다(service_role 금지). 가입은 닫혀 있고 로그인한 계정의 데이터만 보인다. Vercel 연결 도구가 쓰기 권한이 없어(403) 프로젝트 만들기는 사용자가 대시보드에서 한다.
- **확인 결과(2026-10-20)**: 고정 주소 `https://lablog-kgt8.vercel.app/`가 Vercel 로그인 없이 열리고, 앱 로그인 화면이 나온다(Supabase 설정이 빌드에 들어감, 계정 만들기 버튼 없음). 직접 주소(`/experiments`)와 새로고침도 열린다. 아직 확인 못 한 것: 실제 로그인 후 데이터 표시, GitHub push 자동 배포, 이메일 링크 로그인(Site URL 등록 필요).
- **진행 상황**: 사용자가 Vercel에서 `lablog-kgt8` 프로젝트를 가져와 배포 주소 `https://lablog-kgt8-hp4wo029d-gj-380c.vercel.app/`가 생겼다. 접속하면 Vercel 로그인으로 넘어간다(Vercel Authentication 켜짐). 이름이 `lablog`인 빈 프로젝트가 하나 더 있다. 연결 도구는 목록 조회만 되고 프로젝트 상세·배포 조회는 403이라 빌드 결과·환경 변수·Git 연결은 확인하지 못했다.
- **열린 질문(Open questions)**: ① 배포 주소를 Supabase Site URL·Redirect URLs에 등록해야 한다(사용자). 고정 주소(`lablog-kgt8.vercel.app` 형태)를 쓰는 편이 좋다. ② GitHub Pages 배포(`deploy.yml`)를 계속 둘지 끌지(사용자). ③ Vercel 기본 접근 제한(Vercel 로그인 필요)을 끌지(사용자). ④ 비어 있는 `lablog` 프로젝트를 지울지(사용자).
- **문서 갱신**: `docs/phase9/02-설정-가이드.md`에 Vercel 절 추가 (미완)

## 2026-10-20 두 탭 동시 수정 충돌 안내가 서버 저장소에서 안 보임 (상태: 보류, 원인 확인 중)

**참조**: UJ(오류 처리: 다른 곳에서 먼저 고친 경우), IA(실험 상세 개요 `/experiments/:id`), ERD 설계 결정 3(`version`으로 동시 수정 감지), `docs/phase9/03-QA-체크리스트.md` 13번

- **문제(Problem)**: QA 13번에서 같은 실험을 두 탭에서 고치면 충돌 안내 없이 덮어써졌다고 보고됨. 코드상으로는 모든 편집 화면이 처음 읽은 `version`으로 저장하고 서버가 `where version = ?`로 거절하게 되어 있어 재현하지 못했다.
- **기대 결과(Proposed outcome)**: 먼저 저장된 뒤 오래된 화면에서 저장하면 "다른 탭에서 이 항목을 먼저 수정했습니다"와 "내 내용으로 덮어쓰기"가 나온다. 서버 저장소용 자동 시험으로 지킨다.
- **영향 범위(Affected users and systems)**: 모든 편집 화면(개요, 단계, 조건·결과, 프로젝트, 템플릿), `remoteBackend`의 `modify`, `supabaseStore.update`.
- **제약(Constraints)**: 운영 DB에서 데이터를 지우는 시험은 돌리지 않는다. 서버 저장소에는 로컬의 "다른 탭에서 데이터가 바뀌었습니다" 알림이 없다(저장 시도 때만 감지).
- **열린 질문(Open questions)**: ① 어느 화면·칸에서 어떤 순서로 했는지(사용자). ② 탭 A를 새로고침했거나 먼저 저장한 적이 있는지(사용자). ③ 서버 저장소에도 실시간 변경 알림을 둘지(사용자와 상의).
- **문서 갱신**: 원인이 확정되면 UJ 오류 처리와 QA 체크리스트 13번 갱신

## 2026-10-20 서버 저장소(Supabase) 전환과 개인용 로그인 (상태: 완료, QA 19/21 통과)

**참조**: PRD §7.4 열린 질문("로그인·권한은 어디까지?"), PRD §7.4 가정 4(외부 클라우드 저장), ERD 전체와 "로그인 설계", IA 설정 `/settings`(저장 위치), devplan Phase 9

- **문제(Problem)**: 기록이 한 브라우저(IndexedDB)에만 있어 기기를 바꾸면 못 보고, 백업을 직접 챙겨야 한다. 로그인과 권한이 없다.
- **기대 결과(Proposed outcome)**: 로그인하면 어느 기기에서든 같은 기록이 보이고, 내 데이터는 나만 본다. 기존 로컬 데이터를 서버로 옮길 수 있다.
- **영향 범위(Affected users and systems)**: 개인 사용자 1명. Supabase(표 7개, RLS, 프로필 트리거), 앱의 저장소 계층(`DataBackend`: local/remote), 로그인 화면, 설정의 저장 위치·표시 이름·비밀번호, 이전 마법사 `/migrate`.
- **제약(Constraints)**: 개인용(팀 공유 없음), 가입 닫기(운영자가 계정 생성), 이메일 확인 끔, 공개용 키만 앱에 둠, 로컬 데이터는 자동 삭제 금지, 계정·데이터 삭제는 앱에 두지 않음, 무료 플랜.
- **열린 질문(Open questions)**: ① 기관 보안 정책상 외부 클라우드(Supabase 서울)에 저장해도 되는지(사용자, PRD 가정 4). ② 팀 공유가 필요해지는 시점(사용자). ③ QA 21번 서버 계약·침투 시험은 시험용 프로젝트에서 따로 돌릴지(사용자).
- **문서 갱신**: ERD ✔, 설정 가이드 ✔, QA 체크리스트 ✔. **PRD·IA·UJ는 아직 로그인·서버 저장소를 반영하지 않았다**(IA에 로그인 화면과 `/migrate` 없음, UJ에 로그인 여정 없음, PRD §8의 "로그인" 범위 미정) → 갱신 필요.

## 2026-10-20 문서와 어긋난 기능 정리 (상태: 계획)

**참조**: PRD §8 "하지 않음(통계 모형: 회귀 분석, 가설 검정 등)", PRD §7.2 s4, IA(프로젝트 상세 탭 현황/데이터/분석), `docs/phase8/01-데이터-허브와-통계-분석.md`, `docs/phase8/02-고객-요구-특성.md`

- **문제(Problem)**: 데이터 허브·통계(상관, 회귀, 분산분석)와 고객 요구 특성은 사용자 요청으로 만들었지만 PRD의 "하지 않음"과 IA 구조에 반영되지 않았다. 개발 기준 문서가 현재 앱과 다르다.
- **기대 결과(Proposed outcome)**: PRD·IA·UJ가 현재 앱과 일치해서, 다음 작업부터 문서만 읽고 범위와 화면을 판단할 수 있다.
- **영향 범위(Affected users and systems)**: 문서만(`docs/planning/*`, `docs/summary/*`). 코드 변경 없음.
- **제약(Constraints)**: 확인된 사실과 가정을 구분해 쓰는 기존 규칙(`[가정]` 표기)을 지킨다.
- **열린 질문(Open questions)**: ① 통계 모형을 "하지 않음"에서 빼고 범위로 인정할지(사용자). ② 데이터 허브 화면(`/data`)과 `/migrate`, 로그인 화면을 IA 사이트맵에 어디에 둘지(사용자와 상의).
- **문서 갱신**: PRD, IA, UJ, `docs/summary/*` (미완)
