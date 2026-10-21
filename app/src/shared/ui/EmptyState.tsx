import type { ReactNode } from 'react'

interface Props {
  title: string
  description?: string
  /** 첫 행동 버튼 등 */
  children?: ReactNode
}

/** 비어 있는 화면. 무엇이 여기에 나타날지와 첫 행동을 함께 보여 준다. */
export function EmptyState({ title, description, children }: Props) {
  return (
    <div className="empty" role="status">
      <h2 className="empty__title">{title}</h2>
      {description && <p className="empty__desc">{description}</p>}
      {children && <div className="empty__action">{children}</div>}
    </div>
  )
}
