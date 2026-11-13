import { describe, expect, it } from 'vitest'
import {
  ACTIVE_WORKSPACE_COOKIE,
  ACTIVE_WORKSPACE_COOKIE_MAX_AGE_SECONDS,
  buildActiveWorkspaceCookie,
  normalizeActiveWorkspacePreference,
  normalizeWorkspaceName,
  resolveActiveWorkspaceSelection,
  resolveWorkspaceList,
} from './active-workspace'

const STORE_A = '10000000-0000-4000-8000-000000000001'
const STORE_B = '10000000-0000-4000-8000-000000000002'
const STORE_C = '10000000-0000-4000-8000-000000000003'

const memberships = [
  { workspace_id: STORE_A, role: 'owner', status: 'active' },
  { workspace_id: STORE_B, role: 'manager', status: 'active' },
]

describe('ANI-1779 활성 가게 선택 값', () => {
  it('UUID 문자열은 다듬어서, 그 밖의 값은 버린다', () => {
    expect(normalizeActiveWorkspacePreference(`  ${STORE_A} `)).toBe(STORE_A)
    expect(normalizeActiveWorkspacePreference('not-a-uuid')).toBeNull()
    expect(normalizeActiveWorkspacePreference('')).toBeNull()
    expect(normalizeActiveWorkspacePreference(null)).toBeNull()
    expect(normalizeActiveWorkspacePreference(123)).toBeNull()
  })

  it('쿠키는 httpOnly · SameSite=Lax · 1년이며 스크립트가 읽을 수 없다', () => {
    const cookie = buildActiveWorkspaceCookie(STORE_A)
    expect(cookie.name).toBe(ACTIVE_WORKSPACE_COOKIE)
    expect(cookie.value).toBe(STORE_A)
    expect(cookie.httpOnly).toBe(true)
    expect(cookie.sameSite).toBe('lax')
    expect(cookie.path).toBe('/')
    expect(cookie.maxAge).toBe(ACTIVE_WORKSPACE_COOKIE_MAX_AGE_SECONDS)
  })

  it('운영 환경에서만 secure 쿠키가 된다', () => {
    expect(buildActiveWorkspaceCookie(STORE_A, { secure: true }).secure).toBe(true)
    expect(buildActiveWorkspaceCookie(STORE_A, { secure: false }).secure).toBe(false)
  })
})

describe('resolveActiveWorkspaceSelection', () => {
  it('선택한 가게의 활성 멤버십이 있으면 그 가게로 열고 fallback 하지 않는다', () => {
    const selected = resolveActiveWorkspaceSelection(memberships, STORE_B)
    expect(selected).toEqual({
      workspaceId: STORE_B,
      role: 'manager',
      preferredWorkspaceId: STORE_B,
      fellBack: false,
      activeWorkspaceCount: 2,
    })
  })

  it('활성 가게 수를 함께 돌려준다(1개면 화면이 선택기를 숨긴다)', () => {
    expect(resolveActiveWorkspaceSelection([
      { workspace_id: STORE_A, role: 'owner', status: 'active' },
      { workspace_id: STORE_B, role: 'manager', status: 'invited' },
    ], null)?.activeWorkspaceCount).toBe(1)
    expect(resolveActiveWorkspaceSelection(memberships, null)?.activeWorkspaceCount).toBe(2)
  })

  it('선택한 가게가 목록에 없으면 첫 활성 가게로 열고 fallback 을 알린다', () => {
    const selected = resolveActiveWorkspaceSelection(memberships, STORE_C)
    expect(selected?.workspaceId).toBe(STORE_A)
    expect(selected?.fellBack).toBe(true)
  })

  it('초대 대기·비활성 멤버십은 선택 대상이 아니다', () => {
    const selected = resolveActiveWorkspaceSelection([
      { workspace_id: STORE_A, role: 'owner', status: 'invited' },
      { workspace_id: STORE_B, role: 'viewer', status: 'active' },
    ], STORE_A)
    expect(selected?.workspaceId).toBe(STORE_B)
    expect(selected?.fellBack).toBe(true)
  })

  it('활성 멤버십이 없거나 응답 형식이 다르면 null (빈 목록 위장 금지)', () => {
    expect(resolveActiveWorkspaceSelection([
      { workspace_id: STORE_A, role: 'owner', status: 'disabled' },
    ], null)).toBeNull()
    expect(resolveActiveWorkspaceSelection({ workspace_id: STORE_A }, null)).toBeNull()
    expect(resolveActiveWorkspaceSelection([
      { workspace_id: STORE_A, role: 'unknown-role', status: 'active' },
    ], null)).toBeNull()
  })
})

describe('resolveWorkspaceList', () => {
  it('서버가 확인한 이름만 싣고, 이름이 없으면 목록에는 남기되 null 로 둔다', () => {
    const resolution = resolveWorkspaceList({
      memberships,
      names: { [STORE_A]: '바이름 강남점', [STORE_B]: '   ' },
      preferredWorkspaceId: STORE_A,
    })
    expect(resolution).toEqual({
      state: 'ready',
      workspaces: [
        { id: STORE_A, name: '바이름 강남점', role: 'owner' },
        { id: STORE_B, name: null, role: 'manager' },
      ],
      activeId: STORE_A,
      fellBack: false,
    })
  })

  it('이름 조회가 실패해 맵이 비어도 가게 목록을 0건으로 바꾸지 않는다', () => {
    const resolution = resolveWorkspaceList({ memberships, names: null })
    expect(resolution.state).toBe('ready')
    if (resolution.state !== 'ready') return
    expect(resolution.workspaces).toHaveLength(2)
    expect(resolution.workspaces.map((item) => item.name)).toEqual([null, null])
  })

  it('멤버십 응답이 계약과 다르면 empty 가 아니라 unavailable 이다', () => {
    expect(resolveWorkspaceList({ memberships: 'boom' })).toEqual({ state: 'unavailable' })
    expect(resolveWorkspaceList({ memberships: [{ workspace_id: 'nope' }] })).toEqual({ state: 'unavailable' })
  })

  it('활성 멤버십이 0건이면 empty 다', () => {
    expect(resolveWorkspaceList({
      memberships: [{ workspace_id: STORE_A, role: 'owner', status: 'disabled' }],
    })).toEqual({ state: 'empty' })
  })

  it('선택한 가게가 없으면 첫 가게를 열고 fallback 을 표시한다', () => {
    const resolution = resolveWorkspaceList({ memberships, preferredWorkspaceId: STORE_C })
    expect(resolution.state).toBe('ready')
    if (resolution.state !== 'ready') return
    expect(resolution.activeId).toBe(STORE_A)
    expect(resolution.fellBack).toBe(true)
  })

  it('가게 이름 공백은 null 로 정규화한다', () => {
    expect(normalizeWorkspaceName('  소희  ')).toBe('소희')
    expect(normalizeWorkspaceName('   ')).toBeNull()
    expect(normalizeWorkspaceName(undefined)).toBeNull()
  })
})
