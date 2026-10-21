import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export interface ToastInput {
  message: string
  /** 예: "되돌리기". 누르면 onAction이 호출되고 토스트가 닫힌다. */
  actionLabel?: string
  onAction?: () => void
  /** 기본 5초(E2 되돌리기 시간) */
  durationMs?: number
}

interface ToastItem extends ToastInput {
  id: number
}

interface ToastApi {
  show: (t: ToastInput) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.delete(id)
    setItems((xs) => xs.filter((x) => x.id !== id))
  }, [])

  const show = useCallback(
    (t: ToastInput) => {
      const id = nextId.current++
      setItems((xs) => [...xs, { ...t, id }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), t.durationMs ?? 5000),
      )
    },
    [dismiss],
  )

  useEffect(() => {
    const map = timers.current
    return () => {
      map.forEach(clearTimeout)
      map.clear()
    }
  }, [])

  const api = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast" role="status">
            <span>{t.message}</span>
            {t.actionLabel && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  t.onAction?.()
                  dismiss(t.id)
                }}
              >
                {t.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('ToastProvider 안에서만 useToast를 쓸 수 있습니다')
  return api
}
