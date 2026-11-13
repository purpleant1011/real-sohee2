import { describe, expect, it, vi } from 'vitest'
import {
  computeApprovalFingerprint,
  generateCommentReplyDraft,
  sanitizeDraftReplyText,
} from './draft'
import type { TextGenerator } from '@/features/vault/transform/ports/text-generator'
import type { GroundedBusinessContext } from '@/features/channel-studio/types'

const mockContext: GroundedBusinessContext = {
  businessName: '소희 살롱',
  industry: '미용실',
  location: '서울 강남구 역삼동',
  facts: [
    { kind: 'offering', label: '시그니처 커트', value: '35,000원' },
    { kind: 'policy', label: '영업시간', value: '화-일 10:00 ~ 20:00 (월요일 휴무)' },
  ],
  tone: { presetKey: 'friendly', brandVoice: '다정하고 친절한 어조' },
  knowledgeVersion: 1,
  warnings: [],
}

describe('generateCommentReplyDraft and draft sanitization (Invariant 2 & 4)', () => {
  it('computes exact deterministic sha256 approval fingerprint', () => {
    const fp1 = computeApprovalFingerprint('ws-1', 'cm-1', '감사합니다!')
    const fp2 = computeApprovalFingerprint('ws-1', 'cm-1', '감사합니다!')
    const fpChanged = computeApprovalFingerprint('ws-1', 'cm-1', '감사합니다!!')

    expect(fp1).toMatch(/^[0-9a-f]{64}$/)
    expect(fp1).toBe(fp2)
    expect(fp1).not.toBe(fpChanged)
  })

  it('strips external URLs, phone numbers, and newly added @mentions', () => {
    const raw = '확인해 보세요! https://spam.com/link 와 010-1234-5678 로 전화주세요. @spammer 도 확인요망'
    const cleaned = sanitizeDraftReplyText(raw, 'threads')
    expect(cleaned).not.toContain('https://')
    expect(cleaned).not.toContain('spam.com')
    expect(cleaned).not.toContain('010-1234-5678')
    expect(cleaned).not.toContain('@spammer')
    expect(cleaned).toContain('확인해 보세요!')
  })

  it('caps length per channel limit (500 for Threads, 2200 for Instagram)', () => {
    const longText = '가'.repeat(600)
    const threadsDraft = sanitizeDraftReplyText(longText, 'threads')
    expect(threadsDraft.length).toBe(500)

    const igDraft = sanitizeDraftReplyText(longText, 'instagram')
    expect(igDraft.length).toBe(600)
  })

  it('generates grounded reply and computes matching fingerprint', async () => {
    const mockGen: TextGenerator = {
      generateText: vi.fn().mockResolvedValue(
        JSON.stringify({
          reply: '소희 살롱을 찾아주셔서 진심으로 감사합니다! 다음에도 정성껏 모시겠습니다.',
        })
      ),
    }

    const result = await generateCommentReplyDraft({
      workspaceId: 'ws-1',
      commentId: 'cm-1',
      commentText: '오늘 커트 너무 마음에 들어요!',
      channel: 'instagram',
      authorHandle: 'happy_customer',
      context: mockContext,
      generator: mockGen,
    })

    expect(result.isFallback).toBe(false)
    expect(result.draftText).toContain('소희 살롱')
    expect(result.fingerprint).toBe(computeApprovalFingerprint('ws-1', 'cm-1', result.draftText))
  })

  it('falls back to safe contact invitation on model failure', async () => {
    const failingGen: TextGenerator = {
      generateText: vi.fn().mockRejectedValue(new Error('Model timeout')),
    }

    const result = await generateCommentReplyDraft({
      workspaceId: 'ws-1',
      commentId: 'cm-1',
      commentText: '주차 되나요?',
      channel: 'threads',
      authorHandle: 'inquirer',
      context: mockContext,
      generator: failingGen,
    })

    expect(result.isFallback).toBe(true)
    expect(result.draftText).toContain('DM')
    expect(result.fingerprint).toBe(computeApprovalFingerprint('ws-1', 'cm-1', result.draftText))
  })
})
