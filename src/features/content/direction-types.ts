/**
 * Sohee V0.85 Content Direction Studio Data Types
 * Aligned with V0.85 Design Contract (Doc 13 & Doc 14)
 */

export type ImageLookType =
  | 'indoor_mood'       // 따뜻한 실내 무드
  | 'natural_light'     // 자연광 내추럴
  | 'editorial_close'   // 에디토리얼 클로즈업
  | 'owner_explaining'  // 사장님 설명형

export type CompositionOption =
  | 'upper_body'        // 상반신 중심
  | 'explaining_pose'   // 설명하는 모습
  | 'text_margin'       // 짧은 문구용 여백
  | 'product_focus'     // 제품/시술 결과 강조
  | 'space_atmosphere'  // 매장 공간감

export type DirectionStatus =
  | 'editing'           // 방향 편집 중
  | 'ready_for_review'  // 디렉션 보드 준비됨 (검토 준비)
  | 'awaiting_approval' // 제작 승인 대기
  | 'generating'        // 채널별 문안·이미지 제작 중
  | 'review_results'    // 생성 결과 검토
  | 'scheduled'         // 예약 완료
  | 'completed'         // 게시 완료

export type ChannelDirectionSpec = {
  channel: 'instagram' | 'threads' | 'naver_blog' | 'naver_place' | 'daangn'
  role: string
  copyCount: number
  imageCount: number
  callToAction: string
}

export type ReferenceAsset = {
  id: string
  name: string
  url: string
  sizeBytes?: number
  safetyStatus?: 'safe' | 'checking' | 'rejected'
}

export type ContentDirection = {
  id: string
  workspaceId: string
  version: number
  status: DirectionStatus
  goal: string
  audience: string
  keyMessage: string
  tone: string
  imageLook: ImageLookType
  compositions: readonly CompositionOption[]
  freeformInstruction: string
  referenceAssets: readonly ReferenceAsset[]
  channelSpecs: readonly ChannelDirectionSpec[]
  approvalMode: 'proposal_first' | 'manual_review' | 'autonomous_safe'
  createdAt: string
  updatedAt: string
}

export const IMAGE_LOOK_DEFINITIONS: Record<ImageLookType, {
  label: string
  tagline: string
  description: string
  badge: string
  sampleImage?: string
}> = {
  owner_explaining: {
    label: '사장님 설명형',
    tagline: '신뢰감 있는 전문가 인터뷰 룩',
    description: '사장님이 고객에게 직접 시술 과정과 노하우를 정성스럽게 설명하는 구도입니다.',
    badge: '추천',
  },
  indoor_mood: {
    label: '따뜻한 실내 무드',
    tagline: '포근하고 아늑한 매장 감성',
    description: '은은한 조명과 편안한 공간감을 담아 매장의 프리미엄한 분위기를 강조합니다.',
    badge: '인기',
  },
  natural_light: {
    label: '자연광 내추럴',
    tagline: '깨끗하고 투명한 햇살 룩',
    description: '자연 채광을 활용해 시술 직후의 생생하고 자연스러운 결과물을 보여줍니다.',
    badge: '시즌 추천',
  },
  editorial_close: {
    label: '에디토리얼 클로즈업',
    tagline: '디테일과 감각적인 질감 룩',
    description: '매거진 화보처럼 시술 부위의 정밀한 디테일과 고급스러운 텍스처를 담아냅니다.',
    badge: '고급형',
  },
}

export const COMPOSITION_OPTIONS: Record<CompositionOption, { label: string; desc: string }> = {
  upper_body: { label: '상반신 중심', desc: '인물의 표정과 제스처가 편안하게 드러나는 앵글' },
  explaining_pose: { label: '설명하는 모습', desc: '고객과 소통하거나 도구를 다루는 전문적인 순간' },
  text_margin: { label: '짧은 문구용 여백', desc: '카드뉴스 타이틀이나 핵심 카피가 들어갈 공간 확보' },
  product_focus: { label: '제품/시술 강조', desc: '완성된 결과물과 사용 제품이 돋보이는 컷' },
  space_atmosphere: { label: '매장 공간감', desc: '정돈된 인테리어와 감성적인 무드가 함께 담긴 컷' },
}
