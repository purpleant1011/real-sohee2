import { z } from 'zod'

export const CUSTOM_IMAGE_STYLE_RULE_KEY = 'custom-image-style-v1' as const
export const LEGACY_IMAGE_STYLE_RULE_KEYS = ['image-harness-v1', 'quick-image-style'] as const

export const IMAGE_STYLE_PEOPLE = ['any', 'none', 'hands', 'people'] as const
export type ImageStylePeople = (typeof IMAGE_STYLE_PEOPLE)[number]

export const MAX_STYLE_REFERENCES = 8

const text = (max: number) => z.string().trim().max(max).default('')

const styleSchema = z.object({
  subject: text(300),
  mood: text(300),
  setting: text(300),
  lookAndColor: text(300),
  people: z.enum(IMAGE_STYLE_PEOPLE).default('any'),
  avoid: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  extra: text(600),
  composition: text(300),
  guide: text(2_000),
  referenceAssetIds: z.array(z.string().uuid()).max(MAX_STYLE_REFERENCES).default([]),
  referenceNotes: z.record(z.string().uuid(), z.string().trim().max(120)).default({}),
}).strict()

export type WorkspaceImageStyle = z.infer<typeof styleSchema>

export type WorkspaceImageStyleForm = Readonly<{
  subject: string
  mood: string
  setting: string
  lookAndColor: string
  people: string
  avoid: string
  extra: string
  composition?: string
  guide?: string
  references?: readonly string[]
  referenceNotes?: Readonly<Record<string, string>>
}>

export function normalizeWorkspaceImageStyleInput(
  form: WorkspaceImageStyleForm,
): { ok: true; style: WorkspaceImageStyle } | { ok: false; message: string } {
  const people = (IMAGE_STYLE_PEOPLE as readonly string[]).includes(form.people) ? form.people : 'any'
  const keptReferences = [...new Set((form.references ?? []).filter((id) => z.string().uuid().safeParse(id).success))]
  const parsed = styleSchema.safeParse({
    subject: form.subject,
    mood: form.mood,
    setting: form.setting,
    lookAndColor: form.lookAndColor,
    people,
    avoid: form.avoid.split(/[,\n]/u).map((item) => item.trim()).filter((item) => item.length > 0),
    extra: form.extra,
    composition: form.composition ?? '',
    guide: form.guide ?? '',
    referenceAssetIds: keptReferences,
    referenceNotes: Object.fromEntries(
      keptReferences
        .map((id) => [id, (form.referenceNotes?.[id] ?? '').trim().slice(0, 120)] as const)
        .filter(([, note]) => note.length > 0),
    ),
  })
  if (!parsed.success) return { ok: false, message: '입력 길이를 확인해 주세요. 항목당 300자(추가 요청 600자)까지 쓸 수 있어요.' }
  const s = parsed.data
  if (!s.subject && !s.mood && !s.setting && !s.lookAndColor && !s.extra && !s.guide && !s.composition && s.referenceAssetIds.length === 0 && s.avoid.length === 0) {
    return { ok: false, message: '원하는 이미지 모습을 한 가지 이상 적어 주세요.' }
  }
  return { ok: true, style: s }
}

type RuleRow = Readonly<{ rule_key: string; structured_rule: unknown }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 300) : ''
}

function fromLegacy(rule: Record<string, unknown>): WorkspaceImageStyle | null {
  const rules = isRecord(rule.rules) ? rule.rules : null
  if (!rules) return null
  const forbidden = Array.isArray(rules.forbiddenElements)
    ? rules.forbiddenElements.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim().slice(0, 80)).slice(0, 20)
    : []
  const candidate = {
    subject: str(rules.modelStyle) || str(rules.style),
    mood: '',
    setting: str(rules.environment),
    lookAndColor: [str(rules.lighting), str(rules.colorTone)].filter(Boolean).join(', ').slice(0, 300),
    people: 'any' as const,
    avoid: forbidden,
    extra: str(rules.composition),
    composition: '',
    guide: '',
    referenceAssetIds: [] as string[],
    referenceNotes: {} as Record<string, string>,
  }
  if (!candidate.subject && !candidate.setting && !candidate.lookAndColor && !candidate.extra && forbidden.length === 0) return null
  return candidate
}

export function pickWorkspaceImageStyle(rows: readonly RuleRow[]): WorkspaceImageStyle | null {
  const custom = rows.find((row) => row.rule_key === CUSTOM_IMAGE_STYLE_RULE_KEY)
  if (custom && isRecord(custom.structured_rule)) {
    const parsed = styleSchema.safeParse(custom.structured_rule.custom)
    if (parsed.success) return parsed.data
  }
  for (const key of LEGACY_IMAGE_STYLE_RULE_KEYS) {
    const row = rows.find((candidate) => candidate.rule_key === key)
    if (row && isRecord(row.structured_rule)) {
      const mapped = fromLegacy(row.structured_rule)
      if (mapped) return mapped
    }
  }
  return null
}

const peopleInstruction: Record<ImageStylePeople, string | null> = {
  any: null,
  none: 'People: do not show any person or body part; focus on the subject and space.',
  hands: 'People: show no face; only hands or close-up details of the service or product.',
  people: 'People: include a natural-looking fictional adult person as part of the scene.',
}

export function composeStyleDirectiveLines(style: WorkspaceImageStyle): string[] {
  const lines: string[] = []
  if (style.subject) lines.push(`Owner-defined subject: ${style.subject}`)
  if (style.setting) lines.push(`Owner-defined setting: ${style.setting}`)
  if (style.mood) lines.push(`Owner-defined mood: ${style.mood}`)
  if (style.lookAndColor) lines.push(`Owner-defined light and color: ${style.lookAndColor}`)
  const people = peopleInstruction[style.people]
  if (people) lines.push(people)
  if (style.composition) lines.push(`Owner-defined composition and structure: ${style.composition}`)
  if (style.guide) lines.push(`Owner's own teaching notes (follow them as written): ${style.guide}`)
  if (style.extra) lines.push(`Owner-defined extra direction: ${style.extra}`)
  if (style.referenceAssetIds.length > 0) {
    lines.push('Owner-approved reference photos are attached. Match their lighting, color grading, framing, photographic realism and overall look; create a different, fictional person — never copy any real person\'s face, text, logo or product from them literally.')
    style.referenceAssetIds.forEach((id, index) => {
      const note = style.referenceNotes[id]
      if (note) lines.push(`Reference photo ${index + 1}: ${note}`)
    })
  }
  if (style.avoid.length > 0) lines.push(`Owner-defined things to avoid: ${style.avoid.join(', ')}`)
  if (lines.length > 0) {
    lines.unshift('The business owner registered this image style for their brand. Follow it faithfully; it overrides generic stock-photo defaults, but never the no-text, no-logo, no-watermark rules below.')
  }
  return lines
}
