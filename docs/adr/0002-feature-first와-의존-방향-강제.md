# 폴더는 feature-first, 의존 방향은 린터로 강제한다

`src/domain`(순수 모델·규칙) ← `src/data`(Repository 어댑터) / `src/features/*`(화면·훅·서비스) / `src/shared`. 의존성은 안쪽(domain)으로만 향하고 컴포넌트는 `data`를 직접 import하지 않으며 `Repository`를 주입받는다. 파일은 목표 200줄·한도 300줄. 규칙을 문서에만 두면 어겨지므로 import 경계와 `max-lines`를 린터로 검사한다. 계층형(`pages/components/services`) 그대로 두는 대안은 lablog에서 300줄 초과 파일 9개와 화면-저장소 결합을 낳았다.
