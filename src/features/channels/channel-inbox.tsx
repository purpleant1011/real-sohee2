import { AppLink as Link } from '@/components/navigation/app-link'
import type { WorkspaceRole } from '@/features/auth/workspace-context'
import type { ChannelInteraction } from './interaction-repository'
import { ChannelResponseCard } from './channel-response-card'
import styles from './channel-inbox.module.css'

const labels = {
  comment: '댓글', reply: '답글', mention: '멘션', dm: 'DM',
} as const

function inquiryLabel(item: ChannelInteraction) {
  return /예약|시간|가능/u.test(item.inboundText) ? '예약 문의' : `${labels[item.category]} 문의`
}

export function ChannelInbox({ workspaceId, role, interactions }: Readonly<{
  workspaceId: string
  role: WorkspaceRole
  interactions: readonly ChannelInteraction[]
}>) {
  return <section className={styles.page} aria-labelledby="channel-inbox-title">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>CUSTOMER RESPONSE DESK</p><h1 id="channel-inbox-title">소희 문의답변</h1></div>
      <p>댓글·DM·예약 문의와 소희의 답변 상태를 빠르게 확인하고 필요한 답변만 검토합니다.</p>
    </header>
    {interactions.length === 0 ? <div className={styles.empty} role="status">
      <h2>아직 수신된 채널 대화가 없어요.</h2>
      <p>Meta 웹훅 연결 후 검증된 댓글·답글·멘션·Instagram DM만 여기에 표시됩니다.</p>
    </div> : <ol className={styles.list}>{interactions.map((item) => <li className={styles.card} key={item.id}>
      <div className={styles.meta}><strong>{item.channel === 'instagram' ? 'Instagram' : 'Threads'} · {labels[item.category]}</strong><span className={styles.inquiryType}>{inquiryLabel(item)}</span><time dateTime={item.occurredAt}>{new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(item.occurredAt))}</time></div>
      <section className={styles.message}><span>고객 문의 원문</span><p>{item.inboundText}</p></section>
      <ChannelResponseCard workspaceId={workspaceId} role={role} interaction={item} />
      <footer className={styles.links}>{item.content ? <Link href={`/app/work/${item.content.id}`}>{item.content.title} · 승인 버전 보기</Link> : <span>연결 콘텐츠 없음</span>}{item.schedule ? <Link href="/app/schedule">예약 {new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(item.schedule.publishAt))} · {item.schedule.status}</Link> : <span>연결 예약 없음</span>}</footer>
    </li>)}</ol>}
    <p className={styles.privacy}>DM과 고객 메시지는 이 작업공간의 운영 권한이 있는 소유자·관리자에게만 표시되며, 토큰과 외부 고객 식별자는 화면에 노출하지 않습니다.</p>
  </section>
}
