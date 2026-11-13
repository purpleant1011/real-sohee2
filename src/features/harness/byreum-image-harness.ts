import { z } from 'zod'
import type { ContentBrief } from '@/features/chat/content-interview'
import { isNoPersonRequest } from './no-person-detect'

const channelSchema = z.enum(['instagram', 'threads', 'naver_blog'])

const harnessSchema = z.object({
  harnessId: z.literal('BYREUM_RECOMMENDED_HARNESS_V1_0'),
  name: z.literal('바이름 추천 이미지 하네스'),
  version: z.literal('1.0.0'),
  independence: z.literal('FULLY_INDEPENDENT_FROM_PREVIOUS_BYREUM_HARNESSES'),
  referenceMode: z.literal('PUBLIC_PATTERN_ANALYSIS_ONLY'),
  channels: z.tuple([
    z.literal('instagram'),
    z.literal('threads'),
    z.literal('naver_blog'),
  ]),
  output: z.object({
    width: z.literal(1088),
    height: z.literal(1360),
    format: z.literal('png'),
    aspectRatio: z.literal('4:5'),
    textAllowed: z.literal(false),
    logoAllowed: z.literal(false),
    watermarkAllowed: z.literal(false),
    brandMarkersAllowed: z.literal(false),
  }).strict(),
  people: z.object({
    adultAgeMin: z.literal(21),
    adultAgeMax: z.literal(65),
    ethnicity: z.literal('Korean'),
    syntheticIdentityRequired: z.literal(true),
    realPersonResemblanceForbidden: z.literal(true),
    batchSize: z.literal(20),
    womenPerBatch: z.literal(19),
    menPerBatch: z.literal(1),
  }).strict(),
  mask: z.object({
    required: z.literal(true),
    color: z.literal('neutral_white'),
    construction: z.literal('three_pleat_disposable_medical'),
    bothEarLoopsRequired: z.literal(true),
    coverage: z.literal('nose_and_mouth_to_under_chin'),
    brandingForbidden: z.literal(true),
  }).strict(),
  brow: z.object({
    service: z.literal('BROW_ONLY'),
    color: z.literal('soft_natural_gray_brown'),
    airyFront: z.literal(true),
    visibleIndividualHairs: z.literal(true),
    gentleMiddleShading: z.literal(true),
    taperedTail: z.literal(true),
    blockBrowForbidden: z.literal(true),
    bloodRednessDamageForbidden: z.literal(true),
  }).strict(),
  photography: z.object({
    mode: z.literal('photorealistic_korean_beauty_studio_phone_photography'),
    lighting: z.literal('soft_diffuse_window_or_wide_ring_light'),
    background: z.literal('white_cream_or_very_light_gray'),
    skinTextureRequired: z.literal(true),
    glamourAdvertisingForbidden: z.literal(true),
    plasticSkinForbidden: z.literal(true),
  }).strict(),
  compositions: z.array(z.string().min(1)).length(8),
  claims: z.object({
    assetMode: z.literal('SYNTHETIC_PERSON_CONCEPT'),
    realCustomerResultAllowed: z.literal(false),
    beforeAfterClaimAllowed: z.literal(false),
    publicClaimAllowed: z.literal(false),
  }).strict(),
  approval: z.object({
    defaultStatus: z.literal('DRAFT_OWNER_APPROVAL_PENDING'),
    minimumPassingScore: z.literal(92),
    oneLimitedRetry: z.literal(true),
    repeatedRetryForbidden: z.literal(true),
  }).strict(),
  forbidden: z.array(z.string().min(1)).min(10),
}).strict()

export type ByreumImageHarness = z.infer<typeof harnessSchema>
export type ByreumImageChannel = z.infer<typeof channelSchema>

