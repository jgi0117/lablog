import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { useBackend } from '../app/BackendContext'
import { useStorageStatus } from '../app/StorageStatus'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ProgressBar } from '../components/ProgressBar'
import { useToast } from '../components/Toast'
import { useBackupExport } from '../hooks/useBackupExport'
import { lastBackupAt, parseBackup, type BackupSummary } from '../services/backup'
import { downloadText } from '../services/download'
import { clearErrors, readErrors, type ErrorEntry } from '../services/errorLog'
import { formatDateTime, formatRelative } from '../services/format'
import { getSettings, saveSettings, type AppSettings } from '../services/settings'
import { formatBytes } from '../services/storage'
import { clearUsage, logUsage, readUsage, summarizeUsage, type UsageSummary } from '../services/usage'
import type { BackupFile } from '../data/repositories'

/** 파일 내용을 글자로 읽는다. 오래된 브라우저를 위해 FileReader로도 읽을 수 있게 한다. */
function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsText(file)
  })
}

type Mode = 'merge' | 'replace'

interface Pending {
  fileName: string
  file: BackupFile
  summary: BackupSummary
}

/** 설정: 백업(내보내기·가져오기), 저장 상태, 사용 기록, 오류 기록, 앱 정보. */
export function SettingsPage() {
  const backend = useBackend()
  const toast = useToast()
  const status = useStorageStatus()
  const exportNow = useBackupExport()
  const fileInput = useRef<HTMLInputElement>(null)
  const [settings, setSettings] = useState<AppSettings>(getSettings())
  const [last, setLast] = useState<string | null>(lastBackupAt())
  const [pending, setPending] = useState<Pending | null>(null)
  const [importError, setImportError] = useState('')
  const [mode, setMode] = useState<Mode>('merge')
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const [currentCount, setCurrentCount] = useState<number | null>(null)
  const [usage, setUsage] = useState<UsageSummary>(() => summarizeUsage(readUsage()))
  const [errors, setErrors] = useState<ErrorEntry[]>(() => readErrors())

  const loadCount = useCallback(async () => {
    try {
      setCurrentCount((await backend.experiments.list()).total)
    } catch {
      setCurrentCount(null)
    }
  }, [backend])

  useEffect(() => {
    void loadCount()
  }, [loadCount])

  const doExport = async () => {
    if (await exportNow()) setLast(lastBackupAt())
  }

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    setPending(null)
    setImportError('')
    if (!file) return
    let text: string
    try {
      text = await readFileText(file)
    } catch {
      setImportError('파일을 읽지 못했습니다. 다시 선택해 보세요.')
      return
    }
    const res = parseBackup(text)
    if (!res.ok) {
      setImportError(res.error)
      return
    }
    setPending({ fileName: file.name, file: res.file, summary: res.summary })
  }

  const reset = () => {
    setPending(null)
    setImportError('')
    if (fileInput.current) fileInput.current.value = ''
  }

  const runImport = async () => {
    if (!pending) return
    setBusy(true)
    try {
      // 바꾸기는 되돌릴 수 없으므로, 먼저 지금 데이터를 파일로 저장하고 실패하면 중단한다.
      if (mode === 'replace' && currentCount !== 0) {
        const saved = await exportNow()
        if (!saved) {
          setImportError('현재 데이터를 먼저 백업하지 못해 가져오기를 멈췄습니다. 아무것도 바뀌지 않았습니다.')
          return
        }
        setLast(lastBackupAt())
      }
      const { imported } = await backend.backup.importAll(pending.file, mode)
      logUsage('backup_import', { mode, imported })
      toast.show({ message: `가져오기를 마쳤습니다 (${mode === 'merge' ? '합치기' : '바꾸기'}, 항목 ${imported}개)` })
      reset()
      await loadCount()
    } catch (e) {
      setImportError(e instanceof Error ? e.message : '가져오는 중 문제가 생겼습니다. 아무것도 바뀌지 않았을 수 있으니 목록을 확인하세요.')
    } finally {
      setBusy(false)
      setConfirmReplace(false)
    }
  }

  const change = (patch: Partial<AppSettings>) => setSettings(saveSettings(patch))

  const exportUsage = () => {
    const ok = downloadText('lablog-usage.json', JSON.stringify(readUsage(), null, 2), 'application/json;charset=utf-8')
    toast.show({ message: ok ? '사용 기록 파일을 저장했습니다' : '파일을 저장하지 못했습니다' })
  }

  const persistText = {
    pending: '확인하는 중…',
    granted: '허용됨: 브라우저가 이 사이트의 데이터를 자동으로 지우지 않도록 보장합니다.',
    denied: '허용되지 않음: 저장 공간이 부족해지면 브라우저가 이 데이터를 지울 수 있습니다. 백업 파일을 꼭 만들어 두세요.',
    unsupported: '이 브라우저는 확인할 수 없습니다. 백업 파일을 만들어 두세요.',
  }[status.persist]

  return (
    <section className="settings">
      <h1 className="page-title">설정</h1>

      <section className="panel" aria-labelledby="s-backup">
        <h2 id="s-backup" className="panel__title">
          백업과 복원
        </h2>
        <p>이 앱의 데이터는 이 브라우저에만 저장됩니다. 브라우저 데이터를 지우거나 기기를 바꾸면 사라지므로, 파일로 백업해 두세요.</p>
        <dl className="meta-list">
          <dt>마지막 백업</dt>
          <dd>{last ? `${formatDateTime(last)} (${formatRelative(last)})` : '아직 없음'}</dd>
          <dt>현재 실험</dt>
          <dd>{currentCount === null ? '—' : `${currentCount}건`}</dd>
        </dl>
        <div className="panel__actions">
          <button type="button" className="btn btn--primary" onClick={() => void doExport()}>
            백업 파일로 내보내기
          </button>
          <label className="btn" htmlFor="import-file">
            백업 파일 가져오기
          </label>
          <input id="import-file" ref={fileInput} type="file" accept=".json,application/json" className="visually-hidden" onChange={(e) => void onPickFile(e)} />
        </div>

        {importError && (
          <p className="field__error" role="alert">
            {importError}
          </p>
        )}

        {pending && (
          <div className="import-preview" role="region" aria-label="가져올 내용 미리보기">
            <h3 className="panel__sub">가져올 파일: {pending.fileName}</h3>
            <p>
              프로젝트 {pending.summary.projects}개 · 실험 {pending.summary.experiments}건 · 단계 {pending.summary.steps}개 · 조건·결과 {pending.summary.dataItems}개
              {pending.summary.exportedAt && <span className="muted"> (내보낸 때 {formatDateTime(pending.summary.exportedAt)})</span>}
            </p>
            <fieldset className="radio-group">
              <legend>가져오는 방법</legend>
              <label>
                <input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
                <span>
                  <strong>합치기</strong> — 지금 데이터는 그대로 두고, 같은 항목은 더 최근에 고친 쪽을 남깁니다.
                </span>
              </label>
              <label>
                <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                <span>
                  <strong>바꾸기</strong> — 지금 데이터를 모두 지우고 파일의 내용으로 바꿉니다. 먼저 현재 데이터를 백업 파일로 저장합니다.
                </span>
              </label>
            </fieldset>
            <div className="panel__actions">
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => (mode === 'replace' ? setConfirmReplace(true) : void runImport())}>
                가져오기
              </button>
              <button type="button" className="btn" onClick={reset}>
                취소
              </button>
            </div>
          </div>
        )}
        <p>
          삭제한 실험은 <Link to="/trash">휴지통</Link>에서 30일 동안 복원할 수 있습니다.
        </p>
      </section>

      <section className="panel" aria-labelledby="s-storage">
        <h2 id="s-storage" className="panel__title">
          저장 상태
        </h2>
        <dl className="meta-list">
          <dt>저장소</dt>
          <dd>{status.blocked ? '열 수 없음 (기록이 남지 않습니다)' : '정상'}</dd>
          <dt>영구 저장</dt>
          <dd>{persistText}</dd>
        </dl>
        {status.estimate && status.estimate.quota > 0 && (
          <>
            <ProgressBar percent={Math.min(100, Math.round(status.estimate.ratio * 100))} label="저장 공간 사용률" />
            <p className="muted">
              {formatBytes(status.estimate.usage)} / {formatBytes(status.estimate.quota)} 사용
            </p>
          </>
        )}
      </section>

      <section className="panel" aria-labelledby="s-usage">
        <h2 id="s-usage" className="panel__title">
          사용 기록
        </h2>
        <p>
          파일럿에서 "검색해서 얼마나 빨리 여는지", "빠진 것이 줄어드는지"를 확인하려고 이 기기에만 시간과 개수를 남깁니다. 실험 제목, 값, 메모는 기록하지 않으며 어디로도 전송하지 않습니다.
        </p>
        <label className="check-option">
          <input type="checkbox" checked={settings.usageLog} onChange={(e) => change({ usageLog: e.target.checked })} />
          <span>사용 기록 남기기</span>
        </label>
        <dl className="meta-list">
          <dt>검색 후 열기까지</dt>
          <dd>{usage.medianOpenSec === null ? '기록 없음' : `중앙값 ${usage.medianOpenSec}초 · 10초 안 ${Math.round((usage.within10s ?? 0) * 100)}%`}</dd>
          <dt>완료할 때 빠진 것이 남은 비율</dt>
          <dd>{usage.completes === 0 ? '기록 없음' : `${usage.completesWithGaps} / ${usage.completes}건`}</dd>
          <dt>확인할 것 개수(주별)</dt>
          <dd>
            이번 주 {usage.gapsThisWeek ?? '—'} · 지난주 {usage.gapsLastWeek ?? '—'}
          </dd>
          <dt>검색 · 단계 체크 · CSV 내보내기 · 백업</dt>
          <dd>
            {usage.searches} · {usage.stepToggles} · {usage.csvExports} · {usage.backups}
          </dd>
        </dl>
        <div className="panel__actions">
          <button type="button" className="btn" onClick={exportUsage} disabled={usage.events === 0}>
            기록 내보내기
          </button>
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => {
              clearUsage()
              setUsage(summarizeUsage([]))
              toast.show({ message: '사용 기록을 지웠습니다' })
            }}
            disabled={usage.events === 0}
          >
            기록 지우기
          </button>
        </div>
      </section>

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
              setErrors([])
            }}
          >
            오류 기록 지우기
          </button>
        )}
      </section>

      <p className="muted settings__about">
        lablog {__APP_VERSION__} · 데이터는 이 브라우저(IndexedDB)에 저장 · 파일 형식 버전 1
      </p>

      <ConfirmDialog
        open={confirmReplace}
        danger
        title="현재 데이터를 바꿀까요?"
        message={`지금 데이터(${currentCount ?? '?'}건)를 모두 지우고 파일의 내용으로 바꿉니다. 먼저 현재 데이터를 백업 파일로 저장한 뒤 진행합니다.`}
        confirmLabel="백업하고 바꾸기"
        onConfirm={() => void runImport()}
        onCancel={() => setConfirmReplace(false)}
      />
    </section>
  )
}
