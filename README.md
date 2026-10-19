# lablog

흩어진 실험 기록을 한 곳에 모아 찾고 다시 쓰게 하는 실험 노트 웹앱.

**풀려는 문제**: 실험 기록이 여러 곳에 흩어져 찾기도 재현하기도 어려운 문제

현재 단계: Phase 1(설계) 완료. 다음은 Phase 2(기반 구축). 데이터는 지금 브라우저 로컬(IndexedDB)에만 저장하고, 이후 Supabase로 옮길 예정입니다.

## 디렉토리 구조

```
lab/
├─ README.md
├─ app/                      앱 코드 (Vite + React + TypeScript)
│  ├─ src/
│  │  ├─ domain/             타입과 규칙 (저장소와 무관한 순수 코드)
│  │  ├─ data/
│  │  │  ├─ repositories/    저장소 인터페이스 (DataBackend)
│  │  │  ├─ local/           IndexedDB 구현 (Phase 2)
│  │  │  └─ supabase/        Supabase 구현 (Phase 9)
│  │  ├─ services/           검색 색인, 백업 같은 도메인 서비스
│  │  ├─ hooks/              화면용 훅
│  │  ├─ components/         공통 UI
│  │  ├─ pages/              라우트 단위 화면 (IA의 URL과 1:1)
│  │  ├─ styles/             디자인 토큰 (tokens.css)
│  │  └─ tests/              테스트 설정, 계약 테스트, 픽스처
│  └─ .env.example
├─ docs/
│  ├─ planning/              기획: prd, IA, uj, 문제정의-솔루션, devplan
│  ├─ design/                디자인: 시안(4종), 와이어프레임, 디자인 기준
│  ├─ phase0/                준비: 결정 기록, 인터뷰 가이드, 샘플 수집, 기준선 측정
│  ├─ phase1/                설계: 데이터 모델, 수행 모드 사전 검증, 테스트 계획
│  └─ summary/               각 문서의 짧은 요약본
└─ .claude/skills/           기획 작업에 쓴 스킬 (create-prd, information-architecture, user-journeys)
```

단계별 문서는 `docs/phaseN/`에 쌓습니다. 새 단계를 시작하면 폴더를 하나 더 만듭니다.

## 문서 읽는 순서

1. `docs/planning/prd.md` 무엇을 왜 만드는가
2. `docs/planning/IA.md`, `uj.md` 화면 구조와 사용자 흐름
3. `docs/planning/devplan.md` 단계별 개발 계획
4. `docs/phase1/01-데이터-모델.md` 데이터와 규칙
5. `docs/design/` 디자인 방향과 화면 설계

## 개발

Node.js 24 LTS 필요. `app/`에서 실행합니다.

```bash
npm install
npm run dev        # 개발 서버
npm run check      # 린트 + 타입 검사 + 테스트
npm run build      # 배포용 빌드
```

자세한 규칙(브랜치, 커밋, PR 체크리스트)은 `docs/phase0/00-결정.md`에 있습니다.
