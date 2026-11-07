import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { StatusChip } from '../components'
import { describeGoal } from '../domain/types'
import { download, exportDb, parseBackup } from '../services/csv'
import { nextRun, status } from '../services/plan'
import { replaceDb, runsOf, useDb } from '../services/store'

/** 홈: 프로젝트 카드. 카드마다 다음 실험과 목표 상태가 보이고, 누르면 바로 결과 입력 화면이다 */
export function HomePage() {
  const db = useDb()
  const fileRef = useRef<HTMLInputElement>(null)

  const importBackup = async (f: File) => {
    const parsed = parseBackup(await f.text())
    if (!parsed) {
      alert('읽을 수 없는 백업 파일입니다. lablog에서 내보낸 JSON이어야 합니다.')
      return
    }
    const mode = db.projects.length === 0 || confirm(`프로젝트 ${parsed.projects.length}개, 실험 ${parsed.runs.length}건을 읽었습니다.\n확인: 지금 데이터에 더합니다 / 취소: 지금 데이터를 모두 지우고 바꿉니다`)
    if (mode) replaceDb({ version: 3, projects: [...db.projects, ...parsed.projects], runs: [...db.runs, ...parsed.runs] })
    else replaceDb(parsed)
  }

  return (
    <div className="stack">
      <div className="row between">
        <h1>프로젝트</h1>
        <div className="row">
          {db.projects.length > 0 && (
            <button type="button" className="btn" onClick={() => download(`lablog-${new Date().toISOString().slice(0, 10)}.json`, exportDb(db), 'application/json')}>
              전체 백업
            </button>
          )}
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            백업 가져오기
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden aria-label="백업 파일" onChange={(e) => e.target.files?.[0] && importBackup(e.target.files[0])} />
          <Link to="/new" className="btn btn--primary">
            + 새 프로젝트
          </Link>
        </div>
      </div>

      {db.projects.length === 0 && (
        <div className="card stack">
          <h2>아직 프로젝트가 없습니다</h2>
          <p>
            프로젝트는 "무엇을 바꿔(입력), 무엇을 재고(출력), 어디까지 가야 하는지(목표)"를 적어 둔 것입니다. 만들면 앱이 실험 순서를 정해 주고, 당신은 결과 숫자만 넣으면 됩니다.
          </p>
          <div className="row">
            <Link to="/new" className="btn btn--primary">
              + 새 프로젝트
            </Link>
          </div>
        </div>
      )}

      <div className="grid">
        {db.projects.map((p) => {
          const runs = runsOf(db, p.id)
          const s = status(p, runs)
          const next = nextRun(runs)
          const miss = s.closest?.verdicts.find((v) => v.goal.must && v.ok !== true)
          return (
            <div key={p.id} className="card proj">
              <h2>
                <Link to={`/p/${p.id}`}>{p.name}</Link> <StatusChip s={s} />
              </h2>
              <p className="muted small">
                완료 {s.done}건 · 계획 {s.planned}건 · 목표 {p.goals.length}개
              </p>
              {s.overall === 'achieved' && <p className="small">실험 {s.done}건으로 목표를 만족한 조건을 찾았습니다</p>}
              {s.overall === 'in-progress' && miss && <p className="small">가장 가까운 조건에서 "{describeGoal(p, miss.goal)}"이(가) 아직 부족합니다</p>}
              {s.overall === 'no-goal' && <p className="small muted">목표를 적으면 달성 여부를 판정합니다</p>}
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
