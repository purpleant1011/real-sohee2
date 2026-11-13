import { AppLink as Link } from '@/components/navigation/app-link'
import {
  ArrowRight,
  BookOpenCheck,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  Layers3,
  Link2,
  MapPin,
  MessageSquareText,
  Palette,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  Store,
  WalletCards,
} from 'lucide-react'
import type { ReadinessSnapshot } from '@/features/reports/repository'
import { ProfileImageCard } from './profile-image-card'
import { SoheeAvatar } from '@/components/brand/sohee-avatar'
import styles from './account-dashboard.module.css'
import { AccountReadinessMetric } from './account-readiness-metric'

const readinessItems = [
  { key: 'business', label: '사업 정보', description: '사업명과 기본 운영 정보를 확인합니다.', href: '/app/settings/business', icon: Building2 },
  { key: 'brand', label: '브랜드 기준', description: '말투와 표현 기준을 확인합니다.', href: '/app/settings/brand', icon: Palette },
  { key: 'channel', label: '채널 연결', description: '공식 계정 권한과 웹훅 수신 상태를 확인합니다.', href: '/app/settings/channels', icon: Link2 },
  { key: 'knowledge', label: '지식 자료', description: '승인된 자료만 콘텐츠 근거로 사용합니다.', href: '/app/account/knowledge', icon: BookOpenCheck },
  { key: 'automation', label: '자동화', description: '활성화된 안전 규칙을 확인합니다.', href: '/app/account/automation', icon: RefreshCw },
  { key: 'permissions', label: '권한 확인', description: '현재 작업공간의 역할 연결을 확인합니다.', href: '/app/settings/members', icon: ShieldCheck },
] as const

const managementItems = [
  { label: '가입 준비 이어가기', description: '가입 대화와 승인 상태를 다시 확인합니다.', href: '/start', icon: ClipboardCheck },
  { label: '크레딧 사용 내역', description: '제공, 사용, 임시 확보와 반환 내역을 확인합니다.', href: '/app/account/credits', icon: WalletCards },
  { label: '요금제와 결제', description: '요금제 선택 의향과 결제 연결 대기 상태를 확인합니다.', href: '/app/account/billing', icon: CreditCard },
  { label: '대화에서 채널별 결과 확인', description: '대화에서 만든 채널별 결과와 승인 준비 상태를 확인합니다.', href: '/app/work', icon: Layers3 },
  { label: '네이버 플레이스 관리', description: '확인된 정보만 변경 제안으로 준비합니다.', href: '/app/account/place', icon: MapPin },
  { label: '당근 비즈프로필 관리', description: '소식 초안과 수동 마무리 상태를 확인합니다.', href: '/app/account/daangn', icon: Store },
  { label: '외부 실행 준비도', description: '공식 경로와 수동 마무리 가능 여부를 읽기 전용으로 확인합니다.', href: '/app/account/channels/readiness', icon: RadioTower },
] as const

const conversationLinks = [
  ['자동화 대화로 돌아가기', '/app?resume=automation'],
  ['리포트 대화로 돌아가기', '/app?resume=report'],
  ['학습 후보 대화로 돌아가기', '/app?resume=learning'],
  ['채널 상태 대화로 돌아가기', '/app?resume=channel'],
  ['수동 마무리 대화로 돌아가기', '/app?resume=manual-assist'],
] as const

