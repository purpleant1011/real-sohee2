import { StateView } from '@/components/mobile-ui/state-view'
import { Button } from '@/components/ui/button'
import { OPERATOR_INFO } from '@/features/marketing/operator-information'

export type BillingStatusKind = 'failed' | 'suspended'

interface BillingStatusNoticeProps {
  status: BillingStatusKind
  onAction?: () => void
  className?: string
}

export function BillingStatusNotice({
  status,
  onAction,
  className,
}: Readonly<BillingStatusNoticeProps>) {
  const contactText = `문의: 고객센터(${OPERATOR_INFO.phone}, ${OPERATOR_INFO.supportEmail})`

  if (status === 'failed') {
    return (
      <StateView
        kind="error"
        title="결제가 되지 않았어요. 결제 수단을 확인해 주세요"
        description={`카드 한도나 유효기간을 확인해 주세요. ${contactText}`}
        action={
          <Button
            variant="default"
            size="sm"
            onClick={onAction}
            className="w-full text-xs"
          >
            결제 수단 다시 확인
          </Button>
        }
        className={className}
      />
    )
  }

  return (
    <StateView
      kind="error"
      title="서비스 이용이 잠시 멈췄어요"
      description={`결제 정보를 확인하시면 바로 다시 이용하실 수 있어요. ${contactText}`}
      action={
        <Button
          variant="default"
          size="sm"
          onClick={onAction}
          className="w-full text-xs"
        >
          결제 정보 확인하기
        </Button>
      }
      className={className}
    />
  )
}
