import { useState, type Dispatch, type SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import type { Account } from '../app/AccountContext'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useToast } from '../components/Toast'
import type { DataBackend } from '../data/repositories'
import { BACKUP_SCHEMA_VERSION } from '../data/repositories'
import { clearErrors, type ErrorEntry } from '../services/errorLog'
import { formatDateTime } from '../services/format'
import { countExampleData, removeExampleData } from '../services/firstRun'
import type { AppSettings } from '../services/settings'

function ProfileForm({ account }: { account: Account }) {
  const [name, setName] = useState(account.displayName)
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const run = async (fn: () => Promise<void>, ok: string) => {
    setMsg('')
    setErr('')
    try {
      await fn()
      setMsg(ok)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="profile-name">표시 이름</label>
        <input id="profile-name" className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        <p className="muted">새 실험의 담당자 칸에 미리 들어갑니다.</p>
        <button type="button" className="btn" onClick={() => void run(() => account.setDisplayName(name), '표시 이름을 저장했습니다.')}>
          이름 저장
        </button>
      </div>
      <div className="field">
        <label htmlFor="profile-password">새 비밀번호</label>
        <input id="profile-password" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button
          type="button"
          className="btn"
          disabled={password.length < 6}
          onClick={() =>
            void run(async () => {
              await account.updatePassword(password)
              setPassword('')
            }, '비밀번호를 바꿨습니다.')
          }
        >
          비밀번호 변경
        </button>
      </div>
      {err && (
        <p className="field__error" role="alert">
          {err}
        </p>
      )}
      {msg && (
        <p className="req-hint" role="status">
          {msg}
        </p>
      )}
    </div>
  )
}

interface Props {
  backend: DataBackend
  account: Account | null
  settings: AppSettings
  onSettings: Dispatch<SetStateAction<AppSettings>>
  errors: ErrorEntry[]
  onErrors: Dispatch<SetStateAction<ErrorEntry[]>>
  example: { projects: number; experiments: number } | null
  onExample: Dispatch<SetStateAction<{ projects: number; experiments: number } | null>>
  confirmExample: boolean
  onConfirmExample: Dispatch<SetStateAction<boolean>>
  onExampleRemoved: () => Promise<void>
  change: (patch: Partial<AppSettings>) => void
}

export function SettingsSupportPanels({ backend, account, settings, errors, onErrors, example, onExample, confirmExample, onConfirmExample, onExampleRemoved, change }: Props) {
  const toast = useToast()
  return (
    <>
      <section className="panel" aria-labelledby="s-screen">
        <h2 id="s-screen" className="panel__title">
          수행 모드
        </h2>
        <label className="check-option">
          <input type="checkbox" checked={settings.wakeLock} onChange={(e) => change({ wakeLock: e.target.checked })} />
          <span>수행 중에는 화면이 꺼지지 않게 하기 (지원하는 브라우저에서)</span>
        </label>
      </section>

      <section className="panel" aria-labelledby="s-errors">
        <h2 id="s-errors" className="panel__title">
          오류 기록 <span className="muted">({errors.length}건)</span>
        </h2>
        {errors.length === 0 ? (
          <p className="muted">기록된 오류가 없습니다.</p>
        ) : (
          <ul className="plain-list error-list">
            {[...errors].reverse().map((e, i) => (
              <li key={i}>
                <span className="muted">
                  {formatDateTime(e.t)} · {e.source}
                </span>
                <br />
                {e.message}
              </li>
            ))}
          </ul>
        )}
        {errors.length > 0 && (
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => {
              clearErrors()
              onErrors([])
            }}
          >
            오류 기록 지우기
          </button>
        )}
      </section>

      <section className="panel" aria-labelledby="where-title">
        <h2 id="where-title" className="panel__title">
          저장 위치
        </h2>
        {account ? (
          <>
            <p>
              <strong>서버 저장소(Supabase)</strong>에 저장합니다. 로그인한 계정: <b>{account.email}</b>
            </p>
            <p className="muted">같은 계정으로 들어오면 어느 기기에서든 같은 기록이 보입니다. 이 계정의 데이터는 다른 사용자에게 보이지 않습니다.</p>
            <ProfileForm key={account.displayName} account={account} />
            <div className="panel__actions">
              <Link to="/migrate" className="btn">
                이 브라우저의 로컬 데이터를 클라우드로 이전
              </Link>
              <button type="button" className="btn btn--quiet" onClick={() => void account.signOut()}>
                로그아웃
              </button>
            </div>
          </>
        ) : (
          <p>
            지금은 <strong>이 브라우저(로컬 저장소)</strong>에만 저장합니다. 여러 기기에서 쓰거나 백업 부담을 줄이려면 서버 저장소(Supabase)로 옮길 수 있습니다. 순서는 <code>docs/phase9/02-설정-가이드.md</code>에 있습니다.
          </p>
        )}
      </section>

      <section className="panel" aria-labelledby="source-title">
        <h2 id="source-title" className="panel__title">
          예시 데이터 출처
        </h2>
        <p>
          홈의 "예시 데이터 넣기"로 들어오는 콘크리트 배합 예시는 UCI Machine Learning Repository의{' '}
          <a href="https://archive.ics.uci.edu/dataset/165/concrete" target="_blank" rel="noreferrer">
            Concrete Compressive Strength
          </a>{' '}
          공개 데이터를 바탕으로 합니다.
        </p>
        <p className="muted">
          Yeh, I-C. (1998). Modeling of strength of high-performance concrete using artificial neural networks. Cement and Concrete Research, 28(12), 1797–1808. 라이선스{' '}
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
            CC BY 4.0
          </a>
          .
        </p>
        <p className="muted">
          프로젝트 이름과 제품 코드, 날짜, 진행 상태, 절차, 담당자는 예시로 지어낸 것입니다. 시연을 위해 실험 3건의 값을 바꿨고(압축강도 비움, 소수점 위치 실수, 고성능 감수제 항목 삭제),
          해당 실험의 목적 칸에 "시연용으로 바꾼 값"이라고 적혀 있습니다.
        </p>
        {example && example.experiments > 0 && (
          <div className="panel__actions">
            <button type="button" className="btn btn--quiet" onClick={() => onConfirmExample(true)}>
              예시 데이터 지우기 (실험 {example.experiments}건)
            </button>
          </div>
        )}
      </section>

      <p className="muted settings__about">
        lablog {__APP_VERSION__} · 데이터는 이 브라우저(IndexedDB)에 저장 · 파일 형식 버전 {BACKUP_SCHEMA_VERSION}
      </p>

      <ConfirmDialog
        open={confirmExample}
        danger
        title="예시 데이터를 지울까요?"
        message="예시로 들어 있는 프로젝트와 실험을 지웁니다(휴지통을 거치지 않습니다). 직접 만든 실험은 그대로입니다."
        confirmLabel="예시 데이터 지우기"
        onConfirm={() => {
          onConfirmExample(false)
          void removeExampleData(backend).then(async (n) => {
            toast.show({ message: `예시 실험 ${n}건을 지웠습니다` })
            onExample(await countExampleData(backend))
            await onExampleRemoved()
          })
        }}
        onCancel={() => onConfirmExample(false)}
      />

    </>
  )
}
