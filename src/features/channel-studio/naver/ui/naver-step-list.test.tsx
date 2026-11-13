import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NaverStep } from '../naver-step-sequence'
import { NaverStepList } from './naver-step-list'

describe('NaverStepList', () => {
  const steps: readonly NaverStep[] = [
    { type: 'title', text: '테스트 제목' },
    {
      type: 'text',
      segmentIndex: 1,
      segmentCount: 2,
      heading: '첫 번째 소제목',
      text: '첫 번째 본문 텍스트입니다.',
    },
    {
      type: 'image',
      photoIndex: 1,
      mediaId: 'img-1',
      src: 'https://example.com/1.jpg',
      alt: '시술 전 사진',
      positionHint: '위 글을 붙여넣은 다음 사진 1을 넣어 주세요',
    },
    {
      type: 'text',
      segmentIndex: 2,
      segmentCount: 2,
      heading: undefined,
      text: '두 번째 본문 텍스트입니다.',
    },
    {
      type: 'tags',
      text: '#청라 #피부관리',
      count: 2,
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}))
  })

  it('steps를 번호 매긴 체크리스트로 렌더링하고 초기 진행률(0/5 완료)을 표시한다', () => {
    render(<NaverStepList steps={steps} postMode="information" />)

    expect(screen.getByText(/0\/5 완료/)).toBeInTheDocument()

    // 1. 제목 복사
    expect(screen.getByRole('button', { name: '제목 복사' })).toBeInTheDocument()

    // 2. 본문 1/2 복사
    expect(screen.getByRole('button', { name: '본문 1/2 복사' })).toBeInTheDocument()
    expect(screen.getByText('첫 번째 소제목')).toBeInTheDocument()

    // 3. 사진 1 저장
    expect(screen.getByText('위 글을 붙여넣은 다음 사진 1을 넣어 주세요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /사진 1 저장/ })).toBeInTheDocument()

    // 4. 본문 2/2 복사
    expect(screen.getByRole('button', { name: '본문 2/2 복사' })).toBeInTheDocument()

    // 5. 태그 2개 복사
    expect(screen.getByRole('button', { name: '태그 2개 복사' })).toBeInTheDocument()

    // 1~5단계 번호 배지 접근성 aria-label 확인 및 원문자 미사용 확인
    expect(screen.getByLabelText('1단계')).toBeInTheDocument()
    expect(screen.getByLabelText('2단계')).toBeInTheDocument()
    expect(screen.getByLabelText('3단계')).toBeInTheDocument()
    expect(screen.getByLabelText('4단계')).toBeInTheDocument()
    expect(screen.getByLabelText('5단계')).toBeInTheDocument()
    expect(screen.queryByText(/①|②|③|④|⑤/)).not.toBeInTheDocument()
  })

  it('체크박스를 클릭하면 완료 상태가 토글되고 진행률이 갱신된다', () => {
    render(<NaverStepList steps={steps} postMode="information" />)

    const checkButtons = screen.getAllByRole('checkbox', { name: /단계 \d/ })
    expect(checkButtons).toHaveLength(5)

    // 첫 번째 단계 체크
    fireEvent.click(checkButtons[0])
    expect(screen.getByText(/1\/5 완료/)).toBeInTheDocument()
    expect(checkButtons[0]).toBeChecked()

    // 다시 클릭하여 해제
    fireEvent.click(checkButtons[0])
    expect(screen.getByText(/0\/5 완료/)).toBeInTheDocument()
    expect(checkButtons[0]).not.toBeChecked()
  })

  it('제목 복사 버튼을 누르면 클립보드에 복사되고 해당 단계가 완료 체크된다', async () => {
    render(<NaverStepList steps={steps} postMode="information" />)

    const copyBtn = screen.getByRole('button', { name: '제목 복사' })
    fireEvent.click(copyBtn)

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('테스트 제목')
    // 복사 성공 비동기 완료 대기
    expect(await screen.findByText(/1\/5 완료/)).toBeInTheDocument()
    const checkButtons = screen.getAllByRole('checkbox', { name: /단계 \d/ })
    expect(checkButtons[0]).toBeChecked()
  })

  it('발행 직전 확인 카드에 postMode에 맞는 추천 정보와 필수 경고 박스를 표시한다', () => {
    render(<NaverStepList steps={steps} postMode="faq" />)

    // 카테고리 추천: faq -> '자주 묻는 질문'
    expect(screen.getByText('자주 묻는 질문')).toBeInTheDocument()

    // 공개 설정: '전체공개 권장'
    expect(screen.getByText('전체공개 권장')).toBeInTheDocument()

    // 대표(썸네일) 사진: '사진 1'
    expect(screen.getByText('사진 1')).toBeInTheDocument()

    // 태그 안내: '태그 입력 칸에 붙여넣기'
    expect(screen.getByText('태그 입력 칸에 붙여넣기')).toBeInTheDocument()

    // 경고 박스 2대 필수 문구
    expect(
      screen.getByText('네이버 앱에서 [등록]을 누르면 바로 발행돼요. 먼저 [저장]으로 임시저장해 확인하세요.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/복사나 저장만으로 게시되지 않아요/),
    ).toBeInTheDocument()
  })

  it('모든 액션 버튼은 모바일 터치 영역 min-h-11을 만족한다', () => {
    render(<NaverStepList steps={steps} postMode="consultation" />)

    const titleBtn = screen.getByRole('button', { name: '제목 복사' })
    const body1Btn = screen.getByRole('button', { name: /본문 1\/2 복사/ })
    const photo1Btn = screen.getByRole('button', { name: /사진 1 저장/ })
    const tagBtn = screen.getByRole('button', { name: /태그 2개 복사/ })

    expect(titleBtn.className).toMatch(/min-h-11/)
    expect(body1Btn.className).toMatch(/min-h-11/)
    expect(photo1Btn.className).toMatch(/min-h-11/)
    expect(tagBtn.className).toMatch(/min-h-11/)
  })

  it('본문 구간의 소제목은 라벨로 1회만 표시되고 미리보기 본문에서는 첫 문단부터 보이며 복사 text에는 소제목이 유지된다', async () => {
    const heading = '첫 눈썹 반영구 상담 전, 나에게 맞는 기준 세우기'
    const paragraph = '나에게 꼭 맞는 시술 기준을 세우는 방법입니다.'
    const fullText = `${heading}\n\n${paragraph}`

    const stepsWithHeading: readonly NaverStep[] = [
      {
        type: 'text',
        segmentIndex: 1,
        segmentCount: 1,
        heading,
        text: fullText,
        previewText: paragraph,
      },
    ]

    render(<NaverStepList steps={stepsWithHeading} />)

    // 소제목 텍스트가 문서 전체에서 단 한 번만(라벨 배지로만) 렌더링되어야 함 (중복 노출 방지)
    const headingElements = screen.getAllByText(heading)
    expect(headingElements).toHaveLength(1)

    // 미리보기에는 첫 문단이 노출됨
    expect(screen.getByText(paragraph)).toBeInTheDocument()

    // 복사 버튼을 누르면 전체 텍스트(소제목 포함)가 복사되어야 함
    const copyButton = screen.getByRole('button', { name: '본문 1/1 복사' })
    fireEvent.click(copyButton)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(fullText)
  })

  it('21번 이상의 긴 단계(33단계 포토스토리 등)에서도 원문자나 괄호 대신 동일한 숫자 배지(n단계 aria-label)로 렌더링한다', () => {
    // 33단계 시뮬레이션: 1개 제목 + 16개 본문 + 15개 이미지 + 1개 태그 = 총 33단계
    const longSteps: NaverStep[] = [
      { type: 'title', text: '포토스토리 33단계 테스트' },
    ]
    for (let i = 1; i <= 15; i++) {
      longSteps.push({
        type: 'text',
        segmentIndex: i,
        segmentCount: 16,
        text: `본문 문단 ${i}`,
      })
      longSteps.push({
        type: 'image',
        photoIndex: i,
        mediaId: `photo-${i}`,
        src: `https://example.com/p${i}.jpg`,
        alt: `사진 ${i}`,
        positionHint: `사진 ${i} 위치`,
      })
    }
    longSteps.push({
      type: 'text',
      segmentIndex: 16,
      segmentCount: 16,
      text: '마지막 본문 문단 16',
    })
    longSteps.push({
      type: 'tags',
      text: '#포토스토리 #테스트',
      count: 2,
    })

    expect(longSteps).toHaveLength(33)

    render(<NaverStepList steps={longSteps} postMode="information" />)

    // 진행률 확인
    expect(screen.getByText('0/33 완료')).toBeInTheDocument()

    // 1단계, 20단계, 21단계, 33단계 모두 일관된 aria-label 배지로 존재
    expect(screen.getByLabelText('1단계')).toBeInTheDocument()
    expect(screen.getByLabelText('20단계')).toBeInTheDocument()
    expect(screen.getByLabelText('21단계')).toBeInTheDocument()
    expect(screen.getByLabelText('33단계')).toBeInTheDocument()

    // 21번 이상 단계에서 (21), (33) 같은 괄호 표기나 ①~⑳ 원문자가 제목/단계 라벨에 혼용되지 않음
    expect(screen.queryByText('(21)')).not.toBeInTheDocument()
    expect(screen.queryByText('(33)')).not.toBeInTheDocument()
    expect(screen.queryByText(/①|⑳/)).not.toBeInTheDocument()
  })
})
