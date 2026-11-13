import { describe, expect, it } from 'vitest'
import { submitFeedback, triageFeedback } from './repository'

const noDb = { from() { throw new Error('should not be called') } }

describe('feedback repository (입력 검증)', () => {
  it('평점 범위와 빈 내용을 거절하고 DB를 호출하지 않는다', async () => {
    const ctx = { workspaceId: 'w', userId: 'u' }
    expect(await submitFeedback(noDb, ctx, { screen: '/app', rating: 6, message: 'x' })).toMatchObject({ ok: false, reason: 'INVALID' })
    expect(await submitFeedback(noDb, ctx, { screen: '/app', message: '   ' })).toMatchObject({ ok: false, reason: 'INVALID' })
    expect(await submitFeedback(noDb, ctx, { screen: '/app', message: 'x', status: 'APPLIED' })).toMatchObject({ ok: false, reason: 'INVALID' })
  })

  it('저장 실패는 실패로 알린다', async () => {
    const failing = { from: () => ({ insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { code: 'X' } }) }) }) }) }
    expect(await submitFeedback(failing, { workspaceId: 'w', userId: 'u' }, { screen: '/app', message: 'x' })).toMatchObject({ ok: false, reason: 'FAILED' })
  })

  it('운영 처리 입력은 허용된 태그·상태만 받는다', async () => {
    const id = '0b1c2d3e-1111-4222-8333-444455556666'
    expect((await triageFeedback(noDb, { id, workspaceId: id, tags: ['HACK'] })).ok).toBe(false)
    expect((await triageFeedback(noDb, { id, workspaceId: id, status: 'DONE' })).ok).toBe(false)
  })
})
