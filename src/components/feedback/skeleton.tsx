import styles from './skeleton.module.css'

export function Skeleton({ label = '데이터 확인 중' }: Readonly<{ label?: string }>) {
  return (
    <div aria-busy="true" aria-label={label} className={styles.skeleton} role="status">
      <span className={styles.line} />
      <span className={styles.line} />
      <span className={styles.line} />
    </div>
  )
}
