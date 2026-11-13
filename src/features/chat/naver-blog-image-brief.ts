import type { ConversationImageCount } from './conversation-image-intent'
import type { NaverBlogDraft } from './naver-blog-draft-provider'
import type { ContentBrief } from './content-interview'
import { getPostImageStyle, type PostImageStyleId } from '@/features/channel-studio/naver/post-modules'

function compact(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim().slice(0, maximum) : ''
}

export type CreateNaverBlogImagePromptsInput = Readonly<{
  draft: NaverBlogDraft
  count: ConversationImageCount
  userPrompt: string
  contentBrief?: ContentBrief
  isByreum?: boolean
  imageStyle?: PostImageStyleId
}>

export function createNaverBlogImagePrompts(input: CreateNaverBlogImagePromptsInput): readonly string[] {
  const styleHint = input.imageStyle ? getPostImageStyle(input.imageStyle)?.promptHint : undefined
  const isByreum = input.isByreum ?? Boolean(
    input.userPrompt.includes('바이름') ||
    input.draft.title.includes('바이름') ||
    input.contentBrief?.imageDirection.avoid.some((a) => a.includes('바이름'))
  )
  const blueprint = input.draft.editorBlueprint ?? []
  const slots = blueprint
    .filter((block): block is Extract<typeof block, { kind: 'image_slot' }> => block.kind === 'image_slot')
    .sort((left, right) => left.position - right.position)
  const headings = blueprint
    .filter((block): block is Extract<typeof block, { kind: 'heading' }> => block.kind === 'heading')
    .map((block) => block.text)
  const sections = input.draft.sections ?? []

  return Object.freeze(Array.from({ length: input.count }, (_, index) => {
    const position = index + 1
    const slot = slots.find((candidate) => candidate.position === position)
    const narrativeIndex = Math.max(0, index - 1)
    const section = sections.length > 0
      ? sections[Math.min(narrativeIndex, sections.length - 1)]
      : undefined
    const nearbyHeading = index === 0
      ? input.draft.title
      : headings[Math.min(narrativeIndex, headings.length - 1)] ?? section?.heading ?? input.draft.title
    const sceneRole = input.contentBrief?.imageDirection.sceneRoles[index]
      ?? input.contentBrief?.imageDirection.sceneRoles.at(-1)
    return [
      `네이버 블로그 글 제목: ${compact(input.draft.title, 180) || (isByreum ? '바이름 눈썹 디자인 안내' : '블로그 콘텐츠 안내')}`,
      `글 전체 목표: ${compact(input.userPrompt, 180)}`,
      `이 이미지가 놓일 글 흐름: ${compact(nearbyHeading, 140)}`,
      `해당 문단 맥락: ${compact(section?.body ?? input.draft.introduction, 520)}`,
      `이미지 슬롯 ${position}의 정확한 장면: ${compact(slot?.altText ?? `${nearbyHeading}을 시각적으로 설명하는 장면`, 260)}`,
      ...(styleHint ? [`이미지 연출 스타일: ${styleHint}`] : []),
      ...(input.contentBrief ? [
        `콘텐츠 목표: ${compact(input.contentBrief.goal.value, 80)}`,
        `대상 독자와 고민: ${compact(input.contentBrief.audienceProblem, 220)}`,
        `이미지 분위기: ${compact(input.contentBrief.imageDirection.mood.customText ?? input.contentBrief.imageDirection.mood.value, 160)}`,
        `장면 역할: ${compact(sceneRole, 180)}`,
        `피할 장면: ${compact(input.contentBrief.imageDirection.avoid.join(', '), 240)}`,
      ] : []),
      isByreum
        ? '텍스트와 이미지가 같은 바이름 눈썹 반영구 상담 이야기로 이어져야 합니다.'
        : '텍스트와 이미지가 본문 내용 및 주제와 자연스럽게 이어져야 합니다.',
      '이미지 안에는 글자, 가격, 연락처, 로고를 넣지 마세요.',
    ].join('\n').slice(0, 1_400)
  }))
}
