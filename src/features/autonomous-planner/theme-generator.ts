import type { GroundedBusinessContext } from '@/features/channel-studio/types'
import type { PlannedContentItem, PlannerThemeKey } from './types'

const THEME_ORDER: readonly PlannerThemeKey[] = ['story', 'tip', 'consultation', 'community']

export function selectNextTheme(recentThemes: readonly PlannerThemeKey[]): PlannerThemeKey {
  if (!recentThemes || recentThemes.length === 0) return 'story'
  const lastTheme = recentThemes[recentThemes.length - 1]
  const idx = THEME_ORDER.indexOf(lastTheme)
  if (idx < 0 || idx === THEME_ORDER.length - 1) return THEME_ORDER[0]
  return THEME_ORDER[idx + 1]
}

export interface GeneratePlannedContentParams {
  theme: PlannerThemeKey
  context: GroundedBusinessContext
  tone?: 'witty' | 'polite' | 'friendly'
  scheduledSlot: string
}

function isByreumContext(context: GroundedBusinessContext): boolean {
  return Boolean(
    context.businessName?.includes('바이름') ||
      context.facts?.some((f) => typeof f.value === 'string' && f.value.includes('바이름'))
  )
}

export function generatePlannedContent(
  params: GeneratePlannedContentParams
): PlannedContentItem {
  const { theme, context, tone = 'friendly', scheduledSlot } = params
  const isByreum = isByreumContext(context)
  const bName = context.businessName?.trim() || (isByreum ? '바이름' : '저희 매장')
  const loc = context.location?.trim() || (isByreum ? '청라' : '')

  const hashtags: string[] = []
  if (bName && bName !== '저희 매장') {
    hashtags.push(`#${bName.replace(/\s+/g, '')}`)
  }

  if (loc) {
    const locTag = loc.replace(/\s+/g, '')
    if (isByreum) {
      const byreumLoc = loc.includes('청라') ? '청라' : locTag
      hashtags.push(`#${byreumLoc}뷰티`, `#${byreumLoc}눈썹`)
    } else if (context.industry && context.industry.trim()) {
      const indTag = context.industry.split(/[\s,/]+/)[0]?.trim()
      if (indTag) {
        hashtags.push(`#${locTag}${indTag}`)
      } else {
        hashtags.push(`#${locTag}`)
      }
    } else {
      hashtags.push(`#${locTag}`)
    }
  }

  hashtags.push('#소희AI', '#매장이야기')

  let themeTitle = ''
  let igBody = ''
  let thBody = ''

  if (isByreum) {
    switch (theme) {
      case 'story':
        themeTitle = '🌿 매장 일상 & 1:1 맞춤 철학 이야기'
        if (tone === 'witty') {
          igBody = `안녕하세요! ${bName}입니다 😆 하루 딱 세 분만 모시는 저희 매장의 고집, 어떻게 생각하세요? 정성 가득 쏟아붓다 보면 퇴근길은 녹초지만 고객님의 반짝이는 눈을 보면 피로가 싹 가신답니다 ㅎㅎ 내일도 아늑한 공간 정성껏 덥혀놓고 기다릴게요! ✨`
          thBody = `하루 딱 세 분만 모시는 ${bName}의 고집 😆 손길 하나하나에 정성을 쏟다 보면 시간 가는 줄 몰라요. 아늑하게 힐링하고 가실 수 있도록 내일도 정성껏 준비해둘게요! 🌿`
        } else {
          igBody = `안녕하세요, ${loc}에서 1:1 맞춤 케어를 전해드리는 ${bName}입니다 🌿 한 분 한 분의 소중한 시간을 위해 하루 단 세 분만 정성껏 모시고 있어요. 머무시는 동안 마음까지 편안한 공간이 되도록 오늘도 정성을 다하겠습니다.`
          thBody = `안녕하세요, ${loc}에서 1:1 맞춤 케어를 전해드리는 ${bName}입니다 🌿 한 분 한 분 온전히 집중하기 위해 하루 단 세 분만 예약제로 모셔요. 편안한 마음으로 종종 소식 전할게요!`
        }
        break

      case 'tip':
        themeTitle = '💡 시술 후 오래 유지되는 홈케어 꿀팁'
        igBody = `시술 후 컬링과 결을 오래오래 유지하는 ${bName}만의 초간단 홈케어 팁 💡\n\n1. 세안 후 물기를 톡톡 말린 뒤 브러시로 결 방향 빗어주기\n2. 영양제는 아침저녁으로 모근 가까이 가볍게 터치!\n작은 습관 하나로 6주 이상 또렷한 눈매가 유지된답니다 ✨ 궁금한 점은 언제든 편하게 DM 남겨주세요!`
        thBody = `시술 후 컬링 오래 유지하는 꿀팁 💡 세안 후 물기를 톡톡 닦아내고 브러시로 결 따라 살짝 빗어주는 것만으로도 유지력이 확 올라가요! 오늘도 건강하고 예쁜 하루 보내세요 ✨ (${bName})`
        break

      case 'consultation':
        themeTitle = '✨ 1:1 맞춤 디자인 가이드 & Q&A'
        igBody = `나에게 가장 자연스럽고 잘 어울리는 눈썹 결은 무엇일까요? 🤔 ${bName}에서는 공장형 시술이 아닌, 25년 손길의 노하우로 고객님의 골격과 모 방향을 꼼꼼히 살핀 뒤 디자인을 잡아드려요. 부담 없이 편안하게 1:1 상담부터 시작해 보세요 ☕`
        thBody = `나에게 꼭 맞는 자연스러운 눈썹 결 찾기 🤔 골격과 결 흐름을 꼼꼼히 살펴 가장 편안한 맞춤 라인을 찾아드려요. 1:1 예약 상담은 언제든 편하게 문의해 주세요! (${bName})`
        break

      case 'community':
        themeTitle = '☕ 다녀가신 고객님들에 대한 감사와 소통'
        igBody = `오늘도 ${bName}을 믿고 찾아주신 모든 분들께 진심으로 감사드려요 🥹 나를 위한 온전한 힐링 시간이 되셨기를 바라며, 늘 따뜻하고 편안한 공간으로 보답하겠습니다. 오늘 하루도 고생 많으셨어요, 모두 행복한 저녁 되세요! ✨`
        thBody = `오늘도 ${bName}을 찾아주신 모든 분들께 감사드립니다 🥹 편안한 쉼과 힐링이 되셨기를 바라요. 모두 따뜻하고 편안한 저녁 보내세요! 🌿`
        break
    }
  } else {
    // 범용 매장 (비Byreum, 비뷰티 등)
    switch (theme) {
      case 'story':
        themeTitle = '🌿 매장 일상 & 운영 철학 이야기'
        if (tone === 'witty') {
          igBody = `안녕하세요! ${bName}입니다 😆 정성과 마음을 다해 준비하는 저희의 공간, 어떻게 생각하세요? 찾아주시는 고객님들의 따뜻한 미소를 보면 하루의 피로가 싹 가신답니다 ㅎㅎ 내일도 아늑하고 편안한 공간 정성껏 준비해두고 기다릴게요! ✨`
          thBody = `정성과 마음을 다하는 ${bName}의 고집 😆 하나하나 꼼꼼하게 살피다 보면 시간 가는 줄 몰라요. 편안하게 머물다 가실 수 있도록 내일도 정성껏 준비해둘게요! 🌿`
        } else {
          igBody = loc
            ? `안녕하세요, ${loc}에서 정성을 다하는 ${bName}입니다 🌿 찾아주시는 분들의 소중한 시간을 위해 늘 세심하게 준비하고 있어요. 머무시는 동안 마음까지 편안한 공간이 되도록 오늘도 정성을 다하겠습니다.`
            : `안녕하세요, 정성을 다하는 ${bName}입니다 🌿 찾아주시는 분들의 소중한 시간을 위해 늘 세심하게 준비하고 있어요. 머무시는 동안 마음까지 편안한 공간이 되도록 오늘도 정성을 다하겠습니다.`
          thBody = loc
            ? `안녕하세요, ${loc}에 위치한 ${bName}입니다 🌿 한 분 한 분 온전히 집중하기 위해 늘 진심으로 준비해요. 편안한 마음으로 종종 소식 전할게요!`
            : `안녕하세요, ${bName}입니다 🌿 한 분 한 분 온전히 집중하기 위해 늘 진심으로 준비해요. 편안한 마음으로 종종 소식 전할게요!`
        }
        break

      case 'tip':
        themeTitle = context.industry && context.industry.trim()
          ? `💡 ${context.industry.trim()} 이용 꿀팁`
          : '💡 매장을 더 편안하게 즐기는 꿀팁'
        igBody = `${bName}을 찾아주실 때 알아두면 좋은 소소한 팁 💡\n\n방문하시기 전 미리 확인하시면 더욱 만족스러운 시간을 보내실 수 있어요 ✨\n궁금한 점이나 필요하신 부분은 언제든 편하게 문의 남겨주세요!`
        thBody = `${bName}을 더 기분 좋게 즐기는 소소한 팁 💡 작은 배려와 정성으로 더욱 편안한 시간을 선물해 드릴게요. 오늘도 기분 좋은 하루 보내세요 ✨ (${bName})`
        break

      case 'consultation':
        themeTitle = '✨ 자주 묻는 질문 & 안내 가이드'
        igBody = `처음 방문하시거나 이용하실 때 가장 궁금해하시는 점들을 모아봤어요 🤔\n${bName}에서는 고객 한 분 한 분의 필요와 상황에 맞춰 친절하고 세심하게 안내해 드리고 있습니다.\n궁금하신 점이 있다면 언제든 부담 없이 편안하게 문의해 주세요 ☕`
        thBody = `자주 문의주시는 소소한 질문들 🤔 처음 오시는 분들도 편안하게 이용하실 수 있도록 정성껏 안내해 드릴게요. 언제든 편하게 문의해 주세요! (${bName})`
        break

      case 'community':
        themeTitle = '☕ 다녀가신 고객님들에 대한 감사와 소통'
        igBody = `오늘도 ${bName}을 믿고 찾아주신 모든 분들께 진심으로 감사드려요 🥹 나를 위한 온전한 힐링 시간이 되셨기를 바라며, 늘 따뜻하고 편안한 공간으로 보답하겠습니다. 오늘 하루도 고생 많으셨어요, 모두 행복한 저녁 되세요! ✨`
        thBody = `오늘도 ${bName}을 찾아주신 모든 분들께 감사드립니다 🥹 편안한 쉼과 힐링이 되셨기를 바라요. 모두 따뜻하고 편안한 저녁 보내세요! 🌿`
        break
    }
  }

  const fullIgCaption = `${igBody}\n\n${hashtags.join(' ')}`

  // Select suitable image from knowledge facts if available
  const imageUrls = (context.facts || [])
    .filter((f) => typeof f.value === 'string' && f.value.startsWith('http'))
    .map((f) => f.value)

  const themeIdx = THEME_ORDER.indexOf(theme)
  const suggestedImageUrl = imageUrls.length > 0 ? imageUrls[themeIdx % imageUrls.length] : null

  return {
    themeKey: theme,
    themeTitle,
    instagramCaption: fullIgCaption,
    threadsText: thBody,
    scheduledSlot,
    hashtags,
    suggestedImageUrl,
  }
}
