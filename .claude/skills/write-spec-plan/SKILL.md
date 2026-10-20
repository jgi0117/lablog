---
name: write-spec-plan
description: "Writes a feature's spec.md (what and why: problem, users, numbered requirements, success criteria, out of scope, open questions) and then plan.md (how: tech and versions, structure and files, phased approach, test strategy, constraints), grounded in the repo's Intent.md, PRD, IA, UJ and ERD. Use when starting a new feature or change in lablog, when asked for a spec, plan, 스펙, 계획서, 설계 문서, or before implementing work that touches screens, data tables, or login."
---

# Spec과 Plan 쓰기 (lablog)

작업 하나를 **Intent → Spec → Plan → 개발** 순서로 진행하게 하는 절차다. spec은 "무엇을, 왜", plan은 "어떻게"다. 둘을 섞지 않는다.

문서 위치: `docs/specs/NNN-짧은-이름/spec.md`, `docs/specs/NNN-짧은-이름/plan.md` (NNN은 001부터 올라가는 번호).
틀: 이 폴더의 `spec-template.md`, `plan-template.md`. 칸 이름과 순서는 바꾸지 않는다.
말투는 쉬운 한국어로 쓴다. 전문 용어는 처음 나올 때 한 줄로 풀어 쓴다.

## 순서

### 0. 읽는다 (쓰기 전에 반드시)
1. `docs/Intent.md`: 이 작업의 항목이 있으면 그 내용, 없으면 먼저 만든다(틀은 그 파일에 있다).
2. `docs/planning/prd.md`(목표 KR, 범위, "하지 않음", 가정), `IA.md`(화면·주소), `uj.md`(여정·오류 처리), `docs/phase9/erd.md`(표·보안).
3. 코드에서 비슷한 기존 기능과 `app/package.json`(버전). 추측하지 말고 열어서 확인한다.

### 1. 물어본다 (필요할 때만)
사용자만 아는 것(문제를 겪은 장면, 누가 쓰나, 끝났다고 볼 기준, 예산·정책)이 비었으면 **한 번에 최대 3개**, 쉬운 말로 묻고 spec은 쓰지 않는다. 웹이나 코드로 알 수 있는 것은 묻지 않고 조사한다. 사용자가 "그냥 진행"이라고 하면 가정으로 표시하고 쓴다.

### 2. spec.md를 쓴다 (여섯 칸)
1. 해결하려는 문제 / 2. 주요 사용자 / 3. 핵심 기능과 요구사항 / 4. 성공 기준 / 5. 제외 범위 / 6. 확인 필요 사항.

규칙:
- 요구사항은 `FR-1`처럼 **번호**를 붙이고 한 줄에 하나만 쓴다. 우선순위(Must/Should/Could), IA 화면·주소, ERD 표를 같이 적는다.
- 성공 기준은 `SC-1`처럼 번호를 붙이고 **눈으로 확인할 수 있게**(할 일 → 기대하는 화면) 쓴다. 요구사항마다 하나 이상 있어야 한다. 이 표가 나중에 QA 시트 시나리오가 된다.
- 기술 이름(라이브러리, 함수)은 spec에 쓰지 않는다.
- 모르는 것은 지어내지 말고 `[확인 필요: …]`로 두고 6번에 모은다(정할 사람, 정하기 전 기본 가정 포함).
- PRD와 다르거나 "하지 않음"에 걸리면 6번에 적고 사용자에게 알린다.
- 5번(제외 범위)이 비어 있으면 아직 덜 생각한 것이다. 최소 하나는 적는다.

### 3. 사용자 확인 (관문)
spec을 보여 주고 **"이대로 plan을 쓸까요?"** 를 묻는다. Must 요구사항을 막는 확인 필요 질문이 남아 있으면 먼저 묻는다. 확정 전에는 plan.md를 쓰지 않고 코드도 바꾸지 않는다.

### 4. plan.md를 쓴다 (다섯 칸)
1. 기술과 버전 / 2. 구조와 파일 / 3. 단계별 접근 / 4. 테스트 전략 / 5. 제약과 주의점.

규칙:
- 버전은 `package.json`/`package-lock.json`에서 읽은 **정확한 값**만 쓴다.
- **새 라이브러리는 되도록 안 들인다.** 꼭 필요하면 이유와 대안을 적고 사용자에게 먼저 묻는다.
- 단계는 작게 나눈다. 단계마다 끝났는지 확인하는 법과 되돌리는 법을 쓴다. 단계가 끝날 때마다 앱이 돌아가고 시험이 통과해야 한다.
- 모든 FR이 어느 파일·어느 단계에서 구현되고, 모든 SC가 어떤 시험이나 QA 항목으로 확인되는지 표에서 빠짐없이 이어져야 한다(빈 칸이 있으면 spec이나 plan을 고친다).
- 테스트 전략에는 실행 명령을 전체로 쓴다. 못 돌리는 시험은 "No Run"과 이유를 적는다.
- 5번에 항상 / 먼저 묻는다 / 절대 안 한다 세 단계로 경계를 쓴다. 비밀 키 노출 금지, 운영 데이터 삭제 시험 금지, 기존 기능 보호를 포함한다.
- 서버 표를 바꾸면 새 마이그레이션 파일(`supabase/migrations/`)과 `erd.md` 갱신을 단계에 넣는다.

### 5. 끝낸다
- plan을 보여 주고 확인받은 뒤에 개발을 시작한다.
- `docs/Intent.md` 항목에 spec/plan 링크를 단다. 개발이 끝나면 상태를 바꾸고, 어긋난 PRD·IA·UJ·ERD를 고친다.
- 커밋한다. push는 사용자가 말할 때만 한다.

## 자기 점검 (사용자에게 보여 주기 전)
- [ ] spec 여섯 칸, plan 다섯 칸이 모두 있고 순서가 틀대로인가
- [ ] 요구사항·성공 기준·확인 필요 사항에 번호가 있는가
- [ ] 모든 FR에 SC가 있고, 모든 SC에 시험 또는 QA 항목이 있는가
- [ ] spec에 기술 이름이 없고, plan에 spec에 없는 기능이 없는가
- [ ] 버전은 실제 파일에서 읽은 값인가, 새 라이브러리는 없는가(있으면 이유가 있는가)
- [ ] 지어낸 사실이 없는가(모르면 `[확인 필요]` 또는 `[가정]`)
- [ ] 기존 기능을 깨지 않는 시험이 plan에 있는가

## 참고한 방식
- GitHub Spec Kit: spec은 무엇·왜, plan은 기술 선택과 구조, `[NEEDS CLARIFICATION]` 표시, 번호 붙인 요구사항(FR-)과 측정 가능한 성공 기준(SC-), 단계별 진행.
- Addy Osmani, "How to write a good spec for AI agents": 명령어를 앞에, 테스트·구조·스타일·Git·경계를 빠뜨리지 않기, 항상/먼저 묻기/절대 안 하기 세 단계 경계, 작게 나눠 한 번에 하나씩, 결과를 spec과 대조해 점검.
