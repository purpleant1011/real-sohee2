export type ReviewContentStyle = 'gratitude' | 'trust' | 'conversation'

export interface ReviewContentOption {
  style: ReviewContentStyle
  styleLabel: string
  title: string
  instagramCaption: string
  threadsText: string
  hashtags: string[]
}

export interface ReviewContentInput {
  businessName: string
  location?: string
  industry?: string
  rating?: number | null
  reviewCount?: number | null
  highlights?: string[]
}

export interface ReviewContentResult {
  options: ReviewContentOption[]
}

export function generateReviewContent(input: ReviewContentInput): ReviewContentResult {
  if (!input.businessName || !input.businessName.trim()) {
    throw new Error('BUSINESS_NAME_REQUIRED')
  }

  const bName = input.businessName.trim()
  const loc = input.location?.trim() || ''
  const isByreum = bName.includes('바이름')

  const hasRating = typeof input.rating === 'number' && Number.isFinite(input.rating)
  const ratingText = hasRating ? `${input.rating!.toFixed(2)}점` : ''
  const hasCount = typeof input.reviewCount === 'number' && Number.isFinite(input.reviewCount)
  const countText = hasCount ? `방문자 리뷰 ${input.reviewCount}개` : '소중한 찐 후기들'

  const shopTag = isByreum ? '바이름' : bName.replace(/\s+/g, '')
  const baseHashtags: string[] = [`#${shopTag}후기`]
  if (loc) {
    const locTag = loc.replace(/\s+/g, '')
    if (isByreum) {
      const byreumLoc = loc.includes('청라') ? '청라' : locTag
      baseHashtags.push(`#${byreumLoc}뷰티샵`)
    } else if (input.industry && input.industry.trim()) {
      const indTag = input.industry.split(/[\s,/]+/)[0]?.trim()
      if (indTag) {
        baseHashtags.push(`#${locTag}${indTag}`)
      } else {
        baseHashtags.push(`#${locTag}`)
      }
    } else {
      baseHashtags.push(`#${locTag}`)
    }
  }
  if (hasRating) {
    baseHashtags.push(`#네이버평점${input.rating!.toFixed(2).replace('.', '_')}`)
  }
  baseHashtags.push('#고객후기', '#소희AI')

  const headerPrefix = hasRating
    ? `⭐⭐⭐⭐⭐ [네이버 평점 ${ratingText} / ${countText}]`
    : `⭐⭐⭐⭐⭐ [네이버 방문자 리뷰 / ${countText}]`

  // 1. 감사형 (Gratitude)
  let igGratitude = ''
  let thGratitude = ''
  if (isByreum) {
    igGratitude = `${headerPrefix}\n\n"원장님 손길이 정말 꼼꼼하고 자연스러워서 정착했어요 🥹"\n\n오늘도 네이버 예약으로 다녀가신 고객님들의 따뜻한 리뷰 덕분에 ${bName}의 하루가 환하게 채워졌습니다.\n한 분 한 분의 시간에 온전히 집중하기 위해 예약제로 모시는 저희의 고집을 알아봐 주셔서 진심으로 감사드려요 🌿\n\n머무시는 동안 마음까지 편안한 힐링 공간이 되도록 앞으로도 정성을 다하겠습니다 ✨`
    thGratitude = hasRating
      ? `네이버 평점 ${ratingText}! 다녀가신 분들이 '잠들 정도로 편안했다'며 남겨주신 리뷰를 읽을 때마다 1인샵 운영의 피로가 싹 녹아내려요 🥹 한 분만을 위한 정성, 내일도 따뜻하게 준비해둘게요! (${bName})`
      : `정성 가득한 네이버 리뷰! 다녀가신 분들이 '잠들 정도로 편안했다'며 남겨주신 리뷰를 읽을 때마다 1인샵 운영의 피로가 싹 녹아내려요 🥹 한 분만을 위한 정성, 내일도 따뜻하게 준비해둘게요! (${bName})`
  } else {
    igGratitude = `${headerPrefix}\n\n"정말 친절하시고 세심하게 챙겨주셔서 기분 좋게 다녀왔어요 🥹"\n\n오늘도 소중한 발걸음과 함께 따뜻한 리뷰를 남겨주신 고객님들 덕분에 ${bName}의 하루가 환하게 채워졌습니다.\n찾아주시는 한 분 한 분께 정성을 다하려는 저희의 마음을 알아봐 주셔서 진심으로 감사드려요 🌿\n\n머무시는 동안 마음까지 편안한 시간이 되도록 앞으로도 정성을 다하겠습니다 ✨`
    thGratitude = hasRating
      ? `네이버 평점 ${ratingText}! 다녀가신 분들이 정성껏 남겨주신 따뜻한 리뷰를 읽을 때마다 하루의 피로가 싹 녹아내려요 🥹 찾아주시는 모든 분들을 위한 정성, 내일도 따뜻하게 준비해둘게요! (${bName})`
      : `정성 가득한 네이버 리뷰! 다녀가신 분들이 정성껏 남겨주신 따뜻한 리뷰를 읽을 때마다 하루의 피로가 싹 녹아내려요 🥹 찾아주시는 모든 분들을 위한 정성, 내일도 따뜻하게 준비해둘게요! (${bName})`
  }

  // 2. 신뢰형 (Trust & Professional)
  const trustLoc = loc ? `${loc}에서 ` : ''
  let igTrust = ''
  let thTrust = ''
  if (isByreum) {
    igTrust = `왜 많은 분들이 ${trustLoc}${bName}을 찾아주실까요? 🤔\n\n${hasRating ? `네이버 방문자 평점 ${ratingText}이 증명하는 ` : '네이버 방문자 리뷰가 증명하는 '}1:1 맞춤 케어!\n공장형 시술이 아닌, 고객님의 골격과 본연의 결을 가장 자연스럽게 살려내는 섬세한 손길을 경험해 보세요.\n\n예약제로 운영되오니 원하시는 일정은 네이버 예약 또는 프로필 링크를 통해 편하게 확인해 주세요 ☕`
    thTrust = `공장형 시술이 아닌 1:1 맞춤 결 케어 🤔 고객님의 골격과 눈매를 연구해온 고집을 ${hasRating ? `네이버 평점 ${ratingText}으로 ` : '고객 리뷰로 '}인정해주셔서 감사드려요. 앞으로도 타협 없는 완성도로 보답하겠습니다! ✨`
  } else {
    igTrust = `왜 많은 분들이 ${trustLoc}${bName}을 찾아주실까요? 🤔\n\n${hasRating ? `네이버 방문자 평점 ${ratingText}이 증명하는 ` : '네이버 방문자 리뷰가 증명하는 '}믿을 수 있는 품질과 정성!\n작은 디테일 하나 놓치지 않고 늘 기본과 원칙을 지켜가는 정직한 노력을 직접 경험해 보세요.\n\n편안한 방문과 문의는 언제든 환영합니다 ☕`
    thTrust = `믿고 찾는 이유 🤔 타협 없는 정성과 세심한 준비를 ${hasRating ? `네이버 평점 ${ratingText}으로 ` : '고객 리뷰로 '}인정해주셔서 감사드려요. 앞으로도 변함없는 만족과 감동으로 보답하겠습니다! ✨`
  }

  // 3. 소통형 (Conversation & Daily)
  const igConversation = `고객님이 남겨주신 네이버 영수증 후기 하나에 오늘 커피 한 잔보다 더 진한 에너지를 얻었어요 ☕\n\n"처음 방문했는데 분위기도 너무 아늑하고 설명도 친절하셔서 안심됐어요!"\n\n처음 오시는 길 낯설지 않도록 늘 다정하게 문을 열어두겠습니다. 오늘도 ${bName}과 함께해 주신 모든 분들 행복한 저녁 되세요 🌿`
  const thConversation = `오늘 네이버 리뷰 보고 기분 좋아서 남겨요 😆 "내 방처럼 아늑했다"는 말씀에 뿌듯함 가득! 동네 이웃처럼 편안하게 머물다 가실 수 있도록 내일도 정성껏 맞이할게요 ✨`

  return {
    options: [
      {
        style: 'gratitude',
        styleLabel: '🌿 감사/감동형',
        title: hasRating ? `네이버 평점 ${ratingText} 감사 후기` : '네이버 방문자 리뷰 감사 후기',
        instagramCaption: `${igGratitude}\n\n${baseHashtags.join(' ')}`,
        threadsText: thGratitude,
        hashtags: baseHashtags,
      },
      {
        style: 'trust',
        styleLabel: '💼 신뢰/전문가형',
        title: hasRating ? `고객 리뷰와 평점 ${ratingText}의 신뢰` : '고객 리뷰와 방문자 신뢰',
        instagramCaption: `${igTrust}\n\n${baseHashtags.join(' ')}`,
        threadsText: thTrust,
        hashtags: baseHashtags,
      },
      {
        style: 'conversation',
        styleLabel: '☕ 다정/이웃소통형',
        title: '동네 이웃 찐 후기 소통 이야기',
        instagramCaption: `${igConversation}\n\n${baseHashtags.join(' ')}`,
        threadsText: thConversation,
        hashtags: baseHashtags,
      },
    ],
  }
}
