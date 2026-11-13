import type { ContentBrief } from '@/features/chat/content-interview'
import { composeStyleDirectiveLines, type WorkspaceImageStyle } from '@/features/image-style/workspace-image-style'
import { isNoPersonRequest } from './no-person-detect'

export type NeutralImagePromptInput = Readonly<{
  channel: string
  userPrompt: string
  altText?: string | null
  sectionText?: string | null
  industry?: string | null
  tone?: string | null
  contentBrief?: ContentBrief
  workspaceStyle?: WorkspaceImageStyle | null
}>

function extractLinePattern(text: string, regex: RegExp): string | null {
  const match = text.match(regex)
  return match && match[1] ? match[1].trim() : null
}

export function composeNeutralImagePrompt(input: NeutralImagePromptInput): string {
  const extraDirection = input.contentBrief?.imageDirection.extraDirection?.trim()
  const requestsIllustration = Boolean(extraDirection && /(일러스트|illustrat)/iu.test(extraDirection))
  const requestsNoPerson = isNoPersonRequest(extraDirection)

  const baseHeader = requestsIllustration
    ? 'Create exactly one high quality stylized illustration suitable for a professional blog post.'
    : requestsNoPerson
      ? 'Create exactly one photograph focused on objects, space, or atmosphere without human faces.'
      : 'Create exactly one photorealistic photograph suitable for a professional blog post.'

  const lines: string[] = [
    baseHeader,
    'Target master specification: 1024x1536 PNG, 3:4 vertical composition.',
  ]

  if (input.industry?.trim()) {
    lines.push(`Business industry: ${input.industry.trim()}`)
  }
  if (input.tone?.trim()) {
    lines.push(`Atmosphere and tone: ${input.tone.trim()}`)
  }

  const effectiveAltText =
    input.altText?.trim() ||
    extractLinePattern(input.userPrompt, /이미지 슬롯 \d+의 정확한 장면:\s*([^\n]+)/)
  if (effectiveAltText) {
    lines.push(`Subject and scene: ${effectiveAltText}`)
  }

  const effectiveSection =
    input.sectionText?.trim() || extractLinePattern(input.userPrompt, /해당 문단 맥락:\s*([^\n]+)/)
  if (effectiveSection) {
    lines.push(`Article context: ${effectiveSection}`)
  }

  if (input.contentBrief) {
    const brief = input.contentBrief
    lines.push(`Goal: ${brief.goal.value}`)
    lines.push(`Audience context: ${brief.audienceProblem}`)
    const mood = brief.imageDirection.mood.customText ?? brief.imageDirection.mood.value
    lines.push(`Visual mood: ${mood}`)
    const direction = brief.imageDirection
    if (direction.composition) lines.push(`Composition direction: ${direction.composition}`)
    if (direction.sceneRoles.length) lines.push(`Scene roles: ${direction.sceneRoles.join(', ')}`)
    if (direction.avoid.length) lines.push(`Avoid for this post: ${direction.avoid.join(', ')}`)
    if (direction.extraDirection?.trim()) lines.push(`Additional direction for this post: ${direction.extraDirection.trim()}`)

    // '등록한 스타일 그대로' 선택의 내부 기본값이 사업자의 인물·배경 설정을 덮어쓰지 않게 한다.
    if (direction.templateId !== 'workspace_style') {
      const ages = { '20s': '20 to 29', '30s': '30 to 39', '40s': '40 to 49', '50plus': '50 to 65' }
      const framing = { face: 'face-centered close-up', upper_body: 'upper-body framing', full_body: 'full-body framing' }
      const poses = { front: 'front view', side: 'three-quarter side view', explaining: 'explaining the subject', consulting: 'engaged in a conversation', relaxed: 'relaxed natural posture' }
      const backgrounds = { bright_studio: 'bright indoor space', warm_studio: 'warm indoor space', treatment_room: 'clean working space', natural_light: 'soft daylight near a window', product_space: 'organized product display space' }
      if (!requestsNoPerson && direction.modelAge && input.workspaceStyle?.people !== 'none') lines.push(`If a person is needed, use a fictional adult aged ${ages[direction.modelAge]}.`)
      if (!requestsNoPerson && direction.framing) lines.push(`Selected framing: ${framing[direction.framing]}.`)
      if (!requestsNoPerson && direction.pose) lines.push(`Selected pose: ${poses[direction.pose]}.`)
      if (direction.background) lines.push(`Selected background: ${backgrounds[direction.background]}.`)
    }
    if (direction.textOverlay && direction.textOverlay !== 'none') {
      lines.push('Reserve calm negative space for text to be added later; do not render letters in the generated photograph.')
    }
  }

  if (input.workspaceStyle) {
    const styleLines = composeStyleDirectiveLines(input.workspaceStyle)
    const filteredStyleLines = requestsNoPerson
      ? styleLines.filter(line =>
          !line.startsWith('Owner-defined subject:') &&
          !line.startsWith('People:') &&
          !line.startsWith('If a person is needed') &&
          !/portrait|person|people|face/iu.test(line),
        )
      : styleLines
    lines.push(...filteredStyleLines)
  }

  if (extraDirection) {
    lines.push(`Critical post-specific override (MUST OVERRIDE all owner styles, stock rules, and photograph defaults above): ${extraDirection}`)
    if (requestsNoPerson) {
      lines.push('Override constraint: Do NOT include any human face, person, or portrait. Render only non-person elements, objects, space, or stylized scene as requested.')
    }
  }

  lines.push(`Editorial guidance: ${input.userPrompt.trim()}`)

  if (requestsIllustration) {
    lines.push('Style requirements: high quality stylized illustration as requested, authentic texture, natural colors, clean lines without photorealistic human portrait.')
  } else {
    lines.push('Style requirements: high quality natural photography, realistic lighting, authentic texture, natural colors, authentic setting without artificial polish or illustration style.')
  }

  lines.push(
    'Strict negative constraints: no visible text, letters, typography, words, numbers, watermarks, logos, brand names, or signs in the image.',
    'Do not include any branding or trademarked symbols.',
  )

  return lines.join('\n')
}
