import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useBackend } from '../app/BackendContext'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState } from '../components/EmptyState'
import { useToast } from '../components/Toast'
import { TRASH_RETENTION_DAYS, trashDaysLeft } from '../domain/rules'
import type { Experiment } from '../domain/types'
import { formatDateTime } from '../services/format'

/** 휴지통: 삭제 후 30일 보관. 복원하거나, 확인을 거쳐 영구 삭제한다(E5). */
export function TrashPage() {
  const backend = useBackend()
  const toast = useToast()
  const [items, setItems] = useState<Experiment[] | null>(null)
  const [target, setTarget] = useState<Experiment | null>(null)
  const [now] = useState(() => new Date())

  const load = useCallback(async () => {
    const res = await backend.experiments.list({ deleted: 'only' }, 'updated_desc')
    setItems(res.items)
  }, [backend])

  useEffect(() => {
    let alive = true
    backend.experiments
      .list({ deleted: 'only' }, 'updated_desc')
      .then((r) => alive && setItems(r.items))
      .catch(() => alive && setItems([]))
    return () => {
      alive = false
    }
  }, [backend])

  const restore = async (e: Experiment) => {
    await backend.experiments.restore(e.id)
    toast.show({ message: `"${e.title}"을(를) 복원했습니다` })
    await load()
  }

  const purge = async () => {
    if (!target) return
    const gone = target
    setTarget(null)
    await backend.experiments.purge(gone.id)
    toast.show({ message: `"${gone.title}"을(를) 영구 삭제했습니다` })
    await load()
  }

  return (
    <section>
      <p>
        <Link to="/experiments">← 실험 목록</Link>
      </p>
      <h1 className="page-title">휴지통</h1>
      <p className="muted">삭제한 실험은 {TRASH_RETENTION_DAYS}일 동안 보관하고, 그 뒤에는 자동으로 영구 삭제합니다.</p>
      {items === null ? (
        <p className="muted">불러오는 중…</p>
      ) : items.length === 0 ? (
        <EmptyState title="휴지통이 비어 있습니다" description="삭제한 실험이 여기에 나타납니다." />
      ) : (
        <ul className="trash-list">
          {items.map((e) => (
            <li key={e.id} className="trash-row">
              <div className="trash-row__info">
                <strong>{e.title}</strong>
                <span className="muted">
                  삭제 {formatDateTime(e.deletedAt)} · {trashDaysLeft(e.deletedAt, now)}일 뒤 영구 삭제
                </span>
              </div>
              <button type="button" className="btn" onClick={() => void restore(e)} aria-label={`${e.title} 복원`}>
                복원
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => setTarget(e)} aria-label={`${e.title} 영구 삭제`}>
                영구 삭제
              </button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={target !== null}
        danger
        title="영구 삭제할까요?"
        message={target ? `"${target.title}"과(와) 딸린 단계·조건·결과가 모두 사라지고 되돌릴 수 없습니다.` : ''}
        confirmLabel="영구 삭제"
        onConfirm={() => void purge()}
        onCancel={() => setTarget(null)}
      />
    </section>
  )
}
