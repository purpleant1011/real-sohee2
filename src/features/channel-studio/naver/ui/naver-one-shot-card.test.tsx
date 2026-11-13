import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NaverPostForCopy } from '../copy-naver-post'
import type { OneShotAssets, OneShotCopyOutcome, SharePhotosOutcome } from '../one-shot-handoff'
import { NAVER_BLOG_APP_URL, NaverOneShotCard } from './naver-one-shot-card'

const mockPost: NaverPostForCopy = {
  title: '인천 피부관리 후기',
  introduction: '오늘 소개할 곳은 인천 피부관리샵입니다.',
  sections: [
    { heading: '1. 관리 순서', body: '첫 번째로 클렌징을 진행했습니다.' },
    { heading: '2. 전후 비교', body: '수분감이 많이 개선되었습니다.' },
  ],
  keywords: ['인천피부관리', '청라피부관리'],
  disclosure: '소정의 원고료를 지원받았습니다.',
  media: [
    { id: 'photo-1', src: 'https://example.com/p1.jpg' },
    { id: 'photo-2', src: 'https://example.com/p2.jpg' },
  ],
}

const WRITE_URL = 'https://blog.naver.com/GoBlogWrite.naver'

function createFakeAssets(count = 2): OneShotAssets {
  return {
    photoCount: count,
    files: [
      new File(['fake-1'], 'photo-01.jpg', { type: 'image/jpeg' }),
      new File(['fake-2'], 'photo-02.jpg', { type: 'image/jpeg' }),
    ],
    skippedPhotos: 0,
  }
}

