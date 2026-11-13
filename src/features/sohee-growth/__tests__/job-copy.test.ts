import { describe, expect, it } from 'vitest'
import { JOB_COPY, type JobCopy } from '../job-copy'
import type { JobKey } from '../types'

const ALL_JOB_KEYS: JobKey[] = [
  'post_social',
  'reply_comments',
  'write_blog',
  'write_daangn',
  'booking_guide',
  'kakao_1on1',
]

describe('JOB_COPY', () => {
  it('모든 JobKey(6개)에 대해 summary와 approval 문구를 정의한다', () => {
    expect(Object.keys(JOB_COPY)).toHaveLength(6)
    for (const key of ALL_JOB_KEYS) {
      const copy: JobCopy = JOB_COPY[key]
      expect(copy).toBeDefined()
      expect(typeof copy.summary).toBe('string')
      expect(copy.summary.trim().length).toBeGreaterThan(0)
      expect(typeof copy.approval).toBe('string')
      expect(copy.approval.trim().length).toBeGreaterThan(0)
    }
  })

  it('모든 문구는 사장님 친화적인 ~해요 체(존댓말 요)로 끝나야 한다', () => {
    for (const key of ALL_JOB_KEYS) {
      const copy = JOB_COPY[key]
      expect(copy.summary.trim()).toMatch(/요$/)
      expect(copy.approval.trim()).toMatch(/요$/)
    }
  })
})
