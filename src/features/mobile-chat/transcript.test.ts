import { describe, expect, it } from 'vitest'

import { isSafeEvidenceHref, outgoingBubble, toChatBubbles } from './transcript'

describe('toChatBubbles', () => {
  it('배열과 { messages } 둘 다 받는다', () => {
    const raw = [
      { id: 'm1', role: 'owner', text: '이번 주 게시 도와줘' },
      { id: 'm2', role: 'sohee', text: '네, 초안부터 확인하겠습니다' },
    ]
    expect(toChatBubbles(raw)).toHaveLength(2)
    expect(toChatBubbles({ messages: raw })).toHaveLength(2)
  })

  it('id 나 본문이 없는 항목은 버린다', () => {
    const bubbles = toChatBubbles([
      { id: '', role: 'owner', text: 'x' },
      { id: 'm1', role: 'owner', text: '' },
      { id: 'm2', role: 'owner', text: '   ' },
      { id: 'm3', role: 'owner', text: 'ok' },
    ])
    expect(bubbles.map((bubble) => bubble.id)).toEqual(['m3'])
  })

  it('같은 id 는 한 번만 남긴다', () => {
    const bubbles = toChatBubbles([
      { id: 'dup', role: 'owner', text: 'first' },
      { id: 'dup', role: 'owner', text: 'second' },
    ])
    expect(bubbles).toHaveLength(1)
    expect(bubbles[0]?.text).toBe('first')
  })

  it('모르는 role 은 sohee 로 두지 않고 기본 처리하되 화이트리스트만 인정한다', () => {
    const bubbles = toChatBubbles([{ id: 'm1', role: 'system-admin', text: 'hi' }])
    expect(bubbles[0]?.role).toBe('sohee')
  })

  it('역할·본문·순서를 보존한다', () => {
    const bubbles = toChatBubbles([
      { id: 'a', role: 'system', text: '연결됨' },
      { id: 'b', role: 'owner', text: '안녕' },
      { id: 'c', role: 'sohee', text: '네' },
    ])
    expect(bubbles.map((bubble) => bubble.role)).toEqual(['system', 'owner', 'sohee'])
    expect(bubbles.map((bubble) => bubble.text)).toEqual(['연결됨', '안녕', '네'])
  })

  it('서버가 확정하지 않은 버블은 pending 으로 남는다', () => {
    const bubbles = toChatBubbles([{ id: 'm1', role: 'owner', text: '전송 중', pending: true }])
    expect(bubbles[0]?.pending).toBe(true)
  })

  it('객체가 아닌 payload 는 빈 배열이다', () => {
    expect(toChatBubbles(null)).toEqual([])
    expect(toChatBubbles(undefined)).toEqual([])
    expect(toChatBubbles('messages')).toEqual([])
    expect(toChatBubbles({ messages: 'nope' })).toEqual([])
  })
})

describe('증거 링크', () => {
  it('앱 내부 경로와 http(s) 만 허용한다', () => {
    expect(isSafeEvidenceHref('/app/work/1')).toBe(true)
    expect(isSafeEvidenceHref('https://example.com/x')).toBe(true)
    expect(isSafeEvidenceHref('http://example.com')).toBe(true)
  })

  it('위험하거나 알 수 없는 스킴은 거부한다', () => {
    expect(isSafeEvidenceHref('javascript:alert(1)')).toBe(false)
    expect(isSafeEvidenceHref('data:text/html,hi')).toBe(false)
    expect(isSafeEvidenceHref('sohee://x')).toBe(false)
    expect(isSafeEvidenceHref('work/1')).toBe(false)
  })

  it('검증을 통과한 링크만 버블에 남는다', () => {
    const bubbles = toChatBubbles([
      {
        id: 'm1',
        role: 'sohee',
        text: '게시 결과입니다',
        evidence: [
          { label: '게시물', href: '/app/work/1' },
          { label: '나쁜 링크', href: 'javascript:alert(1)' },
          { label: '', href: '/app/work/2' },
          { label: '라벨만', href: '' },
        ],
      },
    ])
    expect(bubbles[0]?.evidence).toEqual([{ label: '게시물', href: '/app/work/1' }])
  })

  it('evidence 가 배열이 아니면 빈 목록이다', () => {
    const bubbles = toChatBubbles([{ id: 'm1', role: 'sohee', text: 'x', evidence: 'ibm' }])
    expect(bubbles[0]?.evidence).toEqual([])
  })
})

describe('승인 제안 카드', () => {
  it('서버가 승인 id 를 준 경우에만 카드를 만든다', () => {
    const withId = toChatBubbles([
      { id: 'm1', role: 'sohee', text: '승인해 주세요', approval: { id: 'apr_1', title: '게시 승인' } },
    ])
    expect(withId[0]?.approval).toEqual({ id: 'apr_1', title: '게시 승인' })
  })

  it('id 가 없으면 카드를 만들지 않는다', () => {
    const noId = toChatBubbles([{ id: 'm1', role: 'sohee', text: 'x', approval: { title: '게시 승인' } }])
    expect(noId[0]?.approval).toBeNull()
  })

  it('제목이 없으면 승인 제안으로 표시한다', () => {
    const noTitle = toChatBubbles([{ id: 'm1', role: 'sohee', text: 'x', approval: { id: 'apr_1' } }])
    expect(noTitle[0]?.approval).toEqual({ id: 'apr_1', title: '승인 제안' })
  })
})

describe('outgoingBubble', () => {
  it('전송 직후 내 말풍선은 pending 이다', () => {
    const bubble = outgoingBubble('tmp_1', '안녕하세요')
    expect(bubble.role).toBe('owner')
    expect(bubble.pending).toBe(true)
    expect(bubble.evidence).toEqual([])
    expect(bubble.approval).toBeNull()
  })
})