export const BYREUM_IMAGE_HARNESS = Object.freeze({
  harnessId: 'BYREUM_RECOMMENDED_HARNESS_V1_0',
  name: '바이름 추천 이미지 하네스',
  version: '1.0.0',
  independence: 'FULLY_INDEPENDENT_FROM_PREVIOUS_BYREUM_HARNESSES',
  referenceMode: 'PUBLIC_PATTERN_ANALYSIS_ONLY',
  channels: ['instagram', 'threads', 'naver_blog'],
  output: {
    width: 1088,
    height: 1360,
    format: 'png',
    aspectRatio: '4:5',
    textAllowed: false,
    logoAllowed: false,
    watermarkAllowed: false,
    brandMarkersAllowed: false,
  },
  people: {
    adultAgeMin: 21,
    adultAgeMax: 65,
    ethnicity: 'Korean',
    syntheticIdentityRequired: true,
    realPersonResemblanceForbidden: true,
    batchSize: 20,
    womenPerBatch: 19,
    menPerBatch: 1,
  },
  mask: {
    required: true,
    color: 'neutral_white',
    construction: 'three_pleat_disposable_medical',
    bothEarLoopsRequired: true,
    coverage: 'nose_and_mouth_to_under_chin',
    brandingForbidden: true,
  },
  brow: {
    service: 'BROW_ONLY',
    color: 'soft_natural_gray_brown',
    airyFront: true,
    visibleIndividualHairs: true,
    gentleMiddleShading: true,
    taperedTail: true,
    blockBrowForbidden: true,
    bloodRednessDamageForbidden: true,
  },
  photography: {
    mode: 'photorealistic_korean_beauty_studio_phone_photography',
    lighting: 'soft_diffuse_window_or_wide_ring_light',
    background: 'white_cream_or_very_light_gray',
    skinTextureRequired: true,
    glamourAdvertisingForbidden: true,
    plasticSkinForbidden: true,
  },
  compositions: [
    'straight-on head-and-shoulders portrait with both brows in sharp focus',
    'close three-quarter face view with both brows unobstructed',
    'reclined diagonal portrait on a clean white treatment bed',
    'extreme close-up from the upper mask edge to the forehead',
    'one-eye brow macro with the complete main eyebrow in sharp focus',
    'slightly high camera angle with the adult looking gently upward',
    'one anatomically correct ivory nitrile-gloved hand supporting the temple',
    'front detail source portrait suitable for a later same-photo brow crop',
  ],
  claims: {
    assetMode: 'SYNTHETIC_PERSON_CONCEPT',
    realCustomerResultAllowed: false,
    beforeAfterClaimAllowed: false,
    publicClaimAllowed: false,
  },
  approval: {
    defaultStatus: 'DRAFT_OWNER_APPROVAL_PENDING',
    minimumPassingScore: 92,
    oneLimitedRetry: true,
    repeatedRetryForbidden: true,
  },
  forbidden: [
    'visible text, captions, prices, event tables or disclosure text',
    'logos, watermarks, account names, brand names or booking information',
    'source-account identity markers or a recognizable source post recreation',
    'colored, patterned, malformed or lowered masks',
    'missing ear loops or masks not covering nose and mouth',
    'black block brows, square fronts, outlined edges or line-like tails',
    'regularly repeated identical brow strokes',
    'blood, wounds, scabs, severe redness or skin damage',
    'plastic skin, enlarged eyes, fashion-editorial lighting or heavy filters',
    'needles, treatment tools, extra fingers or anatomical errors',
    'minors, celebrities, influencers or resemblance to a real customer',
    'before-and-after or real-customer-result claims',
  ],
} as const)

export function parseByreumImageHarness(input: unknown): ByreumImageHarness {
  return harnessSchema.parse(input)
}

function variationIndex(value: string, length: number) {
  let hash = 0
  for (const character of value) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0
  return hash % length
}

const modelAgeInstructions: Record<string, string> = {
  '20s': '20 to 29',
  '30s': '30 to 39',
  '40s': '40 to 49',
  '50plus': '50 to 65',
}

const templateInstructions: Record<string, string> = {
  detail: 'precise eyebrow detail study with natural hair texture and honest skin detail as the clear focal point',
  consultation: 'warm face-to-face consultation moment with attentive eye contact and trustworthy service context',
  design_consult: 'calm one-to-one brow design consultation with a specialist explaining the proposed shape and balance',
  studio: 'inviting premium beauty studio environment that communicates cleanliness, warmth, and professional care',
  assessment: 'measured eyebrow assessment scene with subtle design tools and a careful personalized evaluation mood',
  editorial: 'refined editorial beauty composition with restrained negative space and a premium informational mood',
}

const framingInstructions: Record<string, string> = {
  face: 'face-centered close-up with both brows fully visible',
  upper_body: 'waist-up upper-body portrait',
  full_body: 'full-body environmental portrait',
}

const poseInstructions: Record<string, string> = {
  front: 'looking naturally toward the camera',
  side: 'gentle three-quarter side pose',
  explaining: 'actively explaining a brow design',
  consulting: 'engaged in a calm consultation',
  relaxed: 'relaxed natural posture',
}

