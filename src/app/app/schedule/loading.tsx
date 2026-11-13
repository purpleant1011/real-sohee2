import styles from '@/features/schedule/schedule-board.module.css'

export default function ScheduleLoading() {
  return <div className={styles.loadingSkeleton}>
    <p role="status">오늘 일정을 확인하고 있어요.</p>
    <section aria-label="운영 브리핑 불러오는 중" className={styles.loadingBriefing}>
      <span /><span /><span />
    </section>
    <nav aria-label="날짜 불러오는 중" className={styles.loadingDates}>
      {Array.from({ length: 7 }, (_, index) => <span key={index} />)}
    </nav>
    <section aria-label="일정 목록 불러오는 중" className={styles.loadingTimeline}>
      <span /><span /><span />
    </section>
  </div>
}
