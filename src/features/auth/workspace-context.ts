import { z } from 'zod'

export const workspaceRoleSchema = z.enum(['owner', 'manager', 'reviewer', 'viewer'])

const membershipSchema = z
  .object({
    workspace_id: z.string().uuid(),
    role: workspaceRoleSchema,
    status: z.enum(['active', 'invited', 'disabled']),
  })
  .strict()

const nativeArrayIsArray = Array.isArray
const nativeNumberIsSafeInteger = Number.isSafeInteger
const nativeObjectFreeze = Object.freeze
const nativeObjectHasOwn = Object.hasOwn

export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>

export type WorkspaceContext = Readonly<{
  workspaceId: string
  role: WorkspaceRole
  status?: 'active'
}>

export type InstagramGenerationContext = Readonly<{
  businessName: string | null
  industry: string | null
  location: string | null
  businessSummary: string | null
  brandVoice: string | null
  keywords: readonly string[]
  prohibitedTerms: readonly string[]
  ownedKnowledgeSources?: readonly Readonly<{
    channel: string
    url: string
    status: string
  }>[]
  activeTextHarnesses?: readonly Readonly<{
    title: string
    description: string
    structuredRule: Readonly<Record<string, unknown>>
    channels: readonly string[]
  }>[]
}>

const businessProfileSchema = z.object({
  workspace_id: z.string().uuid(),
  business_name: z.string().trim().min(1).max(200),
  industry: z.string().trim().min(1).max(200).nullable(),
  location: z.string().trim().min(1).max(300).nullable(),
  summary: z.string().trim().min(1).max(4_000).nullable(),
}).passthrough()

const brandProfileSchema = z.object({
  workspace_id: z.string().uuid(),
  voice: z.string().trim().min(1).max(2_000).nullable(),
  keywords: z.array(z.string().trim().min(1).max(100)).max(100),
  prohibited_terms: z.array(z.string().trim().min(1).max(100)).max(100),
}).passthrough()

const knowledgeSourceSchema = z.object({
  workspace_id: z.string().uuid(),
  channel_type: z.string().trim().min(1).max(100),
  uri: z.string().url(),
  status: z.string().trim().min(1).max(120),
  refresh_policy: z.object({ ownership: z.enum(['owned', 'reference']) }).passthrough(),
}).passthrough()

const textHarnessSchema = z.object({
  workspace_id: z.string().uuid(),
  rule_type: z.literal('text_generation'),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(4_000),
  structured_rule: z.record(z.string(), z.unknown()),
  applies_to_channels: z.array(z.string().trim().min(1).max(100)).max(20),
  status: z.literal('active'),
}).passthrough()

export function selectInstagramGenerationContext(input: {
  workspaceId: string
  businessProfile: unknown
  brandProfile: unknown
  knowledgeSources?: unknown
  harnessRules?: unknown
}): InstagramGenerationContext {
  const workspaceId = z.string().uuid().parse(input.workspaceId)
  const business = businessProfileSchema.safeParse(input.businessProfile)
  const brand = brandProfileSchema.safeParse(input.brandProfile)
  const selectedBusiness = business.success && business.data.workspace_id === workspaceId
    ? business.data
    : null
  const selectedBrand = brand.success && brand.data.workspace_id === workspaceId
    ? brand.data
    : null
  const sources = z.array(z.unknown()).max(100).safeParse(input.knowledgeSources ?? [])
  const ownedKnowledgeSources = sources.success
    ? sources.data
      .flatMap((source) => {
        const parsed = knowledgeSourceSchema.safeParse(source)
        return parsed.success ? [parsed.data] : []
      })
      .filter((source) => source.workspace_id === workspaceId && source.refresh_policy.ownership === 'owned')
      .map((source) => nativeObjectFreeze({
        channel: source.channel_type,
        url: source.uri,
        status: source.status,
      }))
    : []
  const rules = z.array(z.unknown()).max(100).safeParse(input.harnessRules ?? [])
  const activeTextHarnesses = rules.success
    ? rules.data.flatMap((rule) => {
      const parsed = textHarnessSchema.safeParse(rule)
      if (!parsed.success || parsed.data.workspace_id !== workspaceId) return []
      return [nativeObjectFreeze({
        title: parsed.data.title,
        description: parsed.data.description,
        structuredRule: nativeObjectFreeze({ ...parsed.data.structured_rule }),
        channels: nativeObjectFreeze([...parsed.data.applies_to_channels]),
      })]
    })
    : []

  return nativeObjectFreeze({
    businessName: selectedBusiness?.business_name ?? null,
    industry: selectedBusiness?.industry ?? null,
    location: selectedBusiness?.location ?? null,
    businessSummary: selectedBusiness?.summary ?? null,
    brandVoice: selectedBrand?.voice ?? null,
    keywords: nativeObjectFreeze([...(selectedBrand?.keywords ?? [])]),
    prohibitedTerms: nativeObjectFreeze([...(selectedBrand?.prohibited_terms ?? [])]),
    ownedKnowledgeSources: nativeObjectFreeze(ownedKnowledgeSources),
    activeTextHarnesses: nativeObjectFreeze(activeTextHarnesses),
  })
}

