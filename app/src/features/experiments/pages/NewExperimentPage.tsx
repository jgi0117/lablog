import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAccount } from '../../auth/AccountContext'
import { useBackend } from '../../../app/BackendContext'
import type { DataItem, Experiment, Project, Step } from '../../../domain/types'
import { ValidationError, createExperiment } from '../application/experimentService'
import { applyRequirementItems } from '../application/requirementItems'
import { parseTags } from '../../../shared/lib/text'

const NEW_PROJECT = '__new__'
type StartMode = 'blank' | 'last' | 'chosen'
type NextScreen = 'overview' | 'steps' | 'run'
interface Preview { steps: Step[]; items: DataItem[] }

/** 제목만으로 저장할 수 있고, 반복 실험은 원본과 복사 범위를 확인한 뒤 시작한다. */
export function NewExperimentPage() {
  const backend = useBackend()
  const owner = useAccount()?.displayName ?? ''
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const initialSourceId = params.get('source') ?? ''
  const [projects, setProjects] = useState<Project[]>([])
  const [projectExperiments, setProjectExperiments] = useState<Experiment[]>([])
  const [title, setTitle] = useState('')
  const [purpose, setPurpose] = useState('')
  const [tags, setTags] = useState('')
  const [projectId, setProjectId] = useState(params.get('project') ?? '')
  const [newProject, setNewProject] = useState('')
  const [startMode, setStartMode] = useState<StartMode>('last')
  const [chosenId, setChosenId] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [nextScreen, setNextScreen] = useState<NextScreen>('steps')
  const [count, setCount] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    backend.projects.list().then((rows) => alive && setProjects(rows)).catch(() => {})
    return () => { alive = false }
  }, [backend])

  useEffect(() => {
    let alive = true
    setProjectExperiments([])
    setChosenId('')
    setCount(null)
    if (!projectId || projectId === NEW_PROJECT) return
    backend.experiments.list({ projectId }, 'updated_desc', { limit: 100, offset: 0 }).then((result) => {
      if (!alive) return
      setProjectExperiments(result.items)
      setCount(result.total)
      if (initialSourceId && result.items.some((experiment) => experiment.id === initialSourceId)) {
        setStartMode('chosen')
        setChosenId(initialSourceId)
      }
    }).catch(() => {})
    return () => { alive = false }
  }, [backend, initialSourceId, projectId])

  const selectedProject = projects.find((project) => project.id === projectId)
  const last = projectExperiments[0] ?? null
  const source = startMode === 'last' ? last : startMode === 'chosen' ? projectExperiments.find((experiment) => experiment.id === chosenId) ?? null : null
  const suggested = selectedProject && count !== null ? `${selectedProject.name} #${count + 1}` : ''
  const requirements = selectedProject?.requirements ?? []

  useEffect(() => {
    let alive = true
    setPreview(null)
    if (!source) return
    Promise.all([backend.steps.listByExperiment(source.id), backend.dataItems.listByExperiment(source.id)])
      .then(([steps, items]) => alive && setPreview({ steps, items }))
      .catch(() => alive && setPreview({ steps: [], items: [] }))
    return () => { alive = false }
  }, [backend, source])

  const previewGroups = useMemo(() => {
    const items = preview?.items ?? []
    return {
      conditions: items.filter((item) => item.kind === 'condition'),
      results: items.filter((item) => item.kind === 'result'),
    }
  }, [preview])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const finalTitle = title.trim() || suggested
    if (!finalTitle) { setError('제목을 입력하세요'); return }
    setBusy(true)
    try {
      let pid: string | null = projectId && projectId !== NEW_PROJECT ? projectId : null
      if (projectId === NEW_PROJECT && newProject.trim()) pid = (await backend.projects.create({ name: newProject.trim(), description: '' })).id
      const copied = source && source.projectId === pid ? await backend.experiments.duplicate(source.id, { title: finalTitle }) : null
      const experiment = copied ?? (await createExperiment(backend, { title: finalTitle, purpose, owner, tags: parseTags(tags), projectId: pid }))
      if (copied) await backend.experiments.update(experiment.id, { purpose: purpose.trim(), owner, tags: parseTags(tags) })
      await applyRequirementItems(backend, experiment.id, requirements)
      navigate(nextScreen === 'overview' ? `/experiments/${experiment.id}` : `/experiments/${experiment.id}/${nextScreen}`)
    } catch (reason) {
      setError(reason instanceof ValidationError ? reason.message : '저장하지 못했습니다. 입력은 그대로 두었습니다. 다시 시도하세요.')
      setBusy(false)
    }
  }

  return (
    <section className="narrow experiment-create">
      <p><Link to={projectId && projectId !== NEW_PROJECT ? `/projects/${projectId}` : '/experiments'}>← 취소</Link></p>
      <h1 className="page-title">새 실험</h1>
      <p className="muted">프로젝트와 시작 방식만 고르면 바로 저장할 수 있습니다.</p>
      <form className="form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="project">프로젝트</label>
          <select id="project" className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">선택 안 함</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            <option value={NEW_PROJECT}>+ 새 프로젝트…</option>
          </select>
          {projectId === NEW_PROJECT && <input className="input" aria-label="새 프로젝트 이름" placeholder="프로젝트 이름" value={newProject} onChange={(event) => setNewProject(event.target.value)} />}
        </div>

        {projectId && projectId !== NEW_PROJECT && (
          <fieldset className="start-picker">
            <legend>어떻게 시작할까요?</legend>
            <label><input type="radio" name="start" checked={startMode === 'blank'} onChange={() => setStartMode('blank')} /> 빈 실험</label>
            <label><input type="radio" name="start" checked={startMode === 'last'} onChange={() => setStartMode('last')} disabled={!last} /> 마지막 실험에서 이어받기{last ? ` · ${last.title}` : ''}</label>
            <label><input type="radio" name="start" checked={startMode === 'chosen'} onChange={() => setStartMode('chosen')} disabled={projectExperiments.length === 0} /> 기존 실험 직접 선택</label>
            {startMode === 'chosen' && (
              <select className="input" aria-label="이어받을 실험" value={chosenId} onChange={(event) => setChosenId(event.target.value)}>
                <option value="">실험 선택</option>
                {projectExperiments.map((experiment) => <option key={experiment.id} value={experiment.id}>{experiment.title}</option>)}
              </select>
            )}
            {source && (
              <div className="inherit-preview" role="note" aria-label="이어받기 미리보기">
                <strong>{source.title}에서 이어받음</strong>
                {preview ? <>
                  <p>절차 {preview.steps.length}개 · 조건 {previewGroups.conditions.length}개 · 결과 항목 {previewGroups.results.length}개</p>
                  <p className="muted">{[...preview.steps.slice(0, 2).map((step) => step.content), ...previewGroups.conditions.slice(0, 2).map((item) => item.name), ...previewGroups.results.slice(0, 2).map((item) => item.name)].join(' · ') || '이어받을 항목 없음'}</p>
                  <p className="inherit-preview__reset">결과 값·단계 체크·메모는 비워서 시작합니다.</p>
                </> : <p className="muted">복사할 항목을 확인하는 중…</p>}
              </div>
            )}
          </fieldset>
        )}

        <div className="field">
          <label htmlFor="title">제목 (필수)</label>
          <input id="title" className="input" value={title} onChange={(event) => { setTitle(event.target.value); setError('') }} placeholder={suggested ? `비워 두면 “${suggested}”` : '예) 하이브리드본드 HB-50 #12'} autoFocus aria-invalid={error ? true : undefined} />
          {suggested && !title && <span className="muted">제안 제목: {suggested}</span>}
          {error && <p className="field__error" role="alert">{error}</p>}
        </div>

        <details className="optional-fields">
          <summary>목적·태그 추가</summary>
          <div className="field"><label htmlFor="purpose">목적</label><textarea id="purpose" className="input input--area" value={purpose} onChange={(event) => setPurpose(event.target.value)} /></div>
          <div className="field"><label htmlFor="tags">태그</label><input id="tags" className="input" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="쉼표로 구분" /></div>
        </details>

        {requirements.length > 0 && <p className="req-hint" role="note">고객 요구 {requirements.length}개({requirements.map((item) => item.name).join(', ')})를 측정 항목 {requirements.length}개로 빈 칸에 추가합니다.</p>}
        <fieldset className="next-picker">
          <legend>저장 후</legend>
          <label><input type="radio" name="next" checked={nextScreen === 'overview'} onChange={() => setNextScreen('overview')} /> 준비 상태로 저장</label>
          <label><input type="radio" name="next" checked={nextScreen === 'steps'} onChange={() => setNextScreen('steps')} /> 절차 입력</label>
          <label><input type="radio" name="next" checked={nextScreen === 'run'} onChange={() => setNextScreen('run')} /> 바로 수행</label>
        </fieldset>
        <div className="form__actions"><button type="submit" className="btn btn--primary" disabled={busy}>{busy ? '저장 중…' : '실험 만들기'}</button></div>
      </form>
    </section>
  )
}
