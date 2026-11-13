import Link from 'next/link'
import styles from './service-unavailable.module.css'

export default function ServiceUnavailablePage() {
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="service-unavailable-title">
        <Link className={styles.brand} href="/" aria-label="소희 홈">
          <span aria-hidden="true">S.</span>
          <strong>소희</strong>
        </Link>
        <div className={styles.statusIcon} aria-hidden="true">···</div>
        <p className={styles.eyebrow}>연결 확인 중</p>
        <h1 id="service-unavailable-title">소희 연결을 잠시 준비하고 있어요</h1>
        <p className={styles.description}>
          작성하던 내용은 바꾸지 않았어요. 잠시 후 다시 연결하면 이어서 작업할 수 있어요.
        </p>
        <div className={styles.actions}>
          <Link className={styles.primaryAction} href="/app">다시 연결하기</Link>
          <Link className={styles.secondaryAction} href="/">소희 홈으로</Link>
        </div>
        <p className={styles.helpText}>
          같은 안내가 계속되면 잠시 후 다시 시도해 주세요.
        </p>
      </section>
    </main>
  )
}
