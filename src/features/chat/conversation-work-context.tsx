import { AppLink as Link } from '@/components/navigation/app-link'
import type { ConversationWorkRef } from './conversation-work-ref'
import styles from './conversation-shell.module.css'

export function ConversationWorkContext({ work }: { work: ConversationWorkRef }) {
  return <section aria-label="선택한 원고 맥락" className={styles.scheduleEntryContext}>
    <p>선택한 원고 · v{work.versionNumber} · 읽기 전용 검토</p>
    <h2>{work.title}</h2>
    <p>이 대화에서는 선택한 저장 버전의 내용을 확인해요. 수정·승인·게시는 원래 원고 화면에서 이어서 진행해 주세요.</p>
    <Link href={work.returnHref}>원래 원고 화면에서 직접 수정</Link>
  </section>
}
