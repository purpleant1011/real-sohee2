import { getGeminiApiBaseUrl, getGeminiApiKey } from '@/lib/ai/model-profiles'
import { IMAGE_STYLE_PEOPLE, type WorkspaceImageStyleForm } from './workspace-image-style'

export const REFERENCE_MAX_FILES = 8
export const REFERENCE_MAX_BYTES = 4 * 1024 * 1024
const SUPPORTED = ['image/png', 'image/jpeg', 'image/webp']

export type ReferenceImageInput = Readonly<{ mimeType: string; base64: string }>

export function validateReferenceFiles(
  files: ReadonlyArray<Readonly<{ type: string; size: number }>>,
): { ok: true } | { ok: false; message: string } {
  if (files.length === 0) return { ok: false, message: '참고할 사진을 1장 이상 올려 주세요.' }
  if (files.length > REFERENCE_MAX_FILES) return { ok: false, message: `사진은 최대 ${REFERENCE_MAX_FILES}장까지 올릴 수 있어요.` }
  for (const file of files) {
    if (!SUPPORTED.includes(file.type)) return { ok: false, message: 'PNG, JPG, WEBP 사진만 올릴 수 있어요.' }
    if (file.size > REFERENCE_MAX_BYTES) return { ok: false, message: '사진 한 장은 4MB 이하여야 해요.' }
  }
  return { ok: true }
}

function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export type ReferenceAnalysis = WorkspaceImageStyleForm & Readonly<{ notes: string[]; analysis: string }>

export function parseReferenceAnalysis(raw: string): ReferenceAnalysis | null {
  const unfenced = raw.replace(/^\s*```(?:json)?\s*/iu, '').replace(/\s*```\s*$/u, '').trim()
  let data: unknown
  try { data = JSON.parse(unfenced) } catch { return null }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const record = data as Record<string, unknown>
  const avoid = Array.isArray(record.avoid)
    ? record.avoid.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, 80)).filter(Boolean).slice(0, 20)
    : []
  const notes = Array.isArray(record.notes) ? record.notes.map((note) => (typeof note === 'string' ? note.trim().slice(0, 120) : '')).slice(0, 8) : []
  const form: ReferenceAnalysis = {
    subject: clip(record.subject, 300),
    mood: clip(record.mood, 300),
    setting: clip(record.setting, 300),
    lookAndColor: clip(record.lookAndColor, 300),
    people: (IMAGE_STYLE_PEOPLE as readonly string[]).includes(String(record.people)) ? String(record.people) : 'any',
    avoid: avoid.join(', '),
    extra: clip(record.extra, 600),
    composition: clip(record.composition, 300),
    notes,
    analysis: clip(record.analysis, 1200),
  }
  const hasContent = form.analysis || form.subject || form.composition || form.mood || form.setting || form.lookAndColor || form.avoid || form.extra
  return hasContent ? form : null
}

function buildInstruction(count: number): string {
  return [
  '다음 사진들은 한 가게가 "이런 느낌의 이미지를 만들고 싶다"고 고른 참고 사진입니다.',
  '사진들에 공통된 스타일을 한국어로 정리해 JSON 객체 하나만 반환하세요.',
  '키: subject(무엇을 어떻게 찍었는지), setting(배경·장소), mood(분위기), lookAndColor(빛·색감), composition(구도·화면 구조: 앵글, 피사체 위치, 여백), people(any|none|hands|people 중 하나), avoid(피해야 할 요소 배열), extra(그 밖의 일관된 특징).',
  `추가 키: notes(사진 ${count}개 각각의 역할을 한 줄로, 입력 순서대로 ${count}개 — 예: "여성 정면 상반신, 마스크, 크림 배경"), analysis(1000자 이내의 촬영 분석: 카메라 거리·앵글·화면 대비 피사체 크기, 조명 방향과 질감, 배경색, 의상·소품 규칙, 보정 정도, 피부 질감, 사진에 겹쳐진 글자·삽입 이미지의 위치와 서식(내용은 옮기지 않음), 사진들 사이의 공통 규칙과 변형 규칙).`,
  '특정 인물을 알아보거나 이름을 추정하지 말고, 사진 속 글자·로고·상호는 옮겨 적지 마세요. 각 값은 짧고 구체적으로 쓰세요.',
  ].join('\n')
}

type Deps = Readonly<{ apiKey?: string; fetcher?: typeof fetch; baseUrl?: string; model?: string }>

export async function analyzeReferenceImages(
  images: readonly ReferenceImageInput[],
  deps: Deps = {},
): Promise<ReferenceAnalysis> {
  const key = (deps.apiKey ?? getGeminiApiKey()).trim()
  if (!key) throw new Error('REFERENCE_ANALYSIS_UNAVAILABLE')
  const model = deps.model ?? (process.env.GEMINI_ACTION_MODEL?.trim() || 'gemini-3.8-flash')
  const base = deps.baseUrl ?? getGeminiApiBaseUrl()
  const fetcher = deps.fetcher ?? fetch

  const response = await fetcher(`${base}/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: buildInstruction(images.length) },
          ...images.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.base64 } })),
        ],
      }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
    }),
  }).catch(() => null)
  if (!response || !response.ok) throw new Error('REFERENCE_ANALYSIS_UNAVAILABLE')

  const data = await response.json().catch(() => null) as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> } | null
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
  const parsed = typeof text === 'string' ? parseReferenceAnalysis(text) : null
  if (!parsed) throw new Error('REFERENCE_ANALYSIS_UNUSABLE')
  return parsed
}
