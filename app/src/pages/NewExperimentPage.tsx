import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAccount } from '../app/AccountContext'
import { useBackend } from '../app/BackendContext'
import { ValidationError, createExperiment } from '../services/experimentService'
import { applyRequirementItems } from '../services/requirementItems'
import { startFromTemplate } from '../services/templateService'
import { logUsage } from '../services/usage'
import { parseTags } from '../services/text'
import type { Experiment, Project, Template } from '../domain/types'

const NEW_PROJECT = '__new__'

/** 제목만 필수. 만들면 준비 상태로 절차 편집 화면으로 이동한다. */
export function NewExperimentPage() {
  const backend = useBackend()
  const owner = useAccount()?.displayName ?? ''
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [projects, setProjects] = useState<Project[]>([])
  const [title, setTitle] = useState('')
  const [purpose, setPurpose] = useState('')
  const [tags, setTags] = useState('')
  const [projectId, setProjectId] = useState(params.get('project') ?? '')
  const [last, setLast] = useState<Experiment | null>(null)
  const [fromLast, setFromLast] = useState(true)
  const [newProject, setNewProject] = useState('')
  const [templates, setTemplates] = useState<Template[]>([])
  const [templateId, setTemplateId] = useState(params.get('template') ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    backend.projects
      .list()
      .then((p) => alive && setProjects(p))
      .catch(() => {})
    backend.templates
      .list()
      .then((t) => alive && setTemplates(t))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [backend])

  // 프로젝트를 고르면 그 프로젝트의 마지막 실험을 찾아 "이어받기" 선택지를 보여 준다.
  useEffect(() => {
    let alive = true
    if (!projectId || projectId === NEW_PROJECT) {
      setLast(null)
      return
    }
    backend.experiments
      .list({ projectId }, 'updated_desc', { limit: 1, offset: 0 })
      .then((r) => alive && setLast(r.items[0] ?? null))
      .catch(() => alive && setLast(null))
    return () => {
      alive = false
    }
  }, [backend, projectId])

  const selected = projects.find((p) => p.id === projectId)
  const requirements = selected?.requirements ?? []
  const [count, setCount] = useState<number | null>(null)
  // 프로젝트를 고르면 "프로젝트 이름 #번호"를 제목으로 제안한다. 비워 두고 만들면 이 제목을 쓴다.
  useEffect(() => {
    let alive = true
    setCount(null)
    if (!selected) return
    backend.experiments
      .list({ projectId: selected.id }, 'updated_desc', { limit: 1, offset: 0 })
      .then((r) => alive && setCount(r.total))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [backend, selected])
  const suggested = selected && count !== null ? `${selected.name} #${count + 1}` : ''

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const typed = title.trim()
    const finalTitle = typed || suggested
    if (!finalTitle) {
      setError('제목을 입력하세요')
      return
    }
    setBusy(true)
    try {
      let pid: string | null = projectId && projectId !== NEW_PROJECT ? projectId : null
      if (projectId === NEW_PROJECT && newProject.trim()) {
        pid = (await backend.projects.create({ name: newProject.trim(), description: '' })).id
      }
      const template = templates.find((t) => t.id === templateId)
      if (template) {
        const exp = await startFromTemplate(backend, template, { title: finalTitle, purpose, owner, tags: parseTags(tags), projectId: pid })
        await applyRequirementItems(backend, exp.id, requirements)
        logUsage('template_start')
        navigate(`/experiments/${exp.id}/steps`)
        return
      }
      if (fromLast && last && pid === last.projectId) {
        // 마지막 실험의 절차와 조건을 이어받는다. 결과는 항목만 남기고 값은 비워 빠뜨리지 않게 한다.
        const copy = await backend.experiments.duplicate(last.id, { title: finalTitle })
        const patch = { ...(owner ? { owner } : {}), ...(purpose.trim() ? { purpose: purpose.trim() } : {}), ...(tags.trim() ? { tags: parseTags(tags) } : {}) }
        if (Object.keys(patch).length > 0) await backend.experiments.update(copy.id, patch)
        await applyRequirementItems(backend, copy.id, requirements)
        navigate(`/experiments/${copy.id}/steps`)
        return
      }
      const exp = await createExperiment(backend, { title: finalTitle, purpose, owner, tags: parseTags(tags), projectId: pid })
      await applyRequirementItems(backend, exp.id, requirements)
      navigate(`/experiments/${exp.id}/steps`)
    } catch (err) {
      setError(err instanceof ValidationError ? err.message : '저장하지 못했습니다. 다시 시도하세요.')
      setBusy(false)
    }
  }

  return (
    <section className="narrow">
      <p>
        <Link to="/">← 취소</Link>
      </p>
      <h1 className="page-title">새 실험</h1>
      <form className="form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="title">제목 (필수)</label>
          <input
            id="title"
            className="input"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              if (error) setError('')
            }}
            placeholder={suggested ? `비워 두면 "${suggested}"로 만듭니다` : '예) 하이브리드본드 HB-50 #12'}
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'title-error' : undefined}
          />
          {error && (
            <p id="title-error" className="field__error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="purpose">목적</label>
          <textarea id="purpose" className="input input--area" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </div>
        <div className="form__row">
          <div className="field">
            <label htmlFor="project">프로젝트</label>
            <select id="project" className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">선택 안 함</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value={NEW_PROJECT}>+ 새 프로젝트…</option>
            </select>
            {projectId === NEW_PROJECT && (
              <input
                className="input"
                aria-label="새 프로젝트 이름"
                placeholder="프로젝트 이름"
                value={newProject}
                onChange={(e) => setNewProject(e.target.value)}
              />
            )}
          </div>
          <div className="field">
            <label htmlFor="tags">태그</label>
            <input id="tags" className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="쉼표로 구분" />
          </div>
        </div>
        {templates.length > 0 && (
          <div className="field">
            <label htmlFor="template">템플릿에서 시작</label>
            <select id="template" className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">사용 안 함</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} (절차 {t.steps.length}개)
                </option>
              ))}
            </select>
          </div>
        )}
        {last && !templateId && (
          <label className="check-option">
            <input type="checkbox" checked={fromLast} onChange={(e) => setFromLast(e.target.checked)} />
            <span>
              마지막 실험(<strong>{last.title}</strong>)의 절차와 조건·결과 항목을 이어받기
              <span className="muted"> — 조건 값은 그대로, 결과 값은 비워서 가져옵니다</span>
            </span>
          </label>
        )}
        {requirements.length > 0 && (
          <p className="req-hint" role="note">
            이 프로젝트의 고객 요구 {requirements.length}개({[...new Set(requirements.map((r) => r.name))].slice(0, 3).join(', ')}
            {new Set(requirements.map((r) => r.name)).size > 3 ? ' 등' : ''})에 맞춰 측정할 항목을 빈 칸으로 미리 만들어 드립니다.
          </p>
        )}
        <div className="form__actions">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            만들고 절차 입력하기 →
          </button>
        </div>
      </form>
    </section>
  )
}
