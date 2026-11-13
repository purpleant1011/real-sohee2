import type { HTMLAttributes } from 'react'
import { OPERATOR_INFO } from './operator-information'

export { OPERATOR_INFO, OPERATOR_FIELDS } from './operator-information'
export type { OperatorInfo } from './operator-information'

export interface OperatorInformationProps extends HTMLAttributes<HTMLElement> {
  readonly className?: string
}

/**
 * PC 및 모바일 공통 푸터용 사업자 정보 표시 컴포넌트.
 * 정본 통신판매업신고번호 및 고객센터 연락처를 포함하여 법정 필수 정보를 표시합니다.
 */
export function OperatorInformation({ className, ...rest }: OperatorInformationProps) {
  return (
    <div
      className={className}
      {...rest}
    >
      <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
        <p>
          <span>상호: {OPERATOR_INFO.companyName}</span>
          <span className="mx-1.5 opacity-40">|</span>
          <span>대표자: {OPERATOR_INFO.representative}</span>
          <span className="mx-1.5 opacity-40">|</span>
          <span>사업자등록번호: {OPERATOR_INFO.businessRegistrationNumber}</span>
          <span className="mx-1.5 opacity-40">|</span>
          <span>통신판매업신고: {OPERATOR_INFO.telecomRegistrationNumber}</span>
        </p>
        <p>
          <span>사업장 주소: {OPERATOR_INFO.address}</span>
        </p>
        <p>
          <span>고객센터: {OPERATOR_INFO.phone}</span>
          <span className="mx-1.5 opacity-40">|</span>
          <span>고객 문의: </span>
          <a
            href={`mailto:${OPERATOR_INFO.supportEmail}`}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {OPERATOR_INFO.supportEmail}
          </a>
        </p>
      </div>
    </div>
  )
}
