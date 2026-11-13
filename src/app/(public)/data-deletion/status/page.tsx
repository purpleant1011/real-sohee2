import type { Metadata } from 'next'
import Link from 'next/link'
import type { DataDeletionRequestStatus } from '@/features/data-deletion/repository'
import styles from '@/features/marketing/marketing.module.css'

export const metadata: Metadata = {
  title: '삭제 요청 상태 | 소희',
  robots: { index: false, follow: false },
}

const labels = {
  pending: { heading: '삭제 요청 접수', detail: '요청이 접수되어 운영 확인을 기다리고 있습니다.' },
  in_progress: { heading: '삭제 요청 처리 중', detail: '요청 범위와 보관 예외를 확인하고 데이터를 처리하고 있습니다.' },
  completed: { heading: '삭제 요청 완료', detail: '요청된 삭제 처리가 완료되었습니다.' },
  rejected: { heading: '삭제 요청 반려', detail: '권한 또는 요청 범위를 확인할 수 없어 요청이 반려되었습니다.' },
} as const

type ViewProps = Readonly<{
  confirmationCode: string
  status: DataDeletionRequestStatus | null
  unavailable?: boolean
}>

export function DataDeletionStatusView({ confirmationCode, status, unavailable = false }: ViewProps) {
  const label = status ? labels[status.status] : null
  const heading = unavailable
    ? '삭제 요청 상태를 불러올 수 없습니다'
    : label?.heading ?? '삭제 요청을 찾을 수 없습니다'
  return (
    <article className={styles.legalPage}>
      <p className={styles.kicker}>삭제 요청 상태</p>
      <h1>{heading}</h1>
      <p className={styles.legalLead}>
        {unavailable
          ? '현재 상태 저장소에 연결할 수 없습니다. 잠시 후 같은 확인 코드로 다시 조회해 주세요.'
          : label?.detail ?? '확인 코드가 올바른지 확인해 주세요. 존재하지 않는 요청을 완료로 표시하지 않습니다.'}
      </p>
      <div className={styles.legalSections}>
        {status ? (
          <section>
            <h2>확인 코드</h2>
            <p><code>{confirmationCode}</code></p>
            <p>요청 시각: <time dateTime={status.requestedAt}>{status.requestedAt}</time></p>
            <p>최근 변경: <time dateTime={status.updatedAt}>{status.updatedAt}</time></p>
            {status.completedAt ? <p>처리 종료: <time dateTime={status.completedAt}>{status.completedAt}</time></p> : null}
            <p>
              <Link href={`/api/data-deletion/status?code=${encodeURIComponent(confirmationCode)}`}>
                JSON 상태 보기
              </Link>
            </p>
          </section>
        ) : null}
        <section>
          <h2>다른 요청 확인</h2>
          <p><Link href="/data-deletion">사용자 데이터 삭제 안내로 돌아가기</Link></p>
        </section>
      </div>
    </article>
  )
}

export default async function DataDeletionStatusPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ code?: string | string[] }> }>) {
  const value = (await searchParams).code
  const confirmationCode = typeof value === 'string' ? value : ''
  let status: DataDeletionRequestStatus | null = null
  let unavailable = false
  try {
    const { getDataDeletionRequestStatus } = await import('@/features/data-deletion/repository')
    status = await getDataDeletionRequestStatus({ confirmationCode })
  } catch {
    unavailable = true
  }
  return <DataDeletionStatusView confirmationCode={confirmationCode} status={status} unavailable={unavailable} />
}
