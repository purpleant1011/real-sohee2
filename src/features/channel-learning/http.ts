import { z } from 'zod'

export type LearningOperation = 'list' | 'register' | 'detail' | 'verify' | 'collect' | 'review' | 'update' | 'delete'
export type LearningActor = { workspaceId: string; userId: string; role: string }
export type LearningHttpDependencies = {
  authorize(workspaceId: string, write: boolean): Promise<LearningActor | Response>
  perform(operation: LearningOperation, actor: LearningActor, input: Record<string, unknown>): Promise<unknown>
}

const uuid = z.string().uuid()
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const consent = z.object({ text: z.boolean(), images: z.boolean() }).strict()
const schemas = {
  register: z.object({ platform: z.enum(['instagram', 'threads', 'naver_blog', 'naver_place', 'daangn_business', 'website']),
    url: z.string().url().max(2048).refine((value) => new URL(value).protocol === 'https:'),
    consent: consent.refine((value) => value.text || value.images) }).strict(),
  verify: z.object({ revision, challengeId: uuid.optional() }).strict(),
  collect: z.object({ revision }).strict(),
  review: z.object({ revision, evidenceRevision: revision, decisions: z.array(z.object({
    candidateId: uuid, version: revision, decision: z.enum(['approved', 'rejected']),
    editedContent: z.string().trim().min(1).max(12000).optional(),
  }).strict()).min(1).max(100) }).strict(),
  update: z.object({ revision, action: z.enum(['pause', 'resume', 'cancel']) }).strict(),
  delete: z.object({ revision }).strict(),
}

export class LearningHttpError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'STALE_REVISION' | 'CAPABILITY_BLOCKED' | 'CONNECTION_REQUIRED' | 'UNAVAILABLE' | 'FORBIDDEN') {
    super(code)
    this.name = 'LearningHttpError'
  }
}
const messages = {
  NOT_FOUND: ['학습 출처를 찾을 수 없어요.', 404],
  STALE_REVISION: ['내용이 변경됐어요. 새로 확인한 뒤 다시 시도해 주세요.', 409],
  CAPABILITY_BLOCKED: ['이 채널은 아직 자동 학습을 지원하지 않아요. 직접 자료를 제공해 주세요.', 409],
  CONNECTION_REQUIRED: ['채널 연결이 필요해요. 채널 관리에서 계정을 먼저 연결해 주세요.', 409],
  UNAVAILABLE: ['학습 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', 503],
  FORBIDDEN: ['이 작업을 수행할 권한이 없어요.', 403],
} as const
const headers = { 'Cache-Control': 'no-store' }
const failure = (error: string, message: string, status: number) => Response.json({ error, message }, { status, headers })

async function boundedJson(request: Request): Promise<unknown> {
  const maxBytes = 65_536
  if (Number(request.headers.get('content-length')) > maxBytes) throw new RangeError('BODY_TOO_LARGE')
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new SyntaxError('JSON_REQUIRED')
  const reader = request.body?.getReader()
  if (!reader) throw new SyntaxError('JSON_REQUIRED')
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) { await reader.cancel(); throw new RangeError('BODY_TOO_LARGE') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const buffer = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer))
}

/** Service dependencies receive only authenticated actor identity and schema-validated input. */
export function createLearningHttpHandler(operation: LearningOperation, deps: LearningHttpDependencies) {
  return async (request: Request, params: { workspaceId: string; sourceId?: string }): Promise<Response> => {
    const write = operation !== 'list' && operation !== 'detail'
    if (!uuid.safeParse(params.workspaceId).success
      || (operation !== 'list' && operation !== 'register' && !uuid.safeParse(params.sourceId).success)) {
      return failure('INVALID_INPUT', '주소를 다시 확인해 주세요.', 400)
    }
    try {
      if (write && (request.headers.get('origin') !== new URL(request.url).origin
        || request.headers.get('sec-fetch-site') === 'cross-site')) {
        return failure('FORBIDDEN', '요청한 페이지에서 다시 시도해 주세요.', 403)
      }
      const actor = await deps.authorize(params.workspaceId, write)
      if (actor instanceof Response) {
        const safeHeaders = new Headers(actor.headers)
        safeHeaders.set('Cache-Control', 'no-store')
        return new Response(actor.body, { status: actor.status, headers: safeHeaders })
      }
      if (actor.workspaceId !== params.workspaceId || (write && !['owner', 'manager'].includes(actor.role))) {
        return failure('FORBIDDEN', messages.FORBIDDEN[0], 403)
      }
      let input: Record<string, unknown> = {}
      if (write) {
        let raw: unknown
        try { raw = await boundedJson(request) } catch (error) {
          if (error instanceof RangeError) return failure('BODY_TOO_LARGE', '요청 내용이 너무 커요.', 413)
          return failure('INVALID_INPUT', '요청 내용을 다시 확인해 주세요.', 400)
        }
        const parsed = schemas[operation as keyof typeof schemas].safeParse(raw)
        if (!parsed.success) return failure('INVALID_INPUT', '입력 내용과 선택 항목을 확인해 주세요.', 400)
        input = parsed.data
      }
      const result = await deps.perform(operation, actor, { ...input, ...(params.sourceId ? { sourceId: params.sourceId } : {}) })
      const status = operation === 'register' ? 201 : ['collect', 'delete'].includes(operation) ? 202 : 200
      return Response.json(result, { status, headers })
    } catch (error) {
      const code = error instanceof LearningHttpError ? error.code : 'UNAVAILABLE'
      const [message, status] = messages[code]
      return failure(code, message, status)
    }
  }
}
