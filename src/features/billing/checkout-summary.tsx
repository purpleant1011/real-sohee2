import type { CheckoutIntent } from './types'

const labels: Record<CheckoutIntent['state'], string> = {
  draft: '주문 준비', provider_pending: '결제 기능 연결 대기', provider_succeeded: '결제 확인 중', activation_succeeded: '결제와 활성화 완료', failed: '결제 실패', cancelled: '주문 취소',
}
export function CheckoutSummary({ intent }: Readonly<{ intent: CheckoutIntent }>) {
  return <section aria-label="결제 요약"><h1>{labels[intent.state]}</h1>{intent.state === 'provider_pending' ? <p>선택한 요금제는 저장했지만 결제되거나 활성화되지는 않았어요.</p> : null}</section>
}
