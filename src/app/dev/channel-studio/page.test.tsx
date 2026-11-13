import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { notFound } from 'next/navigation'
import ChannelStudioDevPage from './page'
import { SampleGallery } from './sample-gallery'
import { SAMPLE_CAFE_DRAFT } from '@/features/channel-studio/ui/sample-draft'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('not found')
  }),
}))

describe('ChannelStudioDevPage', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('triggers notFound in production environment', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => ChannelStudioDevPage()).toThrow('not found')
    expect(notFound).toHaveBeenCalledOnce()
  })

  it('renders sample gallery in non-production environment', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<ChannelStudioDevPage />)

    expect(screen.getByText('샘플 데이터')).toBeInTheDocument()
    expect(screen.getAllByText('실제 게시 화면과 다를 수 있어요.').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(SAMPLE_CAFE_DRAFT.topic)).toBeInTheDocument()
  })
})

describe('SampleGallery', () => {
  it('displays Korean status labels and unverified reason copy without English codes', () => {
    render(<SampleGallery initialDraft={SAMPLE_CAFE_DRAFT} />)

    // Korean status labels should be visible
    expect(screen.getAllByText('준비 완료').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('확인 필요')).toBeInTheDocument()

    // Reason copy for unverified price claim in cafe daangn variant
    expect(screen.getByText('등록된 가게 정보에 가격 근거가 없어서 확인이 필요해요')).toBeInTheDocument()

    // Disclaimer and sample markers
    expect(screen.getByText('샘플 데이터')).toBeInTheDocument()
    expect(screen.getAllByText('실제 게시 화면과 다를 수 있어요.').length).toBeGreaterThanOrEqual(1)

    // Forbidden English status tokens must not be rendered as text
    expect(screen.queryByText('NEEDS_CHECK')).not.toBeInTheDocument()
    expect(screen.queryByText('NEEDS_FIX')).not.toBeInTheDocument()
    expect(screen.queryByText('READY')).not.toBeInTheDocument()
    expect(screen.queryByText('ERROR')).not.toBeInTheDocument()
  })
})
