import type { MediaItem } from '@/features/vault/channel-spec'

/**
 * 당근 비즈프로필 미디어 아이템 확장 인터페이스
 * URL 및 썸네일, 대체 텍스트를 선택적으로 지원합니다.
 */
export interface DaangnMediaItem extends MediaItem {
  readonly url?: string
  readonly thumbnailUrl?: string
  readonly alt?: string
}

/**
 * 당근 비즈프로필 '소식' 미리보기 입력 타입
 * `src/features/vault/transform`의 생성 결과 및 channel-spec payload와 호환됩니다.
 */
export interface DaangnNewsVariant {
  /** 소식 본문 텍스트 (필수) */
  readonly text: string
  /** 첫 줄 강조 타이틀 (선택) */
  readonly firstLineHighlight?: string
  /** 제공 쿠폰 혜택 (선택, '혜택 없음' 또는 빈 문자열 시 미노출) */
  readonly coupon?: string
  /** 승인한 태그. 보관 글을 복사할 때 함께 나가는 값이라 미리보기에도 그대로 보여줍니다. */
  readonly hashtags?: readonly string[]
  /** 첨부 미디어 목록 (사진 최대 20장, 갤러리 노출 10장) */
  readonly media?: readonly (MediaItem | DaangnMediaItem)[]
  /** 첨부 동영상 개수 (최대 1개) */
  readonly videoCount?: number
  /** 비즈프로필 상호명 (중립 기본값: '비즈프로필') */
  readonly businessName?: string
  /** 등록 시간 라벨 (기본값: '방금 전') */
  readonly timeLabel?: string
}
