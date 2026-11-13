import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import * as React from 'react'
import { BundleView } from '../BundleView'
import type { VaultCopyBundle } from '../../types'

describe('BundleView UI Component (ANI-1541)', () => {
  const sampleBundle: VaultCopyBundle = {
    itemRef: 'ref-test-123',
    channel: 'naver_blog',
    channelLabel: '네이버 블로그',
    title: '테스트 카페 신메뉴',
    body: '맛있는 커피와 디저트가 준비되어 있습니다.',
    tags: ['카페', '디저트'],
    formattedTags: '#카페 #디저트',
    fullText: '[제목]\n테스트 카페 신메뉴\n\n[본문]\n맛있는 커피와 디저트가 준비되어 있습니다.\n\n[태그]\n#카페 #디저트',
    settingsNotice: '카테고리 및 공개 설정은 네이버 블로그 스마트에디터에서 직접 선택해 주세요.',
    images: [
      {
        id: 'img-1',
        position: 0,
        storageBucket: 'content-media',
        objectPath: 'path/1.jpg',
        format: 'jpeg',
        width: 1080,
        height: 1080,
        signedUrl: 'https://signed.example.com/img1.jpg',
        downloadFilename: 'naver_blog_image_1.jpg',
      },
    ],
    guideSteps: [
      "1. '제목'과 '본문' 또는 '한 번에 복사'를 눌러 내용을 복사하세요.",
      '2. 네이버 블로그 앱을 열고 붙여넣으세요.',
    ],
    publicationStatus: {
      statusLabel: '발행 준비 완료 · 외부 게시 전',
      isPublishedUrlRegistered: false,
      publishedUrl: null,
      registeredAt: null,
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders bundle details and guide steps correctly', () => {
    render(<BundleView bundle={sampleBundle} workspaceId="ws-1" />)

    expect(screen.getByText('네이버 블로그')).toBeDefined()
    expect(screen.getByText('발행 준비 완료 · 외부 게시 전')).toBeDefined()
    expect(screen.getByText('테스트 카페 신메뉴')).toBeDefined()
    expect(screen.getByText('한 번에 전체 복사하기')).toBeDefined()
    expect(screen.getByText('제목 복사')).toBeDefined()
    expect(screen.getByText('본문 복사')).toBeDefined()
    expect(screen.getByText('태그 복사')).toBeDefined()
    expect(screen.getByText('naver_blog_image_1.jpg')).toBeDefined()
    expect(screen.getByText(/카테고리 및 공개 설정/)).toBeDefined()
  })

  it('copies text via navigator.clipboard and displays feedback', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    })

    render(<BundleView bundle={sampleBundle} workspaceId="ws-1" />)

    fireEvent.click(screen.getByText('한 번에 전체 복사하기'))

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(sampleBundle.fullText)
    })
    expect(screen.getByText(/복사되었어요/)).toBeDefined()
  })

  it('shows fallback textarea when clipboard API throws', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('Permission denied')),
      },
    })
    document.execCommand = vi.fn().mockReturnValue(false)

    render(<BundleView bundle={sampleBundle} workspaceId="ws-1" />)

    fireEvent.click(screen.getByText('본문 복사'))

    await waitFor(() => {
      expect(screen.getByLabelText('복사용 텍스트 상자')).toBeDefined()
    })
  })

  it('validates URL and posts to bundle route on manual URL submission', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        publishedUrl: 'https://blog.naver.com/my/1234',
        statusLabel: '사장님이 직접 올린 글로 기록됐어요(확인 전)',
        registeredAt: '2026-10-08T12:00:00Z',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<BundleView bundle={sampleBundle} workspaceId="ws-1" />)

    const input = screen.getByLabelText('게시 완료된 글 주소')
    fireEvent.change(input, { target: { value: 'https://blog.naver.com/my/1234' } })

    fireEvent.click(screen.getByText('게시 주소 등록하기'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/ws-1/vault/ref-test-123/bundle',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ url: 'https://blog.naver.com/my/1234' }),
        }),
      )
    })

    await waitFor(() => {
      const statusElements = screen.getAllByText('사장님이 직접 올린 글로 기록됐어요(확인 전)')
      expect(statusElements.length).toBeGreaterThanOrEqual(1)
    })

    // Must NOT contain verified assertions
    expect(screen.queryByText(/VERIFIED/)).toBeNull()
    expect(screen.queryByText(/검증 완료/)).toBeNull()
  })

  it('rejects invalid URL in UI form', async () => {
    render(<BundleView bundle={sampleBundle} workspaceId="ws-1" />)

    const input = screen.getByLabelText('게시 완료된 글 주소')
    fireEvent.change(input, { target: { value: 'http://not-https.com' } })
    fireEvent.click(screen.getByText('게시 주소 등록하기'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined()
      expect(screen.getByText(/https:\/\//)).toBeDefined()
    })
  })
})
