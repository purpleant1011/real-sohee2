import { describe, expect, it } from 'vitest'
import { routeConversationRequest, conversationReadRuntimeEnabled } from './conversation-runtime-router'
describe('conversation runtime routing', () => {
  it('keeps normal answers and existing generation flows out of the read bridge', () => {
    expect(routeConversationRequest('안녕하세요')).toEqual({ kind: 'answer' })
    expect(routeConversationRequest('잔여 크레딧으로 사진 만들어줘')).toEqual({ kind: 'existing_flow' })
    expect(routeConversationRequest('네이버 블로그 글 작성해줘')).toEqual({ kind: 'existing_flow' })
    expect(routeConversationRequest('예약 문의 회수해줘')).toEqual({ kind: 'existing_flow' })
    expect(routeConversationRequest('좋아 지금 게시해줘')).toEqual({ kind: 'existing_flow' })
  })
  it('routes only explicit credit reads to the existing dispatcher', () => {
    expect(routeConversationRequest('현재 남은 크레딧 얼마야?')).toEqual({
      kind: 'capability',
      capabilityId: 'credit.status',
      allowedCapabilityIds: ['credit.status'],
    })
  })
  it('routes interaction queries to interaction.list with reply draft capabilities', () => {
    const expected = {
      kind: 'capability',
      capabilityId: 'interaction.list',
      allowedCapabilityIds: ['interaction.list', 'comment.reply_draft', 'dm.reply_draft'],
    }
    expect(routeConversationRequest('오늘 인스타 댓글 확인해줘')).toEqual(expected)
    expect(routeConversationRequest('수신된 DM 문의 알려줘')).toEqual(expected)
    expect(routeConversationRequest('댓글 답변 제안해줘')).toEqual(expected)
  })
  it('routes reservation queries to reservation.list with customer search capability', () => {
    const expected = {
      kind: 'capability',
      capabilityId: 'reservation.list',
      allowedCapabilityIds: ['reservation.list', 'customer.search'],
    }
    expect(routeConversationRequest('예약 장부 확인해줘')).toEqual(expected)
    expect(routeConversationRequest('오늘 예약 일정 알려줘')).toEqual(expected)
  })
  it('routes knowledge queries to knowledge.search capability', () => {
    const expected = {
      kind: 'capability',
      capabilityId: 'knowledge.search',
      allowedCapabilityIds: ['knowledge.search'],
    }
    expect(routeConversationRequest('가게 지식 확인해줘')).toEqual(expected)
    expect(routeConversationRequest('매장 운영 정보 정리해줘')).toEqual(expected)
  })
  it('defaults off and requires an exact workspace allowlist without wildcard, or all', () => {
    expect(conversationReadRuntimeEnabled(undefined, undefined, 'workspace-a')).toBe(false)
    expect(conversationReadRuntimeEnabled('1', '*', 'workspace-a')).toBe(false)
    expect(conversationReadRuntimeEnabled('1', 'workspace-a,workspace-b', 'workspace-a')).toBe(true)
    expect(conversationReadRuntimeEnabled('1', 'workspace-b', 'workspace-a')).toBe(false)
    expect(conversationReadRuntimeEnabled('all', undefined, 'any-workspace')).toBe(true)
    expect(conversationReadRuntimeEnabled('all', undefined, '')).toBe(false)
  })
})
