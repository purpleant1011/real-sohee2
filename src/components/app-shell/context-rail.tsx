import { AppLink as Link } from '@/components/navigation/app-link'
import { CheckCircle2, CircleGauge, FileCheck2, PanelsTopLeft, Sparkles, WalletCards } from 'lucide-react'
import styles from './app-shell.module.css'

export type ContextRailItem = Readonly<{
  id: string
  kind: 'focus' | 'running' | 'approval' | 'report' | 'credit'
  title: string
  description: string
  href: string
  statusLabel: string
}>

const itemIcons = {
  focus: Sparkles,
  running: CircleGauge,
  approval: FileCheck2,
  report: CheckCircle2,
  credit: WalletCards,
} as const

export const defaultContextRailItems: readonly ContextRailItem[] = [
  {
    id: 'focus',
    kind: 'focus',
    title: '오늘의 초점',
    description: '작업공간 데이터가 연결되면 우선 확인할 일을 정리해 드려요.',
    href: '/app',
    statusLabel: '데이터 연결 준비 중',
  },
  {
    id: 'running',
    kind: 'running',
    title: '진행 중인 일',
    description: '아직 확인된 진행 업무가 없어요.',
    href: '/app/work',
    statusLabel: '작업공간 연결 대기',
  },
  {
    id: 'approval',
    kind: 'approval',
    title: '승인 대기',
    description: '검토가 필요한 실제 버전만 이곳에 표시해요.',
    href: '/app/work',
    statusLabel: '확인 준비 중',
  },
  {
    id: 'report',
    kind: 'report',
    title: '다음 보고',
    description: '수집 출처가 확인된 뒤 다음 보고 시점을 안내해요.',
    href: '/app/reports',
    statusLabel: '외부 데이터 미연결',
  },
]

type ContextRailProps = Readonly<{
  description?: string
  items?: readonly ContextRailItem[]
  title?: string
  variant?: 'rail' | 'summary' | 'menu'
}>

export function ContextRail({
  description = '실제 연결 상태만 표시해요',
  items = defaultContextRailItems,
  title = '소희의 업무 문맥',
  variant = 'rail',
}: ContextRailProps) {
  const content = (
    <ul className={styles.contextList}>
      {items.map((item) => {
        const Icon = itemIcons[item.kind]

        return (
          <li className={styles.contextCard} key={item.id}>
            <div className={styles.contextCardHeader}>
              <span className={styles.contextIcon} aria-hidden="true">
                <Icon strokeWidth={1.8} />
              </span>
              <div>
                <h3>{item.title}</h3>
                <p className={styles.contextStatus}>{item.statusLabel}</p>
              </div>
            </div>
            <p>{item.description}</p>
            <Link href={item.href} prefetch={false}>관련 화면 보기</Link>
          </li>
        )
      })}
    </ul>
  )

  if (variant === 'summary') {
    return (
      <details className={styles.contextSummary}>
        <summary>{title} 보기</summary>
        {content}
      </details>
    )
  }

  if (variant === 'menu') {
    return (
      <details className={styles.contextMenu}>
        <summary aria-label="업무 문맥 열기">
          <PanelsTopLeft aria-hidden="true" strokeWidth={1.8} />
          <span>업무 문맥</span>
        </summary>
        <div className={styles.contextPopover}>
          <div className={styles.contextRailHeading}>
            <p>{title}</p>
            <span>{description}</span>
          </div>
          {content}
        </div>
      </details>
    )
  }

  return (
    <aside aria-label="업무 문맥" className={styles.contextRail} data-v07-column="context">
      <div className={styles.contextRailHeading}>
        <p>{title}</p>
        <span>{description}</span>
      </div>
      {content}
    </aside>
  )
}
