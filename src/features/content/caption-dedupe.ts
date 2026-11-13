import type { InstagramDraft } from '@/features/chat/instagram-draft-provider'
import type { NaverBlogDraft } from '@/features/chat/naver-blog-draft-provider'

const SENTENCE_SPLIT_REGEX =
  /(?<=(?<!\b\d)\.[\p{Extended_Pictographic}\p{S}\p{P}]*|(?<=요\.)[\p{Extended_Pictographic}\p{S}\p{P}]*|[!?…~]+[\p{Extended_Pictographic}\p{S}\p{P}]*)\s+(?=[가-힣a-zA-Z0-9])|(?<=요\.)\s*(?=[가-힣a-zA-Z0-9])/u

const UNIQUE_FACTS_REGEX = /(?:\d{1,4}년|\d{1,2}월|\d{1,2}일|\d{1,2}\/\d{1,2}|\d{1,2}시|\d{1,2}분|\b오전|\b오후|\b[월화수목금토일]요일|\d+[,.\d]*\s*(?:원|만원|천원|%|\b개\b|\b잔\b)|\b무료\b|\b할인\b|\b선착순\b|\b혜택\b|\b쿠폰\b|\b특가\b|\b증정\b|\b사은품\b|\b이벤트\s*기간\b|\b영업시간\b|\b운영시간\b|\b오픈\b|\b마감\b|\b도보\b|\b출구\b|\d+(?:번지|층|호)\b)/iu

const CTA_KEYWORD_REGEX = /(?:문의|상담|연락|예약|신청|\bDM\b|디엠|카카오톡|카톡|전화|유선|문자|링크|프로필|톡톡|플러스친구|오픈채팅)/iu

const CTA_VERB_REGEX = /(?:문의|상담|연락|예약|신청|남겨|주세요|바랍니다|부탁드립니다|부탁드려요|환영합니다|환영해요|가능합니다|눌러|찾아주|오세요|만나요|채널)/iu

const INQUIRY_CUE_REGEX = /(?:문의|상담|연락|남겨|\bDM\b|디엠|메시지|예약)/iu

export function normalizeSentence(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\p{P}\p{S}\p{Extended_Pictographic}\s]/gu, '')
    .toLowerCase()
}

export function hasUniqueFacts(sentence: string): boolean {
  if (!sentence || typeof sentence !== 'string') return false
  return UNIQUE_FACTS_REGEX.test(sentence)
}

export function hasInquiryCue(sentence: string): boolean {
  if (!sentence || typeof sentence !== 'string') return false
  return INQUIRY_CUE_REGEX.test(sentence)
}

export function extractChannelCues(sentence: string): Set<string> {
  const norm = sentence.toLowerCase().replace(/\s+/g, '')
  const cues = new Set<string>()
  if (norm.includes('카카오톡') || norm.includes('카톡')) cues.add('kakao')
  if (norm.includes('채널')) cues.add('channel')
  if (norm.includes('전화') || norm.includes('유선') || norm.includes('문자')) cues.add('phone')
  if (norm.includes('dm') || norm.includes('디엠')) cues.add('dm')
  if (norm.includes('프로필')) cues.add('profile')
  if (norm.includes('링크')) cues.add('link')
  if (norm.includes('톡톡')) cues.add('toktok')
  return cues
}

export function shareSameChannelCue(s1: string, s2: string): boolean {
  const c1 = extractChannelCues(s1)
  const c2 = extractChannelCues(s2)
  for (const ch of c1) {
    if (c2.has(ch)) return true
  }
  return false
}

export function isCtaSentence(sentence: string): boolean {
  if (!sentence || typeof sentence !== 'string') return false
  if (hasUniqueFacts(sentence)) return false
  if (hasInquiryCue(sentence) && extractChannelCues(sentence).size > 0) return true
  return CTA_KEYWORD_REGEX.test(sentence) && CTA_VERB_REGEX.test(sentence)
}

