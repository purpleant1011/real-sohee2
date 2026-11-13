/**
 * 인스타그램·스레드 링크 → 하네스 자동 생성 파이프라인의 공용 타입.
 * 수집(corpus) → 결정적 통계(stats) → AI 분석(text/image) → 사용자 검토 → 적용(apply) 순서.
 */

export type ProfilePlatform = 'instagram' | 'threads'

export type ParsedProfileLink = Readonly<{ platform: ProfilePlatform; handle: string }>

export type CorpusPost = Readonly<{
  id: string
  caption: string
  permalink: string | null
  timestamp: string | null
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'TEXT' | 'UNKNOWN'
  /** 사진 후보. 캐러셀이면 첫 장부터. 영상은 썸네일만. */
  imageUrls: readonly string[]
  likeCount: number | null
  commentsCount: number | null
}>

export type ProfileCorpus = Readonly<{
  platform: ProfilePlatform
  handle: string
  displayName: string | null
  biography: string | null
  followersCount: number | null
  mediaCount: number | null
  posts: readonly CorpusPost[]
  /** 내 연결 계정이면 true. 남의 계정은 공개 정보만. */
  isOwnAccount: boolean
}>

/** 캡션에서 결정적으로 계산한 통계. AI 분석 입력과 화면 근거 표시에 같이 쓴다. */
export type CaptionStats = Readonly<{
  postCount: number
  averageLength: number
  medianLength: number
  /** 상위 해시태그(많이 쓴 순) */
  topHashtags: readonly string[]
  averageHashtagCount: number
  /** 캡션 맨 앞 줄이 여러 게시물에서 반복되면 그 줄(시그니처 헤더) */
  repeatedHeaderLine: string | null
  /** 여러 게시물의 두 번째 줄 등 반복 구분선/소제목 */
  repeatedSecondLine: string | null
  emojiPerPost: number
  topEmojis: readonly string[]
  endsWithHashtagBlockRatio: number
  /** 해시태그 외 본문 줄 수 평균 */
  averageBodyLines: number
}>

/** AI가 만든 문체 가이드(텍스트 하네스 초안). 사용자가 검토·수정한 뒤 적용한다. */
export type TextStyleDraft = Readonly<{
  /** 200자 이내 한 줄 요약. channel-studio 의 brandVoice 로 쓰인다. */
  voiceSummary: string
  /** 1,200자 이내: 글 구조, 시그니처 헤더, 말투, 이모지, 맺음말(CTA), 줄 수, 해시태그 규칙을 지시문으로 */
  styleGuide: string
  keywords: readonly string[]
  prohibitedTerms: readonly string[]
  sampleOpenings: readonly string[]
  hashtags: readonly string[]
}>
