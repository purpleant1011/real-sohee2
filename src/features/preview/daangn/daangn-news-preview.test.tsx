import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { currentSpec } from '@/features/vault/channel-spec'
import { DaangnNewsPreview } from './daangn-news-preview'
import type { DaangnNewsVariant } from './types'

describe('DaangnNewsPreview', () => {
  it('renders neutral profile structure without proprietary brand/logo assets', () => {
    const variant: DaangnNewsVariant = {
      text: '안녕하세요, 오늘의 소식입니다.',
      businessName: '우리동네 베이커리',
      timeLabel: '10분 전',
    }

    const { container } = render(<DaangnNewsPreview variant={variant} />)

    // 중립 상호명 및 메타 확인
    expect(screen.getByText('우리동네 베이커리')).toBeInTheDocument()
    expect(screen.getByText(/10분 전/)).toBeInTheDocument()
    const header = container.querySelector('header')!
    expect(within(header).getByText(/소식/)).toBeInTheDocument()

    // 당근 로고나 상표 이미지 자산 미포함 확인
    expect(container.querySelector('img[src*="daangn"]')).toBeNull()
    expect(container.querySelector('img[src*="karrot"]')).toBeNull()
  })

  it('renders first-line highlight and short paragraphs', () => {
    const variant: DaangnNewsVariant = {
      firstLineHighlight: '오늘 갓 구운 바게트가 나왔어요!',
      text: '천연 발효종으로 16시간 저온 숙성했습니다.\n\n한정 수량 30개만 준비되어 조기 마감될 수 있습니다.',
    }

    render(<DaangnNewsPreview variant={variant} />)

    const highlightEl = screen.getByLabelText('강조 문구')
    expect(highlightEl).toBeInTheDocument()
    expect(highlightEl).toHaveTextContent('오늘 갓 구운 바게트가 나왔어요!')

    expect(screen.getByText('천연 발효종으로 16시간 저온 숙성했습니다.')).toBeInTheDocument()
    expect(screen.getByText('한정 수량 30개만 준비되어 조기 마감될 수 있습니다.')).toBeInTheDocument()
  })

  it('falls back to extracting the first line as highlight if firstLineHighlight is omitted', () => {
    const variant: DaangnNewsVariant = {
      text: '첫 줄 문장입니다.\n두 번째 줄 문장입니다.',
    }

    render(<DaangnNewsPreview variant={variant} />)

    const highlightEl = screen.getByLabelText('강조 문구')
    expect(highlightEl).toBeInTheDocument()
    expect(highlightEl).toHaveTextContent('첫 줄 문장입니다.')
    expect(screen.getByText('두 번째 줄 문장입니다.')).toBeInTheDocument()
  })

  describe('media gallery rules (channel-spec integration & extreme inputs)', () => {
    it('renders cleanly with 0 images (no broken gallery)', () => {
      const variant: DaangnNewsVariant = {
        text: '사진 없는 텍스트 전용 소식입니다.',
        media: [],
      }

      const { container } = render(<DaangnNewsPreview variant={variant} />)

      expect(screen.getByText('사진 없는 텍스트 전용 소식입니다.')).toBeInTheDocument()
      expect(container.querySelector('img')).toBeNull()
      expect(screen.queryByLabelText('사진 갤러리')).toBeNull()
    })

    it('renders single photo layout when 1 image is provided', () => {
      const variant: DaangnNewsVariant = {
        text: '사진 1장 소식입니다.',
        media: [{ type: 'image', url: 'https://example.com/photo1.jpg' }],
      }

      render(<DaangnNewsPreview variant={variant} />)

      const img = screen.getByRole('img', { name: /소식 사진 1/ })
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', 'https://example.com/photo1.jpg')
      expect(screen.queryByText(/확인이 필요해요/)).toBeNull()
    })

    it('renders grid layout within 10 images display limit', () => {
      const photos = Array.from({ length: 5 }, (_, i) => ({
        type: 'image' as const,
        url: `https://example.com/p${i + 1}.jpg`,
      }))
      const variant: DaangnNewsVariant = {
        text: '사진 5장 소식입니다.',
        media: photos,
      }

      render(<DaangnNewsPreview variant={variant} />)

      const images = screen.getAllByRole('img', { name: /소식 사진/ })
      expect(images).toHaveLength(5)
      expect(screen.queryByText(/확인이 필요해요/)).toBeNull()
    })

    it('caps displayed images at 10 and shows honest unverified warning for 10+ images', () => {
      const photos = Array.from({ length: 14 }, (_, i) => ({
        type: 'image' as const,
        url: `https://example.com/p${i + 1}.jpg`,
      }))
      const variant: DaangnNewsVariant = {
        text: '사진 14장 소식입니다.',
        media: photos,
      }

      render(<DaangnNewsPreview variant={variant} />)

      // 갤러리에 직접 렌더링되는 이미지는 최대 10장 (currentSpec.daangn.galleryDisplayImages)
      expect(currentSpec.daangn.galleryDisplayImages).toBe(10)
      const images = screen.getAllByRole('img', { name: /소식 사진/ })
      expect(images).toHaveLength(10)

      // +4 장 더보기 오버레이
      expect(screen.getByText('+4')).toBeInTheDocument()

      // 정직한 UNVERIFIED 상태 라벨 "확인이 필요해요" 표시
      const unverifiedBadges = screen.getAllByText('확인이 필요해요')
      expect(unverifiedBadges.length).toBeGreaterThan(0)
      expect(screen.getByText(/피드 갤러리에는 앞 10장까지 우선 노출돼요/)).toBeInTheDocument()
    })

    it('handles extreme input: 21 images (> maxImages 20) with honest warning', () => {
      const photos = Array.from({ length: 21 }, (_, i) => ({
        type: 'image' as const,
        url: `https://example.com/p${i + 1}.jpg`,
      }))
      const variant: DaangnNewsVariant = {
        text: '사진 21장 대량 첨부 테스트',
        media: photos,
      }

      render(<DaangnNewsPreview variant={variant} />)

      expect(currentSpec.daangn.maxImages).toBe(20)
      // 최대 장수 초과 경고 표시
      expect(screen.getByText(/사진은 최대 20장까지 등록할 수 있어요/)).toBeInTheDocument()
      expect(screen.getByText(/현재 21장/)).toBeInTheDocument()

      // 정직한 "확인이 필요해요" 표시
      expect(screen.getAllByText('확인이 필요해요').length).toBeGreaterThan(0)
    })
  })

  describe('video slot rules', () => {
    it('renders single video slot when video is attached', () => {
      const variant: DaangnNewsVariant = {
        text: '동영상 소식입니다.',
        videoCount: 1,
      }

      render(<DaangnNewsPreview variant={variant} />)

      const videoSlot = screen.getByLabelText('첨부 동영상')
      expect(videoSlot).toBeInTheDocument()
      expect(within(videoSlot).getByText(/동영상 1개/)).toBeInTheDocument()
    })

    it('renders video slot when media contains video item', () => {
      const variant: DaangnNewsVariant = {
        text: '미디어 배열 내 비디오 소식',
        media: [{ type: 'video' }],
      }

      render(<DaangnNewsPreview variant={variant} />)

      expect(screen.getByLabelText('첨부 동영상')).toBeInTheDocument()
    })

    it('warns when video count exceeds 1 with honest unverified label', () => {
      const variant: DaangnNewsVariant = {
        text: '동영상 2개 첨부 소식',
        videoCount: 2,
      }

      render(<DaangnNewsPreview variant={variant} />)

      expect(screen.getByText(/동영상은 최대 1개까지 첨부할 수 있어요/)).toBeInTheDocument()
      expect(screen.getAllByText('확인이 필요해요').length).toBeGreaterThan(0)
    })
  })

  describe('coupon slot (optional)', () => {
    it('does not render coupon slot when coupon is not provided or "혜택 없음"', () => {
      const { rerender } = render(<DaangnNewsPreview variant={{ text: '쿠폰 없음 소식' }} />)
      expect(screen.queryByLabelText('쿠폰 혜택')).toBeNull()

      rerender(<DaangnNewsPreview variant={{ text: '쿠폰 없음 소식', coupon: '혜택 없음' }} />)
      expect(screen.queryByLabelText('쿠폰 혜택')).toBeNull()

      rerender(<DaangnNewsPreview variant={{ text: '쿠폰 없음 소식', coupon: '   ' }} />)
      expect(screen.queryByLabelText('쿠폰 혜택')).toBeNull()
    })

    it('renders coupon slot with action button when coupon is present', () => {
      const variant: DaangnNewsVariant = {
        text: '쿠폰 제공 소식입니다.',
        coupon: '아메리카노 1,000원 할인 쿠폰',
      }

      render(<DaangnNewsPreview variant={variant} />)

      const couponRegion = screen.getByLabelText('쿠폰 혜택')
      expect(couponRegion).toBeInTheDocument()
      expect(within(couponRegion).getByText('아메리카노 1,000원 할인 쿠폰')).toBeInTheDocument()
      expect(within(couponRegion).getByText('쿠폰 받기')).toBeInTheDocument()
    })
  })

  describe('390px mobile responsiveness & overflow prevention', () => {
    it('applies break-words and overflow prevention classes on long unbroken first line and text', () => {
      const longWord = '가'.repeat(120)
      const variant: DaangnNewsVariant = {
        firstLineHighlight: longWord,
        text: `본문_${'나'.repeat(150)}`,
        coupon: '할인쿠폰_'.repeat(20),
      }

      const { container } = render(
        <div style={{ width: '390px' }}>
          <DaangnNewsPreview variant={variant} />
        </div>
      )

      const article = screen.getByRole('article', { name: '당근 비즈프로필 소식 미리보기' })
      expect(article).toHaveClass('break-words')
      expect(article).toHaveClass('min-w-0')
      expect(article).toHaveClass('w-full')

      const highlight = screen.getByLabelText('강조 문구')
      expect(highlight).toHaveClass('break-words')

      // 렌더링 컨테이너에 overflow 넘침 방지 속성 확인
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  describe('registry adapter & PreviewFrame integration', () => {
    it('returns coming_soon when adapter is called without variant', async () => {
      const { channelPreviewAdapters } = await import('../channel-preview-adapters')
      const slot = channelPreviewAdapters.daangn_business.render()
      expect(slot.status).toBe('coming_soon')
      expect(slot.content).toBeUndefined()
    })

    it('returns ready slot with DaangnNewsPreview when variant is provided', async () => {
      const { channelPreviewAdapters } = await import('../channel-preview-adapters')
      const variant: DaangnNewsVariant = {
        text: '어댑터 렌더링 테스트',
        businessName: '우리동네 카페',
        coupon: '음료 10% 할인',
      }

      const slot = channelPreviewAdapters.daangn_business.render(variant)
      expect(slot.status).toBe('ready')
      expect(slot.content).toBeDefined()

      const { PreviewFrame } = await import('../preview-frame')
      render(
        <PreviewFrame channel="daangn_business" status={slot.status}>
          {slot.content}
        </PreviewFrame>
      )

      expect(screen.getByRole('region', { name: '당근 비즈니스 예상 화면' })).toBeInTheDocument()
      expect(screen.getByText('실제 게시 화면과 다를 수 있어요.')).toBeInTheDocument()
      expect(screen.getByText('우리동네 카페')).toBeInTheDocument()
      expect(screen.getByText('음료 10% 할인')).toBeInTheDocument()
    })

    it('evaluates channel spec via adapter evaluateSpec function', async () => {
      const { channelPreviewAdapters } = await import('../channel-preview-adapters')
      const result = channelPreviewAdapters.daangn_business.evaluateSpec({
        text: '간단한 소식 텍스트',
      })

      expect(result.specVersion).toBeDefined()
      expect(result.blocksVault).toBe(false)
      expect(result.checks.length).toBeGreaterThan(0)
    })
  })
})
