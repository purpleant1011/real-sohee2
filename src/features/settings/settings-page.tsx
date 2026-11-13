import { AppLink as Link } from '@/components/navigation/app-link'
import type { ReactNode } from 'react'
import styles from './settings.module.css'

const navigation = [
  ['/app/settings/business', '사업 정보'],
  ['/app/settings/services', '서비스 카탈로그'],
  ['/app/settings/brand', '브랜드 기준'],
  ['/app/settings/image-style', '이미지 스타일'],
  ['/app/settings/channels', '채널 연결'],
  ['/app/settings/members', '권한'],
] as const

export function SettingsPage({
  children,
  description,
  title,
}: Readonly<{ children: ReactNode; description: string; title: string }>) {
  return (
    <section aria-labelledby="settings-title" className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>현재 작업공간 운영 기준</p>
        <h1 id="settings-title">{title}</h1>
        <p>{description}</p>
      </header>
      <nav aria-label="운영 설정" className={styles.tabs}>{navigation.map(([href, label]) => <Link href={href} key={href}>{label}</Link>)}</nav>
      {children}
    </section>
  )
}

export function SettingsUnavailable() {
  return <section className={styles.failure} role="alert"><h1>운영 설정을 열지 못했어요</h1><p>다른 작업은 계속할 수 있습니다. 잠시 후 다시 확인해 주세요.</p><Link href="/app/account">나의 소희로 돌아가기</Link></section>
}
