import type { ReactNode } from 'react'
import styles from './chart-frame.module.css'

export function ChartFrame({ children, summary, table, title }: Readonly<{
  children: ReactNode
  summary: string
  table: ReactNode
  title: string
}>) {
  return (
    <section aria-label={title} className={styles.frame}>
      <p className={styles.summary}>{summary}</p>
      <div className={styles.chart}>{children}</div>
      <details className={styles.tableAlternative}>
        <summary>표로 자세히 보기</summary>
        <div>{table}</div>
      </details>
    </section>
  )
}