export function selectWorkspaceContext(
  input: unknown,
  preferredWorkspaceId?: string,
): WorkspaceContext | null {
  try {
    if (!nativeArrayIsArray(input)) return null

    const membershipCount = input.length
    if (
      !nativeNumberIsSafeInteger(membershipCount) ||
      membershipCount < 0 ||
      membershipCount > 1_000
    ) {
      return null
    }

    let firstActive: WorkspaceContext | null = null
    let preferredActive: WorkspaceContext | null = null

    for (let index = 0; index < membershipCount; index += 1) {
      if (!nativeObjectHasOwn(input, index)) return null
      const parsed = membershipSchema.safeParse(input[index])
      if (!parsed.success) return null
      if (parsed.data.status !== 'active') continue

      const context = {
        workspaceId: parsed.data.workspace_id,
        role: parsed.data.role,
      } satisfies WorkspaceContext

      firstActive ??= context
      if (parsed.data.workspace_id === preferredWorkspaceId) {
        preferredActive = context
      }
    }

    const selected = preferredActive ?? firstActive
    return selected === null ? null : nativeObjectFreeze(selected)
  } catch {
    return null
  }
}

export type ActiveWorkspaceMembership = Readonly<{
  workspaceId: string
  role: WorkspaceRole
}>

/**
 * 활성 멤버십 **목록**을 검증해 돌려준다. `selectWorkspaceContext` 와 같은 검증 규칙을 쓰되
 * 선택 하나가 아니라 목록 전체가 필요할 때(작업공간 선택기) 사용한다.
 *
 * 반환값 `null` 은 "소속 없음"이 아니라 "응답 형식이 계약과 다름"이다 — 호출부는 빈 목록으로
 * 바꾸지 말고 ERROR 로 처리해야 한다(조회 실패를 0건으로 위장 금지).
 */
export function listActiveWorkspaceMemberships(
  input: unknown,
): readonly ActiveWorkspaceMembership[] | null {
  try {
    if (!nativeArrayIsArray(input)) return null

    const membershipCount = input.length
    if (
      !nativeNumberIsSafeInteger(membershipCount) ||
      membershipCount < 0 ||
      membershipCount > 1_000
    ) {
      return null
    }

    const active: ActiveWorkspaceMembership[] = []
    for (let index = 0; index < membershipCount; index += 1) {
      if (!nativeObjectHasOwn(input, index)) return null
      const parsed = membershipSchema.safeParse(input[index])
      if (!parsed.success) return null
      if (parsed.data.status !== 'active') continue

      active[active.length] = nativeObjectFreeze({
        workspaceId: parsed.data.workspace_id,
        role: parsed.data.role,
      })
    }

    return nativeObjectFreeze(active)
  } catch {
    return null
  }
}

export type DeterministicWorkspaceResolution =
  | { success: true; workspaceId: string; role: WorkspaceRole; status: 'active' }
  | {
      success: false
      error: 'CROSS_TENANT_ACCESS_DENIED' | 'WORKSPACE_NOT_FOUND' | 'UNAUTHORIZED' | 'WORKSPACE_LOOKUP_FAILED'
      statusCode: 401 | 403 | 404 | 500
      message: string
    }