export function getChannelSpecificity(sentence: string): number {
  if (!sentence || typeof sentence !== 'string') return 0
  if (/(?:카카오톡\s*채널|카톡\s*채널|플러스친구|오픈채팅|네이버\s*톡톡|네이버\s*예약|인스타(?:그램)?\s*DM|프로필\s*링크)/iu.test(sentence)) {
    return 3
  }
  if (/(?:카카오톡|카톡|\bDM\b|디엠|전화|유선|문자|링크|프로필|톡톡|채널)/iu.test(sentence)) {
    return 2
  }
  if (/(?:문의|상담|연락|예약|신청)/iu.test(sentence)) {
    return 1
  }
  return 0
}

function extractChannelKeywords(sentence: string): Set<string> {
  const norm = sentence.toLowerCase().replace(/\s+/g, '')
  const set = new Set<string>()
  if (norm.includes('카카오톡') || norm.includes('카톡')) set.add('kakao')
  if (norm.includes('dm') || norm.includes('디엠')) set.add('dm')
  if (norm.includes('전화') || norm.includes('유선') || norm.includes('문자')) set.add('phone')
  if (norm.includes('링크') || norm.includes('프로필')) set.add('link')
  if (norm.includes('톡톡')) set.add('toktok')
  return set
}

function extractInquiryVerbs(sentence: string): Set<string> {
  const norm = sentence.toLowerCase().replace(/\s+/g, '')
  const set = new Set<string>()
  if (norm.includes('문의')) set.add('inquiry')
  if (norm.includes('상담')) set.add('consult')
  if (norm.includes('연락')) set.add('contact')
  if (norm.includes('예약')) set.add('booking')
  if (norm.includes('신청')) set.add('apply')
  return set
}

function getCharBigrams(text: string): Set<string> {
  const normalized = normalizeSentence(text)
  const bigrams = new Set<string>()
  for (let i = 0; i < normalized.length - 1; i++) {
    bigrams.add(normalized.slice(i, i + 2))
  }
  return bigrams
}

