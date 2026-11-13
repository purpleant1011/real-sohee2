import type { WorkspaceImageStyle } from './workspace-image-style'

const STORAGE_PREFIX = 'image-style-draft:'
const MAX_REFERENCES = 8
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALLOWED_PEOPLE = new Set(['any', 'none', 'hands', 'people'])

export type StyleDraftForm = Readonly<{
  subject: string
  composition: string
  setting: string
  mood: string
  lookAndColor: string
  people: string
  avoid: string
  extra: string
  guide: string
}>

export type StyleDraftReference = Readonly<{
  id: string
  url: string
  note: string
}>

export type StyleDraftV1 = Readonly<{
  version: 1
  form: StyleDraftForm
  references: ReadonlyArray<StyleDraftReference>
  scene: string
  updatedAt: number
}>

const EMPTY_FORM: StyleDraftForm = {
  subject: '',
  composition: '',
  setting: '',
  mood: '',
  lookAndColor: '',
  people: 'any',
  avoid: '',
  extra: '',
  guide: '',
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function isValidReference(ref: unknown): ref is StyleDraftReference {
  if (!ref || typeof ref !== 'object') return false
  const r = ref as Record<string, unknown>
  if (typeof r.id !== 'string' || !UUID_REGEX.test(r.id)) return false
  if (typeof r.url !== 'string' || r.url.length > 1000) return false
  // Reject blob and data URLs (prevents storing blob/File/base64)
  const lowerUrl = r.url.toLowerCase()
  if (lowerUrl.startsWith('blob:') || lowerUrl.startsWith('data:')) return false
  if (typeof r.note !== 'string' || r.note.length > 200) return false
  return true
}

function validateDraft(data: unknown): StyleDraftV1 | null {
  if (!data || typeof data !== 'object') return null
  const candidate = data as Record<string, unknown>
  if (candidate.version !== 1) return null

  const form = candidate.form as Record<string, unknown> | undefined
  if (!form || typeof form !== 'object') return null

  if (typeof form.subject !== 'string' || form.subject.length > 300) return null
  if (typeof form.composition !== 'string' || form.composition.length > 300) return null
  if (typeof form.setting !== 'string' || form.setting.length > 300) return null
  if (typeof form.mood !== 'string' || form.mood.length > 300) return null
  if (typeof form.lookAndColor !== 'string' || form.lookAndColor.length > 300) return null
  if (typeof form.people !== 'string' || !ALLOWED_PEOPLE.has(form.people)) return null
  if (typeof form.avoid !== 'string' || form.avoid.length > 500) return null
  if (typeof form.extra !== 'string' || form.extra.length > 600) return null
  if (typeof form.guide !== 'string' || form.guide.length > 2000) return null

  if (typeof candidate.scene !== 'string' || candidate.scene.length > 300) return null

  if (!Array.isArray(candidate.references) || candidate.references.length > MAX_REFERENCES) {
    return null
  }

  const cleanReferences: StyleDraftReference[] = []
  for (const ref of candidate.references) {
    if (!isValidReference(ref)) return null
    cleanReferences.push({
      id: ref.id,
      url: ref.url,
      note: ref.note,
    })
  }

  const updatedAt = typeof candidate.updatedAt === 'number' ? candidate.updatedAt : Date.now()

  return {
    version: 1,
    form: {
      subject: form.subject,
      composition: form.composition,
      setting: form.setting,
      mood: form.mood,
      lookAndColor: form.lookAndColor,
      people: form.people,
      avoid: form.avoid,
      extra: form.extra,
      guide: form.guide,
    },
    references: cleanReferences,
    scene: candidate.scene,
    updatedAt,
  }
}

export function saveStyleDraft(
  workspaceId: string,
  draft: Readonly<{
    form: StyleDraftForm
    references: ReadonlyArray<StyleDraftReference>
    scene?: string
  }>,
): void {
  const storage = getStorage()
  if (!storage) return
  try {
    const payload: StyleDraftV1 = {
      version: 1,
      form: draft.form,
      references: draft.references,
      scene: draft.scene ?? '',
      updatedAt: Date.now(),
    }
    const validated = validateDraft(payload)
    if (!validated) return
    storage.setItem(`${STORAGE_PREFIX}${workspaceId}`, JSON.stringify(validated))
  } catch {
    // Gracefully ignore storage quota errors, security errors, etc.
  }
}

export function loadStyleDraft(workspaceId: string): StyleDraftV1 | null {
  const storage = getStorage()
  if (!storage) return null
  try {
    const raw = storage.getItem(`${STORAGE_PREFIX}${workspaceId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return validateDraft(parsed)
  } catch {
    return null
  }
}

export function clearStyleDraft(workspaceId: string): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.removeItem(`${STORAGE_PREFIX}${workspaceId}`)
  } catch {
    // Gracefully ignore errors
  }
}

export function normalizeReferenceNotes(
  notes: Readonly<Record<string, string>> | null | undefined,
): Record<string, string> {
  if (!notes) return {}
  const entries = Object.entries(notes)
    .map(([id, note]) => [id, typeof note === 'string' ? note.trim() : ''] as const)
    .filter(([, note]) => note.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
  return Object.fromEntries(entries)
}

export function canonicalStyleKey(
  form: StyleDraftForm,
  refs: readonly string[],
  notes: Readonly<Record<string, string>> | null | undefined,
): string {
  return JSON.stringify({
    form,
    refs: [...refs],
    notes: normalizeReferenceNotes(notes),
  })
}

export function isDraftDifferentFromBaseline(
  draft: StyleDraftV1,
  initialStyle: WorkspaceImageStyle | null,
): boolean {
  const baselineForm: StyleDraftForm = initialStyle
    ? {
        subject: initialStyle.subject,
        composition: initialStyle.composition,
        setting: initialStyle.setting,
        mood: initialStyle.mood,
        lookAndColor: initialStyle.lookAndColor,
        people: initialStyle.people,
        avoid: initialStyle.avoid.join(', '),
        extra: initialStyle.extra,
        guide: initialStyle.guide,
      }
    : EMPTY_FORM

  const baselineKey = canonicalStyleKey(
    baselineForm,
    initialStyle?.referenceAssetIds ?? [],
    initialStyle?.referenceNotes ?? {},
  )

  const draftRefs = draft.references.map((r) => r.id)
  const draftNotes = Object.fromEntries(
    draft.references.map((r) => [r.id, r.note]),
  )

  const draftKey = canonicalStyleKey(
    draft.form,
    draftRefs,
    draftNotes,
  )

  if (draftKey !== baselineKey) return true
  if (draft.scene.trim().length > 0) return true

  return false
}
