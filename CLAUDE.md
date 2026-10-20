# lablog 작업 규칙

한국어로 소통한다. 사용자는 주니어 연구원이고 쉬운 말로 설명받기를 원한다. 결정이 필요하면 쉬운 말로 선택지와 영향을 설명하고 묻는다.

## 개발 전에: 문서를 먼저 읽는다

작업을 시작하기 전에 다음을 읽고, 해당 부분을 `docs/Intent.md`에 먼저 쓴다.

1. `docs/Intent.md`: 이전 작업의 의도, 열린 질문, 문서 갱신 필요 목록
2. `docs/planning/prd.md`: 목표, 기능 범위, 하지 않음, 가정
3. `docs/planning/IA.md`: 화면 구조와 주소
4. `docs/planning/uj.md`: 사용자 여정과 오류 처리
5. `docs/phase9/erd.md`: 서버 표 구조, 보안, 로그인 설계

## 작업 순서: Intent → Spec → Plan → 개발

기능·화면·데이터 구조·로그인을 바꾸는 작업은 `write-spec-plan` 스킬(`.claude/skills/write-spec-plan/`)로 진행한다.
`docs/Intent.md`에 의도를 쓰고 → `docs/specs/NNN-이름/spec.md`(무엇을·왜)를 쓰고 사용자 확인을 받고 → `plan.md`(어떻게)를 쓰고 확인받은 뒤 → 개발한다.
오타·문구·작은 버그 수정은 Intent 항목만 쓰고 spec/plan은 생략할 수 있다.

## Intent.md 규칙

- 작업마다 `docs/Intent.md` 맨 위에 새 항목을 추가한다(지난 항목은 지우지 않는다). 틀은 그 파일에 있다.
- 항목은 문제 / 기대 결과 / 영향 범위 / 제약 / 열린 질문, 그리고 참조(PRD·IA·UJ·ERD의 어느 부분인지)와 문서 갱신 목록을 포함한다.
- 작업 중 문서와 다르게 만들게 되면 열린 질문에 적고 사용자에게 알린다. 끝나면 관련 문서(PRD·IA·UJ·ERD·devplan)를 고치고 Intent의 상태를 바꾼다.
- 열린 질문은 임의로 정하지 않는다. 사용자가 정할 일이면 묻는다.

## 지킬 것

- push는 사용자가 말할 때만 한다. 커밋 메시지 끝에는 Co-Authored-By 줄을 붙인다.
- 서버(Supabase) 운영 데이터를 지우는 시험은 돌리지 않는다. service_role 키는 앱·문서·대화에 넣지 않는다.
- 비밀번호 등 비밀값은 사용자가 직접 입력한다.
- 코드 변경 후에는 `npm --prefix app run check`(타입·린트·시험)를 돌리고, 화면이 바뀌면 E2E를 돌린다.
