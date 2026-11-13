import type { ReactNode } from 'react'
import styles from './page-header.module.css'

type PageHeaderProps = Readonly<{
  actions?: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  status?: ReactNode
  title: ReactNode
}>

export function PageHeader({ actions, description, eyebrow, status, title }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.copy}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <div className={styles.description}>{description}</div> : null}
      </div>
      {status || actions ? (
        <div className={styles.utilities}>
          {status ? <div data-slot="page-header-status">{status}</div> : null}
          {actions ? <div className={styles.actions} data-slot="page-header-actions">{actions}</div> : null}
        </div>
      ) : null}
    </header>
  )
}
