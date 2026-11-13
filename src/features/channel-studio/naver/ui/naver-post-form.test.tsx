import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NaverPostForm } from './naver-post-form'

describe('NaverPostForm', () => {
  const defaultProps = {
    categories: [],
    onSubmit: vi.fn(),
    isNaverConnected: true,
  }

  it('renders close button when onClose is provided and triggers callback on click', () => {
    const onClose = vi.fn()
    render(<NaverPostForm {...defaultProps} onClose={onClose} />)
    const closeBtn = screen.getByRole('button', { name: '닫기' })
    expect(closeBtn).toBeInTheDocument()
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalled()
  })

  it('renders topic input and photo counts without credit notes or SC costs, and does not render photo source block', () => {
    render(<NaverPostForm {...defaultProps} initialPhotoSource="ai" />)

    expect(screen.getByLabelText(/주제/)).toBeInTheDocument()
    expect(screen.getByText('0/300')).toBeInTheDocument()
    // Stepper shows default 4
    const spinbutton = screen.getByRole('spinbutton', { name: '사진 장수' })
    expect(spinbutton).toHaveAttribute('aria-valuenow', '4')
    expect(screen.getByRole('button', { name: '소희에게 글 쓰기 맡기기' })).toBeInTheDocument()

    // Does NOT render credits, SC, or needed credit notes
    expect(screen.queryAllByText(/크레딧/)).toHaveLength(0)
    expect(screen.queryAllByText(/SC/)).toHaveLength(0)
    expect(screen.queryAllByText(/\(필요/)).toHaveLength(0)

    // Does NOT render photo source selection block
    expect(screen.queryByText('사진 출처')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /네이버 지도 실제 사진/ })).not.toBeInTheDocument()

    // Does NOT render scheduled publish or visibility options that mislead users into expecting auto-posting
    expect(screen.queryByText('예약 발행')).not.toBeInTheDocument()
    expect(screen.queryByText('발행 시점')).not.toBeInTheDocument()
    expect(screen.queryByText('공개 범위')).not.toBeInTheDocument()
    expect(screen.queryByText('자동등록')).not.toBeInTheDocument()
    expect(screen.queryByText('대신 올리기')).not.toBeInTheDocument()
  })

  it('validates empty topic on submit and shows inline error', () => {
    const onSubmit = vi.fn()
    render(<NaverPostForm {...defaultProps} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: '소희에게 글 쓰기 맡기기' }))

    expect(screen.getByText('주제를 입력해 주세요.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('allows changing photo count via stepper and quick select chips without displaying credit costs', () => {
    render(<NaverPostForm {...defaultProps} initialPhotoSource="ai" />)

    const plusBtn = screen.getByRole('button', { name: '사진 장수 늘리기' })
    fireEvent.click(plusBtn)

    const spinbutton = screen.getByRole('spinbutton', { name: '사진 장수' })
    expect(spinbutton).toHaveAttribute('aria-valuenow', '5')
    expect(screen.getByText('현재 사진 장수: 5장')).toBeInTheDocument()

    // Quick chip (6장)
    const chip6 = screen.getByRole('button', { name: '6장' })
    fireEvent.click(chip6)
    expect(chip6).toHaveAttribute('aria-pressed', 'true')
    expect(spinbutton).toHaveAttribute('aria-valuenow', '6')

    // At 6장, credit alerts must NOT be shown
    expect(screen.queryAllByText(/크레딧/)).toHaveLength(0)
    expect(screen.queryAllByText(/SC/)).toHaveLength(0)
    expect(screen.queryAllByText(/\(필요/)).toHaveLength(0)
  })

  it('renders notice instead of category select or connection guide regardless of categories prop', () => {
    const categories = [
      { id: 'cat-1', name: '공지', parentId: null },
      { id: 'cat-2', name: '이벤트', parentId: 'cat-1' },
    ]
    const { rerender } = render(<NaverPostForm {...defaultProps} categories={[]} />)

    expect(
      screen.getByText('카테고리와 공개 범위는 네이버 글쓰기 화면에서 직접 선택해요.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '카테고리' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('카테고리')).not.toBeInTheDocument()
    expect(
      screen.queryByText('네이버 카테고리는 네이버 연결을 확인하면 불러올 수 있어요.'),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '연결 확인하기' })).not.toBeInTheDocument()

    // Even when categories are provided, dropdown should NOT be shown
    rerender(<NaverPostForm {...defaultProps} categories={categories} />)
    expect(screen.queryByRole('combobox', { name: '카테고리' })).not.toBeInTheDocument()
    expect(
      screen.getByText('카테고리와 공개 범위는 네이버 글쓰기 화면에서 직접 선택해요.'),
    ).toBeInTheDocument()
  })

  it('renders recommended topic badge as 추천 without 1위 keyword', () => {
    render(<NaverPostForm {...defaultProps} />)

    expect(screen.getByText('추천')).toBeInTheDocument()
    expect(screen.queryByText(/1위/)).not.toBeInTheDocument()
  })

  it('submits form data with valid topic without scheduledAt or auto-publish options', () => {
    const onSubmit = vi.fn()
    render(<NaverPostForm {...defaultProps} onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText(/주제/), {
      target: { value: '가을철 피부관리 노하우' },
    })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 글 쓰기 맡기기' }))

    expect(onSubmit).toHaveBeenCalledWith({
      topic: '가을철 피부관리 노하우',
      imageCount: 4,
      photoSource: 'ai',
      visibility: 'public',
      categoryId: null,
      reaction: 'inquiry',
      imageStyle: 'bright_space',
    })
  })

  it('selects recommended topic card and auto configures topic and photo count', () => {
    const onSubmit = vi.fn()
    render(<NaverPostForm {...defaultProps} onSubmit={onSubmit} categories={[{ id: '1', name: '파인드케이', parentId: null }]} />)

    // Click first recommended topic card (default: 우리 매장)
    const card = screen.getByText('우리 매장의 정성스러운 공간과 이야기')
    fireEvent.click(card)

    expect(screen.getByRole('button', { name: '3장' })).toHaveAttribute('aria-pressed', 'true')

    // Submit
    fireEvent.click(screen.getByRole('button', { name: '소희에게 글 쓰기 맡기기' }))

    expect(onSubmit).toHaveBeenCalledWith({
      topic: '우리 매장의 일상과 정성스러운 매장 공간 및 철학 이야기 (가격 할인 이벤트 쿠폰 무료 혜택 영업시간 효과 치료 최고 단어 제외)',
      imageCount: 3,
      photoSource: 'ai',
      visibility: 'public',
      categoryId: null,
      reaction: 'inquiry',
      imageStyle: 'bright_space',
    })
  })

  it('customizes recommended topic cards dynamically based on businessProfile', () => {
    render(
      <NaverPostForm
        {...defaultProps}
        businessProfile={{ businessName: '청라 카페 라온', industry: '디저트 카페' }}
      />,
    )

    expect(screen.getByText('청라 카페 라온의 정성스러운 공간과 이야기')).toBeInTheDocument()
    expect(screen.getByText('디저트 카페 전문가가 전하는 일상 팁 노하우')).toBeInTheDocument()
    expect(screen.getByText('처음 방문하시는 분들을 위한 청라 카페 라온 맞춤 안내')).toBeInTheDocument()
  })

  it('renders post format cards and allows selecting a format module with stepper and quick chips', () => {
    const onSubmit = vi.fn()
    render(<NaverPostForm {...defaultProps} onSubmit={onSubmit} />)

    // 토글 스위치는 제거되고 형식 카드 목록이 존재함
    expect(screen.queryByRole('switch', { name: /사진 위주 글\(포토스토리\)/ })).not.toBeInTheDocument()

    // 기본 선택은 정보형
    const infoCard = screen.getByRole('radio', { name: /정보형/ })
    expect(infoCard).toHaveAttribute('aria-checked', 'true')

    // 정보형 범위 내 빠른 선택 칩 (3장, 6장)
    expect(screen.getByRole('button', { name: '3장' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '6장' })).toBeInTheDocument()

    // 포토스토리 카드 선택
    const photoStoryCard = screen.getByRole('radio', { name: /포토스토리/ })
    fireEvent.click(photoStoryCard)
    expect(photoStoryCard).toHaveAttribute('aria-checked', 'true')

    // 포토스토리 범위 내 빠른 선택 칩 (10장, 15장)
    expect(screen.getByRole('button', { name: '10장' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '15장' })).toBeInTheDocument()

    // 15장 칩 선택 후 제출
    fireEvent.click(screen.getByRole('button', { name: '15장' }))
    expect(screen.getByRole('button', { name: '15장' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.change(screen.getByLabelText(/주제/), {
      target: { value: '포토스토리 일상' },
    })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 글 쓰기 맡기기' }))

    expect(onSubmit).toHaveBeenCalledWith({
      topic: '포토스토리 일상',
      imageCount: 15,
      photoSource: 'ai',
      visibility: 'public',
      categoryId: null,
      postMode: 'photo_story',
      reaction: 'inquiry',
      imageStyle: 'bright_space',
    })

    // 다시 정보형으로 변경 시 postMode는 information이므로 제출 시 생략됨
    fireEvent.click(infoCard)
    expect(infoCard).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getByRole('button', { name: '소희에게 글 쓰기 맡기기' }))
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ postMode: expect.anything() }),
    )
  })

  it('maintains user-selected image count within format range, and resets to default when not user selected', () => {
    render(<NaverPostForm {...defaultProps} />)

    // 정보형에서 3장 칩 선택 (사용자 직접 선택)
    fireEvent.click(screen.getByRole('button', { name: '3장' }))
    const spinbutton = screen.getByRole('spinbutton', { name: '사진 장수' })
    expect(spinbutton).toHaveAttribute('aria-valuenow', '3')

    // 포토스토리(min 1, max 20, default 12)로 전환 시 3장은 [1, 20] 범위 안이므로 유지!
    fireEvent.click(screen.getByRole('radio', { name: /포토스토리/ }))
    expect(spinbutton).toHaveAttribute('aria-valuenow', '3')

    // 10장 칩 선택
    fireEvent.click(screen.getByRole('button', { name: '10장' }))
    expect(spinbutton).toHaveAttribute('aria-valuenow', '10')

    // 과정 소개형(min 1, max 20, default 6)으로 전환 시에도 10장은 [1, 20] 안이므로 10장 유지
    fireEvent.click(screen.getByRole('radio', { name: /과정 소개형/ }))
    expect(spinbutton).toHaveAttribute('aria-valuenow', '10')
  })

  it('automatically switches photoSource to place when store_photo image style is selected', () => {
    const onSubmit = vi.fn()
    render(
      <NaverPostForm
        {...defaultProps}
        onSubmit={onSubmit}
        initialPhotoSource="ai"
        placePhotosAvailable={true}
      />,
    )

    // 이미지 연출 스타일 중 '우리 매장 실제 사진' 선택
    const storePhotoChip = screen.getByRole('radio', { name: /우리 매장 실제 사진/ })
    fireEvent.click(storePhotoChip)

    expect(storePhotoChip).toHaveAttribute('aria-checked', 'true')

    fireEvent.change(screen.getByLabelText(/주제/), {
      target: { value: '매장 사진 주제' },
    })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 글 쓰기 맡기기' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        photoSource: 'place',
        imageStyle: 'store_photo',
      }),
    )
  })

  it('allows selecting reaction module and updates bottom summary line', () => {
    render(<NaverPostForm {...defaultProps} />)

    // 초기 요약 라인: "정보형 · 사진 4장 · 문의·상담 유도"
    expect(screen.getByText('정보형 · 사진 4장 · 문의·상담 유도')).toBeInTheDocument()

    // 스텝퍼로 사진 5장으로 증가
    fireEvent.click(screen.getByRole('button', { name: '사진 장수 늘리기' }))
    expect(screen.getByText('정보형 · 사진 5장 · 문의·상담 유도')).toBeInTheDocument()

    // 독자 반응 '방문 유도' 선택
    const visitChip = screen.getByRole('radio', { name: /방문 유도/ })
    fireEvent.click(visitChip)
    expect(visitChip).toHaveAttribute('aria-checked', 'true')

    expect(screen.getByText('정보형 · 사진 5장 · 방문 유도')).toBeInTheDocument()

    // 형식 '비교형' 선택 (5장은 비교형 min 3 ~ max 6 안이므로 5장 유지)
    fireEvent.click(screen.getByRole('radio', { name: /비교형/ }))
    expect(screen.getByText('비교형 · 사진 5장 · 방문 유도')).toBeInTheDocument()
  })

  it('honors initialPostMode prop and configures corresponding count options and default count', () => {
    render(<NaverPostForm {...defaultProps} initialPostMode="process" />)

    const processCard = screen.getByRole('radio', { name: /과정 소개형/ })
    expect(processCard).toHaveAttribute('aria-checked', 'true')

    // 과정 소개형 (min 1, max 20, default 6)
    const spinbutton = screen.getByRole('spinbutton', { name: '사진 장수' })
    expect(spinbutton).toHaveAttribute('aria-valuenow', '6')
    expect(spinbutton).toHaveAttribute('aria-valuemin', '1')
    expect(spinbutton).toHaveAttribute('aria-valuemax', '20')

    // 빠른 선택 칩 1, 3, 6, 10, 15, 20 모두 1~20 안
    expect(screen.getByRole('button', { name: '1장' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '3장' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '6장' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '10장' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '15장' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '20장' })).toBeInTheDocument()
  })

  it('enforces stepper boundary conditions: min disables decrement and max disables increment', () => {
    // photo_story: min 1, max 20, default 12
    render(<NaverPostForm {...defaultProps} initialPostMode="photo_story" />)

    const decBtn = screen.getByRole('button', { name: '사진 장수 줄이기' })
    const incBtn = screen.getByRole('button', { name: '사진 장수 늘리기' })
    const spinbutton = screen.getByRole('spinbutton', { name: '사진 장수' })

    // default is 12
    expect(spinbutton).toHaveAttribute('aria-valuenow', '12')
    expect(decBtn).not.toBeDisabled()
    expect(incBtn).not.toBeDisabled()

    // Quick chip to 20 (max)
    fireEvent.click(screen.getByRole('button', { name: '20장' }))
    expect(spinbutton).toHaveAttribute('aria-valuenow', '20')
    expect(incBtn).toBeDisabled()
    expect(decBtn).not.toBeDisabled()

    // Quick chip to 1 (min)
    fireEvent.click(screen.getByRole('button', { name: '1장' }))
    expect(spinbutton).toHaveAttribute('aria-valuenow', '1')
    expect(decBtn).toBeDisabled()
    expect(incBtn).not.toBeDisabled()
  })

  it('resets to new format imageDefault when format changes if user has NOT manually chosen count', () => {
    render(<NaverPostForm {...defaultProps} />)

    // Initially information default is 4
    const spinbutton = screen.getByRole('spinbutton', { name: '사진 장수' })
    expect(spinbutton).toHaveAttribute('aria-valuenow', '4')

    // User does NOT change count, just switches format to photo_story (default 12)
    fireEvent.click(screen.getByRole('radio', { name: /포토스토리/ }))
    expect(spinbutton).toHaveAttribute('aria-valuenow', '12')

    // Switch to process (default 6)
    fireEvent.click(screen.getByRole('radio', { name: /과정 소개형/ }))
    expect(spinbutton).toHaveAttribute('aria-valuenow', '6')
  })

  it('displays credit awareness alerts across 3 ranges without numbers, and suppresses for place photoSource', () => {
    render(
      <NaverPostForm
        {...defaultProps}
        initialPostMode="photo_story"
        initialPhotoSource="ai"
        placePhotosAvailable={true}
      />,
    )

    // Range 1 (<= 6): switch to information (default 4)
    fireEvent.click(screen.getByRole('radio', { name: /정보형/ }))
    expect(screen.queryByText(/크레딧이/)).not.toBeInTheDocument()

    // Range 2 (7~12): switch to photo_story (default 12)
    fireEvent.click(screen.getByRole('radio', { name: /포토스토리/ }))
    expect(screen.getByText('사진이 많을수록 크레딧이 더 많이 사용돼요.')).toBeInTheDocument()
    // Must NOT contain any numbers
    expect(screen.queryByText(/\d+\s*(크레딧|SC|원)/)).not.toBeInTheDocument()

    // Range 3 (13~20): select 15
    fireEvent.click(screen.getByRole('button', { name: '15장' }))
    expect(
      screen.getByText('사진을 많이 만들수록 크레딧이 많이 사용돼요. 꼭 필요한 장수만 골라 주세요.'),
    ).toBeInTheDocument()
    // Still no credit numbers
    expect(screen.queryByText(/\d+\s*(크레딧|SC|원)/)).not.toBeInTheDocument()

    // When store_photo is selected (photoSource becomes place), credit alerts are suppressed and replaced by free note without numbers
    const storePhotoRadio = screen.getByRole('radio', { name: /우리 매장 실제 사진/ })
    fireEvent.click(storePhotoRadio)

    expect(screen.queryByText('사진을 많이 만들수록 크레딧이 많이 사용돼요. 꼭 필요한 장수만 골라 주세요.')).not.toBeInTheDocument()
    expect(screen.queryByText('사진이 많을수록 크레딧이 더 많이 사용돼요.')).not.toBeInTheDocument()
    expect(screen.getByText('매장 사진은 크레딧이 들지 않아요.')).toBeInTheDocument()
    expect(screen.queryByText(/\d+\s*(크레딧|SC|원)/)).not.toBeInTheDocument()
  })

  it('supports keyboard navigation on spinbutton (ArrowUp, ArrowDown, Home, End)', () => {
    render(<NaverPostForm {...defaultProps} />)

    const spinbutton = screen.getByRole('spinbutton', { name: '사진 장수' })
    expect(spinbutton).toHaveAttribute('aria-valuenow', '4')

    fireEvent.keyDown(spinbutton, { key: 'ArrowUp' })
    expect(spinbutton).toHaveAttribute('aria-valuenow', '5')

    fireEvent.keyDown(spinbutton, { key: 'ArrowDown' })
    expect(spinbutton).toHaveAttribute('aria-valuenow', '4')

    fireEvent.keyDown(spinbutton, { key: 'End' })
    // max is 20
    expect(spinbutton).toHaveAttribute('aria-valuenow', '20')

    fireEvent.keyDown(spinbutton, { key: 'Home' })
    // min is 1
    expect(spinbutton).toHaveAttribute('aria-valuenow', '1')
  })

  it('maintains touch targets of at least 44px for buttons and chips and avoids font sizes below 12px', () => {
    const { container } = render(<NaverPostForm {...defaultProps} />)

    // 모든 버튼 및 라디오 요소의 min-h-[44px] 또는 min-h-[48px] 확인
    const clickableElements = container.querySelectorAll('button[role="radio"], button[aria-pressed], button[type="submit"]')
    clickableElements.forEach((el) => {
      const className = el.className
      const hasSufficientHeight =
        className.includes('min-h-[44px]') ||
        className.includes('min-h-[48px]') ||
        className.includes('py-2.5') ||
        className.includes('p-3')
      expect(hasSufficientHeight).toBe(true)
    })

    // 12px 미만 클래스(text-[10px], text-[11px]) 없음 검증
    expect(container.innerHTML).not.toContain('text-[10px]')
    expect(container.innerHTML).not.toContain('text-[11px]')
  })

  it('renders "추천 N장" badge for each post format card instead of "사진 1~20장"', () => {
    render(<NaverPostForm {...defaultProps} />)

    // 7개 글 형식 각각의 추천 기본 장수 배지 확인
    expect(screen.queryByText('사진 1~20장')).not.toBeInTheDocument()
    expect(screen.getAllByText('추천 4장').length).toBeGreaterThanOrEqual(4) // 정보형, FAQ형, 비교형, 상담형
    expect(screen.getByText('추천 12장')).toBeInTheDocument() // 포토스토리
    expect(screen.getByText('추천 6장')).toBeInTheDocument() // 과정 소개형
    expect(screen.getByText('추천 8장')).toBeInTheDocument() // 공간 둘러보기
  })

  it('disables store_photo card with aria-disabled and shows hint when placePhotosAvailable is false (default)', () => {
    const onSubmit = vi.fn()
    render(<NaverPostForm {...defaultProps} onSubmit={onSubmit} placePhotosAvailable={false} />)

    const storePhotoBtn = screen.getByRole('radio', { name: /우리 매장 실제 사진/ })
    expect(storePhotoBtn).toHaveAttribute('aria-disabled', 'true')
    expect(storePhotoBtn).toBeDisabled()
    expect(screen.getByText('연동된 매장 사진이 아직 없어요')).toBeInTheDocument()

    // Clicking disabled store_photo should not select it
    fireEvent.click(storePhotoBtn)
    expect(storePhotoBtn).toHaveAttribute('aria-checked', 'false')

    fireEvent.change(screen.getByLabelText(/주제/), { target: { value: '테스트 주제' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 글 쓰기 맡기기' }))

    // photoSource should remain 'ai'
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        photoSource: 'ai',
        imageStyle: 'bright_space',
      }),
    )
  })

  it('corrects initialPhotoSource="place" to ai style when placePhotosAvailable is false, and uses store_photo when true', () => {
    const onSubmit = vi.fn()

    // 1. placePhotosAvailable = false -> fallback to AI
    const { unmount } = render(
      <NaverPostForm
        {...defaultProps}
        onSubmit={onSubmit}
        initialPhotoSource="place"
        placePhotosAvailable={false}
      />,
    )

    fireEvent.change(screen.getByLabelText(/주제/), { target: { value: '보정 테스트' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 글 쓰기 맡기기' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        photoSource: 'ai',
        imageStyle: 'bright_space',
      }),
    )
    unmount()

    // 2. placePhotosAvailable = true -> honors place
    onSubmit.mockClear()
    render(
      <NaverPostForm
        {...defaultProps}
        onSubmit={onSubmit}
        initialPhotoSource="place"
        placePhotosAvailable={true}
      />,
    )

    const storePhotoBtn = screen.getByRole('radio', { name: /우리 매장 실제 사진/ })
    expect(storePhotoBtn).toHaveAttribute('aria-checked', 'true')

    fireEvent.change(screen.getByLabelText(/주제/), { target: { value: '플레이스 유지 테스트' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 글 쓰기 맡기기' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        photoSource: 'place',
        imageStyle: 'store_photo',
      }),
    )
  })

  it('renders "소희 추천 글감" title without exaggerated "원클릭 완성" phrase', () => {
    render(<NaverPostForm {...defaultProps} />)

    expect(screen.getByText('소희 추천 글감')).toBeInTheDocument()
    expect(screen.queryByText(/원클릭 완성/)).not.toBeInTheDocument()
    expect(screen.queryByText(/소희 추천 블로그 글감/)).not.toBeInTheDocument()
  })

  it('displays selected module summary line under mobile chip groups for format, image style, and reaction', () => {
    const { container } = render(<NaverPostForm {...defaultProps} />)

    // 모바일 전용 그룹 하단 설명 요소 (.sm:hidden) 3개 검증
    const mobileSummaries = container.querySelectorAll('.sm\\:hidden.text-xs')
    expect(mobileSummaries.length).toBeGreaterThanOrEqual(3)

    // 1. 글 형태 기본: 정보형 요약
    expect(
      screen.getAllByText('핵심 팁과 정보를 깊이 있게 전달하는 표준 글').length,
    ).toBeGreaterThanOrEqual(2)

    // 2. 이미지 스타일 기본: 밝은 공간 요약
    expect(
      screen.getAllByText('자연광이 가득하고 깔끔하며 쾌적한 매장 공간 연출').length,
    ).toBeGreaterThanOrEqual(2)

    // 3. 독자 반응 기본: 문의·상담 유도 요약
    expect(
      screen.getAllByText('자연스러운 질문이나 궁금한 점을 편하게 남기도록 안내').length,
    ).toBeGreaterThanOrEqual(2)

    // 독자 반응 변경 시 갱신 확인
    fireEvent.click(screen.getByRole('radio', { name: /방문 유도/ }))
    expect(
      screen.getAllByText('매장의 위치와 따뜻한 분위기를 전해 직접 발걸음하도록 유도').length,
    ).toBeGreaterThanOrEqual(2)
  })
})
