import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useBackend } from '../app/BackendContext'
import { ValidationError, createExperiment } from '../services/experimentService'
import { parseTags } from '../services/text'
import type { Project } from '../domain/types'

const NEW_PROJECT = '__new__'

/** 제목만 필수. 만들면 준비 상태로 절차 편집 화면으로 이동한다. */
export function NewExperimentPage() {
  const backend = useBackend()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [title, setTitle] = useState('')
  const [purpose, setPurpose] = useState('')
  const [tags, setTags] = useState('')
  const [projectId, setProjectId] = useState('')
  const [newProject, setNewProject] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!title.trim()) {
      setError('제목을 입력하세요')
      return
    }
    setBusy(true)
    try {
      let pid: string | null = projectId && projectId !== NEW_PROJECT ? projectId : null
      if (projectId === NEW_PROJECT && newProject.trim()) {
        pid = (await backend.projects.create({ name: newProject.trim(), description: '' })).id
      }
      const exp = await createExperiment(backend, { title, purpose, tags: parseTags(tags), projectId: pid })
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
            placeholder="예) 나노입자 합성 조건 최적화 #13"
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
        <div className="form__actions">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            만들고 절차 입력하기 →
          </button>
        </div>
      </form>
    </section>
  )
}
