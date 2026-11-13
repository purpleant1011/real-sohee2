import { notFound } from 'next/navigation'
import { PublishStatusView } from '@/features/mobile-firstpost/publish-status-view'
import { publishStatusFor, type PublishStatusInput } from '@/features/mobile-firstpost/publish-status'

export const dynamic = 'force-dynamic'

/**
 * 게시 상태 프리뷰. 개발 전용(운영 404). /dev/mobile-r2/publish-status
 * 예시 데이터만 쓰고 서버 조회·외부 요청은 보내지 않는다.
 */
export const PUBLISH_STATUS_EXAMPLES: readonly { title: string; input: PublishStatusInput }[] = [
  { title: '채널로 보내는 중', input: { deliveryStatus: 'pending' } },
  { title: '전송 접수 · 게시물 주소 확인 전', input: { deliveryStatus: 'succeeded' } },
  {
    title: '독립 재조회로 확인',
    input: {
      deliveryStatus: 'succeeded',
      readbackUrl: 'https://www.instagram.com/p/example/',
      verifiedAt: '2026-10-24T03:00:00.000Z',
    },
  },
  { title: '채널이 거절함', input: { deliveryStatus: 'failed', failureCause: 'PROVIDER_REJECTED' } },
  { title: '결과를 확인하지 못함', input: { deliveryStatus: 'failed', failureCause: 'READBACK_UNKNOWN' } },
  { title: '상태를 모름', input: { deliveryStatus: 'unknown' } },
  { title: '직접 복사해서 전달', input: { manualDelivery: 'copy' } },
  { title: '보관함에 둠', input: { archived: true } },
]

export default function PublishStatusPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <main className="mx-auto flex max-w-[480px] flex-col gap-6 px-4 py-6">
      <p className="text-xs text-muted-foreground">예시 화면 · 실제 데이터가 아닙니다</p>
      {PUBLISH_STATUS_EXAMPLES.map((example) => (
        <section key={example.title} aria-label={example.title} className="flex flex-col gap-2 rounded-2xl border border-border p-4">
          <p className="text-xs text-muted-foreground">{example.title}</p>
          <PublishStatusView status={publishStatusFor(example.input)} />
        </section>
      ))}
    </main>
  )
}
