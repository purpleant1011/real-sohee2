import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  buildExportText,
  buildMailtoHref,
  downloadTextFile,
  imageFileName,
  shareContent,
} from './export-kit'

describe('export-kit', () => {
  describe('buildExportText', () => {
    it('naver_blog: 제목 + 빈 줄 + 본문 + 빈 줄 + 해시태그 형식으로 만든다', () => {
      const text = buildExportText({
        channel: 'naver_blog',
        title: '청라 카페 신메뉴 소개',
        caption: '오늘 출시된 딸기 라떼를 소개합니다.\n생딸기가 듬뿍 들어갔어요.',
        hashtags: ['#청라카페', '딸기라떼', '#카페투어'],
      })

      expect(text).toBe(
        '청라 카페 신메뉴 소개\n\n오늘 출시된 딸기 라떼를 소개합니다.\n생딸기가 듬뿍 들어갔어요.\n\n#청라카페 #딸기라떼 #카페투어'
      )
    })

    it('naver_blog: 해시태그가 비어있으면 제목과 본문만 빈 줄로 구분한다', () => {
      const text = buildExportText({
        channel: 'naver_blog',
        title: '네이버 블로그 제목',
        caption: '본문 내용입니다.',
        hashtags: [],
      })

      expect(text).toBe('네이버 블로그 제목\n\n본문 내용입니다.')
    })

    it('daangn_business: 제목 없이 본문 + 태그 형식으로 만든다', () => {
      const text = buildExportText({
        channel: 'daangn_business',
        title: '당근 소식 제목',
        caption: '당근 이웃님들 안녕하세요!\n이번 주 특가 이벤트 진행합니다.',
        hashtags: ['당근특가', '#이벤트'],
      })

      expect(text).toBe(
        '당근 이웃님들 안녕하세요!\n이번 주 특가 이벤트 진행합니다.\n\n#당근특가 #이벤트'
      )
    })

    it('daangn_business: 해시태그가 없으면 본문만 반환한다', () => {
      const text = buildExportText({
        channel: 'daangn_business',
        title: '제목',
        caption: '단독 본문입니다.',
        hashtags: [],
      })

      expect(text).toBe('단독 본문입니다.')
    })
  })

  describe('buildMailtoHref', () => {
    it('subject와 body를 encodeURIComponent로 인코딩한 mailto 링크를 반환한다', () => {
      const href = buildMailtoHref({
        subject: '테스트 제목',
        body: '테스트 본문',
      })

      expect(href).toBe(
        `mailto:?subject=${encodeURIComponent('테스트 제목')}&body=${encodeURIComponent('테스트 본문')}`
      )
    })

    it('본문이 1800자를 초과하면 1800자로 자르고 안내 문구를 덧붙인다', () => {
      const longBody = 'A'.repeat(2000)
      const href = buildMailtoHref({
        subject: '긴 본문',
        body: longBody,
      })

      const decodedBody = decodeURIComponent(href.split('&body=')[1] ?? '')
      expect(decodedBody.startsWith('A'.repeat(1800))).toBe(true)
      expect(decodedBody).toContain('...(본문이 길어 일부만 담겼어요')
      expect(decodedBody.length).toBeLessThan(2000)
    })
  })

  describe('imageFileName', () => {
    it('0-based index와 MIME 타입에 따라 순번이 매겨진 파일명을 반환한다', () => {
      expect(imageFileName(0, 'image/jpeg')).toBe('01.jpg')
      expect(imageFileName(1, 'image/png')).toBe('02.png')
      expect(imageFileName(2, 'image/webp')).toBe('03.webp')
      expect(imageFileName(9, 'image/gif')).toBe('10.gif')
    })

    it('MIME 타입이 없거나 알 수 없으면 jpg를 기본 확장자로 사용한다', () => {
      expect(imageFileName(0)).toBe('01.jpg')
      expect(imageFileName(3, 'application/octet-stream')).toBe('04.jpg')
    })
  })

  describe('shareContent', () => {
    const originalNavigator = global.navigator

    afterEach(() => {
      vi.restoreAllMocks()
      Object.defineProperty(global, 'navigator', {
        value: originalNavigator,
        configurable: true,
        writable: true,
      })
    })

    it('navigator.share가 없으면 unsupported를 반환한다', async () => {
      Object.defineProperty(global, 'navigator', {
        value: {},
        configurable: true,
        writable: true,
      })

      const result = await shareContent({ title: '공유', text: '내용' })
      expect(result).toBe('unsupported')
    })

    it('navigator.share 성공 시 shared를 반환한다', async () => {
      const mockShare = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(global, 'navigator', {
        value: { share: mockShare },
        configurable: true,
        writable: true,
      })

      const result = await shareContent({ title: '공유', text: '내용' })
      expect(mockShare).toHaveBeenCalledWith({ title: '공유', text: '내용' })
      expect(result).toBe('shared')
    })

    it('사용자가 취소(AbortError)하면 cancelled를 반환한다', async () => {
      const abortError = new Error('Share canceled')
      abortError.name = 'AbortError'
      const mockShare = vi.fn().mockRejectedValue(abortError)
      Object.defineProperty(global, 'navigator', {
        value: { share: mockShare },
        configurable: true,
        writable: true,
      })

      const result = await shareContent({ title: '공유', text: '내용' })
      expect(result).toBe('cancelled')
    })

    it('그 외 예외 발생 시 error를 반환한다', async () => {
      const error = new Error('Unexpected error')
      const mockShare = vi.fn().mockRejectedValue(error)
      Object.defineProperty(global, 'navigator', {
        value: { share: mockShare },
        configurable: true,
        writable: true,
      })

      const result = await shareContent({ title: '공유', text: '내용' })
      expect(result).toBe('error')
    })

    it('canShare가 지원되고 files가 유효하면 files를 포함하여 공유한다', async () => {
      const mockCanShare = vi.fn().mockReturnValue(true)
      const mockShare = vi.fn().mockResolvedValue(undefined)
      const testFile = new File(['image-data'], '01.jpg', { type: 'image/jpeg' })

      Object.defineProperty(global, 'navigator', {
        value: {
          share: mockShare,
          canShare: mockCanShare,
        },
        configurable: true,
        writable: true,
      })

      const result = await shareContent({
        title: '사진 포함 공유',
        text: '사진입니다',
        files: [testFile],
      })

      expect(mockCanShare).toHaveBeenCalled()
      expect(mockShare).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '사진 포함 공유',
          text: '사진입니다',
          files: [testFile],
        })
      )
      expect(result).toBe('shared')
    })
  })

  describe('downloadTextFile', () => {
    beforeEach(() => {
      vi.stubGlobal('URL', {
        createObjectURL: vi.fn().mockReturnValue('blob:mock-url'),
        revokeObjectURL: vi.fn(),
      })
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    it('Blob과 임시 a 요소를 생성해 다운로드를 트리거한다', () => {
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

      const ok = downloadTextFile('memo.txt', '원고 내용입니다.')
      expect(ok).toBe(true)
      expect(URL.createObjectURL).toHaveBeenCalled()
      expect(clickSpy).toHaveBeenCalled()
    })
  })
})
