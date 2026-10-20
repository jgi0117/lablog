---
name: run-qa
description: "Runs QA for a unit of work in the user's format: derives scenarios from the spec's success criteria, executes what can be verified automatically (checks, tests, E2E, DB and security queries, doc consistency), records Pass/Fail/No Run with evidence in the QA file and the QA spreadsheet, then produces a human-in-the-loop list of what the user must still verify. Use before declaring work done, when asked for QA, 검증, QA 리스트, 테스트 결과 등록, or after finishing a plan step."
---

# QA 실행과 등록 (human-in-the-loop)

작업이 끝났다고 말하기 전에 이 절차를 거친다. **확인하지 않은 것을 Pass로 쓰지 않는다.** 못 돌린 것은 `No Run`과 이유를 적고 사람이 할 일로 넘긴다.

## 0. 기준 파일
- 프로젝트: `docs/qa/QA-NNN-이름.md` (작업마다 하나, spec 번호와 맞춘다). 틀은 이 폴더의 `qa-template.md`.
- 스프레드시트(사용자가 QA 파일로 지정한 것): 템플릿 시트를 복제해 시트 두 개를 만든다. 이름은 `<작업> Claude QA`, `<작업> 직접 QA`. 헤더 칸은 템플릿 그대로(`번호, 사용자, 단계, 시나리오, 프로세스, 수행 결과, 이슈(FE), 이슈(BE), 기타`)이고 상단 요약(프로젝트명, 작성자, 작성일, 테스터, 테스트 환경)을 채운다.
- 결과 값은 `Pass`(통과) / `Fail`(원하는 결과 아님) / `No Run`(실행 못 함) 세 가지만. 색: Pass 초록, Fail 빨강, No Run 회색(드롭다운과 조건부 서식).

## 1. 시나리오 만들기
1. 해당 작업의 `spec.md` 성공 기준(SC-n)을 읽는다. 요구사항(FR-n)마다 최소 한 시나리오가 있어야 한다.
2. 시나리오는 `번호 / 사용자 / 단계 / 시나리오 / 프로세스(할 일 → 기대 결과)`로 쓴다. 기대 결과는 눈이나 숫자로 확인할 수 있게.
3. 오류·예외(spec의 ER-n), 보안(다른 사용자 데이터), 회귀(기존 기능 시험 수)를 포함한다.
4. 각 시나리오를 **AI가 실행 가능한가 / 사람이 해야 하는가**로 나눈다.

## 2. AI가 실행한다 (Claude QA)
실행하고 근거를 `기타`에 적는다(명령, 건수, 쿼리 결과).
- 검사: 프로젝트의 check 명령(타입·린트·단위 시험), 빌드, E2E.
- 서버: DB 쿼리로 건수·고아 데이터·제약, 보안 점검(advisor), 사용자 A·B 격리(임시 사용자는 트랜잭션 롤백).
- 구조·문서: 줄 수·import 경계, 문서(IA·ERD)와 코드(라우트·표) 일치.
- 실패하면 `Fail`과 재현 정보(`이슈(FE)` 화면·코드, `이슈(BE)` 서버·데이터)를 적고, 원인을 찾아 고칠 수 있으면 고친 뒤 재실행해 결과를 갱신한다(고친 이력은 `기타`).
- 운영 데이터를 지우는 시험, 비밀번호가 필요한 로그인, 실제 메일 수신은 하지 않는다 → `No Run`.

## 3. 사람이 할 일 (Human-in-the-loop 목록)
아래는 AI가 대신할 수 없으므로 `직접 QA` 시트와 파일에 **수행 결과 칸을 비운 채** 올린다.
- 사용자 비밀번호·실제 계정으로 로그인이 필요한 것
- 눈으로 봐야 하는 품질(디자인 일치, 가독성, 사용감, 문구), 실제 기기·브라우저·장갑 낀 손
- 대시보드·정책·비용·외부 서비스 설정(Supabase, Vercel, 기관 보안 정책)
- 실제 이메일 수신, 외부 연동, 사용자 판단이 필요한 값(도메인 지식, 기준값)
- 위험해서 AI가 하지 않은 시험(데이터 삭제, 운영 환경)
각 항목에 **사람이 따라 할 절차와 기대 결과**를 한 줄로 쓰고, 주의사항(삭제 금지 등)을 `기타`에 적는다. 우선순위(Must 먼저)와 예상 시간을 앞쪽에 둔다.

## 4. 등록과 보고
1. `docs/qa/QA-NNN-이름.md`에 두 목록을 쓴다(표). 시트에도 같은 내용을 올린다. 시트에 못 올리면 파일만 두고 이유를 알린다.
2. 보고: 요약(Pass n / Fail n / No Run n), Fail의 원인과 조치, 사람이 할 일 개수와 가장 먼저 할 3개, QA 시 주의사항.
3. 사람이 결과를 입력한 뒤 다시 부르면 시트를 읽어 Fail을 분석하고 고친 뒤 재QA한다.
4. `docs/Intent.md` 항목에 QA 파일 링크와 결과 요약을 단다. spec의 성공 기준 중 사람 확인이 끝나지 않은 것이 있으면 작업 상태를 "완료"가 아니라 "QA 대기"로 둔다.

## 규칙
- 모든 SC가 어떤 시나리오로 확인되는지 빠짐없이 이어져야 한다(빈 SC가 있으면 시나리오를 추가).
- 결과는 지어내지 않는다. 확인 못 한 것은 `No Run`.
- 시험을 약하게 고쳐서 Pass로 만들지 않는다.
- 사용자에게 보이는 동작이 바뀌지 않아야 하는 작업(리팩터링)은 회귀 시나리오(기존 시험 수, E2E 수, 핵심 화면 눈으로 비교)를 반드시 넣는다.