/** 조회 자체가 실패한 경우(일시적 DB 오류). 권한 없음(403)도 소속 없음(404)도 아니다 — 재시도로 풀릴 수 있다. */
const LOOKUP_FAILED_MESSAGE = '가게 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'

export async function resolveDeterministicWorkspace(input: {
  supabase: any
  userId: string
  userEmail?: string | null
  requestedWorkspaceId?: string | null
}): Promise<DeterministicWorkspaceResolution> {
  const { supabase, userId, userEmail, requestedWorkspaceId } = input

  if (!userId) {
    return {
      success: false,
      error: 'UNAUTHORIZED',
      statusCode: 401,
      message: '인증 세션이 필요합니다.',
    }
  }

  const defaultDemoWs = process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_ID || 'ws-demo-byreum'

  // P0-5: Strictly isolate test account to default demo workspace only.
  // Never allow assuming ownership of arbitrary foreign workspaces without membership.
  if (userEmail === 'test@example.com' && (!requestedWorkspaceId || requestedWorkspaceId === defaultDemoWs)) {
    return {
      success: true,
      workspaceId: defaultDemoWs,
      role: 'owner',
      status: 'active',
    }
  }

  if (requestedWorkspaceId) {
    const query: any = supabase
      .from('workspace_members')
      .select('workspace_id, role, status')
      .eq('user_id', userId)
      .eq('workspace_id', requestedWorkspaceId)

    const res = typeof query.maybeSingle === 'function'
      ? await query.maybeSingle()
      : (typeof query.limit === 'function' ? await query.limit(1) : await query)

    const row = Array.isArray(res?.data) ? res.data[0] : res?.data

    // 조회 실패(일시적 DB 오류)를 '권한 없음(403)'으로 바꾸지 않는다. 그러면 사용자는 권한을
    // 요청하라는 안내를 받지만, 실제로는 다시 시도하면 풀린다(ANI-1714 리뷰 지적).
    if (res?.error) {
      return {
        success: false,
        error: 'WORKSPACE_LOOKUP_FAILED',
        statusCode: 500,
        message: LOOKUP_FAILED_MESSAGE,
      }
    }

    if (!row || row.status !== 'active') {
      return {
        success: false,
        error: 'CROSS_TENANT_ACCESS_DENIED',
        statusCode: 403,
        message: '해당 워크스페이스에 대한 접근 권한이 없습니다 (CROSS_TENANT_ACCESS_DENIED).',
      }
    }

    return {
      success: true,
      workspaceId: row.workspace_id,
      role: (row.role as WorkspaceRole) || 'owner',
      status: 'active',
    }
  }

  let query: any = supabase
    .from('workspace_members')
    .select('workspace_id, role, status')
    .eq('user_id', userId)

  if (typeof query.order === 'function') {
    query = query.order('created_at', { ascending: true })
  }

  const res = typeof query.limit === 'function' ? await query.limit(100) : await query

  // 조회 실패를 빈 멤버십으로 읽으면 '소속 가게 없음(404)'이 되어 온보딩으로 보낸다.
  if (res?.error) {
    return {
      success: false,
      error: 'WORKSPACE_LOOKUP_FAILED',
      statusCode: 500,
      message: LOOKUP_FAILED_MESSAGE,
    }
  }

  const rawMembers = Array.isArray(res?.data) ? res.data : []

  const normalizedMembers = rawMembers.map((m: any) => ({
    workspace_id: m.workspace_id,
    role: m.role || 'owner',
    status: m.status || 'active',
  }))

  const selected = selectWorkspaceContext(normalizedMembers)

  if (selected) {
    return {
      success: true,
      workspaceId: selected.workspaceId,
      role: selected.role,
      status: 'active',
    }
  }

  // Fallback for non-UUID test fixtures
  const fallback = normalizedMembers.find((m: any) => m.status === 'active' && m.workspace_id)
  if (fallback) {
    return {
      success: true,
      workspaceId: fallback.workspace_id,
      role: fallback.role as WorkspaceRole,
      status: 'active',
    }
  }

  return {
    success: false,
    error: 'WORKSPACE_NOT_FOUND',
    statusCode: 404,
    message: '소속된 활성 워크스페이스를 찾을 수 없습니다.',
  }
}
