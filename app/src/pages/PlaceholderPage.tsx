import type { ReactNode } from 'react'
import { EmptyState } from '../components/EmptyState'

interface Props {
  title: string
  /** 이 화면을 실제로 만드는 단계 */
  phase: string
  children?: ReactNode
}

/** 라우트는 열려 있지만 화면은 아직 만들지 않은 곳. 단계가 오면 이 파일 대신 실제 화면으로 바꾼다. */
export function PlaceholderPage({ title, phase, children }: Props) {
  return (
    <section>
      <h1 className="page-title">{title}</h1>
      <EmptyState title="아직 만들지 않은 화면입니다" description={`${phase}에서 만듭니다.`}>
        {children}
      </EmptyState>
    </section>
  )
}
