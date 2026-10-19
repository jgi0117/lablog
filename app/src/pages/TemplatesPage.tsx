import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useBackend } from '../app/BackendContext'
import { EmptyState } from '../components/EmptyState'
import { useToast } from '../components/Toast'
import { ConflictError } from '../data/repositories'
import type { Template } from '../domain/types'
import {
  conditionsToText,
  parseConditionLines,
  parseLines,
  parseResultLines,
  resultsToText,
} from '../services/templateService'

interface EditorProps {
  template: Template
  onSaved: (t: Template) => void
  onDeleted: (id: string) => void
}

/** 템플릿 하나의 편집: 이름, 절차(한 줄에 하나), 조건("이름 | 값 | 단위"), 결과 항목("이름 | 단위"). */
function TemplateEditor({ template, onSaved, onDeleted }: EditorProps) {
  const backend = useBackend()
  const toast = useToast()
  const [name, setName] = useState(template.name)
  const [steps, setSteps] = useState(template.steps.map((s) => s.content).join('\n'))
  const [conds, setConds] = useState(conditionsToText(template.defaultConditions))
  const [results, setResults] = useState(resultsToText(template.resultItems))
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('이름은 비워 둘 수 없습니다')
      return
    }
    try {
      const next = await backend.templates.update(
        template.id,
        {
          name: name.trim(),
          steps: parseLines(steps).map((content) => ({ content })),
          defaultConditions: parseConditionLines(conds),
          resultItems: parseResultLines(results),
        },
        template.version,
      )
      setError('')
      onSaved(next)
      toast.show({ message: '템플릿을 저장했습니다' })
    } catch (err) {
      setError(err instanceof ConflictError ? '다른 탭에서 먼저 수정했습니다. 새로고침한 뒤 다시 고치세요.' : '저장하지 못했습니다. 다시 시도하세요.')
    }
  }

  const remove = async () => {
    await backend.templates.softDelete(template.id)
    onDeleted(template.id)
    toast.show({ message: `템플릿 "${template.name}"을 삭제했습니다` })
  }

  return (
    <form className="form template-editor" onSubmit={save} noValidate>
      <div className="field">
        <label htmlFor={`tn-${template.id}`}>이름</label>
        <input id={`tn-${template.id}`} className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`ts-${template.id}`}>절차 (한 줄에 한 단계)</label>
        <textarea id={`ts-${template.id}`} className="input input--area" rows={6} value={steps} onChange={(e) => setSteps(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`tc-${template.id}`}>조건 (한 줄에 하나: 이름 | 값 | 단위)</label>
        <textarea
          id={`tc-${template.id}`}
          className="input input--area"
          rows={3}
          placeholder="건조 온도 | 80 | °C"
          value={conds}
          onChange={(e) => setConds(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`tr-${template.id}`}>결과 항목 (한 줄에 하나: 이름 | 단위, 값은 실험마다 채웁니다)</label>
        <textarea
          id={`tr-${template.id}`}
          className="input input--area"
          rows={3}
          placeholder="연필경도 | H"
          value={results}
          onChange={(e) => setResults(e.target.value)}
        />
      </div>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      <div className="form__actions">
        <button type="submit" className="btn btn--primary">
          저장
        </button>
        {confirmDelete ? (
          <>
            <button type="button" className="btn btn--danger" onClick={() => void remove()}>
              정말 삭제
            </button>
            <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
              취소
            </button>
          </>
        ) : (
          <button type="button" className="btn btn--quiet" onClick={() => setConfirmDelete(true)}>
            템플릿 삭제
          </button>
        )}
      </div>
    </form>
  )
}

/** 템플릿 목록. 자주 하는 실험의 표준 절차를 모아 두고, 한 번에 새 실험으로 시작한다. */
export function TemplatesPage() {
  const backend = useBackend()
  const toast = useToast()
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [newName, setNewName] = useState('')
  const [newError, setNewError] = useState('')

  const load = useCallback(async () => {
    setTemplates(await backend.templates.list())
  }, [backend])

  useEffect(() => {
    let alive = true
    backend.templates
      .list()
      .then((t) => alive && setTemplates(t))
      .catch(() => alive && setTemplates([]))
    return () => {
      alive = false
    }
  }, [backend])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) {
      setNewError('이름을 입력하세요')
      return
    }
    await backend.templates.create({ name: newName.trim(), steps: [], defaultConditions: [], resultItems: [] })
    setNewName('')
    setNewError('')
    toast.show({ message: '템플릿을 만들었습니다. 열어서 절차를 채우세요.' })
    await load()
  }

  return (
    <section>
      <h1 className="page-title">템플릿</h1>
      <p className="muted templates__intro">자주 하는 실험의 표준 절차를 모아 둡니다. 실험 화면의 "템플릿으로 저장"으로도 만들 수 있습니다.</p>
      <form className="templates__new" onSubmit={create} noValidate>
        <label htmlFor="new-template" className="visually-hidden">
          새 템플릿 이름
        </label>
        <input
          id="new-template"
          className="input"
          placeholder="새 템플릿 이름"
          value={newName}
          onChange={(e) => {
            setNewName(e.target.value)
            if (newError) setNewError('')
          }}
        />
        <button type="submit" className="btn">
          + 새 템플릿
        </button>
        {newError && (
          <p className="field__error" role="alert">
            {newError}
          </p>
        )}
      </form>

      {templates === null ? (
        <p className="muted">불러오는 중…</p>
      ) : templates.length === 0 ? (
        <EmptyState title="저장한 템플릿이 없습니다" description="잘 된 실험의 개요에서 '템플릿으로 저장'을 누르거나, 위에서 새로 만드세요." />
      ) : (
        <ul className="template-list">
          {templates.map((t) => (
            <li key={t.id} className="card template-card">
              <h2 className="card__title">{t.name}</h2>
              <p className="muted">
                절차 {t.steps.length}개 · 조건 {t.defaultConditions.length}개 · 결과 항목 {t.resultItems.length}개
              </p>
              <div className="panel__actions">
                <Link to={`/experiments/new?template=${t.id}`} className="btn btn--primary">
                  이 템플릿으로 새 실험
                </Link>
              </div>
              <details className="template-card__edit">
                <summary>편집</summary>
                <TemplateEditor
                  key={`${t.id}-${t.version}`}
                  template={t}
                  onSaved={(next) => setTemplates((xs) => xs && xs.map((x) => (x.id === next.id ? next : x)))}
                  onDeleted={(id) => setTemplates((xs) => xs && xs.filter((x) => x.id !== id))}
                />
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
