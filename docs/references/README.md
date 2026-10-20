# 참고 자료

외부에서 내려받은 문서를 모아 둡니다. 우리가 쓴 문서가 아니므로 내용을 고치지 않습니다.

| 파일 | 출처 | 내려받은 날 | 비고 |
|---|---|---|---|
| `grill-with-docs.md` | https://github.com/mattpocock/skills/blob/main/docs/engineering/grill-with-docs.md | 2026-10-20 | 스킬 `grill-with-docs`의 **설명 문서**다. 스킬 자체(`SKILL.md`)가 아니다 |

## grill-with-docs를 실제로 쓰려면

위 문서에 따르면 이 스킬의 `SKILL.md`는 한 줄짜리이고 다른 두 스킬에 일을 맡긴다. 그래서 **세 개가 모두 있어야** 동작한다.

1. `grill-with-docs` (진입점)
2. `grilling` (인터뷰 방식)
3. `domain-modeling` (용어집 `GLOSSARY.md`와 결정 기록 `docs/adr/`을 쓰는 규칙)

지금 저장소에는 설명 문서만 받아 두었다. 스킬을 켜려면 위 세 스킬의 `SKILL.md`를 `.claude/skills/<이름>/SKILL.md`로 받아야 하고, 받기 전에 내용을 읽어 확인해야 한다(스킬은 실행할 지시문이다).
