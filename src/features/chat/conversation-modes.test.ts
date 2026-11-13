import { describe, expect, it } from 'vitest'
import { CONVERSATION_MODES, POSTING_CHANNELS, POSTING_PURPOSES, buildModePrompt, isModeReady } from './conversation-modes'

describe('대화 모드 레지스트리', () => {
  it('포스팅·지식 가르치기·고객 문의 답변·성과 점검이 있고 id 가 겹치지 않는다', () => {
    const ids = CONVERSATION_MODES.map(m => m.id)
    expect(ids).toEqual(expect.arrayContaining(['posting', 'teach', 'inquiry', 'insight']))
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('포스팅은 목적 4종과 채널 4종(인스타·스레드·네이버 블로그·당근)을 고른다', () => {
    expect(POSTING_PURPOSES.map(p => p.label)).toEqual(['프로모션', '일상', '홍보', '이벤트'])
    expect(POSTING_CHANNELS.map(c => c.id)).toEqual(['instagram', 'threads', 'naver_blog', 'daangn_business'])
  })
  it('포스팅은 목적과 채널을 하나 이상 골라야 시작할 수 있다', () => {
    expect(isModeReady('posting', { purpose: null, channels: [] })).toBe(false)
    expect(isModeReady('posting', { purpose: 'event', channels: [] })).toBe(false)
    expect(isModeReady('posting', { purpose: 'event', channels: ['instagram'] })).toBe(true)
    expect(isModeReady('teach', {})).toBe(true)
  })
  it('선택을 소희에게 보내는 첫 메시지로 만든다(질문부터 하도록)', () => {
    const msg = buildModePrompt('posting', { purpose: 'event', channels: ['instagram', 'naver_blog'] })
    expect(msg).toContain('이벤트')
    expect(msg).toContain('인스타그램')
    expect(msg).toContain('네이버 블로그')
    expect(msg).toMatch(/질문/)
    expect(buildModePrompt('teach', {})).toMatch(/가르|질문/)
  })
  it('알 수 없는 채널/목적은 프롬프트에 넣지 않는다', () => {
    const msg = buildModePrompt('posting', { purpose: 'nope' as never, channels: ['evil' as never, 'threads'] })
    expect(msg).not.toContain('evil')
    expect(msg).toContain('스레드')
  })
})
