import type { ReactNode } from 'react'
import styles from './operator-page.module.css'

export function OperatorPage({ children, className }: Readonly<{ children: ReactNode; className?: string }>) {
  return <div className={[styles.page, className].filter(Boolean).join(' ')}>{children}</div>
}

export function OperatorPageHeader({
  description,
  extra,
  title,
}: Readonly<{ description: string; extra?: ReactNode; title: string }>) {
  return (
    <header className={styles.header}>
      <div className={styles.copy}>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {extra ? <div className={styles.extra}>{extra}</div> : null}
    </header>
  )
}