function getWordStems(text: string): Set<string> {
  const words = text
    .normalize('NFKC')
    .replace(/[\p{P}\p{S}\p{Extended_Pictographic}]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  const particleRegex = /(?:은|는|이|가|을|를|과|와|으로|로|이나|나|에|에서|도|의|만|하고|해주세요|주세요|바랍니다|부탁드립니다|부탁드려요|연락해주세요|문의해주세요)$/u
  const stems = new Set<string>()
  for (const w of words) {
    const stem = w.replace(particleRegex, '')
    if (stem.length > 0) stems.add(stem)
  }
  return stems
}

function computeJaccard<T>(setA: Set<T>, setB: Set<T>): number {
  if (setA.size === 0 && setB.size === 0) return 1
  if (setA.size === 0 || setB.size === 0) return 0
  let intersection = 0
  for (const item of setA) {
    if (setB.has(item)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

export function areSimilarCtaSentences(s1: string, s2: string): boolean {
  if (hasInquiryCue(s1) && hasInquiryCue(s2) && shareSameChannelCue(s1, s2)) {
    return true
  }

  const channels1 = extractChannelKeywords(s1)
  const channels2 = extractChannelKeywords(s2)
  const verbs1 = extractInquiryVerbs(s1)
  const verbs2 = extractInquiryVerbs(s2)

  let sharesChannel = false
  for (const ch of channels1) {
    if (channels2.has(ch)) {
      sharesChannel = true
      break
    }
  }

  const noChannelConflict =
    channels1.size === 0 || channels2.size === 0 || sharesChannel

  let sharesInquiryVerb = false
  for (const v of verbs1) {
    if (verbs2.has(v)) {
      sharesInquiryVerb = true
      break
    }
  }

  // 1. Sharing the same channel keyword + inquiry verb
  if (sharesChannel && sharesInquiryVerb) {
    return true
  }

  // 2. Generic inquiry matching channel inquiry with shared verb
  if (noChannelConflict && sharesInquiryVerb && (channels1.size === 0 || channels2.size === 0)) {
    return true
  }

  // 3. Jaccard similarity on bigrams or word stems >= ~0.4 - 0.5
  if (computeJaccard(getCharBigrams(s1), getCharBigrams(s2)) >= 0.38) {
    return true
  }

  if (computeJaccard(getWordStems(s1), getWordStems(s2)) >= 0.45) {
    return true
  }

  return false
}

export function extractSentenceKeys(text?: string | null): Set<string> {
  const keys = new Set<string>()
  if (!text || typeof text !== 'string') return keys

  const lines = text.split('\n')
  for (const line of lines) {
    const trimmedLine = line.trim()
    if (!trimmedLine) continue
    const sentences = trimmedLine.split(SENTENCE_SPLIT_REGEX)
    for (const sentence of sentences) {
      const key = normalizeSentence(sentence)
      if (key.length > 0) keys.add(key)
    }
  }
  return keys
}

export function dedupeCaption(caption: string): string {
  if (!caption || typeof caption !== 'string') return caption

  const lines = caption.split('\n')
  let hashtagStartIdx = lines.length
  let seenHashtag = false

  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim()
    if (trimmed === '') continue
    const tokens = trimmed.split(/\s+/)
    const isHashtagLine = tokens.length > 0 && tokens.every((token) => token.startsWith('#'))
    if (isHashtagLine) {
      hashtagStartIdx = i
      seenHashtag = true
    } else {
      break
    }
  }

  let bodyText = caption
  let hashtagText = ''

  if (seenHashtag) {
    bodyText = lines.slice(0, hashtagStartIdx).join('\n')
    hashtagText = lines.slice(hashtagStartIdx).join('\n')
  }

  type SentenceItem = {
    lineIdx: number
    sentence: string
    trimmed: string
    key: string
    hasFacts: boolean
    isCta: boolean
    specificity: number
    dropped: boolean
  }

  const bodyLines = bodyText.split('\n')
  const allItems: SentenceItem[] = []
  const seenExact = new Set<string>()

  for (let lineIdx = 0; lineIdx < bodyLines.length; lineIdx++) {
    const line = bodyLines[lineIdx]
    if (line.trim() === '') continue
    const sentences = line.split(SENTENCE_SPLIT_REGEX)
    for (const sentence of sentences) {
      const trimmed = sentence.trim()
      if (!trimmed) continue
      const key = normalizeSentence(trimmed)
      const hasFacts = hasUniqueFacts(trimmed)
      const isCta = !hasFacts && isCtaSentence(trimmed)
      const specificity = isCta ? getChannelSpecificity(trimmed) : 0
      const isExactDuplicate = key.length > 0 && seenExact.has(key)

      const item: SentenceItem = {
        lineIdx,
        sentence,
        trimmed,
        key,
        hasFacts,
        isCta,
        specificity,
        dropped: isExactDuplicate,
      }

      if (key.length > 0 && !isExactDuplicate) {
        seenExact.add(key)
      }

      allItems.push(item)
    }
  }

  // Deduplicate paraphrased / similar CTA sentences
  const ctaItems = allItems.filter((item) => !item.dropped && item.isCta && !item.hasFacts)

  for (let i = 0; i < ctaItems.length; i++) {
    const primary = ctaItems[i]
    if (primary.dropped) continue

    const cluster: SentenceItem[] = [primary]
    for (let j = i + 1; j < ctaItems.length; j++) {
      const candidate = ctaItems[j]
      if (candidate.dropped) continue
      if (areSimilarCtaSentences(primary.trimmed, candidate.trimmed)) {
        cluster.push(candidate)
      }
    }

    if (cluster.length > 1) {
      const hasSpecificWinner = cluster.some((c) => c.specificity > cluster[0].specificity)
      const winner = hasSpecificWinner
        ? cluster.find((c) => c.specificity === Math.max(...cluster.map((item) => item.specificity))) ?? cluster[0]
        : cluster[0]
      for (const member of cluster) {
        if (member !== winner) {
          member.dropped = true
        }
      }
    }
  }

  // Group back by lines
  const lineSentencesMap = new Map<number, string[]>()
  for (const item of allItems) {
    if (item.dropped) continue
    const list = lineSentencesMap.get(item.lineIdx) ?? []
    list.push(item.trimmed)
    lineSentencesMap.set(item.lineIdx, list)
  }

  const resultLines: string[] = []
  for (let lineIdx = 0; lineIdx < bodyLines.length; lineIdx++) {
    const kept = lineSentencesMap.get(lineIdx)
    if (kept && kept.length > 0) {
      resultLines.push(kept.join(' '))
    } else {
      resultLines.push('')
    }
  }

  const cleanedBody = resultLines
    .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1]?.length !== 0))
    .join('\n')
    .trim()

  if (seenHashtag) {
    if (cleanedBody.length === 0) return hashtagText.trim()
    return `${cleanedBody}\n\n${hashtagText.trim()}`
  }

  return cleanedBody
}

