import { describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
const guard = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/workspace-guard', () => ({ requireWorkspaceMembership: guard }))
import { authorizeStudio, studioFailure } from './route-utils'

describe('Studio API boundaries', () => {
  it('rejects a non-UUID workspace even when a guard grants access', async () => {
    guard.mockResolvedValue({ ok: true, workspaceId: 'ws-default', role: 'owner', userId: crypto.randomUUID() })
    const result = await authorizeStudio('ws-default')
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(400)
  })
  it('maps a stale fact conflict to 409 without exposing database details', async () => {
    const response = studioFailure(new Error('STUDIO_FACT_CONFLICT'), 'SAVE_FAILED', '저장하지 못했어요.')
    expect(response.status).toBe(409)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
  it('returns 409 for a duplicate turn that is still generating', () => {
    expect(studioFailure(new Error('STUDIO_TURN_STREAMING'), 'TURN_FAILED', '답변 실패').status).toBe(409)
  })
  it('returns 402 when credits cannot cover a turn', () => {
    expect(studioFailure(new Error('CREDIT_INSUFFICIENT'), 'TURN_FAILED', '답변 실패').status).toBe(402)
  })
  it('maps a repository replay conflict without leaking its diagnostic text', async () => {
    const response = studioFailure(new Error('conflict: mismatched replay (STUDIO_TURN_CONFLICT)'), 'SAVE_FAILED', '저장 실패')
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('STUDIO_TURN_CONFLICT')
  })
  it('maps missing proposals to 404', () => {
    expect(studioFailure(new Error('STUDIO_PROPOSAL_NOT_FOUND'), 'SAVE_FAILED', '저장하지 못했어요.').status).toBe(404)
  })
  it('does not leak a raw database error', async () => {
    const response = studioFailure(new Error('password=secret database host internal'), 'SAVE_FAILED', '저장하지 못했어요.')
    expect(await response.json()).toEqual({ success: false, error: 'SAVE_FAILED', message: '저장하지 못했어요.' })
    expect(response.status).toBe(503)
  })
})
