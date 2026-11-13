import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/** Next.js 의 notFound 는 던져서 렌더를 중단한다. 목이 조용히 돌려주면 가짜 통과가 난다. */
const nav = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('next/navigation', () => nav)

const getCurrentWorkspaceContext = vi.hoisted(() => vi.fn())

vi.mock('@/features/auth/current-workspace', () => ({
  getCurrentWorkspaceContext: () => getCurrentWorkspaceContext(),
}))
vi.mock('@/features/mobile-firstpost/first-post-entry', () => ({
  FirstPostEntry: ({ workspaceId, restoreMissionId }: { workspaceId?: string; restoreMissionId?: string }) => (
    <div data-testid="first-post-entry" data-workspace={workspaceId ?? ''} data-restore={restoreMissionId ?? ''} />
  ),
}))

import FirstPostR2Page from '../page'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

describe('/start/preview-r2 경계 (첫 포스팅 R2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    getCurrentWorkspaceContext.mockResolvedValue({ workspaceId: WORKSPACE_ID, role: 'owner', status: 'active' })
  })

  it('플래그가 꺼져 있으면 페이지가 없다(워크스페이스도 조회하지 않는다)', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', 'off')

    await expect(FirstPostR2Page()).rejects.toThrow('NEXT_NOT_FOUND')

    expect(nav.notFound).toHaveBeenCalled()
    expect(getCurrentWorkspaceContext).not.toHaveBeenCalled()
  })

  it('on 이 아니면 켜지지 않는다("true" 포함)', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', 'true')

    await expect(FirstPostR2Page()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('플래그 ON 이면 서버가 확인한 workspaceId 를 넘겨 첫 포스팅 화면을 연다', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', 'on')

    render(await FirstPostR2Page())

    expect(nav.notFound).not.toHaveBeenCalled()
    expect(screen.getByTestId('first-post-entry')).toHaveAttribute('data-workspace', WORKSPACE_ID)
  })

  it('워크스페이스를 확인할 수 없으면 사진 범위를 지어내지 않고 열지 않는다', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', 'on')
    getCurrentWorkspaceContext.mockResolvedValue(null)

    await expect(FirstPostR2Page()).rejects.toThrow('NEXT_NOT_FOUND')

    expect(nav.notFound).toHaveBeenCalled()
  })

  it('?post=<uuid> 이면 복원 식별자로 넘긴다 (새로고침·깊은 링크)', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', 'on')
    const missionId = '22222222-2222-4222-8222-222222222222'

    render(await FirstPostR2Page({ searchParams: Promise.resolve({ post: missionId }) }))

    expect(screen.getByTestId('first-post-entry')).toHaveAttribute('data-restore', missionId)
  })

  it('?post 가 UUID 형식이 아니면 복원을 시도하지 않고 입력 화면에서 시작한다', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', 'on')

    render(await FirstPostR2Page({ searchParams: Promise.resolve({ post: 'not-a-uuid' }) }))

    expect(screen.getByTestId('first-post-entry')).toHaveAttribute('data-restore', '')
  })

  it('?post 가 없으면 복원 식별자를 넘기지 않는다', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', 'on')

    render(await FirstPostR2Page({ searchParams: Promise.resolve({}) }))

    expect(screen.getByTestId('first-post-entry')).toHaveAttribute('data-restore', '')
  })
})
