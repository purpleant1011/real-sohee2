// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { StateChip, STATE_CHIP, StateView, type StateChipKind } from './index'

afterEach(cleanup)

const KINDS = Object.keys(STATE_CHIP) as StateChipKind[]
const SUCCESS_WORDS = /확인됨|완료|성공|게시됨|발송됨|연결됨/

describe('공통 5상태 UI (ANI-1669)', () => {
  describe('Given 데이터를 불러오는 중일 때', () => {
    it('Then busy 상태로 알리고 children 은 보이지 않는다', () => {
      const { container } = render(<StateView kind="loading"><p>숫자 12</p></StateView>)
      expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
      expect(screen.queryByText('숫자 12')).toBeNull()
    })
  })

  describe('Given 일부만 불러온 상태일 때', () => {
    it('Then 확인된 내용은 유지하고 "일부만" 배너와 확인 시각을 함께 보인다', () => {
      render(<StateView kind="partial" checkedAt="2026-10-22T07:40:00Z"><p>확인된 3건</p></StateView>)
      expect(screen.getByText('확인된 3건')).toBeTruthy()
      expect(screen.getByText('일부만 불러왔어요')).toBeTruthy()
      expect(screen.getByRole('status').textContent).toMatch(/확인/)
    })
  })

  describe('Given 이전에 확인한 내용일 때', () => {
    it('Then 이전 내용에 "최신 아님"을 알리고 시각이 없으면 시각을 꾸며내지 않는다', () => {
      const { container } = render(<StateView kind="stale"><p>지난 내용</p></StateView>)
      expect(screen.getByText('이전에 확인한 내용이에요')).toBeTruthy()
      expect(container.querySelector('time')).toBeNull()
    })
  })

  describe('Given 확인에 실패했을 때', () => {
    it('Then 0건/빈 목록으로 위장하지 않고 alert 와 재시도 행동을 보인다', () => {
      render(<StateView kind="error" action={<button>다시 확인</button>}><p>0건</p></StateView>)
      expect(screen.getByRole('alert')).toBeTruthy()
      expect(screen.queryByText('0건')).toBeNull()
      expect(screen.queryByText('아직 아무것도 없어요')).toBeNull()
      expect(screen.getByRole('button', { name: '다시 확인' })).toBeTruthy()
    })
  })

  describe('Given 네트워크가 끊겼을 때', () => {
    it('Then 서버에서 다시 확인해야 한다는 정직한 문구만 보이고 children 은 숨긴다', () => {
      render(<StateView kind="offline"><p>최신 매출</p></StateView>)
      expect(screen.getByText('마지막 확인 내용은 서버에서 다시 확인해야 합니다.')).toBeTruthy()
      expect(screen.queryByText('최신 매출')).toBeNull()
    })
  })

  describe('StateChip — 가짜 성공 금지', () => {
    it.each(KINDS)('%s 칩은 글자로 상태를 말하고 성공 어휘를 쓰지 않는다', (kind) => {
      const { container } = render(<StateChip kind={kind} />)
      expect(container.querySelector(`[data-state-chip="${kind}"]`)).toBeTruthy()
      expect(container.textContent).toBe(STATE_CHIP[kind].label)
      expect(container.textContent).not.toMatch(SUCCESS_WORDS)
    })
    it('5상태의 라벨은 서로 다르다', () => {
      expect(new Set(KINDS.map((k) => STATE_CHIP[k].label)).size).toBe(5)
    })
    it('아이콘은 장식(aria-hidden)이다', () => {
      const { container } = render(<StateChip kind="error" />)
      expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    })
  })
})
