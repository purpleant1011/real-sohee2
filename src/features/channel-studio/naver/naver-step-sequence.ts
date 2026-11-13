import { buildNaverManuscriptTags, extractNaverTags } from '@/features/content/naver-manuscript'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'

export type NaverBlock = NonNullable<ApprovalPreviewSnapshot['naverBlocks']>[number]

export type NaverMediaItem = Readonly<{
  id: string
  src: string
  altText?: string
}>

export type NaverStepSequenceInput = Readonly<{
  title: string
  blocks?: readonly NaverBlock[]
  media?: readonly NaverMediaItem[]
  keywords?: readonly string[]
  disclosure?: string | null
  postMode?: 'information' | 'faq' | 'comparison' | 'consultation' | string | null
}>

export type NaverTitleStep = Readonly<{
  type: 'title'
  text: string
}>

export type NaverTextStep = Readonly<{
  type: 'text'
  segmentIndex: number
  segmentCount: number
  heading?: string
  text: string
  previewText?: string
}>

export type NaverImageStep = Readonly<{
  type: 'image'
  photoIndex: number
  mediaId: string
  src: string
  alt: string
  positionHint: string
}>

export type NaverTagsStep = Readonly<{
  type: 'tags'
  text: string
  count: number
}>

export type NaverStep =
  | NaverTitleStep
  | NaverTextStep
  | NaverImageStep
  | NaverTagsStep

export type NaverStepSequenceResult = Readonly<{
  steps: readonly NaverStep[]
  missingPhotos: readonly string[]
}>

function getObjectParticle(num: number): string {
  const lastDigit = Math.abs(num) % 10
  const hasBatchim = [0, 1, 3, 6, 7, 8].includes(lastDigit)
  return hasBatchim ? '을' : '를'
}

function formatBlockToText(block: NaverBlock): string | null {
  if ('text' in block) {
    return block.text
  }
  if (block.kind === 'link') {
    return block.title ? `${block.title} (${block.url})` : block.url
  }
  if (block.kind === 'map') {
    return block.placeName
  }
  return null
}

export function buildNaverStepSequence(
  input: NaverStepSequenceInput,
): NaverStepSequenceResult {
  const steps: NaverStep[] = []
  const missingPhotos: string[] = []

  // 1. Title step
  steps.push({
    type: 'title',
    text: input.title,
  })

  // Group text blocks into segments and interleave with images
  type IntermediateTextSegment = {
    type: 'text'
    parts: string[]
    heading?: string
  }

  type IntermediateStep =
    | IntermediateTextSegment
    | NaverImageStep

  const intermediateSteps: IntermediateStep[] = []
  let currentParts: string[] = []
  let currentHeading: string | undefined
  let photoIndex = 0

  function flushCurrentSegment() {
    if (currentParts.length > 0) {
      intermediateSteps.push({
        type: 'text',
        parts: currentParts,
        heading: currentHeading,
      })
      currentParts = []
      currentHeading = undefined
    }
  }

  const mediaMap = new Map<string, NaverMediaItem>()
  if (input.media) {
    for (const m of input.media) {
      mediaMap.set(m.id, m)
    }
  }

  if (input.blocks && input.blocks.length > 0) {
    for (const block of input.blocks) {
      if (block.kind === 'image') {
        flushCurrentSegment()
        const media = mediaMap.get(block.mediaId)
        if (!media) {
          missingPhotos.push(block.mediaId)
          continue
        }
        photoIndex += 1
        const particle = getObjectParticle(photoIndex)
        intermediateSteps.push({
          type: 'image',
          photoIndex,
          mediaId: block.mediaId,
          src: media.src,
          alt: block.altText || media.altText || `사진 ${photoIndex}`,
          positionHint: `위 글을 붙여넣은 다음 사진 ${photoIndex}${particle} 넣어 주세요`,
        })
      } else {
        const text = formatBlockToText(block)
        if (text !== null && text !== '') {
          if (block.kind === 'heading' && !currentHeading) {
            currentHeading = block.text
          }
          currentParts.push(text)
        }
      }
    }
  }

  flushCurrentSegment()

  // Handle disclosure at the end of the last text segment
  const textSegments = intermediateSteps.filter(
    (step): step is IntermediateTextSegment => step.type === 'text',
  )

  if (input.disclosure && input.disclosure.trim()) {
    if (textSegments.length > 0) {
      const lastSegment = textSegments[textSegments.length - 1]
      lastSegment.parts.push(input.disclosure.trim())
    } else {
      // If there were no text segments, create one for disclosure
      const disclosureSegment: IntermediateTextSegment = {
        type: 'text',
        parts: [input.disclosure.trim()],
      }
      intermediateSteps.push(disclosureSegment)
      textSegments.push(disclosureSegment)
    }
  }

  const segmentCount = textSegments.length
  let currentSegmentIndex = 0

  for (const step of intermediateSteps) {
    if (step.type === 'text') {
      currentSegmentIndex += 1
      let previewText: string
      if (step.heading && step.parts.length > 0 && step.parts[0] === step.heading) {
        previewText = step.parts.slice(1).join('\n\n')
      } else {
        previewText = step.parts.join('\n\n')
      }
      steps.push({
        type: 'text',
        segmentIndex: currentSegmentIndex,
        segmentCount,
        heading: step.heading,
        text: step.parts.join('\n\n'),
        previewText,
      })
    } else {
      steps.push(step)
    }
  }

  // Tags step
  const tagsText = buildNaverManuscriptTags({
    title: input.title,
    introduction: '',
    sections: [],
    keywords: input.keywords,
  })
  const normalizedTags = extractNaverTags(input.keywords)
  steps.push({
    type: 'tags',
    text: tagsText,
    count: normalizedTags.length,
  })

  return {
    steps,
    missingPhotos,
  }
}