export function AccountDashboard({ avatarUrl = null, snapshot }: Readonly<{
  avatarUrl?: string | null
  snapshot: ReadinessSnapshot
}>) {
  const readyCount = readinessItems.filter((item) => snapshot.input[item.key]).length
  const nextItem = readinessItems.find((item) => !snapshot.input[item.key]) ?? null
  const complete = nextItem === null

  return (
    <section aria-labelledby="account-title" className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 id="account-title">나의 소희</h1>
          <p>소희가 일할 때 사용하는 운영 기준과 연결 상태를 관리해요.</p>
        </div>
        <Link className={styles.reviewLink} href="/app?resume=account">
          <MessageSquareText aria-hidden="true" />
          소희와 운영 점검하기
        </Link>
      </header>

      <ProfileImageCard avatarUrl={avatarUrl} />

      <section aria-label="나의 소희 운영 상태" className={styles.employeeStatus} data-complete={complete}>
        <div className={styles.employeeIdentity}>
          <SoheeAvatar variant="hero" />
          <div>
            <p>현재 작업공간의 운영 기준</p>
            <h2>{complete ? '운영 기준 준비 완료' : '소희가 운영 기준을 확인하고 있어요'}</h2>
            <span>{complete ? '여섯 기준이 모두 연결됐어요. 변경된 내용이 없는지 정기적으로 확인해 주세요.' : '설정이 필요한 항목부터 확인하면 소희가 더 정확한 근거로 일할 수 있어요.'}</span>
          </div>
        </div>
        <div className={styles.readinessSummary}>
          <AccountReadinessMetric percentage={snapshot.percentage} readyCount={readyCount} />
          {nextItem ? <div className={styles.nextSetup}>
            <span>다음 설정</span>
            <strong>{nextItem.label}</strong>
            <Link href={nextItem.href}>{nextItem.label} 설정하기<ArrowRight aria-hidden="true" /></Link>
          </div> : <div className={styles.completedState}>
            <CheckCircle2 aria-hidden="true" />
            <span>모든 핵심 기준이 연결됐어요.</span>
          </div>}
        </div>
      </section>

      <section aria-labelledby="next-decision-title" className={styles.nextDecision} data-complete={complete}>
        <div>
          <p>오늘의 운영 점검</p>
          <h2 id="next-decision-title">지금 확인할 한 가지</h2>
          <span>{nextItem ? `${nextItem.label} 기준을 확인하면 콘텐츠와 리포트가 더 정확해져요.` : '새로 확인할 필수 설정이 없어요. 변경된 운영 기준이 있을 때만 업데이트해 주세요.'}</span>
        </div>
        {nextItem ? <Link href={nextItem.href}>{nextItem.label} 확인하기<ArrowRight aria-hidden="true" /></Link> : <span className={styles.decisionComplete}><CheckCircle2 aria-hidden="true" />필수 기준 확인 완료</span>}
      </section>

      <section aria-labelledby="core-settings-title" className={styles.settingsPanel}>
        <div className={styles.sectionHeading}>
          <div><h2 id="core-settings-title">소희가 따르는 운영 기준</h2><p>소희가 콘텐츠, 응대와 리포트에 실제로 사용하는 출처와 기준입니다.</p></div>
          <span>{readyCount}/6 준비</span>
        </div>
        <div aria-label="준비 항목" className={styles.settingsGrid}>
          {readinessItems.map((item) => {
            const ready = snapshot.input[item.key]
            const Icon = item.icon
            return <Link className={styles.settingRow} href={item.href} key={item.key}>
              <span className={styles.settingIcon}><Icon aria-hidden="true" /></span>
              <span className={styles.settingCopy}><strong>{item.label}</strong><small>{item.description}</small></span>
              <span className={styles.settingState} data-ready={ready}>{ready ? '준비됨' : '설정 필요'}</span>
              <ArrowRight aria-hidden="true" />
            </Link>
          })}
        </div>
      </section>

      <section aria-labelledby="learning-automation-title" className={styles.learningPanel}>
        <div className={styles.sectionHeading}>
          <div><h2 id="learning-automation-title">학습과 자동화</h2><p>소희가 무엇을 다시 사용하고 어디까지 실행할 수 있는지 확인해요.</p></div>
          <span>승인 후 적용</span>
        </div>
        <div className={styles.learningGrid}>
          <Link href="/app/account/knowledge"><BookOpenCheck aria-hidden="true" /><span><strong>승인된 지식</strong><small>출처가 확인된 자료만 콘텐츠와 응대 근거로 사용해요.</small></span><ArrowRight aria-hidden="true" /></Link>
          <Link href="/app/account/automation"><RefreshCw aria-hidden="true" /><span><strong>자동화 안전 범위</strong><small>제안과 실제 외부 실행 권한을 나누어 확인해요.</small></span><ArrowRight aria-hidden="true" /></Link>
          <Link href="/app?resume=learning"><MessageSquareText aria-hidden="true" /><span><strong>학습 후보 검토</strong><small>한 번의 결과를 바로 규칙으로 만들지 않고 근거와 범위를 확인해요.</small></span><ArrowRight aria-hidden="true" /></Link>
        </div>
      </section>

      <section aria-labelledby="account-management-title" className={styles.management}>
        <div className={styles.sectionHeading}>
          <div><h2 id="account-management-title">운영 관리</h2><p>연결, 결제와 외부 실행 상태는 각각의 실제 자료에서 확인합니다.</p></div>
        </div>
        <div className={styles.managementGrid}>
          {managementItems.map((item) => {
            const Icon = item.icon
            return <Link className={styles.managementRow} href={item.href} key={item.href}>
              <span className={styles.managementIcon}><Icon aria-hidden="true" /></span>
              <span><strong>{item.label}</strong><small>{item.description}</small></span>
              <ArrowRight aria-hidden="true" />
            </Link>
          })}
        </div>
      </section>

      <nav aria-label="대화로 돌아가기" className={styles.conversationPanel}>
        <div><MessageSquareText aria-hidden="true" /><span><strong>대화에서 이어서 점검하기</strong><small>운영 기준을 바꾸기 전 관련 대화와 판단 근거를 다시 확인할 수 있어요.</small></span></div>
        <div className={styles.conversationLinks}>
          {conversationLinks.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}
        </div>
      </nav>
    </section>
  )
}
