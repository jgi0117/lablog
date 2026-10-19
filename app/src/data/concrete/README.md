# 콘크리트 압축강도 공개 데이터

`concrete.csv`는 앱의 예시 데이터(시연용)와 성능 시험용 데이터의 원본이다.

- 출처: UCI Machine Learning Repository, *Concrete Compressive Strength* — https://archive.ics.uci.edu/dataset/165/concrete
- 인용: Yeh, I-C. (1998). Modeling of strength of high-performance concrete using artificial neural networks. *Cement and Concrete Research*, 28(12), 1797–1808.
- 라이선스: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
- 1,030행, 9열(성분 7개 kg/m³, 재령 일, 압축강도 MPa), 결측 없음.

## 원본에서 한 가공

- 원본 `Concrete_Data.xls`를 CSV로 바꾸면서 열 이름을 짧은 영문(`cement`, `slag`, `fly_ash`, `water`, `superplasticizer`, `coarse_aggregate`, `fine_aggregate`, `age`, `strength`)으로 줄이고 값 앞뒤 공백을 지웠다. **값은 바꾸지 않았다.** 행 순서도 원본 그대로이며, 앱에서 말하는 "원본 행 번호"는 머리글을 뺀 1부터의 순서다.

## 앱이 이 데이터로 하는 일 (`concreteDemo.ts`)

- 결합재 종류로 네 프로젝트로 나눈다(슬래그와 플라이애시가 0인지 아닌지). 프로젝트 이름과 제품 코드의 숫자는 지어낸 예시이며 실제 치환율이 아니다.
- **앱의 예시 데이터는 전체 1,030건**이다(처음 열 때 자동으로, 또는 빈 홈 화면의 버튼으로). 단위 테스트와 E2E 서버는 숫자가 고정된 "고른 200건"(프로젝트당 약 50건, 재령 90일 이하에서 균등하게 고른 뒤 이상치로 잡히는 행을 뺀 것)을 쓴다.
- 한 행이 실험 한 건이다. 데이터에 없는 시작·완료 날짜, 진행 상태, 절차 4단계, 담당자는 앱이 지어낸 것이다.
- **시연용으로 값을 바꾼 곳(공개 데이터와 다르다)**: `concreteDemo.ts`의 `ALTERED`에 행 번호와 원래 값을 적어 두고, 해당 실험의 목적 칸에도 "※ 시연용으로 바꾼 값"으로 밝힌다.
