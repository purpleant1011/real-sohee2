import { describe, expect, it } from 'vitest'
import { evaluateJobs } from '../jobs'
import { evaluateRequirements } from '../requirements'
import { EMPTY, FULL, PARTIAL } from './fixtures'

const statusOf = (jobs: ReturnType<typeof evaluateJobs>) => Object.fromEntries(jobs.map((j) => [j.key, j.status]))

describe('evaluateJobs', () => {
  it('업무 6개를 시안 순서대로 돌려준다', () => {
    const jobs = evaluateJobs(evaluateRequirements(EMPTY), 'TRIAL')
    expect(jobs.map((j) => j.label)).toEqual([
      '인스타·스레드 게시',
      '댓글 답변',
      '블로그 글 작성',
      '당근 글 작성',
      '예약·예약금 안내',
      '카카오톡 1:1 상담',
    ])
  })

  it('카카오톡은 항상 곧 열려요', () => {
    for (const tier of ['TRIAL', 'PENDING_REVIEW', 'FORMAL', 'REJECTED'] as const) {
      const job = evaluateJobs(evaluateRequirements(FULL), tier).find((j) => j.key === 'kakao_1on1')
      expect(job).toMatchObject({ status: 'coming_soon', note: '곧 열려요' })
    }
  })

  it('모두 가르친 정식회원: 게시는 가능, 블로그·당근은 미리보기만, 나머지 가능', () => {
    const jobs = evaluateJobs(evaluateRequirements(FULL), 'FORMAL')
    expect(statusOf(jobs)).toEqual({
      post_social: 'available',
      reply_comments: 'available',
      write_blog: 'preview_only',
      write_daangn: 'preview_only',
      booking_guide: 'available',
      kakao_1on1: 'coming_soon',
    })
    expect(jobs.find((j) => j.key === 'post_social')?.note).toBe('승인 후 실행')
    expect(jobs.find((j) => j.key === 'write_blog')?.note).toBe('미리보기까지 가능')
  })

  it('체험회원은 게시만 열리고 나머지는 정식회원이 되면 열려요', () => {
    const jobs = evaluateJobs(evaluateRequirements(FULL), 'TRIAL')
    expect(statusOf(jobs)).toMatchObject({
      post_social: 'available',
      reply_comments: 'membership',
      write_blog: 'membership',
      write_daangn: 'membership',
      booking_guide: 'membership',
    })
    expect(jobs.find((j) => j.key === 'post_social')?.note).toBe('체험 기간에는 첫 게시물 2건까지')
    expect(jobs.find((j) => j.key === 'reply_comments')?.note).toBe('정식회원이 되면 열려요')
  })

  it('요건을 반 이상 채웠으면 준비 중, 못 미치면 잠김 — 남은 일을 note 로 알려준다', () => {
    const jobs = evaluateJobs(evaluateRequirements(PARTIAL), 'FORMAL')
    const post = jobs.find((j) => j.key === 'post_social')!
    expect(post.status).toBe('learning') // 5개 중 4개 충족
    expect(post.note).toBe('이미지 스타일 정하기')
    expect(post.missing.map((m) => m.key)).toEqual(['image_style'])

    const reply = jobs.find((j) => j.key === 'reply_comments')!
    expect(reply.status).toBe('learning') // 6개 중 4개
    expect(reply.missing.map((m) => m.key)).toEqual(['image_style', 'faq'])

    const booking = jobs.find((j) => j.key === 'booking_guide')!
    expect(booking.status).toBe('learning') // 4개 중 2개(shop_basic, products) 충족 → ceil(4/2)=2 이상
  })

  it('아무것도 없으면 게시도 잠김', () => {
    const post = evaluateJobs(evaluateRequirements(EMPTY), 'FORMAL').find((j) => j.key === 'post_social')!
    expect(post.status).toBe('locked')
    expect(post.note).toBe('가게 이름·업종·소개 알려주기')
  })

  it('남은 양이 있는 요건은 이름과 함께 알려준다', () => {
    const e = { ...FULL, factCounts: { ...FULL.factCounts, FAQ: 1 } }
    const reply = evaluateJobs(evaluateRequirements(e), 'FORMAL').find((j) => j.key === 'reply_comments')!
    expect(reply.status).toBe('learning')
    expect(reply.note).toBe('자주 묻는 질문 2개 더')
  })

  it('각 업무의 needed에 필요한 전체 요건(충족 여부 무관)을 채우고, coming_soon은 빈 배열이다', () => {
    const jobs = evaluateJobs(evaluateRequirements(PARTIAL), 'FORMAL')
    const post = jobs.find((j) => j.key === 'post_social')!
    expect(post.needed.map((n) => n.key)).toEqual([
      'shop_basic',
      'voice',
      'caution',
      'image_style',
      'channel',
    ])
    // needed 안에는 done=true 와 done=false 가 모두 포함된다
    expect(post.needed.find((n) => n.key === 'shop_basic')?.done).toBe(true)
    expect(post.needed.find((n) => n.key === 'image_style')?.done).toBe(false)

    const kakao = jobs.find((j) => j.key === 'kakao_1on1')!
    expect(kakao.needed).toEqual([])
  })
})