export function collapseDuplicateCta(
  cta: string,
  context?: Readonly<{
    caption?: string
    ownerFacts?: readonly string[] | string
  }>,
): string {
  if (!cta || typeof cta !== 'string') return ''
  const ctaKey = normalizeSentence(cta)
  if (ctaKey.length === 0) return cta

  const captionKeys = extractSentenceKeys(context?.caption)
  if (captionKeys.has(ctaKey)) return ''

  if (context?.ownerFacts) {
    const facts = Array.isArray(context.ownerFacts) ? context.ownerFacts : [context.ownerFacts]
    for (const fact of facts) {
      if (!fact || typeof fact !== 'string') continue
      const factKeys = extractSentenceKeys(fact)
      if (factKeys.has(ctaKey)) return ''
      if (ctaKey.length >= 6 && normalizeSentence(fact).includes(ctaKey)) return ''
    }
  }

  if (context?.caption && !hasUniqueFacts(cta)) {
    const lines = context.caption.split('\n')
    for (const line of lines) {
      const trimmedLine = line.trim()
      if (!trimmedLine || trimmedLine.startsWith('#')) continue
      const sentences = trimmedLine.split(SENTENCE_SPLIT_REGEX)
      for (const sentence of sentences) {
        const trimmed = sentence.trim()
        if (!trimmed || hasUniqueFacts(trimmed)) continue
        if (areSimilarCtaSentences(trimmed, cta.trim())) {
          return ''
        }
      }
    }
  }

  return cta
}

export function dedupeDraft<T extends InstagramDraft | NaverBlogDraft>(
  draft: T,
  options?: Readonly<{ ownerFacts?: readonly string[] | string }>,
): T {
  if ('caption' in draft) {
    const insta = draft as InstagramDraft
    const dedupedCaption = dedupeCaption(insta.caption)
    const collapsedCta = collapseDuplicateCta(insta.cta, {
      caption: dedupedCaption,
      ownerFacts: options?.ownerFacts,
    })
    return Object.freeze({
      ...insta,
      caption: dedupedCaption,
      cta: collapsedCta,
    }) as T
  }

  const naver = draft as NaverBlogDraft
  const dedupedIntro = dedupeCaption(naver.introduction)
  const dedupedSections = Object.freeze(
    naver.sections.map((s) => Object.freeze({ ...s, body: dedupeCaption(s.body) })),
  )
  const dedupedBlueprint = Object.freeze(
    naver.editorBlueprint.map((b) =>
      b.kind === 'paragraph' ? Object.freeze({ ...b, text: dedupeCaption(b.text) }) : b,
    ),
  )

  return Object.freeze({
    ...naver,
    introduction: dedupedIntro,
    sections: dedupedSections,
    editorBlueprint: dedupedBlueprint,
  }) as T
}
