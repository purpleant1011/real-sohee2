import styles from './status-badge.module.css'

export type StatusTone =
  | 'proposal'
  | 'review'
  | 'active'
  | 'ready'
  | 'external-review'
  | 'success'
  | 'failure'
  | 'unknown'

export type StatusBadgeProps = Readonly<{
  detail?: string
  label: string
  live?: boolean
  tone: StatusTone
}>

export function StatusBadge({ detail, label, live = false, tone }: StatusBadgeProps) {
  return (
    <span className={styles.badge} role={live ? 'status' : undefined} aria-label={live ? label : undefined}>
      <span className={styles.label} data-tone={tone}>
        {label}
      </span>
      {detail ? <span className={styles.detail}>{detail}</span> : null}
    </span>
  )
}
