import { z } from 'zod'
import { getCookieDomain } from '@/lib/supabase/cookie-domain'
import {
  listActiveWorkspaceMemberships,
  selectWorkspaceContext,
  type WorkspaceRole,
} from './workspace-context'

/**
 * ANI-1779: 로그인 사용자가 지금 보고 있는 가게를 **서버가 읽는 쿠키**로 고정한다.
 *
 * 예전에는 `sessionStorage` 에만 저장해서 서버 렌더(layout·페이지)와 화면이 서로 다른 가게를
 * 가리킬 수 있었다. 이 쿠키가 유일한 선택 저장소이며, 값은 항상 멤버십 재검증을 통과해야 한다.
 * httpOnly 이므로 브라우저 스크립트가 임의로 바꿀 수 없다.
 */
export const ACTIVE_WORKSPACE_COOKIE = 'sohee_active_workspace_id'

export const ACTIVE_WORKSPACE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

const uuidSchema = z.string().uuid()

export function normalizeActiveWorkspacePreference(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const parsed = uuidSchema.safeParse(trimmed)
  return parsed.success ? parsed.data : null
}

export function buildActiveWorkspaceCookie(
  workspaceId: string,
  options?: Readonly<{ secure?: boolean; host?: string | null }>,
) {
  const domain = getCookieDomain(options?.host)
  return {
    name: ACTIVE_WORKSPACE_COOKIE,
    value: workspaceId,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: options?.secure ?? process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ACTIVE_WORKSPACE_COOKIE_MAX_AGE_SECONDS,
    ...(domain ? { domain } : {}),
  }
}

export type ActiveWorkspaceSelection = Readonly<{
  workspaceId: string
  role: WorkspaceRole
  preferredWorkspaceId: string | null
  /** 쿠키가 가리킨 가게에 접근할 수 없어 첫 활성 가게로 열었는지. 화면에서 1회 안내한다. */
  fellBack: boolean
  /** 활성 멤버십 수. 1개면 화면은 선택기 대신 이름만 보여 준다(전환할 대상이 없다). */
  activeWorkspaceCount: number
}>

/**
 * 멤버십 목록 + 쿠키 선호값으로 지금 열 가게를 정한다.
 * 형식이 계약과 다르면(배열 아님·알 수 없는 역할 등) `null` — 호출부는 fail-closed 로 처리한다.
 */
export function resolveActiveWorkspaceSelection(
  memberships: unknown,
  preferredWorkspaceId?: string | null,
): ActiveWorkspaceSelection | null {
  const preferred = normalizeActiveWorkspacePreference(preferredWorkspaceId)
  const selected = selectWorkspaceContext(memberships, preferred ?? undefined)
  if (!selected) return null

  // 목록 검증이 실패했더라도 선택 자체는 유효하므로, 전환 가능 여부는 보수적으로 "1개"로 둔다.
  const activeWorkspaceCount = listActiveWorkspaceMemberships(memberships)?.length ?? 1

  return Object.freeze({
    workspaceId: selected.workspaceId,
    role: selected.role,
    preferredWorkspaceId: preferred,
    fellBack: preferred !== null && preferred !== selected.workspaceId,
    activeWorkspaceCount,
  })
}

export type WorkspaceListEntry = Readonly<{
  id: string
  /** 서버가 확인한 가게 이름. 비어 있으면 null — 화면은 추측하지 않고 "미확인"으로 표시한다. */
  name: string | null
  role: WorkspaceRole
}>

export type WorkspaceListResolution =
  | Readonly<{
      state: 'ready'
      workspaces: readonly WorkspaceListEntry[]
      activeId: string
      fellBack: boolean
    }>
  | Readonly<{ state: 'empty' }>
  | Readonly<{ state: 'unavailable' }>

export function normalizeWorkspaceName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * 작업공간 선택기 목록. 이름 조회는 호출부가 먼저 수행해 id→name 맵으로 넘긴다.
 * 이름이 없는 가게도 목록에는 남긴다(이름을 추측하지 않는다).
 */
export function resolveWorkspaceList(input: Readonly<{
  memberships: unknown
  names?: Readonly<Record<string, unknown>> | null
  preferredWorkspaceId?: string | null
}>): WorkspaceListResolution {
  const activeMemberships = listActiveWorkspaceMemberships(input.memberships)
  if (activeMemberships === null) return Object.freeze({ state: 'unavailable' })
  if (activeMemberships.length === 0) return Object.freeze({ state: 'empty' })

  const preferred = normalizeActiveWorkspacePreference(input.preferredWorkspaceId)
  const selected = selectWorkspaceContext(input.memberships, preferred ?? undefined)
  if (!selected) return Object.freeze({ state: 'unavailable' })

  const rawNames = input.names && typeof input.names === 'object' ? input.names : {}
  const workspaces: WorkspaceListEntry[] = []
  for (let index = 0; index < activeMemberships.length; index += 1) {
    const membership = activeMemberships[index]!
    workspaces[index] = Object.freeze({
      id: membership.workspaceId,
      name: normalizeWorkspaceName(Object.hasOwn(rawNames, membership.workspaceId)
        ? rawNames[membership.workspaceId]
        : null),
      role: membership.role,
    })
  }

  return Object.freeze({
    state: 'ready',
    workspaces: Object.freeze(workspaces),
    activeId: selected.workspaceId,
    fellBack: preferred !== null && preferred !== selected.workspaceId,
  })
}
