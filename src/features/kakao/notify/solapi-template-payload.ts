/**
 * 솔라피 (Solapi) 카카오 알림톡 템플릿 등록 페이로드 빌더
 * KAPI-12
 *
 * 근거 공식 문서 (SOLAPI Documentation):
 * 1. 템플릿 추가 API (POST /kakao/v2/templates):
 *    https://solapi.com/developers/api/templates-createTemplate
 * 2. 템플릿 카테고리 조회 API (GET /kakao/v2/templates/categories):
 *    https://solapi.com/developers/api/templates-20260308-202022
 * 3. 카카오 알림톡 가이드:
 *    https://solapi.dev/guides/kakao-ata-guide
 *
 * [문서에서 확정된 필드]:
 * - channelId: 카카오 채널 ID (카카오 비즈니스 채널 식별자, 필수)
 * - name: 템플릿 명 (templates.ts의 name)
 * - content: 알림톡 본문 텍스트 (#{변수} 포함, 1,000자 이내)
 * - categoryCode: 템플릿 카테고리 코드 (필수)
 * - messageType: 'BA' (기본형)
 * - buttons: 버튼 목록 배열
 *   - buttonType: 버튼 유형 ('WL' - 웹링크 등)
 *   - buttonName: 버튼 텍스트 (최대 14자 권장)
 *   - linkMo: 모바일 웹 링크 URL / 변수 (linkMobile이 아님에 주의)
 *   - linkPc: PC 웹 링크 URL / 변수
 *
 * [문서에서 확정 못 한 필드 / 주의사항 (TODO)]:
 * - TODO(categoryCode): 카카오 카테고리 코드는 비즈니스 업종(예: 뷰티/미용/예약 등)에 따라 카카오에서
 *   실시간으로 내려주는 코드(GET /kakao/v2/templates/categories)를 사용해야 합니다.
 *   문서 예제 코드('003001')를 DEFAULT_CATEGORY_CODE로 제공하되, 사용자가 채널 업종에 맞추어 주입할 수 있습니다.
 * - TODO(templateCode/templateId): 솔라피 API는 템플릿 등록 시 클라이언트가 템플릿 코드를 지정하는 필드를
 *   지원하지 않으며, API 응답으로 솔라피가 고유한 `templateId`를 생성하여 반환합니다.
 *   따라서 templates.ts의 `code`는 요청 바디에는 포함되지 않고 생성 완료 후 식별 매핑에 활용됩니다.
 * - TODO(inspection): 템플릿 생성(POST /kakao/v2/templates) 직후 상태는 심사 대기 전이므로,
 *   실제 발송 승인을 위해서는 별도의 검수 요청 API(POST /kakao/v2/templates/:templateId/inspection)를
 *   호출하거나 솔라피 콘솔에서 카카오 검수 신청을 완료해야 합니다.
 */

import type { AlimtalkTemplate } from './templates'

/**
 * 솔라피 템플릿 생성 시 사용할 기본 카테고리 코드 예시
 * 공식 문서(https://solapi.com/developers/api/templates-createTemplate) 예제: '003001'
 */
export const DEFAULT_CATEGORY_CODE = '003001'

export interface SolapiTemplateButton {
  /** 버튼 타입 (웹링크 WL, 앱링크 AL 등) */
  buttonType: string
  /** 버튼 이름 (예: '예약 확인하기') */
  buttonName: string
  /** 모바일 웹 링크 */
  linkMo?: string
  /** PC 웹 링크 */
  linkPc?: string
  /** 안드로이드 앱 링크 (옵션) */
  linkAnd?: string
  /** iOS 앱 링크 (옵션) */
  linkIos?: string
}

export interface SolapiTemplateCreateBody {
  /** 카카오 비즈니스 채널 ID */
  channelId: string
  /** 템플릿 명 */
  name: string
  /** 알림톡 본문 */
  content: string
  /** 카테고리 코드 (예: '003001') */
  categoryCode: string
  /** 메시지 유형 ('BA': 기본형) */
  messageType: 'BA'
  /** 버튼 목록 (최대 5개) */
  buttons?: SolapiTemplateButton[]
}

export interface BuildSolapiTemplateCreateBodyOptions {
  /** 카카오 비즈니스 채널 ID (필수) */
  channelId: string
  /**
   * 카카오 템플릿 카테고리 코드
   * 미지정 시 솔라피 공식 문서 기본 예제 코드('003001') 사용
   */
  categoryCode?: string
}

/**
 * AlimtalkTemplate 객체를 솔라피 템플릿 등록 API(POST /kakao/v2/templates) 요청 본문으로 변환하는 순수 함수
 */
export function buildSolapiTemplateCreateBody(
  template: AlimtalkTemplate,
  options: BuildSolapiTemplateCreateBodyOptions,
): SolapiTemplateCreateBody {
  if (!options.channelId || options.channelId.trim().length === 0) {
    throw new Error('솔라피 템플릿 등록을 위한 channelId는 필수입니다.')
  }

  const buttons: SolapiTemplateButton[] | undefined =
    template.buttons.length > 0
      ? template.buttons.map((btn) => ({
          buttonType: btn.type,
          buttonName: btn.name,
          linkMo: btn.urlMobile,
          linkPc: btn.urlPc,
        }))
      : undefined

  return {
    channelId: options.channelId.trim(),
    name: template.name,
    content: template.templateBody,
    categoryCode: options.categoryCode?.trim() || DEFAULT_CATEGORY_CODE,
    messageType: template.messageType,
    ...(buttons ? { buttons } : {}),
  }
}
