/**
 * 정부 공인 통신판매업신고증(제 0000-지역-0000 호) 및 사업자 정보 정본.
 *
 * 2026-09-21 예시구청장 발급 통신판매업신고증 및 고객센터 연락처 공식 확인 반영.
 */

export interface OperatorInfo {
  readonly companyName: string
  readonly representative: string
  readonly businessRegistrationNumber: string
  readonly telecomRegistrationNumber: string
  readonly address: string
  readonly phone: string
  readonly supportEmail: string
}

export const OPERATOR_INFO: OperatorInfo = {
  companyName: '예시회사',
  representative: '홍길동',
  businessRegistrationNumber: '000-00-00000',
  telecomRegistrationNumber: '제 0000-지역-0000 호',
  address: '서울특별시 예시구 예시로 1',
  phone: '010-0000-0000',
  supportEmail: 'support@example.com',
} as const

export const OPERATOR_FIELDS: readonly (readonly [label: string, value: string])[] = [
  ['상호', OPERATOR_INFO.companyName],
  ['대표자', OPERATOR_INFO.representative],
  ['사업자등록번호', OPERATOR_INFO.businessRegistrationNumber],
  ['통신판매업신고번호', OPERATOR_INFO.telecomRegistrationNumber],
  ['사업장 주소', OPERATOR_INFO.address],
  ['고객센터', OPERATOR_INFO.phone],
] as const
