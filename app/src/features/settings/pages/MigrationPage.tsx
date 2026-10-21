import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from '../../auth/AccountContext'
import { useBackend } from '../../../app/BackendContext'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { BACKUP_SCHEMA_VERSION, type DataBackend } from '../../../data/repositories'
import { backupFileName, serializeBackup } from '../application/backup'
import { downloadText } from '../application/download'
import { formatDateTime } from '../../../shared/lib/format'
import { localCounts, markMigrated, migratedAt, openLocalBackend } from '../application/localData'
import { migrateLocalToRemote, previewMigration, totalOf, TABLE_LABEL, type MigrationPreview, type MigrationReport, type MigrationTable } from '../application/migrate'

const TABLES = Object.keys(TABLE_LABEL) as MigrationTable[]

function CountTable({ rows }: { rows: { label: string; counts: Record<MigrationTable, number> }[] }) {
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label="건수 비교 표">
      <table className="stat-table">
        <thead>
          <tr>
            <th scope="col">구분</th>
            {TABLES.map((t) => (
              <th key={t} scope="col">
                {TABLE_LABEL[t]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              {TABLES.map((t) => (
                <td key={t}>{r.counts[t]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * 로컬 → 클라우드 이전 마법사. 이 브라우저에 있는 기록을 로그인한 계정의 서버 저장소로 옮긴다.
 * 순서: 건수 미리보기 → 로컬 백업 파일 자동 저장 → 올리기 → 서버에서 다시 읽어 검증. 로컬 데이터는 지우지 않는다.
 */
export function MigrationPage() {
  const remote = useBackend()
  const account = useAccount()
  const local = useRef<(DataBackend & { close(): void }) | null>(null)
  const [preview, setPreview] = useState<MigrationPreview | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'running' | 'done' | 'error'>('loading')
  const [progress, setProgress] = useState('')
  const [report, setReport] = useState<MigrationReport | null>(null)
  const [error, setError] = useState('')
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [wiped, setWiped] = useState(false)

  const load = useCallback(async () => {
    setState('loading')
    try {
      if ((await localCounts()) === null) {
        setPreview(null)
        setState('ready')
        return
      }
      local.current?.close()
      local.current = openLocalBackend()
      setPreview(await previewMigration(local.current, remote))
      setState('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setState('error')
    }
  }, [remote])

  useEffect(() => {
    void load()
    return () => local.current?.close()
  }, [load])

  if (!account) {
    return (
      <section className="narrow">
        <h1 className="page-title">클라우드로 이전</h1>
        <EmptyState
          title="지금은 로컬 저장소를 쓰고 있습니다"
          description="서버 저장소(Supabase)로 옮기려면 먼저 설정이 필요합니다. docs/phase9/02-설정-가이드.md의 순서대로 .env.local을 채우고 개발 서버를 다시 시작하세요."
        />
      </section>
    )
  }

  const run = async () => {
    if (!local.current) return
    setError('')
    setState('running')
    try {
      // 1) 올리기 전에 로컬 백업 파일부터 받아 둔다. 문제가 생겨도 되돌릴 수 있게.
      setProgress('로컬 백업 파일을 저장하는 중')
      const file = await local.current.backup.exportAll()
      downloadText(backupFileName(), serializeBackup({ ...file, schemaVersion: BACKUP_SCHEMA_VERSION }), 'application/json;charset=utf-8')
      // 2) 올리고 검증
      const r = await migrateLocalToRemote(local.current, remote, (s) => setProgress(`${s.label} (${Math.min(s.done + 1, s.total)}/${s.total})`))
      setReport(r)
      if (r.ok) markMigrated(account.userId)
      setState('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setState('error')
    }
  }

  const wipeLocal = async () => {
    setConfirmWipe(false)
    if (!local.current) return
    await local.current.backup.importAll(
      { schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: new Date().toISOString(), projects: [], experiments: [], steps: [], dataItems: [], templates: [], deviations: [] },
      'replace',
    )
    setWiped(true)
  }

  const done = migratedAt(account.userId)

  return (
    <section className="narrow migrate">
      <p>
        <Link to="/settings">← 설정</Link>
      </p>
      <h1 className="page-title">클라우드로 이전</h1>
      <p className="muted">이 브라우저에 저장된 기록을 {account.email} 계정의 서버 저장소로 옮깁니다. 같은 id로 올리므로 중간에 멈췄다가 다시 해도 중복되지 않습니다.</p>

      {state === 'loading' && <p className="muted">불러오는 중…</p>}

      {state === 'ready' && !preview && (
        <EmptyState title="옮길 로컬 데이터가 없습니다" description="이 브라우저에는 로컬 저장소 기록이 없습니다. 지금부터 입력하는 내용은 서버에 저장됩니다.">
          <Link to="/" className="btn btn--primary">
            홈으로
          </Link>
        </EmptyState>
      )}

      {(state === 'ready' || state === 'running') && preview && (
        <>
          {done && <p className="req-hint">이 계정으로는 {formatDateTime(done)}에 이전을 마쳤습니다. 다시 실행해도 같은 데이터는 중복되지 않습니다.</p>}
          <CountTable
            rows={[
              { label: '이 브라우저(로컬)', counts: preview.local },
              { label: '서버(지금 계정)', counts: preview.remote },
            ]}
          />
          <p className="analysis__note">
            이전하면: ① 로컬 백업 파일을 먼저 내려받고 ② 서버에 올린 뒤 ③ 서버에서 다시 읽어 모든 행이 들어갔는지 확인합니다.
            {preview.alreadyThere > 0 && ` 서버에 같은 id가 이미 있는 행 ${preview.alreadyThere}개는 서버 쪽이 더 최신이면 그대로 둡니다.`} 로컬 데이터는 지우지 않습니다.
          </p>
          {totalOf(preview.local) === 0 ? (
            <p className="muted">로컬 저장소가 비어 있습니다.</p>
          ) : (
            <div className="form__actions">
              <button type="button" className="btn btn--primary" disabled={state === 'running'} onClick={() => void run()}>
                {state === 'running' ? '이전하는 중…' : `백업 파일 받고 ${totalOf(preview.local).toLocaleString('ko-KR')}개 이전하기`}
              </button>
            </div>
          )}
          {state === 'running' && (
            <p role="status" className="muted">
              {progress}
            </p>
          )}
        </>
      )}

      {state === 'error' && (
        <div className="req-banner req-banner--todo" role="alert">
          <b>이전하지 못했습니다.</b> {error}
          <p className="muted">이미 올라간 것은 서버에 남아 있고, 다시 실행하면 이어서 올라갑니다. 로컬 데이터는 그대로입니다.</p>
          <button type="button" className="btn" onClick={() => void load()}>
            다시 시도
          </button>
        </div>
      )}

      {state === 'done' && report && (
        <section aria-label="이전 결과">
          <div className={`req-banner ${report.ok ? 'req-banner--ok' : 'req-banner--todo'}`} role="status">
            {report.ok ? <b>이전을 마쳤고, 서버에서 다시 읽어 모든 행이 들어간 것을 확인했습니다.</b> : <b>일부 행이 서버에 들어가지 않았습니다({totalOf(report.missing)}개). 다시 시도해 보세요.</b>}
            <p className="muted">
              올린 행 {report.uploaded.toLocaleString('ko-KR')}개{report.keptNewerOnServer > 0 && `, 서버가 더 최신이라 그대로 둔 행 ${report.keptNewerOnServer}개`}
            </p>
          </div>
          <CountTable
            rows={[
              { label: '이 브라우저(로컬)', counts: report.local },
              { label: '서버(이전 후)', counts: report.remoteAfter },
              ...(report.ok ? [] : [{ label: '서버에 없는 행', counts: report.missing }]),
            ]}
          />
          {report.ok && !wiped && (
            <p className="analysis__note">
              로컬 데이터는 그대로 남아 있습니다. 서버에서 잘 보이는지 확인한 뒤, 이 브라우저의 로컬 기록을 지우려면{' '}
              <button type="button" className="link" onClick={() => setConfirmWipe(true)}>
                로컬 데이터 지우기
              </button>
              를 누르세요. 앞에서 받은 백업 파일은 따로 보관하세요.
            </p>
          )}
          {wiped && <p className="req-hint">이 브라우저의 로컬 데이터를 지웠습니다.</p>}
          <Link to="/" className="btn btn--primary">
            홈으로
          </Link>
        </section>
      )}

      <ConfirmDialog
        open={confirmWipe}
        danger
        title="이 브라우저의 로컬 데이터를 지울까요?"
        message="서버로 옮긴 기록의 로컬 사본을 모두 지웁니다. 서버 데이터는 그대로입니다. 앞에서 받은 백업 파일이 있는지 확인하세요."
        confirmLabel="로컬 데이터 지우기"
        onConfirm={() => void wipeLocal()}
        onCancel={() => setConfirmWipe(false)}
      />
    </section>
  )
}
