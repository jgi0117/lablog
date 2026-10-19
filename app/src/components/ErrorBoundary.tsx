import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logError } from '../services/errorLog'
import { EmptyState } from './EmptyState'

interface Props {
  children: ReactNode
  /** 이 값이 바뀌면(예: 다른 화면으로 이동) 오류 상태를 풀고 다시 그린다. */
  resetKey?: string
  onExport?: () => void
}

interface State {
  error: Error | null
}

/**
 * 화면을 그리다 예외가 나면 하얀 화면 대신 안내를 보여 준다.
 * 입력한 내용은 이미 이 브라우저에 저장돼 있다는 것과, 데이터 내보내기·새로고침 길을 알려 준다.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logError('render', error)
    void info
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="error-boundary">
        <EmptyState title="화면을 그리는 중 문제가 생겼습니다" description="입력한 내용은 이 브라우저에 저장되어 있습니다. 아래 버튼으로 다시 시도하거나, 먼저 데이터를 파일로 저장해 두세요.">
          <button type="button" className="btn btn--primary" onClick={() => this.setState({ error: null })}>
            다시 시도
          </button>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            새로고침
          </button>
          {this.props.onExport && (
            <button type="button" className="btn" onClick={this.props.onExport}>
              데이터 내보내기
            </button>
          )}
        </EmptyState>
        <p className="muted error-boundary__detail">오류: {this.state.error.message}</p>
      </div>
    )
  }
}
