import type { ByreumImageChannel } from '@/features/harness/byreum-image-harness'

export type ConversationImageRequest = Readonly<{
  channel: ByreumImageChannel
  prompt: string
  count: ConversationImageCount
}>

export type ConversationImageCount = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20

const imageNounPattern = /(이미지|사진|비주얼|컷|썸네일)/u
const generationPattern = /(생성|만들|그려|제작|준비|넣어)/u
const negationPattern = /(이미지|사진).{0,12}(만들지|생성하지|제작하지|필요 없|빼고|제외)/u
const existingReusePattern = /(?:기존|사용권 확인)[^.!?]{0,80}(?:이미지|사진)[^.!?]{0,80}(?:재사용|활용|사용)/u
const explicitCountPattern = /(한|하나|두|둘|세|셋|네|넷|[0-9]+)\s*(장|컷|슬라이드)/u

function requestedCount(message: string): number | null {
  const match = explicitCountPattern.exec(message)
  if (!match) return 1

  const count = ({
    한: 1,
    하나: 1,
    두: 2,
    둘: 2,
    세: 3,
    셋: 3,
    네: 4,
    넷: 4,
  } as const)[match[1] as '한' | '하나' | '두' | '둘' | '세' | '셋' | '네' | '넷']
    ?? Number(match[1])

  return Number.isInteger(count) ? count : null
}

function requestedChannel(message: string): ByreumImageChannel {
  if (/(스레드|threads?)/iu.test(message)) return 'threads'
  if (/(네이버\s*블로그|블로그|naver\s*blog)/iu.test(message)) return 'naver_blog'
  return 'instagram'
}

export function parseConversationImageRequest(message: string): ConversationImageRequest | null {
  const prompt = message.trim()
  if (prompt.length === 0 || prompt.length > 1_500) return null
  const channel = requestedChannel(prompt)
  const count = requestedCount(prompt)
  if (channel === 'naver_blog' && existingReusePattern.test(prompt)) {
    if (count === null || count < 1 || count > 20) return null
    return Object.freeze({ channel, prompt, count: count as ConversationImageCount })
  }
  if (negationPattern.test(prompt)) return null
  if (!imageNounPattern.test(prompt) || !generationPattern.test(prompt)) return null
  if (count === null || count < 1 || count > (channel === 'naver_blog' ? 20 : 3)) return null

  return Object.freeze({ channel, prompt, count: count as ConversationImageCount })
}
