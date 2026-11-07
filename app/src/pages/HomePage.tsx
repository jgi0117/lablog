import { Link } from 'react-router-dom'
import { StatusChip } from '../components'
import { describeGoal } from '../domain/types'
import { nextRun, status } from '../services/plan'
import { runsOf, useDb } from '../services/store'

/** 홈: 프로젝트 카드. 카드마다 다음 실험과 목표 상태가 보이고, 누르면 바로 결과 입력 화면이다 */
export function HomePage() {
  const db = useDb()
  // 참고 데이터(과거 배합 기록)는 프로젝트가 아니다: 목록에 두지 않고 데이터 탭의 전체와 모델 학습에만 쓴다
  const mine = db.projects.filter((p) => !p.reference)
  return (
    <div className="stack">
      <div className="row between">
        <h1>프로젝트</h1>
        <div className="row">
          <Link to="/new" className="btn btn--primary">
            + 새 프로젝트
          </Link>
        </div>
      </div>

      {mine.length === 0 && (
        <div className="card stack">
          <h2>아직 프로젝트가 없습니다</h2>
          <ul className="goal-list">
            <li>프로젝트 = 입력(바꿀 조건·범위) + 출력(측정) + 목표(목표값 ± 허용)</li>
            <li>만들면 앱이 실험 순서를 정함 → 결과 숫자만 입력</li>
            <li>백업 파일은 <Link to="/data">데이터</Link>에서 가져오기</li>
          </ul>
          <div className="row">
            <Link to="/new" className="btn btn--primary">
              + 새 프로젝트
            </Link>
          </div>
        </div>
      )}

      <div className="grid">
        {mine.map((p) => {
          const runs = runsOf(db, p.id)
          const s = status(p, runs)
          const next = nextRun(runs)
          const miss = s.closest?.verdicts.find((v) => v.goal.must && v.ok !== true)
          return (
            <div key={p.id} className="card proj">
              <h2>
                <Link to={`/p/${p.id}`}>{p.name}</Link> <StatusChip s={s} />
              </h2>
              <p className="muted small">{`완료 ${s.done}건 · 계획 ${s.planned}건 · 목표 ${p.goals.length}개`}</p>
              {s.overall === 'achieved' && <p className="small">실험 {s.done}건 만에 달성</p>}
              {s.overall === 'in-progress' && miss && <p className="small">부족: {describeGoal(p, miss.goal)}</p>}
              {s.overall === 'no-goal' && <p className="small muted">목표 없음 → 설정에서 추가</p>}
              <Link to={`/p/${p.id}`} className={`btn ${s.finished ? '' : 'btn--primary'}`}>
                {s.finished ? '결과 보기 →' : next ? `다음 실험 #${next.order} 결과 넣기 →` : '다음 실험 받기 →'}
              </Link>
            </div>
          )
        })}
      </div>
    </div>
  )
}
