import { describe, expect, it } from 'vitest'

import { mergeBubbles } from './pending-bubbles'
import { outgoingBubble, type ChatBubble } from './transcript'

function bubble(
  id: string,
  role: ChatBubble['role'],
  text: string,
  pending = false,
): ChatBubble {
  return { id, role, text, pending, evidence: [], approval: null }
}

describe('mergeBubbles', () => {
  it('확정 버블 순서를 그대로 두고 대기 버블을 뒤에 붙인다', () => {
    const confirmed = [bubble('a', 'owner', '안녕하세요'), bubble('b', 'sohee', '네')]
    const queued = [outgoingBubble('tmp_1', '이번 주 게시 도와줘')]

    const merged = mergeBubbles(confirmed, queued)

    expect(merged.map(item => item.id)).toEqual(['a', 'b', 'tmp_1'])
    expect(merged.at(-1)?.pending).toBe(true)
  })

  it('서버가 같은 본문을 이미 확정했으면 대기 버블은 버린다', () => {
    const confirmed = [bubble('m1', 'owner', '이번 주 게시 도와줘')]
    const queued = [outgoingBubble('tmp_1', '이번 주 게시 도와줘')]

    expect(mergeBubbles(confirmed, queued).map(item => item.id)).toEqual(['m1'])
  })

  it('앞뒤 공백만 다른 같은 본문도 중복으로 본다', () => {
    const confirmed = [bubble('m1', 'owner', '게시 도와줘')]
    const queued = [outgoingBubble('tmp_1', '  게시 도와줘  ')]

    expect(mergeBubbles(confirmed, queued)).toHaveLength(1)
  })

  it('이미 확정된 id 는 다시 붙이지 않는다', () => {
    const confirmed = [bubble('m1', 'sohee', '초안입니다')]
    const queued = [bubble('m1', 'sohee', '초안입니다', true)]

    expect(mergeBubbles(confirmed, queued)).toHaveLength(1)
  })

  it('소희·시스템 버블은 본문이 같아도 합치지 않는다', () => {
    const confirmed = [bubble('m1', 'sohee', '확인 중입니다')]
    const queued = [bubble('tmp_1', 'sohee', '확인 중입니다', true)]

    expect(mergeBubbles(confirmed, queued).map(item => item.id)).toEqual(['m1', 'tmp_1'])
  })

  it('대기 버블은 id 가 같으면 한 번만 붙는다', () => {
    const merged = mergeBubbles(
      [],
      [outgoingBubble('tmp_1', '안녕하세요'), outgoingBubble('tmp_1', '다른 본문')],
    )

    expect(merged.map(item => item.id)).toEqual(['tmp_1'])
    expect(merged[0]?.text).toBe('안녕하세요')
  })

  it('같은 본문을 실제로 두 번 보냈으면 두 버블을 남긴다', () => {
    const merged = mergeBubbles(
      [],
      [outgoingBubble('tmp_1', '안녕하세요'), outgoingBubble('tmp_2', '안녕하세요')],
    )

    expect(merged.map(item => item.id)).toEqual(['tmp_1', 'tmp_2'])
  })

  it('빈 목록끼리는 빈 목록이다', () => {
    expect(mergeBubbles([], [])).toEqual([])
  })

  it('원본 배열을 변경하지 않는다', () => {
    const confirmed = [bubble('a', 'owner', '안녕')]
    const queued = [outgoingBubble('tmp_1', '게시 도와줘')]

    mergeBubbles(confirmed, queued)

    expect(confirmed).toHaveLength(1)
    expect(queued).toHaveLength(1)
  })
})
