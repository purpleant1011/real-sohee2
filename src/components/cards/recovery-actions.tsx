'use client'

import { AlertCircle, ShieldCheck } from 'lucide-react'
import { StatusBadge } from '@/components/status/status-badge'
import styles from './recovery-actions.module.css'

export type RecoveryAction = Readonly<{
  disabled?: boolean
  emphasis?: 'primary' | 'secondary'
  id: string
  label: string
  onSelect: () => void
}>

type RecoveryActionsProps = Readonly<{
  actions: readonly RecoveryAction[]
  creditSummary?: string
  description: string
  preserved?: string
  state: 'failure' | 'unknown'
  title: string
}>

export function RecoveryActions(props: RecoveryActionsProps) {
  const { actions, description, preserved, state, title } = props
  if (actions.length > 2) throw new Error('RecoveryActions supports at most two actions')
  const isUnknown = state === 'unknown'

  return (
    <section className={styles.card} aria-label={title} data-state={state}>
      <div className={styles.icon} aria-hidden="true">
        {isUnknown ? <ShieldCheck /> : <AlertCircle />}
      </div>
      <div className={styles.content}>
        <StatusBadge tone={state} label={isUnknown ? '중복 실행 금지' : '다시 확인 필요'} />
        <h3>{title}</h3>
        <p className={styles.description}>{description}</p>
        {preserved ? (
          <dl className={styles.facts}>
            <div><dt>보존된 내용</dt><dd>{preserved}</dd></div>
          </dl>
        ) : null}
      </div>
      <div className={styles.actions}>
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={action.emphasis === 'primary' ? styles.primaryAction : styles.secondaryAction}
            disabled={action.disabled}
            onClick={action.onSelect}
          >
            {action.label}
          </button>
        ))}
      </div>
    </section>
  )
}
