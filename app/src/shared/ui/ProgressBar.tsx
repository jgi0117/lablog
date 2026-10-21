interface Props {
  percent: number
  label?: string
}

export function ProgressBar({ percent, label }: Props) {
  return (
    <div className="progress">
      <div
        className="progress__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={label ?? '진행률'}
      >
        <div className="progress__fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="progress__pct">{percent}%</span>
    </div>
  )
}
