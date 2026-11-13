import { describe, expect, it } from 'vitest'
import { chatRequestSchema } from './chat-request-schema'

const clientMessageId = '11111111-1111-4111-8111-111111111111'
const attachmentId = '22222222-2222-4222-8222-222222222222'

describe('chatRequestSchema', () => {
  it('accepts a trimmed bounded message, a client id, and up to twenty attachments', () => {
    const result = chatRequestSchema.parse({
      content: '  오늘 포스팅 근거를 설명해줘  ',
      clientMessageId,
      attachmentIds: Array.from({ length: 20 }, () => attachmentId),
    })

    expect(result).toEqual({
      content: '오늘 포스팅 근거를 설명해줘',
      clientMessageId,
      attachmentIds: Array.from({ length: 20 }, () => attachmentId),
    })
  })

  it.each([
    { name: '빈 메시지', value: { content: ' ', clientMessageId, attachmentIds: [] } },
    { name: '8,000자 초과', value: { content: 'a'.repeat(8_001), clientMessageId, attachmentIds: [] } },
    { name: '잘못된 클라이언트 식별자', value: { content: '질문', clientMessageId: 'not-a-uuid', attachmentIds: [] } },
    { name: '첨부 20개 초과', value: { content: '질문', clientMessageId, attachmentIds: Array.from({ length: 21 }, () => attachmentId) } },
    { name: '잘못된 첨부 식별자', value: { content: '질문', clientMessageId, attachmentIds: ['not-a-uuid'] } },
    { name: '알 수 없는 필드', value: { content: '질문', clientMessageId, attachmentIds: [], provider: 'openai' } },
  ])('$name를 거절한다', ({ value }) => {
    expect(chatRequestSchema.safeParse(value).success).toBe(false)
  })

  it('allows a failed assistant id for retry without changing the user message id', () => {
    expect(chatRequestSchema.safeParse({
      content: '질문',
      clientMessageId,
      attachmentIds: [],
      retryAssistantMessageId: '33333333-3333-4333-8333-333333333333',
    }).success).toBe(true)
  })

  it('allows a selected slide only with the message that owns its artifact', () => {
    expect(chatRequestSchema.safeParse({
      content: '두 번째 이미지만 다시 만들어줘',
      clientMessageId,
      attachmentIds: [],
      replyToMessageId: '33333333-3333-4333-8333-333333333333',
      selectedSlideId: '44444444-4444-4444-8444-444444444444',
    }).success).toBe(true)
  })

  it('allows a retryable failed slide through a dedicated field', () => {
    expect(chatRequestSchema.safeParse({
      content: '실패한 이미지만 다시 만들어줘',
      clientMessageId,
      attachmentIds: [],
      replyToMessageId: '33333333-3333-4333-8333-333333333333',
      retryFailedSlideId: '44444444-4444-4444-8444-444444444444',
    }).success).toBe(true)
  })

  it.each([
    { replyToMessageId: '33333333-3333-4333-8333-333333333333' },
    { selectedSlideId: '44444444-4444-4444-8444-444444444444' },
    { retryFailedSlideId: '44444444-4444-4444-8444-444444444444' },
    {
      replyToMessageId: '33333333-3333-4333-8333-333333333333',
      selectedSlideId: '44444444-4444-4444-8444-444444444444',
      retryFailedSlideId: '55555555-5555-4555-8555-555555555555',
    },
    { replyToMessageId: 'unsafe', selectedSlideId: '44444444-4444-4444-8444-444444444444' },
  ])('rejects an incomplete or malformed slide reference', (reference) => {
    expect(chatRequestSchema.safeParse({
      content: '두 번째 이미지만 다시 만들어줘',
      clientMessageId,
      attachmentIds: [],
      ...reference,
    }).success).toBe(false)
  })
})