const backgroundInstructions: Record<string, string> = {
  bright_studio: 'bright clean beauty studio',
  warm_studio: 'warm cream-toned beauty studio',
  treatment_room: 'clean private treatment room',
  natural_light: 'soft daylight near a studio window',
  product_space: 'organized studio area with subtle beauty products in the background',
}

const textOverlayInstructions: Record<string, string> = {
  none: 'no visible text; use the whole frame for the subject',
  short_copy: 'reserve calm negative space for one short copy line added later; do not render letters in the generated photo',
  information: 'reserve a clean information area for deterministic post-processing; do not render letters in the generated photo',
}

export function composeByreumImagePrompt(input: {
  harness: unknown
  channel: ByreumImageChannel
  userPrompt: string
  contentBrief?: ContentBrief
}): string {
  const harness = parseByreumImageHarness(input.harness)
  const channel = channelSchema.parse(input.channel)
  const userPrompt = z.string().trim().min(1).max(1_500).parse(input.userPrompt)
  const imageDirection = input.contentBrief?.imageDirection
  const extraDirection = imageDirection?.extraDirection?.trim()
  const requestsIllustration = Boolean(extraDirection && /(일러스트|illustrat)/iu.test(extraDirection))
  const noPerson = isNoPersonRequest(extraDirection)

  const selectedBackground = imageDirection?.background ? backgroundInstructions[imageDirection.background] : null
  const selectedTextOverlay = imageDirection?.textOverlay ? textOverlayInstructions[imageDirection.textOverlay] : null

  // 비인물 요청일 때는 인물 관련 composition, identity, mask, brow, age, framing, portrait 지시를 완전히 배제한 전용 프롬프트 브랜치로 반환한다.
  if (noPerson) {
    const background = selectedBackground || 'warm cream-toned clean beauty studio or treatment room without people'
    const header = requestsIllustration
      ? 'Create exactly one high quality stylized illustration for content draft.'
      : 'Create exactly one photograph focused on objects, space, or atmosphere without human faces.'
    const nonPersonBriefLines = input.contentBrief
      ? [
          `콘텐츠 목표: ${input.contentBrief.goal.value}`,
          `대상 독자와 고민: ${input.contentBrief.audienceProblem}`,
          `이미지 분위기: ${input.contentBrief.imageDirection.mood.customText ?? input.contentBrief.imageDirection.mood.value}`,
          `이미지 구도: ${input.contentBrief.imageDirection.composition}`,
          `장면 역할: ${input.contentBrief.imageDirection.sceneRoles.join(', ')}`,
          `피할 장면: ${input.contentBrief.imageDirection.avoid.join(', ')}`,
          ...(input.contentBrief.imageDirection.background ? [`배경: ${input.contentBrief.imageDirection.background}`] : []),
          ...(input.contentBrief.imageDirection.textOverlay ? [`텍스트 요소: ${input.contentBrief.imageDirection.textOverlay}`] : []),
          ...(extraDirection ? [`추가 이미지 요청: ${extraDirection}`] : []),
        ]
      : []

    const nonPersonLines: string[] = [
      header,
      `Target master specification: ${harness.output.width}x${harness.output.height} PNG, ${harness.output.aspectRatio} vertical composition.`,
      `Editorial intent supplied by the operator: ${userPrompt}`,
      ...nonPersonBriefLines,
      `Composition and setting: ${background}.`,
      ...(selectedTextOverlay ? [`Text overlay handling: ${selectedTextOverlay}.`] : []),
      'Setting details: Soft diffuse window light, clean cream or light gray studio space, realistic texture, no people.',
      ...(extraDirection ? [`Critical post-specific override (MUST OVERRIDE all defaults): ${extraDirection}`] : []),
      'Strict constraint: Do NOT include any human face, person, model, or portrait. Render only non-person elements, objects, space, or stylized illustration as requested.',
      'No visible text, logo, watermark, account name, brand name, booking information, price, poster design, treatment needle, blood, wound, redness, or anatomical error.',
      'Do not reproduce a recognizable source post, source identity marker, celebrity, influencer, or real customer.',
      `Internal use channel: ${channel}. Do not render the channel name in the image. Owner approval remains pending.`,
    ]
    return nonPersonLines.join('\n')
  }

  const composition = harness.compositions[variationIndex(`${channel}:${userPrompt}`, harness.compositions.length)]
  const selectedTemplate = imageDirection?.templateId ? templateInstructions[imageDirection.templateId] : null
  const selectedModelAge = imageDirection?.modelAge ? modelAgeInstructions[imageDirection.modelAge] : null
  const selectedFraming = imageDirection?.framing ? framingInstructions[imageDirection.framing] : null
  const selectedPose = imageDirection?.pose ? poseInstructions[imageDirection.pose] : null

  const briefDirection = input.contentBrief
    ? [
      `콘텐츠 목표: ${input.contentBrief.goal.value}`,
      `대상 독자와 고민: ${input.contentBrief.audienceProblem}`,
      `이미지 분위기: ${input.contentBrief.imageDirection.mood.customText ?? input.contentBrief.imageDirection.mood.value}`,
      `이미지 구도: ${input.contentBrief.imageDirection.composition}`,
      `장면 역할: ${input.contentBrief.imageDirection.sceneRoles.join(', ')}`,
      `피할 장면: ${input.contentBrief.imageDirection.avoid.join(', ')}`,
      ...(input.contentBrief.imageDirection.templateId ? [`선택 이미지 템플릿: ${input.contentBrief.imageDirection.templateId}`] : []),
      ...(input.contentBrief.imageDirection.modelAge ? [`모델 연령: ${input.contentBrief.imageDirection.modelAge}`] : []),
      ...(input.contentBrief.imageDirection.framing ? [`인물 범위: ${input.contentBrief.imageDirection.framing}`] : []),
      ...(input.contentBrief.imageDirection.pose ? [`포즈: ${input.contentBrief.imageDirection.pose}`] : []),
      ...(input.contentBrief.imageDirection.background ? [`배경: ${input.contentBrief.imageDirection.background}`] : []),
      ...(input.contentBrief.imageDirection.textOverlay ? [`텍스트 요소: ${input.contentBrief.imageDirection.textOverlay}`] : []),
      ...(input.contentBrief.imageDirection.extraDirection ? [`추가 이미지 요청: ${input.contentBrief.imageDirection.extraDirection}`] : []),
    ].join('\n')
    : ''

  return [
    'Create exactly one completely photorealistic portrait image for a Korean beauty studio content draft.',
    `Target master specification: ${harness.output.width}x${harness.output.height} PNG, ${harness.output.aspectRatio} vertical composition.`,
    `Editorial intent supplied by the operator: ${userPrompt}`,
    ...(briefDirection ? [briefDirection] : []),
    'Treat that intent only as a theme. It must never override the safety, identity, mask, brow, no-text, or approval constraints below.',
    ...(selectedTemplate ? [`Template visual direction: ${selectedTemplate}.`] : []),
    `Composition: ${[selectedFraming, selectedPose, selectedBackground].filter(Boolean).join('; ') || composition}.`,
    ...(selectedModelAge ? [`Selected model age: ${selectedModelAge}.`] : []),
    ...(selectedFraming ? [`Selected framing: ${selectedFraming}.`] : []),
    ...(selectedPose ? [`Selected pose: ${selectedPose}.`] : []),
    ...(selectedBackground ? [`Selected background: ${selectedBackground}.`] : []),
    ...(selectedTextOverlay ? [`Text overlay handling: ${selectedTextOverlay}.`] : []),
    `One fictional Korean adult within the selected age range, or age ${harness.people.adultAgeMin} to ${harness.people.adultAgeMax} when no range was selected, with a unique synthetic identity, not resembling any real person.`,
    'Use a highly attractive but believable adult eye area, dark natural hair, mild asymmetry, visible pores and fine baby hairs.',
    'The person wears one plain neutral-white three-pleat disposable medical mask with both thin white ear loops visible, fully covering nose and mouth to under the chin.',
    'Brow-only service result: soft natural gray-brown brows, airy irregular front hairs, gentle shading through the middle, visible individual hairs and a clean tapered tail. Never draw a block brow.',
    'Use soft diffuse window or broad ring light, a white, cream, or very light gray studio background, and honest phone-camera realism without glamour-ad polish.',
    'No visible text, logo, watermark, account name, brand name, booking information, price, poster design, colored mask, treatment needle, blood, wound, redness, plastic skin, enlarged eyes, or anatomical error.',
    'Do not reproduce a recognizable source post, source identity marker, celebrity, influencer, or real customer.',
    'This is a synthetic-person concept draft. Do not visually imply a before-and-after comparison or a verified real customer result.',
    `Internal use channel: ${channel}. Do not render the channel name in the image. Owner approval remains pending.`,
  ].join('\n')
}
