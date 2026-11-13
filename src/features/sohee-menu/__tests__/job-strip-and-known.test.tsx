import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildGrowthSnapshot } from '@/features/sohee-growth/snapshot'
import { EMPTY, FULL, PARTIAL } from '@/features/sohee-growth/__tests__/fixtures'
import { JobUnlockStrip } from '../components/job-unlock-strip'
import { KnownBusinessCard } from '../components/known-business-card'

describe('JobUnlockStrip', () => {
  it('업무 6개를 카드로 보여준다', () => {
    const snap = buildGrowthSnapshot(PARTIAL)
    render(<JobUnlockStrip jobs={snap.jobs} onGoToTab={vi.fn()} />)
    const list = screen.getByRole('list', { name: '소희가 할 수 있는 일' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(6)
  })

  it('상태 칩과 한 줄 안내를 보여준다 (정식회원·일부만 가르침)', () => {
    const snap = buildGrowthSnapshot(PARTIAL)
    render(<JobUnlockStrip jobs={snap.jobs} onGoToTab={vi.fn()} />)
    const post = screen.getByText('인스타·스레드 게시').closest('li')!
    expect(within(post).getByText('준비 중')).toBeInTheDocument()
    expect(within(post).getByText('이미지 스타일 정하기')).toBeInTheDocument()
    const kakao = screen.getByText('카카오톡 1:1 상담').closest('li')!
    expect(within(kakao).getAllByText('곧 열려요').length).toBeGreaterThan(0)
  })

  it('모두 가르친 정식회원: 가능 / 미리보기만 가능', () => {
    const snap = buildGrowthSnapshot(FULL)
    render(<JobUnlockStrip jobs={snap.jobs} onGoToTab={vi.fn()} />)
    expect(within(screen.getByText('인스타·스레드 게시').closest('li')!).getByText('가능')).toBeInTheDocument()
    expect(within(screen.getByText('블로그 글 작성').closest('li')!).getByText('미리보기만 가능')).toBeInTheDocument()
  })

  it('체험회원은 잠긴 업무에 "정식회원 전용"과 "정식회원이 되면 열려요"를 보여준다', () => {
    const snap = buildGrowthSnapshot({ ...FULL, tier: 'TRIAL' })
    render(<JobUnlockStrip jobs={snap.jobs} onGoToTab={vi.fn()} />)
    const reply = screen.getByText('댓글 답변').closest('li')!
    expect(within(reply).getByText('정식회원 전용')).toBeInTheDocument()
    expect(within(reply).getByText('정식회원이 되면 열려요')).toBeInTheDocument()
  })

  it('가르치면 열리는 업무 카드의 "이것만 가르치면 열려요" 버튼을 누르면 가르칠 곳으로 보낸다', () => {
    const onGoToTab = vi.fn()
    const snap = buildGrowthSnapshot(EMPTY)
    render(<JobUnlockStrip jobs={snap.jobs} onGoToTab={onGoToTab} />)
    fireEvent.click(within(screen.getByText('인스타·스레드 게시').closest('li')!).getByRole('button', { name: '이것만 가르치면 열려요' }))
    expect(onGoToTab).toHaveBeenCalledWith('teach') // 가장 먼저 필요한 일: 가게 정보 알려주기
  })

  it('정식회원 전용·곧 열려요 카드는 "이것만 가르치면 열려요" 버튼이 없다', () => {
    const onGoToTab = vi.fn()
    const snap = buildGrowthSnapshot({ ...FULL, tier: 'TRIAL' })
    render(<JobUnlockStrip jobs={snap.jobs} onGoToTab={onGoToTab} />)
    expect(within(screen.getByText('카카오톡 1:1 상담').closest('li')!).queryByRole('button', { name: '이것만 가르치면 열려요' })).not.toBeInTheDocument()
    expect(within(screen.getByText('댓글 답변').closest('li')!).queryByRole('button', { name: '이것만 가르치면 열려요' })).not.toBeInTheDocument()
  })

  it('카드의 "자세히 보기"를 누르면 업무 상세 시트가 열리고, 가르치러 가기 클릭 시 닫히며 이동한다', () => {
    const onGoToTab = vi.fn()
    const snap = buildGrowthSnapshot(EMPTY)
    render(<JobUnlockStrip jobs={snap.jobs} onGoToTab={onGoToTab} />)

    const postItem = screen.getByText('인스타·스레드 게시').closest('li')!
    const detailButton = within(postItem).getByRole('button', { name: '자세히 보기' })
    fireEvent.click(detailButton)

    // 시트가 열리고 제목과 상세 내용이 보여야 한다
    expect(screen.getByRole('heading', { name: '인스타·스레드 게시' })).toBeInTheDocument()
    expect(screen.getByText('가게 소식과 상품을 인스타그램·스레드 글로 만들어 올려요')).toBeInTheDocument()

    // 미완료 요건의 "가르치러 가기" 버튼 클릭 시 이동 후 시트가 닫힘
    const teachButtons = screen.getAllByRole('button', { name: /가르치러 가기/ })
    expect(teachButtons.length).toBeGreaterThan(0)
    fireEvent.click(teachButtons[0])

    expect(onGoToTab).toHaveBeenCalledWith('teach')
    // 시트가 닫혔으므로 제목이 사라짐
    expect(screen.queryByRole('heading', { name: '인스타·스레드 게시' })).not.toBeInTheDocument()
  })
})

describe('KnownBusinessCard', () => {
  it('6개 항목의 이름과 진행률을 보여준다', () => {
    const snap = buildGrowthSnapshot(PARTIAL)
    render(<KnownBusinessCard categories={snap.categories} nextStep={snap.nextStep} />)
    expect(screen.getByRole('heading', { name: '소희가 아는 우리 가게' })).toBeInTheDocument()
    expect(screen.getByText('가게·상품·가격')).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(screen.getAllByRole('progressbar')).toHaveLength(6)
  })

  it('다음에 가르칠 것을 강조한다', () => {
    const snap = buildGrowthSnapshot(PARTIAL)
    render(<KnownBusinessCard categories={snap.categories} nextStep={snap.nextStep} />)
    expect(screen.getByText('다음으로 가르칠 것')).toBeInTheDocument()
    expect(screen.getByText('이미지 스타일 정하기')).toBeInTheDocument()
  })

  it('다음 할 일이 없으면 강조 영역을 숨긴다', () => {
    const snap = buildGrowthSnapshot(FULL)
    render(<KnownBusinessCard categories={snap.categories} nextStep={snap.nextStep} />)
    expect(screen.queryByText('다음으로 가르칠 것')).not.toBeInTheDocument()
  })
})
