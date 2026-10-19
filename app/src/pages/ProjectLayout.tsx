import { useMemo, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { useBackend } from '../app/BackendContext'
import { EmptyState } from '../components/EmptyState'
import { SaverIndicator } from '../components/SaverIndicator'
import { useLatest } from '../hooks/useLatest'
import { useDebouncedSave } from '../hooks/useDebouncedSave'
import { useProjectBundles } from '../hooks/useBundles'
import type { ProjectContext } from '../hooks/useProjectContext'
import type { Patch, Project } from '../domain/types'
import { buildMatrix, findGaps } from '../services/analysis'

function ProjectEditor({ project, onSaved }: { project: Project; onSaved: (p: Project) => void }) {
  const backend = useBackend()
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description)
  const [error, setError] = useState('')
  const pending = useRef<Patch<Project>>({})
  const version = useLatest(project.version)
  const saver = useDebouncedSave<Patch<Project>>(async (patch, { force }) => {
    pending.current = {}
    onSaved(await backend.projects.update(project.id, patch, force ? undefined : version.current))
  })
  const change = (patch: Patch<Project>) => {
    pending.current = { ...pending.current, ...patch }
    saver.schedule(pending.current)
  }
  return (
    <details className="project-edit">
      <summary>이름·목표 수정</summary>
      <div className="field">
        <label htmlFor="pe-name">프로젝트 이름</label>
        <input
          id="pe-name"
          className="input"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            if (!e.target.value.trim()) return setError('이름은 비워 둘 수 없습니다')
            setError('')
            change({ name: e.target.value.trim() })
          }}
        />
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="pe-desc">목표·설명</label>
        <textarea
          id="pe-desc"
          className="input input--area"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value)
            change({ description: e.target.value })
          }}
        />
      </div>
      <SaverIndicator saver={saver} />
    </details>
  )
}

/** 프로젝트 상세의 공통 틀. 실험들을 한 번 읽어 현황·데이터·분석 탭이 같이 쓴다. */
export function ProjectLayout() {
  const { id = '' } = useParams()
  const { status, project, setProject, bundles, reload } = useProjectBundles(id)
  const matrix = useMemo(() => buildMatrix(bundles), [bundles])
  const gaps = useMemo(() => findGaps(bundles), [bundles])

  if (status === 'loading') return <p className="muted">불러오는 중…</p>
  if (status !== 'ready' || !project) {
    return (
      <EmptyState title="프로젝트를 찾을 수 없습니다" description="삭제되었거나 주소가 잘못되었습니다.">
        <Link to="/projects" className="btn btn--primary">
          프로젝트 목록
        </Link>
      </EmptyState>
    )
  }

  const ctx: ProjectContext = { project, bundles, matrix, gaps, reload }
  const tabs = [
    { to: `/projects/${id}`, label: '현황', end: true },
    { to: `/projects/${id}/data`, label: '데이터', end: false },
    { to: `/projects/${id}/analysis`, label: '분석', end: false },
  ]
  return (
    <section>
      <p>
        <Link to="/projects">← 프로젝트 목록</Link>
      </p>
      <h1 className="page-title page-title--tight">{project.name}</h1>
      {project.description && <p className="project-desc">{project.description}</p>}
      <ProjectEditor key={project.updatedAt} project={project} onSaved={setProject} />
      <nav className="tabs" aria-label="프로젝트 탭">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tabs__item${isActive ? ' is-active' : ''}`}>
            {t.label}
            {t.label === '현황' && gaps.length > 0 ? ` · 확인 ${gaps.length}` : ''}
          </NavLink>
        ))}
        <Link to={`/experiments/new?project=${id}`} className="btn btn--primary tabs__run">
          + 이 프로젝트에 새 실험
        </Link>
      </nav>
      <Outlet context={ctx} />
    </section>
  )
}
