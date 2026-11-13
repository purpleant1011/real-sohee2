import styles from './metric.module.css'

export type MetricState =
  | 'available'
  | 'confirmed_zero'
  | 'collecting'
  | 'stale'
  | 'not_supported'
  | 'permission_denied'
  | 'failed'

const stateCopy: Readonly<Record<MetricState, string>> = {
  available: '수집 완료',
  confirmed_zero: '확인된 0건',
  collecting: '수집 중',
  stale: '수집 지연',
  not_supported: '현재 미지원',
  permission_denied: '권한 필요',
  failed: '수집 실패',
}

export function Metric({
  detail,
  label,
  state,
  suffix,
  value,
}: Readonly<{
  detail?: string
  label: string
  state: MetricState
  suffix?: string
  value: number | string | null
}>) {
  const usableValue = state === 'available' || state === 'confirmed_zero' || state === 'stale'

  return (
    <article className={styles.metric} data-state={state}>
      <div className={styles.heading}>
        <span>{label}</span>
        <small>{stateCopy[state]}</small>
      </div>
      <strong>{usableValue && value !== null ? <>{value}{suffix}</> : <span aria-hidden="true">—</span>}</strong>
      {detail ? <p>{detail}</p> : null}
    </article>
  )
}