describe('NaverOneShotCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders progress and skeleton while preparing photos, with "사진 2장 준비 중…"', async () => {
    let resolvePrepare: (assets: OneShotAssets) => void = () => {}
    const preparePromise = new Promise<OneShotAssets>((resolve) => {
      resolvePrepare = resolve
    })
    const prepareMock = vi.fn().mockReturnValue(preparePromise)

    render(
      <NaverOneShotCard
        post={mockPost}
        writeUrl={WRITE_URL}
        deps={{
          prepare: prepareMock,
        }}
      />,
    )

    expect(screen.getByText('사진 2장 준비 중…')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()

    // Resolve prepare
    resolvePrepare(createFakeAssets(2))
    expect(await screen.findByText('준비 완료')).toBeInTheDocument()
  })

  it('shows error alert and retry button when prepare fails, and retries on click', async () => {
    const prepareMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('네트워크 오류'))
      .mockResolvedValueOnce(createFakeAssets(2))

    render(
      <NaverOneShotCard
        post={mockPost}
        writeUrl={WRITE_URL}
        deps={{
          prepare: prepareMock,
        }}
      />,
    )

    expect(await screen.findByText('네트워크 오류')).toBeInTheDocument()
    const retryBtn = screen.getByRole('button', { name: '다시 시도' })
    expect(retryBtn).toBeInTheDocument()

    fireEvent.click(retryBtn)
    expect(await screen.findByText('준비 완료')).toBeInTheDocument()
    expect(prepareMock).toHaveBeenCalledTimes(2)
  })

  it('renders step 1 and step 2 groups with step badges (1, 2) and summary header', async () => {
    render(
      <NaverOneShotCard
        post={mockPost}
        writeUrl={WRITE_URL}
        deps={{
          prepare: vi.fn().mockResolvedValue(createFakeAssets(2)),
          isDesktop: false,
        }}
      />,
    )

    expect(await screen.findByText('준비 완료')).toBeInTheDocument()
    expect(screen.getByText('사진 2장 · 글 한 번에 붙여넣기')).toBeInTheDocument()

    const step1 = screen.getByRole('group', { name: /글\+사진 한 번에 준비/ })
    const step2 = screen.getByRole('group', { name: /네이버 블로그 앱 열기/ })

    expect(step1).toBeInTheDocument()
    expect(step2).toBeInTheDocument()
  })

  it('한 번에 준비하기 클릭 시 copy와 share를 동기적으로 모두 호출한다 (모바일)', async () => {
    const copyMock = vi.fn().mockResolvedValue({ status: 'ok', photos: 2 } as OneShotCopyOutcome)
    const shareMock = vi.fn().mockResolvedValue('shared' as SharePhotosOutcome)

    render(
      <NaverOneShotCard
        post={mockPost}
        writeUrl={WRITE_URL}
        deps={{
          prepare: vi.fn().mockResolvedValue(createFakeAssets(2)),
          copy: copyMock,
          share: shareMock,
          isDesktop: false,
        }}
      />,
    )

    const prepareAllBtn = await screen.findByRole('button', { name: '글+사진 한 번에 준비하기' })
    fireEvent.click(prepareAllBtn)

    expect(copyMock).toHaveBeenCalledTimes(1)
    expect(shareMock).toHaveBeenCalledTimes(1)

    // 결과 2줄 분리 표시
    expect(
      await screen.findByText('글을 복사했어요. 네이버 글쓰기에서 붙여넣기만 하면 돼요'),
    ).toBeInTheDocument()
    expect(
      await screen.findByText("공유 시트에서 '이미지 2개 저장'을 눌러 주세요"),
    ).toBeInTheDocument()
  })

  it('결과 메시지 영역이 min-height를 확보하여 버튼 위치 흔들림을 방지한다', async () => {
    render(
      <NaverOneShotCard
        post={mockPost}
        writeUrl={WRITE_URL}
        deps={{
          prepare: vi.fn().mockResolvedValue(createFakeAssets(2)),
        }}
      />,
    )

    await screen.findByText('준비 완료')
    const feedbackArea = screen.getByTestId('step-1-feedback-area')
    expect(feedbackArea.className).toMatch(/min-h-\[44px\]/)
  })

  it('사진 권한 접이식 안내가 모바일에서 존재한다', async () => {
    render(
      <NaverOneShotCard
        post={mockPost}
        writeUrl={WRITE_URL}
        deps={{
          prepare: vi.fn().mockResolvedValue(createFakeAssets(2)),
          isDesktop: false,
        }}
      />,
    )

    await screen.findByText('준비 완료')
    expect(screen.getByText('네이버 앱에서 방금 저장한 사진이 안 보이면')).toBeInTheDocument()
    expect(
      screen.getByText(/사진 선택 화면 위쪽의 '설정' 또는 iPhone 설정 > 네이버 블로그 > 사진 > '모든 사진'을 허용해 주세요/),
    ).toBeInTheDocument()
  })

  it('복사 전에는 앱 열기 버튼이 보조 톤(outline), 복사 성공(ok) 후에는 주 버튼(bg-primary)으로 활성화된다', async () => {
    const copyMock = vi.fn().mockResolvedValue({ status: 'ok', photos: 2 } as OneShotCopyOutcome)
    const shareMock = vi.fn().mockResolvedValue('shared' as SharePhotosOutcome)

    render(
      <NaverOneShotCard
        post={mockPost}
        writeUrl={WRITE_URL}
        deps={{
          prepare: vi.fn().mockResolvedValue(createFakeAssets(2)),
          copy: copyMock,
          share: shareMock,
          isDesktop: false,
        }}
      />,
    )

    const step1Btn = await screen.findByRole('button', { name: '글+사진 한 번에 준비하기' })
    const appOpenLink = screen.getByRole('link', { name: '네이버 블로그 앱 열기' })

    // 시작: step1Btn은 primary, appOpenLink는 outline
    expect(step1Btn.className).toMatch(/bg-primary/)
    expect(appOpenLink.className).not.toMatch(/bg-primary/)
    expect(appOpenLink).toHaveAttribute('href', NAVER_BLOG_APP_URL)

    // 클릭 후 성공
    fireEvent.click(step1Btn)

    await screen.findByText('글을 복사했어요. 네이버 글쓰기에서 붙여넣기만 하면 돼요')

    // 성공 후: step1Btn은 outline, appOpenLink는 primary
    expect(step1Btn.className).not.toMatch(/bg-primary/)
    expect(appOpenLink.className).toMatch(/bg-primary/)
  })

  it('복사 실패 (denied/failed/unavailable) 시 textarea 폴백을 띄운다', async () => {
    const copyMock = vi.fn().mockResolvedValue({ status: 'denied', photos: 0 } as OneShotCopyOutcome)
    const shareMock = vi.fn().mockResolvedValue('shared' as SharePhotosOutcome)

    render(
      <NaverOneShotCard
        post={mockPost}
        writeUrl={WRITE_URL}
        deps={{
          prepare: vi.fn().mockResolvedValue(createFakeAssets(2)),
          copy: copyMock,
          share: shareMock,
          isDesktop: false,
        }}
      />,
    )

    const step1Btn = await screen.findByRole('button', { name: '글+사진 한 번에 준비하기' })
    fireEvent.click(step1Btn)

    expect(await screen.findByText('복사하지 못했어요')).toBeInTheDocument()

    const textarea = screen.getByRole('textbox', { name: '전체 원고 텍스트' }) as HTMLTextAreaElement
    expect(textarea).toBeInTheDocument()
    expect(textarea.value).toContain('인천 피부관리 후기')
  })

  it('사진 공유가 미지원/실패하면 안내와 함께 "사진만 다시 시도" 보조 버튼이 제공된다', async () => {
    const copyMock = vi.fn().mockResolvedValue({ status: 'ok', photos: 2 } as OneShotCopyOutcome)
    const shareMock = vi.fn().mockResolvedValue('unsupported' as SharePhotosOutcome)

    render(
      <NaverOneShotCard
        post={mockPost}
        writeUrl={WRITE_URL}
        deps={{
          prepare: vi.fn().mockResolvedValue(createFakeAssets(2)),
          copy: copyMock,
          share: shareMock,
          isDesktop: false,
        }}
      />,
    )

    const step1Btn = await screen.findByRole('button', { name: '글+사진 한 번에 준비하기' })
    fireEvent.click(step1Btn)

    expect(
      await screen.findByText('이 기기는 한 번에 저장을 지원하지 않아요. 아래 ZIP으로 받아 주세요'),
    ).toBeInTheDocument()

    const retryShareBtn = screen.getByRole('button', { name: '사진만 다시 시도' })
    expect(retryShareBtn).toBeInTheDocument()

    // 사진만 다시 시도 클릭
    fireEvent.click(retryShareBtn)
    expect(shareMock).toHaveBeenCalledTimes(2)
  })

  it('공유 결과가 unsupported일 때 결과 줄 아래에 "사진 N장 ZIP으로 받기" outline 버튼을 노출하고 클릭 시 onDownloadZip을 호출한다', async () => {
    const copyMock = vi.fn().mockResolvedValue({ status: 'ok', photos: 2 } as OneShotCopyOutcome)
    const shareMock = vi.fn().mockResolvedValue('unsupported' as SharePhotosOutcome)
    const downloadZipMock = vi.fn().mockResolvedValue(undefined)

    const { rerender } = render(
      <NaverOneShotCard
        post={mockPost}
        writeUrl={WRITE_URL}
        onDownloadZip={downloadZipMock}
        downloading={false}
        deps={{
          prepare: vi.fn().mockResolvedValue(createFakeAssets(2)),
          copy: copyMock,
          share: shareMock,
          isDesktop: false,
        }}
      />,
    )

    const step1Btn = await screen.findByRole('button', { name: '글+사진 한 번에 준비하기' })
    fireEvent.click(step1Btn)

    expect(await screen.findByText(/이 기기는 한 번에 저장을 지원하지 않아요/)).toBeInTheDocument()

    const zipBtn = screen.getByRole('button', { name: '사진 2장 ZIP으로 받기' })
    expect(zipBtn).toBeInTheDocument()
    expect(zipBtn.className).toMatch(/min-h-11/)

    fireEvent.click(zipBtn)
    expect(downloadZipMock).toHaveBeenCalledTimes(1)

    // downloading 중일 때 상태 표시
    rerender(
      <NaverOneShotCard
        post={mockPost}
        writeUrl={WRITE_URL}
        onDownloadZip={downloadZipMock}
        downloading={true}
        deps={{
          prepare: vi.fn().mockResolvedValue(createFakeAssets(2)),
          copy: copyMock,
          share: shareMock,
          isDesktop: false,
        }}
      />,
    )
    expect(screen.getByRole('button', { name: /ZIP.*준비 중/ })).toBeInTheDocument()
  })

  it('ZIP 다운로드 실패 시 정직한 에러 문구를 노출한다', async () => {
    const copyMock = vi.fn().mockResolvedValue({ status: 'ok', photos: 2 } as OneShotCopyOutcome)
    const shareMock = vi.fn().mockResolvedValue('unsupported' as SharePhotosOutcome)
    const downloadZipMock = vi.fn().mockRejectedValue(new Error('ZIP 생성에 실패했습니다.'))

    render(
      <NaverOneShotCard
        post={mockPost}
        writeUrl={WRITE_URL}
        onDownloadZip={downloadZipMock}
        deps={{
          prepare: vi.fn().mockResolvedValue(createFakeAssets(2)),
          copy: copyMock,
          share: shareMock,
          isDesktop: false,
        }}
      />,
    )

    const step1Btn = await screen.findByRole('button', { name: '글+사진 한 번에 준비하기' })
    fireEvent.click(step1Btn)

    const zipBtn = await screen.findByRole('button', { name: '사진 2장 ZIP으로 받기' })
    fireEvent.click(zipBtn)

    expect(await screen.findByText('ZIP 생성에 실패했습니다.')).toBeInTheDocument()
  })

  it('데스크톱(PC 모드)에서는 2단계 주 버튼이 "네이버 글쓰기 열기(PC)"로 변경되고 새 창(_blank)으로 열린다', async () => {
    render(
      <NaverOneShotCard
        post={mockPost}
        writeUrl={WRITE_URL}
        deps={{
          prepare: vi.fn().mockResolvedValue(createFakeAssets(2)),
          isDesktop: true,
        }}
      />,
    )

    await screen.findByText('준비 완료')

    const pcWriteLink = screen.getByRole('link', { name: '네이버 글쓰기 열기(PC)' })
    expect(pcWriteLink).toBeInTheDocument()
    expect(pcWriteLink).toHaveAttribute('href', WRITE_URL)
    expect(pcWriteLink).toHaveAttribute('target', '_blank')
    expect(pcWriteLink).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('안내 문구(할 일 ③)가 사진 장수 N<=10 과 N>10에 따라 정확히 분기된다', async () => {
    // 10장 이하 케이스
    const { rerender } = render(
      <NaverOneShotCard
        post={mockPost}
        writeUrl={WRITE_URL}
        deps={{
          prepare: vi.fn().mockResolvedValue(createFakeAssets(2)),
        }}
      />,
    )

    await screen.findByText('준비 완료')
    expect(
      screen.getByText(/소개 글 끝 빈 줄을 탭해 사진 → 저장한 2장을 1번부터 차례로 선택해 첨부\('슬라이드' 추천\)/),
    ).toBeInTheDocument()

    // 11장 이상(N>10) 케이스
    rerender(
      <NaverOneShotCard
        post={mockPost}
        writeUrl={WRITE_URL}
        deps={{
          prepare: vi.fn().mockResolvedValue(createFakeAssets(15)),
        }}
      />,
    )

    await screen.findByText('준비 완료')
    expect(
      screen.getByText(/소개 글 끝 빈 줄을 탭해 사진 → 저장한 15장을 1번부터 차례로 선택해 첨부\(개별사진 또는 10장씩 두 번\)/),
    ).toBeInTheDocument()
  })

  it('네이버에서 할 일 3줄 요약과 태그 안내, 소희로 돌아올 필요 없다는 안내가 details 안에 렌더링되고 기본 펼쳐져 있다', async () => {
    render(
      <NaverOneShotCard
        post={mockPost}
        writeUrl={WRITE_URL}
        deps={{
          prepare: vi.fn().mockResolvedValue(createFakeAssets(2)),
        }}
      />,
    )

    await screen.findByText('준비 완료')

    const summaryEl = screen.getByText('네이버에서 할 일')
    const detailsEl = summaryEl.closest('details')
    expect(detailsEl).toBeInTheDocument()
    expect(detailsEl).toHaveAttribute('open')

    expect(screen.getByText('본문 칸에 붙여넣기')).toBeInTheDocument()
    expect(screen.getByText('맨 윗줄(제목)을 잘라(길게 눌러→잘라내기 / PC는 Cmd·Ctrl+X) 제목 칸에 붙여넣기')).toBeInTheDocument()
    expect(
      screen.getByText(/소개 글 끝 빈 줄을 탭해 사진 → 저장한 2장을 1번부터 차례로 선택해 첨부\('슬라이드' 추천\)/),
    ).toBeInTheDocument()
    expect(screen.getByText('맨 아래 #태그 줄은 발행할 때 네이버가 태그로 읽어요')).toBeInTheDocument()
    expect(
      screen.getByText(/끝나면 네이버 앱에서 바로 등록하세요 \(소희로 돌아올 필요 없어요\)/),
    ).toBeInTheDocument()
  })

  it('모든 버튼과 링크는 터치 타깃 44px 이상이다', async () => {
    render(
      <NaverOneShotCard
        post={mockPost}
        writeUrl={WRITE_URL}
        deps={{
          prepare: vi.fn().mockResolvedValue(createFakeAssets(2)),
          isDesktop: false,
        }}
      />,
    )

    const step1Btn = await screen.findByRole('button', { name: '글+사진 한 번에 준비하기' })
    const appOpenLink = screen.getByRole('link', { name: '네이버 블로그 앱 열기' })
    const webLink = screen.getByRole('link', { name: /앱이 안 열리면 웹으로 열기/ })

    expect(step1Btn.className).toMatch(/min-h-12|min-h-11/)
    expect(appOpenLink.className).toMatch(/min-h-12|min-h-11/)
    expect(webLink.className).toMatch(/min-h-11/)
  })

  it('PC(isDesktop: true)에서 1단계 주 버튼 라벨은 "글 복사하고 사진 ZIP 받기"이고, 클릭 시 copy와 onDownloadZip 둘 다 동기적으로 호출된다', async () => {
    const copyMock = vi.fn().mockResolvedValue({ status: 'ok', photos: 2 } as OneShotCopyOutcome)
    const downloadZipMock = vi.fn().mockResolvedValue(undefined)

    render(
      <NaverOneShotCard
        post={mockPost}
        writeUrl={WRITE_URL}
        onDownloadZip={downloadZipMock}
        deps={{
          prepare: vi.fn().mockResolvedValue(createFakeAssets(2)),
          copy: copyMock,
          isDesktop: true,
        }}
      />,
    )

    const pcMainBtn = await screen.findByRole('button', { name: '글 복사하고 사진 ZIP 받기' })
    expect(pcMainBtn).toBeInTheDocument()

    fireEvent.click(pcMainBtn)

    expect(copyMock).toHaveBeenCalledTimes(1)
    expect(downloadZipMock).toHaveBeenCalledTimes(1)

    // 결과 2줄 분리 표시 (글 복사 결과 + ZIP 완료 결과)
    expect(
      await screen.findByText('글을 복사했어요. 네이버 글쓰기에서 붙여넣기만 하면 돼요'),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(/사진 2장 사진 한꺼번에 저장을 시작했어요/),
    ).toBeInTheDocument()
  })

  it('사진 권한 안내는 모바일(isDesktop: false)에서만 표시되고, PC(isDesktop: true)에서는 숨겨진다', async () => {
    const { rerender } = render(
      <NaverOneShotCard
        post={mockPost}
        writeUrl={WRITE_URL}
        deps={{
          prepare: vi.fn().mockResolvedValue(createFakeAssets(2)),
          isDesktop: false,
        }}
      />,
    )

    await screen.findByText('준비 완료')
    expect(screen.getByText('네이버 앱에서 방금 저장한 사진이 안 보이면')).toBeInTheDocument()

    rerender(
      <NaverOneShotCard
        post={mockPost}
        writeUrl={WRITE_URL}
        deps={{
          prepare: vi.fn().mockResolvedValue(createFakeAssets(2)),
          isDesktop: true,
        }}
      />,
    )

    expect(screen.queryByText('네이버 앱에서 방금 저장한 사진이 안 보이면')).not.toBeInTheDocument()
  })

  it('단계 제목(step 1, step 2)에 truncate 클래스가 존재하지 않아 줄바꿈을 허용한다', async () => {
    render(
      <NaverOneShotCard
        post={mockPost}
        writeUrl={WRITE_URL}
        deps={{
          prepare: vi.fn().mockResolvedValue(createFakeAssets(2)),
          isDesktop: false,
        }}
      />,
    )

    await screen.findByText('준비 완료')

    const title1 = document.getElementById('step-1-title')
    const title2 = document.getElementById('step-2-title')

    expect(title1).toBeInTheDocument()
    expect(title2).toBeInTheDocument()
    expect(title1?.className).not.toContain('truncate')
    expect(title2?.className).not.toContain('truncate')
  })
})
