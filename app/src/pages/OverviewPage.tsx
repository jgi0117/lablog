import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useBackend } from '../app/BackendContext'
import { ProgressBar } from '../components/ProgressBar'
import { SaverIndicator } from '../components/SaverIndicator'
import { useLatest } from '../hooks/useLatest'
import { useToast } from '../components/Toast'
import { useDebouncedSave } from '../hooks/useDebouncedSave'
import { useExperiment } from '../hooks/useExperimentContext'
import type { Experiment, Patch, Project } from '../domain/types'
import { ValidationError, reopenExperiment, stepStats } from '../services/experimentService'
import { saveAsTemplate } from '../services/templateService'
import { logUsage } from '../services/usage'
import { ExperimentRequirementBar } from '../components/ExperimentRequirementBar'
import { useRequirementCheck } from '../hooks/useRequirementCheck'
import { formatDateTime } from '../services/format'
import { parseTags } from '../services/text'

/** 개요 탭. 바꾸면 바로 저장하고, 상태에 맞는 다음 행동을 보여 준다. */
export function OverviewPage() {
  const { experiment, steps, items, setExperiment } = useExperiment()
  const backend = useBackend()
  const toast = useToast()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [form, setForm] = useState({
    title: experiment.title,
    purpose: experiment.purpose,
    owner: experiment.owner,
    tags: experiment.tags.join(', '),
    projectId: experiment.projectId ?? '',
  })
  const [titleError, setTitleError] = useState('')
  const [tplOpen, setTplOpen] = useState(false)
  const [tplName, setTplName] = useState('')
  const [tplError, setTplError] = useState('')
  const pending = useRef<Patch<Experiment>>({})

  const version = useLatest(experiment.version)
  const saver = useDebouncedSave<Patch<Experiment>>(async (patch, { force }) => {
    pending.current = {}
    setExperiment(await backend.experiments.update(experiment.id, patch, force ? undefined : version.current))
  })

  useEffect(() => {
    let alive = true
    backend.projects
      .list()
      .then((p) => alive && setProjects(p))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [backend])

  const change = (key: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [key]: value }))
    if (key === 'title') {
      if (!value.trim()) {
        setTitleError('제목은 비워 둘 수 없습니다')
        return
      }
      setTitleError('')
    }
    const patch: Patch<Experiment> =
      key === 'title'
        ? { title: value.trim() }
        : key === 'tags'
          ? { tags: parseTags(value) }
          : key === 'projectId'
            ? { projectId: value || null }
            : { [key]: value }
    pending.current = { ...pending.current, ...patch }
    saver.schedule(pending.current)
  }

  const stats = stepStats(steps)
  const req = useRequirementCheck(experiment, items)

  const onDelete = async () => {
    await backend.experiments.softDelete(experiment.id)
    toast.show({
      message: '실험을 휴지통으로 보냈습니다 (30일 보관)',
      actionLabel: '되돌리기',
      durationMs: 8000,
      onAction: () => void backend.experiments.restore(experiment.id),
    })
    navigate('/')
  }

  // 복제: 클릭 한 번으로 만들고 새 실험의 절차 화면으로 간다. 결과 값은 비워져 있다는 것을 알려 준다.
  const onDuplicate = async () => {
    const copy = await backend.experiments.duplicate(experiment.id)
    logUsage('duplicate')
    toast.show({ message: '복제했습니다. 절차와 조건은 그대로이고, 결과 값과 체크·메모는 비워졌습니다.', durationMs: 8000 })
    navigate(`/experiments/${copy.id}`)
  }

  const onSaveTemplate = async (e: FormEvent) => {
    e.preventDefault()
    try {
      const t = await saveAsTemplate(backend, tplName, steps, items)
      logUsage('template_save')
      setTplOpen(false)
      setTplName('')
      setTplError('')
      toast.show({ message: `템플릿 "${t.name}"을 저장했습니다`, actionLabel: '템플릿 보기', onAction: () => navigate('/templates') })
    } catch (err) {
      setTplError(err instanceof ValidationError ? err.message : '저장하지 못했습니다. 다시 시도하세요.')
    }
  }

  const onReopen = async () => {
    setExperiment(await reopenExperiment(backend, experiment))
    toast.show({ message: '실험을 다시 열었습니다. 진행 상태로 돌아갑니다.' })
  }

  return (
    <div className="overview">
      <div className="overview__main">
        <div className="field">
          <label htmlFor="ov-title">제목</label>
          <input
            id="ov-title"
            className="input"
            value={form.title}
            onChange={(e) => change('title', e.target.value)}
            aria-invalid={titleError ? true : undefined}
          />
          {titleError && (
            <p className="field__error" role="alert">
              {titleError}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="ov-purpose">목적</label>
          <textarea id="ov-purpose" className="input input--area" value={form.purpose} onChange={(e) => change('purpose', e.target.value)} />
        </div>
        <div className="form__row">
          <div className="field">
            <label htmlFor="ov-owner">담당자</label>
            <input id="ov-owner" className="input" value={form.owner} onChange={(e) => change('owner', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ov-project">프로젝트</label>
            <select id="ov-project" className="input" value={form.projectId} onChange={(e) => change('projectId', e.target.value)}>
              <option value="">선택 안 함</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="ov-tags">태그</label>
          <input id="ov-tags" className="input" value={form.tags} onChange={(e) => change('tags', e.target.value)} placeholder="쉼표로 구분" />
        </div>
        <SaverIndicator saver={saver} />
      </div>

      <aside className="overview__side">
        {req && <ExperimentRequirementBar state={req} />}
        <div className="panel">
          <h2 className="panel__title">진행 현황</h2>
          <ProgressBar percent={stats.percent} />
          <p className="muted">
            {stats.done} / {stats.total} 단계 완료
          </p>
          <dl className="meta-list">
            <dt>시작</dt>
            <dd>{formatDateTime(experiment.startedAt)}</dd>
            <dt>완료</dt>
            <dd>{formatDateTime(experiment.completedAt)}</dd>
            <dt>마지막 수정</dt>
            <dd>{formatDateTime(experiment.updatedAt)}</dd>
          </dl>
          <div className="panel__actions">
            {experiment.status === 'running' && (
              <Link to={`/experiments/${experiment.id}/data?finish=1`} className="btn">
                완료하기
              </Link>
            )}
            {experiment.status === 'done' && (
              <button type="button" className="btn" onClick={onReopen}>
                다시 열기
              </button>
            )}
          </div>
        </div>
        <div className="panel">
          <h2 className="panel__title">다시 쓰기</h2>
          <p className="muted">이 실험의 절차와 조건을 그대로 가져와 새로 시작합니다. 결과 값은 비워집니다.</p>
          <div className="panel__actions">
            <button type="button" className="btn" onClick={() => void onDuplicate()}>
              복제하여 새 실험
            </button>
            <button type="button" className="btn" aria-expanded={tplOpen} onClick={() => setTplOpen((o) => !o)}>
              템플릿으로 저장
            </button>
          </div>
          {tplOpen && (
            <form className="form" onSubmit={onSaveTemplate} noValidate>
              <div className="field">
                <label htmlFor="tpl-name">템플릿 이름</label>
                <input
                  id="tpl-name"
                  className="input"
                  value={tplName}
                  autoFocus
                  placeholder="예) 하드코팅 표준 도포·경화"
                  onChange={(e) => {
                    setTplName(e.target.value)
                    if (tplError) setTplError('')
                  }}
                />
                {tplError && (
                  <p className="field__error" role="alert">
                    {tplError}
                  </p>
                )}
              </div>
              <div className="form__actions">
                <button type="submit" className="btn btn--primary">
                  저장
                </button>
              </div>
            </form>
          )}
        </div>
        <button type="button" className="btn btn--quiet" onClick={onDelete}>
          실험 삭제
        </button>
      </aside>
    </div>
  )
}
